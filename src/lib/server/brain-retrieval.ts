// ============================================================
// brain-retrieval.ts - Hybrid (lexical + vector) retrieval
//
// Combines full-text (tsvector) and dense-vector (pgvector cosine)
// search over public.brain_documents using Reciprocal Rank Fusion
// (RRF). Mirrors Connect's brain/search.ts, adapted to the
// standalone repo's Supabase service client + embed helper.
//
// Both retrieval lists are best-effort: a failed RPC (or a missing
// embedding) is treated as an empty list so the other modality can
// still return useful hits (lexical-only fallback).
// ============================================================

import { createSupabaseServiceClient } from '@/lib/supabase/server';
import { LOCAL_USER_ID, getBrainSpaceByScope, type BrainScopeType } from './brain-db';
import { embedText } from './embed';

export interface BrainSearchHit {
  documentId: string;
  slug: string;
  title: string;
  type: string;
  snippet: string;
  score: number;
  lexicalRank: number | null;
  vectorRank: number | null;
}

/** RRF dampening constant. Larger values flatten the contribution of top ranks. */
const RRF_K = 60;
const DEFAULT_LIMIT = 8;
/** Over-fetch from each modality so fusion has enough candidates to work with. */
const CANDIDATE_MULTIPLIER = 4;
const SNIPPET_LENGTH = 200;

/** Row shape returned by both retrieval RPCs (shared columns we rely on). */
interface RetrievalRow {
  id?: unknown;
  slug?: unknown;
  title?: unknown;
  type?: unknown;
  content_markdown?: unknown;
}

/** Accumulator tracking fused score + per-modality rank for one document. */
interface FusionEntry {
  documentId: string;
  slug: string;
  title: string;
  type: string;
  contentMarkdown: string;
  score: number;
  lexicalRank: number | null;
  vectorRank: number | null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

/**
 * Await a Supabase RPC, returning its rows or [] on any error/throw.
 * A failed list never breaks the other modality.
 */
async function safeRpcRows(
  call: PromiseLike<{ data: unknown; error: unknown }>
): Promise<RetrievalRow[]> {
  try {
    const { data, error } = await call;
    if (error || !Array.isArray(data)) return [];
    return data as RetrievalRow[];
  } catch {
    return [];
  }
}

/**
 * Collapse markdown content into a short plain-text snippet: strip a leading
 * YAML frontmatter block and common markdown noise, then truncate.
 */
function buildSnippet(contentMarkdown: string): string {
  let text = contentMarkdown;

  // Drop leading YAML frontmatter (--- ... ---).
  if (text.startsWith('---')) {
    const end = text.indexOf('\n---', 3);
    if (end !== -1) {
      text = text.slice(end + 4);
    }
  }

  text = text
    .replace(/```[\s\S]*?```/g, ' ') // fenced code blocks
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_m, target, label) =>
      asString(label || target)
    ) // wiki links
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // markdown links
    .replace(/^[#>\s]*#{1,6}\s*/gm, '') // heading markers
    .replace(/^[\s]*[-*+]\s+/gm, '') // list bullets
    .replace(/[*_~>#]/g, '') // residual emphasis / blockquote markers
    .replace(/\s+/g, ' ')
    .trim();

  return text.slice(0, SNIPPET_LENGTH).trim();
}

/**
 * Fold one ordered (best-first) result list into the fusion map, adding each
 * document's RRF contribution and recording its rank for the given modality.
 */
function fuseList(
  map: Map<string, FusionEntry>,
  rows: RetrievalRow[],
  modality: 'lexical' | 'vector'
): void {
  rows.forEach((row, index) => {
    const documentId = asString(row.id);
    if (!documentId) return;

    let entry = map.get(documentId);
    if (!entry) {
      entry = {
        documentId,
        slug: asString(row.slug),
        title: asString(row.title),
        type: asString(row.type) || 'note',
        contentMarkdown: asString(row.content_markdown),
        score: 0,
        lexicalRank: null,
        vectorRank: null,
      };
      map.set(documentId, entry);
    } else if (!entry.contentMarkdown && asString(row.content_markdown)) {
      entry.contentMarkdown = asString(row.content_markdown);
    }

    // RRF: contribution from a 0-based rank position.
    entry.score += 1 / (RRF_K + index);

    if (modality === 'lexical') {
      if (entry.lexicalRank === null) entry.lexicalRank = index;
    } else if (entry.vectorRank === null) {
      entry.vectorRank = index;
    }
  });
}

/**
 * Hybrid search across a single Big Brain space resolved from
 * (LOCAL_USER_ID, scopeType, scopeId). Returns up to `limit` fused hits,
 * highest combined score first. Returns [] when the space does not exist.
 */
export async function hybridSearchBrain(input: {
  scopeType: BrainScopeType;
  scopeId: string;
  query: string;
  limit?: number;
}): Promise<BrainSearchHit[]> {
  const query = (input.query ?? '').trim();
  const limit = input.limit ?? DEFAULT_LIMIT;
  if (!query) return [];

  // 1. Resolve the space id (uses getBrainSpaceByScope from brain-db.ts).
  const space = await getBrainSpaceByScope({
    userId: LOCAL_USER_ID,
    scopeType: input.scopeType,
    scopeId: input.scopeId,
  });
  if (!space) return [];

  const supabase = createSupabaseServiceClient();
  const matchCount = limit * CANDIDATE_MULTIPLIER;

  // 2. Embed the query (best-effort; null => lexical-only fallback).
  const embedding = await embedText(query);

  // 3 + 4. Run both modalities concurrently, treating any failure as empty.
  const lexicalPromise = safeRpcRows(
    supabase.rpc('search_brain_documents_lexical', {
      query_text: query,
      p_user_id: LOCAL_USER_ID,
      p_space_id: space.id,
      match_count: matchCount,
    })
  );

  const vectorPromise: Promise<RetrievalRow[]> = embedding
    ? safeRpcRows(
        supabase.rpc('match_brain_documents', {
          query_embedding: embedding,
          p_user_id: LOCAL_USER_ID,
          p_space_id: space.id,
          match_count: matchCount,
        })
      )
    : Promise.resolve([]);

  const [lexicalRows, vectorRows] = await Promise.all([lexicalPromise, vectorPromise]);

  // 5. Reciprocal Rank Fusion across both ordered lists.
  const fusion = new Map<string, FusionEntry>();
  fuseList(fusion, lexicalRows, 'lexical');
  fuseList(fusion, vectorRows, 'vector');

  // 6. Sort by fused score desc, truncate, project to hits with snippets.
  return Array.from(fusion.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => ({
      documentId: entry.documentId,
      slug: entry.slug,
      title: entry.title,
      type: entry.type,
      snippet: buildSnippet(entry.contentMarkdown),
      score: entry.score,
      lexicalRank: entry.lexicalRank,
      vectorRank: entry.vectorRank,
    }));
}
