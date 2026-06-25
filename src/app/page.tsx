'use client';

import dynamic from 'next/dynamic';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Background,
  BaseEdge,
  Controls,
  Handle,
  Position,
  ReactFlow,
  getStraightPath,
  useEdgesState,
  useNodesState,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react';
import type {
  GraphFilterMode,
  SchemaGraphPayload,
  SchemaGraphRawSource,
  SchemaGraphTable,
} from '@/lib/brain/schema-graph-types';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import {
  ArrowLeft,
  BookOpen,
  Brain,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileText,
  FolderPlus,
  FolderOpen,
  History,
  Network,
  Palette,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  BRAIN_NODE_ID,
  DEFAULT_AGENT_ACTOR,
  DEFAULT_OWNER_ACTOR,
  brainFileNameForWiki,
  buildFileLintMap,
  buildGraph,
  clearWikiVaultHandles,
  computeWikiFileContentHash,
  createMarkdownFileInDirectory,
  createSubfolderInDirectory,
  createSubBrainInDirectory,
  createVaultId,
  extractLinks,
  fileTitle,
  getCollaborationState,
  getVaultColor,
  getActorBrainRole,
  getWikiVaultHandles,
  hasVaultPermission,
  isRedundantSignatureProperty,
  isBrainHomeFile,
  isBrainMetaFile,
  isVaultBrainNodeId,
  loadVault,
  parseFrontmatter,
  roleCanEdit,
  roleCanInvite,
  saveCollaborationState,
  saveFile,
  saveWikiVaultHandles,
  useWikiStore,
  vaultIdFromBrainNodeId,
  VAULT_PALETTE,
  type BrainInvitation,
  type BrainMembership,
  type BrainRole,
  type ChangeEvent,
  type CollaborationActor,
  type CollaborationStateSnapshot,
  type FileConflict,
  type FileLint,
  type FileVersion,
  type GraphEdge,
  type GraphScope,
  type GraphNode,
  type HoverScope,
  type StoredWikiVaultHandle,
  type WikiFile,
  type WikiFolder,
  type WikiVault,
} from '@/lib/wiki';
import type { WikiSearchHit } from '@/lib/search';
import { useWikiSearch } from '@/hooks/useWikiSearch';
import { PropertiesBlock } from '@/components/PropertiesBlock';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

declare global {
  interface Window {
    showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  }
}

function FolderNode({
  folder,
  depth,
  vaultColor,
  lintMap,
  onFolderCluster,
  onHoverScope,
  onClearHover,
  onCreateMarkdownInFolder,
  onCreateFolderInFolder,
  onCreateSubBrainInFolder,
  onSetVaultColor,
  onDeleteBrain,
  canDeleteBrain,
  asBrain = false,
  isVaultRoot = false,
}: {
  folder: WikiFolder;
  depth: number;
  vaultColor: string;
  lintMap: Map<string, FileLint>;
  onFolderCluster: (folder: WikiFolder) => void;
  onHoverScope: (scope: Exclude<HoverScope, null>) => void;
  onClearHover: () => void;
  onCreateMarkdownInFolder: (folder: WikiFolder) => void;
  onCreateFolderInFolder: (folder: WikiFolder) => void;
  onCreateSubBrainInFolder: (folder: WikiFolder) => void;
  onSetVaultColor: (color: string | undefined) => void;
  onDeleteBrain?: () => void;
  canDeleteBrain?: boolean;
  // asBrain: render this folder itself as a (sub-)brain even at depth 0 (used when
  // the sidebar promotes a nested {name}-brain folder to a top-level brain section).
  asBrain?: boolean;
  // isVaultRoot: this folder is an actual added vault root (shows vault colour/delete).
  isVaultRoot?: boolean;
}) {
  const expanded = useWikiStore((state) => state.expandedFolders.has(folder.id));
  const toggle = useWikiStore((state) => state.toggleFolder);
  const selectedId = useWikiStore((state) => state.selectedFileId);
  const selectFile = useWikiStore((state) => state.selectFile);
  const graphScope = useWikiStore((state) => state.graphScope);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);

  const paddingLeft = 8 + depth * 14;
  const isLockedFolder =
    (graphScope.type === 'folder' && graphScope.vaultId === folder.vaultId && graphScope.folderPath === folder.path) ||
    (depth === 0 && graphScope.type === 'vault' && graphScope.vaultId === folder.vaultId);

  // A nested folder that holds a `{name}-brain.md` anchor is itself a Sub-Brain:
  // render it as a brain (brain icon + anchor title), nested under its parent, and
  // hide the anchor file from the file list (the row represents it). The vault root
  // (depth 0) is already the Big Brain section, so only nested folders graduate.
  const brainAnchor = (asBrain || depth > 0) ? brainAnchorOf(folder) : undefined;
  const isBrainFolder = Boolean(brainAnchor);
  const displayFiles = brainAnchor ? folder.files.filter((f) => f.id !== brainAnchor.id) : folder.files;
  const folderLabel = brainAnchor ? fileTitle(brainAnchor) : folder.name;

  return (
    <div className="treeNode">
      <div
        className={`treeRow folderRow ${isBrainFolder ? 'brainFolderRow' : ''} ${isLockedFolder ? 'locked' : ''}`}
        style={{ paddingLeft }}
        onMouseEnter={() => onHoverScope({ type: 'folder', vaultId: folder.vaultId, folderPath: folder.path })}
        onMouseLeave={onClearHover}
      >
        <button type="button" className="folderChevron" onClick={() => toggle(folder.id)} aria-label={expanded ? 'Collapse' : 'Expand'}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <button
          type="button"
          className="folderMain"
          onClick={() => (brainAnchor ? selectFile(brainAnchor.id) : onFolderCluster(folder))}
        >
          {isBrainFolder ? <Brain size={14} /> : <FolderOpen size={14} />}
          <span>{folderLabel}</span>
        </button>
        <div className="folderActions">
          <button
            type="button"
            className="folderActionIcon"
            title="New Markdown file"
            aria-label="New Markdown file"
            onClick={(event) => {
              event.stopPropagation();
              onCreateMarkdownInFolder(folder);
            }}
          >
            <FilePlus2 size={13} />
          </button>
          <button
            type="button"
            className="folderActionIcon"
            title="Create folder"
            aria-label="Create folder"
            onClick={(event) => {
              event.stopPropagation();
              onCreateFolderInFolder(folder);
            }}
          >
            <FolderPlus size={13} />
          </button>
          <button
            type="button"
            className="folderActionIcon"
            title="New Sub-Brain"
            aria-label="New Sub-Brain"
            onClick={(event) => {
              event.stopPropagation();
              onCreateSubBrainInFolder(folder);
            }}
          >
            <Brain size={13} />
          </button>
          {isVaultRoot && (
            <div className="colorPickerWrapper">
              <button
                type="button"
                className="folderActionIcon"
                title="Brain colour"
                aria-label="Set Brain colour"
                style={{ color: vaultColor }}
                onClick={(event) => {
                  event.stopPropagation();
                  setColorPickerOpen((open) => !open);
                }}
              >
                <Palette size={13} />
              </button>
              {colorPickerOpen && (
                <div
                  className="colorSwatchMenu"
                  onClick={(e) => e.stopPropagation()}
                >
                  {VAULT_PALETTE.map((swatch) => (
                    <button
                      key={swatch}
                      type="button"
                      className={`colorSwatch ${swatch === vaultColor ? 'active' : ''}`}
                      style={{ background: swatch }}
                      title={swatch}
                      aria-label={`Set colour ${swatch}`}
                      onClick={() => {
                        onSetVaultColor(swatch);
                        setColorPickerOpen(false);
                      }}
                    />
                  ))}
                  <button
                    type="button"
                    className="colorSwatchReset"
                    onClick={() => {
                      onSetVaultColor(undefined);
                      setColorPickerOpen(false);
                    }}
                  >
                    Reset
                  </button>
                </div>
              )}
            </div>
          )}
          {isVaultRoot && onDeleteBrain && (
            <button
              type="button"
              className="folderActionIcon folderActionIcon--danger"
              title="Remove Brain from app"
              aria-label="Remove Brain from app"
              disabled={!canDeleteBrain}
              onClick={(event) => {
                event.stopPropagation();
                onDeleteBrain();
              }}
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
      {expanded && (
        <div>
          {folder.folders.map((child) => (
            <FolderNode
              key={child.id}
              folder={child}
              depth={depth + 1}
              vaultColor={vaultColor}
              lintMap={lintMap}
              onFolderCluster={onFolderCluster}
              onHoverScope={onHoverScope}
              onClearHover={onClearHover}
              onCreateMarkdownInFolder={onCreateMarkdownInFolder}
              onCreateFolderInFolder={onCreateFolderInFolder}
              onCreateSubBrainInFolder={onCreateSubBrainInFolder}
              onSetVaultColor={onSetVaultColor}
            />
          ))}
          {displayFiles.map((file) => {
            const lint = lintMap.get(file.id);
            return (
              <button
                key={file.id}
                className={`treeRow fileRow ${selectedId === file.id ? 'active' : ''}`}
                style={{ paddingLeft: 22 + depth * 14 }}
                onClick={() => selectFile(file.id)}
                onMouseEnter={() => onHoverScope({ type: 'file', fileId: file.id })}
                onMouseLeave={onClearHover}
              >
                <FileText size={14} />
                <span>{fileTitle(file)}</span>
                {file.dirty && <span className="dirtyDot" aria-label="unsaved" />}
                {lint?.unresolved && (
                  <span className="lintDot lintDot--unresolved" title="Has unresolved links" />
                )}
                {!lint?.unresolved && lint?.bare && (
                  <span className="lintDot lintDot--bare" title="No frontmatter" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface SimNode extends SimulationNodeDatum {
  id: string;
  title: string;
  weight: number;
  unresolved?: boolean;
  vaultId?: string;
  communityId?: string;
  brain?: boolean;
  subBrain?: boolean;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  id: string;
  unresolved?: boolean;
  brainMap?: boolean;
  brainAnchor?: boolean;
}

const NODE_HITBOX = 88;

function computeClusterCenters(vaultIds: string[]): Map<string, { x: number; y: number }> {
  const centers = new Map<string, { x: number; y: number }>();
  const radius = Math.max(520, vaultIds.length * 260);
  vaultIds.forEach((vaultId, index) => {
    const angle = (index / Math.max(vaultIds.length, 1)) * Math.PI * 2;
    centers.set(vaultId, {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    });
  });
  return centers;
}

function computeRelationCenters(
  rawNodes: GraphNode[],
  rawEdges: GraphEdge[],
  vaultCenters: Map<string, { x: number; y: number }>,
): Map<string, { x: number; y: number; communityId: string }> {
  const byId = new Map(rawNodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, Set<string>>();
  for (const node of rawNodes) adjacency.set(node.id, new Set());

  for (const edge of rawEdges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target || source.unresolved || target.unresolved) continue;
    if (source.vaultId !== target.vaultId) continue;
    if (source.subBrain || target.subBrain) continue;
    adjacency.get(source.id)?.add(target.id);
    adjacency.get(target.id)?.add(source.id);
  }

  const communitiesByVault = new Map<string, string[][]>();
  const visited = new Set<string>();
  for (const node of rawNodes) {
    if (visited.has(node.id)) continue;
    const vaultId = node.vaultId || 'global';
    const queue = [node.id];
    const component: string[] = [];
    visited.add(node.id);

    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor];
      component.push(current);
      for (const next of adjacency.get(current) || []) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }

    const list = communitiesByVault.get(vaultId) || [];
    list.push(component);
    communitiesByVault.set(vaultId, list);
  }

  const relationCenters = new Map<string, { x: number; y: number; communityId: string }>();
  for (const [vaultId, communities] of communitiesByVault) {
    const vaultCenter = vaultCenters.get(vaultId) || { x: 0, y: 0 };
    const sorted = [...communities].sort((a, b) => b.length - a.length);
    const radius = Math.max(180, Math.min(520, sorted.length * 70));

    sorted.forEach((community, index) => {
      const isMain = index === 0;
      const angle = (index / Math.max(sorted.length, 1)) * Math.PI * 2;
      const center = {
        x: vaultCenter.x + (isMain ? 0 : Math.cos(angle) * radius),
        y: vaultCenter.y + (isMain ? 0 : Math.sin(angle) * radius),
        communityId: `${vaultId}:${index}`,
      };
      for (const nodeId of community) relationCenters.set(nodeId, center);
    });
  }
  return relationCenters;
}

function computeLayout(rawNodes: GraphNode[], rawEdges: GraphEdge[]): {
  nodes: Map<
    string,
    {
      x: number;
      y: number;
      weight: number;
      unresolved?: boolean;
      title: string;
      vaultId?: string;
      vaultName?: string;
      brain?: boolean;
      subBrain?: boolean;
    }
  >;
  edges: GraphEdge[];
} {
  // Radial layout: the Big Brain sits at the centre (0,0); every sub-brain node is
  // anchored on a ring around it; files cluster around their owning sub-brain. (The
  // vault node, if any, sits with the Big Brain at the centre.)
  const subBrainNodes = rawNodes.filter((n) => n.subBrain && n.id.startsWith('subbrain:'));
  const RING = Math.max(560, subBrainNodes.length * 150);
  const subBrainCenters = new Map<string, { x: number; y: number }>();
  subBrainNodes.forEach((n, i) => {
    const angle = (i / Math.max(subBrainNodes.length, 1)) * Math.PI * 2 - Math.PI / 2;
    subBrainCenters.set(n.id, { x: Math.cos(angle) * RING, y: Math.sin(angle) * RING });
  });
  const ownerOf = new Map<string, string>();
  for (const e of rawEdges) if (e.brainAnchor) ownerOf.set(e.target, e.source);
  const targetCenter = (n: SimNode): { x: number; y: number } => {
    if (n.brain) return { x: 0, y: 0 };
    if (n.id.startsWith('subbrain:')) return subBrainCenters.get(n.id) ?? { x: 0, y: 0 };
    if (n.subBrain) return { x: 0, y: 0 }; // vault node sits with the Big Brain
    const owner = ownerOf.get(n.id);
    if (owner && subBrainCenters.has(owner)) return subBrainCenters.get(owner)!;
    return { x: 0, y: 0 };
  };

  const simNodes: SimNode[] = rawNodes.map((n) => ({
    id: n.id,
    title: n.title,
    weight: n.weight,
    unresolved: n.unresolved,
    vaultId: n.vaultId,
    brain: n.brain,
    subBrain: n.subBrain,
  }));

  for (const node of simNodes) {
    if (node.brain) {
      // Big Brain at the centre.
      node.fx = 0;
      node.fy = 0;
    } else if (node.subBrain && !node.id.startsWith('subbrain:')) {
      // The vault node (the "la chaine" big brain) sits at the exact same centre.
      node.fx = 0;
      node.fy = 0;
    } else if (node.id.startsWith('subbrain:')) {
      const c = subBrainCenters.get(node.id);
      if (c) {
        node.fx = c.x;
        node.fy = c.y;
      }
    }
  }
  const simLinks: SimLink[] = rawEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    unresolved: e.unresolved,
    brainMap: e.brainMap,
    brainAnchor: e.brainAnchor,
  }));

  const sim = forceSimulation<SimNode, SimLink>(simNodes)
    .force(
      'link',
      forceLink<SimNode, SimLink>(simLinks)
        .id((d) => d.id)
        .distance((d) => (d.brainAnchor ? 95 : d.brainMap ? 230 : 260))
        .strength((d) => (d.brainAnchor ? 0.88 : d.brainMap ? 0.12 : 0.28)),
    )
    .force('charge', forceManyBody<SimNode>().strength(-980).distanceMax(1500))
    .force('center', forceCenter(0, 0))
    .force(
      'clusterX',
      forceX<SimNode>((d) => targetCenter(d).x).strength((d) =>
        d.brain || d.id.startsWith('subbrain:') ? 0 : d.subBrain ? 0.7 : 0.5,
      ),
    )
    .force(
      'clusterY',
      forceY<SimNode>((d) => targetCenter(d).y).strength((d) =>
        d.brain || d.id.startsWith('subbrain:') ? 0 : d.subBrain ? 0.7 : 0.5,
      ),
    )
    .force(
      'collide',
      // Hitbox radius: half the rendered NODE_HITBOX plus a gap, scaled a little by
      // weight. Guarantees node centers stay >= one hitbox apart.
      forceCollide<SimNode>((d) => NODE_HITBOX / 2 + 8 + Math.sqrt(Math.max(d.weight, 1)) * 9).strength(1),
    )
    .stop();

  const graphSize = simNodes.length + simLinks.length;
  const ticks =
    graphSize > 700
      ? 36
      : graphSize > 350
        ? 48
        : Math.min(90, Math.max(42, Math.ceil(Math.log(simNodes.length + 1) * 24)));
  for (let i = 0; i < ticks; i++) sim.tick();

  // Final overlap-resolution pass: collision only (no clustering/charge pulling
  // nodes back together), so no two node hitboxes overlap. Runs until stable or a
  // hard cap. Nodes are not pinned (no fx/fy), so collide can separate them freely.
  const collideRadius = (d: SimNode) => NODE_HITBOX / 2 + 8 + Math.sqrt(Math.max(d.weight, 1)) * 9;
  const relax = forceSimulation<SimNode>(simNodes)
    .force('collide', forceCollide<SimNode>(collideRadius).strength(1).iterations(4))
    .stop();
  for (let i = 0; i < 120; i++) relax.tick();

  const rawById = new Map(rawNodes.map((node) => [node.id, node]));
  const nodes = new Map<
    string,
    {
      x: number;
      y: number;
      weight: number;
      unresolved?: boolean;
      title: string;
      vaultId?: string;
      vaultName?: string;
      brain?: boolean;
      subBrain?: boolean;
    }
  >();
  for (const n of simNodes) {
    const raw = rawById.get(n.id);
    nodes.set(n.id, {
      x: n.x ?? 0,
      y: n.y ?? 0,
      weight: n.weight,
      unresolved: n.unresolved,
      title: n.title,
      vaultId: raw?.vaultId,
      vaultName: raw?.vaultName,
      brain: raw?.brain,
      subBrain: raw?.subBrain,
    });
  }
  return { nodes, edges: rawEdges };
}

function fileInFolderPath(file: WikiFile, folderPath: string): boolean {
  return file.path === folderPath || file.path.startsWith(`${folderPath}/`);
}

interface HoverState {
  hoverId: string | null;
  hoverKind: 'node' | 'scope' | 'lock' | null;
  focusedSet: Set<string> | null;
  selectedId: string | null;
  previewId: string | null;
  searchMatchSet: Set<string> | null;
}

const HoverContext = createContext<HoverState>({
  hoverId: null,
  hoverKind: null,
  focusedSet: null,
  selectedId: null,
  previewId: null,
  searchMatchSet: null,
});

type WikiNodeData = {
  title: string;
  radius: number;
  unresolved?: boolean;
  important?: boolean;
  brain?: boolean;
  subBrain?: boolean;
  [key: string]: unknown;
};

type WikiEdgeData = {
  unresolved?: boolean;
  brainMap?: boolean;
  brainAnchor?: boolean;
  vaultColor?: string;
  [key: string]: unknown;
};

type SchemaNodeData = {
  label: string;
  kind: 'table' | 'rawSource';
  detail?: string;
  ownerName?: string | null;
  [key: string]: unknown;
};

function TableNodeView({ data }: NodeProps<Node<SchemaNodeData>>) {
  return (
    <div className="schemaNode schemaNode--table" title={data.detail || data.label}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <span className="schemaNode__kind">table</span>
      <span className="schemaNode__label">{data.label}</span>
      {data.ownerName ? <span className="schemaNode__owner">{data.ownerName}</span> : null}
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}

function RawSourceNodeView({ data }: NodeProps<Node<SchemaNodeData>>) {
  return (
    <div className="schemaNode schemaNode--raw" title={data.detail || data.label}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <span className="schemaNode__kind">source</span>
      <span className="schemaNode__label">{data.label}</span>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}

function SchemaEdgeView({ sourceX, sourceY, targetX, targetY }: EdgeProps) {
  const [path] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  return <BaseEdge path={path} style={{ stroke: 'rgba(37,99,235,0.45)', strokeWidth: 1.5, strokeDasharray: '4 4' }} />;
}

const nodeTypes = { wiki: WikiNodeView, table: TableNodeView, rawSource: RawSourceNodeView };
const edgeTypes = { wiki: WikiEdgeView, schema: SchemaEdgeView };

// Deterministic side-by-side layout for the database/hybrid graph.
function buildSchemaFlow(payload: SchemaGraphPayload): {
  nodes: Node<SchemaNodeData>[];
  edges: Edge[];
} {
  const COL_W = 360;
  const ROW_H = 150;
  const PER_COL = 4;
  const ORIGIN_X = 1200; // place to the right of the markdown cluster in hybrid mode
  const tablePos = new Map<string, { x: number; y: number }>();

  const tableNodes: Node<SchemaNodeData>[] = payload.tables.map((table: SchemaGraphTable, index) => {
    const x = ORIGIN_X + Math.floor(index / PER_COL) * COL_W;
    const y = (index % PER_COL) * ROW_H;
    tablePos.set(table.id, { x, y });
    return {
      id: table.id,
      type: 'table',
      position: { x, y },
      data: {
        label: table.label,
        kind: 'table',
        detail: `${table.tableName} · ${table.keyColumns.join(', ')}`,
        ownerName: table.agentOwnerName,
      },
      draggable: true,
      selectable: false,
    };
  });

  const rawColX = ORIGIN_X + (Math.ceil(payload.tables.length / PER_COL) + 1) * COL_W;
  const rawNodes: Node<SchemaNodeData>[] = payload.rawSources.map((source: SchemaGraphRawSource, index) => ({
    id: source.id,
    type: 'rawSource',
    position: { x: rawColX, y: index * (ROW_H * 0.8) },
    data: { label: source.label, kind: 'rawSource', detail: source.path, ownerName: source.agentOwnerName },
    draggable: true,
    selectable: false,
  }));

  const fkEdges: Edge[] = payload.relations.map((relation) => ({
    id: relation.id,
    source: relation.sourceTableId,
    target: relation.targetTableId,
    type: 'schema',
  }));

  const rawEdges: Edge[] = payload.rawSources.flatMap((source) =>
    source.relatedTableIds
      .filter((tableId) => tablePos.has(tableId))
      .map((tableId) => ({
        id: `raw-edge:${source.id}:${tableId}`,
        source: source.id,
        target: tableId,
        type: 'schema',
      })),
  );

  return { nodes: [...tableNodes, ...rawNodes], edges: [...fkEdges, ...rawEdges] };
}

function GraphView({
  onClearSelections,
  onOpenEditor,
}: {
  onClearSelections: () => void;
  onOpenEditor: (fileId: string) => void;
}) {
  const flatFiles = useWikiStore((state) => state.flatFiles);
  const vaults = useWikiStore((state) => state.vaults);
  const graphScope = useWikiStore((state) => state.graphScope);
  const hoverScope = useWikiStore((state) => state.hoverScope);

  const selectedId = useWikiStore((state) => state.selectedFileId);
  const previewFileId = useWikiStore((state) => state.graphPreviewId);
  const setGraphPreview = useWikiStore((state) => state.setGraphPreview);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const runSearch = useWikiSearch(flatFiles);
  const rfInstance = useRef<ReactFlowInstance<Node<WikiNodeData>, Edge<WikiEdgeData>> | null>(null);

  // Hybrid graph: markdown documents + the Supabase brain schema (tables, FKs, raw sources).
  const [graphMode, setGraphMode] = useState<GraphFilterMode>('markdown');
  const [schemaGraph, setSchemaGraph] = useState<SchemaGraphPayload | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);

  useEffect(() => {
    if (graphMode === 'markdown' || schemaGraph) return;
    let cancelled = false;
    fetch('/api/brain/schema-graph')
      .then((response) => response.json())
      .then((payload) => {
        if (cancelled) return;
        if (payload?.success) {
          setSchemaGraph(payload as SchemaGraphPayload);
          setSchemaError(null);
        } else {
          setSchemaError(payload?.message || 'Schema graph unavailable. Configure Supabase to enable the database layer.');
        }
      })
      .catch((error) => {
        if (!cancelled) setSchemaError(error instanceof Error ? error.message : 'Schema graph request failed.');
      });
    return () => {
      cancelled = true;
    };
  }, [graphMode, schemaGraph]);

  const schemaFlow = useMemo(() => (schemaGraph ? buildSchemaFlow(schemaGraph) : null), [schemaGraph]);

  const graphInputKey = useMemo(
    () =>
      flatFiles
        .map((file) =>
          [
            file.id,
            file.name,
            file.path,
            file.vaultId,
            file.vaultName,
            extractLinks(file.content).join('\u001f'),
          ].join('\u001d'),
        )
        .join('\u001e'),
    [flatFiles],
  );

  const layout = useMemo(() => {
    const graph = buildGraph(flatFiles);
    return computeLayout(graph.nodes, graph.edges);
  }, [graphInputKey]);

  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const edge of layout.edges) {
      if (!map.has(edge.source)) map.set(edge.source, new Set());
      if (!map.has(edge.target)) map.set(edge.target, new Set());
      map.get(edge.source)!.add(edge.target);
      map.get(edge.target)!.add(edge.source);
    }
    return map;
  }, [layout.edges]);

  const focusedFromNode = useMemo(() => {
    if (!hoverId || !neighbors.has(hoverId)) return null;
    const set = new Set<string>([hoverId]);
    for (const n of neighbors.get(hoverId) || []) set.add(n);
    return set;
  }, [hoverId, neighbors]);

  const nodeIdSet = useMemo(() => new Set(Array.from(layout.nodes.keys())), [layout.nodes]);
  const activeFocusScope = hoverScope ?? (graphScope.type === 'all' ? null : graphScope);
  const lockedFocusActive = !hoverScope && graphScope.type !== 'all';

  const focusedFromScope = useMemo(() => {
    if (!activeFocusScope) return null;
    if (activeFocusScope.type === 'file') {
      if (!nodeIdSet.has(activeFocusScope.fileId)) return null;
      const set = new Set<string>([activeFocusScope.fileId]);
      for (const n of neighbors.get(activeFocusScope.fileId) || []) set.add(n);
      return set;
    }

    if (activeFocusScope.type === 'vault') {
      const set = new Set<string>();
      const brainNodeId = `brain:vault:${activeFocusScope.vaultId}`;
      if (nodeIdSet.has(brainNodeId)) set.add(brainNodeId);
      for (const file of flatFiles) {
        if (file.vaultId !== activeFocusScope.vaultId) continue;
        if (nodeIdSet.has(file.id)) set.add(file.id);
      }
      return set.size > 0 ? set : null;
    }

    const set = new Set<string>();
    for (const file of flatFiles) {
      if (file.vaultId !== activeFocusScope.vaultId) continue;
      if (!fileInFolderPath(file, activeFocusScope.folderPath)) continue;
      if (nodeIdSet.has(file.id)) set.add(file.id);
    }
    return set.size > 0 ? set : null;
  }, [activeFocusScope, flatFiles, neighbors, nodeIdSet]);

  const focusedSet = hoverId ? focusedFromNode : focusedFromScope;
  const hoverKind: HoverState['hoverKind'] = hoverId ? 'node' : focusedFromScope ? (lockedFocusActive ? 'lock' : 'scope') : null;

  const searchResponse = useMemo(
    () => runSearch({ query: searchQuery, mode: 'agent', limit: 20, includeNeighbors: 1 }),
    [runSearch, searchQuery],
  );
  const searchResults = searchResponse.hits;

  const searchMatchSet = useMemo(() => {
    if (searchResults.length === 0) return null;
    return new Set(searchResults.map((result) => result.fileId));
  }, [searchResults]);

  const baseNodes = useMemo<Node<WikiNodeData>[]>(() => {
    return Array.from(layout.nodes.entries()).map(([id, n]) => {
      const radius = n.brain
        ? 13
        : n.subBrain
          ? 11
          : Math.max(5, (n.unresolved ? 4 : 6) + Math.sqrt(Math.max(n.weight, 1)) * 3.2);
      return {
        id,
        type: 'wiki',
        position: { x: n.x - NODE_HITBOX / 2, y: n.y - NODE_HITBOX / 2 },
        data: {
          title: n.title,
          radius,
          unresolved: n.unresolved,
          important: n.weight >= 2 || !!n.brain || !!n.subBrain,
          brain: n.brain,
          subBrain: n.subBrain,
        },
        draggable: !n.brain && !n.subBrain,
        selectable: false,
      };
    });
  }, [layout.nodes]);

  const vaultColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const vault of vaults) map.set(vault.id, getVaultColor(vault));
    return map;
  }, [vaults]);

  const baseEdges = useMemo<Edge<WikiEdgeData>[]>(() => {
    return layout.edges.map((edge) => {
      const sourceNode = layout.nodes.get(edge.source);
      const vaultColor = sourceNode?.vaultId ? (vaultColorMap.get(sourceNode.vaultId) ?? undefined) : undefined;
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'wiki',
        data: { unresolved: edge.unresolved, brainMap: edge.brainMap, brainAnchor: edge.brainAnchor, vaultColor },
      };
    });
  }, [layout.edges, layout.nodes, vaultColorMap]);

  const combinedNodes = useMemo<Node<WikiNodeData>[]>(() => {
    const dbNodes = (schemaFlow?.nodes ?? []) as unknown as Node<WikiNodeData>[];
    if (graphMode === 'database') return dbNodes;
    if (graphMode === 'hybrid') return [...baseNodes, ...dbNodes];
    return baseNodes;
  }, [baseNodes, schemaFlow, graphMode]);

  const combinedEdges = useMemo<Edge<WikiEdgeData>[]>(() => {
    const dbEdges = (schemaFlow?.edges ?? []) as unknown as Edge<WikiEdgeData>[];
    if (graphMode === 'database') return dbEdges;
    if (graphMode === 'hybrid') return [...baseEdges, ...dbEdges];
    return baseEdges;
  }, [baseEdges, schemaFlow, graphMode]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<WikiNodeData>>(combinedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<WikiEdgeData>>(combinedEdges);
  const nextNodesRef = useRef(combinedNodes);
  const nextEdgesRef = useRef(combinedEdges);
  nextNodesRef.current = combinedNodes;
  nextEdgesRef.current = combinedEdges;

  const graphKey = useMemo(() => {
    const nodeIds = Array.from(layout.nodes.keys()).sort().join('|');
    const edgeIds = layout.edges.map((edge) => edge.id).sort().join('|');
    const dbKey = `${graphMode}:${schemaFlow?.nodes.length ?? 0}:${schemaFlow?.edges.length ?? 0}`;
    return `${nodeIds}::${edgeIds}::${dbKey}`;
  }, [layout.edges, layout.nodes, graphMode, schemaFlow]);

  useEffect(() => {
    setNodes(nextNodesRef.current);
  }, [graphKey, setNodes]);

  useEffect(() => {
    setEdges(nextEdgesRef.current);
  }, [graphKey, setEdges]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      rfInstance.current?.fitView({ padding: 0.3, maxZoom: 0.9 });
    });
    return () => cancelAnimationFrame(id);
  }, [graphKey]);

  const handleClick: NodeMouseHandler = (_, node) => {
    if (node.id.startsWith('unresolved:')) return;
    setGraphPreview(node.id);
  };

  const handlePaneClick = useCallback(() => {
    setHoverId(null);
    setSearchQuery('');
    onClearSelections();
  }, [onClearSelections]);

  const ctxValue = useMemo<HoverState>(
    () => ({ hoverId, hoverKind, focusedSet, selectedId, previewId: previewFileId, searchMatchSet }),
    [hoverId, hoverKind, focusedSet, selectedId, previewFileId, searchMatchSet],
  );

  const previewFile =
    previewFileId && previewFileId !== BRAIN_NODE_ID && !isVaultBrainNodeId(previewFileId)
      ? flatFiles.find((file) => file.id === previewFileId) || null
      : null;
  const previewVault = previewFileId && isVaultBrainNodeId(previewFileId)
    ? vaults.find((vault) => vault.id === vaultIdFromBrainNodeId(previewFileId)) ?? null
    : null;
  const brainMetaFiles = useMemo(() => flatFiles.filter(isBrainMetaFile), [flatFiles]);
  const brainHomeFiles = useMemo(() => brainMetaFiles.filter(isBrainHomeFile), [brainMetaFiles]);

  return (
    <HoverContext.Provider value={ctxValue}>
      <div
        className={`graphCanvas ${focusedSet ? 'is-hovering' : ''} ${lockedFocusActive ? 'is-locked-focus' : ''} ${previewFileId ? 'has-preview' : ''}`}
      >
        <GraphSearchPanel
          query={searchQuery}
          results={searchResults}
          onQueryChange={setSearchQuery}
          onSelect={(id) => setGraphPreview(id)}
        />
        <div className="graphModePanel">
          {(['markdown', 'database', 'hybrid'] as GraphFilterMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className={graphMode === mode ? 'is-active' : ''}
              onClick={() => setGraphMode(mode)}
            >
              {mode}
            </button>
          ))}
          {schemaError && graphMode !== 'markdown' ? (
            <span className="graphModePanel__error" title={schemaError}>
              DB layer unavailable
            </span>
          ) : null}
        </div>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onInit={(instance) => {
            rfInstance.current = instance;
            instance.fitView({ padding: 0.3, maxZoom: 0.9 });
          }}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          minZoom={0.05}
          maxZoom={6}
          nodesDraggable
          panOnDrag
          zoomOnScroll
          panOnScroll={false}
          onNodeClick={handleClick}
          onPaneClick={handlePaneClick}
          onNodeMouseEnter={(_, node) => setHoverId(node.id)}
          onNodeMouseLeave={() => setHoverId(null)}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={32} color="rgba(15,23,42,0.08)" />
          <Controls showInteractive={false} />
        </ReactFlow>
        {previewFile && (
          <GraphPreviewPanel
            file={previewFile}
            onClose={() => setGraphPreview(null)}
            onOpenEditor={() => onOpenEditor(previewFile.id)}
          />
        )}
        {!previewFile && previewFileId === BRAIN_NODE_ID && (
          <BrainMapPanel
            vaults={vaults}
            files={brainHomeFiles}
            onClose={() => setGraphPreview(null)}
            onOpenFile={(fileId) => {
              setGraphPreview(null);
              onOpenEditor(fileId);
            }}
          />
        )}
        {!previewFile && previewVault && (
          <SubBrainPanel
            vault={previewVault}
            homeFile={brainHomeFileMap(brainHomeFiles).get(previewVault.id) ?? null}
            metaFiles={brainMetaFiles.filter((file) => file.vaultId === previewVault.id)}
            onClose={() => setGraphPreview(null)}
            onOpenFile={(fileId) => {
              setGraphPreview(null);
              onOpenEditor(fileId);
            }}
          />
        )}
      </div>
    </HoverContext.Provider>
  );
}

function WikiNodeView({ id, data }: NodeProps<Node<WikiNodeData>>) {
  const ctx = useContext(HoverContext);
  const isHover = ctx.hoverKind === 'node' && ctx.hoverId === id;
  const isHighlight = ctx.focusedSet?.has(id) ?? false;
  const isSearchMatch = ctx.searchMatchSet?.has(id) ?? false;
  const isSearchDim = ctx.searchMatchSet !== null && !isSearchMatch;
  const isDim = (ctx.focusedSet !== null && !isHighlight) || isSearchDim;
  const isCurrent = ctx.selectedId === id;
  const isPreview = ctx.previewId === id;
  const isImportant = Boolean(data.important);
  const isBrain = Boolean(data.brain);
  const isSubBrain = Boolean(data.subBrain);

  const size = data.radius * 2;
  const wrapperStyle = {
    width: NODE_HITBOX,
    height: NODE_HITBOX,
    ['--dot-half' as string]: `${data.radius}px`,
  } as React.CSSProperties;

  return (
    <div
      className={`graphNode ${isDim ? 'dim' : ''} ${isHighlight && !isHover ? 'highlight' : ''} ${isHover ? 'hover' : ''} ${isCurrent ? 'current' : ''} ${isPreview ? 'preview' : ''} ${isImportant ? 'important' : ''} ${isSearchMatch ? 'searchMatch' : ''} ${isBrain ? 'brain' : ''} ${isSubBrain ? 'subBrain' : ''}`}
      style={wrapperStyle}
    >
      <Handle type="target" position={Position.Top} className="graphHandle" isConnectable={false} />
      <Handle type="source" position={Position.Bottom} className="graphHandle" isConnectable={false} />
      <div
        className={`graphDot ${data.unresolved ? 'unresolved' : ''} ${isBrain ? 'brain' : ''} ${isSubBrain ? 'subBrain' : ''}`}
        style={{ width: size, height: size }}
      />
      <span className="graphLabel" style={{ fontSize: Math.min(15, 12 + Math.sqrt(data.radius) * 0.7) }}>
        {data.title}
      </span>
    </div>
  );
}

function WikiEdgeView({ id, source, target, sourceX, sourceY, targetX, targetY, data }: EdgeProps<Edge<WikiEdgeData>>) {
  const ctx = useContext(HoverContext);
  const inFocus = !!(ctx.focusedSet && ctx.focusedSet.has(source) && ctx.focusedSet.has(target));
  const directlyConnected = ctx.hoverId === source || ctx.hoverId === target;
  const highlight = ctx.hoverKind === 'node' ? inFocus && directlyConnected : inFocus;
  const searchActive = ctx.searchMatchSet !== null;
  const searchEdge = !!(ctx.searchMatchSet && (ctx.searchMatchSet.has(source) || ctx.searchMatchSet.has(target)));
  const dim = (ctx.focusedSet !== null && !highlight) || (searchActive && !searchEdge);

  const [edgePath] = getStraightPath({ sourceX, sourceY, targetX, targetY });

  const baseColor = data?.vaultColor ?? 'rgba(15, 23, 42, 1)';

  function withAlpha(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  const coloredBase = baseColor.startsWith('#') ? withAlpha(baseColor, 0.18) : 'rgba(15, 23, 42, 0.18)';
  const coloredHighlight = baseColor.startsWith('#') ? withAlpha(baseColor, 0.58) : 'rgba(15, 23, 42, 0.58)';
  const coloredSearch = baseColor.startsWith('#') ? withAlpha(baseColor, 0.38) : 'rgba(15, 23, 42, 0.38)';

  let stroke = data?.unresolved
    ? 'rgba(120, 113, 108, 0.32)'
    : coloredBase;
  let strokeWidth = 1;
  let opacity = 1;
  if (highlight) {
    stroke = coloredHighlight;
    strokeWidth = 1.6;
  } else if (searchEdge) {
    stroke = coloredSearch;
    strokeWidth = 1.2;
  }
  if (dim) opacity = 0.14;

  return <BaseEdge id={id} path={edgePath} style={{ stroke, strokeWidth, opacity }} />;
}

function GraphSearchPanel({
  query,
  results,
  onQueryChange,
  onSelect,
}: {
  query: string;
  results: WikiSearchHit[];
  onQueryChange: (value: string) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="graphSearchPanel">
      <label className="graphSearchBox">
        <Search size={14} />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search keywords..."
        />
      </label>
      {query.trim() && (
        <div className="graphSearchResults">
          <div className="graphSearchMeta">
            {results.length === 0 ? 'No matches' : `${results.length} matches`}
          </div>
          {results.map((hit) => (
            <button key={hit.fileId} type="button" onClick={() => onSelect(hit.fileId)}>
              <strong>{hit.title}</strong>
              <span>{hit.vaultName} / {hit.path}</span>
              <small>{formatSearchSnippet(hit)}</small>
              <em>
                {hit.whyMatched.slice(0, 4).join(' · ')}
                {hit.neighbors.length > 0 ? ` · ${hit.neighbors.length} neighbors` : ''}
              </em>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function formatSearchSnippet(hit: WikiSearchHit): string {
  const chunk = hit.bestChunks[0];
  if (!chunk) return 'No matching section found.';
  const heading = chunk.headingPath.length > 0 ? `${chunk.headingPath.join(' / ')}: ` : '';
  const text = chunk.text.replace(/\s+/g, ' ').trim();
  return `${heading}${text.length > 170 ? `${text.slice(0, 170)}...` : text}`;
}

function GraphPreviewPanel({
  file,
  onClose,
  onOpenEditor,
}: {
  file: WikiFile;
  onClose: () => void;
  onOpenEditor: () => void;
}) {
  const parsed = useMemo(() => parseFrontmatter(file.content), [file.content]);
  const previewProperties = parsed.properties.filter((property) => !isRedundantSignatureProperty(property.key));

  return (
    <aside className="graphPreviewPanel">
      <div className="graphPreviewHeader">
        <div>
          <span className="graphPreviewPath">{file.vaultName} / {file.path}</span>
          <h2>
            {fileTitle(file)}
            {file.dirty && <span className="graphPreviewDirty" title="unsaved" />}
          </h2>
        </div>
        <button className="graphPreviewClose" type="button" onClick={onClose} aria-label="Close preview">
          <X size={16} />
        </button>
      </div>

      {previewProperties.length > 0 && (
        <div className="graphPreviewProperties">
          {previewProperties.map((prop) => (
            <div className="graphPreviewProp" key={prop.key}>
              <span>{prop.key}</span>
              <strong>{formatPreviewValue(prop.value)}</strong>
            </div>
          ))}
        </div>
      )}

      <div className="graphPreviewMarkdown markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{parsed.body || '_Empty file._'}</ReactMarkdown>
      </div>

      <div className="graphPreviewActions">
        <button className="ghost" type="button" onClick={onClose}>
          Close
        </button>
        <button className="primary" type="button" onClick={onOpenEditor}>
          Open in editor
        </button>
      </div>
    </aside>
  );
}

function BrainMapPanel({
  vaults,
  files,
  onClose,
  onOpenFile,
}: {
  vaults: WikiVault[];
  files: WikiFile[];
  onClose: () => void;
  onOpenFile: (fileId: string) => void;
}) {
  const brainFileByVaultId = useMemo(() => brainHomeFileMap(files), [files]);
  const readme = useMemo(() => buildCentralBrainReadme(vaults, files), [vaults, files]);

  return (
    <aside className="graphPreviewPanel">
      <div className="graphPreviewHeader">
        <div>
          <span className="graphPreviewPath">brain://big-brain</span>
          <h2>Big Brain</h2>
        </div>
        <button className="graphPreviewClose" type="button" onClick={onClose} aria-label="Close preview">
          <X size={16} />
        </button>
      </div>

      <div className="graphPreviewMarkdown markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{readme}</ReactMarkdown>
        <div className="brainLinks">
          {vaults.length === 0 ? (
            <p>No Sub-Brains loaded.</p>
          ) : (
            vaults.map((vault) => {
              const brainFile = brainFileByVaultId.get(vault.id);
              return brainFile ? (
                <button
                  key={vault.id}
                  className="brainLink"
                  type="button"
                  onClick={() => onOpenFile(brainFile.id)}
                >
                  {vault.name}: {brainFile.path}
                </button>
              ) : (
                <span key={vault.id} className="brainMissing">
                  {vault.name}: {brainFileNameForWiki(vault.name)} will be created on the next reload.
                </span>
              );
            })
          )}
        </div>
      </div>

      <div className="graphPreviewActions">
        <button className="ghost" type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </aside>
  );
}

function SubBrainPanel({
  vault,
  homeFile,
  metaFiles,
  onClose,
  onOpenFile,
}: {
  vault: WikiVault;
  homeFile: WikiFile | null;
  metaFiles: WikiFile[];
  onClose: () => void;
  onOpenFile: (fileId: string) => void;
}) {
  const visibleFileCount = vault.flatFiles.filter((file) => !isBrainMetaFile(file)).length;
  const sortedMetaFiles = [...metaFiles].sort((a, b) => {
    const order = (file: WikiFile) => {
      if (isBrainHomeFile(file)) return 0;
      if (file.name.toLowerCase() === 'agent_start.md') return 1;
      if (file.name.toLowerCase() === 'log.md') return 2;
      if (file.name.toLowerCase() === 'index.md') return 3;
      return 4;
    };
    return order(a) - order(b) || a.path.localeCompare(b.path);
  });

  return (
    <aside className="graphPreviewPanel">
      <div className="graphPreviewHeader">
        <div>
          <span className="graphPreviewPath">{`brain://${vault.id}`}</span>
          <h2>{vault.name.toLowerCase().endsWith('brain') ? vault.name : `${vault.name} Brain`}</h2>
        </div>
        <button className="graphPreviewClose" type="button" onClick={onClose} aria-label="Close preview">
          <X size={16} />
        </button>
      </div>

      <div className="graphPreviewMarkdown markdown">
        <p>This is the anchor node for all Markdown files inside this Sub-Brain.</p>
        <p>Visible content files: {visibleFileCount}</p>
        <p>Internal agent files: {sortedMetaFiles.length}</p>
        {homeFile ? (
          <button className="brainLink" type="button" onClick={() => onOpenFile(homeFile.id)}>
            Open {homeFile.path}
          </button>
        ) : (
          <p>{brainFileNameForWiki(vault.name)} will be created on the next reload.</p>
        )}
        {sortedMetaFiles.length > 0 && (
          <div className="brainLinks">
            <h3>Internal Brain Files</h3>
            {sortedMetaFiles.map((file) => (
              <button className="brainLink" key={file.id} type="button" onClick={() => onOpenFile(file.id)}>
                {file.path}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="graphPreviewActions">
        <button className="ghost" type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </aside>
  );
}

function buildCentralBrainReadme(vaults: WikiVault[], brainFiles: WikiFile[]): string {
  const brainFileByVaultId = brainHomeFileMap(brainFiles);
  const brainLines =
    vaults.length === 0
      ? '- No Sub-Brains loaded yet.'
      : vaults
          .map((vault) => {
            const brainFile = brainFileByVaultId.get(vault.id);
            const path = brainFile?.path || `${vault.name}/${brainFileNameForWiki(vault.name)}`;
            return `- ${vault.name}: [[${path.replace(/\.md$/i, '')}]]`;
          })
          .join('\n');

  return `# Big Brain

This is the global Agent Navigation Contract for the entire Big Brain system. It tells humans and agents how to enter the knowledge graph, find the right Sub-Brain, and maintain the system without losing structure.

## Purpose

The Big Brain coordinates all loaded Sub-Brains. It is not the place for every detail; it is the global map, operating manual, and agent entry point.

## Role In The System
- Owns: global navigation, cross-Brain relationships, shared conventions, and agent startup rules.
- Does not own: detailed topic knowledge that belongs inside a specific Sub-Brain.
- Connects: every Sub-Brain node and any cross-Brain relationship worth preserving.
- Entry point: agents should start here before reading or editing any Sub-Brain.

## Agent Start Here
1. Read this Big Brain node.
2. Use the Global Navigation Index to choose the relevant Sub-Brain.
3. Read the selected Sub-Brain file completely.
4. Check \`log.md\` when present.
5. Read listed Core Nodes, Hubs, Sources, and Open Questions.
6. Only edit after you understand which Brain owns the work.

## Knowledge Layers

- Raw sources are immutable source-of-truth material. Agents may read and cite them, but should not rewrite them.
- Brain pages are the compiled knowledge layer. Agents may create and update them.
- Brain files are the anchor and map layer. They define conventions, workflows, navigation, and agent behavior.
- Hub pages are optional content maps when a Brain becomes large.
- Logs are chronological memory. They help agents understand recent changes.

## Global Navigation Index

### Big Brain
- [[Big Brain]] - global entry point, conventions, and cross-Brain navigation.

### Sub-Brains
${brainLines}

### Cross-Brain Map
- Add durable cross-Brain relationships here when they become important.
- A cross-Brain relationship should explain why two Brains inform each other.

## Workflows

### Route A Query
- Identify which Sub-Brain owns the question.
- Read that Sub-Brain file, then its hubs and sources.
- Use cross-Brain links only when the answer genuinely spans multiple Brains.

### Add A Brain
- Open the folder as a Brain.
- Confirm its Brain file exists.
- Fill Purpose, Role In The Big Brain, Navigation Index, Current Map, and Handoff Notes after the first review.
- Do not create \`_README.md\`, \`README.md\`, or per-folder index files automatically.

### Ingest
- Ingest sources inside the owning Sub-Brain.
- Update the owning Brain file if the new source changes the Brain role or navigation map.
- Add cross-Brain links only when they create durable navigation value.

### Lint
- Check whether every Sub-Brain has a useful Brain file, optional hubs, and current handoff notes.
- Find orphan clusters, missing Brain links, stale roles, and unexplained cross-Brain edges.

## Graph Rules

- Markdown wiki links are the real knowledge structure. Tags are secondary grouping hints.
- A link should be explainable in one sentence.
- Cross-Brain links are valuable when they expose a real relationship between Sub-Brains.
- Each Sub-Brain node is the center node of its own cluster.
- Brain anchor edges in the graph contain every Markdown file in that Sub-Brain; content links still carry semantic meaning.
- Folder names are organization hints; durable navigation belongs in Brain files, hub pages, and concrete content pages.

## Writing Rules
- Preserve raw sources.
- Keep durable claims source-backed or clearly marked as synthesis.
- Update affected Brain files when structure, role, ownership, or cross-Brain relationships change.
- Do not invent facts. Add Open Questions when uncertain.

## Agent Handoff Notes
- Start from the Big Brain node.
- Then choose the owning Sub-Brain file.
- Keep handoff notes short, operational, and updated when important context changes.
`;
}

function formatPreviewValue(value: unknown): string {
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : 'No value';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === null || value === undefined || value === '') return 'No value';
  return String(value);
}

async function readJsonPayload(response: Response): Promise<Record<string, unknown>> {
  const raw = await response.text();
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function copyTextToClipboard(value: string): Promise<boolean> {
  const text = value.trim();
  if (!text) return false;

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fallback below
    }
  }

  if (typeof document === 'undefined') return false;
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    area.style.pointerEvents = 'none';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}

function collaborationSnapshotFromStore(): CollaborationStateSnapshot {
  const state = useWikiStore.getState();
  return {
    actors: state.actors,
    currentActorId: state.currentActorId,
    memberships: state.memberships,
    invitations: state.invitations,
    changeEvents: state.changeEvents,
    fileVersions: state.fileVersions,
    fileBaselines: state.fileBaselines,
    conflicts: state.conflicts,
  };
}

function versionFromSave(event: ChangeEvent, actor: CollaborationActor, content: string): FileVersion {
  return {
    id: `version:${event.id}`,
    vaultId: event.vaultId,
    fileId: event.fileId,
    filePath: event.filePath,
    actorId: actor.id,
    actorName: actor.name,
    summary: event.summary,
    createdAt: event.createdAt,
    contentHash: event.contentHash,
    content,
  };
}

function brainHomeFileMap(files: WikiFile[]): Map<string, WikiFile> {
  const map = new Map<string, WikiFile>();
  for (const file of files) {
    const existing = map.get(file.vaultId);
    const isLegacy = file.name.toLowerCase().endsWith('-protocol.md') || file.name.toLowerCase() === 'brain_protocol.md';
    const existingIsLegacy = existing
      ? existing.name.toLowerCase().endsWith('-protocol.md') || existing.name.toLowerCase() === 'brain_protocol.md'
      : false;
    if (!existing || (existingIsLegacy && !isLegacy)) map.set(file.vaultId, file);
  }
  return map;
}

function initialsForName(name: string): string {
  const parts = name
    .replace(/\([^)]*\)/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function collaboratorsForVault(
  vaultId: string,
  memberships: BrainMembership[],
  actors: CollaborationActor[],
): string[] {
  const seen = new Set<string>();
  return memberships
    .filter((membership) => membership.vaultId === vaultId && membership.role !== 'owner')
    .map((membership) => {
      const actor = actors.find((entry) => entry.id === membership.actorId);
      return actor ? actor.name : membership.actorId;
    })
    .filter((name) => {
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    });
}

function AddBrainDialog({
  onClose,
  onCreate,
  onJoinCode,
}: {
  onClose: () => void;
  onCreate: () => void;
  onJoinCode: (code: string, actorName: string, handle: FileSystemDirectoryHandle) => boolean | Promise<boolean>;
}) {
  const [code, setCode] = useState('');
  const [actorName, setActorName] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const joinPickerBusyRef = useRef(false);

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <div className="addBrainDialog" role="dialog" aria-modal="true" aria-label="Add Brain" onMouseDown={(event) => event.stopPropagation()}>
        <div className="addBrainHeader">
          <div>
            <h2>Add Brain</h2>
            <p>Join an existing shared Brain or create one from a local folder.</p>
          </div>
          <button className="graphPreviewClose" type="button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="addBrainChoices">
          <form
            className="addBrainCard"
            onSubmit={async (event) => {
              event.preventDefault();
              if (joinPickerBusyRef.current) return;
              if (typeof window === 'undefined' || !window.showDirectoryPicker) {
                setJoinError('Folder picker is not supported in this browser.');
                return;
              }
              joinPickerBusyRef.current = true;
              let handle: FileSystemDirectoryHandle | null = null;
              try {
                handle = await window.showDirectoryPicker({ mode: 'readwrite' });
              } catch (err) {
                joinPickerBusyRef.current = false;
                if ((err as DOMException)?.name !== 'AbortError') setJoinError('Folder could not be selected.');
                return;
              }
              setJoining(true);
              const ok = await onJoinCode(code, actorName, handle);
              setJoining(false);
              joinPickerBusyRef.current = false;
              if (!ok) {
                setJoinError('Invite code not found or already used.');
                return;
              }
              onClose();
            }}
          >
            <strong>Join</strong>
            <span>Enter an invite code from another collaborator.</span>
            <input
              value={code}
              placeholder="BRAIN-AB12-CD34"
              onChange={(event) => {
                setCode(event.target.value);
                setJoinError(null);
              }}
            />
            <input
              value={actorName}
              placeholder="Your collaborator name"
              onChange={(event) => setActorName(event.target.value)}
            />
            {joinError && <em>{joinError}</em>}
            <button className="primary" type="submit" disabled={joining}>
              {joining ? 'Joining...' : 'Join with code'}
            </button>
          </form>

          <div className="addBrainCard">
            <strong>Create</strong>
            <span>Select a local Markdown folder and add it as a new Brain.</span>
            <button
              className="primary"
              type="button"
              onClick={() => {
                // #region agent log
                fetch('http://127.0.0.1:7539/ingest/51ee9c2c-12ff-4dbc-8efa-618f72ca3779',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c84f03'},body:JSON.stringify({sessionId:'c84f03',runId:'pre-fix-1',hypothesisId:'H1',location:'src/app/page.tsx:AddBrainDialog.createButton',message:'Create button pressed inside Add Brain dialog',data:{hasPicker:typeof window!=='undefined'&&typeof window.showDirectoryPicker==='function'},timestamp:Date.now()})}).catch(()=>{});
                // #endregion
                onCreate();
              }}
            >
              <FolderOpen size={16} />
              Choose folder
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onAddBrain }: { onAddBrain: () => void }) {
  return (
    <div className="empty">
      <div>
        <h2>Add Brain</h2>
        <p>Join an existing Brain with a code or create one from a Markdown folder.</p>
        <button className="primary" onClick={onAddBrain}>
          <Plus size={16} />
          Add Brain
        </button>
      </div>
    </div>
  );
}

function ReconnectState({
  count,
  onReconnect,
  onAddBrain,
  onForgetSaved,
}: {
  count: number;
  onReconnect: () => void;
  onAddBrain: () => void;
  onForgetSaved: () => void;
}) {
  return (
    <div className="empty">
      <div>
        <h2>Reconnect Brains</h2>
        <p>
          {count === 1
            ? 'One saved Brain needs folder access again after refresh.'
            : `${count} saved Brains need folder access again after refresh.`}
        </p>
        <div className="emptyActions">
          <button className="primary" type="button" onClick={onReconnect}>
            <FolderOpen size={16} />
            Reconnect
          </button>
          <button className="ghost" type="button" onClick={onAddBrain}>
            Add another Brain
          </button>
          <button className="ghost" type="button" onClick={onForgetSaved}>
            Forget saved Brains
          </button>
        </div>
      </div>
    </div>
  );
}

const INVITE_ROLES: Exclude<BrainRole, 'owner'>[] = ['admin', 'editor', 'commenter', 'viewer', 'agent'];
const MEMBER_ROLES: BrainRole[] = ['owner', 'admin', 'editor', 'commenter', 'viewer', 'agent'];

function CollaborationPanel({
  vaults,
  activeVaultId,
  actors,
  currentActorId,
  memberships,
  invitations,
  onCurrentActorChange,
  onInvite,
  onRevokeInvitation,
  onSetMemberRole,
  onRemoveMember,
}: {
  vaults: WikiVault[];
  activeVaultId: string | null;
  actors: CollaborationActor[];
  currentActorId: string;
  memberships: BrainMembership[];
  invitations: BrainInvitation[];
  onCurrentActorChange: (actorId: string) => void;
  onInvite: (vaultId: string, role: Exclude<BrainRole, 'owner'>) => Promise<string | null>;
  onRevokeInvitation: (invitationId: string) => void;
  onSetMemberRole: (vaultId: string, actorId: string, role: BrainRole) => void;
  onRemoveMember: (vaultId: string, actorId: string) => void;
}) {
  const activeVault = vaults.find((vault) => vault.id === activeVaultId) ?? vaults[0] ?? null;
  const currentRole = getActorBrainRole(memberships, activeVault?.id, currentActorId);
  const canInvite = roleCanInvite(currentRole);
  const [role, setRole] = useState<Exclude<BrainRole, 'owner'>>('editor');
  const [lastInviteCode, setLastInviteCode] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const currentActorType = actors.find((actor) => actor.id === currentActorId)?.type ?? DEFAULT_OWNER_ACTOR.type;
  const actorIdForType = (type: CollaborationActor['type']) =>
    actors.find((actor) => actor.type === type)?.id ?? (type === 'agent' ? DEFAULT_AGENT_ACTOR.id : DEFAULT_OWNER_ACTOR.id);
  const copyInviteCode = async (code: string) => {
    const copied = await copyTextToClipboard(code);
    setCopyFeedback(copied ? 'Code copied.' : 'Copy blocked. Please copy manually.');
  };

  const vaultMemberships = activeVault
    ? memberships.filter((membership) => membership.vaultId === activeVault.id)
    : [];
  const vaultInvitations = activeVault
    ? invitations.filter((invitation) => invitation.vaultId === activeVault.id && invitation.status === 'pending')
    : [];

  return (
    <div className="collabPanel">
      <div className="panelTitle">Collaboration</div>
      <label className="collabField">
        <span>Acting as</span>
        <select
          value={currentActorType}
          onChange={(event) => onCurrentActorChange(actorIdForType(event.target.value as CollaborationActor['type']))}
        >
          <option value="user">Human</option>
          <option value="agent">Agent</option>
        </select>
      </label>

      <div className="collabMeta">
        <strong>{activeVault?.name ?? 'No Brain selected'}</strong>
        <span>Role: {currentRole ?? 'none'}</span>
      </div>

      {activeVault && canInvite && (
        <form
          className="collabInvite"
          onSubmit={async (event) => {
            event.preventDefault();
            const inviteCode = await onInvite(activeVault.id, role);
            setLastInviteCode(inviteCode);
          }}
        >
          <select value={role} onChange={(event) => setRole(event.target.value as Exclude<BrainRole, 'owner'>)}>
            {INVITE_ROLES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <button type="submit">Invite</button>
          {lastInviteCode && (
            <div className="inviteCodePanel">
              <code className="inviteCode">{lastInviteCode}</code>
              <button type="button" onClick={() => void copyInviteCode(lastInviteCode)}>
                Copy code
              </button>
            </div>
          )}
          {copyFeedback && <span className="copyFeedback">{copyFeedback}</span>}
        </form>
      )}

      <div className="collabList">
        <span className="collabListTitle">Members</span>
        {vaultMemberships.map((membership) => {
          const actor = actors.find((entry) => entry.id === membership.actorId);
          return (
            <div className="collabRow" key={`${membership.vaultId}-${membership.actorId}`}>
              <span>{actor?.name ?? membership.actorId}</span>
              <div className="collabActions">
                <select
                  value={membership.role}
                  disabled={!canInvite || membership.role === 'owner'}
                  onChange={(event) => onSetMemberRole(membership.vaultId, membership.actorId, event.target.value as BrainRole)}
                >
                  {MEMBER_ROLES.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!canInvite || membership.role === 'owner'}
                  onClick={() => onRemoveMember(membership.vaultId, membership.actorId)}
                >
                  Remove
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {vaultInvitations.length > 0 && (
        <div className="collabList">
          <span className="collabListTitle">Pending invites</span>
          {vaultInvitations.map((invitation) => (
            <div className="collabRow" key={invitation.id}>
              <span>
                Pending collaborator
                {invitation.inviteCode && <code className="inviteCode">{invitation.inviteCode}</code>}
              </span>
              <div className="collabActions">
                <em>{invitation.role}</em>
                {invitation.inviteCode && (
                  <button type="button" onClick={() => void copyInviteCode(invitation.inviteCode ?? '')}>
                    Copy code
                  </button>
                )}
                <button type="button" disabled={!canInvite} onClick={() => onRevokeInvitation(invitation.id)}>
                  Revoke
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LogHistoryPanel({
  events,
  actors,
  versions,
}: {
  events: ChangeEvent[];
  actors: CollaborationActor[];
  versions: FileVersion[];
}) {
  return (
    <div className="logPanel">
      <div className="panelTitle">Log History</div>
      {events.length === 0 ? (
        <p className="panelEmpty">No local change events yet.</p>
      ) : (
        <div className="logEventList">
          {events.map((event) => {
            const actor = actors.find((entry) => entry.id === event.actorId);
            return (
              <div className="logEvent" key={event.id}>
                <div className="logEventTop">
                  <strong>{event.summary}</strong>
                  <span>{new Date(event.createdAt).toLocaleString()}</span>
                </div>
                <div className="logEventMeta">
                  {event.filePath} · {actor?.name ?? event.actorId} · {event.action}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="panelTitle panelTitleSecondary">Versions</div>
      {versions.length === 0 ? (
        <p className="panelEmpty">No saved versions yet.</p>
      ) : (
        <div className="logEventList">
          {versions.map((version) => (
            <div className="logEvent" key={version.id}>
              <div className="logEventTop">
                <strong>{version.summary}</strong>
                <span>{new Date(version.createdAt).toLocaleString()}</span>
              </div>
              <div className="logEventMeta">
                {version.filePath} · {version.actorName} · {version.contentHash.slice(0, 18)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Folders that are sources/code/deps, not curated wiki sub-brains. We never promote
// `{name}-brain.md` anchors found inside these (e.g. raw/ sources, code/ repos and
// their demo-wikis) to sidebar/graph sub-brains.
const NON_BRAIN_SUBTREES = new Set([
  'raw', 'code', 'demo-wikis', 'docs', 'node_modules', '.git', '.next', '.obsidian',
  'venv', '__pycache__', 'dist', 'build', '.worktrees',
]);

// A folder is a sub-brain only if it contains its OWN name-matching anchor file
// (`vision-brain/` → `vision-brain.md`). This avoids false positives like a plan doc
// `2026-...-la-chaine-brain.md` that merely ends in `-brain.md`.
function brainAnchorOf(folder: WikiFolder): WikiFile | undefined {
  const n = folder.name.toLowerCase();
  const expected = n.endsWith('-brain') ? `${n}.md` : `${n}-brain.md`;
  return folder.files.find((f) => f.name.toLowerCase() === expected);
}

// Collect every sub-brain folder, skipping non-curated subtrees (raw/, code/, docs/,
// demo-wikis, deps).
function collectBrainAnchorFolders(folder: WikiFolder, out: WikiFolder[] = []): WikiFolder[] {
  if (brainAnchorOf(folder)) out.push(folder);
  for (const child of folder.folders) {
    if (NON_BRAIN_SUBTREES.has(child.name)) continue;
    collectBrainAnchorFolders(child, out);
  }
  return out;
}

function WikiSidebar({
  vaults,
  activeVaultId,
  actors,
  memberships,
  onAddWiki,
  onBrain,
  onOpenBigBrainMap,
  onOpenFile,
  onFolderCluster,
  onHoverScope,
  onClearHover,
  onCreateMarkdownInFolder,
  onCreateFolderInFolder,
  onCreateSubBrainInFolder,
  onSetVaultColor,
  onDeleteVault,
  canDeleteVault,
}: {
  vaults: WikiVault[];
  activeVaultId: string | null;
  actors: CollaborationActor[];
  memberships: BrainMembership[];
  onAddWiki: () => void;
  onBrain: () => void;
  onOpenBigBrainMap: () => void;
  onOpenFile: (fileId: string) => void;
  onFolderCluster: (folder: WikiFolder) => void;
  onHoverScope: (scope: Exclude<HoverScope, null>) => void;
  onClearHover: () => void;
  onCreateMarkdownInFolder: (folder: WikiFolder) => void;
  onCreateFolderInFolder: (folder: WikiFolder) => void;
  onCreateSubBrainInFolder: (folder: WikiFolder) => void;
  onSetVaultColor: (vaultId: string, color: string | undefined) => void;
  onDeleteVault: (vaultId: string) => void;
  canDeleteVault: (vaultId: string) => boolean;
}) {
  const [brainFilesOpen, setBrainFilesOpen] = useState(false);

  const allFiles = useMemo(() => vaults.flatMap((v) => v.flatFiles), [vaults]);
  const [lintMap, setLintMap] = useState<Map<string, FileLint>>(new Map());

  // Brain sections shown under the BIG BRAIN header. A vault with NO nested
  // sub-brain folders renders as one brain (the vault = native model / "A"). A vault
  // WITH nested {name}-brain folders gets each TOP-LEVEL sub-brain promoted to its own
  // section ("B"); the vault root itself (big-brain config) is not a separate row.
  const brainSections = useMemo(() => {
    type Section = { key: string; folder: WikiFolder; vaultId: string; color: string; isVault: boolean };
    const sections: Section[] = [];
    for (const vault of vaults) {
      const color = getVaultColor(vault);
      const anchors = collectBrainAnchorFolders(vault.tree).filter((f) => f.path !== vault.tree.path);
      if (anchors.length === 0) {
        sections.push({ key: vault.id, folder: vault.tree, vaultId: vault.id, color, isVault: true });
      } else {
        const topLevel = anchors.filter(
          (f) => !anchors.some((o) => o.path !== f.path && f.path.startsWith(`${o.path}/`)),
        );
        for (const bf of topLevel) {
          sections.push({ key: bf.id, folder: bf, vaultId: vault.id, color, isVault: false });
        }
      }
    }
    return sections;
  }, [vaults]);

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setLintMap(buildFileLintMap(allFiles)),
      allFiles.length > 80 ? 450 : 180,
    );
    return () => window.clearTimeout(timeout);
  }, [allFiles]);

  return (
    <div className="wikiSidebar">
      <div className="sidebarActions">
        <button className="primary" type="button" onClick={onAddWiki}>
          <Plus size={14} />
          Add Brain
        </button>
      </div>
      <div className="brainMenu">
        <div className="brainMenuHeader">
          <button className="wikiBrainHeader" type="button" onClick={onBrain} onMouseEnter={onClearHover}>
            Big Brain
          </button>
          <button
            className="brainMenuToggle"
            type="button"
            onClick={() => setBrainFilesOpen((open) => !open)}
            aria-label={brainFilesOpen ? 'Hide Brain files' : 'Show Brain files'}
            aria-expanded={brainFilesOpen}
          >
            {brainFilesOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </div>
        {brainFilesOpen && (
          <div className="brainFileDropdown">
            <div className="brainFileGroup">
              <div className="brainFileGroupTitle">Big Brain</div>
              <button
                type="button"
                className="brainFileItem brainHome bigBrainHome"
                onClick={onOpenBigBrainMap}
                onMouseEnter={onClearHover}
              >
                <FileText size={12} />
                <span>Big Brain</span>
              </button>
            </div>
            {vaults.map((vault) => (
              <div className="brainFileGroup" key={vault.id}>
                <div className="brainFileGroupTitle">{vault.name}</div>
                {vault.flatFiles.filter(isBrainHomeFile).length === 0 ? (
                  <div className="brainFileEmpty">No Brain file found</div>
                ) : (
                  vault.flatFiles.filter(isBrainHomeFile).map((file) => (
                    <button
                      key={file.id}
                      type="button"
                      className="brainFileItem brainHome"
                      onClick={() => onOpenFile(file.id)}
                      onMouseEnter={() => onHoverScope({ type: 'file', fileId: file.id })}
                      onMouseLeave={onClearHover}
                    >
                      <FileText size={12} />
                      <span>{fileTitle(file)}</span>
                    </button>
                  ))
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="wikiList">
        {brainSections.map((section) => {
          const collaborators = section.isVault
            ? collaboratorsForVault(section.vaultId, memberships, actors)
            : [];
          const useInitials = collaborators.length > 5;
          return (
            <section
              className={`wikiSection ${activeVaultId === section.vaultId ? 'active' : ''}`}
              key={section.key}
              style={{ '--brain-color': section.color } as React.CSSProperties}
              onMouseEnter={() =>
                section.isVault
                  ? onHoverScope({ type: 'vault', vaultId: section.vaultId })
                  : onHoverScope({ type: 'folder', vaultId: section.vaultId, folderPath: section.folder.path })
              }
              onMouseLeave={onClearHover}
            >
              <FolderNode
                folder={section.folder}
                depth={0}
                asBrain={!section.isVault}
                isVaultRoot={section.isVault}
                vaultColor={section.color}
                lintMap={lintMap}
                onFolderCluster={onFolderCluster}
                onHoverScope={onHoverScope}
                onClearHover={onClearHover}
                onCreateMarkdownInFolder={onCreateMarkdownInFolder}
                onCreateFolderInFolder={onCreateFolderInFolder}
                onCreateSubBrainInFolder={onCreateSubBrainInFolder}
                onSetVaultColor={(c) => onSetVaultColor(section.vaultId, c)}
                onDeleteBrain={section.isVault ? () => onDeleteVault(section.vaultId) : undefined}
                canDeleteBrain={section.isVault ? canDeleteVault(section.vaultId) : false}
              />
              {collaborators.length > 0 && (
                <div className="sidebarCollaborators" aria-label="Collaborators">
                  <span className="sidebarCollaboratorsTitle">Collaborators</span>
                  <div className={useInitials ? 'sidebarCollaboratorInitials' : 'sidebarCollaboratorNames'}>
                    {collaborators.map((name) => (
                      <span key={name} title={name}>
                        {useInitials ? initialsForName(name) : name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

export default function Home() {
  const {
    vaults,
    activeVaultId,
    flatFiles,
    selectedFileId,
    activeView,
    editorMode,
    graphScope,
    actors,
    currentActorId,
    memberships,
    invitations,
    changeEvents,
    fileVersions,
    fileBaselines,
    conflicts,
    setVaults,
    addVault,
    updateVault,
    removeVault,
    setActiveVault,
    setVaultColor,
    setGraphScope,
    setGraphPreview,
    setHoverScope,
    clearHoverScope,
    selectFile,
    setActiveView,
    setEditorMode,
    updateBody,
    markSaved,
    setCurrentActor,
    upsertActor,
    upsertInvitation,
    acceptInvitation,
    revokeInvitation,
    setMemberRole,
    removeMember,
    recordChangeEvent,
    recordFileVersion,
    setFileBaseline,
    reportConflict,
    dismissConflict,
    hydrateCollaborationState,
  } = useWikiStore();

  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const [reconnectHandles, setReconnectHandles] = useState<StoredWikiVaultHandle[]>([]);
  const [restoringVault, setRestoringVault] = useState(true);
  const [collaborationHydrated, setCollaborationHydrated] = useState(false);
  const [openHeaderPanel, setOpenHeaderPanel] = useState<'collaboration' | 'history' | null>(null);
  const [addBrainDialogOpen, setAddBrainDialogOpen] = useState(false);
  const [graphReturnFileId, setGraphReturnFileId] = useState<string | null>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const folderPickerBusyRef = useRef(false);
  const restoreStartedRef = useRef(false);

  useEffect(() => {
    // #region agent log
    fetch('http://127.0.0.1:7539/ingest/51ee9c2c-12ff-4dbc-8efa-618f72ca3779',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c84f03'},body:JSON.stringify({sessionId:'c84f03',runId:'pre-fix-2',hypothesisId:'H5',location:'src/app/page.tsx:supportedEffect',message:'Wiki app booted with debug instrumentation',data:{hasPicker:typeof window!=='undefined'&&typeof window.showDirectoryPicker==='function',userAgent:typeof navigator!=='undefined'?navigator.userAgent.slice(0,120):null},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    setSupported(typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function');
  }, []);

  useEffect(() => {
    // #region agent log
    fetch('http://127.0.0.1:7539/ingest/51ee9c2c-12ff-4dbc-8efa-618f72ca3779',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c84f03'},body:JSON.stringify({sessionId:'c84f03',runId:'pre-fix-3',hypothesisId:'H8,H9',location:'src/app/page.tsx:vaultStateEffect',message:'Rendered vault state changed',data:{vaultCount:vaults.length,activeVaultIdPresent:Boolean(activeVaultId),flatFileCount:flatFiles.length,reconnectCount:reconnectHandles.length,restoringVault},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
  }, [activeVaultId, flatFiles.length, reconnectHandles.length, restoringVault, vaults.length]);

  useEffect(() => {
    let cancelled = false;

    async function restoreCollaborationState() {
      try {
        const snapshot = await getCollaborationState();
        if (!cancelled && snapshot) hydrateCollaborationState(snapshot);
      } catch (err) {
        if (!cancelled) setError((err as Error).message || 'Collaboration state could not be loaded.');
      } finally {
        if (!cancelled) setCollaborationHydrated(true);
      }
    }

    restoreCollaborationState();
    return () => {
      cancelled = true;
    };
  }, [hydrateCollaborationState]);

  useEffect(() => {
    if (!collaborationHydrated) return;
    const timer = window.setTimeout(() => {
      saveCollaborationState(collaborationSnapshotFromStore()).catch((err) => {
        setError((err as Error).message || 'Collaboration state could not be saved.');
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [actors, collaborationHydrated, conflicts, currentActorId, fileBaselines, fileVersions, memberships, invitations, changeEvents]);

  const selectedFile = flatFiles.find((file) => file.id === selectedFileId) || null;
  const parsed = useMemo(
    () => (selectedFile ? parseFrontmatter(selectedFile.content) : null),
    [selectedFile],
  );
  const currentActor = actors.find((actor) => actor.id === currentActorId) ?? actors[0] ?? {
    id: 'user:local-owner',
    name: 'Local Owner',
    type: 'user' as const,
  };
  const activeVault = vaults.find((vault) => vault.id === activeVaultId) ?? vaults[0] ?? null;
  const selectedVaultId = selectedFile?.vaultId ?? activeVault?.id;
  const selectedRole = getActorBrainRole(memberships, selectedVaultId, currentActor.id);
  const canEditSelected = roleCanEdit(selectedRole);
  const headerVault = selectedFile
    ? vaults.find((vault) => vault.id === selectedFile.vaultId) ?? null
    : graphScope.type === 'all'
      ? activeVault
      : vaults.find((vault) => vault.id === graphScope.vaultId) ?? activeVault;
  const headerBrainTitle = activeView === 'graph' && graphScope.type === 'all'
    ? 'Big Brain'
    : headerVault?.name ?? selectedFile?.vaultName ?? 'Big Brain';
  const headerCollaborators = useMemo(() => {
    const scopedMemberships =
      activeView === 'graph' && graphScope.type === 'all'
        ? memberships
        : memberships.filter((membership) => membership.vaultId === headerVault?.id);
    const seen = new Set<string>();
    return scopedMemberships
      .filter((membership) => membership.role !== 'owner')
      .map((membership) => {
        const actor = actors.find((entry) => entry.id === membership.actorId);
        return actor ? `${actor.name} (${membership.role})` : `${membership.actorId} (${membership.role})`;
      })
      .filter((label) => {
        if (seen.has(label)) return false;
        seen.add(label);
        return true;
      });
  }, [actors, activeView, graphScope, headerVault?.id, memberships]);
  const headerLogEvents = useMemo(() => {
    const scopedEvents =
      activeView === 'graph' && graphScope.type === 'all'
        ? changeEvents
        : changeEvents.filter((event) => event.vaultId === headerVault?.id);
    return scopedEvents.slice(0, 20);
  }, [activeView, changeEvents, graphScope, headerVault?.id]);
  const headerVersions = useMemo(() => {
    const scopedVersions =
      activeView === 'graph' && graphScope.type === 'all'
        ? fileVersions
        : fileVersions.filter((version) => version.vaultId === headerVault?.id);
    return scopedVersions.slice(0, 20);
  }, [activeView, fileVersions, graphScope, headerVault?.id]);
  const selectedConflict = useMemo(
    () => (selectedFile ? conflicts.find((conflict) => conflict.fileId === selectedFile.id) ?? null : null),
    [conflicts, selectedFile],
  );

  useEffect(() => {
    if (!canEditSelected && editorMode === 'edit') setEditorMode('read');
  }, [canEditSelected, editorMode, setEditorMode]);

  const captureVaultBaselines = useCallback(
    async (vault: WikiVault) => {
      await Promise.all(
        vault.flatFiles.map(async (file) => {
          const hash = await computeWikiFileContentHash(file.path, file.content);
          setFileBaseline(file.id, hash);
        }),
      );
    },
    [setFileBaseline],
  );

  const loadStoredVault = useCallback(
    async (stored: StoredWikiVaultHandle, ensureScaffold = false) => {
      const { vault } = await loadVault(stored.handle, stored.id, stored.name, { ensureScaffold });
      await captureVaultBaselines(vault);
      return stored.color ? { ...vault, color: stored.color } : vault;
    },
    [captureVaultBaselines],
  );

  useEffect(() => {
    if (restoreStartedRef.current) {
      // #region agent log
      fetch('http://127.0.0.1:7539/ingest/51ee9c2c-12ff-4dbc-8efa-618f72ca3779',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c84f03'},body:JSON.stringify({sessionId:'c84f03',runId:'post-fix-1',hypothesisId:'H8',location:'src/app/page.tsx:restoreStoredVaults.skipDuplicate',message:'Duplicate restore effect skipped',data:{currentVaultCount:useWikiStore.getState().vaults.length},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return;
    }
    restoreStartedRef.current = true;
    let cancelled = false;

    async function restoreStoredVaults() {
      try {
        const storedVaults = await getWikiVaultHandles();
        // #region agent log
        fetch('http://127.0.0.1:7539/ingest/51ee9c2c-12ff-4dbc-8efa-618f72ca3779',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c84f03'},body:JSON.stringify({sessionId:'c84f03',runId:'pre-fix-3',hypothesisId:'H8',location:'src/app/page.tsx:restoreStoredVaults.afterReadHandles',message:'Stored Brain handles read during restore',data:{storedCount:storedVaults.length,currentVaultCount:useWikiStore.getState().vaults.length,cancelled},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        if (cancelled) return;

        const loadedVaults: WikiVault[] = [];
        const needsReconnect: StoredWikiVaultHandle[] = [];
        for (const stored of storedVaults) {
          try {
            if (await hasVaultPermission(stored.handle, false, 'read')) {
              loadedVaults.push(await loadStoredVault(stored, false));
            } else {
              needsReconnect.push(stored);
            }
          } catch {
            needsReconnect.push(stored);
          }
        }

        if (!cancelled && loadedVaults.length > 0) {
          const currentVaults = useWikiStore.getState().vaults;
          const mergedVaults = [
            ...currentVaults,
            ...loadedVaults.filter((loaded) => !currentVaults.some((current) => current.id === loaded.id)),
          ];
          // #region agent log
          fetch('http://127.0.0.1:7539/ingest/51ee9c2c-12ff-4dbc-8efa-618f72ca3779',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c84f03'},body:JSON.stringify({sessionId:'c84f03',runId:'pre-fix-3',hypothesisId:'H8',location:'src/app/page.tsx:restoreStoredVaults.beforeSetVaults',message:'Restore is about to replace store vaults',data:{loadedCount:loadedVaults.length,currentVaultCount:useWikiStore.getState().vaults.length,needsReconnectCount:needsReconnect.length},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          // #region agent log
          fetch('http://127.0.0.1:7539/ingest/51ee9c2c-12ff-4dbc-8efa-618f72ca3779',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c84f03'},body:JSON.stringify({sessionId:'c84f03',runId:'post-fix-1',hypothesisId:'H8',location:'src/app/page.tsx:restoreStoredVaults.beforeMergeSetVaults',message:'Restore will merge with current store instead of replacing it',data:{loadedCount:loadedVaults.length,currentVaultCount:currentVaults.length,mergedCount:mergedVaults.length,needsReconnectCount:needsReconnect.length},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          setVaults(mergedVaults, useWikiStore.getState().activeVaultId ?? loadedVaults[0].id);
        }
        if (!cancelled) {
          setReconnectHandles(needsReconnect);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message || 'Saved Brains could not be loaded.');
      } finally {
        // #region agent log
        fetch('http://127.0.0.1:7539/ingest/51ee9c2c-12ff-4dbc-8efa-618f72ca3779',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c84f03'},body:JSON.stringify({sessionId:'c84f03',runId:'pre-fix-3',hypothesisId:'H8',location:'src/app/page.tsx:restoreStoredVaults.finally',message:'Restore finished',data:{cancelled,currentVaultCount:useWikiStore.getState().vaults.length},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        if (!cancelled) setRestoringVault(false);
      }
    }

    restoreStoredVaults();
    return () => {
      cancelled = true;
    };
  }, [loadStoredVault, setVaults]);

  const openVault = async (options?: { vaultId?: string; vaultName?: string }) => {
    // #region agent log
    fetch('http://127.0.0.1:7539/ingest/51ee9c2c-12ff-4dbc-8efa-618f72ca3779',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c84f03'},body:JSON.stringify({sessionId:'c84f03',runId:'pre-fix-1',hypothesisId:'H1,H2',location:'src/app/page.tsx:openVault.entry',message:'openVault entered',data:{hasWindow:typeof window!=='undefined',hasPicker:typeof window!=='undefined'&&typeof window.showDirectoryPicker==='function',pickerBusy:folderPickerBusyRef.current,hasOptions:Boolean(options),vaultCount:useWikiStore.getState().vaults.length},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (typeof window === 'undefined' || !window.showDirectoryPicker) {
      // #region agent log
      fetch('http://127.0.0.1:7539/ingest/51ee9c2c-12ff-4dbc-8efa-618f72ca3779',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c84f03'},body:JSON.stringify({sessionId:'c84f03',runId:'pre-fix-1',hypothesisId:'H2',location:'src/app/page.tsx:openVault.unsupported',message:'Folder picker API unavailable',data:{hasWindow:typeof window!=='undefined'},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      setError('Folder picker is not supported in this browser. Please use Chrome, Edge, or Arc.');
      return;
    }
    if (folderPickerBusyRef.current) return;
    folderPickerBusyRef.current = true;
    try {
      // #region agent log
      fetch('http://127.0.0.1:7539/ingest/51ee9c2c-12ff-4dbc-8efa-618f72ca3779',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c84f03'},body:JSON.stringify({sessionId:'c84f03',runId:'pre-fix-1',hypothesisId:'H2',location:'src/app/page.tsx:openVault.beforePicker',message:'About to call showDirectoryPicker',data:{documentHasFocus:typeof document!=='undefined'?document.hasFocus():null,visibilityState:typeof document!=='undefined'?document.visibilityState:null},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      // #region agent log
      fetch('http://127.0.0.1:7539/ingest/51ee9c2c-12ff-4dbc-8efa-618f72ca3779',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c84f03'},body:JSON.stringify({sessionId:'c84f03',runId:'pre-fix-1',hypothesisId:'H2',location:'src/app/page.tsx:openVault.pickerSuccess',message:'Folder picker returned a handle',data:{kind:handle.kind,nameLength:handle.name.length},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      setAddBrainDialogOpen(false);
      const id = options?.vaultId ?? createVaultId(handle.name);
      const name = options?.vaultName ?? handle.name;
      const { vault } = await loadVault(handle, id, name, { ensureScaffold: true });
      // #region agent log
      fetch('http://127.0.0.1:7539/ingest/51ee9c2c-12ff-4dbc-8efa-618f72ca3779',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c84f03'},body:JSON.stringify({sessionId:'c84f03',runId:'pre-fix-1',hypothesisId:'H3',location:'src/app/page.tsx:openVault.loadVaultSuccess',message:'loadVault completed for selected folder',data:{fileCount:vault.flatFiles.length,rootFolderCount:vault.tree.folders.length,rootFileCount:vault.tree.files.length},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      await captureVaultBaselines(vault);
      addVault(vault);
      // #region agent log
      fetch('http://127.0.0.1:7539/ingest/51ee9c2c-12ff-4dbc-8efa-618f72ca3779',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c84f03'},body:JSON.stringify({sessionId:'c84f03',runId:'pre-fix-1',hypothesisId:'H4',location:'src/app/page.tsx:openVault.afterAddVault',message:'addVault completed',data:{vaultCount:useWikiStore.getState().vaults.length,activeVaultIdPresent:Boolean(useWikiStore.getState().activeVaultId),flatFileCount:useWikiStore.getState().flatFiles.length},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      const nextVaults = [...useWikiStore.getState().vaults.filter((existing) => existing.id !== vault.id), vault];
      try {
        await saveWikiVaultHandles(nextVaults);
      } catch (err) {
        console.warn('Brain opened, but the folder handle could not be saved for reconnect.', err);
      }
      setReconnectHandles((handles) => handles.filter((stored) => stored.id !== vault.id));
      setError(null);
    } catch (err) {
      // #region agent log
      fetch('http://127.0.0.1:7539/ingest/51ee9c2c-12ff-4dbc-8efa-618f72ca3779',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c84f03'},body:JSON.stringify({sessionId:'c84f03',runId:'pre-fix-1',hypothesisId:'H2,H3',location:'src/app/page.tsx:openVault.catch',message:'openVault caught an error',data:{errorName:(err as DOMException)?.name,errorMessage:(err as Error)?.message},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      if ((err as DOMException)?.name === 'AbortError') return;
      if ((err as DOMException)?.message?.includes('File picker already active')) return;
      setError((err as Error).message || 'Brain could not be loaded.');
    } finally {
      folderPickerBusyRef.current = false;
    }
  };

  const openAddBrainDialog = useCallback(() => {
    // #region agent log
    fetch('http://127.0.0.1:7539/ingest/51ee9c2c-12ff-4dbc-8efa-618f72ca3779',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c84f03'},body:JSON.stringify({sessionId:'c84f03',runId:'pre-fix-1',hypothesisId:'H1',location:'src/app/page.tsx:openAddBrainDialog',message:'Add Brain dialog requested',data:{hasPicker:typeof window!=='undefined'&&typeof window.showDirectoryPicker==='function',vaultCount:useWikiStore.getState().vaults.length},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    setAddBrainDialogOpen(true);
  }, []);

  const joinBrainByCode = useCallback(
    async (rawCode: string, actorName: string, handle: FileSystemDirectoryHandle) => {
      const normalized = rawCode.trim().toUpperCase();
      if (!normalized) return false;
      const name = actorName.trim() || currentActor.name;
      const actorId = `user:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'collaborator'}`;

      const response = await fetch('/api/brain-invites/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: normalized,
          actorId,
          actorName: name,
          actorType: 'user',
        }),
      });
      const payload = await readJsonPayload(response);
      if (!response.ok) return false;
      if (!payload.actor || !payload.invitation || !payload.membership) return false;
      const actor = payload.actor as CollaborationActor;
      const invitation = payload.invitation as BrainInvitation;
      const membership = payload.membership as BrainMembership;
      upsertActor(actor);
      setCurrentActor(actor.id);
      upsertInvitation(invitation);
      setMemberRole(membership.vaultId, membership.actorId, membership.role);
      const { vault } = await loadVault(handle, membership.vaultId, invitation.vaultName, { ensureScaffold: true });
      await captureVaultBaselines(vault);
      addVault(vault);
      const nextVaults = [...useWikiStore.getState().vaults.filter((existing) => existing.id !== vault.id), vault];
      try {
        await saveWikiVaultHandles(nextVaults);
      } catch (err) {
        console.warn('Joined Brain opened, but the folder handle could not be saved for reconnect.', err);
      }
      setReconnectHandles((handles) => handles.filter((stored) => stored.id !== vault.id));
      setError(null);
      return true;
    },
    [captureVaultBaselines, currentActor.name, setCurrentActor, setMemberRole, upsertActor, upsertInvitation, addVault],
  );

  const createServerInvite = useCallback(
    async (vaultId: string, role: Exclude<BrainRole, 'owner'>): Promise<string | null> => {
      const vault = vaults.find((entry) => entry.id === vaultId);
      if (!vault) return null;

      try {
        const response = await fetch('/api/brain-invites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vaultId,
            vaultName: vault.name,
            email: 'pending collaborator',
            role,
            actorId: currentActor.id,
            actorName: currentActor.name,
            actorType: currentActor.type,
          }),
        });
        const payload = await readJsonPayload(response);
        if (!response.ok) {
          const errorMessage = typeof payload.error === 'string' ? payload.error : 'Invite could not be created.';
          throw new Error(errorMessage);
        }
        if (!payload.invitation || typeof payload.invitation !== 'object') throw new Error('Invalid invite response.');
        const invitation = payload.invitation as BrainInvitation & { inviteCode?: string };
        if (!invitation.inviteCode || typeof invitation.inviteCode !== 'string') {
          throw new Error('Invite was created, but no code was returned.');
        }
        upsertInvitation(invitation);
        setError(null);
        return invitation.inviteCode;
      } catch (err) {
        setError((err as Error).message || 'Invite could not be created.');
        return null;
      }
    },
    [currentActor, upsertInvitation, vaults],
  );

  const reconnectVault = async () => {
    if (reconnectHandles.length === 0) return;
    try {
      const loadedVaults: WikiVault[] = [];
      const stillBlocked: StoredWikiVaultHandle[] = [];
      for (const stored of reconnectHandles) {
        const granted = await hasVaultPermission(stored.handle, true, 'read');
        if (!granted) {
          stillBlocked.push(stored);
          continue;
        }

        try {
          loadedVaults.push(await loadStoredVault(stored, false));
        } catch {
          stillBlocked.push(stored);
        }
      }
      const nextVaults = [
        ...useWikiStore.getState().vaults.filter((vault) => !loadedVaults.some((loaded) => loaded.id === vault.id)),
        ...loadedVaults,
      ];
      if (loadedVaults.length > 0) {
        setVaults(nextVaults, loadedVaults[0].id);
        await saveWikiVaultHandles(nextVaults);
      }
      setReconnectHandles(stillBlocked);
      if (stillBlocked.length > 0 && loadedVaults.length > 0) {
        setError('Some Brains reconnected. Click Reconnect again or add the folder manually for the remaining Brains.');
      } else if (stillBlocked.length > 0) {
        setError('Access was not granted, or the saved folder could not be loaded. Try Reconnect again or add the Brain manually.');
      }
      else setError(null);
    } catch (err) {
      setError((err as Error).message || 'Brains could not be reconnected.');
    }
  };

  const forgetSavedBrains = async () => {
    await clearWikiVaultHandles();
    setReconnectHandles([]);
    setVaults([], null);
    setError(null);
  };

  const openBrain = useCallback(() => {
    setGraphScope({ type: 'all' });
    setGraphPreview(null);
    setGraphReturnFileId(null);
    clearHoverScope();
    setActiveView('graph');
  }, [clearHoverScope, setGraphPreview, setGraphScope, setActiveView]);

  const openBigBrainMap = useCallback(() => {
    setGraphScope({ type: 'all' });
    clearHoverScope();
    setGraphPreview(BRAIN_NODE_ID);
    setGraphReturnFileId(null);
    setActiveView('graph');
  }, [clearHoverScope, setGraphPreview, setGraphScope, setActiveView]);

  const openEditorFromGraph = useCallback(
    (fileId: string) => {
      const file = flatFiles.find((entry) => entry.id === fileId);
      if (file) setActiveVault(file.vaultId);
      setGraphReturnFileId(fileId);
      setGraphPreview(fileId);
      selectFile(fileId);
      clearHoverScope();
      setActiveView('editor');
      setEditorMode('read');
    },
    [clearHoverScope, flatFiles, selectFile, setActiveVault, setActiveView, setEditorMode, setGraphPreview],
  );

  const returnToGraphSelection = useCallback(() => {
    if (graphReturnFileId && flatFiles.some((file) => file.id === graphReturnFileId)) {
      setGraphPreview(graphReturnFileId);
    }
    clearHoverScope();
    setActiveView('graph');
  }, [clearHoverScope, flatFiles, graphReturnFileId, setActiveView, setGraphPreview]);

  const openSidebarFile = useCallback(
    (fileId: string) => {
      const file = flatFiles.find((entry) => entry.id === fileId);
      if (file) setActiveVault(file.vaultId);
      selectFile(fileId);
      setGraphPreview(null);
      setGraphReturnFileId(null);
      clearHoverScope();
      setActiveView('editor');
      setEditorMode('read');
    },
    [clearHoverScope, flatFiles, selectFile, setActiveVault, setActiveView, setEditorMode, setGraphPreview],
  );

  const openFolderCluster = useCallback(
    (folder: WikiFolder) => {
      const vault = vaults.find((entry) => entry.id === folder.vaultId);
      if (vault?.tree.id === folder.id) setGraphScope({ type: 'vault', vaultId: folder.vaultId });
      else setGraphScope({ type: 'folder', vaultId: folder.vaultId, folderPath: folder.path });
      setActiveVault(folder.vaultId);
      setGraphReturnFileId(null);
      clearHoverScope();
      setActiveView('graph');
    },
    [clearHoverScope, setGraphScope, setActiveVault, setActiveView, vaults],
  );

  const clearAllSelections = useCallback(() => {
    selectFile(null);
    setGraphPreview(null);
    setGraphReturnFileId(null);
    clearHoverScope();
    setGraphScope({ type: 'all' });
    setOpenHeaderPanel(null);
  }, [clearHoverScope, selectFile, setGraphPreview, setGraphScope]);

  const createMarkdownInFolder = useCallback(
    async (folder: WikiFolder) => {
      const role = getActorBrainRole(memberships, folder.vaultId, currentActor.id);
      if (!roleCanEdit(role)) {
        setError('You do not have permission to create files in this Brain.');
        return;
      }
      if (!folder.handle) {
        setError('The selected folder cannot be written to.');
        return;
      }

      const vault = vaults.find((entry) => entry.id === folder.vaultId);
      if (!vault) return;

      const title = window.prompt('Name of the new Markdown file', 'New Note');
      if (!title) return;
      try {
        if (!(await hasVaultPermission(folder.handle, true))) {
          setError('Write access to the folder was not granted.');
          return;
        }
        const fileName = await createMarkdownFileInDirectory(folder.handle, title);
        const { vault: refreshedVault } = await loadVault(vault.rootHandle, vault.id, vault.name);
        updateVault(refreshedVault);
        const targetPath = `${folder.path}/${fileName}`;
        const createdFile = refreshedVault.flatFiles.find((file) => file.path === targetPath);
        if (createdFile) {
          selectFile(createdFile.id);
          setActiveVault(vault.id);
          setGraphReturnFileId(null);
          setEditorMode('edit');
        }
        await saveWikiVaultHandles(useWikiStore.getState().vaults);
        setError(null);
      } catch (err) {
        setError((err as Error).message || 'Markdown file could not be created.');
      }
    },
    [currentActor.id, memberships, selectFile, setActiveVault, setEditorMode, updateVault, vaults],
  );

  const createSubfolder = useCallback(
    async (folder: WikiFolder) => {
      const role = getActorBrainRole(memberships, folder.vaultId, currentActor.id);
      if (!roleCanEdit(role)) {
        setError('You do not have permission to create folders in this Brain.');
        return;
      }
      if (!folder.handle) {
        setError('The selected folder cannot be written to.');
        return;
      }

      const vault = vaults.find((entry) => entry.id === folder.vaultId);
      if (!vault) return;

      const name = window.prompt('Name of the new folder', 'New Folder');
      if (!name) return;
      try {
        if (!(await hasVaultPermission(folder.handle, true))) {
          setError('Write access to the folder was not granted.');
          return;
        }
        await createSubfolderInDirectory(folder.handle, name);
        const { vault: refreshedVault } = await loadVault(vault.rootHandle, vault.id, vault.name);
        updateVault(refreshedVault);
        await saveWikiVaultHandles(useWikiStore.getState().vaults);
        setError(null);
      } catch (err) {
        setError((err as Error).message || 'Folder could not be created.');
      }
    },
    [currentActor.id, memberships, updateVault, vaults],
  );

  const createSubBrainInFolder = useCallback(
    async (folder: WikiFolder) => {
      const role = getActorBrainRole(memberships, folder.vaultId, currentActor.id);
      if (!roleCanEdit(role)) {
        setError('You do not have permission to create sub-brains in this Brain.');
        return;
      }
      if (!folder.handle) {
        setError('The selected folder cannot be written to.');
        return;
      }
      const vault = vaults.find((entry) => entry.id === folder.vaultId);
      if (!vault) return;

      const name = window.prompt('Name of the new Sub-Brain', 'New');
      if (!name) return;
      try {
        if (!(await hasVaultPermission(folder.handle, true))) {
          setError('Write access to the folder was not granted.');
          return;
        }
        const { folderName, anchorFile } = await createSubBrainInDirectory(folder.handle, name);
        const { vault: refreshedVault } = await loadVault(vault.rootHandle, vault.id, vault.name);
        updateVault(refreshedVault);
        const targetPath = `${folder.path}/${folderName}/${anchorFile}`;
        const createdAnchor = refreshedVault.flatFiles.find((file) => file.path === targetPath);
        if (createdAnchor) {
          selectFile(createdAnchor.id);
          setActiveVault(vault.id);
          setGraphReturnFileId(null);
          setEditorMode('edit');
        }
        await saveWikiVaultHandles(useWikiStore.getState().vaults);
        setError(null);
      } catch (err) {
        setError((err as Error).message || 'Sub-Brain could not be created.');
      }
    },
    [currentActor.id, memberships, selectFile, setActiveVault, setEditorMode, updateVault, vaults],
  );

  const handleSetVaultColor = useCallback(
    async (vaultId: string, color: string | undefined) => {
      setVaultColor(vaultId, color);
      await saveWikiVaultHandles(
        useWikiStore.getState().vaults.map((vault) =>
          vault.id === vaultId ? { ...vault, color } : vault,
        ),
      );
    },
    [setVaultColor],
  );

  const canDeleteVault = useCallback(
    (vaultId: string) => getActorBrainRole(memberships, vaultId, currentActor.id) === 'owner',
    [currentActor.id, memberships],
  );

  const handleDeleteVault = useCallback(
    async (vaultId: string) => {
      if (getActorBrainRole(memberships, vaultId, currentActor.id) !== 'owner') {
        setError('Only the owner can remove a Brain from the app.');
        return;
      }
      const vault = vaults.find((v) => v.id === vaultId);
      if (!vault) return;
      const ok = window.confirm(
        `Remove \"${vault.name}\" from the app? Your files on disk stay in the folder; the app will only forget this Brain.`,
      );
      if (!ok) return;
      removeVault(vaultId);
      setGraphReturnFileId(null);
      try {
        await saveWikiVaultHandles(useWikiStore.getState().vaults);
        setError(null);
      } catch (err) {
        setError((err as Error).message || 'Could not update saved Brains list.');
      }
    },
    [currentActor.id, memberships, removeVault, vaults],
  );

  const saveFileWithCollaboration = useCallback(
    async (file: WikiFile, summary: string) => {
      if (file.handle) {
        const diskContent = await (await file.handle.getFile()).text();
        const diskHash = await computeWikiFileContentHash(file.path, diskContent);
        const draftHash = await computeWikiFileContentHash(file.path, file.content);
        const baselineHash = fileBaselines[file.id];
        if (baselineHash && diskHash !== baselineHash && diskHash !== draftHash) {
          const conflict: FileConflict = {
            id: `conflict:${file.id}:${Date.now().toString(36)}`,
            vaultId: file.vaultId,
            fileId: file.id,
            filePath: file.path,
            actorId: currentActor.id,
            detectedAt: new Date().toISOString(),
            baselineHash,
            diskHash,
            draftHash,
          };
          reportConflict(conflict);
          throw new Error('Save blocked: the file changed on disk since your last baseline.');
        }
      }

      const saved = await saveFile(file, currentActor, summary);
      if (saved.event) {
        recordChangeEvent(saved.event);
        recordFileVersion(versionFromSave(saved.event, currentActor, saved.content));
      } else {
        const hash = await computeWikiFileContentHash(file.path, saved.content);
        setFileBaseline(file.id, hash);
      }
      return saved;
    },
    [currentActor, fileBaselines, recordChangeEvent, recordFileVersion, reportConflict, setFileBaseline],
  );

  const resolveSelectedConflict = useCallback(
    async (strategy: 'disk' | 'overwrite') => {
      if (!selectedFile || !selectedConflict) return;
      try {
        if (strategy === 'disk') {
          if (!selectedFile.handle) return;
          const diskContent = await (await selectedFile.handle.getFile()).text();
          const diskHash = await computeWikiFileContentHash(selectedFile.path, diskContent);
          markSaved(selectedFile.id, diskContent);
          setFileBaseline(selectedFile.id, diskHash);
          dismissConflict(selectedConflict.id);
          setError(null);
          return;
        }

        const saved = await saveFile(selectedFile, currentActor, 'Resolved conflict by overwriting disk');
        if (saved.event) {
          recordChangeEvent(saved.event);
          recordFileVersion(versionFromSave(saved.event, currentActor, saved.content));
        }
        markSaved(selectedFile.id, saved.content);
        dismissConflict(selectedConflict.id);
        setError(null);
      } catch (err) {
        setError((err as Error).message || 'Conflict could not be resolved.');
      }
    },
    [
      currentActor,
      dismissConflict,
      markSaved,
      recordChangeEvent,
      recordFileVersion,
      selectedConflict,
      selectedFile,
      setFileBaseline,
    ],
  );

  const saveCurrent = async () => {
    if (!selectedFile || !selectedFile.dirty) return;
    if (!canEditSelected) {
      setError('You do not have permission to save changes in this Brain.');
      return;
    }
    try {
      const saved = await saveFileWithCollaboration(selectedFile, 'Saved file from editor');
      markSaved(selectedFile.id, saved.content);
      setError(null);
    } catch (err) {
      setError((err as Error).message || 'Save failed.');
    }
  };

  useEffect(() => {
    const dirtyFiles = flatFiles.filter((file) => file.dirty && file.handle);
    if (dirtyFiles.length === 0) return;

    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(async () => {
      for (const file of dirtyFiles) {
        try {
          const role = getActorBrainRole(memberships, file.vaultId, currentActor.id);
          if (!roleCanEdit(role)) continue;
          const saved = await saveFileWithCollaboration(file, 'Autosaved file');
          markSaved(file.id, saved.content);
        } catch (err) {
          setError((err as Error).message || 'Autosave failed.');
          break;
        }
      }
    }, 800);

    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [currentActor.id, flatFiles, markSaved, memberships, saveFileWithCollaboration]);

  if (!supported) {
    return (
      <div className="empty">
        <div>
          <h2>Browser not supported</h2>
          <p>This app uses the File System Access API. Please use Chrome, Edge, or Arc.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topBrainTitle">
          <strong>{headerBrainTitle}</strong>
          {headerCollaborators.length > 0 && (
            <span>Collaborators: {headerCollaborators.join(', ')}</span>
          )}
          <div className="headerRoundActions">
            <button
              className={`roundIconButton ${openHeaderPanel === 'collaboration' ? 'active' : ''}`}
              type="button"
              aria-label="Open collaboration"
              onClick={() => setOpenHeaderPanel((panel) => (panel === 'collaboration' ? null : 'collaboration'))}
            >
              <Users size={15} />
            </button>
            <button
              className={`roundIconButton ${openHeaderPanel === 'history' ? 'active' : ''}`}
              type="button"
              aria-label="Open log history"
              onClick={() => setOpenHeaderPanel((panel) => (panel === 'history' ? null : 'history'))}
            >
              <History size={15} />
            </button>
            {openHeaderPanel && (
              <div className="headerPopover">
                {openHeaderPanel === 'collaboration' ? (
                  <CollaborationPanel
                    vaults={vaults}
                    activeVaultId={activeVaultId}
                    actors={actors}
                    currentActorId={currentActorId}
                    memberships={memberships}
                    invitations={invitations}
                    onCurrentActorChange={setCurrentActor}
                    onInvite={createServerInvite}
                    onRevokeInvitation={revokeInvitation}
                    onSetMemberRole={setMemberRole}
                    onRemoveMember={removeMember}
                  />
                ) : (
                  <LogHistoryPanel events={headerLogEvents} actors={actors} versions={headerVersions} />
                )}
              </div>
            )}
          </div>
        </div>
        <div className="topActions">
          <div className="viewToggle">
            <button className={activeView === 'editor' ? 'active' : ''} onClick={() => setActiveView('editor')}>
              <Pencil size={14} />
              Editor
            </button>
            <button className={activeView === 'graph' ? 'active' : ''} onClick={() => setActiveView('graph')}>
              <Network size={14} />
              Graph
            </button>
          </div>
          <button className="ghost" onClick={saveCurrent} disabled={!selectedFile || !selectedFile.dirty || !canEditSelected}>
            <Save size={14} />
            Save
          </button>
        </div>
      </header>

      {addBrainDialogOpen && (
        <AddBrainDialog
          onClose={() => setAddBrainDialogOpen(false)}
          onCreate={openVault}
          onJoinCode={joinBrainByCode}
        />
      )}

      {error && <div className="errorBar">{error}</div>}

      <div className="layout">
        <aside className="tree">
          {vaults.length > 0 ? (
            <WikiSidebar
              vaults={vaults}
              activeVaultId={activeVaultId}
              actors={actors}
              memberships={memberships}
              onAddWiki={openAddBrainDialog}
              onBrain={openBrain}
              onOpenBigBrainMap={openBigBrainMap}
              onOpenFile={openSidebarFile}
              onFolderCluster={openFolderCluster}
              onHoverScope={setHoverScope}
              onClearHover={clearHoverScope}
              onCreateMarkdownInFolder={createMarkdownInFolder}
              onCreateFolderInFolder={createSubfolder}
              onCreateSubBrainInFolder={createSubBrainInFolder}
              onSetVaultColor={handleSetVaultColor}
              onDeleteVault={handleDeleteVault}
              canDeleteVault={canDeleteVault}
            />
          ) : reconnectHandles.length > 0 ? (
            <ReconnectState
              count={reconnectHandles.length}
              onReconnect={reconnectVault}
              onAddBrain={openAddBrainDialog}
              onForgetSaved={forgetSavedBrains}
            />
          ) : restoringVault ? (
            <div className="empty">
              <div>
                <h2>Loading vault</h2>
                <p>Checking the last opened folder.</p>
              </div>
            </div>
          ) : (
            <EmptyState onAddBrain={openAddBrainDialog} />
          )}
        </aside>

        <main className="content">
          {activeView === 'graph' ? (
            <GraphView onClearSelections={clearAllSelections} onOpenEditor={openEditorFromGraph} />
          ) : selectedFile && parsed ? (
            <div className="editorLayout">
              <div className="docHeader">
                {graphReturnFileId === selectedFile.id && (
                  <button className="ghost graphBackButton" type="button" onClick={returnToGraphSelection}>
                    <ArrowLeft size={14} />
                    Back to Graph
                  </button>
                )}
                <div className="docTitle">
                  <span className="docPath">{selectedFile.vaultName} / {selectedFile.path}</span>
                  <h1>{fileTitle(selectedFile)}</h1>
                  {selectedConflict && (
                    <div className="conflictBanner">
                      <strong>Conflict detected</strong>
                      <span>This file changed on disk after your local baseline. Save is blocked until you review it.</span>
                      <div className="conflictActions">
                        <button type="button" onClick={() => resolveSelectedConflict('disk')}>
                          Use disk
                        </button>
                        <button type="button" onClick={() => resolveSelectedConflict('overwrite')}>
                          Overwrite
                        </button>
                        <button type="button" onClick={() => dismissConflict(selectedConflict.id)}>
                          Dismiss
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="modeToggle">
                  <button
                    className={editorMode === 'read' ? 'active' : ''}
                    onClick={() => setEditorMode('read')}
                  >
                    <BookOpen size={14} />
                    Read
                  </button>
                  <button
                    className={editorMode === 'edit' ? 'active' : ''}
                    disabled={!canEditSelected}
                    onClick={() => setEditorMode('edit')}
                  >
                    <Pencil size={14} />
                    Edit
                  </button>
                </div>
              </div>

              <div className="docBody">
                <PropertiesBlock file={selectedFile} readOnly={!canEditSelected} />
                {editorMode === 'read' ? (
                  <div className="markdown">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {parsed.body || '_Empty file._'}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <div className="editorPane">
                    <MonacoEditor
                      language="markdown"
                      theme="light"
                      value={parsed.body}
                      onChange={(value) => updateBody(selectedFile.id, value || '')}
                      options={{
                        readOnly: !canEditSelected,
                        minimap: { enabled: false },
                        wordWrap: 'on',
                        fontSize: 14,
                        scrollBeyondLastLine: false,
                        lineNumbers: 'off',
                        renderLineHighlight: 'none',
                        padding: { top: 16, bottom: 16 },
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          ) : reconnectHandles.length > 0 ? (
            <ReconnectState
              count={reconnectHandles.length}
              onReconnect={reconnectVault}
              onAddBrain={openAddBrainDialog}
              onForgetSaved={forgetSavedBrains}
            />
          ) : restoringVault ? (
            <div className="empty">
              <div>
                <h2>Loading vault</h2>
                <p>Checking the last opened folder.</p>
              </div>
            </div>
          ) : (
            <EmptyState onAddBrain={openAddBrainDialog} />
          )}
        </main>
      </div>
    </div>
  );
}
