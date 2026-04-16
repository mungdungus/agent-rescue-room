/**
 * Phase 22: Verification Engine
 * 
 * Orchestrates dual-agent analysis and citation verification.
 * Ensures AI findings are grounded in actual code to prevent hallucinations.
 */

import { createLogger } from '@/lib/logger';
import { recordModelCall } from '@/lib/metrics';

const verifyLog = createLogger('VERIFICATION');
const agentLog = createLogger('AGENT');
const tribunalLog = createLogger('TRIBUNAL');
const rescanLog = createLogger('RESCAN');

import type {
  Citation,
  AgentFinding,
  AgentResponse,
  TribunalConfig,
  TribunalTier,
  CoverageMatrixEntry,
  StackProfileEntry,
  TalkingPointScript,
  CareerHiringPacket,
} from '@/types/tribunal';
import type { RepoFile } from '@/services/github/scraper';
import { DEFAULT_TRIBUNAL_CONFIG } from '@/types/tribunal';
import { callGemini, callClaude, callWithBYOK, extractAndParseJSON } from '@/lib/ai-clients';
import { getCareerPrompt, getCareerPromptV2, getSecurityPrompt, getSecurityPromptV2 } from '@/prompts';

// ============================================================================
// CITATION VERIFICATION
// ============================================================================

/**
 * Verifies that a citation actually exists in the codebase.
 * Returns false if the file doesn't exist or snippet not found (hallucination).
 */
export function verifyCitation(citation: Citation, files: RepoFile[]): boolean {
  // Find the file (match by path ending to handle relative vs absolute)
  const file = files.find(f => 
    f.path.endsWith(citation.file) || 
    citation.file.endsWith(f.path) ||
    f.path === citation.file
  );
  
  if (!file) {
    verifyLog.warn(`File not found: ${citation.file}`);
    return false;  // File doesn't exist = hallucination
  }
  
  // If line number specified, check that specific line
  if (citation.line !== undefined && citation.line > 0) {
    const lines = file.content.split('\n');
    const targetLine = lines[citation.line - 1];  // 1-indexed to 0-indexed
    
    if (!targetLine) {
      verifyLog.warn(`Line ${citation.line} doesn't exist in ${citation.file}`);
      return false;  // Line doesn't exist
    }
    
    // Check if the snippet is in that line (fuzzy match - trim whitespace)
    const normalizedSnippet = citation.snippet.trim();
    const normalizedLine = targetLine.trim();
    
    if (normalizedLine.includes(normalizedSnippet) || 
        normalizedSnippet.includes(normalizedLine)) {
      return true;
    }
    
    // Check ±2 lines for slight line number drift
    for (let offset = -2; offset <= 2; offset++) {
      if (offset === 0) continue;
      const nearbyLine = lines[citation.line - 1 + offset];
      if (nearbyLine && nearbyLine.includes(normalizedSnippet)) {
        verifyLog.info(`Found snippet at line ${citation.line + offset} instead of ${citation.line}`);
        return true;
      }
    }
    
    verifyLog.warn(`Snippet not found at line ${citation.line}: "${citation.snippet}"`);
    return false;
  }
  
  // File-level citation - check if snippet exists anywhere in file
  if (file.content.includes(citation.snippet)) {
    return true;
  }
  
  // Try normalized comparison (remove extra whitespace)
  const normalizedContent = file.content.replace(/\s+/g, ' ');
  const normalizedSnippet = citation.snippet.replace(/\s+/g, ' ').trim();
  
  if (normalizedContent.includes(normalizedSnippet)) {
    return true;
  }
  
  verifyLog.warn(`Snippet not found in ${citation.file}: "${citation.snippet.substring(0, 50)}..."`);
  return false;
}

/**
 * Verifies all citations in an agent response.
 * Returns the response with verified flags set.
 */
export function verifyAgentCitations(
  response: AgentResponse, 
  files: RepoFile[]
): AgentResponse {
  const verifiedFindings = response.findings.map(finding => ({
    ...finding,
    citation: {
      ...finding.citation,
      verified: verifyCitation(
        { ...finding.citation, verified: false },
        files
      ),
    },
  }));
  
  return {
    ...response,
    findings: verifiedFindings,
  };
}

// ============================================================================
// AGENT PROMPTS
// ============================================================================

/**
 * JSON output instructions appended to the full security prompt.
 * The full prompt comes from src/prompts/security-v1.ts via getSecurityPrompt().
 * This suffix ensures the model returns structured JSON we can parse.
 */
const SECURITY_JSON_SUFFIX = `

IMPORTANT — OUTPUT FORMAT OVERRIDE:
In addition to the analysis above, you MUST return a JSON block at the END of your response.
The JSON MUST be fenced in triple backticks with the "json" language tag.

The JSON structure MUST be:
{
  "findings": [
    {
      "category": "string - e.g., 'secrets', 'injection', 'authentication', 'authorization', 'cryptography', 'configuration', 'dependencies', 'data-exposure', 'business-logic', 'infrastructure', 'supply-chain'",
      "severity": "critical | high | medium | low",
      "message": "string - clear description of the issue",
      "fix": "string - how to fix it",
      "citation": {
        "file": "string - exact file path as shown in the FILES section",
        "line": number,
        "snippet": "string - the problematic code, EXACTLY as it appears in the file"
      },
      "penalty": number
    }
  ],
  "positives": [
    {
      "category": "string",
      "description": "string - what good practice was found"
    }
  ]
}

CITATION RULES (non-negotiable):
- Every finding MUST include a citation with the exact file path, line number, and code snippet
- The "file" field must match the exact path shown in the === FILE: ... === headers
- The "snippet" field must be copied VERBATIM from the file — do not paraphrase
- If you cannot cite exact code, DO NOT report the finding
- penalty values: critical=25, high=15, medium=10, low=5
`;

interface PromptRepoContext {
  owner: string;
  repo: string;
  fileList: string[];
}

interface SelectedPrompts {
  security: string;
  career: string;
  version: 'v1' | 'v2';
}

function buildPromptRepoContext(files: RepoFile[]): PromptRepoContext {
  return {
    owner: 'unknown',
    repo: 'unknown',
    fileList: files.map(file => file.path),
  };
}

/**
 * Prompt selection by tier:
 * - Scout: v1 prompts
 * - Pro/LTD: v2 prompts
 */
function selectPrompts(
  tier: TribunalTier,
  repoContext: PromptRepoContext
): SelectedPrompts {
  if (tier === 'scout') {
    return {
      security: getSecurityPrompt('scout') + SECURITY_JSON_SUFFIX,
      career: getCareerPrompt('scout'),
      version: 'v1',
    };
  }

  return {
    security: getSecurityPromptV2(repoContext),
    career: getCareerPromptV2(repoContext),
    version: 'v2',
  };
}

// ============================================================================
// DUAL AGENT ORCHESTRATION
// ============================================================================



/**
 * Format files for AI analysis with size limits.
 * Prioritizes security-relevant files (configs, routes, auth, env).
 */
function formatFilesForAnalysis(files: RepoFile[]): string {
  const MAX_TOTAL_CHARS = 120000;  // ~30K tokens — enough for thorough analysis
  const MAX_PER_FILE = 15000;      // ~3.7K tokens per file
  let totalChars = 0;

  // Prioritize security-relevant files
  const priorityPatterns = [
    /\.env/, /config/, /auth/, /middleware/, /route/, /api\//,
    /prisma/, /schema/, /docker/, /\.ya?ml$/, /package\.json/,
    /lockfile|lock\.json/, /secret/, /crypto/, /token/,
  ];

  const sortedFiles = [...files]
    .filter(f => !f.path.includes('node_modules') && !f.path.includes('.git'))
    .sort((a, b) => {
      const aPriority = priorityPatterns.some(p => p.test(a.path)) ? 0 : 1;
      const bPriority = priorityPatterns.some(p => p.test(b.path)) ? 0 : 1;
      return aPriority - bPriority;
    });

  const formatted = sortedFiles
    .map(f => {
      const content = f.content.slice(0, MAX_PER_FILE);
      if (totalChars + content.length > MAX_TOTAL_CHARS) return null;
      totalChars += content.length;

      const ext = f.path.split('.').pop() || 'txt';
      return `=== FILE: ${f.path} ===\n\`\`\`${ext}\n${content}\n\`\`\``;
    })
    .filter(Boolean)
    .join('\n\n');

  if (totalChars >= MAX_TOTAL_CHARS) {
    agentLog.warn(`Truncated files to ${MAX_TOTAL_CHARS} chars for analysis`);
  }

  return `Analyze the following codebase (${files.length} files, ${totalChars} chars provided):\n\n${formatted}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return undefined;
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  return undefined;
}

interface NormalizeFindingsOptions {
  enforceSharedContract?: boolean;
}

interface NormalizeFindingsResult {
  findings: AgentFinding[];
  droppedInvalidCount: number;
  missingContractCount: number;
  missingContractFields: string[];
}

function normalizeFindings(
  rawFindings: unknown,
  options?: NormalizeFindingsOptions
): NormalizeFindingsResult {
  if (!Array.isArray(rawFindings)) {
    return {
      findings: [],
      droppedInvalidCount: 0,
      missingContractCount: 0,
      missingContractFields: [],
    };
  }

  const allowedSeverity = new Set(['critical', 'high', 'medium', 'low']);
  const allowedEvidenceStatus = new Set(['verified', 'partial', 'inference']);
  const allowedConfidence = new Set(['high', 'medium', 'low']);
  const allowedClaimType = new Set(['observed', 'inferred', 'suggested', 'unknown']);
  const missingContractFields = new Set<string>();
  let droppedInvalidCount = 0;
  let missingContractCount = 0;

  const findings = rawFindings
    .map(item => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item): AgentFinding | null => {
      const citation = asRecord(item.citation);
      const file = toOptionalString(citation?.file);
      const snippet = toOptionalString(citation?.snippet);
      const category = toOptionalString(item.category);
      const severity = toOptionalString(item.severity);
      const message = toOptionalString(item.message);
      const confidence = toOptionalString(item.confidence);
      const confidenceNormalized = allowedConfidence.has(String(confidence))
        ? (confidence as AgentFinding['confidence'])
        : undefined;
      const evidenceStatus = allowedEvidenceStatus.has(String(item.evidence_status))
        ? (item.evidence_status as AgentFinding['evidence_status'])
        : undefined;
      const claimType = allowedClaimType.has(String(item.claim_type))
        ? (item.claim_type as AgentFinding['claim_type'])
        : undefined;
      const confidenceCaveat = toOptionalString(item.confidence_caveat);
      const missingInputs = Array.isArray(item.missing_inputs)
        ? item.missing_inputs.filter((missing): missing is string => typeof missing === 'string')
        : undefined;

      if (!citation || !file || !snippet || !category || !severity || !message || !allowedSeverity.has(severity)) {
        droppedInvalidCount += 1;
        return null;
      }

      if (options?.enforceSharedContract) {
        const missingFields: string[] = [];
        if (!evidenceStatus) missingFields.push('evidence_status');
        if (!confidenceNormalized) missingFields.push('confidence');
        if (!claimType) missingFields.push('claim_type');
        if (
          (confidenceNormalized === 'medium' || confidenceNormalized === 'low') &&
          !confidenceCaveat
        ) {
          missingFields.push('confidence_caveat');
        }

        if (missingFields.length > 0) {
          missingContractCount += 1;
          for (const field of missingFields) {
            missingContractFields.add(field);
          }
        }
      }

      return {
        category,
        severity: severity as AgentFinding['severity'],
        message,
        fix: toOptionalString(item.fix),
        citation: {
          file,
          line: toOptionalNumber(citation.line),
          snippet,
        },
        penalty: typeof item.penalty === 'number' ? item.penalty : severity === 'critical' ? 25 : severity === 'high' ? 15 : severity === 'medium' ? 10 : 5,
        confidence: confidenceNormalized,
        evidence_status: evidenceStatus,
        claim_type: claimType,
        confidence_caveat: confidenceCaveat,
        missing_inputs: missingInputs,
        root_cause: toOptionalString(item.root_cause),
        impacted_surfaces: Array.isArray(item.impacted_surfaces)
          ? item.impacted_surfaces.filter((surface): surface is string => typeof surface === 'string')
          : undefined,
        verify_steps: Array.isArray(item.verify_steps)
          ? item.verify_steps.filter((step): step is string => typeof step === 'string')
          : undefined,
        scoring_category: toOptionalString(item.scoring_category),
      };
    })
    .filter((item): item is AgentFinding => item !== null);

  return {
    findings,
    droppedInvalidCount,
    missingContractCount,
    missingContractFields: Array.from(missingContractFields),
  };
}

function normalizePositives(rawPositives: unknown): AgentResponse['positives'] {
  if (!Array.isArray(rawPositives)) return [];

  return rawPositives
    .map(item => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map(item => {
      const citation = asRecord(item.citation);
      return {
        category: toOptionalString(item.category) || 'General',
        description: toOptionalString(item.description) || 'Positive signal detected',
        citation: citation && typeof citation.file === 'string' && typeof citation.snippet === 'string'
          ? {
              file: citation.file,
              line: toOptionalNumber(citation.line),
              snippet: citation.snippet,
              verified: false,
            }
          : undefined,
        interview_ammunition: toOptionalString(item.interview_ammunition),
      };
    });
}

function normalizeCoverageMatrix(rawCoverage: unknown): CoverageMatrixEntry[] | undefined {
  if (!Array.isArray(rawCoverage)) return undefined;

  const allowedStatus = new Set(['Reviewed', 'Partial', 'Not Present', 'Cannot Assess']);
  const allowedRisk = new Set(['critical', 'high', 'medium', 'low']);

  return rawCoverage
    .map(item => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item): CoverageMatrixEntry | null => {
      const domain = toOptionalString(item.domain);
      const status = toOptionalString(item.status);
      const residualRisk = toOptionalString(item.residual_risk);
      if (!domain || !status || !residualRisk || !allowedStatus.has(status) || !allowedRisk.has(residualRisk)) {
        return null;
      }

      return {
        domain,
        status: status as CoverageMatrixEntry['status'],
        evidence: Array.isArray(item.evidence) ? item.evidence.filter((entry): entry is string => typeof entry === 'string') : [],
        gaps: Array.isArray(item.gaps) ? item.gaps.filter((entry): entry is string => typeof entry === 'string') : [],
        residualRisk: residualRisk as CoverageMatrixEntry['residualRisk'],
      };
    })
    .filter((item): item is CoverageMatrixEntry => item !== null);
}

function normalizeStackProfile(rawStackProfile: unknown): StackProfileEntry[] | undefined {
  if (!Array.isArray(rawStackProfile)) return undefined;

  const allowedLayers = new Set([
    'frontend',
    'backend',
    'database',
    'infrastructure',
    'auth',
    'testing',
    'observability',
    'ai',
  ]);

  return rawStackProfile
    .map(item => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item): StackProfileEntry | null => {
      const name = toOptionalString(item.name);
      const layer = toOptionalString(item.layer);
      if (!name || !layer || !allowedLayers.has(layer)) {
        return null;
      }

      return {
        name,
        layer: layer as StackProfileEntry['layer'],
        integrationDepth: toOptionalString(item.integration_depth) ?? toOptionalString(item.integrationDepth),
        detectedVia: toOptionalString(item.detected_via) ?? toOptionalString(item.detectedVia) ?? 'agent output',
      };
    })
    .filter((item): item is StackProfileEntry => item !== null);
}

function normalizeTalkingPoints(rawTalkingPoints: unknown): TalkingPointScript[] | undefined {
  if (!Array.isArray(rawTalkingPoints)) return undefined;

  return rawTalkingPoints
    .map(item => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item, index): TalkingPointScript => ({
      id: toOptionalString(item.id) ?? `agent-script-${index + 1}`,
      category: toOptionalString(item.category) ?? 'General',
      title: toOptionalString(item.title) ?? 'Interview Script',
      context: toOptionalString(item.context) ?? '',
      script: toOptionalString(item.script) ?? '',
      relatedFindingIds: Array.isArray(item.relatedFindingIds)
        ? item.relatedFindingIds.filter((id): id is string => typeof id === 'string')
        : Array.isArray(item.related_finding_ids)
          ? item.related_finding_ids.filter((id): id is string => typeof id === 'string')
          : undefined,
      isDefenseScript: typeof item.is_defense_script === 'boolean'
        ? item.is_defense_script
        : typeof item.isDefenseScript === 'boolean'
          ? item.isDefenseScript
          : undefined,
    }))
    .filter(script => script.script.length > 0);
}

/**
 * Calls a single AI agent for security analysis.
 * Supports Google (Gemini) and Anthropic (Claude) providers.
 */
export async function callAgent(
  config: { provider: string; model: string; apiKey?: string },
  files: RepoFile[],
  systemPrompt: string,
  expectedPromptVersion: 'v1' | 'v2' = 'v1',
  userId?: string
): Promise<AgentResponse> {
  const startTime = Date.now();
  const modelId = `${config.provider}/${config.model}`;

  // Build code context with size limits
  const codeContext = formatFilesForAnalysis(files);

  agentLog.info(`Calling ${modelId} with ${files.length} files...`);

  try {
    let rawResponse: string;

    const aiParams = {
      model: config.model,
      prompt: codeContext,
      systemPrompt,
      temperature: 0.2,
      maxTokens: 8192,
      timeoutMs: 120_000,
      ...(config.provider === 'google' && { responseMimeType: 'application/json' as const }),
    };

    if (userId) {
      // Phase 12: Route through BYOK wrapper (resolves user key → platform fallback)
      rawResponse = await callWithBYOK({ userId, ...aiParams });
    } else if (config.provider === 'google') {
      rawResponse = await callGemini(aiParams);
    } else if (config.provider === 'anthropic') {
      rawResponse = await callClaude(aiParams);
    } else {
      throw new Error(`Unsupported AI provider: ${config.provider}`);
    }
    
    // Parse JSON response with robust extraction
    const parsed = extractAndParseJSON<Record<string, unknown>>(rawResponse);
    
    const analysisTimeMs = Date.now() - startTime;
    agentLog.info(`${modelId} completed in ${analysisTimeMs}ms`);

    // Estimate token usage from response size (approximate: 1 token ≈ 4 chars)
    const estimatedTokens = Math.round(rawResponse.length / 4);
    recordModelCall(modelId, analysisTimeMs, estimatedTokens, { model: modelId });

    if (!parsed) {
      agentLog.warn(`${modelId} returned non-JSON response, treating as no findings`);
      return {
        findings: [],
        positives: [],
        analysisTimeMs,
        model: modelId,
      };
    }

    const normalizedFindings = normalizeFindings(parsed.findings, {
      enforceSharedContract: expectedPromptVersion === 'v2',
    });
    const findings = normalizedFindings.findings;
    const positives = normalizePositives(parsed.positives);
    const coverageMatrix = normalizeCoverageMatrix(parsed.coverage_matrix);
    const stackProfile = normalizeStackProfile(parsed.stack_profile);
    const talkingPoints = normalizeTalkingPoints(parsed.talking_points);
    const hiringPacket = asRecord(parsed.hiring_packet) as CareerHiringPacket | null;

    if (expectedPromptVersion === 'v2') {
      if (!coverageMatrix) {
        agentLog.warn(`${modelId} did not return coverage_matrix in v2 mode`);
      }
      if (!stackProfile) {
        agentLog.warn(`${modelId} did not return stack_profile in v2 mode`);
      }
      if (normalizedFindings.droppedInvalidCount > 0) {
        agentLog.warn(
          `${modelId} returned ${normalizedFindings.droppedInvalidCount} invalid finding(s); falling back to partial result handling`
        );
      }
      if (normalizedFindings.missingContractCount > 0) {
        agentLog.warn(
          `${modelId} returned ${normalizedFindings.missingContractCount} finding(s) missing shared contract fields: ${normalizedFindings.missingContractFields.join(', ')}`
        );
      }
    }

    return {
      findings,
      positives,
      coverage_matrix: coverageMatrix,
      stack_profile: stackProfile,
      talking_points: talkingPoints,
      hiring_packet: hiringPacket ?? undefined,
      analysisTimeMs,
      model: modelId,
    };
  } catch (error) {
    const analysisTimeMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    agentLog.error(`${modelId} failed after ${analysisTimeMs}ms:`, errorMessage);
    // Emit latency even on failure so P99 includes failed calls
    recordModelCall(modelId, analysisTimeMs, 0, { model: modelId });

    return {
      findings: [],
      positives: [],
      analysisTimeMs,
      model: modelId,
      error: errorMessage,
    };
  }
}


/**
 * Runs dual-agent analysis in parallel.
 * Both agents analyze the same code independently.
 */
export async function runDualAgentAnalysis(
  files: RepoFile[],
  config: TribunalConfig = DEFAULT_TRIBUNAL_CONFIG,
  tier: TribunalTier = 'pro',
  userId?: string
): Promise<{ agentA: AgentResponse; agentB: AgentResponse }> {
  tribunalLog.info('Starting dual-agent analysis...');
  tribunalLog.info(`Agent A: ${config.agentA.provider}/${config.agentA.model}`);
  tribunalLog.info(`Agent B: ${config.agentB.provider}/${config.agentB.model}`);

  const repoContext = buildPromptRepoContext(files);
  const selectedPrompts = selectPrompts(tier, repoContext);
  const fullPrompt = `${selectedPrompts.security}\n\nSupplemental career signal extraction (same evidence rules):\n${selectedPrompts.career}`;
  tribunalLog.info(`Using ${selectedPrompts.version} prompt suite (${fullPrompt.length} chars)`);

  // Run both agents in parallel with the comprehensive prompt
  const [agentAResponse, agentBResponse] = await Promise.all([
    callAgent(config.agentA, files, fullPrompt, selectedPrompts.version, userId),
    callAgent(config.agentB, files, fullPrompt, selectedPrompts.version, userId),
  ]);
  
  // Verify citations for both responses
  const verifiedA = verifyAgentCitations(agentAResponse, files);
  const verifiedB = verifyAgentCitations(agentBResponse, files);
  
  tribunalLog.info(`Agent A found ${verifiedA.findings.length} issues`);
  tribunalLog.info(`Agent B found ${verifiedB.findings.length} issues`);
  
  return {
    agentA: verifiedA,
    agentB: verifiedB,
  };
}

// ============================================================================
// FINDING MATCHING
// ============================================================================

/**
 * Attempts to match a finding from Agent A with one from Agent B.
 * Uses file + category + severity similarity.
 */
export function findMatchingFinding(
  finding: AgentFinding,
  candidates: AgentFinding[]
): AgentFinding | null {
  // Exact match on file + category + similar line
  const exactMatch = candidates.find(c => 
    c.citation.file === finding.citation.file &&
    c.category === finding.category &&
    c.severity === finding.severity &&
    (c.citation.line === finding.citation.line || 
     Math.abs((c.citation.line || 0) - (finding.citation.line || 0)) <= 5)
  );
  
  if (exactMatch) return exactMatch;
  
  // Fuzzy match on file + category (different severity OK)
  const fuzzyMatch = candidates.find(c =>
    c.citation.file === finding.citation.file &&
    c.category === finding.category &&
    (c.citation.line === finding.citation.line ||
     Math.abs((c.citation.line || 0) - (finding.citation.line || 0)) <= 10)
  );
  
  return fuzzyMatch || null;
}

// ============================================================================
// FINDING STATUS VERIFICATION (Phase 26: Re-Run Feature)
// ============================================================================

import type { TribunalFinding } from '@/types/tribunal';
import { parseGitHubUrl, fetchRepoContents } from '@/services/github/scraper';
import { ephemeralStorage } from '@/lib/redis';

/** Status of a finding after re-verification */
export interface FindingStatus {
  findingId: string;
  category: string;
  severity: string;
  originalMessage: string;
  file: string;
  line?: number;
  status: 'fixed' | 'remaining' | 'partially_fixed';
  statusReason: string;
}

export interface VerifyFindingOptions {
  finding: TribunalFinding;
  repoUrl: string;
  personalAccessToken?: string;
}

/**
 * Verify whether a specific finding from a previous scan still exists.
 * Token-efficient: only fetches and checks the specific file mentioned.
 */
export async function verifyFindingStatus(
  options: VerifyFindingOptions
): Promise<FindingStatus> {
  const { finding, repoUrl, personalAccessToken } = options;

  const baseStatus: FindingStatus = {
    findingId: finding.id,
    category: finding.category,
    severity: finding.severity,
    originalMessage: finding.message,
    file: finding.citation.file,
    line: finding.citation.line,
    status: 'remaining',
    statusReason: '',
  };

  try {
    // Parse the repo URL to get owner/repo
    const parsed = parseGitHubUrl(repoUrl);
    if (!parsed) {
      throw new Error(`Invalid GitHub URL: ${repoUrl}`);
    }

    // Fetch the repo contents (returns file paths and snapshotKey)
    const { snapshotKey } = await fetchRepoContents(
      parsed.owner,
      parsed.repo,
      personalAccessToken
    );

    // Retrieve the full file contents from Redis
    const rawData = await ephemeralStorage.get(snapshotKey);
    if (!rawData || typeof rawData !== 'string') {
      throw new Error('Snapshot expired or not found');
    }
    
    const repoFiles: RepoFile[] = JSON.parse(rawData as string);

    // Find the specific file
    const file = repoFiles.find(
      (f) => 
        f.path.endsWith(finding.citation.file) || 
        finding.citation.file.endsWith(f.path)
    );

    if (!file) {
      // File was deleted - issue is "fixed" (file removed)
      return {
        ...baseStatus,
        status: 'fixed',
        statusReason: 'File removed from repository',
      };
    }

    // Check if the problematic snippet still exists
    const snippetExists = checkSnippetExists(
      file.content,
      finding.citation.snippet,
      finding.citation.line
    );

    if (!snippetExists) {
      // Snippet no longer present - issue fixed
      return {
        ...baseStatus,
        status: 'fixed',
        statusReason: 'Problematic code no longer present',
      };
    }

    // Check if there's a partial fix (e.g., wrapped in try-catch, added validation)
    const partialFix = checkForPartialFix(file.content, finding);
    if (partialFix.isPartial) {
      return {
        ...baseStatus,
        status: 'partially_fixed',
        statusReason: partialFix.reason,
      };
    }

    // Issue still present
    return {
      ...baseStatus,
      status: 'remaining',
      statusReason: 'Issue still present in codebase',
    };
  } catch (error) {
    // If we can't verify, assume remaining to be safe
    rescanLog.warn(`Could not verify finding ${finding.id}:`, error);
    return {
      ...baseStatus,
      status: 'remaining',
      statusReason: 'Could not verify (file fetch failed)',
    };
  }
}

/**
 * Check if a snippet exists at or near the expected line
 */
function checkSnippetExists(
  content: string,
  snippet: string,
  expectedLine?: number
): boolean {
  // Normalize for comparison
  const normalizedSnippet = snippet.trim().replace(/\s+/g, ' ');
  
  if (expectedLine && expectedLine > 0) {
    const lines = content.split('\n');
    
    // Check the exact line first
    const targetLine = lines[expectedLine - 1];
    if (targetLine) {
      const normalizedLine = targetLine.trim().replace(/\s+/g, ' ');
      if (normalizedLine.includes(normalizedSnippet) || 
          normalizedSnippet.includes(normalizedLine)) {
        return true;
      }
    }
    
    // Check ±5 lines for drift
    for (let offset = -5; offset <= 5; offset++) {
      if (offset === 0) continue;
      const nearbyLine = lines[expectedLine - 1 + offset];
      if (nearbyLine) {
        const normalizedNearby = nearbyLine.trim().replace(/\s+/g, ' ');
        if (normalizedNearby.includes(normalizedSnippet) ||
            normalizedSnippet.includes(normalizedNearby)) {
          return true;
        }
      }
    }
  }
  
  // Fall back to file-wide search
  const normalizedContent = content.replace(/\s+/g, ' ');
  return normalizedContent.includes(normalizedSnippet);
}

/**
 * Heuristic check for partial fixes
 */
function checkForPartialFix(
  content: string,
  finding: TribunalFinding
): { isPartial: boolean; reason: string } {
  const category = finding.category.toLowerCase();
  const lines = content.split('\n');
  const findingLine = finding.citation.line || 0;
  
  // Get surrounding context (±3 lines)
  const startLine = Math.max(0, findingLine - 4);
  const endLine = Math.min(lines.length, findingLine + 3);
  const context = lines.slice(startLine, endLine).join('\n');
  
  // Category-specific partial fix detection
  if (category === 'secrets' || category === 'credentials') {
    // Check if now using env variable pattern
    if (context.includes('process.env') || context.includes('import.meta.env')) {
      return { isPartial: true, reason: 'Potentially moved to environment variable' };
    }
  }
  
  if (category === 'injection' || category === 'xss') {
    // Check for sanitization patterns
    if (context.includes('escape') || context.includes('sanitize') || 
        context.includes('DOMPurify') || context.includes('parameterized')) {
      return { isPartial: true, reason: 'Sanitization may have been added' };
    }
  }
  
  if (category === 'authentication' || category === 'authorization') {
    // Check for auth middleware patterns
    if (context.includes('requireAuth') || context.includes('isAuthenticated') ||
        context.includes('checkPermission') || context.includes('middleware')) {
      return { isPartial: true, reason: 'Auth check may have been added' };
    }
  }
  
  if (category === 'error-handling' || category === 'configuration') {
    // Check for try-catch
    if (context.includes('try {') || context.includes('catch (')) {
      return { isPartial: true, reason: 'Error handling may have been added' };
    }
  }
  
  return { isPartial: false, reason: '' };
}
