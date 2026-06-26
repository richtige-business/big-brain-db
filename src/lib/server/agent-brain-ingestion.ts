// ============================================================
// agent-brain-ingestion.ts - Durable knowledge sync
//
// Generates and refreshes the standard scaffolding pages for an
// agent brain space (AGENT_START, log, dataset inventory, projection
// policy, ingestion gaps) with stable-diff change detection so
// unchanged documents are never rewritten.
//
// Ported from the Connect brain module. The Connect version pulled
// from app-specific Prisma tables (inbox/calendar/lab). Standalone,
// the "brain" profile reflects the brain's own Supabase data; custom
// profiles reflect the contents of their own space.
// ============================================================

import { createSupabaseServiceClient } from '@/lib/supabase/server';
import {
  ensureBrainSpace,
  getBrainDocument,
  listBrainSpaces,
  upsertBrainDocument,
  LOCAL_USER_ID,
  type BrainActor,
  type BrainDocumentType,
  type BrainSpaceRecord,
} from '@/lib/server/brain-db';

export interface AgentBrainProfile {
  id: string;
  name: string;
  description?: string;
  type?: string;
}

interface AgentDatasetSection {
  title: string;
  countLabel: string;
  keepInPostgres: string;
  brainProjection: string;
  recent: string[];
  notes?: string[];
}

interface BrainDocSpec {
  slug: string;
  title: string;
  type: BrainDocumentType;
  tags: string[];
  frontmatter: Record<string, unknown>;
  contentMarkdown: string;
  changeSummary: string;
}

const SYSTEM_ACTOR: BrainActor = {
  id: 'system:agent-brain-ingest',
  name: 'Agent Brain Ingest',
  type: 'system',
};

export const DEFAULT_AGENT_BRAIN_PROFILES: AgentBrainProfile[] = [
  {
    id: 'brain',
    name: 'Big Brain',
    description: 'Visible knowledge base and graph database management',
    type: 'built-in',
  },
];

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizeAgentName(profile: AgentBrainProfile): string {
  return profile.name.trim() || profile.id.trim() || 'Agent';
}

function brainTitle(profile: AgentBrainProfile): string {
  const name = normalizeAgentName(profile);
  return name.toLowerCase().endsWith('brain') ? name : `${name} Brain`;
}

function slugBase(profile: AgentBrainProfile): string {
  return (
    profile.id
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'agent'
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toISOString().slice(0, 10);
}

function textPreview(value: unknown, max = 120): string {
  const raw = typeof value === 'string' ? value : stableJson(value);
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  return cleaned.length > max ? `${cleaned.slice(0, max)}...` : cleaned;
}

async function countRows(table: string, match: Record<string, unknown> = {}): Promise<number> {
  let query = createSupabaseServiceClient().from(table).select('*', { count: 'exact', head: true });
  for (const [key, value] of Object.entries(match)) query = query.eq(key, value);
  const { count, error } = await query;
  if (error) return 0;
  return count || 0;
}

async function recentRows(
  table: string,
  orderColumn: string,
  match: Record<string, unknown> = {},
  take = 5
): Promise<Record<string, unknown>[]> {
  let query = createSupabaseServiceClient()
    .from(table)
    .select('*')
    .order(orderColumn, { ascending: false })
    .limit(take);
  for (const [key, value] of Object.entries(match)) query = query.eq(key, value);
  const { data, error } = await query;
  if (error) return [];
  return (data as Record<string, unknown>[]) || [];
}

async function upsertBrainDocumentIfChanged(
  userId: string,
  spaceId: string,
  doc: BrainDocSpec,
  actor: BrainActor
): Promise<{ document: Awaited<ReturnType<typeof upsertBrainDocument>>; changed: boolean }> {
  const existing = await getBrainDocument({ userId, spaceId, slug: doc.slug });
  const existingFrontmatter = stableJson(existing?.frontmatter || null);
  const nextFrontmatter = stableJson(doc.frontmatter || null);
  const existingTags = stableJson([...(existing?.tags || [])].sort());
  const nextTags = stableJson([...doc.tags].sort());

  if (
    existing &&
    existing.title === doc.title &&
    existing.type === doc.type &&
    existing.contentMarkdown === doc.contentMarkdown &&
    existingFrontmatter === nextFrontmatter &&
    existingTags === nextTags
  ) {
    return { document: existing, changed: false };
  }

  const document = await upsertBrainDocument({
    userId,
    spaceId,
    slug: doc.slug,
    title: doc.title,
    contentMarkdown: doc.contentMarkdown,
    type: doc.type,
    frontmatter: doc.frontmatter,
    tags: doc.tags,
    changeSummary: doc.changeSummary,
    actor,
  });

  return { document, changed: true };
}

function buildStandardDocumentMarkdown(): string {
  return `---
type: source
status: active
tags: [brain, standard, ingestion, protocol]
owner: "Big Brain"
---
# Agent Brain Ingestion Standard

## Purpose
This document defines how Agent Brains ingest durable knowledge from the PostgreSQL/Supabase-backed datasets into the Big Brain markdown format.

## Source Of Truth
- PostgreSQL/Supabase remains the operational source of truth for runtime state, event logs, permissions, and machine-readable analytics.
- The Brain stores human-readable durable projections of that data.
- A Brain page should never pretend to be the raw database.

## Projection Rule
- Keep high-frequency operational state in the database.
- Mirror only durable, readable, cross-agent-useful knowledge into the Brain.
- Prefer summaries, inventories, handoffs, decisions, patterns, and open questions over raw event dumps.

## Required Brain Documents Per Agent
- [[AGENT_START]] - operating contract for future agents.
- [[log]] - append-only history of ingests and maintenance.
- [[sources/postgres-dataset-inventory]] - current inventory of relevant datasets.
- [[syntheses/postgres-to-brain-projection]] - what is mirrored into the Brain and why.
- [[open-questions/brain-ingestion-gaps]] - known gaps and migration risks.

## Recommended Frontmatter
- \`type\`: brain, agent-start, log, source, synthesis, open-question, note
- \`status\`: seed, active, stable, stale, superseded, archived
- \`tags\`: stable thematic tags
- \`owner\`: owning Brain when ambiguous
- \`sources\`: canonical source tables or source pages
- \`generated_from\`: source system, usually the database
- \`generated_at\`: date of the latest projection

## What Should Stay In The Database
- raw event logs and audit signals
- permissions and policy state
- large relational datasets and telemetry

## What Should Be Mirrored Into The Brain
- durable summaries, decisions, confirmed preferences
- handoff notes, recurring patterns, curated source syntheses, open questions

## Prompt Integration
Future system prompts should tell agents:
1. The database is the operational source of truth.
2. The Brain stores durable human-readable knowledge.
3. Agents must summarize before writing to the Brain.
4. Agents should update the inventory, projection, and gaps pages when projection rules change.
`;
}

function buildBrainHomeMarkdown(profile: AgentBrainProfile, sections: AgentDatasetSection[]): string {
  const name = normalizeAgentName(profile);
  const title = brainTitle(profile);
  const slug = slugBase(profile);
  const datasets = sections.map((section) => `- ${section.title} (${section.countLabel})`).join('\n');

  return `---
type: brain
tags: [brain, agent, home, postgres]
vault: "${name}"
status: active
owner: "${title}"
generated_from: "database"
generated_at: "${today()}"
---
# ${title}

## Purpose
${profile.description?.trim() || `${name} owns the durable operational knowledge that should stay readable across agent runs.`}

## Role In The Big Brain
- Owns: durable knowledge, stable summaries, source inventories, and open questions for ${name}.
- Does not own: raw operational state that belongs in the database.
- Connects to: the global Brain through shared standards, handoffs, and cross-brain links.
- Entry point: this page is the anchor, map, and operating contract for the ${name} Brain.

## Agent Start Here
1. Read [[AGENT_START]].
2. Read [[sources/postgres-dataset-inventory]] for the current data inventory.
3. Read [[syntheses/postgres-to-brain-projection]] before changing projection rules.
4. Read [[open-questions/brain-ingestion-gaps]] before assuming missing data does not exist.
5. Read [[log]] for recent ingests and maintenance.

## Navigation Map

### Core Nodes
- [[AGENT_START]] - startup contract for future agents.
- [[${slug}-brain]] - this Brain anchor and local map.
- [[log]] - append-only ingest history.

### Sources
- [[sources/postgres-dataset-inventory]] - datasets relevant to this Brain.

### Syntheses
- [[syntheses/postgres-to-brain-projection]] - durable projection policy for this Brain.

### Open Questions
- [[open-questions/brain-ingestion-gaps]] - known ingestion gaps and migration risks.

## Current Map
${datasets || '- No datasets were mapped yet.'}

## Writing Rules
- Treat the database as the operational source of truth.
- Write only durable summaries and projections into this Brain.
- Update source inventories and open questions when the projection boundary changes.
- Do not dump raw logs or full tables into markdown pages.
`;
}

function buildAgentStartMarkdown(profile: AgentBrainProfile): string {
  const name = normalizeAgentName(profile);
  const slug = slugBase(profile);

  return `---
type: agent-start
tags: [brain, agent, start, postgres]
vault: "${name}"
status: active
generated_from: "database"
generated_at: "${today()}"
---
# Agent Start - ${name}

You are the maintainer of the "${name}" Brain.

Treat this Brain as a durable projection layer over the database-backed operational data.

## Start Order
1. Read [[${slug}-brain]] completely.
2. Read [[sources/postgres-dataset-inventory]] for source systems and current counts.
3. Read [[syntheses/postgres-to-brain-projection]] to understand what belongs in the Brain versus the database.
4. Read [[open-questions/brain-ingestion-gaps]] before assuming missing context is complete.
5. Read [[log]] for recent ingest runs and maintenance.

## Operating Rules
- The database is the source of truth for operational runtime state.
- The Brain is the source of readable durable knowledge.
- Summarize before writing.
- Prefer inventories, syntheses, decisions, patterns, and handoffs over raw dumps.
- When projection rules change, update the source inventory, projection page, gaps page, and log.
`;
}

function buildLogMarkdown(profile: AgentBrainProfile): string {
  const name = normalizeAgentName(profile);
  const day = today();

  return `---
type: log
tags: [brain, log, ingest]
vault: "${name}"
status: active
generated_from: "database"
generated_at: "${day}"
---
# ${name} Log

Append-only chronological history for this Brain.

## Entry Format

### [YYYY-MM-DD] type | short title
- Summary:
- Files touched:
- Sources:
- Decisions:
- Open questions:

## Entries

### [${day}] maintenance | Agent Brain ingestion initialized
- Summary: Created or refreshed the standard database-to-Brain projection pages for this Agent Brain.
- Files touched: [[AGENT_START]], [[sources/postgres-dataset-inventory]], [[syntheses/postgres-to-brain-projection]], [[open-questions/brain-ingestion-gaps]]
- Sources: database-backed application datasets
- Decisions: use the database as the operational source of truth and Brain markdown as the durable readable layer
- Open questions: continue widening the projection set only after data becomes durable
`;
}

function buildInventoryMarkdown(
  profile: AgentBrainProfile,
  space: BrainSpaceRecord,
  sections: AgentDatasetSection[]
): string {
  const name = normalizeAgentName(profile);

  const body =
    sections.length === 0
      ? '## Datasets\n\nNo datasets are currently mapped to this Agent Brain.\n'
      : sections
          .map((section) => {
            const recent =
              section.recent.length > 0
                ? section.recent.map((entry) => `- ${entry}`).join('\n')
                : '- No recent rows available.';
            const notes = section.notes?.length
              ? `\n### Notes\n${section.notes.map((entry) => `- ${entry}`).join('\n')}\n`
              : '\n';

            return `## ${section.title}

- Count: ${section.countLabel}
- Keep in database: ${section.keepInPostgres}
- Brain projection: ${section.brainProjection}

### Recent Rows
${recent}${notes}`;
          })
          .join('\n');

  return `---
type: source
status: active
tags: [brain, source, postgres, dataset]
owner: "${brainTitle(profile)}"
sources: [database]
generated_from: "database"
generated_at: "${today()}"
---
# ${name} Dataset Inventory

## Scope
- Brain space: ${space.scopeType}:${space.scopeId}
- Purpose: inventory the database-backed datasets that feed this Agent Brain.
- Rule: this page describes source systems, not user-facing conclusions.

${body}`.trim();
}

function buildProjectionMarkdown(profile: AgentBrainProfile, sections: AgentDatasetSection[]): string {
  const name = normalizeAgentName(profile);
  const mapped = sections.map((section) => `- ${section.title}: ${section.brainProjection}`).join('\n');

  return `---
type: synthesis
status: active
tags: [brain, synthesis, postgres, projection]
owner: "${brainTitle(profile)}"
generated_from: "database"
generated_at: "${today()}"
---
# ${name} Database To Brain Projection

## Projection Boundary
- The database keeps raw runtime state, operational history, and machine-readable records.
- This Brain keeps durable summaries, source inventories, recurring patterns, and handoff-ready knowledge.
- Projection should compress, not duplicate.

## Current Projection Rules
${mapped || '- No projection rules are defined yet.'}

## Standard
- Never copy full tables into markdown.
- Prefer inventory pages for source systems.
- Prefer synthesis pages for human-readable conclusions.
- Prefer open-question pages when durability is not yet justified.
`;
}

function buildGapsMarkdown(profile: AgentBrainProfile, sections: AgentDatasetSection[]): string {
  const name = normalizeAgentName(profile);
  const gapLines = sections.flatMap((section) => section.notes || []);

  return `---
type: open-question
status: active
tags: [brain, open-question, ingest, gaps]
owner: "${brainTitle(profile)}"
generated_from: "database"
generated_at: "${today()}"
---
# ${name} Brain Ingestion Gaps

## Known Gaps
- Some runtime state may still live outside the database and is not queryable yet.
- Not every Brain-relevant event has a durable server-side representation yet.

## Current Notes
${gapLines.length > 0 ? gapLines.map((line) => `- ${line}`).join('\n') : '- No additional dataset-specific gaps were detected.'}

## Next Steps
- Move durable artifacts into the database when they become operationally important.
- Extend the projection set only after the underlying data is queryable and stable.
- Keep this page aligned with the shared Agent Brain ingestion standard.
`;
}

async function buildBrainSections(userId: string): Promise<AgentDatasetSection[]> {
  const [spaces, documents, sources, relations, changeEvents] = await Promise.all([
    recentRows('brain_spaces', 'updated_at', { user_id: userId }),
    recentRows('brain_documents', 'updated_at', { user_id: userId }),
    recentRows('brain_sources', 'imported_at', { user_id: userId }),
    recentRows('brain_relations', 'created_at'),
    recentRows('brain_change_events', 'created_at', { user_id: userId }),
  ]);

  return [
    {
      title: 'brain_spaces',
      countLabel: String(await countRows('brain_spaces', { user_id: userId })),
      keepInPostgres: 'Spaces are canonical scope boundaries and must stay relational.',
      brainProjection: 'Mirror only curated navigation and ownership structure.',
      recent: spaces.map(
        (space) => `${formatDate(String(space.updated_at))} | ${space.scope_type}:${space.scope_id} -> ${space.name}`
      ),
    },
    {
      title: 'brain_documents',
      countLabel: String(await countRows('brain_documents', { user_id: userId })),
      keepInPostgres: 'Documents are markdown-backed but benefit from relational scope, lookup, and relations.',
      brainProjection: 'These rows are themselves the durable Brain layer; avoid duplicating them elsewhere.',
      recent: documents.map((doc) => `${formatDate(String(doc.updated_at))} | [${doc.type}] ${doc.slug}`),
    },
    {
      title: 'brain_sources',
      countLabel: String(await countRows('brain_sources', { user_id: userId })),
      keepInPostgres: 'Sources track provenance for imported and ingested content.',
      brainProjection: 'Summarize source intent and provenance rather than duplicating raw content.',
      recent: sources.map((source) => `${formatDate(String(source.imported_at))} | ${source.source_type}: ${source.name}`),
    },
    {
      title: 'brain_relations',
      countLabel: String(await countRows('brain_relations')),
      keepInPostgres: 'Relations are structured graph edges with provenance and confidence.',
      brainProjection: 'Mirror relation meaning through links and synthesis, not as raw edge dumps.',
      recent: relations.map(
        (relation) =>
          `${formatDate(String(relation.created_at))} | ${relation.relation_type} (${relation.source_document_id || relation.source_entity_id || 'source?'} -> ${relation.target_document_id || relation.target_entity_id || 'target?'})`
      ),
    },
    {
      title: 'brain_change_events',
      countLabel: String(await countRows('brain_change_events', { user_id: userId })),
      keepInPostgres: 'Change events are operational audit logs and should remain queryable.',
      brainProjection: 'Mirror only durable maintenance summaries into log pages.',
      recent: changeEvents.map((event) => `${formatDate(String(event.created_at))} | ${event.action}: ${textPreview(event.summary)}`),
    },
  ];
}

async function buildCustomAgentSections(userId: string, profile: AgentBrainProfile): Promise<AgentDatasetSection[]> {
  const space = await getBrainSpaceByScopeSafe(userId, profile.id);
  if (!space) {
    return [
      {
        title: 'Agent Space',
        countLabel: 'new',
        keepInPostgres: 'This agent space has no datasets mapped yet.',
        brainProjection: 'Document durable summaries and decisions as the agent works.',
        recent: [],
        notes: ['This Agent Brain was just initialized; no documents exist beyond the scaffolding.'],
      },
    ];
  }

  const documents = await recentRows('brain_documents', 'updated_at', { space_id: space.id });
  return [
    {
      title: 'brain_documents (this space)',
      countLabel: String(await countRows('brain_documents', { space_id: space.id })),
      keepInPostgres: 'Document rows carry scope, lookup, and relation metadata.',
      brainProjection: 'These markdown documents are the durable knowledge for this agent.',
      recent: documents.map((doc) => `${formatDate(String(doc.updated_at))} | [${doc.type}] ${doc.slug}`),
    },
  ];
}

async function getBrainSpaceByScopeSafe(userId: string, scopeId: string): Promise<BrainSpaceRecord | null> {
  const spaces = await listBrainSpaces({ userId, scopeType: 'agent', limit: 500 });
  return spaces.find((space) => space.scopeId === scopeId) || null;
}

async function collectDatasetSections(userId: string, profile: AgentBrainProfile): Promise<AgentDatasetSection[]> {
  if (profile.id === 'brain') return buildBrainSections(userId);
  return buildCustomAgentSections(userId, profile);
}

async function ensureAgentBrainPages(userId: string, profile: AgentBrainProfile, actor: BrainActor = SYSTEM_ACTOR) {
  const name = normalizeAgentName(profile);
  const space = await ensureBrainSpace({
    userId,
    scopeType: 'agent',
    scopeId: profile.id,
    name: `${name} Brain`,
    description: profile.description || `Big Brain space for ${name}`,
    metadata: {
      agentId: profile.id,
      agentName: name,
      agentType: profile.type || 'agent',
      ensuredBy: 'agent-brain-ingestion',
    },
  });

  const sections = await collectDatasetSections(userId, profile);
  const day = today();
  const base = slugBase(profile);

  const docs: BrainDocSpec[] = [
    {
      slug: `${base}-brain`,
      title: brainTitle(profile),
      type: 'brain',
      tags: ['brain', 'agent', 'home', 'postgres'],
      frontmatter: { type: 'brain', status: 'active', tags: ['brain', 'agent', 'home', 'postgres'], owner: brainTitle(profile), generated_from: 'database', generated_at: day },
      contentMarkdown: buildBrainHomeMarkdown(profile, sections),
      changeSummary: `Refreshed ${name} Brain anchor from datasets`,
    },
    {
      slug: 'agent_start',
      title: `Agent Start - ${name}`,
      type: 'agent-start',
      tags: ['brain', 'agent', 'start', 'postgres'],
      frontmatter: { type: 'agent-start', status: 'active', tags: ['brain', 'agent', 'start', 'postgres'], owner: brainTitle(profile), generated_from: 'database', generated_at: day },
      contentMarkdown: buildAgentStartMarkdown(profile),
      changeSummary: `Refreshed ${name} Agent Start contract`,
    },
    {
      slug: 'log',
      title: `${name} Log`,
      type: 'log',
      tags: ['brain', 'log', 'ingest'],
      frontmatter: { type: 'log', status: 'active', tags: ['brain', 'log', 'ingest'], owner: brainTitle(profile), generated_from: 'database', generated_at: day },
      contentMarkdown: buildLogMarkdown(profile),
      changeSummary: `Refreshed ${name} Brain log scaffold`,
    },
    {
      slug: 'sources/postgres-dataset-inventory',
      title: `${name} Dataset Inventory`,
      type: 'source',
      tags: ['brain', 'source', 'postgres', 'dataset'],
      frontmatter: { type: 'source', status: 'active', tags: ['brain', 'source', 'postgres', 'dataset'], owner: brainTitle(profile), sources: ['database'], generated_from: 'database', generated_at: day },
      contentMarkdown: buildInventoryMarkdown(profile, space, sections),
      changeSummary: `Refreshed ${name} dataset inventory`,
    },
    {
      slug: 'syntheses/postgres-to-brain-projection',
      title: `${name} Database To Brain Projection`,
      type: 'synthesis',
      tags: ['brain', 'synthesis', 'postgres', 'projection'],
      frontmatter: { type: 'synthesis', status: 'active', tags: ['brain', 'synthesis', 'postgres', 'projection'], owner: brainTitle(profile), generated_from: 'database', generated_at: day },
      contentMarkdown: buildProjectionMarkdown(profile, sections),
      changeSummary: `Refreshed ${name} projection policy`,
    },
    {
      slug: 'open-questions/brain-ingestion-gaps',
      title: `${name} Brain Ingestion Gaps`,
      type: 'open-question',
      tags: ['brain', 'open-question', 'ingest', 'gaps'],
      frontmatter: { type: 'open-question', status: 'active', tags: ['brain', 'open-question', 'ingest', 'gaps'], owner: brainTitle(profile), generated_from: 'database', generated_at: day },
      contentMarkdown: buildGapsMarkdown(profile, sections),
      changeSummary: `Refreshed ${name} ingestion gaps`,
    },
  ];

  if (profile.id === 'brain') {
    docs.push({
      slug: 'sources/agent-brain-ingestion-standard',
      title: 'Agent Brain Ingestion Standard',
      type: 'source',
      tags: ['brain', 'standard', 'ingestion', 'protocol'],
      frontmatter: { type: 'source', status: 'active', tags: ['brain', 'standard', 'ingestion', 'protocol'], owner: 'Big Brain', generated_from: 'repository-standard', generated_at: day },
      contentMarkdown: buildStandardDocumentMarkdown(),
      changeSummary: 'Refreshed shared Agent Brain ingestion standard',
    });
  }

  const results = [];
  for (const doc of docs) {
    results.push(await upsertBrainDocumentIfChanged(userId, space.id, doc, actor));
  }

  return {
    space,
    documents: results.map((result) => result.document),
    changedDocuments: results.filter((result) => result.changed).length,
  };
}

export async function syncAgentBrainKnowledgeSpaces(
  profiles: AgentBrainProfile[],
  input: { userId?: string; actor?: BrainActor } = {}
) {
  const userId = input.userId || LOCAL_USER_ID;
  const actor = input.actor || SYSTEM_ACTOR;

  const uniqueProfiles = Array.from(
    profiles
      .reduce((map, profile) => {
        if (!profile.id.trim()) return map;
        map.set(profile.id, {
          id: profile.id.trim(),
          name: normalizeAgentName(profile),
          description: profile.description?.trim() || '',
          type: profile.type?.trim() || 'agent',
        });
        return map;
      }, new Map<string, AgentBrainProfile>())
      .values()
  );

  const synced = [];
  for (const profile of uniqueProfiles) {
    synced.push(await ensureAgentBrainPages(userId, profile, actor));
  }

  return { count: synced.length, synced };
}

export async function loadAgentBrainProfilesFromSpaces(userId: string = LOCAL_USER_ID): Promise<AgentBrainProfile[]> {
  const spaces = await listBrainSpaces({ userId, scopeType: 'agent', limit: 500 });

  return spaces
    .filter((space) => space.scopeId !== 'master')
    .map((space) => {
      const metadata = (space.metadata || {}) as Record<string, unknown>;
      return {
        id: typeof metadata.agentId === 'string' && metadata.agentId.trim() ? metadata.agentId.trim() : space.scopeId,
        name:
          typeof metadata.agentName === 'string' && metadata.agentName.trim()
            ? metadata.agentName.trim()
            : space.name.replace(/\s+Brain$/i, ''),
        description: space.description,
        type: typeof metadata.agentType === 'string' && metadata.agentType.trim() ? metadata.agentType.trim() : 'agent',
      };
    });
}
