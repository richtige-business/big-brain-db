// ============================================================
// /api/brain/schema-graph - Hybrid graph database payload
// ============================================================

import { NextResponse } from 'next/server';
import { getBrainSchemaGraph } from '@/lib/server/schema-graph';
import { LOCAL_USER_ID } from '@/lib/server/brain-db';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const graph = await getBrainSchemaGraph(LOCAL_USER_ID);
    return NextResponse.json({ success: true, ...graph });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: 'BRAIN_SCHEMA_GRAPH_FAILED',
        message: error instanceof Error ? error.message : 'Schema graph could not be loaded.',
      },
      { status: 500 }
    );
  }
}
