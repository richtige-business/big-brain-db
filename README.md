# Big Brain DB

Big Brain DB is an agent-first Markdown brain database. It is a local-first knowledge app for folders of Markdown files, with graph navigation, Brain anchors, collaboration primitives, change history, conflict detection, and a local MCP server so agents such as Claude Code and Cursor can read, search, lint, and maintain Brains.

The product is inspired by the personal-wiki and context-engineering style popularized by **Andrej Karpathy**. Big Brain DB is not affiliated with or endorsed by him; the reference is an acknowledgement of the idea that a durable, well-linked knowledge base can become a high-leverage context layer for humans and agents.

## What Big Brain DB Is

Big Brain DB treats a Markdown folder as a Brain. Each Brain has one central Brain file, usually named like `my-project-brain.md`, plus internal agent files such as `AGENT_START.md` and `log.md`. Content files become graph nodes. The Brain file becomes the anchor for that cluster.

The app is designed for three users at once:

- Humans who want a fast local Markdown wiki with properties, graph navigation, and readable folders.
- Collaborators who need invite codes, roles, local membership state, and future-ready Supabase persistence.
- Agents that need a stable operating contract, a graph, a log, frontmatter metadata, and MCP tools for ingesting, linting, linking, and editing.

## Core Features

- Local Markdown vault loading through the browser File System Access API.
- Graph view as the default start view.
- Big Brain root node plus Sub-Brain anchor nodes.
- Brain metadata files hidden from the graph as separate nodes and shown through Brain panels instead.
- Sidebar folders default to closed.
- Markdown properties/frontmatter editor.
- Canonical actor metadata: `created_by`, `created_at`, `updated_by`, `updated_at`, `last_change_summary`, `content_hash`.
- Local collaboration state with actors, memberships, invite codes, roles, change events, versions, baselines, and conflicts.
- Supabase-backed invite persistence when configured.
- Local in-memory invite fallback for development.
- MCP server for Claude Code, Cursor, and other MCP clients.

## Project Status

This is a local-first MVP that is useful for development, demos, and single-machine workflows. Production collaboration still needs stronger auth, durable permissions, server-side authorization, migrations, and deployment hardening.

## Install

```bash
npm install
```

## Run The App

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

Use a Chromium-based browser such as Chrome, Edge, or Arc. The local folder picker depends on the File System Access API.

## First Use

1. Start the local app with `npm run dev`.
2. Open `http://localhost:3000`.
3. Click `Add Brain`.
4. Choose a Markdown folder.
5. Big Brain DB will create missing internal Brain files when it has write access:
   - `<folder-name>-brain.md`
   - `AGENT_START.md`
   - `log.md`
6. The app opens in graph view by default.
7. Use the sidebar to open files manually. Folders start closed.

Important: if an agent will work with a Brain, keep the local app running on localhost. The browser app owns the local file-handle workflow, visual graph, reconnect flow, and collaboration UI.

## Brain Structure

A Brain folder should be understandable by both humans and agents.

Recommended files:

- `<brain-name>-brain.md`: the Brain anchor, map, and role contract.
- `AGENT_START.md`: copyable startup instructions for an agent.
- `log.md`: chronological history of ingests, lint passes, maintenance, decisions, and open questions.
- Content pages: source notes, concept pages, entity pages, project pages, syntheses, questions, and templates.

Avoid folder-level `README.md` files as automatic navigation. Use the Brain file, hub pages, and semantic links instead.

## Collaboration Model

Big Brain DB currently has a local-first collaboration model with server-ready concepts:

- Actors: humans and agents.
- Roles: `owner`, `admin`, `editor`, `commenter`, `viewer`, `agent`.
- Memberships: which actor has which role in which Brain.
- Invitations: role-scoped invite codes.
- Change events: local save/update events with actor, summary, timestamp, and content hash.
- File versions: local snapshots created on save.
- Baselines: content hashes used for conflict detection.
- Conflicts: detected when the disk file changed after the local baseline.

The UI intentionally keeps `Acting as` simple:

- `Human`
- `Agent`

The invited person enters their own collaborator name when joining with an invite code. The inviter only chooses a role and receives a code.

## Supabase Setup

Supabase is optional for local development but recommended if you want invite codes to persist beyond the current local Next.js server process.

Create `.env.local` from the safe placeholder file:

```bash
cp .env.local.example .env.local
```

Fill it with your own project values:

```bash
NEXT_PUBLIC_SUPABASE_URL=<your-supabase-project-url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-supabase-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-supabase-service-role-key>
```

Never commit `.env.local`. Never commit real Supabase keys. The service role key is server-only and must not be exposed to browsers or public repositories.

### Minimal Supabase Tables

Create these tables in Supabase SQL editor or through migrations:

```sql
create table if not exists brains (
  id text primary key,
  name text not null,
  created_by_actor_id text not null,
  created_by_actor_name text not null,
  created_by_actor_type text not null check (created_by_actor_type in ('user', 'agent')),
  updated_at timestamptz not null default now()
);

create table if not exists brain_memberships (
  brain_id text not null references brains(id) on delete cascade,
  actor_id text not null,
  actor_name text not null,
  actor_type text not null check (actor_type in ('user', 'agent')),
  role text not null check (role in ('owner', 'admin', 'editor', 'commenter', 'viewer', 'agent')),
  invited_by_actor_id text,
  created_at timestamptz not null default now(),
  primary key (brain_id, actor_id)
);

create table if not exists brain_invites (
  id uuid primary key default gen_random_uuid(),
  brain_id text not null references brains(id) on delete cascade,
  brain_name text not null,
  invite_code_hash text not null unique,
  invite_code_hint text,
  email text not null default 'pending collaborator',
  role text not null check (role in ('admin', 'editor', 'commenter', 'viewer', 'agent')),
  invited_by_actor_id text not null,
  invited_by_actor_name text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  accepted_by_actor_id text,
  accepted_by_actor_name text,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists brain_invites_code_hash_idx on brain_invites(invite_code_hash);
create index if not exists brain_invites_brain_id_idx on brain_invites(brain_id);
```

The app currently uses a service role key in server routes. Before production deployment, add proper auth, row-level security, ownership checks, invite expiration, and audit logging.

## No Supabase Data In This Repository

This repository should contain only placeholders such as `.env.local.example`. Real values belong in local environment files or deployment secrets.

Also note:

- `.env.local` is ignored.
- `.env*.local` is ignored.
- `demo-wikis/` is ignored and should not be pushed to GitHub.

If a real key was ever committed or shared, rotate it in Supabase immediately.

## Continuing A Brain With An Agent

When an agent continues a Brain, always start the local app first:

```bash
npm run dev
```

Then give the agent a concrete task and the Brain folder context. The agent should:

1. Read the Brain file.
2. Read `AGENT_START.md`.
3. Read `log.md`.
4. Inspect the graph or use MCP tools.
5. Identify the ownership boundary.
6. Make small, source-backed edits.
7. Update links, frontmatter, and log entries when structure changes.
8. Run typecheck/build when app code changes.

### Ingest Workflow

Use ingest when adding new material.

1. Preserve the unprocessed source first under `raw/`.
2. Create a structured source note under `sources/`.
3. Link the structured source note back to the raw note with `raw_source`.
4. Extract durable claims, entities, concepts, contradictions, and open questions.
5. Link to concepts, entities, projects, and syntheses.
6. Update the Brain file when navigation changes.
7. Append a `log.md` entry.

The MCP `ingest_text` tool enforces this by writing a raw note before it writes the source note.

### Lint Workflow

Use lint when maintaining Brain quality.

Check for:

- Orphan pages.
- Missing backlinks.
- Broken or unresolved wiki links.
- Stale frontmatter.
- Duplicate concepts.
- Claims without sources.
- Contradictions that are not marked.
- Agent instructions that conflict with the Brain file.
- Old `protocol` terminology where Brain terminology should be used.

### Relation Workflow

Relations should help future readers and agents navigate.

Use links when the relationship is durable:

- `supports`
- `contradicts`
- `depends_on`
- `implements`
- `source_for`
- `handoff_to`
- `related`

Avoid dense decorative linking. Every important link should be explainable in one sentence.

## MCP Server

Big Brain DB includes a local stdio MCP server:

```bash
npm run mcp:brain-nodes -- --vault "/path/to/your/brain"
```

The MCP server can:

- list notes
- read notes
- write notes
- patch notes
- delete notes with confirmation
- move notes
- search notes
- build the graph
- inspect a note
- lint a Brain
- suggest relations
- add relations
- append to `log.md`
- ingest pasted text

The server only reads and writes below the configured `--vault` path. It rejects path traversal with `..`.

## Claude Code MCP Connection

Claude Code and other MCP clients do not automatically run a server just because a repository contains one. This is a security feature. You must explicitly register the server in the MCP client config.

Use an absolute path. Paths with spaces are fine when they are passed as JSON array arguments:

```json
{
  "mcpServers": {
    "big-brain-db": {
      "command": "node",
      "args": [
        "/absolute/path/to/big-brain-db/mcp/server.mjs",
        "--vault",
        "/absolute/path/to/your/brain",
        "--actor",
        "agent:claude-code",
        "--actor-name",
        "Claude Code"
      ]
    }
  }
}
```

For read-only inspection:

```json
{
  "mcpServers": {
    "big-brain-db-readonly": {
      "command": "node",
      "args": [
        "/absolute/path/to/big-brain-db/mcp/server.mjs",
        "--vault",
        "/absolute/path/to/your/brain",
        "--actor",
        "agent:claude-code",
        "--actor-name",
        "Claude Code",
        "--readonly"
      ]
    }
  }
}
```

## Agent Start Prompt

Copy this prompt into a new agent session when you want an agent to continue a Brain.

```text
You are working inside Big Brain DB, an agent-first Markdown Brain database.

Your job is to continue the selected Brain as durable knowledge infrastructure, not as disposable chat context. Preserve structure, links, sources, decisions, contradictions, open questions, and handoff notes so future humans and agents can continue without rediscovering the same context.

Before doing any work:
1. Confirm that the Big Brain DB web app is running locally, usually at http://localhost:3000.
2. Confirm the Brain folder you are responsible for.
3. Read the Brain file completely. It is usually named <brain-name>-brain.md.
4. Read AGENT_START.md completely.
5. Read log.md for recent work, decisions, lint findings, and unresolved tasks.
6. If MCP is available, call get_server_info, list_notes, and lint_brain before editing.
7. Identify whether the task is query, ingest, lint, maintenance, refactor, collaboration, or release work.
8. Identify the ownership boundary: what this Brain owns, what belongs in another Brain, and what should remain only as a source.

Operating rules:
- Prefer durable Markdown pages over hidden chat memory.
- Use wiki links for semantic relationships.
- Keep important nodes reachable from the Brain file or a meaningful hub page.
- Preserve raw sources and source-backed claims.
- Mark uncertainty as Open Questions.
- Record contradictions instead of smoothing them over.
- Avoid decorative link spam.
- Do not invent facts.
- Do not delete or rewrite user content unless the task explicitly requires it.
- Do not expose secrets, private env values, service role keys, tokens, credentials, or private data.
- Keep file names stable and link-friendly.
- Do not create folder README files automatically.

When answering a question:
1. Search the Brain first.
2. Read relevant sources and linked pages.
3. Answer with citations to the pages or files used.
4. If the answer creates durable synthesis, save it as a page and link it from the Brain file, a hub, or log.md.

When ingesting:
1. Read one source at a time when possible.
2. Preserve the unprocessed source first under raw/.
3. Create a structured source note and link it back to the raw note with raw_source.
4. Extract durable claims, entities, concepts, contradictions, decisions, and open questions.
5. Create or update concept/entity/project/synthesis notes only when they add durable value.
6. Link the new material semantically.
7. Update the Brain file if the navigation map or ownership changed.
8. Append a concise log.md entry with summary, files touched, decisions, sources, and open questions.

When linting:
1. Check unresolved links, orphan pages, duplicate titles, weak source coverage, stale metadata, contradictions, missing backlinks, and old protocol terminology.
2. Separate findings from fixes.
3. Fix clear local issues when authorized.
4. Record unresolved findings in log.md.

When editing app code:
1. Read the relevant code before changing it.
2. Follow existing patterns.
3. Keep edits scoped.
4. Avoid unrelated refactors.
5. Run npm run typecheck after substantive changes.
6. Run npm run build before release or GitHub publishing.

When using collaboration:
1. Treat humans and agents as actors.
2. Use canonical actor IDs such as user:local-owner or agent:claude-code.
3. Do not duplicate actor name/type frontmatter when the actor ID already encodes the identity.
4. Use invite codes for joining.
5. Let the invited person choose their own collaborator name when joining.

When using MCP:
1. Prefer read_note, search_notes, get_graph, inspect_note, and lint_brain before writing.
2. Prefer patch_note for precise edits.
3. Use write_note only when creating a new note or intentionally overwriting.
4. Use append_log for durable maintenance history.
5. Use ingest_text for pasted source material; it always writes raw/ first and then creates the linked source note.
6. Never write outside the configured vault.

End every meaningful work session by:
1. Updating log.md if durable work was done.
2. Updating the Brain file if navigation, ownership, or workflows changed.
3. Reporting what changed, what was validated, and what remains risky or unresolved.
```

## Development Commands

```bash
npm run dev
npm run typecheck
npm run build
npm run mcp:brain-nodes -- --vault "/path/to/your/brain"
```

## GitHub Publishing Checklist

Before publishing:

- Confirm `.env.local` is ignored.
- Confirm `.env*.local` is ignored.
- Confirm no real Supabase keys appear in tracked files.
- Confirm `demo-wikis/` is ignored or removed from the commit.
- Run `npm run typecheck`.
- Run `npm run build`.
- Review `README.md`, `AGENT_START.md`, and `big-brain-db.md` for stale protocol terminology.
- Do not publish local user Brains unless they are intentionally public.

## License

Add a license before publishing if you want others to reuse the project.
