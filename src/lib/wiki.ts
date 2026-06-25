import { create } from 'zustand';

export type WikiView = 'editor' | 'graph';
export type EditorMode = 'edit' | 'read';
export type PropertyType = 'text' | 'number' | 'checkbox' | 'date' | 'datetime' | 'list' | 'tags';
export type PropertyValue = string | number | boolean | string[] | null;
export type CollaborationActorType = 'user' | 'agent';
export type BrainRole = 'owner' | 'admin' | 'editor' | 'commenter' | 'viewer' | 'agent';

export interface CollaborationActor {
  id: string;
  name: string;
  type: CollaborationActorType;
}

export interface BrainMembership {
  vaultId: string;
  actorId: string;
  role: BrainRole;
  invitedBy?: string;
  createdAt: string;
}

export interface BrainInvitation {
  id: string;
  vaultId: string;
  vaultName?: string;
  email: string;
  inviteCode?: string;
  role: Exclude<BrainRole, 'owner'>;
  invitedBy: string;
  status: 'pending' | 'accepted' | 'revoked';
  createdAt: string;
  acceptedBy?: string;
  acceptedAt?: string;
  revokedAt?: string;
}

export interface ChangeEvent {
  id: string;
  vaultId: string;
  fileId: string;
  filePath: string;
  actorId: string;
  actorType: CollaborationActorType;
  action: 'create' | 'update' | 'save';
  summary: string;
  createdAt: string;
  contentHash: string;
}

export interface FileVersion {
  id: string;
  vaultId: string;
  fileId: string;
  filePath: string;
  actorId: string;
  actorName: string;
  summary: string;
  createdAt: string;
  contentHash: string;
  content: string;
}

export interface FileConflict {
  id: string;
  vaultId: string;
  fileId: string;
  filePath: string;
  actorId: string;
  detectedAt: string;
  baselineHash?: string;
  diskHash: string;
  draftHash: string;
}

export interface CollaborationStateSnapshot {
  actors: CollaborationActor[];
  currentActorId: string;
  memberships: BrainMembership[];
  invitations: BrainInvitation[];
  changeEvents: ChangeEvent[];
  fileVersions: FileVersion[];
  fileBaselines: Record<string, string>;
  conflicts: FileConflict[];
}

export interface Property {
  key: string;
  type: PropertyType;
  value: PropertyValue;
}

export interface WikiFile {
  id: string;
  name: string;
  path: string;
  content: string;
  handle?: FileSystemFileHandle;
  dirty: boolean;
  vaultId: string;
  vaultName: string;
}

export interface WikiFolder {
  id: string;
  name: string;
  path: string;
  files: WikiFile[];
  folders: WikiFolder[];
  handle?: FileSystemDirectoryHandle;
  vaultId: string;
}

export interface WikiVault {
  id: string;
  name: string;
  rootHandle: FileSystemDirectoryHandle;
  tree: WikiFolder;
  flatFiles: WikiFile[];
  color?: string;
}

export const DEFAULT_OWNER_ACTOR: CollaborationActor = {
  id: 'user:local-owner',
  name: 'Local Owner',
  type: 'user',
};

export const DEFAULT_AGENT_ACTOR: CollaborationActor = {
  id: 'agent:cursor',
  name: 'Cursor Agent',
  type: 'agent',
};

export const VAULT_PALETTE = [
  '#6366f1', // indigo
  '#0ea5e9', // sky
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#ec4899', // pink
  '#8b5cf6', // violet
  '#14b8a6', // teal
] as const;

export function getVaultColor(vault: WikiVault): string {
  if (vault.color) return vault.color;
  // deterministic hash fallback so colour is stable across reloads
  let hash = 0;
  for (let i = 0; i < vault.id.length; i++) {
    hash = (hash * 31 + vault.id.charCodeAt(i)) >>> 0;
  }
  return VAULT_PALETTE[hash % VAULT_PALETTE.length];
}

export interface GraphNode {
  id: string;
  title: string;
  path: string;
  weight: number;
  unresolved?: boolean;
  vaultId?: string;
  vaultName?: string;
  brain?: boolean;
  subBrain?: boolean;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  unresolved?: boolean;
  brainMap?: boolean;
  brainAnchor?: boolean;
}

export const BRAIN_NODE_ID = 'brain:root';
export const LEGACY_BRAIN_HOME_FILE = 'BRAIN_PROTOCOL.md';
const LEGACY_BRAIN_HOME_SUFFIX = '-protocol.md';
const AGENT_START_FILE = 'AGENT_START.md';
const BRAIN_LOG_FILE = 'log.md';

export function vaultBrainNodeId(vaultId: string): string {
  return `brain:vault:${vaultId}`;
}

export function isVaultBrainNodeId(id: string): boolean {
  return id.startsWith('brain:vault:');
}

export function vaultIdFromBrainNodeId(id: string): string {
  return id.replace(/^brain:vault:/, '');
}

export type GraphScope =
  | { type: 'all' }
  | { type: 'vault'; vaultId: string }
  | { type: 'folder'; vaultId: string; folderPath: string };

export type HoverScope =
  | { type: 'vault'; vaultId: string }
  | { type: 'folder'; vaultId: string; folderPath: string }
  | { type: 'file'; fileId: string }
  | null;

interface WikiStore {
  vaultName: string | null;
  rootHandle: FileSystemDirectoryHandle | null;
  tree: WikiFolder | null;
  vaults: WikiVault[];
  activeVaultId: string | null;
  flatFiles: WikiFile[];
  selectedFileId: string | null;
  graphPreviewId: string | null;
  actors: CollaborationActor[];
  currentActorId: string;
  memberships: BrainMembership[];
  invitations: BrainInvitation[];
  changeEvents: ChangeEvent[];
  fileVersions: FileVersion[];
  fileBaselines: Record<string, string>;
  conflicts: FileConflict[];
  activeView: WikiView;
  editorMode: EditorMode;
  graphScope: GraphScope;
  hoverScope: HoverScope;
  expandedFolders: Set<string>;
  setVault: (name: string, root: FileSystemDirectoryHandle, tree: WikiFolder, flat: WikiFile[]) => void;
  setVaults: (vaults: WikiVault[], activeVaultId?: string | null) => void;
  addVault: (vault: WikiVault) => void;
  updateVault: (vault: WikiVault) => void;
  removeVault: (vaultId: string) => void;
  setActiveVault: (id: string | null) => void;
  setVaultColor: (vaultId: string, color: string | undefined) => void;
  setGraphScope: (scope: GraphScope) => void;
  setHoverScope: (scope: Exclude<HoverScope, null>) => void;
  clearHoverScope: () => void;
  selectFile: (id: string | null) => void;
  setGraphPreview: (id: string | null) => void;
  setActiveView: (view: WikiView) => void;
  setEditorMode: (mode: EditorMode) => void;
  toggleFolder: (id: string) => void;
  expandAll: (ids: string[]) => void;
  updateBody: (id: string, body: string) => void;
  updateProperties: (id: string, properties: Property[]) => void;
  markSaved: (id: string, content?: string) => void;
  setCurrentActor: (actorId: string) => void;
  upsertActor: (actor: CollaborationActor) => void;
  upsertInvitation: (invitation: BrainInvitation) => void;
  inviteToVault: (vaultId: string, email: string, role: Exclude<BrainRole, 'owner'>) => void;
  acceptInvitation: (invitationId: string, actorName: string) => void;
  revokeInvitation: (invitationId: string) => void;
  setMemberRole: (vaultId: string, actorId: string, role: BrainRole) => void;
  removeMember: (vaultId: string, actorId: string) => void;
  recordChangeEvent: (event: ChangeEvent) => void;
  recordFileVersion: (version: FileVersion) => void;
  setFileBaseline: (fileId: string, contentHash: string) => void;
  reportConflict: (conflict: FileConflict) => void;
  dismissConflict: (conflictId: string) => void;
  hydrateCollaborationState: (snapshot: Partial<CollaborationStateSnapshot>) => void;
}

function flattenVaults(vaults: WikiVault[]): WikiFile[] {
  return vaults.flatMap((vault) => vault.flatFiles);
}

function updateVaultFile(vault: WikiVault, id: string, content: string, dirty: boolean): WikiVault {
  return {
    ...vault,
    flatFiles: vault.flatFiles.map((file) => (file.id === id ? { ...file, content, dirty } : file)),
    tree: updateFileInTree(vault.tree, id, content, dirty),
  };
}

function markVaultFileSaved(vault: WikiVault, id: string, content?: string): WikiVault {
  return {
    ...vault,
    flatFiles: vault.flatFiles.map((file) => (file.id === id ? { ...file, content: content ?? file.content, dirty: false } : file)),
    tree: markSavedInTree(vault.tree, id, content),
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function createInviteCode(vaultId: string): string {
  const prefix = vaultId
    .replace(/^[^:]+:/, '')
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 6)
    .toUpperCase() || 'BRAIN';
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  const time = Date.now().toString(36).slice(-4).toUpperCase();
  return `${prefix}-${random}-${time}`;
}

function ensureOwnerMemberships(
  memberships: BrainMembership[],
  vaults: WikiVault[],
  ownerId = DEFAULT_OWNER_ACTOR.id,
): BrainMembership[] {
  const next = [...memberships];
  for (const vault of vaults) {
    if (next.some((membership) => membership.vaultId === vault.id && membership.actorId === ownerId)) continue;
    next.push({
      vaultId: vault.id,
      actorId: ownerId,
      role: 'owner',
      createdAt: nowIso(),
    });
  }
  return next;
}

export function roleCanEdit(role?: BrainRole): boolean {
  return role === 'owner' || role === 'admin' || role === 'editor' || role === 'agent';
}

export function roleCanInvite(role?: BrainRole): boolean {
  return role === 'owner' || role === 'admin';
}

export function roleCanComment(role?: BrainRole): boolean {
  return roleCanEdit(role) || role === 'commenter';
}

export function getActorBrainRole(
  memberships: BrainMembership[],
  vaultId: string | undefined,
  actorId: string,
): BrainRole | undefined {
  if (!vaultId) return undefined;
  return memberships.find((membership) => membership.vaultId === vaultId && membership.actorId === actorId)?.role;
}

export const useWikiStore = create<WikiStore>((set) => ({
  vaultName: null,
  rootHandle: null,
  tree: null,
  vaults: [],
  activeVaultId: null,
  flatFiles: [],
  selectedFileId: null,
  graphPreviewId: null,
  actors: [DEFAULT_OWNER_ACTOR, DEFAULT_AGENT_ACTOR],
  currentActorId: DEFAULT_OWNER_ACTOR.id,
  memberships: [],
  invitations: [],
  changeEvents: [],
  fileVersions: [],
  fileBaselines: {},
  conflicts: [],
  activeView: 'graph',
  editorMode: 'read',
  graphScope: { type: 'all' },
  hoverScope: null,
  expandedFolders: new Set<string>(),
  setVault: (vaultName, rootHandle, tree, flat) => {
    const vault: WikiVault = {
      id: tree.vaultId,
      name: vaultName,
      rootHandle,
      tree,
      flatFiles: flat,
    };
    set((state) => ({
      vaultName: 'Big Brain',
      rootHandle,
      tree,
      vaults: [vault],
      activeVaultId: vault.id,
      flatFiles: flattenVaults([vault]),
      selectedFileId: flat[0]?.id || null,
      expandedFolders: new Set<string>(),
      editorMode: 'read',
      graphScope: { type: 'all' },
      hoverScope: null,
      memberships: ensureOwnerMemberships(state.memberships, [vault]),
    }));
  },
  setVaults: (vaults, activeVaultId) =>
    set((state) => {
      const nextActiveVaultId = activeVaultId ?? state.activeVaultId ?? vaults[0]?.id ?? null;
      const activeVault = vaults.find((vault) => vault.id === nextActiveVaultId) ?? vaults[0] ?? null;
      const flatFiles = flattenVaults(vaults);
      return {
        vaultName: vaults.length > 0 ? 'Big Brain' : null,
        rootHandle: activeVault?.rootHandle ?? null,
        tree: activeVault?.tree ?? null,
        vaults,
        activeVaultId: activeVault?.id ?? null,
        flatFiles,
        selectedFileId:
          state.selectedFileId && flatFiles.some((file) => file.id === state.selectedFileId)
            ? state.selectedFileId
            : flatFiles[0]?.id ?? null,
        expandedFolders: new Set(state.expandedFolders),
        editorMode: 'read',
        hoverScope: null,
        memberships: ensureOwnerMemberships(state.memberships, vaults),
      };
    }),
  addVault: (vault) =>
    set((state) => {
      const vaults = [...state.vaults.filter((existing) => existing.id !== vault.id), vault];
      return {
        vaultName: 'Big Brain',
        rootHandle: vault.rootHandle,
        tree: vault.tree,
        vaults,
        activeVaultId: vault.id,
        flatFiles: flattenVaults(vaults),
        selectedFileId: vault.flatFiles[0]?.id ?? state.selectedFileId ?? null,
        expandedFolders: new Set(state.expandedFolders),
        editorMode: 'read',
        memberships: ensureOwnerMemberships(state.memberships, vaults),
      };
    }),
  removeVault: (vaultId) =>
    set((state) => {
      const vaults = state.vaults.filter((v) => v.id !== vaultId);
      if (vaults.length === 0) {
        return {
          vaultName: null,
          rootHandle: null,
          tree: null,
          vaults: [],
          activeVaultId: null,
          flatFiles: [],
          selectedFileId: null,
          graphPreviewId: null,
          graphScope: { type: 'all' },
          hoverScope: null,
          memberships: state.memberships.filter((m) => m.vaultId !== vaultId),
          invitations: state.invitations.filter((i) => i.vaultId !== vaultId),
          changeEvents: state.changeEvents.filter((e) => e.vaultId !== vaultId),
          fileVersions: state.fileVersions.filter((version) => version.vaultId !== vaultId),
          fileBaselines: Object.fromEntries(
            Object.entries(state.fileBaselines).filter(([fileId]) => !fileId.startsWith(`file:${vaultId}:`)),
          ),
          conflicts: state.conflicts.filter((conflict) => conflict.vaultId !== vaultId),
          expandedFolders: new Set(
            [...state.expandedFolders].filter((id) => !id.startsWith(`folder:${vaultId}:`)),
          ),
        };
      }
      const flatFiles = flattenVaults(vaults);
      const removedActive = state.activeVaultId === vaultId;
      const nextActiveId = removedActive ? vaults[0]?.id ?? null : state.activeVaultId;
      const activeVault = vaults.find((v) => v.id === nextActiveId) ?? vaults[0] ?? null;
      const selectedStill = state.selectedFileId
        ? flatFiles.some((f) => f.id === state.selectedFileId)
        : true;
      const nextSelected = selectedStill ? state.selectedFileId : flatFiles[0]?.id ?? null;
      let nextPreview = state.graphPreviewId;
      if (nextPreview && nextPreview !== BRAIN_NODE_ID) {
        if (!flatFiles.some((f) => f.id === nextPreview)) nextPreview = null;
      }
      let nextGraphScope: GraphScope = state.graphScope;
      if (state.graphScope.type === 'vault' && state.graphScope.vaultId === vaultId) {
        nextGraphScope = { type: 'all' };
      } else if (state.graphScope.type === 'folder' && state.graphScope.vaultId === vaultId) {
        nextGraphScope = { type: 'all' };
      }
      const hover = state.hoverScope;
      let nextHover: HoverScope = hover;
      if (hover) {
        if (hover.type === 'vault' && hover.vaultId === vaultId) nextHover = null;
        else if (hover.type === 'folder' && hover.vaultId === vaultId) nextHover = null;
        else if (hover.type === 'file') {
          const f = state.flatFiles.find((x) => x.id === hover.fileId);
          if (f && f.vaultId === vaultId) nextHover = null;
        }
      }
      return {
        vaults,
        vaultName: 'Big Brain',
        rootHandle: activeVault?.rootHandle ?? null,
        tree: activeVault?.tree ?? null,
        activeVaultId: nextActiveId,
        flatFiles,
        selectedFileId: nextSelected,
        graphPreviewId: nextPreview,
        graphScope: nextGraphScope,
        hoverScope: nextHover,
        memberships: state.memberships.filter((m) => m.vaultId !== vaultId),
        invitations: state.invitations.filter((i) => i.vaultId !== vaultId),
        changeEvents: state.changeEvents.filter((e) => e.vaultId !== vaultId),
        fileVersions: state.fileVersions.filter((version) => version.vaultId !== vaultId),
        fileBaselines: Object.fromEntries(
          Object.entries(state.fileBaselines).filter(([fileId]) => !fileId.startsWith(`file:${vaultId}:`)),
        ),
        conflicts: state.conflicts.filter((conflict) => conflict.vaultId !== vaultId),
        expandedFolders: new Set(
          [...state.expandedFolders].filter((id) => !id.startsWith(`folder:${vaultId}:`)),
        ),
      };
    }),
  updateVault: (vault) =>
    set((state) => {
      const vaults = state.vaults.map((existing) => (existing.id === vault.id ? vault : existing));
      const flatFiles = flattenVaults(vaults);
      return {
        vaults,
        flatFiles,
        tree: state.activeVaultId === vault.id ? vault.tree : state.tree,
        rootHandle: state.activeVaultId === vault.id ? vault.rootHandle : state.rootHandle,
        selectedFileId:
          state.selectedFileId && flatFiles.some((file) => file.id === state.selectedFileId)
            ? state.selectedFileId
            : flatFiles[0]?.id ?? null,
      };
    }),
  setActiveVault: (activeVaultId) =>
    set((state) => {
      const activeVault = state.vaults.find((vault) => vault.id === activeVaultId) ?? null;
      return {
        activeVaultId,
        rootHandle: activeVault?.rootHandle ?? null,
        tree: activeVault?.tree ?? null,
        selectedFileId:
          activeVault && state.selectedFileId && activeVault.flatFiles.some((file) => file.id === state.selectedFileId)
            ? state.selectedFileId
            : activeVault?.flatFiles[0]?.id ?? state.selectedFileId,
      };
    }),
  setVaultColor: (vaultId, color) =>
    set((state) => ({
      vaults: state.vaults.map((vault) =>
        vault.id === vaultId ? { ...vault, color } : vault,
      ),
    })),
  setGraphScope: (scope) => set({ graphScope: scope }),
  setHoverScope: (scope) => set({ hoverScope: scope }),
  clearHoverScope: () => set({ hoverScope: null }),
  selectFile: (selectedFileId) =>
    set(
      selectedFileId === null
        ? { selectedFileId: null }
        : { selectedFileId, activeView: 'editor', editorMode: 'read' },
    ),
  setGraphPreview: (graphPreviewId) => set({ graphPreviewId }),
  setActiveView: (activeView) => set({ activeView }),
  setEditorMode: (editorMode) => set({ editorMode }),
  toggleFolder: (id) =>
    set((state) => {
      const next = new Set(state.expandedFolders);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { expandedFolders: next };
    }),
  expandAll: (ids) =>
    set((state) => {
      const next = new Set(state.expandedFolders);
      for (const id of ids) next.add(id);
      return { expandedFolders: next };
    }),
  updateBody: (id, body) =>
    set((state) => {
      const file = state.flatFiles.find((f) => f.id === id);
      if (!file) return state;
      const { properties } = parseFrontmatter(file.content);
      const content = serializeFrontmatter(properties, body);
      const vaults = state.vaults.map((vault) => updateVaultFile(vault, id, content, true));
      const activeVault = vaults.find((vault) => vault.id === state.activeVaultId) ?? null;
      return {
        vaults,
        flatFiles: flattenVaults(vaults),
        tree: activeVault?.tree ?? state.tree,
      };
    }),
  updateProperties: (id, properties) =>
    set((state) => {
      const file = state.flatFiles.find((f) => f.id === id);
      if (!file) return state;
      const { body } = parseFrontmatter(file.content);
      const content = serializeFrontmatter(properties, body);
      const vaults = state.vaults.map((vault) => updateVaultFile(vault, id, content, true));
      const activeVault = vaults.find((vault) => vault.id === state.activeVaultId) ?? null;
      return {
        vaults,
        flatFiles: flattenVaults(vaults),
        tree: activeVault?.tree ?? state.tree,
      };
    }),
  markSaved: (id, content) =>
    set((state) => {
      const vaults = state.vaults.map((vault) => markVaultFileSaved(vault, id, content));
      const activeVault = vaults.find((vault) => vault.id === state.activeVaultId) ?? null;
      return {
        vaults,
        flatFiles: flattenVaults(vaults),
        tree: activeVault?.tree ?? state.tree,
      };
    }),
  setCurrentActor: (currentActorId) => set({ currentActorId }),
  upsertActor: (actor) =>
    set((state) => ({
      actors: [...state.actors.filter((existing) => existing.id !== actor.id), actor],
    })),
  upsertInvitation: (invitation) =>
    set((state) => ({
      invitations: [
        invitation,
        ...state.invitations.filter(
          (entry) => entry.id !== invitation.id && (!invitation.inviteCode || entry.inviteCode !== invitation.inviteCode),
        ),
      ],
    })),
  inviteToVault: (vaultId, email, role) =>
    set((state) => ({
      invitations: [
        {
          id: `invite:${vaultId}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`,
          vaultId,
          email,
          inviteCode: createInviteCode(vaultId),
          role,
          invitedBy: state.currentActorId,
          status: 'pending',
          createdAt: nowIso(),
        },
        ...state.invitations,
      ],
    })),
  acceptInvitation: (invitationId, actorName) =>
    set((state) => {
      const invitation = state.invitations.find((entry) => entry.id === invitationId && entry.status === 'pending');
      if (!invitation) return state;
      const actorId = `user:${invitation.email.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
      const actor: CollaborationActor = { id: actorId, name: actorName.trim() || invitation.email, type: 'user' };
      return {
        actors: [...state.actors.filter((existing) => existing.id !== actorId), actor],
        currentActorId: actorId,
        invitations: state.invitations.map((entry) =>
          entry.id === invitationId
            ? { ...entry, status: 'accepted', acceptedBy: actorId, acceptedAt: nowIso() }
            : entry,
        ),
        memberships: [
          ...state.memberships.filter(
            (membership) => !(membership.vaultId === invitation.vaultId && membership.actorId === actorId),
          ),
          {
            vaultId: invitation.vaultId,
            actorId,
            role: invitation.role,
            invitedBy: invitation.invitedBy,
            createdAt: nowIso(),
          },
        ],
      };
    }),
  revokeInvitation: (invitationId) =>
    set((state) => ({
      invitations: state.invitations.map((entry) =>
        entry.id === invitationId && entry.status === 'pending'
          ? { ...entry, status: 'revoked', revokedAt: nowIso() }
          : entry,
      ),
    })),
  setMemberRole: (vaultId, actorId, role) =>
    set((state) => ({
      memberships: [
        ...state.memberships.filter((membership) => !(membership.vaultId === vaultId && membership.actorId === actorId)),
        {
          vaultId,
          actorId,
          role,
          createdAt: nowIso(),
        },
      ],
    })),
  removeMember: (vaultId, actorId) =>
    set((state) => ({
      memberships: state.memberships.filter(
        (membership) => !(membership.vaultId === vaultId && membership.actorId === actorId && membership.role !== 'owner'),
      ),
    })),
  recordChangeEvent: (event) =>
    set((state) => ({
      changeEvents: [event, ...state.changeEvents].slice(0, 200),
    })),
  recordFileVersion: (version) =>
    set((state) => ({
      fileVersions: [
        version,
        ...state.fileVersions.filter((entry) => entry.id !== version.id),
      ].slice(0, 300),
      fileBaselines: { ...state.fileBaselines, [version.fileId]: version.contentHash },
      conflicts: state.conflicts.filter((conflict) => conflict.fileId !== version.fileId),
    })),
  setFileBaseline: (fileId, contentHash) =>
    set((state) => ({
      fileBaselines: { ...state.fileBaselines, [fileId]: contentHash },
    })),
  reportConflict: (conflict) =>
    set((state) => ({
      conflicts: [conflict, ...state.conflicts.filter((entry) => entry.fileId !== conflict.fileId)].slice(0, 50),
    })),
  dismissConflict: (conflictId) =>
    set((state) => ({
      conflicts: state.conflicts.filter((conflict) => conflict.id !== conflictId),
    })),
  hydrateCollaborationState: (snapshot) =>
    set((state) => ({
      actors: snapshot.actors?.length ? snapshot.actors : state.actors,
      currentActorId: snapshot.currentActorId ?? state.currentActorId,
      memberships: snapshot.memberships ?? state.memberships,
      invitations: snapshot.invitations ?? state.invitations,
      changeEvents: snapshot.changeEvents ?? state.changeEvents,
      fileVersions: snapshot.fileVersions ?? state.fileVersions,
      fileBaselines: snapshot.fileBaselines ?? state.fileBaselines,
      conflicts: snapshot.conflicts ?? state.conflicts,
    })),
}));

function updateFileInTree(folder: WikiFolder, id: string, content: string, dirty: boolean): WikiFolder {
  if (!id.startsWith(`file:${folder.vaultId}:${folder.path}/`)) return folder;
  let changed = false;
  const files = folder.files.map((file) => {
    if (file.id !== id) return file;
    changed = true;
    return { ...file, content, dirty };
  });
  const folders = folder.folders.map((child) => {
    const next = updateFileInTree(child, id, content, dirty);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...folder, files, folders } : folder;
}

function markSavedInTree(folder: WikiFolder, id: string, content?: string): WikiFolder {
  if (!id.startsWith(`file:${folder.vaultId}:${folder.path}/`)) return folder;
  let changed = false;
  const files = folder.files.map((file) => {
    if (file.id !== id) return file;
    changed = true;
    return { ...file, content: content ?? file.content, dirty: false };
  });
  const folders = folder.folders.map((child) => {
    const next = markSavedInTree(child, id, content);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...folder, files, folders } : folder;
}

const LINK_PATTERN = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g;
const HIDDEN_FOLDERS = new Set(['.obsidian', '.git', 'node_modules', '.next']);

function cleanTarget(target: string): string {
  return target.trim().replace(/\.md$/i, '').replace(/^\/+/, '');
}

export function extractLinks(content: string): string[] {
  const targets: string[] = [];
  for (const match of content.matchAll(LINK_PATTERN)) targets.push(cleanTarget(match[1]));
  return targets;
}

export function fileTitle(file: WikiFile): string {
  return file.name.replace(/\.md$/i, '');
}

export type WikiLinkIndex = Map<string, WikiFile[]>;

function addLinkIndexEntry(index: WikiLinkIndex, key: string, file: WikiFile): void {
  const clean = cleanTarget(key).toLowerCase();
  if (!clean) return;
  const matches = index.get(clean) || [];
  if (!matches.some((match) => match.id === file.id)) matches.push(file);
  index.set(clean, matches);
}

export function buildLinkIndex(files: WikiFile[]): WikiLinkIndex {
  const index: WikiLinkIndex = new Map();
  for (const file of files) {
    const cleanPath = cleanTarget(file.path).toLowerCase();
    const parts = cleanPath.split('/').filter(Boolean);
    addLinkIndexEntry(index, cleanPath, file);
    addLinkIndexEntry(index, fileTitle(file), file);

    for (let i = 1; i < parts.length; i++) {
      addLinkIndexEntry(index, parts.slice(i).join('/'), file);
    }
  }
  return index;
}

export interface FileLint {
  unresolved: boolean;
  bare: boolean;
}

export function buildFileLintMap(files: WikiFile[]): Map<string, FileLint> {
  const linkIndex = buildLinkIndex(files);
  const map = new Map<string, FileLint>();
  for (const file of files) {
    const { properties } = parseFrontmatter(file.content);
    const bare = properties.length === 0;
    const links = extractLinks(file.content);
    const unresolved = links.some((target) => !resolveFileByLink(linkIndex, target, file));
    map.set(file.id, { unresolved, bare });
  }
  return map;
}

export function resolveFileByLink(index: WikiLinkIndex, target: string, source?: WikiFile): WikiFile | undefined {
  const clean = cleanTarget(target).toLowerCase();
  const matches = index.get(clean) || [];
  return matches.find((file) => file.vaultId === source?.vaultId) ?? matches[0];
}

function slugForWiki(vaultName: string): string {
  return vaultName
    .toLowerCase()
    .replace(/\.md$/i, '')
    .replace(/[/:\\?%*"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'wiki';
}

export function brainFileNameForWiki(vaultName: string): string {
  const slug = slugForWiki(vaultName);
  return slug.endsWith('-brain') ? `${slug}.md` : `${slug}-brain.md`;
}

export function legacyBrainHomeFileNameForWiki(vaultName: string): string {
  return `${slugForWiki(vaultName)}${LEGACY_BRAIN_HOME_SUFFIX}`;
}

export function isBrainHomeFile(file: WikiFile): boolean {
  const expectedName = brainFileNameForWiki(file.vaultName).toLowerCase();
  const legacyName = legacyBrainHomeFileNameForWiki(file.vaultName).toLowerCase();
  const pathParts = file.path.split('/').filter(Boolean);
  const fileName = file.name.toLowerCase();
  return (fileName === expectedName || fileName === legacyName) && pathParts.length === 2;
}

export function isWikiBrainHomeFile(file: WikiFile): boolean {
  return isBrainHomeFile(file);
}

export function isBrainMetaFile(file: WikiFile): boolean {
  const fileName = file.name.toLowerCase();
  const pathParts = file.path.split('/').filter(Boolean);
  return (
    pathParts.length === 2 &&
    (
      isBrainHomeFile(file) ||
      fileName === 'agent_start.md' ||
      fileName === 'log.md' ||
      fileName === 'index.md' ||
      fileName === LEGACY_BRAIN_HOME_FILE.toLowerCase() ||
      fileName.endsWith(LEGACY_BRAIN_HOME_SUFFIX)
    )
  );
}

// A folder is a "sub-brain" when it directly contains a `*-brain.md` anchor file
// (nested below the vault root). This lets one picked vault render a Big Brain with
// nested Sub-Brain nodes (e.g. la-chaine → vision-brain, products-brain → medigen-brain),
// instead of one flat vault. Root-level config (AGENTS.md, templates/, queries/) has no
// enclosing sub-brain folder, so it attaches to the vault's Big Brain node.
const folderOfPath = (p: string): string => {
  const parts = p.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
};
const ancestorFolders = (folder: string): string[] => {
  const parts = folder.split('/').filter(Boolean);
  const out: string[] = [];
  for (let i = parts.length; i >= 1; i -= 1) out.push(parts.slice(0, i).join('/'));
  return out; // deepest first, includes `folder` itself
};
const subBrainNodeIdForFolder = (folder: string): string => `subbrain:${folder}`;
const prettySubBrainTitle = (folder: string): string => {
  const seg = folder.split('/').filter(Boolean).pop() || folder;
  const base = seg.replace(/-brain$/i, '').replace(/[-_]+/g, ' ').trim();
  const cap = base.charAt(0).toUpperCase() + base.slice(1);
  return /brain$/i.test(seg) ? `${cap} Brain` : `${cap} Brain`;
};

export function buildGraph(files: WikiFile[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const linkIndex = buildLinkIndex(files);
  const vaultsById = new Map<string, string>();
  for (const file of files) vaultsById.set(file.vaultId, file.vaultName);

  // Detect nested sub-brain folders + the vault each belongs to.
  const brainFolders = new Set<string>();
  const folderVaultId = new Map<string, string>();
  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    if (parts.length >= 3 && file.name.toLowerCase().endsWith('-brain.md')) {
      brainFolders.add(parts.slice(0, -1).join('/'));
    }
  }
  for (const file of files) {
    const f = folderOfPath(file.path);
    for (const anc of ancestorFolders(f)) {
      if (brainFolders.has(anc) && !folderVaultId.has(anc)) folderVaultId.set(anc, file.vaultId);
    }
  }
  // A nested anchor / log / index directly inside a sub-brain folder is that
  // sub-brain's meta (folded into the node), not a separate file node.
  const isSubBrainMeta = (file: WikiFile): boolean => {
    const parent = folderOfPath(file.path);
    if (!brainFolders.has(parent)) return false;
    const n = file.name.toLowerCase();
    return n.endsWith('-brain.md') || n === 'log.md' || n === 'index.md' || n === 'agent_start.md';
  };
  // The brain node a file belongs to: deepest ancestor sub-brain folder, else the vault.
  const ownerNodeForFile = (file: WikiFile): string => {
    const f = folderOfPath(file.path);
    for (const anc of ancestorFolders(f)) {
      if (brainFolders.has(anc)) return subBrainNodeIdForFolder(anc);
    }
    return vaultBrainNodeId(file.vaultId);
  };
  const parentNodeForBrainFolder = (folder: string): string => {
    const ancestors = ancestorFolders(folder).slice(1); // skip self
    for (const anc of ancestors) {
      if (brainFolders.has(anc)) return subBrainNodeIdForFolder(anc);
    }
    return vaultBrainNodeId(folderVaultId.get(folder) || '');
  };

  const visibleFiles = files.filter((file) => !isBrainMetaFile(file) && !isSubBrainMeta(file));

  nodes.set(BRAIN_NODE_ID, {
    id: BRAIN_NODE_ID,
    title: 'Big Brain',
    path: 'brain://root',
    weight: 1,
    vaultName: 'Big Brain',
    brain: true,
  });

  for (const [vaultId, vaultName] of vaultsById) {
    nodes.set(vaultBrainNodeId(vaultId), {
      id: vaultBrainNodeId(vaultId),
      title: vaultName.toLowerCase().endsWith('brain') ? vaultName : `${vaultName} Brain`,
      path: `brain://${vaultId}`,
      weight: 1,
      vaultId,
      vaultName,
      subBrain: true,
    });
  }

  for (const folder of brainFolders) {
    const vaultId = folderVaultId.get(folder) || '';
    nodes.set(subBrainNodeIdForFolder(folder), {
      id: subBrainNodeIdForFolder(folder),
      title: prettySubBrainTitle(folder),
      path: `brain://${folder}`,
      weight: 1,
      vaultId,
      vaultName: vaultsById.get(vaultId) || folder,
      subBrain: true,
    });
  }

  for (const file of visibleFiles) {
    nodes.set(file.id, {
      id: file.id,
      title: fileTitle(file),
      path: file.path,
      weight: 0,
      vaultId: file.vaultId,
      vaultName: file.vaultName,
    });
  }

  for (const file of visibleFiles) {
    const seen = new Set<string>();
    for (const target of extractLinks(file.content)) {
      const resolved = resolveFileByLink(linkIndex, target, file);
      const key = resolved
        ? isBrainMetaFile(resolved)
          ? vaultBrainNodeId(resolved.vaultId)
          : isSubBrainMeta(resolved)
            ? subBrainNodeIdForFolder(folderOfPath(resolved.path))
            : resolved.id
        : `unresolved:${target}`;
      if (seen.has(key) || key === file.id) continue;
      seen.add(key);

      if (resolved) {
        if (!nodes.has(key)) continue;
        edges.push({ id: `${file.id}-${key}`, source: file.id, target: key });
        nodes.get(file.id)!.weight += 1;
        nodes.get(key)!.weight += 1;
      } else {
        if (!nodes.has(key)) {
          nodes.set(key, {
            id: key,
            title: target.split('/').pop() || target,
            path: target,
            weight: 0,
            unresolved: true,
            vaultId: file.vaultId,
            vaultName: file.vaultName,
          });
        }
        edges.push({ id: `${file.id}-${key}`, source: file.id, target: key, unresolved: true });
        nodes.get(file.id)!.weight += 1;
        nodes.get(key)!.weight += 1;
      }
    }
  }

  const edgeKeys = new Set(edges.map((edge) => `${edge.source}->${edge.target}`));
  const pushBrainMapEdge = (source: string, target: string, brainAnchor = false) => {
    const edgeKey = `${source}->${target}`;
    if (source === target || edgeKeys.has(edgeKey)) return;
    if (!nodes.has(source) || !nodes.has(target)) return;
    edgeKeys.add(edgeKey);
    edges.push({
      id: `brain-map:${source}-${target}`,
      source,
      target,
      brainMap: true,
      brainAnchor,
    });
    nodes.get(source)!.weight += 0.35;
    nodes.get(target)!.weight += 0.35;
  };

  // Big Brain root -> each vault.
  for (const [vaultId] of vaultsById) {
    pushBrainMapEdge(BRAIN_NODE_ID, vaultBrainNodeId(vaultId));
  }
  // Parent brain -> nested sub-brain (recursive nesting).
  for (const folder of brainFolders) {
    pushBrainMapEdge(parentNodeForBrainFolder(folder), subBrainNodeIdForFolder(folder));
  }
  // Each file -> its owning brain node (nested sub-brain, else the vault Big Brain;
  // so root-level config attaches to the vault's Big Brain node).
  for (const file of visibleFiles) {
    pushBrainMapEdge(ownerNodeForFile(file), file.id, true);
  }

  return { nodes: Array.from(nodes.values()), edges };
}

export function createVaultId(name: string): string {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'wiki';
  return `${normalized}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function loadVault(
  handle: FileSystemDirectoryHandle,
  vaultId = createVaultId(handle.name),
  vaultName = handle.name,
  options: { ensureScaffold?: boolean } = {},
): Promise<{ tree: WikiFolder; flat: WikiFile[]; vault: WikiVault }> {
  if (options.ensureScaffold ?? true) {
    try {
      await ensureBrainScaffoldFiles(handle, vaultName);
    } catch (err) {
      console.warn('Brain scaffold files could not be created. Opening folder without scaffold.', err);
    }
  }
  const flat: WikiFile[] = [];

  async function read(dir: FileSystemDirectoryHandle, path: string): Promise<WikiFolder> {
    const folder: WikiFolder = {
      id: `folder:${vaultId}:${path || dir.name}`,
      name: dir.name,
      path: path || dir.name,
      files: [],
      folders: [],
      handle: dir,
      vaultId,
    };

    for (const entry of await directoryEntries(dir)) {
      if (entry.kind === 'directory') {
        if (HIDDEN_FOLDERS.has(entry.name) || entry.name.startsWith('.')) continue;
        try {
          const child = await read(entry, `${folder.path}/${entry.name}`);
          folder.folders.push(child);
        } catch (err) {
          console.warn(`Skipping unreadable folder "${entry.name}".`, err);
        }
      } else if (entry.name.toLowerCase().endsWith('.md')) {
        try {
          const file = await entry.getFile();
          const content = await file.text();
          const wikiFile: WikiFile = {
            id: `file:${vaultId}:${folder.path}/${entry.name}`,
            name: entry.name,
            path: `${folder.path}/${entry.name}`,
            content,
            handle: entry,
            dirty: false,
            vaultId,
            vaultName,
          };
          folder.files.push(wikiFile);
          flat.push(wikiFile);
        } catch (err) {
          console.warn(`Skipping unreadable Markdown file "${entry.name}".`, err);
        }
      }
    }

    folder.folders.sort((a, b) => a.name.localeCompare(b.name));
    folder.files.sort((a, b) => a.name.localeCompare(b.name));
    return folder;
  }

  const tree = await read(handle, handle.name);
  return {
    tree,
    flat,
    vault: {
      id: vaultId,
      name: vaultName,
      rootHandle: handle,
      tree,
      flatFiles: flat,
    },
  };
}

function upsertProperty(properties: Property[], key: string, value: PropertyValue, type: PropertyType = 'text'): Property[] {
  const next = properties.filter((property) => property.key !== key);
  next.push({ key, value, type });
  return next;
}

const REDUNDANT_SIGNATURE_PROPERTIES = new Set([
  'created_by_name',
  'created_by_type',
  'updated_by_name',
  'updated_by_type',
  'last_change_actor',
  'last_change_actor_name',
  'last_change_actor_type',
]);

export function isRedundantSignatureProperty(key: string): boolean {
  return REDUNDANT_SIGNATURE_PROPERTIES.has(key);
}

function removeRedundantSignatureProperties(properties: Property[]): Property[] {
  return properties.filter((property) => !isRedundantSignatureProperty(property.key));
}

function simpleContentHash(content: string): string {
  let hash = 2166136261;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

async function contentHash(content: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoded = new TextEncoder().encode(content);
    const buffer = await crypto.subtle.digest('SHA-256', encoded);
    return `sha256:${Array.from(new Uint8Array(buffer)).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }
  return simpleContentHash(content);
}

export async function computeWikiFileContentHash(filePath: string, content: string): Promise<string> {
  const parsed = parseFrontmatter(content);
  return contentHash(`${filePath}\n${parsed.body}`);
}

export async function signWikiFileContent(
  file: WikiFile,
  actor: CollaborationActor,
  summary = 'Saved file',
): Promise<{ content: string; event: ChangeEvent }> {
  const parsed = parseFrontmatter(file.content);
  const timestamp = nowIso();
  const existingCreatedAt = parsed.properties.find((property) => property.key === 'created_at')?.value;
  const action: ChangeEvent['action'] = existingCreatedAt ? 'update' : 'create';
  const hash = await computeWikiFileContentHash(file.path, file.content);
  const eventId = `evt:${file.vaultId}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 9)}`;

  let properties = removeRedundantSignatureProperties(parsed.properties);
  if (!existingCreatedAt) {
    properties = upsertProperty(properties, 'created_by', actor.id);
    properties = upsertProperty(properties, 'created_at', timestamp, 'datetime');
  }
  properties = upsertProperty(properties, 'updated_by', actor.id);
  properties = upsertProperty(properties, 'updated_at', timestamp, 'datetime');
  properties = upsertProperty(properties, 'last_change_id', eventId);
  properties = upsertProperty(properties, 'last_change_summary', summary);
  properties = upsertProperty(properties, 'content_hash', hash);

  const content = serializeFrontmatter(properties, parsed.body);
  return {
    content,
    event: {
      id: eventId,
      vaultId: file.vaultId,
      fileId: file.id,
      filePath: file.path,
      actorId: actor.id,
      actorType: actor.type,
      action,
      summary,
      createdAt: timestamp,
      contentHash: hash,
    },
  };
}

export async function saveFile(
  file: WikiFile,
  actor?: CollaborationActor,
  summary = 'Saved file',
): Promise<{ content: string; event?: ChangeEvent }> {
  if (!file.handle) return { content: file.content };
  const signed = actor ? await signWikiFileContent(file, actor, summary) : { content: file.content };
  const writable = await file.handle.createWritable();
  await writable.write(signed.content);
  await writable.close();
  return signed;
}

function sanitizeFsName(raw: string, fallback: string): string {
  const baseName = raw
    .replace(/\.md$/i, '')
    .replace(/[/:\\?%*"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return baseName || fallback;
}

function normalizeLegacyBrainContent(content: string, vaultName: string): string {
  return content
    .replace(/^type:\s*protocol$/m, 'type: brain')
    .replace(/tags:\s*\[brain,\s*agent,\s*protocol\]/, 'tags: [brain, agent, home]')
    .replace(new RegExp(`# ${vaultName} Protocol`, 'g'), `# ${vaultName} Brain`)
    .replace(/\bSub-Brain protocol\b/g, 'Sub-Brain home')
    .replace(/\bprotocol\b/g, 'brain home')
    .replace(/\bProtocol\b/g, 'Brain');
}

export function buildBrainHomeTemplate(vaultName: string): string {
  const brainLink = brainFileNameForWiki(vaultName).replace(/\.md$/i, '');
  return `---
type: brain
tags: [brain, agent, home]
vault: "${vaultName}"
status: active
---
# ${vaultName} Brain

## Purpose
Describe what this Sub-Brain is for in one or two sentences.

Placeholder: This Sub-Brain currently needs an agent to fill in its exact purpose after reading the files and sources.

## Role In The Big Brain
- Owns: the topics, sources, concepts, entities, projects, and questions that belong primarily to "${vaultName}".
- Does not own: topics that are better maintained in another Sub-Brain.
- Connects to: add Cross-Brain links here when this Sub-Brain depends on or informs another Brain.
- Entry point: this Brain file is the anchor, map, and agent contract for this Sub-Brain.

## Agent Start Here
1. Read [[AGENT_START]] for the complete agent startup prompt.
2. Read the Big Brain first.
3. Read this Brain file completely.
4. Use the Navigation Map below as the local map.
5. Read [[log]] for recent ingests, queries, lint passes, and maintenance.
6. Open the Core Nodes, Hubs, Sources, and Open Questions listed below before editing.
7. Only write after you understand the role of this Sub-Brain in the Big Brain.

## Navigation Map

### Core Nodes
- [[AGENT_START]] - copyable startup prompt for agents.
- [[${brainLink}]] - this Sub-Brain anchor, map, and role contract.
- [[log]] - chronological history.
- Add additional important pages here.

### Hubs
- Add pages that organize groups of concepts, sources, projects, or entities.

### Sources
- Add source-of-truth pages or raw-source summaries here.
- Raw sources should be read and cited, not rewritten.

### Open Questions
- Add unresolved investigation paths here.

### Cross-Brain Links
- Add links to other Sub-Brains or pages in other Brains when the relationship matters.

## Workflows

### Query
- Answer from this Brain first.
- Cite the pages and sources used.
- If the answer creates durable synthesis, save it as a page and link it here or in a hub.

### Ingest
- Read one source at a time when possible.
- Extract durable claims, entities, concepts, contradictions, and open questions.
- Update affected pages, links, frontmatter, this Brain file, and \`log.md\` when present.

### Lint
- Look for orphan pages, missing backlinks, stale claims, contradictions, missing concepts, and weak source coverage.
- Record suggested fixes in the relevant page, \`log.md\`, or Agent Handoff Notes.

### Maintenance
- Keep file names stable and link-friendly.
- Prefer small, meaningful links over dense decorative linking.
- Update this Brain file when the structure or role of the Sub-Brain changes.

## Folder And README Rules
- Do not create \`_README.md\`, \`README.md\`, or per-folder index files automatically.
- Folder names are organization hints; durable navigation belongs in this Brain file, explicit hub pages, and links between real content pages.
- Create a hub page only when it adds semantic value beyond restating a folder name.

## Linking Rules
- Use Markdown wiki links for durable semantic relationships.
- Every important node should be reachable from this Brain file or a hub.
- Cross-Brain links should explain why the Brains relate.
- Mark contradictions explicitly instead of smoothing them over.

## Relationship Vocabulary
- \`supports\`: a source or note supports a claim.
- \`contradicts\`: a note disagrees with or limits another note.
- \`depends_on\`: a project, decision, or implementation relies on another page.
- \`implements\`: code, template, process, or artifact implements a concept or decision.
- \`source_for\`: a source backs a synthesis or concept.
- \`handoff_to\`: current work should continue in another page or Brain.
- \`related\`: neighboring pages without a stronger relationship type.

## Writing Rules
- Preserve raw sources.
- Keep claims source-backed or clearly marked as synthesis.
- Update frontmatter when status, ownership, sources, or relationships change.
- Do not invent facts. Add Open Questions when uncertain.

## Recommended Frontmatter
- \`type\`: brain, agent-start, log, source, concept, entity, synthesis, project, question, template, or note.
- \`status\`: seed, active, stable, stale, superseded, or archived.
- \`tags\`: stable thematic tags.
- \`sources\`: source pages or raw files supporting the claim.
- \`related\`: important neighboring pages.
- \`owner\`: owning Brain or project when ambiguous.

## Brain Colour
Each Sub-Brain can be assigned a colour in the sidebar (hover the Brain folder -> palette icon).
The colour is stored in the app and is visible as the Brain section border, palette icon tint, and graph interlink colour.
It is not stored inside this file and does not need to be maintained manually.

## Current Map
- Main topics: to be filled by an agent.
- Important entities: to be filled by an agent.
- Active projects: to be filled by an agent.
- Known gaps: to be filled by an agent.
- Recent changes: see \`log.md\` when present.

## Agent Handoff Notes
- Add what the next agent should know before continuing.
- Keep this section short and operational.
`;
}

export function buildWikiBrainTemplate(vaultName: string): string {
  return buildBrainHomeTemplate(vaultName);
}

export async function ensureBrainHomeFile(
  rootHandle: FileSystemDirectoryHandle,
  vaultName: string,
): Promise<void> {
  const brainFileName = brainFileNameForWiki(vaultName);
  let legacyContent: string | null = null;

  try {
    const legacyHandle = await rootHandle.getFileHandle(LEGACY_BRAIN_HOME_FILE, { create: false });
    const legacyFile = await legacyHandle.getFile();
    legacyContent = legacyFile.size > 0 ? await legacyFile.text() : null;
  } catch {
    legacyContent = null;
  }

  if (!legacyContent) {
    try {
      const legacyHandle = await rootHandle.getFileHandle(legacyBrainHomeFileNameForWiki(vaultName), { create: false });
      const legacyFile = await legacyHandle.getFile();
      legacyContent = legacyFile.size > 0 ? await legacyFile.text() : null;
    } catch {
      legacyContent = null;
    }
  }

  try {
    const handle = await rootHandle.getFileHandle(brainFileName, { create: false });
    const file = await handle.getFile();
    if (file.size > 0) return;
    const writable = await handle.createWritable();
    await writable.write(legacyContent ? normalizeLegacyBrainContent(legacyContent, vaultName) : buildBrainHomeTemplate(vaultName));
    await writable.close();
  } catch {
    const handle = await rootHandle.getFileHandle(brainFileName, { create: true });
    const writable = await handle.createWritable();
    await writable.write(legacyContent ? normalizeLegacyBrainContent(legacyContent, vaultName) : buildBrainHomeTemplate(vaultName));
    await writable.close();
  }
}

function buildAgentStartTemplate(vaultName: string): string {
  const brainLink = brainFileNameForWiki(vaultName).replace(/\.md$/i, '');
  return `---
type: agent-start
tags: [brain, agent, start]
vault: "${vaultName}"
status: active
---
# Agent Start - ${vaultName}

Copy this prompt into a new agent session when you want the agent to work inside this Brain.

## Start Prompt

You are the maintainer of the "${vaultName}" Sub-Brain.

Treat this Brain as a persistent knowledge codebase, not as temporary chat context. Your job is to preserve structure, links, sources, decisions, contradictions, and handoff notes so future agents can continue without rediscovering everything.

Start in this order:
1. Read [[${brainLink}]] completely.
2. Use the Navigation Map in [[${brainLink}]] as the local content map.
3. Read [[log]] for recent work and unresolved maintenance.
4. Open the Core Nodes, Hubs, Sources, Open Questions, and Cross-Brain Links listed in the Brain file.
5. Identify which files are source-of-truth and which files are synthesis or working notes.
6. Only edit after you understand this Brain's role in the Big Brain.

Operating rules:
- Preserve raw sources and source-backed claims.
- Use Markdown wiki links for durable semantic relationships.
- Keep important nodes reachable from the Brain file or a hub.
- Update affected links, frontmatter, the Brain file, log, and handoff notes when you make structural changes.
- Do not create \`_README.md\`, \`README.md\`, or per-folder index files automatically.
- Create hub pages only when they add semantic value beyond restating a folder name.
- Add Cross-Brain links only when the relationship has durable navigation value and explain why the boundary matters.
- Mark uncertainty as Open Questions instead of inventing facts.
- Record contradictions explicitly.

When asked to ingest:
- Read the source.
- Extract durable claims, entities, concepts, contradictions, and open questions.
- Update or create the relevant Brain pages.
- Update [[${brainLink}]] and [[log]] if navigation or role changes.

When asked to answer:
- Search this Brain first.
- Cite relevant Brain pages and sources.
- Save durable synthesis back into the Brain when it will be useful later.

When asked to lint:
- Find orphan pages, missing backlinks, stale claims, contradictions, missing concept pages, and weak source coverage.
- Add concise findings to [[log]] or the relevant handoff notes.
`;
}

function buildBrainLogTemplate(vaultName: string): string {
  return `---
type: log
tags: [brain, log]
vault: "${vaultName}"
status: active
---
# ${vaultName} Log

Append-only chronological history for this Brain. Agents should add short entries for ingests, queries, lint passes, maintenance, and structural changes.

## Entry Format

Use this format so the log stays parseable:

### [YYYY-MM-DD] type | short title
- Summary:
- Files touched:
- Sources:
- Decisions:
- Open questions:

## Entries

### [${new Date().toISOString().slice(0, 10)}] maintenance | Brain scaffold created
- Summary: Created the default Brain scaffold files.
- Files touched: [[AGENT_START]], [[log]]
- Sources: none
- Decisions: use the Brain file, log, and agent start files as the Brain entry system.
- Open questions: fill the local map after reviewing this Brain.
`;
}

async function ensureMarkdownFile(
  rootHandle: FileSystemDirectoryHandle,
  fileName: string,
  content: string,
): Promise<void> {
  try {
    const handle = await rootHandle.getFileHandle(fileName, { create: false });
    const file = await handle.getFile();
    if (file.size > 0) return;
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
  } catch {
    const handle = await rootHandle.getFileHandle(fileName, { create: true });
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
  }
}

export async function ensureBrainScaffoldFiles(
  rootHandle: FileSystemDirectoryHandle,
  vaultName: string,
): Promise<void> {
  await ensureBrainHomeFile(rootHandle, vaultName);
  await ensureMarkdownFile(rootHandle, AGENT_START_FILE, buildAgentStartTemplate(vaultName));
  await ensureMarkdownFile(rootHandle, BRAIN_LOG_FILE, buildBrainLogTemplate(vaultName));
}

async function nextAvailableMarkdownFileName(parentDir: FileSystemDirectoryHandle, baseName: string): Promise<string> {
  let fileName = `${baseName}.md`;
  let index = 2;
  while (true) {
    try {
      await parentDir.getFileHandle(fileName, { create: false });
      fileName = `${baseName} ${index}.md`;
      index += 1;
    } catch {
      break;
    }
  }
  return fileName;
}

async function nextAvailableDirectoryName(parentDir: FileSystemDirectoryHandle, baseName: string): Promise<string> {
  let dirName = baseName;
  let index = 2;
  while (true) {
    try {
      await parentDir.getDirectoryHandle(dirName, { create: false });
      dirName = `${baseName} ${index}`;
      index += 1;
    } catch {
      break;
    }
  }
  return dirName;
}

export async function createMarkdownFileInDirectory(
  parentDir: FileSystemDirectoryHandle,
  rawTitle: string,
): Promise<string> {
  const baseName = sanitizeFsName(rawTitle.trim() || 'New Note', 'New Note');
  const fileName = await nextAvailableMarkdownFileName(parentDir, baseName);
  const handle = await parentDir.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  await writable.write(`# ${baseName}\n\n`);
  await writable.close();
  return fileName;
}

export async function createSubfolderInDirectory(
  parentDir: FileSystemDirectoryHandle,
  rawName: string,
): Promise<string> {
  const sanitized = sanitizeFsName(rawName.trim() || 'New Folder', 'New Folder');
  const baseName = sanitized.startsWith('.') ? sanitized.replace(/^\.+/, '') || 'New Folder' : sanitized;
  const folderName = await nextAvailableDirectoryName(parentDir, baseName);
  await parentDir.getDirectoryHandle(folderName, { create: true });
  return folderName;
}

export async function createMarkdownFileInVault(
  vault: WikiVault,
  rawTitle: string,
): Promise<string> {
  return createMarkdownFileInDirectory(vault.rootHandle, rawTitle);
}

export function collectFolderIds(folder: WikiFolder): string[] {
  return [folder.id, ...folder.folders.flatMap(collectFolderIds)];
}

const DB_NAME = 'big-brain-db';
const DB_VERSION = 2;
const HANDLE_STORE = 'handles';
const LAST_VAULT_KEY = 'last-vault';
const WIKI_VAULTS_KEY = 'wiki-vaults';
const COLLABORATION_STATE_KEY = 'collaboration-state';

export interface StoredWikiVaultHandle {
  id: string;
  name: string;
  handle: FileSystemDirectoryHandle;
  color?: string;
}

type PermissionAwareDirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
};

type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  values?: () => AsyncIterable<FileSystemDirectoryHandle | FileSystemFileHandle>;
  entries?: () => AsyncIterable<[string, FileSystemDirectoryHandle | FileSystemFileHandle]>;
  [Symbol.asyncIterator]?: () => AsyncIterator<[string, FileSystemDirectoryHandle | FileSystemFileHandle]>;
};

async function directoryEntries(
  dir: FileSystemDirectoryHandle,
): Promise<Array<FileSystemDirectoryHandle | FileSystemFileHandle>> {
  const iterableDir = dir as IterableDirectoryHandle;
  if (iterableDir.values) {
    try {
      const entries: Array<FileSystemDirectoryHandle | FileSystemFileHandle> = [];
      for await (const entry of iterableDir.values()) entries.push(entry);
      return entries;
    } catch {
      // Some persisted directory handles expose values() but fail when iterated.
      // Fall back to entries() below instead of failing the whole Brain load.
    }
  }
  const pairs = iterableDir.entries ? iterableDir.entries() : iterableDir;
  const entries: Array<FileSystemDirectoryHandle | FileSystemFileHandle> = [];
  for await (const [, entry] of pairs as AsyncIterable<[string, FileSystemDirectoryHandle | FileSystemFileHandle]>) {
    entries.push(entry);
  }
  return entries;
}

function openWikiDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(HANDLE_STORE)) db.createObjectStore(HANDLE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function writeDbValue<T>(key: string, value: T): Promise<void> {
  const db = await openWikiDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, 'readwrite');
    tx.objectStore(HANDLE_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function readDbValue<T>(key: string): Promise<T | null> {
  const db = await openWikiDb();
  const value = await new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, 'readonly');
    const request = tx.objectStore(HANDLE_STORE).get(key);
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value;
}

async function deleteDbValue(key: string): Promise<void> {
  const db = await openWikiDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, 'readwrite');
    tx.objectStore(HANDLE_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function saveLastVaultHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await writeDbValue(LAST_VAULT_KEY, handle);
}

export async function getLastVaultHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof indexedDB === 'undefined') return null;
  return readDbValue<FileSystemDirectoryHandle>(LAST_VAULT_KEY);
}

export async function saveWikiVaultHandles(vaults: WikiVault[]): Promise<void> {
  await writeDbValue<StoredWikiVaultHandle[]>(
    WIKI_VAULTS_KEY,
    vaults.map((vault) => ({ id: vault.id, name: vault.name, handle: vault.rootHandle, color: vault.color })),
  );
}

export async function getWikiVaultHandles(): Promise<StoredWikiVaultHandle[]> {
  if (typeof indexedDB === 'undefined') return [];
  const stored = await readDbValue<StoredWikiVaultHandle[]>(WIKI_VAULTS_KEY);
  if (stored?.length) return stored;
  const legacy = await getLastVaultHandle();
  return legacy ? [{ id: createVaultId(legacy.name), name: legacy.name, handle: legacy }] : [];
}

export async function clearWikiVaultHandles(): Promise<void> {
  await deleteDbValue(WIKI_VAULTS_KEY);
  await deleteDbValue(LAST_VAULT_KEY);
}

export async function saveCollaborationState(snapshot: CollaborationStateSnapshot): Promise<void> {
  await writeDbValue<CollaborationStateSnapshot>(COLLABORATION_STATE_KEY, snapshot);
}

export async function getCollaborationState(): Promise<CollaborationStateSnapshot | null> {
  if (typeof indexedDB === 'undefined') return null;
  return readDbValue<CollaborationStateSnapshot>(COLLABORATION_STATE_KEY);
}

export async function hasVaultPermission(
  handle: FileSystemDirectoryHandle,
  requestIfNeeded = false,
  mode: 'read' | 'readwrite' = 'readwrite',
): Promise<boolean> {
  const permissionHandle = handle as PermissionAwareDirectoryHandle;
  const descriptor = { mode };

  // requestPermission must be triggered directly from the user's click.
  // Awaiting queryPermission first can lose the browser's user activation.
  if (requestIfNeeded && permissionHandle.requestPermission) {
    try {
      return (await permissionHandle.requestPermission(descriptor)) === 'granted';
    } catch {
      return false;
    }
  }

  if (permissionHandle.queryPermission) {
    try {
      const current = await permissionHandle.queryPermission(descriptor);
      if (current === 'granted') return true;
    } catch {
      return false;
    }
  }

  return false;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/;

function unquote(raw: string): string {
  const trimmed = raw.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseScalar(raw: string): { type: PropertyType; value: PropertyValue } {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'null') return { type: 'text', value: null };
  if (trimmed === 'true') return { type: 'checkbox', value: true };
  if (trimmed === 'false') return { type: 'checkbox', value: false };
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return { type: 'number', value: Number(trimmed) };
  if (DATETIME_RE.test(trimmed)) return { type: 'datetime', value: trimmed.replace(' ', 'T') };
  if (DATE_RE.test(trimmed)) return { type: 'date', value: trimmed };
  return { type: 'text', value: unquote(trimmed) };
}

function parseInlineList(raw: string): string[] {
  const inner = raw.trim().replace(/^\[/, '').replace(/\]$/, '').trim();
  if (!inner) return [];
  const items: string[] = [];
  let current = '';
  let depth = 0;
  let inString: '"' | "'" | null = null;
  for (const ch of inner) {
    if (inString) {
      current += ch;
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      current += ch;
      continue;
    }
    if (ch === '[' || ch === '{') depth++;
    if (ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) {
      items.push(unquote(current));
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim() !== '') items.push(unquote(current));
  return items;
}

export function parseFrontmatter(content: string): { properties: Property[]; body: string } {
  if (!content.startsWith('---')) return { properties: [], body: content };
  const lines = content.split('\n');
  if (lines[0].trim() !== '---') return { properties: [], body: content };
  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endIndex = i;
      break;
    }
  }
  if (endIndex === -1) return { properties: [], body: content };

  const properties: Property[] = [];
  let i = 1;
  while (i < endIndex) {
    const line = lines[i];
    const match = line.match(/^([^:]+):(.*)$/);
    if (!match) {
      i++;
      continue;
    }
    const key = match[1].trim();
    const valueRaw = match[2];

    const blockListItems: string[] = [];
    let j = i + 1;
    while (j < endIndex && /^\s+-\s+/.test(lines[j])) {
      blockListItems.push(unquote(lines[j].replace(/^\s+-\s+/, '')));
      j++;
    }

    if (blockListItems.length > 0) {
      properties.push({ key, type: key === 'tags' ? 'tags' : 'list', value: blockListItems });
      i = j;
      continue;
    }

    const trimmedValue = valueRaw.trim();
    if (trimmedValue.startsWith('[') && trimmedValue.endsWith(']')) {
      const items = parseInlineList(trimmedValue);
      properties.push({ key, type: key === 'tags' ? 'tags' : 'list', value: items });
    } else {
      const { type, value } = parseScalar(trimmedValue);
      properties.push({ key, type: key === 'tags' ? 'tags' : type, value });
    }
    i++;
  }

  const body = lines.slice(endIndex + 1).join('\n').replace(/^\n+/, '');
  return { properties, body };
}

function formatScalar(value: PropertyValue, type: PropertyType): string {
  if (value === null || value === undefined) return '';
  if (type === 'checkbox') return value ? 'true' : 'false';
  if (type === 'number') return String(value);
  if (type === 'date' || type === 'datetime') return String(value);
  const str = String(value);
  if (str === '' || /^[\s]*$/.test(str)) return '';
  if (/[:#\[\]{},&*!|>'"%@`]/.test(str) || /^(true|false|null|\d)/.test(str)) {
    const escaped = str.replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  return str;
}

function formatInlineList(items: string[]): string {
  if (items.length === 0) return '[]';
  return `[${items.map((item) => formatScalar(item, 'text')).join(', ')}]`;
}

export function serializeFrontmatter(properties: Property[], body: string): string {
  if (properties.length === 0) return body.startsWith('\n') ? body : body;
  const lines: string[] = ['---'];
  for (const prop of properties) {
    if (prop.type === 'list' || prop.type === 'tags') {
      const arr = Array.isArray(prop.value) ? prop.value : [];
      lines.push(`${prop.key}: ${formatInlineList(arr)}`);
    } else {
      lines.push(`${prop.key}: ${formatScalar(prop.value, prop.type)}`);
    }
  }
  lines.push('---');
  const bodyTrimmed = body.replace(/^\n+/, '');
  return `${lines.join('\n')}\n${bodyTrimmed}`;
}

export function inferType(value: unknown): PropertyType {
  if (typeof value === 'boolean') return 'checkbox';
  if (typeof value === 'number') return 'number';
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'string') {
    if (DATETIME_RE.test(value)) return 'datetime';
    if (DATE_RE.test(value)) return 'date';
  }
  return 'text';
}

export function convertValue(value: PropertyValue, target: PropertyType): PropertyValue {
  switch (target) {
    case 'text':
      if (Array.isArray(value)) return value.join(', ');
      if (value === null) return '';
      return String(value);
    case 'number': {
      const n = Number(value);
      return Number.isFinite(n) ? n : 0;
    }
    case 'checkbox':
      if (typeof value === 'boolean') return value;
      if (value === 'true' || value === 1) return true;
      if (value === 'false' || value === 0) return false;
      return false;
    case 'date':
    case 'datetime':
      if (typeof value === 'string') return value;
      return '';
    case 'list':
    case 'tags':
      if (Array.isArray(value)) return value;
      if (typeof value === 'string' && value.length > 0) {
        return value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
      return [];
  }
}
