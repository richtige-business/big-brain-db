// ============================================================
// /api/brain/context - preview the RAG context for a question WITHOUT calling
// the LLM. Lets the chat settings show exactly what is fed to the model.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import type { BrainScopeType } from '@/lib/server/brain-db';
import { retrieveBrainContext } from '@/lib/server/brain-retrieval';

export const runtime = 'nodejs';

function isScope(value: unknown): value is BrainScopeType {
  return typeof value === 'string' && ['user', 'base', 'group', 'agent', 'council'].includes(value);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const question = String(body?.question || '').trim();
  if (!question) return NextResponse.json({ success: true, contextBlock: '', sources: [] });

  const contextLimit = Number(body?.contextLimit) > 0 ? Math.min(Number(body.contextLimit), 30) : 8;
  const scopeType = isScope(body?.scopeType) ? body.scopeType : undefined;
  const scopeId = scopeType ? String(body?.scopeId || '').trim() : undefined;

  try {
    const ctx = await retrieveBrainContext({
      query: question,
      limit: contextLimit,
      ...(scopeType && scopeId ? { scopeType, scopeId } : {}),
    });
    return NextResponse.json({ success: true, ...ctx });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'CONTEXT_FAILED', message: error instanceof Error ? error.message : 'Failed.' },
      { status: 500 },
    );
  }
}
