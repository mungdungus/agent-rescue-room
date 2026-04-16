/**
 * Career Analyzer Service
 * Phase 28: Scanner 2.0 - Career Track
 * 
 * Extracts career signals from analyzed code to produce a CareerPacket.
 * This service focuses on AI-native signals, founder-mode indicators,
 * and ATS-optimized resume content.
 */

import { callGemini, callClaude, extractAndParseJSON } from "@/lib/ai-clients";
import { createLogger } from "@/lib/logger";

const log = createLogger('CAREER_ANALYZER');
import {
  CareerPacket,
  SkillsSummary,
  LanguageSkill,
  ResumeBullet,
  Citation,
  CompanyTierFit,
  CompanyTier,
  KeywordExtraction,
  InterviewPrep,
} from "@/types/career";
import { RepoFile, TribunalTier } from "@/types/tribunal";
import { 
  CAREER_PROMPT_FULL, 
  CAREER_PROMPT_SCOUT,
} from "@/prompts";

// User tier type for prompt selection.
// Keep legacy values for backward compatibility with older callers.
type UserTier = TribunalTier | 'proof' | 'platinum';

function normalizeCareerTier(tier: UserTier): TribunalTier {
  if (tier === 'proof') return 'pro';
  if (tier === 'platinum') return 'ltd';
  return tier;
}

/**
 * Configuration for career analysis
 */
interface CareerAnalysisConfig {
  tier: UserTier;
  contributionScope?: 'solo_founder' | 'founding_engineer' | 'tech_lead' | 'contributor';
  targetCompanyTier?: CompanyTier;
  timeframeDays?: number;
}

/**
 * Raw response from the AI model for career analysis
 */
interface CareerAnalysisRaw {
  skills_summary?: {
    ai_ml?: string[];
    languages?: Array<{ name: string; proficiency: string; evidence_strength?: number }>;
    frontend?: string[];
    backend?: string[];
    data?: string[];
    infrastructure?: string[];
    tooling?: string[];
  };
  founder_mode_blurb?: string;
  primary_bullets?: Array<{
    text: string;
    keywords?: string[];
    evidence?: { file: string; line?: number; snippet?: string; confidence?: string };
    category?: string;
  }>;
  extended_bullets?: Array<{
    text: string;
    keywords?: string[];
    evidence?: { file: string; line?: number; snippet?: string; confidence?: string };
    category?: string;
  }>;
  ai_integration_statement?: string;
  company_tier_fit?: {
    recommended_tier?: string;
    confidence?: number;
    rationale?: string;
    tier_scores?: Record<string, number>;
  };
  keyword_extraction?: {
    tier1?: { keywords: string[]; context: string };
    tier2?: { keywords: string[]; context: string };
    tier3?: { keywords: string[]; context: string };
  };
  interview_prep?: {
    architecture_walkthrough?: string[];
    technical_decisions?: Array<{ 
      decision: string; 
      rationale: string; 
      alternatives: string[];
      evidence?: { file: string; line?: number };
    }>;
    trade_offs?: Array<{ 
      choice: string; 
      benefit: string; 
      cost: string; 
      context: string;
    }>;
    anticipated_questions?: Array<{ 
      question: string; 
      suggested_answer: string;
      key_points: string[];
    }>;
  };
}

/**
 * Analyze repository files and extract career signals
 * Uses the appropriate prompt based on user tier
 */
export async function analyzeForCareer(
  files: RepoFile[],
  config: CareerAnalysisConfig
): Promise<CareerPacket> {
  const startTime = Date.now();
  const normalizedTier = normalizeCareerTier(config.tier);
  
  // Select prompt based on tier
  const prompt = normalizedTier === 'scout'
    ? CAREER_PROMPT_SCOUT 
    : CAREER_PROMPT_FULL;

  // Build file context (limited for scout tier)
  const maxFiles = normalizedTier === 'scout' ? 10 : 50;
  const maxContentPerFile = normalizedTier === 'scout' ? 1500 : 4000;
  
  const fileContext = files
    .slice(0, maxFiles)
    .map(f => `--- FILE: ${f.path} ---\n${f.content.substring(0, maxContentPerFile)}`)
    .join("\n\n");

  const fullPrompt = `
${prompt}

═══════════════════════════════════════════════════════════════════════════════
CODEBASE TO ANALYZE
═══════════════════════════════════════════════════════════════════════════════

Contribution Scope: ${config.contributionScope || 'solo_founder'}
Target Company Tier: ${config.targetCompanyTier || 'ai_native'}
${config.timeframeDays ? `Timeframe: ${config.timeframeDays} days` : ''}

FILES (${files.length} total, showing ${Math.min(files.length, maxFiles)}):

${fileContext}

═══════════════════════════════════════════════════════════════════════════════
RESPOND WITH VALID JSON ONLY
═══════════════════════════════════════════════════════════════════════════════
`;

  // Use Gemini Flash for initial analysis
  const modelName = process.env.GEMINI_MODEL || "gemini-3-flash-preview";

  log.info(`Starting ${normalizedTier} tier analysis...`);

  const rawResponse = await callGemini({ model: modelName, prompt: fullPrompt, responseMimeType: 'application/json' });

  const rawAnalysis = extractAndParseJSON<CareerAnalysisRaw>(rawResponse);
  if (!rawAnalysis) {
    log.error(`Failed to parse AI response:`, rawResponse.substring(0, 500));
    throw new Error("Career analysis returned malformed JSON");
  }

  // For paid tiers, validate with Claude Sonnet (skipped when Anthropic API is unavailable)
  let validatedAnalysis = rawAnalysis;
  if (normalizedTier !== 'scout' && process.env.ANTHROPIC_API_KEY) {
    try {
      log.info(`Running Claude validation...`);
      validatedAnalysis = await validateWithSonnet(rawAnalysis, files);
    } catch (claudeErr) {
      log.warn("claude_validation_skipped", claudeErr instanceof Error ? claudeErr : { error: String(claudeErr) });
    }
  }

  const analysisTimeMs = Date.now() - startTime;
  log.info(`Analysis complete in ${analysisTimeMs}ms`);

  // Transform raw response into CareerPacket
  return transformToCareerPacket(validatedAnalysis);
}

/**
 * Validate and refine career analysis using Claude Sonnet
 * Cross-validates claims and ensures evidence integrity.
 * Uses callClaude() with a 60s timeout to stay within the overall scan budget.
 */
async function validateWithSonnet(
  flashAnalysis: CareerAnalysisRaw,
  files: RepoFile[]
): Promise<CareerAnalysisRaw> {
  const validationPrompt = `
You are a senior technical recruiter validating career signal extraction from a codebase.
Review the following analysis and verify:
1. All claims have supporting code evidence
2. Skill levels are accurately assessed
3. No overclaims that would embarrass in an interview
4. Keywords are genuinely demonstrated, not forced

ANALYSIS TO VALIDATE:
${JSON.stringify(flashAnalysis, null, 2)}

SAMPLE FILES FOR EVIDENCE CHECKING (first 5):
${files.slice(0, 5).map(f => `--- ${f.path} ---\n${f.content.substring(0, 2000)}`).join('\n\n')}

OUTPUT: Return a corrected JSON with the same structure.
Remove or downgrade any claims that lack evidence.
Mark inferred claims clearly.
`;

  try {
    const rawResponse = await callClaude({
      model: "claude-sonnet-4-6",
      prompt: validationPrompt,
      maxTokens: 8000,
      timeoutMs: 60_000, // 60s hard cap to stay within scan budget
    });

    const cleanedText = rawResponse.replace(/```json|```/g, "").trim();
    return JSON.parse(cleanedText);
  } catch (err) {
    log.warn(`Sonnet validation failed, using Flash results:`, err);
  }

  return flashAnalysis;
}

/**
 * Transform raw AI response into structured CareerPacket
 */
function transformToCareerPacket(raw: CareerAnalysisRaw): CareerPacket {
  // Transform skills summary
  const skillsSummary: SkillsSummary = {
    aiMl: raw.skills_summary?.ai_ml || [],
    languages: (raw.skills_summary?.languages || []).map(lang => ({
      name: lang.name,
      proficiency: mapProficiency(lang.proficiency),
      evidenceStrength: lang.evidence_strength || 0.5,
    })),
    frontend: raw.skills_summary?.frontend || [],
    backend: raw.skills_summary?.backend || [],
    data: raw.skills_summary?.data || [],
    infrastructure: raw.skills_summary?.infrastructure || [],
    tooling: raw.skills_summary?.tooling || [],
  };

  // Transform primary bullets
  const primaryBullets: ResumeBullet[] = (raw.primary_bullets || []).map(bullet => ({
    text: bullet.text,
    magicKeywords: bullet.keywords || [],
    category: mapBulletCategory(bullet.category),
    evidence: bullet.evidence ? {
      file: bullet.evidence.file,
      line: bullet.evidence.line,
      snippet: bullet.evidence.snippet,
      matchConfidence: mapConfidence(bullet.evidence.confidence),
    } : undefined,
  }));

  // Transform extended bullets
  const extendedBullets: ResumeBullet[] = (raw.extended_bullets || []).map(bullet => ({
    text: bullet.text,
    magicKeywords: bullet.keywords || [],
    category: mapBulletCategory(bullet.category),
    evidence: bullet.evidence ? {
      file: bullet.evidence.file,
      line: bullet.evidence.line,
      snippet: bullet.evidence.snippet,
      matchConfidence: mapConfidence(bullet.evidence.confidence),
    } : undefined,
  }));

  // Transform company tier fit
  const companyTierFit: CompanyTierFit = {
    recommendedTier: mapCompanyTier(raw.company_tier_fit?.recommended_tier),
    confidence: raw.company_tier_fit?.confidence || 0.5,
    rationale: raw.company_tier_fit?.rationale || '',
    tierScores: {
      foundational_lab: raw.company_tier_fit?.tier_scores?.foundational_lab || 0,
      ai_native: raw.company_tier_fit?.tier_scores?.ai_native || 0,
      ai_enabler: raw.company_tier_fit?.tier_scores?.ai_enabler || 0,
      ai_curious: raw.company_tier_fit?.tier_scores?.ai_curious || 0,
      traditional: raw.company_tier_fit?.tier_scores?.traditional || 0,
    },
  };

  // Transform keyword extraction
  const keywordExtraction: KeywordExtraction = {
    tier1: raw.keyword_extraction?.tier1 || { keywords: [], context: '' },
    tier2: raw.keyword_extraction?.tier2 || { keywords: [], context: '' },
    tier3: raw.keyword_extraction?.tier3 || { keywords: [], context: '' },
  };

  // Transform interview prep
  const interviewPrep: InterviewPrep = {
    architectureWalkthrough: raw.interview_prep?.architecture_walkthrough || [],
    technicalDecisions: (raw.interview_prep?.technical_decisions || []).map(d => ({
      decision: d.decision,
      rationale: d.rationale,
      alternatives: d.alternatives || [],
      evidence: d.evidence ? {
        file: d.evidence.file,
        line: d.evidence.line,
        matchConfidence: 'inferred' as const,
      } : undefined,
    })),
    tradeOffs: (raw.interview_prep?.trade_offs || []).map(t => ({
      choice: t.choice,
      benefit: t.benefit,
      cost: t.cost,
      context: t.context,
    })),
    anticipatedQuestions: (raw.interview_prep?.anticipated_questions || []).map(q => ({
      question: q.question,
      suggestedAnswer: q.suggested_answer,
      keyPoints: q.key_points || [],
    })),
  };

  return {
    id: crypto.randomUUID(),
    generatedAt: new Date(),
    skillsSummary,
    founderModeBlurb: raw.founder_mode_blurb || '',
    primaryBullets,
    extendedBullets,
    aiIntegrationStatement: raw.ai_integration_statement || '',
    companyTierFit,
    keywordExtraction,
    interviewPrep,
  };
}

/**
 * Map proficiency string to type-safe value
 */
function mapProficiency(prof?: string): LanguageSkill['proficiency'] {
  switch (prof?.toLowerCase()) {
    case 'primary':
    case 'expert':
      return 'primary';
    case 'secondary':
    case 'proficient':
      return 'secondary';
    default:
      return 'familiar';
  }
}

/**
 * Map bullet category string to type-safe value
 */
function mapBulletCategory(cat?: string): ResumeBullet['category'] {
  const valid = ['ai_integration', 'system_design', 'performance', 'security', 'testing', 'infrastructure', 'leadership', 'open_source'];
  return valid.includes(cat || '') ? cat as ResumeBullet['category'] : 'system_design';
}

/**
 * Map confidence string to type-safe value
 */
function mapConfidence(conf?: string): Citation['matchConfidence'] {
  switch (conf?.toLowerCase()) {
    case 'exact':
    case 'high':
      return 'exact';
    case 'fuzzy':
    case 'medium':
      return 'fuzzy';
    default:
      return 'inferred';
  }
}

/**
 * Map company tier string to type-safe value
 */
function mapCompanyTier(tier?: string): CompanyTier {
  const valid = ['foundational_lab', 'ai_native', 'ai_enabler', 'ai_curious', 'traditional'];
  return valid.includes(tier || '') ? tier as CompanyTier : 'ai_curious';
}

/**
 * Quick scout-tier analysis for teaser output
 */
export async function analyzeForCareerScout(
  files: RepoFile[]
): Promise<CareerPacket> {
  return analyzeForCareer(files, { tier: 'scout' });
}
