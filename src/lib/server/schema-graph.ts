// ============================================================
// schema-graph.ts - Hybrid graph: the Supabase brain schema
//
// The Connect module reflected its Prisma DMMF at runtime. The
// standalone repo has no Prisma, so we describe the brain tables
// statically (matching supabase/schema.sql) and load the live raw
// sources from the brain_sources table. This powers the database
// and hybrid graph filter modes.
// ============================================================

import { createSupabaseServiceClient } from '@/lib/supabase/server';
import { LOCAL_USER_ID } from '@/lib/server/brain-db';
import type {
  SchemaGraphColumnSummary,
  SchemaGraphOwnership,
  SchemaGraphPayload,
  SchemaGraphRawSource,
  SchemaGraphRelation,
  SchemaGraphTable,
} from '@/lib/brain/schema-graph-types';

interface StaticColumn {
  name: string;
  type: string;
  required?: boolean;
  isList?: boolean;
  isId?: boolean;
  isRelationKey?: boolean;
}

interface StaticForeignKey {
  column: string;
  references: string; // target table name
  relationName?: string;
}

interface StaticTable {
  name: string;
  columns: StaticColumn[];
  foreignKeys?: StaticForeignKey[];
  ownerId?: string | null;
}

const SCHEMA_NAME = 'public';

// Every brain table belongs to the Big Brain itself; raw sources are
// attributed to the scope of the space that imported them.
const BRAIN_OWNER_ID = 'brain';
const AGENT_OWNER_LABELS: Record<string, string> = { brain: 'Big Brain' };

const BRAIN_TABLES: StaticTable[] = [
  {
    name: 'brain_spaces',
    ownerId: BRAIN_OWNER_ID,
    columns: [
      { name: 'id', type: 'text', required: true, isId: true },
      { name: 'user_id', type: 'text', required: true },
      { name: 'scope_type', type: 'text', required: true },
      { name: 'scope_id', type: 'text', required: true },
      { name: 'name', type: 'text', required: true },
      { name: 'description', type: 'text', required: true },
      { name: 'status', type: 'text', required: true },
      { name: 'anchor_document_id', type: 'text' },
      { name: 'metadata', type: 'jsonb' },
      { name: 'created_at', type: 'timestamptz', required: true },
      { name: 'updated_at', type: 'timestamptz', required: true },
    ],
  },
  {
    name: 'brain_sources',
    ownerId: BRAIN_OWNER_ID,
    columns: [
      { name: 'id', type: 'text', required: true, isId: true },
      { name: 'user_id', type: 'text', required: true },
      { name: 'space_id', type: 'text', required: true, isRelationKey: true },
      { name: 'source_type', type: 'text', required: true },
      { name: 'name', type: 'text', required: true },
      { name: 'uri', type: 'text' },
      { name: 'content_hash', type: 'text' },
      { name: 'metadata', type: 'jsonb' },
      { name: 'imported_at', type: 'timestamptz', required: true },
    ],
    foreignKeys: [{ column: 'space_id', references: 'brain_spaces' }],
  },
  {
    name: 'brain_documents',
    ownerId: BRAIN_OWNER_ID,
    columns: [
      { name: 'id', type: 'text', required: true, isId: true },
      { name: 'user_id', type: 'text', required: true },
      { name: 'space_id', type: 'text', required: true, isRelationKey: true },
      { name: 'source_id', type: 'text', isRelationKey: true },
      { name: 'type', type: 'text', required: true },
      { name: 'slug', type: 'text', required: true },
      { name: 'title', type: 'text', required: true },
      { name: 'content_markdown', type: 'text', required: true },
      { name: 'frontmatter', type: 'jsonb' },
      { name: 'status', type: 'text', required: true },
      { name: 'tags', type: 'text', isList: true },
      { name: 'content_hash', type: 'text' },
      { name: 'updated_at', type: 'timestamptz', required: true },
    ],
    foreignKeys: [
      { column: 'space_id', references: 'brain_spaces' },
      { column: 'source_id', references: 'brain_sources' },
    ],
  },
  {
    name: 'brain_entities',
    ownerId: BRAIN_OWNER_ID,
    columns: [
      { name: 'id', type: 'text', required: true, isId: true },
      { name: 'user_id', type: 'text', required: true },
      { name: 'space_id', type: 'text', required: true, isRelationKey: true },
      { name: 'entity_type', type: 'text', required: true },
      { name: 'slug', type: 'text', required: true },
      { name: 'name', type: 'text', required: true },
      { name: 'summary', type: 'text', required: true },
      { name: 'aliases', type: 'text', isList: true },
      { name: 'confidence', type: 'double precision', required: true },
      { name: 'updated_at', type: 'timestamptz', required: true },
    ],
    foreignKeys: [{ column: 'space_id', references: 'brain_spaces' }],
  },
  {
    name: 'brain_relations',
    ownerId: BRAIN_OWNER_ID,
    columns: [
      { name: 'id', type: 'text', required: true, isId: true },
      { name: 'space_id', type: 'text', required: true, isRelationKey: true },
      { name: 'relation_type', type: 'text', required: true },
      { name: 'source_document_id', type: 'text', isRelationKey: true },
      { name: 'target_document_id', type: 'text', isRelationKey: true },
      { name: 'source_entity_id', type: 'text', isRelationKey: true },
      { name: 'target_entity_id', type: 'text', isRelationKey: true },
      { name: 'confidence', type: 'double precision', required: true },
      { name: 'created_at', type: 'timestamptz', required: true },
    ],
    foreignKeys: [
      { column: 'space_id', references: 'brain_spaces' },
      { column: 'source_document_id', references: 'brain_documents', relationName: 'source' },
      { column: 'target_document_id', references: 'brain_documents', relationName: 'target' },
      { column: 'source_entity_id', references: 'brain_entities', relationName: 'sourceEntity' },
      { column: 'target_entity_id', references: 'brain_entities', relationName: 'targetEntity' },
    ],
  },
  {
    name: 'brain_change_events',
    ownerId: BRAIN_OWNER_ID,
    columns: [
      { name: 'id', type: 'text', required: true, isId: true },
      { name: 'user_id', type: 'text', required: true },
      { name: 'space_id', type: 'text', required: true, isRelationKey: true },
      { name: 'document_id', type: 'text', isRelationKey: true },
      { name: 'actor_id', type: 'text', required: true },
      { name: 'action', type: 'text', required: true },
      { name: 'summary', type: 'text', required: true },
      { name: 'created_at', type: 'timestamptz', required: true },
    ],
    foreignKeys: [
      { column: 'space_id', references: 'brain_spaces' },
      { column: 'document_id', references: 'brain_documents' },
    ],
  },
];

function ownerNameForId(agentOwnerId: string | null): string | null {
  if (!agentOwnerId) return null;
  return AGENT_OWNER_LABELS[agentOwnerId] || agentOwnerId;
}

export function schemaTableId(schemaName: string, tableName: string): string {
  return `table:${schemaName}:${tableName}`;
}

function keyColumns(columns: SchemaGraphColumnSummary[]): string[] {
  const preferred = columns.filter(
    (column) =>
      column.isId ||
      column.isRelationKey ||
      ['name', 'title', 'slug', 'type', 'status', 'created_at', 'updated_at'].includes(column.name)
  );
  const fallback = columns.filter((column) => !preferred.some((p) => p.name === column.name));
  return [...preferred, ...fallback].slice(0, 6).map((column) => column.name);
}

function buildTables(): SchemaGraphTable[] {
  return BRAIN_TABLES.map((table) => {
    const columns: SchemaGraphColumnSummary[] = table.columns.map((column) => ({
      name: column.name,
      type: column.type,
      required: Boolean(column.required),
      isList: Boolean(column.isList),
      isId: Boolean(column.isId),
      isRelationKey: Boolean(column.isRelationKey),
    }));
    const relationSummary = (table.foreignKeys || []).map((fk) => `${fk.column} -> ${fk.references}`);
    const agentOwnerId = table.ownerId ?? null;

    return {
      id: schemaTableId(SCHEMA_NAME, table.name),
      schemaName: SCHEMA_NAME,
      tableName: table.name,
      label: table.name,
      modelName: table.name,
      columns,
      keyColumns: keyColumns(columns),
      relationSummary,
      agentOwnerId,
      agentOwnerName: ownerNameForId(agentOwnerId),
    };
  });
}

function buildRelations(): SchemaGraphRelation[] {
  const relations: SchemaGraphRelation[] = [];
  for (const table of BRAIN_TABLES) {
    for (const fk of table.foreignKeys || []) {
      const id = `relation:${table.name}:${fk.column}:${fk.references}`;
      relations.push({
        id,
        sourceTableId: schemaTableId(SCHEMA_NAME, table.name),
        targetTableId: schemaTableId(SCHEMA_NAME, fk.references),
        kind: 'foreign-key',
        relationName: fk.relationName || null,
        sourceFields: [fk.column],
        targetFields: ['id'],
      });
    }
  }
  return relations;
}

async function loadRawSources(userId: string): Promise<SchemaGraphRawSource[]> {
  const { data, error } = await createSupabaseServiceClient()
    .from('brain_sources')
    .select('id, name, uri, source_type, metadata, brain_spaces(scope_type, scope_id)')
    .eq('user_id', userId)
    .order('imported_at', { ascending: false });

  if (error) {
    // Raw sources are best-effort; the static schema is still useful.
    console.warn('schema-graph: failed to load raw sources', error.message);
    return [];
  }

  return (data as Record<string, unknown>[]).map((row) => {
    const space = (row.brain_spaces || {}) as Record<string, unknown>;
    const rawOwnerId = space.scope_type === 'agent' ? String(space.scope_id || '') : null;
    const agentOwnerId = rawOwnerId === 'master' ? BRAIN_OWNER_ID : rawOwnerId;
    const metadata =
      row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : null;
    const path =
      (typeof metadata?.relativePath === 'string' && metadata.relativePath.trim()) ||
      (row.uri ? String(row.uri) : '') ||
      String(row.name || '');

    return {
      id: `raw-source:${String(row.id)}`,
      label: String(row.name || ''),
      path,
      sourceType: String(row.source_type || 'import'),
      agentOwnerId,
      agentOwnerName: ownerNameForId(agentOwnerId),
      relatedTableIds: [schemaTableId(SCHEMA_NAME, 'brain_sources')],
    };
  });
}

function buildOwnership(
  tables: SchemaGraphTable[],
  rawSources: SchemaGraphRawSource[]
): SchemaGraphOwnership[] {
  return [
    ...tables.map((table) => ({
      nodeId: table.id,
      nodeType: 'table' as const,
      agentOwnerId: table.agentOwnerId,
      agentOwnerName: table.agentOwnerName,
    })),
    ...rawSources.map((rawSource) => ({
      nodeId: rawSource.id,
      nodeType: 'raw-source' as const,
      agentOwnerId: rawSource.agentOwnerId,
      agentOwnerName: rawSource.agentOwnerName,
    })),
  ];
}

export async function getBrainSchemaGraph(userId: string = LOCAL_USER_ID): Promise<SchemaGraphPayload> {
  const tables = buildTables();
  const relations = buildRelations();
  const rawSources = await loadRawSources(userId);
  const ownership = buildOwnership(tables, rawSources);

  return {
    tables,
    relations,
    rawSources,
    ownership,
    unassigned: {
      tableIds: tables.filter((table) => !table.agentOwnerId).map((table) => table.id),
      rawSourceIds: rawSources.filter((rawSource) => !rawSource.agentOwnerId).map((rawSource) => rawSource.id),
    },
  };
}
