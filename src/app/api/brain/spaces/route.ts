// ============================================================
// /api/brain/spaces - list the Brain spaces (for the chat scope selector)
// ============================================================

import { NextResponse } from 'next/server';
import { listBrainSpaces } from '@/lib/server/brain-db';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const spaces = await listBrainSpaces({});
    return NextResponse.json({
      success: true,
      spaces: spaces.map((s) => ({ scopeType: s.scopeType, scopeId: s.scopeId, name: s.name })),
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'SPACES_FAILED', message: error instanceof Error ? error.message : 'Failed.' },
      { status: 500 },
    );
  }
}
