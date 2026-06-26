// ============================================================
// /api/brain/relations - add a typed semantic relation (edge)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { addBrainRelation, type BrainRelationKind } from '@/lib/server/brain-edges';
import type { BrainScopeType } from '@/lib/server/brain-db';

export const runtime = 'nodejs';

const KINDS: BrainRelationKind[] = ['mentions', 'belongs_to', 'derived_from', 'contradicts', 'supersedes', 'wiki_link'];

function isScope(value: unknown): value is BrainScopeType {
  return typeof value === 'string' && ['user', 'base', 'group', 'agent', 'council'].includes(value);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const scopeType = body?.scopeType;
    const scopeId = String(body?.scopeId || '').trim();
    const sourceSlug = String(body?.sourceSlug || '').trim();
    const targetSlug = String(body?.targetSlug || '').trim();
    const kind = body?.kind as BrainRelationKind;
    const confidence = body?.confidence != null ? Number(body.confidence) : undefined;
    if (!isScope(scopeType) || !scopeId || !sourceSlug || !targetSlug || !KINDS.includes(kind)) {
      return NextResponse.json(
        { success: false, error: 'scopeType, scopeId, sourceSlug, targetSlug and a valid kind are required' },
        { status: 400 },
      );
    }
    const result = await addBrainRelation({ scopeType, scopeId, sourceSlug, targetSlug, kind, confidence });
    return NextResponse.json({ success: result.ok, ...result }, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'BRAIN_RELATION_FAILED', message: error instanceof Error ? error.message : 'Add relation failed.' },
      { status: 500 },
    );
  }
}
