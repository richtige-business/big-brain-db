// ============================================================
// schema-graph-types.ts
//
// Shared types for the hybrid graph: markdown documents plus the
// PostgreSQL/Supabase schema (tables, foreign keys) and the raw
// sources that feed the brain. Ported from the Connect brain module
// and adapted for the standalone Supabase-backed server layer.
// ============================================================

export type GraphFilterMode = 'markdown' | 'database' | 'hybrid';

export interface SchemaGraphColumnSummary {
  name: string;
  type: string;
  required: boolean;
  isList: boolean;
  isId: boolean;
  isRelationKey: boolean;
}

export interface SchemaGraphTable {
  id: string;
  schemaName: string;
  tableName: string;
  label: string;
  modelName: string;
  columns: SchemaGraphColumnSummary[];
  keyColumns: string[];
  relationSummary: string[];
  agentOwnerId: string | null;
  agentOwnerName: string | null;
}

export interface SchemaGraphRelation {
  id: string;
  sourceTableId: string;
  targetTableId: string;
  kind: 'foreign-key';
  relationName: string | null;
  sourceFields: string[];
  targetFields: string[];
}

export interface SchemaGraphRawSource {
  id: string;
  label: string;
  path: string;
  sourceType: string;
  agentOwnerId: string | null;
  agentOwnerName: string | null;
  relatedTableIds: string[];
}

export interface SchemaGraphOwnership {
  nodeId: string;
  nodeType: 'table' | 'raw-source';
  agentOwnerId: string | null;
  agentOwnerName: string | null;
}

export interface SchemaGraphPayload {
  tables: SchemaGraphTable[];
  relations: SchemaGraphRelation[];
  rawSources: SchemaGraphRawSource[];
  ownership: SchemaGraphOwnership[];
  unassigned: {
    tableIds: string[];
    rawSourceIds: string[];
  };
}
