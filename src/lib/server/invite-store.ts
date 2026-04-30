import type { BrainRole, CollaborationActorType } from '@/lib/wiki';

type InviteRole = Exclude<BrainRole, 'owner'>;

export interface StoredBrainInvite {
  id: string;
  vaultId: string;
  vaultName: string;
  email: string;
  inviteCode: string;
  inviteCodeHash: string;
  role: InviteRole;
  invitedBy: string;
  invitedByName: string;
  status: 'pending' | 'accepted' | 'revoked';
  createdAt: string;
  acceptedBy?: string;
  acceptedByName?: string;
  acceptedByType?: CollaborationActorType;
  acceptedAt?: string;
}

const globalStore = globalThis as typeof globalThis & {
  __brainInviteStore?: Map<string, StoredBrainInvite>;
};

function inviteStore(): Map<string, StoredBrainInvite> {
  if (!globalStore.__brainInviteStore) globalStore.__brainInviteStore = new Map();
  return globalStore.__brainInviteStore;
}

export function saveLocalInvite(invite: StoredBrainInvite): StoredBrainInvite {
  inviteStore().set(invite.inviteCodeHash, invite);
  return invite;
}

export function getPendingLocalInvite(inviteCodeHash: string): StoredBrainInvite | null {
  const invite = inviteStore().get(inviteCodeHash) ?? null;
  return invite?.status === 'pending' ? invite : null;
}

export function acceptLocalInvite(
  inviteCodeHash: string,
  actor: { id: string; name: string; type: CollaborationActorType },
): StoredBrainInvite | null {
  const invite = getPendingLocalInvite(inviteCodeHash);
  if (!invite) return null;
  const accepted: StoredBrainInvite = {
    ...invite,
    status: 'accepted',
    acceptedBy: actor.id,
    acceptedByName: actor.name,
    acceptedByType: actor.type,
    acceptedAt: new Date().toISOString(),
  };
  inviteStore().set(inviteCodeHash, accepted);
  return accepted;
}
