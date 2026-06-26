create extension if not exists pgcrypto;

create table if not exists public.brains (
  id text primary key,
  name text not null,
  created_by_actor_id text not null,
  created_by_actor_name text not null,
  created_by_actor_type text not null check (created_by_actor_type in ('user', 'agent')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.brain_memberships (
  brain_id text not null references public.brains(id) on delete cascade,
  actor_id text not null,
  actor_name text not null,
  actor_type text not null check (actor_type in ('user', 'agent')),
  role text not null check (role in ('owner', 'admin', 'editor', 'commenter', 'viewer', 'agent')),
  invited_by_actor_id text,
  created_at timestamptz not null default now(),
  primary key (brain_id, actor_id)
);

create table if not exists public.brain_invites (
  id uuid primary key default gen_random_uuid(),
  brain_id text not null references public.brains(id) on delete cascade,
  brain_name text not null,
  invite_code_hash text not null unique,
  invite_code_hint text not null,
  email text not null,
  role text not null check (role in ('admin', 'editor', 'commenter', 'viewer', 'agent')),
  invited_by_actor_id text not null,
  invited_by_actor_name text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  accepted_by_actor_id text,
  accepted_by_actor_name text,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists brain_invites_brain_status_idx on public.brain_invites (brain_id, status);
create index if not exists brain_memberships_actor_idx on public.brain_memberships (actor_id);

alter table public.brains enable row level security;
alter table public.brain_memberships enable row level security;
alter table public.brain_invites enable row level security;

-- ============================================================
-- Big Brain server layer (ported from the Connect brain module)
--
-- Scope-based knowledge spaces with human-readable markdown
-- documents, structured sources/entities, graph relations and an
-- audit trail. PostgreSQL is the operational source of truth; the
-- markdown documents remain the durable, readable projection.
-- ============================================================

create table if not exists public.brain_spaces (
  id text primary key default gen_random_uuid()::text,
  user_id text not null default 'local-user',
  scope_type text not null check (scope_type in ('user', 'base', 'group', 'agent', 'council')),
  scope_id text not null,
  name text not null,
  description text not null default '',
  status text not null default 'active',
  anchor_document_id text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, scope_type, scope_id)
);

create table if not exists public.brain_sources (
  id text primary key default gen_random_uuid()::text,
  user_id text not null default 'local-user',
  space_id text not null references public.brain_spaces(id) on delete cascade,
  source_type text not null default 'import',
  name text not null,
  uri text,
  raw_content text,
  content_hash text,
  metadata jsonb,
  imported_by_actor_id text not null default 'system:big-brain',
  imported_at timestamptz not null default now()
);

create table if not exists public.brain_documents (
  id text primary key default gen_random_uuid()::text,
  user_id text not null default 'local-user',
  space_id text not null references public.brain_spaces(id) on delete cascade,
  source_id text references public.brain_sources(id) on delete set null,
  type text not null default 'note',
  slug text not null,
  title text not null,
  content_markdown text not null default '',
  frontmatter jsonb,
  status text not null default 'active',
  priority text,
  tags text[] not null default '{}',
  content_hash text,
  last_change_summary text not null default '',
  created_by_actor_id text not null default 'system:big-brain',
  updated_by_actor_id text not null default 'system:big-brain',
  created_by_actor_name text not null default 'Big Brain',
  updated_by_actor_name text not null default 'Big Brain',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (space_id, slug)
);

create table if not exists public.brain_entities (
  id text primary key default gen_random_uuid()::text,
  user_id text not null default 'local-user',
  space_id text not null references public.brain_spaces(id) on delete cascade,
  entity_type text not null,
  slug text not null,
  name text not null,
  summary text not null default '',
  aliases text[] not null default '{}',
  metadata jsonb,
  confidence double precision not null default 1.0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (space_id, slug)
);

create table if not exists public.brain_relations (
  id text primary key default gen_random_uuid()::text,
  space_id text not null references public.brain_spaces(id) on delete cascade,
  relation_type text not null,
  source_document_id text references public.brain_documents(id) on delete cascade,
  target_document_id text references public.brain_documents(id) on delete cascade,
  source_entity_id text references public.brain_entities(id) on delete cascade,
  target_entity_id text references public.brain_entities(id) on delete cascade,
  evidence_document_id text,
  note text not null default '',
  confidence double precision not null default 1.0,
  created_by_actor_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.brain_change_events (
  id text primary key default gen_random_uuid()::text,
  user_id text not null default 'local-user',
  space_id text not null references public.brain_spaces(id) on delete cascade,
  document_id text references public.brain_documents(id) on delete set null,
  actor_id text not null,
  actor_name text not null,
  actor_type text not null default 'agent',
  action text not null,
  summary text not null default '',
  before_hash text,
  after_hash text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists brain_spaces_user_scope_idx on public.brain_spaces (user_id, scope_type);
create index if not exists brain_documents_space_type_idx on public.brain_documents (space_id, type);
create index if not exists brain_documents_space_updated_idx on public.brain_documents (space_id, updated_at desc);
create index if not exists brain_documents_user_type_idx on public.brain_documents (user_id, type);
create index if not exists brain_sources_space_idx on public.brain_sources (space_id, imported_at desc);
create index if not exists brain_entities_space_type_idx on public.brain_entities (space_id, entity_type);
create index if not exists brain_relations_space_type_idx on public.brain_relations (space_id, relation_type);
create index if not exists brain_relations_source_doc_idx on public.brain_relations (source_document_id);
create index if not exists brain_relations_target_doc_idx on public.brain_relations (target_document_id);
create index if not exists brain_change_events_space_idx on public.brain_change_events (space_id, created_at desc);

alter table public.brain_spaces enable row level security;
alter table public.brain_sources enable row level security;
alter table public.brain_documents enable row level security;
alter table public.brain_entities enable row level security;
alter table public.brain_relations enable row level security;
alter table public.brain_change_events enable row level security;

-- grants for app service_role (added 2026-06-25)
GRANT USAGE ON SCHEMA public TO service_role, anon, authenticated; GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role; GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
