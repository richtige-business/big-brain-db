import { NextResponse } from 'next/server';
import { createInviteCode, hashInviteCode } from '@/lib/server/invite-code';
import { saveLocalInvite } from '@/lib/server/invite-store';
import { createSupabaseServiceClient } from '@/lib/supabase/server';
import type { BrainRole, CollaborationActorType } from '@/lib/wiki';

type InviteRole = Exclude<BrainRole, 'owner'>;

const INVITE_ROLES: InviteRole[] = ['admin', 'editor', 'commenter', 'viewer', 'agent'];
const ACTOR_TYPES: CollaborationActorType[] = ['user', 'agent'];

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function inviteResponse(invitation: {
  id: string;
  vaultId: string;
  vaultName: string;
  email: string;
  role: InviteRole;
  status: 'pending' | 'accepted' | 'revoked';
  createdAt: string;
  invitedBy: string;
  inviteCode: string;
}) {
  return NextResponse.json({ invitation });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return badRequest('Invalid request body.');

  const vaultId = typeof body.vaultId === 'string' ? body.vaultId.trim() : '';
  const vaultName = typeof body.vaultName === 'string' ? body.vaultName.trim() : '';
  const emailInput = typeof body.email === 'string' ? body.email.trim() : '';
  const requestedInviteCode = typeof body.inviteCode === 'string' ? body.inviteCode.trim().toUpperCase() : '';
  const role = body.role as InviteRole;
  const actorId = typeof body.actorId === 'string' ? body.actorId.trim() : '';
  const actorName = typeof body.actorName === 'string' ? body.actorName.trim() : '';
  const actorType = body.actorType as CollaborationActorType;

  if (!vaultId || !vaultName) return badRequest('Missing Brain identity.');
  if (!INVITE_ROLES.includes(role)) return badRequest('Invalid invite role.');
  if (!actorId || !actorName || !ACTOR_TYPES.includes(actorType)) return badRequest('Invalid actor.');

  const email = emailInput || 'pending collaborator';
  const inviteCode = requestedInviteCode || createInviteCode(vaultName);
  const inviteCodeHash = hashInviteCode(inviteCode);
  const localInvite = {
    id: `local:${vaultId}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`,
    vaultId,
    vaultName,
    email,
    inviteCode,
    inviteCodeHash,
    role,
    invitedBy: actorId,
    invitedByName: actorName,
    status: 'pending' as const,
    createdAt: new Date().toISOString(),
  };

  try {
    const supabase = createSupabaseServiceClient();

    const { error: brainError } = await supabase.from('brains').upsert({
      id: vaultId,
      name: vaultName,
      created_by_actor_id: actorId,
      created_by_actor_name: actorName,
      created_by_actor_type: actorType,
      updated_at: new Date().toISOString(),
    });
    if (brainError) throw brainError;

    const { error: membershipError } = await supabase.from('brain_memberships').upsert({
      brain_id: vaultId,
      actor_id: actorId,
      actor_name: actorName,
      actor_type: actorType,
      role: 'owner',
    });
    if (membershipError) throw membershipError;

    const { data, error: inviteError } = await supabase
      .from('brain_invites')
      .insert({
        brain_id: vaultId,
        brain_name: vaultName,
        invite_code_hash: inviteCodeHash,
        invite_code_hint: inviteCode,
        email,
        role,
        invited_by_actor_id: actorId,
        invited_by_actor_name: actorName,
        status: 'pending',
      })
      .select('id, brain_id, brain_name, invite_code_hint, email, role, status, created_at')
      .single();

    if (inviteError) throw inviteError;

    return inviteResponse({
      id: data.id,
      vaultId: data.brain_id,
      vaultName: data.brain_name,
      email: data.email,
      role: data.role,
      status: data.status,
      createdAt: data.created_at,
      invitedBy: actorId,
      inviteCode: data.invite_code_hint || inviteCode,
    });
  } catch (error) {
    console.warn('Falling back to local invite store.', error);
    const invitation = saveLocalInvite(localInvite);
    return inviteResponse(invitation);
  }
}
