// ============================================================
// /api/brain/search - hybrid (lexical + vector) brain search
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { hybridSearchBrain } from '@/lib/server/brain-retrieval';
import type { BrainScopeType } from '@/lib/server/brain-db';

export const runtime = 'nodejs';

function isScope(value: unknown): value is BrainScopeType {
  return typeof value === 'string' && ['user', 'base', 'group', 'agent', 'council'].includes(value);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const scopeType = body?.scopeType;
    const scopeId = String(body?.scopeId || '').trim();
    const query = String(body?.query || '').trim();
    const limit = Number(body?.limit) > 0 ? Math.min(Number(body.limit), 50) : 8;
    if (!isScope(scopeType) || !scopeId || !query) {
      return NextResponse.json({ success: false, error: 'scopeType, scopeId and query are required' }, { status: 400 });
    }
    const hits = await hybridSearchBrain({ scopeType, scopeId, query, limit });
    return NextResponse.json({ success: true, hits });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'BRAIN_SEARCH_FAILED', message: error instanceof Error ? error.message : 'Brain search failed.' },
      { status: 500 },
    );
  }
}
