// ============================================================
// /api/brain/memorise - persist a durable agent memory
//
// Stores a `memory` brain document with provenance (session / message),
// embedded for semantic recall like any other brain document.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { ensureBrainSpace, upsertBrainDocument, type BrainScopeType } from '@/lib/server/brain-db';

export const runtime = 'nodejs';

function isScope(value: unknown): value is BrainScopeType {
  return typeof value === 'string' && ['user', 'base', 'group', 'agent', 'council'].includes(value);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const scopeType = body?.scopeType;
    const scopeId = String(body?.scopeId || '').trim();
    const text = String(body?.text || '').trim();
    const sessionId = body?.sessionId ? String(body.sessionId) : null;
    const messageId = body?.messageId ? String(body.messageId) : null;
    const title = String(body?.title || '').trim() || text.slice(0, 60);
    if (!isScope(scopeType) || !scopeId || !text) {
      return NextResponse.json({ success: false, error: 'scopeType, scopeId and text are required' }, { status: 400 });
    }

    const space = await ensureBrainSpace({ scopeType, scopeId, name: `${scopeType}:${scopeId}` });
    const stamp = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    const doc = await upsertBrainDocument({
      spaceId: space.id,
      slug: `memories/${stamp}`,
      title,
      contentMarkdown: text,
      type: 'memory',
      frontmatter: { source_session_id: sessionId, source_message_id: messageId, memorised_at: new Date().toISOString() },
      tags: ['memory'],
      changeSummary: 'Memory captured',
      actor: { id: 'agent:claude-code', name: 'Claude Code', type: 'agent' },
    });
    return NextResponse.json({ success: true, document: doc });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'BRAIN_MEMORISE_FAILED', message: error instanceof Error ? error.message : 'Memorise failed.' },
      { status: 500 },
    );
  }
}
