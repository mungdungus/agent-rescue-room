import { callGemini, extractAndParseJSON } from "@/lib/ai-clients";
import { createLogger } from "@/lib/logger";
import { ephemeralStorage } from "@/lib/redis";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { RepoFile as ScraperRepoFile } from "../github/scraper";
import { scanForTribunal } from "./security-scanner";
import { runDualAgentAnalysis } from "./verification-engine";
import { buildTribunalReport } from "./tribunal-reconciler";
import { analyzeForCareer } from "./career-analyzer";
import {
  AgentResponse,
  AgentFinding,
  Severity,
  RepoFile as TribunalRepoFile,
  TribunalConfig,
  TribunalTier,
} from "@/types/tribunal";
import { AnalysisResult, AnalysisWarning } from "@/types/analysis";
import { CareerPacket } from "@/types/career";
import {
  SECURITY_PROMPT_VERSION,
  CAREER_PROMPT_VERSION,
  getSecurityPrompt,
} from "@/prompts";
import { triageFiles, chunkFilesForDeepScan, TriagedFile } from "./scan-triage";
import { startPhase, endPhase } from './scan-telemetry';

const baseLog = createLogger('ANALYZER');

// User tier type for analysis configuration
type UserTier = TribunalTier;

interface AnalyzeOptions {
  tier?: UserTier;
  includeCareerAnalysis?: boolean;
  /**
   * Phase 52.05 (ISS-009): Rescan mode options.
   * When set, skips triage, restricts deep scan to the provided file paths,
   * and uses single-agent (lighter) analysis instead of dual-agent Tribunal.
   */
  rescanMode?: {
    /** Only deep-scan files whose paths are in this set */
    allowedFilePaths: Set<string>;
  };
  /** Phase 62: Commit messages for B3 commit hygiene check (fetched separately via GitHub API) */
  commitMessages?: string[];
  /** Phase 83.1: Scan telemetry — if absent, telemetry is silently skipped */
  scanId?: string;
  /** Phase 12: User ID for BYOK key resolution in dual-agent analysis */
  userId?: string;
}

// Helper to merge chunked agent responses
function mergeAgentResponses(responses: AgentResponse[]): AgentResponse {
  if (responses.length === 0) {
    return {
      findings: [],
      positives: [],
      analysisTimeMs: 0,
      model: 'unknown'
    };
  }
  const first = responses[0]!;
  return {
    ...first,
    model: first.model || 'unknown',
    findings: responses.flatMap(r => r.findings),
    positives: responses.flatMap(r => r.positives),
    coverage_matrix: responses.flatMap(r => r.coverage_matrix || []),
    stack_profile: responses.flatMap(r => r.stack_profile || []),
    // Use the first hiring packet found (usually only one chunk generates it if scoped, but here we just take one)
    hiring_packet: responses.find(r => r.hiring_packet)?.hiring_packet,
    talking_points: responses.flatMap(r => r.talking_points || []),
    analysisTimeMs: responses.reduce((acc, r) => acc + r.analysisTimeMs, 0),
  };
}

// Cost & Performance Guardrails
const ESTIMATED_CHARS_PER_TOKEN = 4;
const TIER_BUDGETS_TOKENS: Record<UserTier, number> = {
  scout: 40_000,   // ~160KB (Tight budget for free tier)
  pro: 500_000,    // ~2MB   (Standard budget)
  ltd: 2_000_000   // ~8MB   (High budget)
};
const MAX_SCAN_DURATION_MS = 270_000; // 4.5 minutes — prose deferred, leaves 30s for career + storage within 300s Vercel limit

export async function analyzeRepoSnapshot(
  snapshotKey: string,
  repoId: string,
  options: AnalyzeOptions = {},
  tribunalConfig?: TribunalConfig
): Promise<AnalysisResult> {
  const startTime = Date.now();
  const { tier = 'pro', includeCareerAnalysis = true, rescanMode, commitMessages } = options;
  const isRescanMode = rescanMode !== undefined;

  // Structured log context for correlation across all phases of this run
  const log = baseLog.withContext({ runId: snapshotKey, repoId, tier });

  const modelName = process.env.GEMINI_MODEL || "gemini-3-flash-preview";

  log.info(`analyzer_run_started`, { snapshotKey, rescanMode: isRescanMode });

  const scanId = options.scanId;

  // === Phase 1: Fetch ===
  // 1. Fetch code from Incinerator
  if (scanId) await startPhase(scanId, 'fetch');
  const rawData = await ephemeralStorage.get<string | ScraperRepoFile[]>(snapshotKey);
  if (!rawData) {
    throw new Error("Code snapshot has expired or does not exist (Incinerator Protocol enforced).");
  }

  const scrapedFiles: ScraperRepoFile[] = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;

  // Convert to Tribunal RepoFiles (with size)
  const files: TribunalRepoFile[] = scrapedFiles.map(f => ({
    ...f,
    size: f.content.length
  }));
  if (scanId) await endPhase(scanId, 'fetch', { meta: { fileCount: files.length } });

  // === Phase 2: Triage (skipped in rescanMode — we already know which files matter) ===
  const deepScanCandidates: TribunalRepoFile[] = [];
  const validTriagedFiles: TriagedFile[] = [];

  if (scanId) await startPhase(scanId, 'triage');

  if (isRescanMode) {
    // Rescan mode: restrict to file paths from parent scan issues only (ISS-009)
    log.info("triage_skipped_rescan_mode", { allowedFileCount: rescanMode.allowedFilePaths.size });
    for (const file of files) {
      if (rescanMode.allowedFilePaths.has(file.path)) {
        deepScanCandidates.push(file);
        // Wrap in TriagedFile shape for chunking compatibility
        validTriagedFiles.push({ file: file as ScraperRepoFile, relevanceScore: 100, reason: 'parent-issue-file' });
      }
    }
    log.info("triage_rescan_files_selected", { selected: deepScanCandidates.length, total: files.length });
    if (scanId) await endPhase(scanId, 'triage', { status: 'skipped', meta: { reason: 'rescan_mode', fileCount: deepScanCandidates.length } });
  } else {
    log.info("triage_started");
    const triageResult = await triageFiles(files);

    // Apply Token Budget
    const budgetTokens = TIER_BUDGETS_TOKENS[tier] || TIER_BUDGETS_TOKENS.pro;
    const maxChars = budgetTokens * ESTIMATED_CHARS_PER_TOKEN;

    let currentChars = 0;

    for (const tf of triageResult.files) {
      if (currentChars + tf.file.content.length > maxChars) {
        log.debug("triage_budget_exceeded", { file: tf.file.path, charsSoFar: currentChars, maxChars, rank: tf.relevanceScore });
        continue;
      }
      // Cast strict type as triageFiles returns ScraperRepoFile but we know we passed TribunalRepoFile
      deepScanCandidates.push(tf.file as TribunalRepoFile);
      validTriagedFiles.push(tf); // Only keep files that fit in budget
      currentChars += tf.file.content.length;
    }

    log.info("triage_complete", {
      keptFiles: deepScanCandidates.length,
      totalFiles: files.length,
      charsUsed: currentChars,
      maxChars,
      excludedNoise: triageResult.excluded.length,
      excludedBudget: triageResult.files.length - validTriagedFiles.length,
    });
    if (scanId) await endPhase(scanId, 'triage', { meta: { keptFiles: deepScanCandidates.length, totalFiles: files.length, charsUsed: currentChars } });
  }

  // === Phase 3: Deterministic Scan (Global) ===
  // We runs regex checks on ALL files (including noise) to catch hardcoded secrets or strictly forbidden patterns anywhere
  if (scanId) await startPhase(scanId, 'deterministic');
  log.info("deterministic_scan_started");
  const deterministicResult = scanForTribunal(files, commitMessages ?? []);
  log.info("deterministic_scan_complete", { findingCount: deterministicResult.findings.length });
  if (scanId) await endPhase(scanId, 'deterministic', { meta: { findingCount: deterministicResult.findings.length } });




// === Phase 4: Tier-Specific Deep Scan ===
  let analysis: AnalysisResult | null = null;
  const analysisWarnings: AnalysisWarning[] = [];

  if (tribunalConfig && !isRescanMode) {
    // === PRO / PLATINUM / ENTERPRISE / SCOUT (Dual-Agent Tribunal) — Full scan only ===

    log.info("dual_agent_analysis_started", {
      agentA: `${tribunalConfig.agentA.provider}/${tribunalConfig.agentA.model}`,
      agentB: `${tribunalConfig.agentB.provider}/${tribunalConfig.agentB.model}`,
    });

    const chunks = chunkFilesForDeepScan(validTriagedFiles);
    log.info("dual_agent_chunks_created", { fileCount: deepScanCandidates.length, chunkCount: chunks.length });

    const agentAResponses: AgentResponse[] = [];
    const agentBResponses: AgentResponse[] = [];

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (!chunk) continue;

        // Enforce Timeout
        if (Date.now() - startTime > MAX_SCAN_DURATION_MS) {
            const elapsedSec = Math.round((Date.now() - startTime) / 1000);
            const msg = `Scan timeout reached (${elapsedSec}s). Aborting remaining ${chunks.length - i} chunks.`;
            log.warn("dual_agent_timeout", { elapsedSec, remainingChunks: chunks.length - i });
            analysisWarnings.push({ type: 'partial_data', message: msg, severity: 'warning' });
            if (scanId) await endPhase(scanId, 'dual_agent_chunk', {
              status: 'timeout', meta: { chunkIndex: i, remainingChunks: chunks.length - i }
            });
            break;
        }

        if (scanId) await startPhase(scanId, 'dual_agent_chunk', {
          meta: { chunkIndex: i, chunkTotal: chunks.length, fileCount: chunk.length,
                  agentAModel: `${tribunalConfig.agentA.provider}/${tribunalConfig.agentA.model}`,
                  agentBModel: `${tribunalConfig.agentB.provider}/${tribunalConfig.agentB.model}` }
        });
        log.debug("dual_agent_chunk_processing", { chunk: i + 1, total: chunks.length, files: chunk.length });

        // Unwrap TriagedFile -> RepoFile
        const chunkFiles = chunk.map(tf => tf.file as TribunalRepoFile);

        try {
            const { agentA, agentB } = await runDualAgentAnalysis(chunkFiles, tribunalConfig, tier, options.userId);
            agentAResponses.push(agentA);
            agentBResponses.push(agentB);
            if (scanId) await endPhase(scanId, 'dual_agent_chunk', {
              meta: { chunkIndex: i, agentAFindings: agentA.findings.length, agentBFindings: agentB.findings.length }
            });
        } catch (chunkErr) {
            const msg = `Chunk ${i + 1} analysis failed: ${chunkErr instanceof Error ? chunkErr.message : String(chunkErr)}`;
            log.error("dual_agent_chunk_failed", chunkErr instanceof Error ? chunkErr : new Error(String(chunkErr)), "ANALYZE_001");
            analysisWarnings.push({ type: 'partial_data', message: msg, severity: 'warning' });
            if (scanId) await endPhase(scanId, 'dual_agent_chunk', {
              status: 'failed', meta: { chunkIndex: i }, error: msg
            });
            // Continue to next chunk
        }
    }

    // Merge chunked responses
    const agentA = mergeAgentResponses(agentAResponses);
    const agentB = mergeAgentResponses(agentBResponses);

    // Detect silently-failed agents (returned empty results with error message)
    const agentAFailed = agentAResponses.some(r => r.error) && agentA.findings.length === 0;
    const agentBFailed = agentBResponses.some(r => r.error) && agentB.findings.length === 0;

    // Phase 12: If BOTH agents failed, throw so the error surfaces to the user
    if (agentAFailed && agentBFailed) {
      const errorA = agentAResponses.find(r => r.error)?.error ?? 'unknown';
      const errorB = agentBResponses.find(r => r.error)?.error ?? 'unknown';
      throw new Error(
        `Both analysis agents failed. Agent A: ${errorA}. Agent B: ${errorB}. ` +
        'Check your API key configuration in Settings.'
      );
    }

    if (agentAFailed || agentBFailed) {
      const failedLabel = agentAFailed ? 'Agent A' : 'Agent B';
      const failedError = agentAFailed
        ? agentAResponses.find(r => r.error)?.error
        : agentBResponses.find(r => r.error)?.error;
      const msg = `${failedLabel} returned no findings due to error: ${failedError ?? 'unknown'}. Results are based on single-agent analysis.`;
      log.warn("dual_agent_single_agent_fallback", { failedAgent: failedLabel, error: failedError });
      analysisWarnings.push({ type: 'partial_data', message: msg, severity: 'warning' });
    }

    log.info("dual_agent_complete", {
      agentAFindings: agentA.findings.length,
      agentBFindings: agentB.findings.length,
      agentAError: agentAFailed,
      agentBError: agentBFailed,
    });

    // === Phase 5: Reconcile ===
    if (scanId) await startPhase(scanId, 'reconciliation');
    log.info("reconciliation_started");
    const tribunalReport = buildTribunalReport(deterministicResult, agentA, agentB, files);
    log.info("reconciliation_complete", { score: tribunalReport.finalScore, grade: tribunalReport.grade, findings: tribunalReport.findings.length });
    if (scanId) await endPhase(scanId, 'reconciliation', { meta: { score: tribunalReport.finalScore, grade: tribunalReport.grade, findingCount: tribunalReport.findings.length } });

    // Construct AnalysisResult from TribunalReport
    analysis = {
      seniorityScore: tribunalReport.finalScore,
      summary: `Dual-agent analysis complete. ${tribunalReport.findings.length} findings with ${tribunalReport.agreementRate}% agent agreement.`,
      redFlags: tribunalReport.findings
        .filter(f => f.severity === 'high' || f.severity === 'critical')
        .map(f => ({ 
            file: f.citation.file, 
            issue: f.message, 
            severity: f.severity,
            line: f.citation.line,
            snippet: f.citation.snippet,
            fix: f.fix
        })),
      greenFlags: tribunalReport.positives.map(p => ({
        file: p.citation?.file || 'N/A',
        point: p.description,
      })),
      securityBreaches: tribunalReport.findings
        .filter(f => f.category === 'secrets' || f.category === 'injection')
        .map(f => ({ file: f.citation.file, issue: f.message, type: f.category })),
      ideSuggestions: {
        cliRemediation: '',
        refactorDrafts: [],
      },
      tribunalReport,
      // Career packet will be added below
      promptVersions: {
        security: SECURITY_PROMPT_VERSION,
        career: includeCareerAnalysis ? CAREER_PROMPT_VERSION : undefined,
      },
      analysisWarnings: analysisWarnings.length > 0 ? analysisWarnings : undefined,
    };

  } else {
    // === RESCAN MODE OR SCOUT TIER (Single Agent) ===
    // RescanMode: lighter pass on parent-issue file paths only (ISS-009)
    // Scout tier: standard single-agent analysis
    if (isRescanMode) {
      log.info("single_agent_started_rescan", { fileCount: deepScanCandidates.length });
    } else {
      log.info("single_agent_started_scout", { fileCount: deepScanCandidates.length });
    }

    const securitySystemPrompt = getSecurityPrompt('scout');

    // Use TRIAGED candidates for the prompt context to save tokens/noise
    // But include checks for node_modules/git just in case triage didn't catch them (though checking deepScanCandidates is safer)
    const filesContext = deepScanCandidates
        .filter(f => !f.path.includes('node_modules') && !f.path.includes('.git'))
        .map(f => `=== FILE: ${f.path} ===\n\`\`\`${f.path.split('.').pop() || 'txt'}\n${f.content.substring(0, 8000)}\n\`\`\``)
        .join("\n\n");

    const rescanPreamble = isRescanMode
      ? `\nNOTE: This is a TARGETED RESCAN. Only the files listed below were flagged with issues in a previous scan. Your task is to determine whether those issues are still present, partially fixed, or fully resolved. Focus only on the provided file paths.\n`
      : '';

    const prompt = `${securitySystemPrompt}${rescanPreamble}

Analyze the following ${isRescanMode ? `${deepScanCandidates.length} files from parent scan issues` : `codebase (${deepScanCandidates.length} relevant files selected from ${files.length} total)`}:

${filesContext}

IMPORTANT — Return your analysis as STRICT JSON with this structure:
{
  "seniorityScore": number,
  "summary": "string",
  "redFlags": [{
    "file": "string - exact file path from FILE headers above",
    "category": "Security|Performance|Architecture|Code Quality|Best Practices",
    "issue": "string",
    "severity": "low|medium|high|critical",
    "snippet": "exact code snippet VERBATIM from file",
    "line": number,
    "fix": "suggested fix (optional)"
  }],
  "greenFlags": [{"file": "string", "point": "string"}],
  "securityBreaches": [{"file": "string", "issue": "string", "type": "string"}],
  "ideSuggestions": {
    "cliRemediation": "string",
    "refactorDrafts": [{"file": "string", "code": "string", "explanation": "string"}]
  }
}`;

    log.debug("single_agent_prompt_ready", { promptChars: securitySystemPrompt.length });
    if (scanId) await startPhase(scanId, 'single_agent', { model: modelName });

    const buildScoutFallback = (
      warningType: 'scout_parse_failure' | 'partial_data',
      warningMessage: string
    ): AnalysisResult => {
      // Re-use determinstic result calculated in Phase 3
      const tribunalReport = buildTribunalReport(
        deterministicResult, // Use the global deterministic result
        { findings: [], positives: [], analysisTimeMs: 0, model: 'fallback-deterministic' },
        { findings: [], positives: [], analysisTimeMs: 0, model: 'none' },
        files
      );

      return {
        seniorityScore: tribunalReport.finalScore,
        summary: `${warningMessage} ${deterministicResult.findings.length} finding(s) detected by deterministic scanning.`,
        redFlags: deterministicResult.findings.map(f => ({
          file: f.citation.file,
          issue: f.message,
          severity: f.severity,
          line: f.citation.line,
          snippet: f.citation.snippet,
          fix: f.fix,
        })),
        greenFlags: [],
        securityBreaches: deterministicResult.findings
          .filter(f => f.category === 'secrets' || f.category === 'injection')
          .map(f => ({ file: f.citation.file, issue: f.message, type: f.category })),
        ideSuggestions: { cliRemediation: '', refactorDrafts: [] },
        tribunalReport,
        promptVersions: {
          security: SECURITY_PROMPT_VERSION,
          career: includeCareerAnalysis ? CAREER_PROMPT_VERSION : undefined,
        },
        analysisWarnings: [{
          type: warningType,
          message: warningMessage,
          severity: 'warning',
        }],
      };
    };

    let rawResponse: string | null = null;
    try {
      rawResponse = await callGemini({
        model: modelName,
        prompt,
        responseMimeType: 'application/json',
      });
    } catch (modelErr) {
      log.error("single_agent_model_failed", modelErr instanceof Error ? modelErr : new Error(String(modelErr)), "ANALYZE_002");
      if (scanId) await endPhase(scanId, 'single_agent', { status: 'failed', error: 'Model call failed' });
      analysis = buildScoutFallback(
        'partial_data',
        'AI analysis request failed. Using deterministic scanning only.'
      );
    }

    if (rawResponse !== null) {
      try {
        const parsedAnalysis = extractAndParseJSON<{
          seniorityScore: number;
          summary: string;
          redFlags?: Array<{
            file: string;
            category?: string;
            issue: string;
            severity?: string;
            snippet?: string;
            line?: number;
            fix?: string;
          }>;
          greenFlags?: Array<{ file: string; point: string }>;
          securityBreaches?: Array<{ file: string; issue: string; type: string }>;
          ideSuggestions?: {
            cliRemediation: string;
            refactorDrafts: Array<{ file: string; code: string; explanation: string }>;
          };
        }>(rawResponse);
        if (!parsedAnalysis) throw new Error('extractAndParseJSON returned null');

        // Generate TribunalReport (Merged AI + Deterministic) for Scout
        // deterministicResult already computed in Phase 3
        
        // Map Gemini analysis to AgentResponse form
        const agentFindings: AgentFinding[] = (parsedAnalysis.redFlags || []).map((flag) => ({
          category: flag.category || 'Code Quality',
          severity: (flag.severity || 'medium').toLowerCase() as Severity,
          message: flag.issue,
          fix: flag.fix,
          citation: {
            file: flag.file,
            line: flag.line || 1,
            snippet: flag.snippet || ''
          },
          penalty: flag.severity === 'critical' ? 20 : flag.severity === 'high' ? 10 : 5
        }));

        const agentResponse: AgentResponse = {
          findings: agentFindings,
          positives: (parsedAnalysis.greenFlags || []).map(p => ({
            category: 'Code Quality',
            description: p.point,
            citation: { file: p.file, line: 1, snippet: '', verified: false }
          })),
          analysisTimeMs: 2000, 
          model: process.env.GEMINI_MODEL || 'gemini-1.5-flash'
        };

        const tribunalReport = buildTribunalReport(
          deterministicResult,
          agentResponse,
          { findings: [], positives: [], analysisTimeMs: 0, model: 'none' },
          files
        );

        log.info("single_agent_tribunal_complete", { score: tribunalReport.finalScore, grade: tribunalReport.grade });
        if (scanId) await endPhase(scanId, 'single_agent', { meta: { model: modelName, score: parsedAnalysis.seniorityScore } });

        analysis = {
            seniorityScore: parsedAnalysis.seniorityScore,
            summary: parsedAnalysis.summary,
            redFlags: (parsedAnalysis.redFlags || []).map(f => ({
                ...f,
                severity: (f.severity?.toLowerCase() || 'medium') as Severity
            })),
            greenFlags: parsedAnalysis.greenFlags || [],
            securityBreaches: parsedAnalysis.securityBreaches || [],
            ideSuggestions: parsedAnalysis.ideSuggestions || {
                cliRemediation: "",
                refactorDrafts: []
            },
            tribunalReport,
            // Career packet will be added below
            promptVersions: {
                security: SECURITY_PROMPT_VERSION,
                career: includeCareerAnalysis ? CAREER_PROMPT_VERSION : undefined,
            },
        };

      } catch (parseErr) {
        log.error("single_agent_parse_failed", parseErr instanceof Error ? parseErr : new Error(String(parseErr)), "ANALYZE_003");
        log.warn("single_agent_malformed_output", { preview: rawResponse.substring(0, 500) });
        if (scanId) await endPhase(scanId, 'single_agent', { status: 'failed', error: 'JSON parse failed' });
        analysis = buildScoutFallback(
          'scout_parse_failure',
          'AI analysis produced malformed JSON. Using deterministic scanning only.'
        );
      }
    }
  }

    if (!analysis) {
      throw new Error('Analysis result unavailable after scout processing');
    }

    // === Phase 6: Career Analysis & Report ===
    // 3. Career Track Analysis (Phase 28)
    // Budget check: only run career analysis if we have enough time remaining
    const elapsedBeforeCareer = Date.now() - startTime;
    const CAREER_BUDGET_MS = 75_000; // Need at least 75s for career analysis (Gemini 45s + Claude 60s, parallel-ish)
    const remainingBudgetMs = MAX_SCAN_DURATION_MS - elapsedBeforeCareer;
    const canRunCareer = remainingBudgetMs >= CAREER_BUDGET_MS;

    let careerPacket: CareerPacket | undefined;
    if (includeCareerAnalysis && canRunCareer) {
      if (scanId) await startPhase(scanId, 'career');
      log.info("career_analysis_started", { elapsedMs: elapsedBeforeCareer, remainingMs: remainingBudgetMs });
      try {
        careerPacket = await analyzeForCareer(deepScanCandidates, { // Use triaged files for career too!
          tier,
          contributionScope: 'solo_founder',
        });
        log.info("career_analysis_complete", { tierFit: careerPacket.companyTierFit?.recommendedTier ?? 'unknown' });
        if (scanId) await endPhase(scanId, 'career', { meta: { tierFit: careerPacket.companyTierFit?.recommendedTier ?? 'unknown' } });
      } catch (careerErr) {
        log.warn("career_analysis_failed", careerErr instanceof Error ? careerErr : { error: String(careerErr) });
        if (scanId) await endPhase(scanId, 'career', { status: 'failed', error: careerErr instanceof Error ? careerErr.message : String(careerErr) });

        // Phase 16: Surface warning to UI
        if (!analysis.analysisWarnings) {
            analysis.analysisWarnings = [];
        }
        analysis.analysisWarnings.push({
            type: 'career_analysis_failed',
            message: careerErr instanceof Error ? careerErr.message : 'Unknown career analysis error',
            severity: 'warning'
        });
      }
    } else if (includeCareerAnalysis && !canRunCareer) {
      log.warn("career_analysis_skipped_budget", { elapsedMs: elapsedBeforeCareer, remainingMs: remainingBudgetMs, requiredMs: CAREER_BUDGET_MS });
      if (scanId) await endPhase(scanId, 'career', { status: 'skipped', meta: { reason: 'time_budget_exceeded' } });
      if (!analysis.analysisWarnings) {
        analysis.analysisWarnings = [];
      }
      analysis.analysisWarnings.push({
        type: 'career_analysis_failed',
        message: 'Career analysis skipped to stay within scan time budget. Security analysis is complete.',
        severity: 'warning',
      });
    }

    // Assign career packet to analysis result
    analysis.careerPacket = careerPacket;

    // 4. Save to Database (Persistent Record)
    // Build prompt version string for reproducibility
    const promptVersionString = `security:${SECURITY_PROMPT_VERSION}${includeCareerAnalysis ? `,career:${CAREER_PROMPT_VERSION}` : ''}`;

    // 6. Save to Database (Persistent Record)
    await prisma.repoAnalysis.create({
      data: {
        repoId,
        modelUsed: process.env.GEMINI_MODEL || "gemini-1.5-flash",
        seniorityScore: analysis.seniorityScore,
        summary: analysis.summary,
        redFlags: analysis.redFlags as unknown as Prisma.InputJsonValue,
        greenFlags: analysis.greenFlags as unknown as Prisma.InputJsonValue,
        securityBreaches: analysis.securityBreaches as unknown as Prisma.InputJsonValue,
        ideSuggestions: analysis.ideSuggestions as unknown as Prisma.InputJsonValue,
        careerPacket: careerPacket as unknown as Prisma.InputJsonValue,
        promptVersion: promptVersionString,
      },
    });

    const durationMs = Date.now() - startTime;
    log.info("analyzer_run_complete", {
      durationMs,
      score: analysis.seniorityScore,
      findings: analysis.redFlags.length,
    });

    return analysis;
  }
