-- ============================================================
-- NOTE: embedding dim = 768 (Ollama nomic-embed-text, local/free). For OpenAI
-- text-embedding-3-small use vector(1536) and set BRAIN_EMBEDDING_* env accordingly.
-- Big Brain semantic search support
--
-- Adds pgvector embeddings + full-text search over
-- public.brain_documents, plus RPCs for vector (cosine) and
-- lexical (tsvector) retrieval scoped by user + space.
--
-- Idempotent: safe to re-run.
-- ============================================================

-- 1. pgvector extension
create extension if not exists vector;

-- 2. Embedding column on brain_documents (OpenAI text-embedding-3-small dims)
alter table public.brain_documents
  add column if not exists body_embedding vector(768);

-- 3. HNSW cosine index for approximate nearest-neighbour search
create index if not exists brain_documents_body_embedding_hnsw_idx
  on public.brain_documents
  using hnsw (body_embedding vector_cosine_ops);

-- 4. GIN full-text index over title + content_markdown
create index if not exists brain_documents_fts_idx
  on public.brain_documents
  using gin (
    to_tsvector(
      'simple',
      coalesce(title, '') || ' ' || coalesce(content_markdown, '')
    )
  );

-- 5. Vector (semantic) match RPC
create or replace function public.match_brain_documents(
  query_embedding vector(768),
  p_user_id text,
  p_space_id text,
  match_count int
)
returns table (
  id text,
  space_id text,
  slug text,
  title text,
  type text,
  content_markdown text,
  similarity float
)
language sql
security definer
set search_path = public
as $$
  select
    d.id,
    d.space_id,
    d.slug,
    d.title,
    d.type,
    d.content_markdown,
    1 - (d.body_embedding <=> query_embedding) as similarity
  from public.brain_documents d
  where d.body_embedding is not null
    and (
      p_user_id is null
      or btrim(p_user_id) = ''
      or d.user_id = p_user_id
    )
    and (
      p_space_id is null
      or btrim(p_space_id) = ''
      or d.space_id = p_space_id
    )
  order by d.body_embedding <=> query_embedding asc
  limit greatest(match_count, 0);
$$;

-- 6. Lexical (full-text) search RPC
create or replace function public.search_brain_documents_lexical(
  query_text text,
  p_user_id text,
  p_space_id text,
  match_count int
)
returns table (
  id text,
  space_id text,
  slug text,
  title text,
  type text,
  content_markdown text,
  rank float
)
language sql
security definer
set search_path = public
as $$
  select
    d.id,
    d.space_id,
    d.slug,
    d.title,
    d.type,
    d.content_markdown,
    ts_rank_cd(
      to_tsvector(
        'simple',
        coalesce(d.title, '') || ' ' || coalesce(d.content_markdown, '')
      ),
      plainto_tsquery('simple', query_text)
    ) as rank
  from public.brain_documents d
  where (
      p_user_id is null
      or btrim(p_user_id) = ''
      or d.user_id = p_user_id
    )
    and (
      p_space_id is null
      or btrim(p_space_id) = ''
      or d.space_id = p_space_id
    )
  order by ts_rank_cd(
    to_tsvector(
      'simple',
      coalesce(d.title, '') || ' ' || coalesce(d.content_markdown, '')
    ),
    plainto_tsquery('simple', query_text)
  ) desc
  limit greatest(match_count, 0);
$$;

-- 7. Grants for the app service_role (mirror the init migration)
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT EXECUTE ON FUNCTION public.match_brain_documents(vector(768), text, text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.search_brain_documents_lexical(text, text, text, int) TO service_role;
