#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SERVER_NAME = 'brain-nodes-mcp';
const SERVER_VERSION = '0.1.0';
const LINK_PATTERN = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g;
const HIDDEN_FOLDERS = new Set(['.git', '.next', '.obsidian', 'node_modules']);
const DEFAULT_LIMIT = 50;

function parseArgs(argv) {
  const args = {
    vault: process.env.BRAIN_NODES_VAULT || '',
    actor: process.env.BRAIN_NODES_ACTOR || 'agent:mcp',
    actorName: process.env.BRAIN_NODES_ACTOR_NAME || 'MCP Agent',
    readOnly: ['1', 'true', 'yes'].includes((process.env.BRAIN_NODES_READONLY || '').toLowerCase()),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--vault' && next) {
      args.vault = next;
      i += 1;
    } else if (arg.startsWith('--vault=')) {
      args.vault = arg.slice('--vault='.length);
    } else if (arg === '--actor' && next) {
      args.actor = next;
      i += 1;
    } else if (arg.startsWith('--actor=')) {
      args.actor = arg.slice('--actor='.length);
    } else if (arg === '--actor-name' && next) {
      args.actorName = next;
      i += 1;
    } else if (arg.startsWith('--actor-name=')) {
      args.actorName = arg.slice('--actor-name='.length);
    } else if (arg === '--readonly' || arg === '--read-only') {
      args.readOnly = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelpAndExit();
    }
  }

  if (!args.vault) {
    throw new Error('Missing vault path. Pass --vault "/path/to/brain" or set BRAIN_NODES_VAULT.');
  }

  return args;
}

function printHelpAndExit() {
  process.stdout.write(`brain-nodes-mcp

Usage:
  brain-nodes-mcp --vault "/path/to/markdown-vault" [--actor agent:claude-code] [--actor-name "Claude Code"] [--readonly]

Environment:
  BRAIN_NODES_VAULT
  BRAIN_NODES_ACTOR
  BRAIN_NODES_ACTOR_NAME
  BRAIN_NODES_READONLY=true
`);
  process.exit(0);
}

function cleanTarget(target) {
  return target.trim().replace(/\.md$/i, '').replace(/^\/+/, '');
}

function normalizeSlashes(value) {
  return value.replace(/\\/g, '/');
}

function ensureLimit(limit, fallback = DEFAULT_LIMIT, max = 500) {
  const numeric = Number(limit);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(Math.floor(numeric), max);
}

function fileTitle(note) {
  const firstHeading = note.content.match(/^#\s+(.+)$/m);
  return firstHeading?.[1]?.trim() || path.basename(note.path, '.md');
}

function pathWithoutMarkdownExtension(value) {
  return normalizeSlashes(value).replace(/\.md$/i, '');
}

function unique(values) {
  return Array.from(new Set(values));
}

function jsonResponse(data) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function textResponse(text) {
  return {
    content: [
      {
        type: 'text',
        text,
      },
    ],
  };
}

function assertWritable(context) {
  if (context.readOnly) {
    throw new Error('This brain-nodes-mcp instance is running in read-only mode.');
  }
}

function createVault(context) {
  const root = path.resolve(context.vaultRoot);

  function resolveInside(relativePath = '') {
    const normalized = normalizeSlashes(String(relativePath)).replace(/^\/+/, '');
    if (normalized.split('/').some((part) => part === '..')) {
      throw new Error(`Path escapes the vault: ${relativePath}`);
    }
    const absolute = path.resolve(root, normalized);
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
      throw new Error(`Path escapes the vault: ${relativePath}`);
    }
    return absolute;
  }

  async function exists(absolutePath) {
    try {
      await fs.access(absolutePath);
      return true;
    } catch {
      return false;
    }
  }

  async function statIfExists(absolutePath) {
    try {
      return await fs.stat(absolutePath);
    } catch {
      return null;
    }
  }

  function relativeFromAbsolute(absolutePath) {
    return normalizeSlashes(path.relative(root, absolutePath));
  }

  async function resolveNotePath(notePath, options = {}) {
    const raw = String(notePath || '').trim();
    if (!raw) throw new Error('Missing note path.');
    const normalized = normalizeSlashes(raw).replace(/^\/+/, '');
    const candidates = [normalized];
    if (options.defaultMarkdownExtension !== false && !normalized.toLowerCase().endsWith('.md')) {
      candidates.push(`${normalized}.md`);
    }

    if (options.mustExist !== false) {
      for (const candidate of candidates) {
        const absolute = resolveInside(candidate);
        const stats = await statIfExists(absolute);
        if (stats?.isFile()) return { absolute, relative: relativeFromAbsolute(absolute) };
      }
      throw new Error(`Note not found: ${notePath}`);
    }

    const target = candidates[candidates.length - 1];
    const absolute = resolveInside(target);
    return { absolute, relative: relativeFromAbsolute(absolute) };
  }

  async function listMarkdownFiles(startRelative = '') {
    const start = resolveInside(startRelative);
    const startStats = await statIfExists(start);
    if (!startStats) throw new Error(`Path not found: ${startRelative || '.'}`);
    const files = [];

    async function walk(directory) {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (HIDDEN_FOLDERS.has(entry.name) || entry.name.startsWith('.')) continue;
          await walk(path.join(directory, entry.name));
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
          files.push(path.join(directory, entry.name));
        }
      }
    }

    if (startStats.isDirectory()) {
      await walk(start);
    } else if (startStats.isFile() && start.endsWith('.md')) {
      files.push(start);
    }

    files.sort((a, b) => relativeFromAbsolute(a).localeCompare(relativeFromAbsolute(b)));
    return files;
  }

  async function readNote(notePath) {
    const note = await resolveNotePath(notePath);
    const content = await fs.readFile(note.absolute, 'utf8');
    const stats = await fs.stat(note.absolute);
    return {
      id: note.relative,
      path: note.relative,
      title: fileTitle({ path: note.relative, content }),
      content,
      size: stats.size,
      updatedAt: stats.mtime.toISOString(),
    };
  }

  async function readAllNotes(startRelative = '') {
    const files = await listMarkdownFiles(startRelative);
    const notes = [];
    for (const absolute of files) {
      const relative = relativeFromAbsolute(absolute);
      const content = await fs.readFile(absolute, 'utf8');
      const stats = await fs.stat(absolute);
      notes.push({
        id: relative,
        path: relative,
        title: fileTitle({ path: relative, content }),
        content,
        size: stats.size,
        updatedAt: stats.mtime.toISOString(),
      });
    }
    return notes;
  }

  async function writeNote(notePath, content, options = {}) {
    assertWritable(context);
    const note = await resolveNotePath(notePath, { mustExist: false });
    const alreadyExists = await exists(note.absolute);
    if (alreadyExists && options.mode === 'create') {
      throw new Error(`Note already exists: ${note.relative}`);
    }
    if (!alreadyExists && options.mode === 'append') {
      throw new Error(`Cannot append to missing note: ${note.relative}`);
    }
    await fs.mkdir(path.dirname(note.absolute), { recursive: true });

    const nextContent =
      options.mode === 'append' && alreadyExists
        ? `${await fs.readFile(note.absolute, 'utf8')}${content.startsWith('\n') ? '' : '\n'}${content}`
        : content;

    const stamped = options.stamp === false ? nextContent : stampContent(nextContent, context, options.summary);
    await fs.writeFile(note.absolute, stamped, 'utf8');
    return readNote(note.relative);
  }

  async function patchNote(notePath, oldText, newText, options = {}) {
    assertWritable(context);
    const note = await readNote(notePath);
    if (!oldText) throw new Error('oldText must not be empty.');
    const occurrences = note.content.split(oldText).length - 1;
    if (occurrences === 0) throw new Error(`Text to replace was not found in ${note.path}.`);
    if (occurrences > 1 && !options.replaceAll) {
      throw new Error(`Text occurs ${occurrences} times. Pass replaceAll=true or use a more specific oldText.`);
    }
    const replaced = options.replaceAll ? note.content.split(oldText).join(newText) : note.content.replace(oldText, newText);
    const stamped = options.stamp === false ? replaced : stampContent(replaced, context, options.summary || 'Patched note');
    await fs.writeFile(resolveInside(note.path), stamped, 'utf8');
    return {
      note: await readNote(note.path),
      replacements: options.replaceAll ? occurrences : 1,
    };
  }

  async function deleteNote(notePath, confirm = false) {
    assertWritable(context);
    if (!confirm) throw new Error('Deletion requires confirm=true.');
    const note = await resolveNotePath(notePath);
    await fs.unlink(note.absolute);
    return { deleted: note.relative };
  }

  async function moveNote(fromPath, toPath, overwrite = false) {
    assertWritable(context);
    const from = await resolveNotePath(fromPath);
    const to = await resolveNotePath(toPath, { mustExist: false });
    const targetExists = await exists(to.absolute);
    if (targetExists && !overwrite) throw new Error(`Target already exists: ${to.relative}`);
    await fs.mkdir(path.dirname(to.absolute), { recursive: true });
    await fs.rename(from.absolute, to.absolute);
    return readNote(to.relative);
  }

  return {
    root,
    resolveInside,
    resolveNotePath,
    listMarkdownFiles,
    readNote,
    readAllNotes,
    writeNote,
    patchNote,
    deleteNote,
    moveNote,
  };
}

function extractLinks(content) {
  const targets = [];
  for (const match of content.matchAll(LINK_PATTERN)) targets.push(cleanTarget(match[1]));
  return targets;
}

function parseFrontmatter(content) {
  if (!content.startsWith('---')) return { properties: {}, body: content, hasFrontmatter: false };
  const lines = content.split('\n');
  if (lines[0].trim() !== '---') return { properties: {}, body: content, hasFrontmatter: false };
  let endIndex = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      endIndex = i;
      break;
    }
  }
  if (endIndex === -1) return { properties: {}, body: content, hasFrontmatter: false };

  const properties = {};
  for (let i = 1; i < endIndex; i += 1) {
    const line = lines[i];
    const match = line.match(/^([^:]+):(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    const raw = match[2].trim();
    if (raw.startsWith('[') && raw.endsWith(']')) {
      properties[key] = raw
        .slice(1, -1)
        .split(',')
        .map((item) => item.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    } else {
      properties[key] = raw.replace(/^["']|["']$/g, '');
    }
  }

  return {
    properties,
    body: lines.slice(endIndex + 1).join('\n').replace(/^\n+/, ''),
    hasFrontmatter: true,
    frontmatterEndLine: endIndex,
  };
}

function formatFrontmatterValue(value) {
  if (Array.isArray(value)) return `[${value.map((item) => formatFrontmatterValue(item)).join(', ')}]`;
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[:#\[\]{},&*!|>'"%@`]/.test(text) || /^(true|false|null|\d)/i.test(text)) {
    return `"${text.replace(/"/g, '\\"')}"`;
  }
  return text;
}

const LEGACY_SIGNATURE_PROPERTIES = new Set([
  'created_by_name',
  'created_by_type',
  'updated_by_name',
  'updated_by_type',
  'last_change_actor',
  'last_change_actor_name',
  'last_change_actor_type',
  'last_updated',
  'change_summary',
  'mcp_server',
]);

function stampContent(content, context, summary = 'Updated by MCP agent') {
  const parsed = parseFrontmatter(content);
  const now = new Date().toISOString();
  const properties = Object.fromEntries(
    Object.entries(parsed.properties).filter(([key]) => !LEGACY_SIGNATURE_PROPERTIES.has(key)),
  );
  properties.updated_by = context.actor;
  properties.updated_at = now;
  properties.last_change_summary = summary;
  if (!properties.created_at) properties.created_at = now;
  if (!properties.created_by) properties.created_by = context.actor;

  const frontmatter = ['---', ...Object.entries(properties).map(([key, value]) => `${key}: ${formatFrontmatterValue(value)}`), '---', ''].join('\n');
  return `${frontmatter}${parsed.body.replace(/^\n+/, '')}`;
}

function buildLinkIndex(notes) {
  const index = new Map();
  function add(key, note) {
    const clean = cleanTarget(key).toLowerCase();
    if (!clean) return;
    const matches = index.get(clean) || [];
    if (!matches.some((match) => match.path === note.path)) matches.push(note);
    index.set(clean, matches);
  }

  for (const note of notes) {
    const cleanPath = pathWithoutMarkdownExtension(note.path).toLowerCase();
    const parts = cleanPath.split('/').filter(Boolean);
    add(cleanPath, note);
    add(note.title, note);
    for (let i = 1; i < parts.length; i += 1) add(parts.slice(i).join('/'), note);
  }
  return index;
}

function resolveLink(index, target) {
  const clean = cleanTarget(target).toLowerCase();
  const matches = index.get(clean) || [];
  return matches[0];
}

function buildGraph(notes) {
  const index = buildLinkIndex(notes);
  const nodes = new Map();
  const edges = [];
  const backlinks = new Map();
  const outgoing = new Map();
  const unresolvedByNote = new Map();

  for (const note of notes) {
    nodes.set(note.path, {
      id: note.path,
      path: note.path,
      title: note.title,
      weight: 0,
      unresolved: false,
    });
    backlinks.set(note.path, new Set());
    outgoing.set(note.path, new Set());
    unresolvedByNote.set(note.path, []);
  }

  for (const note of notes) {
    const seen = new Set();
    for (const target of extractLinks(note.content)) {
      const resolved = resolveLink(index, target);
      const targetId = resolved?.path || `unresolved:${target}`;
      if (seen.has(targetId) || targetId === note.path) continue;
      seen.add(targetId);
      outgoing.get(note.path)?.add(targetId);

      if (resolved) {
        backlinks.get(resolved.path)?.add(note.path);
        nodes.get(note.path).weight += 1;
        nodes.get(resolved.path).weight += 1;
        edges.push({ id: `${note.path}->${resolved.path}`, source: note.path, target: resolved.path, unresolved: false });
      } else {
        if (!nodes.has(targetId)) {
          nodes.set(targetId, {
            id: targetId,
            path: target,
            title: target.split('/').pop() || target,
            weight: 0,
            unresolved: true,
          });
        }
        unresolvedByNote.get(note.path)?.push(target);
        nodes.get(note.path).weight += 1;
        nodes.get(targetId).weight += 1;
        edges.push({ id: `${note.path}->${targetId}`, source: note.path, target: targetId, unresolved: true });
      }
    }
  }

  return {
    nodes: Array.from(nodes.values()),
    edges,
    backlinks,
    outgoing,
    unresolvedByNote,
    linkIndex: index,
  };
}

function getTags(note) {
  const tags = parseFrontmatter(note.content).properties.tags;
  if (Array.isArray(tags)) return tags.map(String);
  if (typeof tags === 'string') return tags.split(/[,\s]+/).filter(Boolean);
  return [];
}

function tokenize(text) {
  return unique(
    text
      .toLowerCase()
      .replace(/[\W_]+/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length >= 4)
      .filter((word) => !['this', 'that', 'with', 'from', 'eine', 'einer', 'einem', 'oder', 'aber', 'auch', 'nicht', 'dass'].includes(word)),
  );
}

function scoreSearch(note, queryTerms) {
  const parsed = parseFrontmatter(note.content);
  const title = note.title.toLowerCase();
  const notePath = note.path.toLowerCase();
  const body = parsed.body.toLowerCase();
  const tags = getTags(note).join(' ').toLowerCase();
  let score = 0;
  for (const term of queryTerms) {
    if (title.includes(term)) score += 8;
    if (notePath.includes(term)) score += 4;
    if (tags.includes(term)) score += 5;
    const bodyMatches = body.split(term).length - 1;
    score += Math.min(bodyMatches, 12);
  }
  return score;
}

function bestSnippet(note, queryTerms) {
  const lines = note.content.split('\n');
  const hitIndex = lines.findIndex((line) => queryTerms.some((term) => line.toLowerCase().includes(term)));
  if (hitIndex === -1) return lines.slice(0, 8).join('\n').trim();
  const start = Math.max(0, hitIndex - 2);
  const end = Math.min(lines.length, hitIndex + 4);
  return lines.slice(start, end).join('\n').trim();
}

function inspectNote(note, graph) {
  const parsed = parseFrontmatter(note.content);
  const outgoing = Array.from(graph.outgoing.get(note.path) || []);
  const backlinks = Array.from(graph.backlinks.get(note.path) || []);
  const unresolvedLinks = graph.unresolvedByNote.get(note.path) || [];
  return {
    path: note.path,
    title: note.title,
    properties: parsed.properties,
    tags: getTags(note),
    outgoingLinks: outgoing,
    backlinks,
    unresolvedLinks,
    linkCount: outgoing.length,
    backlinkCount: backlinks.length,
  };
}

function lintNotes(notes) {
  const graph = buildGraph(notes);
  const duplicateTitleMap = new Map();
  for (const note of notes) {
    const key = note.title.toLowerCase();
    duplicateTitleMap.set(key, [...(duplicateTitleMap.get(key) || []), note.path]);
  }

  const unresolvedLinks = [];
  const orphanNotes = [];
  const missingFrontmatter = [];
  const emptyNotes = [];
  const duplicateTitles = [];

  for (const note of notes) {
    const unresolved = graph.unresolvedByNote.get(note.path) || [];
    for (const target of unresolved) unresolvedLinks.push({ source: note.path, target });
    const backlinkCount = graph.backlinks.get(note.path)?.size || 0;
    const outgoingCount = graph.outgoing.get(note.path)?.size || 0;
    if (backlinkCount === 0 && outgoingCount === 0) orphanNotes.push(note.path);
    if (!parseFrontmatter(note.content).hasFrontmatter) missingFrontmatter.push(note.path);
    if (!parseFrontmatter(note.content).body.trim()) emptyNotes.push(note.path);
  }

  for (const [title, paths] of duplicateTitleMap) {
    if (paths.length > 1) duplicateTitles.push({ title, paths });
  }

  return {
    stats: {
      notes: notes.length,
      graphNodes: graph.nodes.length,
      graphEdges: graph.edges.length,
      unresolvedLinks: unresolvedLinks.length,
      orphanNotes: orphanNotes.length,
      missingFrontmatter: missingFrontmatter.length,
      emptyNotes: emptyNotes.length,
      duplicateTitles: duplicateTitles.length,
    },
    unresolvedLinks,
    orphanNotes,
    missingFrontmatter,
    emptyNotes,
    duplicateTitles,
    missingCoreFiles: ['AGENT_START.md', 'log.md'].filter((file) => !notes.some((note) => note.path === file)),
  };
}

function relationScore(source, candidate, graph) {
  if (source.path === candidate.path) return null;
  const outgoing = graph.outgoing.get(source.path) || new Set();
  if (outgoing.has(candidate.path)) return null;

  const sourceTags = new Set(getTags(source).map((tag) => tag.toLowerCase()));
  const candidateTags = new Set(getTags(candidate).map((tag) => tag.toLowerCase()));
  const sharedTags = Array.from(sourceTags).filter((tag) => candidateTags.has(tag));
  const sourceTokens = new Set(tokenize(`${source.title}\n${parseFrontmatter(source.content).body}`));
  const candidateTokens = new Set(tokenize(`${candidate.title}\n${parseFrontmatter(candidate.content).body}`));
  const sharedTokens = Array.from(sourceTokens).filter((token) => candidateTokens.has(token));
  const candidateMentioned = source.content.toLowerCase().includes(candidate.title.toLowerCase());
  const sourceMentioned = candidate.content.toLowerCase().includes(source.title.toLowerCase());
  const backlinkExists = graph.outgoing.get(candidate.path)?.has(source.path);
  const score =
    sharedTags.length * 5 +
    Math.min(sharedTokens.length, 12) +
    (candidateMentioned ? 8 : 0) +
    (sourceMentioned ? 6 : 0) +
    (backlinkExists ? 10 : 0);

  if (score <= 0) return null;
  return {
    source: source.path,
    target: candidate.path,
    targetTitle: candidate.title,
    wikilink: `[[${pathWithoutMarkdownExtension(candidate.path)}]]`,
    score,
    reasons: [
      ...sharedTags.slice(0, 5).map((tag) => `shared tag: ${tag}`),
      ...sharedTokens.slice(0, 8).map((token) => `shared term: ${token}`),
      candidateMentioned ? 'source mentions target title' : null,
      sourceMentioned ? 'target mentions source title' : null,
      backlinkExists ? 'target already links back to source' : null,
    ].filter(Boolean),
  };
}

function suggestRelations(notes, graph, options) {
  const limit = ensureLimit(options.limit, 10, 100);
  if (options.path) {
    const source = notes.find((note) => note.path === options.path || pathWithoutMarkdownExtension(note.path) === cleanTarget(options.path));
    if (!source) throw new Error(`Note not found: ${options.path}`);
    return notes
      .map((candidate) => relationScore(source, candidate, graph))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  const terms = tokenize(options.query || '');
  if (terms.length === 0) throw new Error('Pass either path or query.');
  return notes
    .map((note) => {
      const score = scoreSearch(note, terms);
      return score > 0
        ? {
            target: note.path,
            targetTitle: note.title,
            wikilink: `[[${pathWithoutMarkdownExtension(note.path)}]]`,
            score,
            reasons: ['matches relation query'],
          }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function addRelationToContent(content, wikilink, sectionTitle = 'Related', note = '') {
  if (content.includes(wikilink)) return { content, changed: false };
  const bullet = note ? `- ${wikilink} - ${note}` : `- ${wikilink}`;
  const headingPattern = new RegExp(`(^##\\s+${sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$)`, 'im');
  const match = content.match(headingPattern);
  if (!match || match.index === undefined) {
    const separator = content.endsWith('\n') ? '' : '\n';
    return { content: `${content}${separator}\n## ${sectionTitle}\n${bullet}\n`, changed: true };
  }

  const insertAt = match.index + match[0].length;
  const before = content.slice(0, insertAt);
  const after = content.slice(insertAt);
  return { content: `${before}\n${bullet}${after.startsWith('\n') ? '' : '\n'}${after}`, changed: true };
}

async function registerTools(server, context) {
  const vault = createVault(context);

  server.registerTool(
    'get_server_info',
    {
      description: 'Return brain-nodes-mcp server metadata, active vault path, actor, and available capabilities.',
      inputSchema: {},
    },
    async () =>
      jsonResponse({
        name: SERVER_NAME,
        version: SERVER_VERSION,
        vaultRoot: vault.root,
        actor: context.actor,
        actorName: context.actorName,
        readOnly: context.readOnly,
        capabilities: [
          'list_notes',
          'read_note',
          'write_note',
          'patch_note',
          'delete_note',
          'move_note',
          'search_notes',
          'get_graph',
          'inspect_note',
          'lint_brain',
          'suggest_relations',
          'add_relation',
          'append_log',
          'ingest_text',
        ],
      }),
  );

  server.registerTool(
    'list_notes',
    {
      description: 'List Markdown notes in the vault, optionally limited to a folder.',
      inputSchema: {
        path: z.string().optional().describe('Optional folder or note path relative to the vault.'),
        limit: z.number().int().positive().max(500).optional(),
        includeMetadata: z.boolean().optional(),
      },
    },
    async ({ path: startPath = '', limit, includeMetadata = false }) => {
      const notes = await vault.readAllNotes(startPath);
      const bounded = notes.slice(0, ensureLimit(limit, DEFAULT_LIMIT, 500));
      return jsonResponse({
        vaultRoot: vault.root,
        total: notes.length,
        returned: bounded.length,
        notes: bounded.map((note) => ({
          path: note.path,
          title: note.title,
          ...(includeMetadata ? { size: note.size, updatedAt: note.updatedAt, tags: getTags(note) } : {}),
        })),
      });
    },
  );

  server.registerTool(
    'read_note',
    {
      description: 'Read a Markdown note by vault-relative path. Paths without .md are resolved automatically.',
      inputSchema: {
        path: z.string().min(1),
        includeAnalysis: z.boolean().optional(),
      },
    },
    async ({ path: notePath, includeAnalysis = false }) => {
      const note = await vault.readNote(notePath);
      if (!includeAnalysis) return jsonResponse(note);
      const notes = await vault.readAllNotes();
      const graph = buildGraph(notes);
      return jsonResponse({ ...note, analysis: inspectNote(note, graph) });
    },
  );

  server.registerTool(
    'write_note',
    {
      description: 'Create, overwrite, or append to a Markdown note. Writes are stamped with canonical Brain actor metadata by default.',
      inputSchema: {
        path: z.string().min(1),
        content: z.string(),
        mode: z.enum(['create', 'overwrite', 'append']).optional(),
        summary: z.string().optional(),
        stamp: z.boolean().optional(),
      },
    },
    async ({ path: notePath, content, mode = 'create', summary = 'Wrote note via MCP', stamp = true }) =>
      jsonResponse(await vault.writeNote(notePath, content, { mode, summary, stamp })),
  );

  server.registerTool(
    'patch_note',
    {
      description: 'Replace exact text in a note. Use this for precise edits instead of overwriting whole files.',
      inputSchema: {
        path: z.string().min(1),
        oldText: z.string().min(1),
        newText: z.string(),
        replaceAll: z.boolean().optional(),
        summary: z.string().optional(),
        stamp: z.boolean().optional(),
      },
    },
    async ({ path: notePath, oldText, newText, replaceAll = false, summary, stamp = true }) =>
      jsonResponse(await vault.patchNote(notePath, oldText, newText, { replaceAll, summary, stamp })),
  );

  server.registerTool(
    'delete_note',
    {
      description: 'Delete a note. Requires confirm=true to prevent accidental destructive actions.',
      inputSchema: {
        path: z.string().min(1),
        confirm: z.boolean(),
      },
    },
    async ({ path: notePath, confirm }) => jsonResponse(await vault.deleteNote(notePath, confirm)),
  );

  server.registerTool(
    'move_note',
    {
      description: 'Rename or move a note within the vault sandbox.',
      inputSchema: {
        fromPath: z.string().min(1),
        toPath: z.string().min(1),
        overwrite: z.boolean().optional(),
      },
    },
    async ({ fromPath, toPath, overwrite = false }) => jsonResponse(await vault.moveNote(fromPath, toPath, overwrite)),
  );

  server.registerTool(
    'search_notes',
    {
      description: 'Keyword search over note title, path, tags, and content.',
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().positive().max(100).optional(),
        includeContent: z.boolean().optional(),
      },
    },
    async ({ query, limit, includeContent = false }) => {
      const notes = await vault.readAllNotes();
      const terms = tokenize(query);
      const hits = notes
        .map((note) => ({ note, score: scoreSearch(note, terms) }))
        .filter((hit) => hit.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, ensureLimit(limit, 10, 100))
        .map(({ note, score }) => ({
          path: note.path,
          title: note.title,
          score,
          tags: getTags(note),
          snippet: bestSnippet(note, terms),
          ...(includeContent ? { content: note.content } : {}),
        }));
      return jsonResponse({ query, hits });
    },
  );

  server.registerTool(
    'get_graph',
    {
      description: 'Build the current graph from Markdown wiki links.',
      inputSchema: {
        includeUnresolved: z.boolean().optional(),
        limit: z.number().int().positive().max(1000).optional(),
      },
    },
    async ({ includeUnresolved = true, limit }) => {
      const notes = await vault.readAllNotes();
      const graph = buildGraph(notes);
      const maxItems = ensureLimit(limit, 1000, 1000);
      const nodes = graph.nodes.filter((node) => includeUnresolved || !node.unresolved).slice(0, maxItems);
      const nodeIds = new Set(nodes.map((node) => node.id));
      const edges = graph.edges
        .filter((edge) => includeUnresolved || !edge.unresolved)
        .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
        .slice(0, maxItems);
      return jsonResponse({
        stats: {
          notes: notes.length,
          nodes: graph.nodes.length,
          edges: graph.edges.length,
          unresolvedEdges: graph.edges.filter((edge) => edge.unresolved).length,
        },
        nodes,
        edges,
      });
    },
  );

  server.registerTool(
    'inspect_note',
    {
      description: 'Inspect one note: frontmatter, tags, outgoing links, backlinks, and unresolved links.',
      inputSchema: {
        path: z.string().min(1),
      },
    },
    async ({ path: notePath }) => {
      const notes = await vault.readAllNotes();
      const graph = buildGraph(notes);
      const note = await vault.readNote(notePath);
      return jsonResponse(inspectNote(note, graph));
    },
  );

  server.registerTool(
    'lint_brain',
    {
      description: 'Find graph and maintenance issues: unresolved links, orphans, duplicate titles, empty notes, and missing core files.',
      inputSchema: {},
    },
    async () => jsonResponse(lintNotes(await vault.readAllNotes())),
  );

  server.registerTool(
    'suggest_relations',
    {
      description: 'Suggest useful wiki-link relations for a note or relation query using tags, terms, mentions, and backlinks.',
      inputSchema: {
        path: z.string().optional(),
        query: z.string().optional(),
        limit: z.number().int().positive().max(100).optional(),
      },
    },
    async ({ path: notePath, query, limit }) => {
      const notes = await vault.readAllNotes();
      const graph = buildGraph(notes);
      return jsonResponse({ suggestions: suggestRelations(notes, graph, { path: notePath, query, limit }) });
    },
  );

  server.registerTool(
    'add_relation',
    {
      description: 'Add a wiki link from one note to another, under a Related section by default.',
      inputSchema: {
        sourcePath: z.string().min(1),
        targetPath: z.string().min(1),
        sectionTitle: z.string().optional(),
        note: z.string().optional(),
        summary: z.string().optional(),
      },
    },
    async ({ sourcePath, targetPath, sectionTitle = 'Related', note = '', summary = 'Added relation via MCP' }) => {
      const source = await vault.readNote(sourcePath);
      const target = await vault.readNote(targetPath);
      const wikilink = `[[${pathWithoutMarkdownExtension(target.path)}]]`;
      const next = addRelationToContent(source.content, wikilink, sectionTitle, note);
      if (!next.changed) return jsonResponse({ changed: false, path: source.path, wikilink });
      await vault.writeNote(source.path, next.content, { mode: 'overwrite', summary, stamp: true });
      return jsonResponse({ changed: true, path: source.path, target: target.path, wikilink });
    },
  );

  server.registerTool(
    'append_log',
    {
      description: 'Append a structured entry to log.md, creating it when missing.',
      inputSchema: {
        entryType: z.string().default('maintenance'),
        title: z.string().min(1),
        summary: z.string().min(1),
        filesTouched: z.array(z.string()).optional(),
        sources: z.array(z.string()).optional(),
        decisions: z.array(z.string()).optional(),
        openQuestions: z.array(z.string()).optional(),
      },
    },
    async ({ entryType = 'maintenance', title, summary, filesTouched = [], sources = [], decisions = [], openQuestions = [] }) => {
      const date = new Date().toISOString().slice(0, 10);
      const list = (items, fallback = 'none') => (items.length ? items.map((item) => `[[${pathWithoutMarkdownExtension(item)}]]`).join(', ') : fallback);
      const entry = `\n### [${date}] ${entryType} | ${title}\n- Summary: ${summary}\n- Files touched: ${list(filesTouched)}\n- Sources: ${sources.length ? sources.join(', ') : 'none'}\n- Decisions: ${decisions.length ? decisions.join('; ') : 'none'}\n- Open questions: ${openQuestions.length ? openQuestions.join('; ') : 'none'}\n`;
      const existing = await vault.readNote('log.md').catch(() => null);
      if (existing) {
        return jsonResponse(await vault.writeNote('log.md', entry, { mode: 'append', summary: `Logged ${entryType}: ${title}`, stamp: false }));
      }
      const content = `# Brain Log\n\nAppend-only chronological history for this Brain.\n${entry}`;
      return jsonResponse(await vault.writeNote('log.md', content, { mode: 'create', summary: `Created log entry: ${title}`, stamp: true }));
    },
  );

  server.registerTool(
    'ingest_text',
    {
      description: 'Ingest pasted text by first preserving an immutable raw note, then creating a linked source note.',
      inputSchema: {
        title: z.string().min(1),
        content: z.string().min(1),
        folder: z.string().optional(),
        rawFolder: z.string().optional(),
        tags: z.array(z.string()).optional(),
        source: z.string().optional(),
        summary: z.string().optional(),
      },
    },
    async ({ title, content, folder = 'sources', rawFolder = 'raw', tags = ['ingest'], source = '', summary = 'Ingested text via MCP' }) => {
      const safeTitle = title.replace(/\.md$/i, '').replace(/[/:\\?%*"<>|]/g, '-').replace(/\s+/g, ' ').trim() || 'Untitled';
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rawPath = normalizeSlashes(path.join(rawFolder, `${safeTitle} - ${stamp}.md`));
      const rawFrontmatter = `---\ntype: raw\ntags: [raw, ingest]\nsource: ${formatFrontmatterValue(source || 'manual')}\ningested_at: ${formatFrontmatterValue(new Date().toISOString())}\n---\n`;
      const rawBody = `${rawFrontmatter}# ${safeTitle} Raw\n\n${content}`;
      const rawNote = await vault.writeNote(rawPath, rawBody, { mode: 'create', summary: `Stored raw ingest: ${safeTitle}`, stamp: false });
      const rawLink = pathWithoutMarkdownExtension(rawNote.path);

      const notePath = normalizeSlashes(path.join(folder, `${safeTitle}.md`));
      const frontmatter = `---\ntype: source\ntags: [${tags.map((tag) => formatFrontmatterValue(tag)).join(', ')}]\nsource: ${formatFrontmatterValue(source || 'manual')}\nraw_source: ${formatFrontmatterValue(`[[${rawLink}]]`)}\n---\n`;
      const body = `${frontmatter}# ${safeTitle}\n\nRaw source: [[${rawLink}]]\n\n${content.trim()}\n`;
      const sourceNote = await vault.writeNote(notePath, body, { mode: 'create', summary, stamp: true });

      const date = new Date().toISOString().slice(0, 10);
      const logEntry = `\n### [${date}] ingest | ${safeTitle}\n- Summary: ${summary}\n- Files touched: [[${pathWithoutMarkdownExtension(rawNote.path)}]], [[${pathWithoutMarkdownExtension(sourceNote.path)}]]\n- Sources: ${source || 'manual'}\n- Decisions: raw source preserved before source note creation\n- Open questions: none\n`;
      const existingLog = await vault.readNote('log.md').catch(() => null);
      if (existingLog) {
        await vault.writeNote('log.md', logEntry, { mode: 'append', summary: `Logged ingest: ${safeTitle}`, stamp: false });
      } else {
        await vault.writeNote('log.md', `# Brain Log\n\nAppend-only chronological history for this Brain.\n${logEntry}`, {
          mode: 'create',
          summary: `Created log entry: ${safeTitle}`,
          stamp: true,
        });
      }

      return jsonResponse({ rawNote, sourceNote });
    },
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const stats = await fs.stat(path.resolve(args.vault)).catch(() => null);
  if (!stats?.isDirectory()) throw new Error(`Vault path is not a directory: ${args.vault}`);

  const context = {
    vaultRoot: args.vault,
    actor: args.actor,
    actorName: args.actorName,
    readOnly: args.readOnly,
  };

  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  await registerTools(server, context);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`${SERVER_NAME} ${SERVER_VERSION} connected to ${path.resolve(args.vault)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${SERVER_NAME} failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
