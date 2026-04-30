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
