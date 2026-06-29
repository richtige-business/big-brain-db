// ============================================================
// /api/brain/models - list the OpenRouter models for the switcher
// ============================================================

import { NextResponse } from 'next/server';
import { listModels, isChatEnabled } from '@/lib/server/openrouter';

export const runtime = 'nodejs';
// Cache the catalogue for an hour — it changes rarely and the list is large.
export const revalidate = 3600;

export async function GET() {
  if (!isChatEnabled()) {
    return NextResponse.json(
      { success: false, error: 'OPENROUTER_NOT_CONFIGURED', message: 'OPENROUTER_API_KEY is not set.' },
      { status: 503 },
    );
  }
  try {
    const models = await listModels();
    return NextResponse.json({ success: true, models });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'MODELS_FETCH_FAILED', message: error instanceof Error ? error.message : 'Failed.' },
      { status: 502 },
    );
  }
}
