import { NextResponse } from 'next/server';
import { hashInviteCode } from '@/lib/server/invite-code';
import { acceptLocalInvite } from '@/lib/server/invite-store';
import { createSupabaseServiceClient } from '@/lib/supabase/server';
import type { CollaborationActorType } from '@/lib/wiki';

const ACTOR_TYPES: CollaborationActorType[] = ['user', 'agent'];

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function acceptedInviteResponse(invitation: {
  id: string;
  brain_id: string;
  brain_name: string;
  email: string;
  role: string;
  invited_by_actor_id: string;
  created_at: string;
}, actor: { id: string; name: string; type: CollaborationActorType }, acceptedAt: string) {
  return NextResponse.json({
    invitation: {
      id: invitation.id,
      vaultId: invitation.brain_id,
      vaultName: invitation.brain_name,
      email: invitation.email,
      role: invitation.role,
      invitedBy: invitation.invited_by_actor_id,
      status: 'accepted',
      createdAt: invitation.created_at,
      acceptedBy: actor.id,
      acceptedAt,
    },
    membership: {
      vaultId: invitation.brain_id,
      actorId: actor.id,
      role: invitation.role,
      invitedBy: invitation.invited_by_actor_id,
      createdAt: acceptedAt,
    },
    actor: {
      id: actor.id,
      name: actor.name,
      type: actor.type,
    },
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return badRequest('Invalid request body.');

  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const actorName = typeof body.actorName === 'string' ? body.actorName.trim() : '';
  const actorId = typeof body.actorId === 'string' ? body.actorId.trim() : '';
  const actorType = body.actorType as CollaborationActorType;

  if (!code) return badRequest('Missing invite code.');
  if (!actorId || !actorName || !ACTOR_TYPES.includes(actorType)) return badRequest('Invalid actor.');

  const codeHash = hashInviteCode(code);
  const actor = { id: actorId, name: actorName, type: actorType };

  try {
    const supabase = createSupabaseServiceClient();

    const { data: invitation, error: inviteError } = await supabase
      .from('brain_invites')
      .select('id, brain_id, brain_name, email, role, invited_by_actor_id, status, created_at')
      .eq('invite_code_hash', codeHash)
      .eq('status', 'pending')
      .maybeSingle();

    if (inviteError) throw inviteError;
    if (!invitation) throw new Error('Invite code not found or already used.');

    const now = new Date().toISOString();
    const { error: membershipError } = await supabase.from('brain_memberships').upsert({
      brain_id: invitation.brain_id,
      actor_id: actorId,
      actor_name: actorName,
      actor_type: actorType,
      role: invitation.role,
      invited_by_actor_id: invitation.invited_by_actor_id,
      created_at: now,
    });
    if (membershipError) throw membershipError;

    const { error: updateError } = await supabase
      .from('brain_invites')
      .update({
        status: 'accepted',
        accepted_by_actor_id: actorId,
        accepted_by_actor_name: actorName,
        accepted_at: now,
      })
      .eq('id', invitation.id);
    if (updateError) throw updateError;

    return acceptedInviteResponse(invitation, actor, now);
  } catch (error) {
    console.warn('Falling back to local invite acceptance.', error);
    const invitation = acceptLocalInvite(codeHash, actor);
    if (!invitation) return NextResponse.json({ error: 'Invite code not found or already used.' }, { status: 404 });
    return acceptedInviteResponse(
      {
        id: invitation.id,
        brain_id: invitation.vaultId,
        brain_name: invitation.vaultName,
        email: invitation.email,
        role: invitation.role,
        invited_by_actor_id: invitation.invitedBy,
        created_at: invitation.createdAt,
      },
      actor,
      invitation.acceptedAt ?? new Date().toISOString(),
    );
  }
}
