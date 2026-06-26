/**
 * Embedding helper for the big-brain-db app. Server-only.
 *
 * Generates dense vector embeddings via the OpenAI-compatible `/embeddings`
 * endpoint using plain `fetch` (no extra npm dependencies). Designed to fail
 * gracefully: any misconfiguration or request failure returns `null` instead
 * of throwing, so callers can treat embeddings as a best-effort enhancement.
 */

/** Dimensionality produced by `text-embedding-3-small`. */
export const EMBEDDING_DIM = 1536;

const DEFAULT_MODEL = 'text-embedding-3-small';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/** Rough character cap to stay comfortably within token limits. */
const MAX_INPUT_CHARS = 8000;

let warnedNoKey = false;
let warnedRequestFailed = false;

function getApiKey(): string | undefined {
  return process.env.OPENAI_API_KEY ?? process.env.BRAIN_EMBEDDING_API_KEY;
}

function getModel(): string {
  return process.env.BRAIN_EMBEDDING_MODEL ?? DEFAULT_MODEL;
}

function getBaseUrl(): string {
  const raw = process.env.BRAIN_EMBEDDING_BASE_URL ?? DEFAULT_BASE_URL;
  return raw.replace(/\/+$/, '');
}

/** Whether an embedding API key is configured. */
export function isEmbeddingEnabled(): boolean {
  return Boolean(getApiKey());
}

interface EmbeddingResponse {
  data?: Array<{ embedding?: number[] }>;
}

/**
 * Embed a single string.
 *
 * @returns a `number[]` of length {@link EMBEDDING_DIM}, or `null` if embeddings
 *   are disabled, the input is empty, or the request fails.
 */
export async function embedText(text: string): Promise<number[] | null> {
  const input = (text ?? '').trim().slice(0, MAX_INPUT_CHARS);
  if (!input) return null;

  const apiKey = getApiKey();
  if (!apiKey) {
    if (!warnedNoKey) {
      warnedNoKey = true;
      console.warn(
        '[embed] No embedding API key configured (OPENAI_API_KEY / BRAIN_EMBEDDING_API_KEY); embeddings disabled.',
      );
    }
    return null;
  }

  try {
    const response = await fetch(`${getBaseUrl()}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: getModel(), input }),
    });

    if (!response.ok) {
      if (!warnedRequestFailed) {
        warnedRequestFailed = true;
        console.warn(
          `[embed] Embedding request failed with status ${response.status}; returning null.`,
        );
      }
      return null;
    }

    const payload = (await response.json()) as EmbeddingResponse;
    const embedding = payload.data?.[0]?.embedding;

    if (!Array.isArray(embedding) || embedding.length === 0) {
      if (!warnedRequestFailed) {
        warnedRequestFailed = true;
        console.warn('[embed] Embedding response missing vector data; returning null.');
      }
      return null;
    }

    return embedding;
  } catch (error) {
    if (!warnedRequestFailed) {
      warnedRequestFailed = true;
      console.warn('[embed] Embedding request threw; returning null.', error);
    }
    return null;
  }
}
