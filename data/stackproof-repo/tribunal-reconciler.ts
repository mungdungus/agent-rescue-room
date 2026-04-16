/**
 * Phase 22 + Phase 46: Tribunal Reconciler
 *
 * Reconciles findings from AI agents and deterministic scanning into a single
 * evidence-grounded report, then applies deduction-only scoring.
 */

import type {
  TribunalFinding,
  TribunalReport,
  TribunalConfidence,
  Divergence,
  AgentFinding,
  AgentResponse,
  PositiveSignal,
  DeterministicScanResult,
  Severity,
  RepoFile,
  TalkingPointScript,
  StackProfile,
  StackProfileEntry,
  TableStakesPenaltyHit,
  CoverageMatrixEntry,
  CareerHiringPacket,
} from '@/types/tribunal';
import { findMatchingFinding } from './verification-engine';
import { verifyAllCitations, createBailiffStats } from './bailiff';
import {
  calculateTribunalScore,
  createEmptyBailiffStats,
  mapFindingToScoringCategory,
} from './tribunal-scorer';
import { nanoid } from 'nanoid';

// ============================================================================
// CONFIDENCE CALCULATION
// ============================================================================

/**
 * Calculates confidence level based on agent agreement and citation status.
 */
export function calculateConfidence(
  agentAFound: boolean,
  agentBFound: boolean,
  citationVerified: boolean
): TribunalConfidence {
  if (agentAFound && agentBFound && citationVerified) {
    return 'high';
  }

  if ((agentAFound || agentBFound) && citationVerified) {
    return 'medium';
  }

  return 'low';
}

/**
 * Calculates overall confidence for the entire report.
 */
export function calculateOverallConfidence(
  findings: TribunalFinding[]
): TribunalConfidence {
  if (findings.length === 0) return 'high';

  const highCount = findings.filter(finding => finding.confidence === 'high').length;
  const lowCount = findings.filter(finding => finding.confidence === 'low').length;

  const total = findings.length;
  const highRatio = highCount / total;
  const lowRatio = lowCount / total;

  if (highRatio >= 0.7) return 'high';
  if (lowRatio >= 0.3) return 'low';
  return 'medium';
}

// ============================================================================
// GRADE CALCULATION (legacy compatibility)
// ============================================================================

/**
 * Calculates letter grade from numeric score.
 */
export function calculateGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

// ============================================================================
// TALKING POINT SCRIPT GENERATION (Phase 46)
// ============================================================================

function severityWeight(severity: Severity): number {
  switch (severity) {
    case 'critical':
      return 4;
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'low':
      return 1;
    default:
      return 0;
  }
}

function mapInterviewCategory(finding: TribunalFinding): string {
  const scoringCategory = finding.scoring_category ?? mapFindingToScoringCategory(finding);

  switch (scoringCategory) {
    case 'Security Posture':
      return 'Security';
    case 'Testing Maturity':
      return 'Testing';
    case 'Production Readiness':
      return 'Reliability';
    case 'Code Organization':
      return 'Architecture';
    case 'Dependency Health':
      return 'Dependencies';
    case 'AI-Engineering Hygiene':
      return 'AI Workflow';
    default:
      return 'Engineering';
  }
}

function buildDefenseScript(finding: TribunalFinding, interviewCategory: string): string {
  if (interviewCategory === 'Security') {
    return `When asked about ${finding.category}, I lead with what I found: ${finding.message}.
I explain the production mitigation path in concrete steps: ${finding.fix ?? 'tighten controls at the nearest trust boundary and add automated regression checks'}.
This signals that I treat security as an engineering system, not a one-time checklist.`;
  }

  if (interviewCategory === 'Testing') {
    return `On testing maturity, I acknowledge the current gap: ${finding.message}.
I describe how I would close it with focused automated coverage and CI enforcement: ${finding.fix ?? 'prioritize deterministic coverage for the highest-risk paths'}.
That keeps quality improvements tied to delivery velocity instead of slowing product progress.`;
  }

  if (interviewCategory === 'Dependencies') {
    return `For dependency health, I treat this as operational hygiene: ${finding.message}.
The fix path is explicit and incremental: ${finding.fix ?? 'pin versions, resolve vulnerable transitive dependencies, and enforce lockfile integrity in CI'}.
Interviewers hear that I can reduce risk without destabilizing shipping cadence.`;
  }

  if (interviewCategory === 'AI Workflow') {
    return `In AI-assisted development, this finding matters because it affects trust and reproducibility: ${finding.message}.
My response is to tighten guardrails and verification loops: ${finding.fix ?? 'enforce prompt/tool boundaries and audit model-driven changes before merge'}.
That demonstrates architect-level control over AI workflows instead of blind code generation.`;
  }

  return `I frame this as an engineering maturity signal: ${finding.message}.
Then I walk through the practical remediation sequence: ${finding.fix ?? 'define ownership, add safeguards, and verify the change path in CI'}.
This shows I can convert technical debt into a concrete execution plan under interview pressure.`;
}

function mentionsAiWorkflow(text: string): boolean {
  return /(ai|llm|agent|mcp|copilot|cursor|prompt)/i.test(text);
}

/**
 * Generates structured, interview-ready scripts linked to findings.
 */
export function generateTalkingPointScripts(
  findings: TribunalFinding[],
  positives: PositiveSignal[],
  tableStakesPenalties: { name: string; category: string; message: string }[]
): TalkingPointScript[] {
  const scripts: TalkingPointScript[] = [];

  const significantFindings = [...findings]
    .filter(finding => severityWeight(finding.severity) >= severityWeight('medium'))
    .sort((left, right) => {
      const severityDelta = severityWeight(right.severity) - severityWeight(left.severity);
      if (severityDelta !== 0) return severityDelta;
      return right.penalty - left.penalty;
    });

  for (const finding of significantFindings) {
    const interviewCategory = mapInterviewCategory(finding);
    scripts.push({
      id: nanoid(),
      category: interviewCategory,
      title: finding.category,
      context: finding.message,
      script: buildDefenseScript(finding, interviewCategory),
      relatedFindingIds: [finding.id],
      isDefenseScript: true,
    });
  }

  for (const positive of positives) {
    const interviewCategory = positive.category || 'Strength';
    scripts.push({
      id: nanoid(),
      category: interviewCategory,
      title: positive.category || 'Positive Signal',
      context: positive.description,
      script: positive.interview_ammunition ??
        `When discussing ${positive.category}, I cite concrete evidence from this repository and explain the tradeoff behind the implementation. I use this signal to show practical execution maturity rather than abstract best-practice language.`,
      relatedFindingIds: [],
      isDefenseScript: false,
    });
  }

  for (const penalty of tableStakesPenalties) {
    scripts.push({
      id: nanoid(),
      category: penalty.category,
      title: `Table Stakes: ${penalty.name}`,
      context: penalty.message,
      script: `I call this out directly: ${penalty.message}. Then I explain the remediation order and why it should be baseline engineering hygiene before claiming production readiness.`,
      relatedFindingIds: [],
      isDefenseScript: true,
    });
  }

  const aiSignalPresent = findings.some(finding =>
    mentionsAiWorkflow(`${finding.category} ${finding.message} ${finding.fix ?? ''}`)
  ) || positives.some(positive => mentionsAiWorkflow(`${positive.category} ${positive.description}`));

  if (aiSignalPresent) {
    scripts.push({
      id: nanoid(),
      category: 'AI Workflow',
      title: 'AI-Assisted Development',
      context: 'Repository evidence shows AI-assisted engineering patterns.',
      script: 'I use AI as an architect-level accelerator, not a copy-paste engine. I run prompts through multiple models, compare outputs, and keep only changes I can defend with first-principles reasoning. The quality in this repository reflects deliberate engineering judgment, not unreviewed generated code.',
      relatedFindingIds: [],
      isDefenseScript: true,
    });
  }

  const deduped: TalkingPointScript[] = [];
  const seenKeys = new Set<string>();

  for (const script of scripts) {
    const key = `${script.category}::${script.title}::${script.script}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    deduped.push(script);
  }

  return deduped.slice(0, 12);
}

// ============================================================================
// STACK PROFILE ASSEMBLY (Phase 46)
// ============================================================================

function parseJson(content: string): Record<string, unknown> | null {
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeTechName(name: string): string {
  return name.replace(/@\d+\.\d+\.\d+.*$/, '').trim();
}

function buildIntegrationDepth(name: string, files: RepoFile[]): string | undefined {
  const lower = name.toLowerCase();
  const joined = files.map(file => `${file.path}\n${file.content}`).join('\n');

  if (lower.includes('stripe')) {
    const parts: string[] = [];
    if (/checkout/i.test(joined)) parts.push('checkout');
    if (/webhook/i.test(joined)) parts.push('webhooks');
    if (/subscription/i.test(joined)) parts.push('subscriptions');
    if (parts.length > 0) return parts.join(' + ');
  }

  if (lower.includes('prisma')) {
    const schema = files.find(file => file.path.endsWith('prisma/schema.prisma'));
    if (schema) {
      const modelCount = (schema.content.match(/\bmodel\s+/g) || []).length;
      if (modelCount > 0) return `ORM with ${modelCount} models`;
    }
  }

  return undefined;
}

function pushStackEntry(
  entries: StackProfileEntry[],
  seen: Set<string>,
  entry: StackProfileEntry
): void {
  const key = `${entry.layer}:${entry.name.toLowerCase()}`;
  if (seen.has(key)) return;
  seen.add(key);
  entries.push(entry);
}

/**
 * Builds a layer-organized technology profile from files and findings.
 */
export function assembleStackProfile(
  findings: TribunalFinding[],
  positives: PositiveSignal[],
  files: RepoFile[]
): StackProfile {
  const entries: StackProfileEntry[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const lowerPath = file.path.toLowerCase();

    if (lowerPath.endsWith('/tsconfig.json') || lowerPath === 'tsconfig.json') {
      pushStackEntry(entries, seen, {
        name: 'TypeScript',
        layer: 'backend',
        detectedVia: file.path,
      });
    }

    if (lowerPath.endsWith('dockerfile') || lowerPath.includes('docker-compose')) {
      pushStackEntry(entries, seen, {
        name: 'Docker',
        layer: 'infrastructure',
        detectedVia: file.path,
      });
    }

    if (lowerPath.includes('.github/workflows')) {
      pushStackEntry(entries, seen, {
        name: 'GitHub Actions',
        layer: 'infrastructure',
        detectedVia: file.path,
      });
    }

    if (lowerPath.includes('auth')) {
      pushStackEntry(entries, seen, {
        name: 'Auth Middleware',
        layer: 'auth',
        detectedVia: file.path,
      });
    }

    if (lowerPath.endsWith('package.json')) {
      const pkg = parseJson(file.content);
      if (!pkg) continue;

      const depsObject = {
        ...(typeof pkg.dependencies === 'object' && pkg.dependencies ? pkg.dependencies as Record<string, unknown> : {}),
        ...(typeof pkg.devDependencies === 'object' && pkg.devDependencies ? pkg.devDependencies as Record<string, unknown> : {}),
      };

      for (const depName of Object.keys(depsObject)) {
        const normalizedName = normalizeTechName(depName);
        const lowerDep = normalizedName.toLowerCase();

        let layer: StackProfileEntry['layer'] = 'backend';
        if (lowerDep.includes('react') || lowerDep.includes('next') || lowerDep.includes('tailwind') || lowerDep.includes('shadcn')) {
          layer = 'frontend';
        } else if (lowerDep.includes('prisma') || lowerDep.includes('postgres') || lowerDep.includes('mysql') || lowerDep.includes('drizzle') || lowerDep.includes('sequelize')) {
          layer = 'database';
        } else if (lowerDep.includes('jest') || lowerDep.includes('vitest') || lowerDep.includes('playwright') || lowerDep.includes('cypress')) {
          layer = 'testing';
        } else if (lowerDep.includes('sentry') || lowerDep.includes('opentelemetry') || lowerDep.includes('posthog')) {
          layer = 'observability';
        } else if (lowerDep.includes('auth') || lowerDep.includes('next-auth')) {
          layer = 'auth';
        } else if (lowerDep.includes('openai') || lowerDep.includes('anthropic') || lowerDep.includes('langchain') || lowerDep.includes('gemini')) {
          layer = 'ai';
        }

        pushStackEntry(entries, seen, {
          name: normalizedName,
          layer,
          detectedVia: file.path,
          integrationDepth: buildIntegrationDepth(normalizedName, files),
        });
      }
    }

    if (lowerPath.endsWith('prisma/schema.prisma')) {
      const providerMatch = file.content.match(/provider\s*=\s*"([^"]+)"/i);
      const provider = providerMatch?.[1];
      pushStackEntry(entries, seen, {
        name: provider ? provider.toUpperCase() : 'Database',
        layer: 'database',
        detectedVia: file.path,
      });
    }
  }

  // Backfill AI workflow layer from findings/positives if no package marker exists.
  const aiSignals = [
    ...findings.map(finding => `${finding.category} ${finding.message} ${finding.fix ?? ''}`),
    ...positives.map(positive => `${positive.category} ${positive.description}`),
  ];

  if (aiSignals.some(text => mentionsAiWorkflow(text))) {
    pushStackEntry(entries, seen, {
      name: 'AI Workflow',
      layer: 'ai',
      detectedVia: 'analysis findings',
    });
  }

  const flatList = Array.from(
    new Set(entries.map(entry => entry.name.replace(/\b\d+(?:\.\d+)*\b/g, '').trim()))
  ).sort((left, right) => left.localeCompare(right));

  return { entries, flatList };
}

// ============================================================================
// FINDING RECONCILIATION
// ============================================================================

interface MergedFinding {
  category: string;
  severity: Severity;
  message: string;
  fix?: string;
  citation: {
    file: string;
    line?: number;
    snippet: string;
    verified: boolean;
  };
  penalty: number;
  agentAFound: boolean;
  agentBFound: boolean;
  agentAMessage?: string;
  agentBMessage?: string;
  evidence_status?: TribunalFinding['evidence_status'];
  claim_type?: TribunalFinding['claim_type'];
  confidence_caveat?: string;
  missing_inputs?: string[];
  root_cause?: string;
  impacted_surfaces?: string[];
  verify_steps?: string[];
  scoring_category?: string;
}

/**
 * Reconciles findings from both agents.
 */
export function reconcileFindings(
  agentAFindings: AgentFinding[],
  agentBFindings: AgentFinding[]
): { merged: MergedFinding[]; divergences: Divergence[] } {
  const merged: MergedFinding[] = [];
  const divergences: Divergence[] = [];
  const usedBFindings = new Set<number>();

  for (const findingA of agentAFindings) {
    const remainingB = agentBFindings.filter((_, index) => !usedBFindings.has(index));
    const matchB = findMatchingFinding(findingA, remainingB);

    if (matchB) {
      const matchIndex = agentBFindings.indexOf(matchB);
      usedBFindings.add(matchIndex);

      merged.push({
        category: findingA.category,
        severity: findingA.severity,
        message: findingA.message,
        fix: findingA.fix || matchB.fix,
        citation: {
          ...findingA.citation,
          verified: (findingA.citation as { verified?: boolean }).verified ||
            (matchB.citation as { verified?: boolean }).verified ||
            false,
        },
        penalty: Math.max(findingA.penalty, matchB.penalty),
        agentAFound: true,
        agentBFound: true,
        agentAMessage: findingA.message,
        agentBMessage: matchB.message,
        evidence_status: findingA.evidence_status ?? matchB.evidence_status,
        claim_type: findingA.claim_type ?? matchB.claim_type,
        confidence_caveat: findingA.confidence_caveat ?? matchB.confidence_caveat,
        missing_inputs: findingA.missing_inputs ?? matchB.missing_inputs,
        root_cause: findingA.root_cause ?? matchB.root_cause,
        impacted_surfaces: findingA.impacted_surfaces ?? matchB.impacted_surfaces,
        verify_steps: findingA.verify_steps ?? matchB.verify_steps,
        scoring_category: findingA.scoring_category ?? matchB.scoring_category,
      });
    } else {
      merged.push({
        category: findingA.category,
        severity: findingA.severity,
        message: findingA.message,
        fix: findingA.fix,
        citation: {
          ...findingA.citation,
          verified: (findingA.citation as { verified?: boolean }).verified || false,
        },
        penalty: findingA.penalty,
        agentAFound: true,
        agentBFound: false,
        agentAMessage: findingA.message,
        evidence_status: findingA.evidence_status,
        claim_type: findingA.claim_type,
        confidence_caveat: findingA.confidence_caveat,
        missing_inputs: findingA.missing_inputs,
        root_cause: findingA.root_cause,
        impacted_surfaces: findingA.impacted_surfaces,
        verify_steps: findingA.verify_steps,
        scoring_category: findingA.scoring_category,
      });
    }
  }

  for (let index = 0; index < agentBFindings.length; index++) {
    if (usedBFindings.has(index)) continue;

    const findingB = agentBFindings[index];
    if (!findingB) continue;

    merged.push({
      category: findingB.category,
      severity: findingB.severity,
      message: findingB.message,
      fix: findingB.fix,
      citation: {
        ...findingB.citation,
        verified: (findingB.citation as { verified?: boolean }).verified || false,
      },
      penalty: findingB.penalty,
      agentAFound: false,
      agentBFound: true,
      agentBMessage: findingB.message,
      evidence_status: findingB.evidence_status,
      claim_type: findingB.claim_type,
      confidence_caveat: findingB.confidence_caveat,
      missing_inputs: findingB.missing_inputs,
      root_cause: findingB.root_cause,
      impacted_surfaces: findingB.impacted_surfaces,
      verify_steps: findingB.verify_steps,
      scoring_category: findingB.scoring_category,
    });
  }

  for (const finding of merged) {
    if (finding.agentAFound !== finding.agentBFound) {
      divergences.push({
        findingId: nanoid(),
        agentAPosition: finding.agentAFound
          ? finding.agentAMessage || 'Issue detected'
          : 'No issue found',
        agentBPosition: finding.agentBFound
          ? finding.agentBMessage || 'Issue detected'
          : 'No issue found',
        resolution: finding.citation.verified ? 'flagged' : 'dismissed',
      });
    }
  }

  return { merged, divergences };
}

function dedupeCoverageMatrix(entries: CoverageMatrixEntry[]): CoverageMatrixEntry[] {
  const byDomain = new Map<string, CoverageMatrixEntry>();
  for (const entry of entries) {
    if (!byDomain.has(entry.domain)) {
      byDomain.set(entry.domain, entry);
    }
  }
  return Array.from(byDomain.values());
}

function pickHiringPacket(
  agentA: AgentResponse,
  agentB: AgentResponse
): CareerHiringPacket | undefined {
  if (agentA.hiring_packet) return agentA.hiring_packet;
  if (agentB.hiring_packet) return agentB.hiring_packet;
  return undefined;
}

function mergeTalkingPointScripts(
  generatedScripts: TalkingPointScript[],
  agentA: AgentResponse,
  agentB: AgentResponse
): TalkingPointScript[] {
  const allScripts = [
    ...generatedScripts,
    ...(agentA.talking_points ?? []),
    ...(agentB.talking_points ?? []),
  ];

  const unique: TalkingPointScript[] = [];
  const seen = new Set<string>();

  for (const script of allScripts) {
    const key = `${script.category}::${script.title}::${script.script}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(script);
  }

  return unique.slice(0, 12);
}

// ============================================================================
// TRIBUNAL REPORT BUILDER
// ============================================================================

/**
 * Builds the complete Tribunal report from deterministic + AI analysis.
 */
export function buildTribunalReport(
  deterministic: DeterministicScanResult,
  agentA: AgentResponse,
  agentB: AgentResponse,
  files: RepoFile[]
): TribunalReport {
  const startTime = Date.now();

  const bailiffStartTime = Date.now();
  const { verifiedFindings: verifiedA } = verifyAllCitations(agentA.findings, files);
  const { verifiedFindings: verifiedB, verifications } = verifyAllCitations(agentB.findings, files);
  const bailiffStats = createBailiffStats(verifications, bailiffStartTime);

  const { merged, divergences } = reconcileFindings(verifiedA, verifiedB);

  const verifiedMerged = merged.filter(finding => finding.citation.verified);

  const tribunalFindings: TribunalFinding[] = verifiedMerged.map(mergedFinding => ({
    id: nanoid(),
    source: 'ai-agent' as const,
    category: mergedFinding.category,
    severity: mergedFinding.severity,
    message: mergedFinding.message,
    fix: mergedFinding.fix,
    agentAFound: mergedFinding.agentAFound,
    agentBFound: mergedFinding.agentBFound,
    confidence: calculateConfidence(
      mergedFinding.agentAFound,
      mergedFinding.agentBFound,
      mergedFinding.citation.verified
    ),
    citation: mergedFinding.citation,
    divergenceNote: mergedFinding.agentAFound !== mergedFinding.agentBFound
      ? `Only ${mergedFinding.agentAFound ? 'Agent A' : 'Agent B'} detected this issue`
      : undefined,
    penalty: mergedFinding.penalty,
    evidence_status: mergedFinding.evidence_status,
    claim_type: mergedFinding.claim_type,
    confidence_caveat: mergedFinding.confidence_caveat,
    missing_inputs: mergedFinding.missing_inputs,
    root_cause: mergedFinding.root_cause,
    impacted_surfaces: mergedFinding.impacted_surfaces,
    verify_steps: mergedFinding.verify_steps,
    scoring_category: mergedFinding.scoring_category,
  }));

  const allFindings = [...deterministic.findings, ...tribunalFindings];

  const allPositives: PositiveSignal[] = [
    ...deterministic.positives,
    ...agentA.positives,
    ...agentB.positives.filter(positive =>
      !agentA.positives.some(agentPositive =>
        agentPositive.category === positive.category &&
        agentPositive.description === positive.description
      )
    ),
  ];

  const combinedBailiffStats = {
    ...bailiffStats,
    totalCitations: bailiffStats.totalCitations + verifiedA.length,
    verified: bailiffStats.verified + verifiedA.filter(finding => finding.citation.verified).length,
    rejected: bailiffStats.rejected + verifiedA.filter(finding => !finding.citation.verified).length,
  };

  const scoreBreakdown = calculateTribunalScore(
    deterministic,
    tribunalFindings,
    allPositives,
    combinedBailiffStats
  );

  const agreementCount = merged.filter(finding => finding.agentAFound && finding.agentBFound).length;
  const agreementRate = merged.length > 0
    ? Math.round((agreementCount / merged.length) * 100)
    : 100;

  const tableStakesPenalties: TableStakesPenaltyHit[] = deterministic.tableStakesPenalties ?? [];
  const generatedScripts = generateTalkingPointScripts(allFindings, allPositives, tableStakesPenalties);
  const talkingPointScripts = mergeTalkingPointScripts(generatedScripts, agentA, agentB);
  const stackProfile = assembleStackProfile(allFindings, allPositives, files);

  const coverageMatrixEntries = dedupeCoverageMatrix([
    ...(agentA.coverage_matrix ?? []),
    ...(agentB.coverage_matrix ?? []),
  ]);

  return {
    deterministicScore: scoreBreakdown.deterministicScore,
    aiEnhancedScore: scoreBreakdown.aiScore,
    finalScore: scoreBreakdown.finalScore,
    grade: scoreBreakdown.grade,
    subscores: scoreBreakdown.subscores,
    scoreBreakdownV2: scoreBreakdown.scoreBreakdownV2,

    overallConfidence: calculateOverallConfidence(tribunalFindings),
    agreementRate,

    findings: allFindings,
    positives: allPositives,
    talkingPoints: talkingPointScripts.map(script => `[${script.category}] ${script.script}`),
    talkingPointScripts,
    divergences: divergences.filter(divergence =>
      verifiedMerged.some(mergedFinding =>
        mergedFinding.agentAMessage === divergence.agentAPosition ||
        mergedFinding.agentBMessage === divergence.agentBPosition
      )
    ),
    stackProfile,
    coverageMatrix: coverageMatrixEntries.length > 0 ? coverageMatrixEntries : undefined,
    hiringPacket: pickHiringPacket(agentA, agentB),

    metadata: {
      agentAModel: agentA.model,
      agentBModel: agentB.model,
      deterministicChecksRun: deterministic.checksRun,
      aiChecksRun: agentA.findings.length + agentB.findings.length,
      citationsVerified: combinedBailiffStats.verified,
      hallucinationsRejected: combinedBailiffStats.rejected,
      analysisTimeMs: Date.now() - startTime + agentA.analysisTimeMs + agentB.analysisTimeMs,
      verificationBonus: scoreBreakdown.verificationBonus,
      positiveBonus: scoreBreakdown.positiveBonus,
    },

    scannedAt: new Date(),
  };
}

// ============================================================================
// LIGHTWEIGHT REPORT (deterministic only, for demo mode)
// ============================================================================

/**
 * Creates a deterministic-only report.
 */
export function buildDeterministicOnlyReport(
  deterministic: DeterministicScanResult,
  files: RepoFile[] = []
): TribunalReport {
  const scoreBreakdown = calculateTribunalScore(
    deterministic,
    [],
    deterministic.positives,
    createEmptyBailiffStats()
  );

  const tableStakesPenalties: TableStakesPenaltyHit[] = deterministic.tableStakesPenalties ?? [];
  const talkingPointScripts = generateTalkingPointScripts(
    deterministic.findings,
    deterministic.positives,
    tableStakesPenalties
  );
  const stackProfile = assembleStackProfile(deterministic.findings, deterministic.positives, files);

  return {
    deterministicScore: scoreBreakdown.deterministicScore,
    aiEnhancedScore: scoreBreakdown.aiScore,
    finalScore: scoreBreakdown.finalScore,
    grade: scoreBreakdown.grade,
    subscores: scoreBreakdown.subscores,
    scoreBreakdownV2: scoreBreakdown.scoreBreakdownV2,

    overallConfidence: 'high',
    agreementRate: 100,

    findings: deterministic.findings,
    positives: deterministic.positives,
    talkingPoints: talkingPointScripts.map(script => `[${script.category}] ${script.script}`),
    talkingPointScripts,
    divergences: [],
    stackProfile,

    metadata: {
      agentAModel: 'N/A (deterministic only)',
      agentBModel: 'N/A (deterministic only)',
      deterministicChecksRun: deterministic.checksRun,
      aiChecksRun: 0,
      citationsVerified: deterministic.findings.length,
      hallucinationsRejected: 0,
      analysisTimeMs: 0,
      verificationBonus: 0,
      positiveBonus: 0,
    },

    scannedAt: new Date(),
  };
}
