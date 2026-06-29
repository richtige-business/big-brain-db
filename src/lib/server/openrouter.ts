/**
 * OpenRouter chat client for the big-brain-db app. Server-only.
 *
 * Talks to OpenRouter's OpenAI-compatible API with plain `fetch` (no extra npm
 * dependencies), mirroring the shape of `embed.ts`. The API key lives ONLY in
 * `process.env.OPENROUTER_API_KEY` and is never sent to the browser — the chat UI
 * always goes through `/api/brain/chat`, which holds the key here on the server.
 */

const BASE_URL = 'https://openrouter.ai/api/v1';

// OpenRouter likes a referer + title for attribution; harmless if unset.
const APP_TITLE = 'big-brain-db';

export function getApiKey(): string | undefined {
  return process.env.OPENROUTER_API_KEY;
}

/** Whether an OpenRouter API key is configured. */
export function isChatEnabled(): boolean {
  return Boolean(getApiKey());
}

function authHeaders(): Record<string, string> {
  const key = getApiKey();
  return {
    Authorization: `Bearer ${key ?? ''}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': process.env.OPENROUTER_SITE_URL ?? 'http://localhost:3000',
    'X-Title': APP_TITLE,
  };
}

export interface OpenRouterModel {
  id: string;
  name: string;
  contextLength: number | null;
  promptPrice: number | null; // USD per token
  completionPrice: number | null;
}

interface RawModel {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
}

/** Fetch the full catalogue of models available on OpenRouter. */
export async function listModels(): Promise<OpenRouterModel[]> {
  if (!isChatEnabled()) throw new Error('OPENROUTER_API_KEY is not configured.');
  const res = await fetch(`${BASE_URL}/models`, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`OpenRouter /models failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
  const json = (await res.json()) as { data?: RawModel[] };
  const models = (json.data ?? []).map((m) => ({
    id: m.id,
    name: m.name || m.id,
    contextLength: typeof m.context_length === 'number' ? m.context_length : null,
    promptPrice: m.pricing?.prompt != null ? Number(m.pricing.prompt) : null,
    completionPrice: m.pricing?.completion != null ? Number(m.pricing.completion) : null,
  }));
  models.sort((a, b) => a.name.localeCompare(b.name));
  return models;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Start a streaming chat completion. Returns the raw `fetch` Response whose body
 * is OpenRouter's SSE stream (`data: {...}` lines). The caller parses and re-emits.
 */
export async function chatCompletionStream(input: {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
}): Promise<Response> {
  if (!isChatEnabled()) throw new Error('OPENROUTER_API_KEY is not configured.');
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      model: input.model,
      messages: input.messages,
      temperature: input.temperature ?? 0.3,
      stream: true,
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`OpenRouter chat failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
  return res;
}
