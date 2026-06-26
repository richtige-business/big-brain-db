// ============================================================
// /api/brain/neighbours - typed graph neighbour traversal
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getBrainNeighbours, type BrainRelationKind } from '@/lib/server/brain-edges';
import type { BrainScopeType } from '@/lib/server/brain-db';

export const runtime = 'nodejs';

function isScope(value: string | null): value is BrainScopeType {
  return Boolean(value && ['user', 'base', 'group', 'agent', 'council'].includes(value));
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const scopeType = url.searchParams.get('scopeType');
    const scopeId = (url.searchParams.get('scopeId') || '').trim();
    const slug = (url.searchParams.get('slug') || '').trim();
    const direction = (url.searchParams.get('direction') || 'both') as 'in' | 'out' | 'both';
    const kindsParam = url.searchParams.get('kinds');
    const kinds = kindsParam ? (kindsParam.split(',').map((k) => k.trim()) as BrainRelationKind[]) : undefined;
    if (!isScope(scopeType) || !scopeId || !slug) {
      return NextResponse.json({ success: false, error: 'scopeType, scopeId and slug are required' }, { status: 400 });
    }
    const neighbours = await getBrainNeighbours({ scopeType, scopeId, slug, direction, kinds });
    return NextResponse.json({ success: true, neighbours });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'BRAIN_NEIGHBOURS_FAILED', message: error instanceof Error ? error.message : 'Neighbour lookup failed.' },
      { status: 500 },
    );
  }
}
