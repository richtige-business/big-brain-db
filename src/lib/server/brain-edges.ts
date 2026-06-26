// ============================================================
// brain-edges.ts - Typed-relation (graph edge) module for Big Brain
//
// Mirrors Connect's brain/graph.ts addEdge/neighbours behavior on
// top of the Supabase-backed brain_relations table. Edges connect
// two brain_documents (by slug) within a single scope-resolved
// space using a typed relation kind.
//
// Reuses brain-db.ts helpers for resolution:
//   - getBrainSpaceByScope  -> resolves the space id from (scopeType, scopeId)
//   - getBrainDocument      -> resolves a document id from a slug within a space
//   - createSupabaseServiceClient -> service-role DB access (via brain-db's db())
// ============================================================

import { createSupabaseServiceClient } from '@/lib/supabase/server';
import {
  LOCAL_USER_ID,
  getBrainDocument,
  getBrainSpaceByScope,
  type BrainScopeType,
} from '@/lib/server/brain-db';

export type BrainRelationKind =
  | 'mentions'
  | 'belongs_to'
  | 'derived_from'
  | 'contradicts'
  | 'supersedes'
  | 'wiki_link';

function db() {
  return createSupabaseServiceClient();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Insert a typed relation (graph edge) between two documents resolved by
 * slug within a scope-resolved space. Idempotent: an identical
 * (source, target, kind) row is not duplicated.
 */
export async function addBrainRelation(input: {
  scopeType: BrainScopeType;
  scopeId: string;
  sourceSlug: string;
  targetSlug: string;
  kind: BrainRelationKind;
  confidence?: number;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const space = await getBrainSpaceByScope({
      scopeType: input.scopeType,
      scopeId: input.scopeId,
    });
    if (!space) {
      return { ok: false, error: `No brain space for scope ${input.scopeType}:${input.scopeId}` };
    }

    const [source, target] = await Promise.all([
      getBrainDocument({ spaceId: space.id, slug: input.sourceSlug }),
      getBrainDocument({ spaceId: space.id, slug: input.targetSlug }),
    ]);

    if (!source) {
      return { ok: false, error: `Source document not found for slug "${input.sourceSlug}"` };
    }
    if (!target) {
      return { ok: false, error: `Target document not found for slug "${input.targetSlug}"` };
    }

    const confidence =
      typeof input.confidence === 'number' && Number.isFinite(input.confidence)
        ? input.confidence
        : 1;

    // Idempotency: do not duplicate an identical source/target/kind row.
    const { data: existing, error: existingError } = await db()
      .from('brain_relations')
      .select('id')
      .eq('space_id', space.id)
      .eq('relation_type', input.kind)
      .eq('source_document_id', source.id)
      .eq('target_document_id', target.id)
      .maybeSingle();
    if (existingError) {
      return { ok: false, error: errorMessage(existingError) };
    }
    if (existing) {
      return { ok: true, id: String((existing as Record<string, unknown>).id) };
    }

    const { data, error } = await db()
      .from('brain_relations')
      .insert({
        space_id: space.id,
        relation_type: input.kind,
        source_document_id: source.id,
        target_document_id: target.id,
        confidence,
        created_by_actor_id: LOCAL_USER_ID,
      })
      .select('id')
      .single();
    if (error) {
      return { ok: false, error: errorMessage(error) };
    }

    return { ok: true, id: String((data as Record<string, unknown>).id) };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

/**
 * Return the documents connected to the given document by typed relations.
 * direction 'out' = the document is the relation source; 'in' = it is the
 * target; 'both' (default) = either. Optionally filtered by kinds.
 * Results are deduped per (documentId, kind, direction).
 */
export async function getBrainNeighbours(input: {
  scopeType: BrainScopeType;
  scopeId: string;
  slug: string;
  direction?: 'in' | 'out' | 'both';
  kinds?: BrainRelationKind[];
}): Promise<
  Array<{ documentId: string; slug: string; title: string; kind: string; direction: 'in' | 'out' }>
> {
  try {
    const space = await getBrainSpaceByScope({
      scopeType: input.scopeType,
      scopeId: input.scopeId,
    });
    if (!space) return [];

    const document = await getBrainDocument({ spaceId: space.id, slug: input.slug });
    if (!document) return [];

    const direction = input.direction || 'both';
    const kinds = input.kinds && input.kinds.length > 0 ? input.kinds : null;

    type RelationRow = {
      relation_type: unknown;
      source_document_id: unknown;
      target_document_id: unknown;
    };

    const fetchRelations = async (column: 'source_document_id' | 'target_document_id') => {
      let query = db()
        .from('brain_relations')
        .select('relation_type, source_document_id, target_document_id')
        .eq('space_id', space.id)
        .eq(column, document.id);
      if (kinds) query = query.in('relation_type', kinds);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as RelationRow[];
    };

    const collected: Array<{ neighbourId: string; kind: string; direction: 'in' | 'out' }> = [];

    if (direction === 'out' || direction === 'both') {
      for (const row of await fetchRelations('source_document_id')) {
        const neighbourId = row.target_document_id ? String(row.target_document_id) : '';
        if (neighbourId && neighbourId !== document.id) {
          collected.push({ neighbourId, kind: String(row.relation_type || ''), direction: 'out' });
        }
      }
    }

    if (direction === 'in' || direction === 'both') {
      for (const row of await fetchRelations('target_document_id')) {
        const neighbourId = row.source_document_id ? String(row.source_document_id) : '';
        if (neighbourId && neighbourId !== document.id) {
          collected.push({ neighbourId, kind: String(row.relation_type || ''), direction: 'in' });
        }
      }
    }

    if (collected.length === 0) return [];

    // Resolve neighbour documents (slug/title) in one query.
    const neighbourIds = Array.from(new Set(collected.map((entry) => entry.neighbourId)));
    const { data: docs, error: docsError } = await db()
      .from('brain_documents')
      .select('id, slug, title')
      .eq('space_id', space.id)
      .in('id', neighbourIds);
    if (docsError) throw docsError;

    const docById = new Map<string, { slug: string; title: string }>();
    for (const row of (docs || []) as Record<string, unknown>[]) {
      docById.set(String(row.id), {
        slug: String(row.slug || ''),
        title: String(row.title || ''),
      });
    }

    const seen = new Set<string>();
    const results: Array<{
      documentId: string;
      slug: string;
      title: string;
      kind: string;
      direction: 'in' | 'out';
    }> = [];

    for (const entry of collected) {
      const doc = docById.get(entry.neighbourId);
      if (!doc) continue;
      const dedupeKey = `${entry.neighbourId}|${entry.kind}|${entry.direction}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      results.push({
        documentId: entry.neighbourId,
        slug: doc.slug,
        title: doc.title,
        kind: entry.kind,
        direction: entry.direction,
      });
    }

    return results;
  } catch {
    return [];
  }
}
