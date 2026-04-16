/**
 * Phase 22.2 / 83.01 / G1: AI Clients
 *
 * Unified interface for calling Gemini and Claude AI models.
 * - Gemini via @google/genai (API key) — dual keys for Flash/Pro cost tracking
 * - Claude via direct Anthropic API (preferred) or Vertex AI (fallback)
 * - BYOK wrapper: routes through user's own API keys when available (Phase G1)
 */

import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';
import { GoogleAuth } from 'google-auth-library';
import { createLogger } from '@/lib/logger';
import { prisma } from '@/lib/db';
import { getBYOKConfig } from '@/services/user/byok-service';

const log = createLogger('AI_CLIENT');

// ============================================================================
// CONFIGURATION
// ============================================================================

const FLASH_API_KEY = process.env.GOOGLE_CLOUD_API_KEY_FLASH || process.env.GOOGLE_CLOUD_API_KEY || process.env.GEMINI_API_KEY || '';
const PRO_API_KEY = process.env.GOOGLE_CLOUD_API_KEY_PRO || process.env.GOOGLE_CLOUD_API_KEY || process.env.GEMINI_API_KEY || '';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_VERTEX_PROJECT_ID = process.env.ANTHROPIC_VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '';
const CLOUD_ML_REGION = process.env.CLOUD_ML_REGION || 'us-east5';

// ============================================================================
// GEMINI CLIENT (via API Key — dual keys for Flash/Pro)
// ============================================================================

let flashClient: GoogleGenAI | null = null;
let proClient: GoogleGenAI | null = null;

function getGeminiClient(model: string): GoogleGenAI {
  if (model.includes('pro')) {
    if (!proClient) {
      if (!PRO_API_KEY) throw new Error('GOOGLE_CLOUD_API_KEY_PRO (or GEMINI_API_KEY fallback) is not set');
      proClient = new GoogleGenAI({ apiKey: PRO_API_KEY });
    }
    return proClient;
  }
  if (!flashClient) {
    if (!FLASH_API_KEY) throw new Error('GOOGLE_CLOUD_API_KEY_FLASH (or GEMINI_API_KEY fallback) is not set');
    flashClient = new GoogleGenAI({ apiKey: FLASH_API_KEY });
  }
  return flashClient;
}

export interface AICallParams {
  model: string;
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** Force response format (e.g. 'application/json' for structured output) */
  responseMimeType?: string;
}

/**
 * Call Gemini model via Google AI API
 * Routes Flash models to GOOGLE_CLOUD_API_KEY_FLASH and Pro models to GOOGLE_CLOUD_API_KEY_PRO.
 * Falls back to GEMINI_API_KEY if dedicated keys are not set.
 */
export async function callGemini({
  model,
  prompt,
  systemPrompt,
  temperature = 0.2,
  maxTokens = 4096,
  timeoutMs = 45000,
  responseMimeType,
}: AICallParams): Promise<string> {
  const client = getGeminiClient(model);

  const response = await withTimeout(
    client.models.generateContent({
      model,
      contents: prompt,
      config: {
        ...(systemPrompt && { systemInstruction: systemPrompt }),
        ...(responseMimeType && { responseMimeType }),
        temperature,
        maxOutputTokens: maxTokens,
      },
    }),
    timeoutMs,
    `Gemini ${model} timeout after ${timeoutMs}ms`
  );

  return response.text ?? '';
}

/**
 * Stream Gemini model output as a ReadableStream of text chunks.
 * Used by ai-tools endpoints for real-time generation display.
 */
export function callGeminiStream({
  model,
  prompt,
  systemPrompt,
  temperature = 0.7,
  maxTokens = 4096,
  timeoutMs = 60000,
}: AICallParams): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const client = getGeminiClient(model);

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const timeout = setTimeout(() => {
        controller.error(new Error(`Gemini ${model} stream timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      try {
        const response = await client.models.generateContentStream({
          model,
          contents: prompt,
          config: {
            ...(systemPrompt && { systemInstruction: systemPrompt }),
            temperature,
            maxOutputTokens: maxTokens,
          },
        });

        for await (const chunk of response) {
          const text = chunk.text;
          if (text) {
            controller.enqueue(encoder.encode(text));
          }
        }

        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}

// ============================================================================
// CLAUDE CLIENT (direct API preferred, Vertex AI fallback)
// ============================================================================

let directClaudeClient: Anthropic | null = null;
let vertexClaudeClient: AnthropicVertex | null = null;

function getDirectClaudeClient(): Anthropic {
  if (!directClaudeClient) {
    directClaudeClient = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  }
  return directClaudeClient;
}

/**
 * Build a GoogleAuth instance for Vertex AI authentication.
 * Fallback path when ANTHROPIC_API_KEY is not set.
 */
function buildVertexGoogleAuth(): GoogleAuth {
  const inlineCredentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;

  if (inlineCredentialsJson) {
    let credentials: Record<string, unknown> | null = null;

    try {
      credentials = JSON.parse(inlineCredentialsJson) as Record<string, unknown>;
    } catch {
      try {
        const decoded = Buffer.from(inlineCredentialsJson, 'base64').toString('utf8');
        credentials = JSON.parse(decoded) as Record<string, unknown>;
        log.info('vertex_auth_base64_decoded');
      } catch (decodeErr) {
        log.error(
          'vertex_auth_credentials_parse_failed',
          decodeErr instanceof Error ? decodeErr : new Error(String(decodeErr)),
          'AI_AUTH_001'
        );
      }
    }

    if (credentials) {
      log.info('vertex_auth_inline_credentials', { type: credentials.type ?? 'unknown' });
      return new GoogleAuth({
        credentials,
        scopes: 'https://www.googleapis.com/auth/cloud-platform',
      });
    }
  }

  return new GoogleAuth({
    scopes: 'https://www.googleapis.com/auth/cloud-platform',
  });
}

function getVertexClaudeClient(): AnthropicVertex {
  if (!vertexClaudeClient) {
    if (!ANTHROPIC_VERTEX_PROJECT_ID) {
      throw new Error(
        'ANTHROPIC_VERTEX_PROJECT_ID (or GOOGLE_CLOUD_PROJECT) environment variable is not set.'
      );
    }
    vertexClaudeClient = new AnthropicVertex({
      projectId: ANTHROPIC_VERTEX_PROJECT_ID,
      region: CLOUD_ML_REGION,
      googleAuth: buildVertexGoogleAuth(),
    });
  }
  return vertexClaudeClient;
}

/**
 * Call Claude model via direct Anthropic API (preferred) or Vertex AI (fallback).
 * Uses ANTHROPIC_API_KEY when available to avoid Vertex AI quota constraints.
 */
export async function callClaude({
  model,
  prompt,
  systemPrompt,
  temperature = 0.2,
  maxTokens = 4096,
  timeoutMs = 45000,
}: AICallParams): Promise<string> {
  const useDirect = !!ANTHROPIC_API_KEY;
  const client = useDirect ? getDirectClaudeClient() : getVertexClaudeClient();

  if (useDirect) {
    log.info('claude_using_direct_api');
  }

  const result = await withTimeout(
    client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      ...(systemPrompt && { system: systemPrompt }),
      messages: [{ role: 'user', content: prompt }],
    }),
    timeoutMs,
    `Claude ${model} timeout after ${timeoutMs}ms`
  );

  // Extract text from Claude response content blocks
  for (const block of result.content) {
    if (block.type === 'text') {
      return block.text;
    }
  }
  return '';
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Wraps a promise with a timeout using Promise.race
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  errorMessage: string
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    const id = setTimeout(() => {
      clearTimeout(id);
      reject(new Error(errorMessage));
    }, ms);
  });
  
  return Promise.race([promise, timeoutPromise]);
}

/**
 * Retry wrapper with exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelayMs?: number;
    onRetry?: (attempt: number, error: Error) => void;
  } = {}
): Promise<T> {
  const { maxRetries = 1, baseDelayMs = 1000, onRetry } = options;
  let lastError: Error = new Error('Unknown error');
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        onRetry?.(attempt + 1, lastError);
        log.warn(
          `Attempt ${attempt + 1} failed: ${lastError.message}. Retrying in ${delay}ms...`
        );
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  
  throw lastError;
}

// ============================================================================
// BYOK-AWARE WRAPPER (Phase G1: GAJ Integration)
// ============================================================================

export interface BYOKCallParams extends AICallParams {
  /** User ID to look up BYOK keys for */
  userId: string;
}

/**
 * BYOK-aware AI call wrapper for GAJ features.
 *
 * Resolution order:
 * 1. User has BYOK config with Agent A key → use their key
 * 2. User is Scout tier (no BYOK) → fall back to platform keys
 * 3. User is paid tier (no BYOK) → error: must configure API key
 *
 * Uses Agent A key slot per the GAJ integration plan.
 */
export async function callWithBYOK(params: BYOKCallParams): Promise<string> {
  const { userId, ...aiParams } = params;

  // 1. Check for BYOK configuration
  const byokConfig = await getBYOKConfig(userId);

  if (byokConfig) {
    const { provider, apiKey, model: byokModel } = byokConfig.agentA;
    const modelToUse = aiParams.model || byokModel;
    log.info('byok_call', { userId, provider, model: modelToUse });

    return callWithUserKey(provider, apiKey, { ...aiParams, model: modelToUse });
  }

  // 2. No BYOK — check tier
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tribunalTier: true },
  });

  const tier = user?.tribunalTier ?? 'scout';
  const paidTiers = ['proof', 'gold', 'platinum', 'ltd'];

  if (paidTiers.includes(tier)) {
    throw new Error(
      'Configure your API key in Settings → API Keys. ' +
      'Paid tier features require your own API key (BYOK).'
    );
  }

  // 3. Scout tier — use platform keys
  log.info('byok_platform_fallback', { userId, tier, model: aiParams.model });
  return callWithPlatformKeys(aiParams);
}

/**
 * Route to the correct provider using the user's own API key.
 */
async function callWithUserKey(
  provider: string,
  apiKey: string,
  params: AICallParams
): Promise<string> {
  switch (provider) {
    case 'google': {
      const client = new GoogleGenAI({ apiKey });
      const response = await withTimeout(
        client.models.generateContent({
          model: params.model,
          contents: params.prompt,
          config: {
            ...(params.systemPrompt && { systemInstruction: params.systemPrompt }),
            temperature: params.temperature ?? 0.7,
            maxOutputTokens: params.maxTokens ?? 4096,
          },
        }),
        params.timeoutMs ?? 60000,
        `BYOK Gemini ${params.model} timeout`
      );
      return response.text ?? '';
    }

    case 'anthropic': {
      const client = new Anthropic({ apiKey });
      const result = await withTimeout(
        client.messages.create({
          model: params.model,
          max_tokens: params.maxTokens ?? 4096,
          temperature: params.temperature ?? 0.7,
          ...(params.systemPrompt && { system: params.systemPrompt }),
          messages: [{ role: 'user', content: params.prompt }],
        }),
        params.timeoutMs ?? 60000,
        `BYOK Claude ${params.model} timeout`
      );
      for (const block of result.content) {
        if (block.type === 'text') return block.text;
      }
      return '';
    }

    default:
      throw new Error(`Unsupported BYOK provider: ${provider}. Supported: google, anthropic.`);
  }
}

/**
 * Fall back to platform keys for Scout tier users.
 * Routes to callGemini or callClaude based on model name.
 */
async function callWithPlatformKeys(params: AICallParams): Promise<string> {
  if (params.model.includes('claude') || params.model.includes('anthropic')) {
    return callClaude(params);
  }
  return callGemini(params);
}

// ============================================================================
// JSON UTILITIES
// ============================================================================

/**
 * Extract and parse JSON from AI response
 * Handles markdown code blocks and common LLM JSON issues
 */
export function extractAndParseJSON<T = unknown>(raw: string): T | null {
  const trimmed = raw.trim();
  
  // First attempt: direct parse (for clean JSON input)
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // Continue to extraction
  }
  
  // Try multiple extraction patterns for markdown-wrapped JSON
  const patterns = [
    /```json\s*([\s\S]*?)\s*```/i,  // ```json ... ```
    /```\s*([\s\S]*?)\s*```/,        // ``` ... ```
  ];
  
  let jsonStr = trimmed;
  
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match && match[1]) {
      jsonStr = match[1].trim();
      break;
    }
  }
  
  // Second attempt: parse extracted string
  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    // Continue to repair attempt
  }
  
  // Third attempt: repair common LLM JSON issues
  const repaired = jsonStr
    .replace(/,(\s*[}\]])/g, '$1')     // Remove trailing commas
    .replace(/'/g, '"')                 // Single to double quotes
    .replace(/(\r\n|\n|\r)/gm, ' ')     // Remove newlines in strings
    .replace(/\t/g, ' ');               // Remove tabs
  
  try {
    return JSON.parse(repaired) as T;
  } catch (e) {
    log.warn('Failed to parse JSON:', e);
    return null;
  }
}

