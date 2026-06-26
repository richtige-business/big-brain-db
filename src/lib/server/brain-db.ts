// ============================================================
// brain-db.ts - Supabase-backed Big Brain server layer
//
// Native Big Brain database with visible markdown documents,
// scopes, wiki-link relations and an audit trail. Ported from the
// Connect brain module (which used Prisma/PostgreSQL) and adapted
// to the standalone repo's Supabase service client.
//
// PostgreSQL/Supabase is the operational source of truth; the
// markdown documents remain the durable, human-readable layer.
// ============================================================

import { createHash } from 'crypto';
import { createSupabaseServiceClient } from '@/lib/supabase/server';
import { embedText } from './embed';

export const LOCAL_USER_ID = 'local-user';

export type BrainScopeType = 'user' | 'base' | 'group' | 'agent' | 'council';
export type BrainDocumentType =
  | 'brain'
  | 'agent-start'
  | 'log'
  | 'source'
  | 'concept'
  | 'entity'
  | 'decision'
  | 'synthesis'
  | 'open-question'
  | 'memory'
  | 'note';

export interface BrainActor {
  id: string;
  name: string;
  type: 'user' | 'agent' | 'system';
}

export interface BrainSpaceRecord {
  id: string;
  userId: string;
  scopeType: string;
  scopeId: string;
  name: string;
  description: string;
  status: string;
  anchorDocumentId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface BrainDocumentRecord {
  id: string;
  userId: string;
  spaceId: string;
  sourceId: string | null;
  type: string;
  slug: string;
  title: string;
  contentMarkdown: string;
  frontmatter: Record<string, unknown> | null;
  status: string;
  priority: string | null;
  tags: string[];
  contentHash: string | null;
  lastChangeSummary: string;
  createdByActorId: string;
  updatedByActorId: string;
  createdByActorName: string;
  updatedByActorName: string;
  createdAt: string;
  updatedAt: string;
}

export interface BrainImportFileInput {
  name: string;
  relativePath?: string;
  contentText: string;
  mimeType?: string;
  source?: string;
}

const DEFAULT_ACTOR: BrainActor = {
  id: 'system:big-brain',
  name: 'Big Brain',
  type: 'system',
};

const WIKI_LINK_PATTERN = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;

function db() {
  return createSupabaseServiceClient();
}

function fail(context: string, error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(`brain-db ${context} failed: ${message}`);
}

function asJsonRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function hashContent(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function normalizeBrainSlug(value: string): string {
  return value
    .replace(/\\/g, '/')
    .replace(/\.md$/i, '')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .map((segment) =>
      segment
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9äöüß-]+/gi, '-')
        .replace(/^-+|-+$/g, '')
    )
    .filter(Boolean)
    .join('/');
}

export function titleFromMarkdown(content: string, fallback: string): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || fallback.replace(/\.md$/i, '').split('/').pop() || fallback;
}

export function detectDocumentType(
  relativePath: string,
  frontmatter: Record<string, unknown> | null
): BrainDocumentType {
  const explicitType = String(frontmatter?.type || '').trim();
  if (explicitType) return explicitType as BrainDocumentType;

  const pathLower = relativePath.toLowerCase();
  if (pathLower.endsWith('agent_start.md')) return 'agent-start';
  if (pathLower.endsWith('log.md')) return 'log';
  if (pathLower.includes('/sources/') || pathLower.startsWith('sources/')) return 'source';
  if (pathLower.includes('/concepts/') || pathLower.startsWith('concepts/')) return 'concept';
  if (pathLower.includes('/entities/') || pathLower.startsWith('entities/')) return 'entity';
  if (pathLower.includes('/decisions/') || pathLower.startsWith('decisions/')) return 'decision';
  if (pathLower.includes('open-question')) return 'open-question';
  if (pathLower.includes('/syntheses/') || pathLower.startsWith('syntheses/')) return 'synthesis';
  if (pathLower.endsWith('-brain.md') || pathLower.includes('brain')) return 'brain';
  return 'note';
}

export function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown> | null;
  markdown: string;
} {
  if (!content.startsWith('---\n')) {
    return { frontmatter: null, markdown: content };
  }

  const end = content.indexOf('\n---', 4);
  if (end === -1) {
    return { frontmatter: null, markdown: content };
  }

  const raw = content.slice(4, end).trim();
  const markdown = content.slice(end + 4).replace(/^\n/, '');
  const frontmatter: Record<string, unknown> = {};

  for (const line of raw.split('\n')) {
    const [key, ...rest] = line.split(':');
    if (!key || rest.length === 0) continue;
    const value = rest.join(':').trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      frontmatter[key.trim()] = value
        .slice(1, -1)
        .split(',')
        .map((entry) => entry.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    } else {
      frontmatter[key.trim()] = value.replace(/^["']|["']$/g, '');
    }
  }

  return { frontmatter, markdown };
}

function mapSpace(row: Record<string, unknown>): BrainSpaceRecord {
  return {
    id: String(row.id || ''),
    userId: String(row.user_id || ''),
    scopeType: String(row.scope_type || ''),
    scopeId: String(row.scope_id || ''),
    name: String(row.name || ''),
    description: String(row.description || ''),
    status: String(row.status || 'active'),
    anchorDocumentId: row.anchor_document_id ? String(row.anchor_document_id) : null,
    metadata: asJsonRecord(row.metadata),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  };
}

function mapDocument(row: Record<string, unknown>): BrainDocumentRecord {
  return {
    id: String(row.id || ''),
    userId: String(row.user_id || ''),
    spaceId: String(row.space_id || ''),
    sourceId: row.source_id ? String(row.source_id) : null,
    type: String(row.type || 'note'),
    slug: String(row.slug || ''),
    title: String(row.title || ''),
    contentMarkdown: String(row.content_markdown || ''),
    frontmatter: asJsonRecord(row.frontmatter),
    status: String(row.status || 'active'),
    priority: row.priority ? String(row.priority) : null,
    tags: Array.isArray(row.tags) ? row.tags.map((tag) => String(tag)) : [],
    contentHash: row.content_hash ? String(row.content_hash) : null,
    lastChangeSummary: String(row.last_change_summary || ''),
    createdByActorId: String(row.created_by_actor_id || DEFAULT_ACTOR.id),
    updatedByActorId: String(row.updated_by_actor_id || DEFAULT_ACTOR.id),
    createdByActorName: String(row.created_by_actor_name || DEFAULT_ACTOR.name),
    updatedByActorName: String(row.updated_by_actor_name || DEFAULT_ACTOR.name),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  };
}

function escapeIlike(value: string): string {
  return value.replace(/[%,()]/g, ' ').trim();
}

export async function ensureBrainSpace(input: {
  userId?: string;
  scopeType: BrainScopeType;
  scopeId: string;
  name: string;
  description?: string;
  metadata?: Record<string, unknown>;
}): Promise<BrainSpaceRecord> {
  const userId = input.userId || LOCAL_USER_ID;
  const now = new Date().toISOString();
  const { data, error } = await db()
    .from('brain_spaces')
    .upsert(
      {
        user_id: userId,
        scope_type: input.scopeType,
        scope_id: input.scopeId,
        name: input.name.trim(),
        description: input.description?.trim() || '',
        metadata: input.metadata ?? null,
        updated_at: now,
      },
      { onConflict: 'user_id,scope_type,scope_id' }
    )
    .select('*')
    .single();

  if (error) fail('ensureBrainSpace', error);
  return mapSpace(data as Record<string, unknown>);
}

export async function listBrainSpaces(
  input: { userId?: string; scopeType?: BrainScopeType; limit?: number } = {}
): Promise<BrainSpaceRecord[]> {
  let query = db()
    .from('brain_spaces')
    .select('*')
    .eq('user_id', input.userId || LOCAL_USER_ID)
    .order('updated_at', { ascending: false })
    .limit(input.limit || 50);

  if (input.scopeType) query = query.eq('scope_type', input.scopeType);

  const { data, error } = await query;
  if (error) fail('listBrainSpaces', error);
  return (data as Record<string, unknown>[]).map(mapSpace);
}

export async function getBrainSpaceByScope(input: {
  userId?: string;
  scopeType: BrainScopeType;
  scopeId: string;
}): Promise<BrainSpaceRecord | null> {
  const { data, error } = await db()
    .from('brain_spaces')
    .select('*')
    .eq('user_id', input.userId || LOCAL_USER_ID)
    .eq('scope_type', input.scopeType)
    .eq('scope_id', input.scopeId)
    .maybeSingle();

  if (error) fail('getBrainSpaceByScope', error);
  return data ? mapSpace(data as Record<string, unknown>) : null;
}

export async function listBrainDocuments(input: {
  userId?: string;
  spaceId: string;
  type?: string;
  search?: string;
  limit?: number;
}): Promise<BrainDocumentRecord[]> {
  const search = input.search ? escapeIlike(input.search) : '';
  let query = db()
    .from('brain_documents')
    .select('*')
    .eq('user_id', input.userId || LOCAL_USER_ID)
    .eq('space_id', input.spaceId)
    .order('type', { ascending: true })
    .order('updated_at', { ascending: false })
    .limit(Math.max(1, Math.min(input.limit || 50, 200)));

  if (input.type) query = query.eq('type', input.type);
  if (search) {
    query = query.or(
      `title.ilike.%${search}%,slug.ilike.%${search}%,content_markdown.ilike.%${search}%`
    );
  }

  const { data, error } = await query;
  if (error) fail('listBrainDocuments', error);
  return (data as Record<string, unknown>[]).map(mapDocument);
}

export async function listAllBrainDocuments(
  input: {
    userId?: string;
    scopeType?: BrainScopeType;
    scopeId?: string;
    search?: string;
    type?: string;
    limit?: number;
  } = {}
): Promise<BrainDocumentRecord[]> {
  const userId = input.userId || LOCAL_USER_ID;
  const search = input.search ? escapeIlike(input.search) : '';

  let spaceIds: string[] | null = null;
  if (input.scopeType || input.scopeId) {
    let spaceQuery = db().from('brain_spaces').select('id').eq('user_id', userId);
    if (input.scopeType) spaceQuery = spaceQuery.eq('scope_type', input.scopeType);
    if (input.scopeId) spaceQuery = spaceQuery.eq('scope_id', input.scopeId);
    const { data: spaces, error: spaceError } = await spaceQuery;
    if (spaceError) fail('listAllBrainDocuments(spaces)', spaceError);
    spaceIds = (spaces as Record<string, unknown>[]).map((row) => String(row.id));
    if (spaceIds.length === 0) return [];
  }

  let query = db()
    .from('brain_documents')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(input.limit || 50);

  if (input.type) query = query.eq('type', input.type);
  if (spaceIds) query = query.in('space_id', spaceIds);
  if (search) {
    query = query.or(
      `title.ilike.%${search}%,slug.ilike.%${search}%,content_markdown.ilike.%${search}%`
    );
  }

  const { data, error } = await query;
  if (error) fail('listAllBrainDocuments', error);
  return (data as Record<string, unknown>[]).map(mapDocument);
}

export async function getBrainDocument(input: {
  userId?: string;
  id?: string;
  spaceId?: string;
  slug?: string;
}): Promise<BrainDocumentRecord | null> {
  let query = db().from('brain_documents').select('*');

  if (input.id) {
    query = query.eq('id', input.id);
  } else if (input.spaceId && input.slug) {
    query = query.eq('space_id', input.spaceId).eq('slug', normalizeBrainSlug(input.slug));
  } else {
    return null;
  }

  const { data, error } = await query.maybeSingle();
  if (error) fail('getBrainDocument', error);
  if (!data) return null;

  const document = mapDocument(data as Record<string, unknown>);
  if (document.userId !== (input.userId || LOCAL_USER_ID)) return null;
  return document;
}

async function refreshWikiLinkRelations(document: BrainDocumentRecord): Promise<void> {
  const links = Array.from(document.contentMarkdown.matchAll(WIKI_LINK_PATTERN))
    .map((match) => normalizeBrainSlug(match[1] || ''))
    .filter(Boolean);

  const { error: deleteError } = await db()
    .from('brain_relations')
    .delete()
    .eq('space_id', document.spaceId)
    .eq('source_document_id', document.id)
    .eq('relation_type', 'wiki_link');
  if (deleteError) fail('refreshWikiLinkRelations(delete)', deleteError);

  if (links.length === 0) return;

  const { data: targets, error: targetError } = await db()
    .from('brain_documents')
    .select('id')
    .eq('space_id', document.spaceId)
    .in('slug', Array.from(new Set(links)));
  if (targetError) fail('refreshWikiLinkRelations(targets)', targetError);
  if (!targets || targets.length === 0) return;

  const rows = (targets as Record<string, unknown>[])
    .map((target) => String(target.id))
    .filter((targetId) => targetId !== document.id)
    .map((targetId) => ({
      space_id: document.spaceId,
      relation_type: 'wiki_link',
      source_document_id: document.id,
      target_document_id: targetId,
      note: 'Imported from markdown wiki link',
      confidence: 1,
      created_by_actor_id: document.updatedByActorId,
    }));
  if (rows.length === 0) return;

  const { error: insertError } = await db().from('brain_relations').insert(rows);
  if (insertError) fail('refreshWikiLinkRelations(insert)', insertError);
}

export async function upsertBrainDocument(input: {
  userId?: string;
  spaceId: string;
  slug: string;
  title: string;
  contentMarkdown: string;
  type?: BrainDocumentType;
  frontmatter?: Record<string, unknown> | null;
  tags?: string[];
  sourceId?: string | null;
  changeSummary?: string;
  actor?: BrainActor;
}): Promise<BrainDocumentRecord> {
  const userId = input.userId || LOCAL_USER_ID;
  const actor = input.actor || DEFAULT_ACTOR;
  const slug = normalizeBrainSlug(input.slug);
  const contentHash = hashContent(input.contentMarkdown);
  const now = new Date().toISOString();

  const { data: existingRow, error: existingError } = await db()
    .from('brain_documents')
    .select('*')
    .eq('space_id', input.spaceId)
    .eq('slug', slug)
    .maybeSingle();
  if (existingError) fail('upsertBrainDocument(existing)', existingError);

  const existing = existingRow ? mapDocument(existingRow as Record<string, unknown>) : null;
  const beforeHash = existing?.contentHash || null;

  // Embed the body for semantic search — only when content is new or changed
  // (best-effort: null when no embedding key is configured or the call fails, in
  // which case any existing embedding is left untouched).
  const embedding =
    !existing || existing.contentHash !== contentHash
      ? await embedText(`${input.title}\n\n${input.contentMarkdown}`)
      : null;

  const shared = {
    title: input.title.trim(),
    content_markdown: input.contentMarkdown,
    type: input.type || 'note',
    frontmatter: input.frontmatter ?? null,
    tags: input.tags || [],
    source_id: input.sourceId || null,
    content_hash: contentHash,
    last_change_summary: input.changeSummary || (existing ? 'Brain document updated' : 'Brain document created'),
    updated_by_actor_id: actor.id,
    updated_by_actor_name: actor.name,
    updated_at: now,
    ...(embedding ? { body_embedding: embedding } : {}),
  };

  let row: Record<string, unknown>;
  if (existing) {
    const { data, error } = await db()
      .from('brain_documents')
      .update(shared)
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) fail('upsertBrainDocument(update)', error);
    row = data as Record<string, unknown>;
  } else {
    const { data, error } = await db()
      .from('brain_documents')
      .insert({
        ...shared,
        user_id: userId,
        space_id: input.spaceId,
        slug,
        created_by_actor_id: actor.id,
        created_by_actor_name: actor.name,
      })
      .select('*')
      .single();
    if (error) fail('upsertBrainDocument(insert)', error);
    row = data as Record<string, unknown>;
  }

  const document = mapDocument(row);

  const { error: eventError } = await db().from('brain_change_events').insert({
    user_id: userId,
    space_id: input.spaceId,
    document_id: document.id,
    actor_id: actor.id,
    actor_name: actor.name,
    actor_type: actor.type,
    action: existing ? 'document.update' : 'document.create',
    summary: shared.last_change_summary,
    before_hash: beforeHash,
    after_hash: contentHash,
  });
  if (eventError) fail('upsertBrainDocument(event)', eventError);

  await refreshWikiLinkRelations(document);
  return document;
}

export async function importBrainMarkdownFiles(input: {
  userId?: string;
  scopeType: BrainScopeType;
  scopeId: string;
  spaceName: string;
  description?: string;
  files: BrainImportFileInput[];
  actor?: BrainActor;
}): Promise<{ space: BrainSpaceRecord; imported: number; documents: BrainDocumentRecord[] }> {
  const userId = input.userId || LOCAL_USER_ID;
  const actor = input.actor || DEFAULT_ACTOR;
  const space = await ensureBrainSpace({
    userId,
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    name: input.spaceName,
    description: input.description,
    metadata: { importMode: 'hybrid-markdown' },
  });

  const { data: sourceRow, error: sourceError } = await db()
    .from('brain_sources')
    .insert({
      user_id: userId,
      space_id: space.id,
      source_type: 'markdown-import',
      name: `${input.spaceName} import`,
      raw_content: JSON.stringify(
        input.files.map((file) => ({
          name: file.name,
          relativePath: file.relativePath || file.name,
          hash: hashContent(file.contentText),
        })),
        null,
        2
      ),
      content_hash: hashContent(input.files.map((file) => file.contentText).join('\n---\n')),
      metadata: { fileCount: input.files.length },
      imported_by_actor_id: actor.id,
    })
    .select('id')
    .single();
  if (sourceError) fail('importBrainMarkdownFiles(source)', sourceError);
  const sourceId = String((sourceRow as Record<string, unknown>).id);

  const documents: BrainDocumentRecord[] = [];
  for (const file of input.files) {
    const relativePath = file.relativePath || file.name;
    const { frontmatter, markdown } = parseFrontmatter(file.contentText);
    const slug = normalizeBrainSlug(relativePath);
    const type = detectDocumentType(relativePath, frontmatter);
    const tags = Array.isArray(frontmatter?.tags) ? frontmatter.tags.map((tag) => String(tag)) : [];

    documents.push(
      await upsertBrainDocument({
        userId,
        spaceId: space.id,
        sourceId,
        slug,
        title: titleFromMarkdown(markdown, relativePath),
        contentMarkdown: markdown,
        frontmatter,
        tags,
        type,
        actor,
        changeSummary: `Imported ${relativePath}`,
      })
    );
  }

  return { space, imported: documents.length, documents };
}

export async function buildBrainPromptBlock(input: {
  userId?: string;
  scopeType?: BrainScopeType;
  scopeId?: string;
  query?: string;
  limit?: number;
}): Promise<string> {
  const userId = input.userId || LOCAL_USER_ID;
  let space: BrainSpaceRecord | null = null;
  let documents: BrainDocumentRecord[] = [];

  if (input.scopeType && input.scopeId) {
    space = await getBrainSpaceByScope({ userId, scopeType: input.scopeType, scopeId: input.scopeId });
  }

  if (space) {
    documents = await listBrainDocuments({
      userId,
      spaceId: space.id,
      search: input.query,
      limit: input.limit || 8,
    });
  } else if (!input.scopeType && !input.scopeId) {
    documents = await listAllBrainDocuments({ userId, search: input.query, limit: input.limit || 8 });
  }

  if (documents.length === 0) return '';

  return [
    '# Brain Context (visible documents)',
    space ? `Scope: ${space.scopeType}:${space.scopeId} - ${space.name}` : 'Scope: all visible Big Brain spaces',
    'Use this as durable, user-visible knowledge. Do not treat it as hidden chat memory.',
    '',
    ...documents.map((document) => {
      const preview = document.contentMarkdown.replace(/\s+/g, ' ').slice(0, 700);
      return `- [${document.type}] ${document.title} (${document.slug}): ${preview}`;
    }),
  ].join('\n');
}
