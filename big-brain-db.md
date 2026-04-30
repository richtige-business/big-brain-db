---
type: brain
tags: [brain, agent, home]
vault: "Big Brain DB"
status: active
---
# Big Brain DB Brain

## Purpose
Big Brain DB is the project Brain for the Big Brain DB application: an agent-first Markdown knowledge database with graph navigation, local vaults, collaboration, and MCP access for coding agents.

## Role In The Big Brain
- Owns: product architecture, graph behavior, Brain file conventions, collaboration flow, MCP server behavior, Supabase setup, release notes, and agent operating rules for this repository.
- Does not own: private user knowledge, demo Brain data, or domain-specific content that should live in a separate Sub-Brain.
- Connects to: loaded Sub-Brains when they demonstrate app behavior, graph semantics, agent workflows, or cross-Brain navigation.
- Entry point: this Brain file is the anchor, map, and agent contract for maintainers working on Big Brain DB.

## Agent Start Here
1. Read [[AGENT_START]] completely.
2. Read this Brain file completely.
3. Read [[log]] for recent changes, unresolved issues, and maintenance notes.
4. Use the Navigation Map below as the local map.
5. Identify whether the current task affects app code, MCP code, Brain templates, docs, collaboration, or release hygiene.
6. Only edit after you understand the ownership and the expected user-facing behavior.

## Navigation Map

### Core Nodes
- [[AGENT_START]] - copyable startup prompt for agents.
- [[big-brain-db]] - this Brain anchor, map, and role contract.
- [[log]] - chronological maintenance history.
- [[index]] - legacy/root navigation note; keep lightweight and avoid duplicating this Brain file.

### Code Areas
- `src/lib/wiki.ts` - core Brain data model, vault loading, graph construction, collaboration state, frontmatter signing, and IndexedDB persistence.
- `src/app/page.tsx` - main UI, graph view, sidebar, editor, collaboration panel, reconnect flow, and invite flow.
- `src/app/api/brain-invites/` - server-side invite creation and invite acceptance.
- `src/lib/server/` - invite code hashing and local invite fallback store.
- `mcp/server.mjs` - local stdio MCP server for Claude Code, Cursor, and other MCP clients.

### Public Release Files
- [[README]] - public GitHub README.
- `.env.local.example` - safe placeholder environment variables only.
- `.gitignore` - must ignore local secrets, build output, node modules, and demo vaults.

## Workflows

### Query
- Answer from this Brain and source files first.
- Cite code paths when useful.
- If the answer creates durable project knowledge, update this Brain file, [[README]], or [[log]].

### Ingest
- Read one source or issue at a time.
- Always preserve the unprocessed source first under `raw/` before creating or updating any source, concept, project, or synthesis note.
- Every structured source note created from pasted text must link back to its raw note with `raw_source`.
- Extract durable claims, decisions, implementation constraints, contradictions, and open questions.
- Update affected pages, links, frontmatter, this Brain file, and [[log]].

### Lint
- Check for orphaned docs, stale protocol terminology, duplicated agent instructions, exposed secrets, broken links, missing Supabase guidance, and unclear MCP setup.
- Record concise findings in [[log]] or the relevant page.

### Maintenance
- Keep file names stable and link-friendly.
- Prefer Brain terminology over protocol terminology, except when referring to MCP as the external Model Context Protocol standard.
- Do not publish demo vaults or private `.env.local` files to GitHub.
- Validate `npm run typecheck` and `npm run build` after substantive app-code edits.

## Public Release Rules
- The project name is Big Brain DB.
- README content should be English.
- Mention Andrej Karpathy as inspiration, not as an endorsement.
- Do not include real Supabase URLs, anon keys, or service role keys.
- Supabase setup must be documented with placeholders and schema guidance.
- Agent setup must say that the local app should be running on localhost before an agent continues a Brain.
- MCP setup must explain how to connect Claude Code to `mcp/server.mjs`.

## Agent Handoff Notes
- Start with [[AGENT_START]], then this Brain file, then [[log]].
- Treat demo-wikis as local examples only; they are ignored for GitHub.
- Keep the README clear enough for a new user to install, run, connect Supabase, start MCP, and continue a Brain with an agent.
