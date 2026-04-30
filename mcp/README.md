# Big Brain DB MCP

`brain-nodes-mcp` is the local MCP server included with Big Brain DB. It works with Markdown-based Brain/Vault folders and lets MCP clients such as Claude Code, Cursor, and other agents read, search, edit, lint, and maintain graph relations through wiki links.

## Start

From this project:

```bash
npm run mcp:brain-nodes -- --vault "/path/to/your/brain"
```

Or directly:

```bash
npx brain-nodes-mcp --vault "/path/to/your/brain" --actor "agent:claude-code" --actor-name "Claude Code"
```

Use `--readonly` for inspection-only access. Writes stamp notes with canonical Brain metadata (`created_by`, `created_at`, `updated_by`, `updated_at`, `last_change_summary`) and do not duplicate actor name/type fields.

## MCP Client Config

Use this shape in clients that accept a JSON MCP config:

```json
{
  "mcpServers": {
    "brain-nodes-mcp": {
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

If the package is installed globally or exposed by the client shell, you can use:

```json
{
  "mcpServers": {
    "brain-nodes-mcp": {
      "command": "brain-nodes-mcp",
      "args": ["--vault", "/absolute/path/to/your/brain"]
    }
  }
}
```

## Tools

- `get_server_info`: server, actor, vault, and capability metadata.
- `list_notes`: list Markdown notes.
- `read_note`: read a note, optionally with graph analysis.
- `write_note`: create, overwrite, or append to a note.
- `patch_note`: replace exact text in a note.
- `delete_note`: delete a note, requiring `confirm=true`.
- `move_note`: rename or move a note inside the vault.
- `search_notes`: keyword search over titles, paths, tags, and bodies.
- `get_graph`: build the wiki-link graph.
- `inspect_note`: show backlinks, outgoing links, tags, frontmatter, and unresolved links.
- `lint_brain`: find unresolved links, orphan notes, duplicate titles, empty notes, and missing core files.
- `suggest_relations`: suggest useful links from tags, shared terms, mentions, and backlinks.
- `add_relation`: add a wiki link under a `Related` section.
- `append_log`: append a structured entry to `log.md`.
- `ingest_text`: preserve pasted text as a raw note first, then create a linked source note.

## Safety Model

The server only reads and writes below the configured `--vault` path. Paths containing `..` are rejected. Write operations stamp frontmatter with the MCP actor ID by default. `ingest_text` always stores the unprocessed source in `raw/` before creating the structured source note. Destructive deletion requires explicit `confirm=true`.
