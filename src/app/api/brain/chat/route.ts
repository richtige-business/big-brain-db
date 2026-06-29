// ============================================================
// /api/brain/chat - ask an LLM (via OpenRouter) about the Brain.
//
// Pipeline per request:
//   1. Retrieve relevant Brain context (RAG) via buildBrainPromptBlock.
//   2. Assemble [system + context, ...history, user question].
//   3. Stream the model's answer (OpenRouter SSE) back as plain text tokens.
// The selected source documents are returned in the `X-Brain-Sources` header so
// the UI can show citations without a second round-trip.
//
// The OpenRouter key lives only in src/lib/server/openrouter.ts (process.env);
// it is never exposed to the browser.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import type { BrainScopeType } from '@/lib/server/brain-db';
import { retrieveBrainContext } from '@/lib/server/brain-retrieval';
import { chatCompletionStream, isChatEnabled, type ChatMessage } from '@/lib/server/openrouter';

export const runtime = 'nodejs';

const DEFAULT_SYSTEM_PROMPT =
  'You are the Brain assistant for this knowledge base. Answer questions using the ' +
  'provided Brain Context as your primary source of truth. Cite the document titles ' +
  'you relied on. If the context does not contain the answer, say so plainly rather ' +
  'than inventing facts.';

function isScope(value: unknown): value is BrainScopeType {
  return typeof value === 'string' && ['user', 'base', 'group', 'agent', 'council'].includes(value);
}

export async function POST(request: NextRequest) {
  if (!isChatEnabled()) {
    return NextResponse.json(
      { success: false, error: 'OPENROUTER_NOT_CONFIGURED', message: 'OPENROUTER_API_KEY is not set.' },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const question = String(body?.question || '').trim();
  const model = String(body?.model || '').trim();
  if (!question || !model) {
    return NextResponse.json({ success: false, error: 'question and model are required' }, { status: 400 });
  }

  const systemPrompt = String(body?.systemPrompt || DEFAULT_SYSTEM_PROMPT);
  const useContext = body?.useContext !== false; // default on
  const contextLimit = Number(body?.contextLimit) > 0 ? Math.min(Number(body.contextLimit), 30) : 8;
  const scopeType = isScope(body?.scopeType) ? body.scopeType : undefined;
  const scopeId = scopeType ? String(body?.scopeId || '').trim() : undefined;
  const history: ChatMessage[] = Array.isArray(body?.history)
    ? body.history
        .filter((m: unknown): m is ChatMessage =>
          !!m && (m as ChatMessage).role !== 'system' && typeof (m as ChatMessage).content === 'string',
        )
        .slice(-10)
    : [];

  // 1. RAG context (best-effort — empty when the DB has no match / no DB).
  let contextBlock = '';
  let sources: Awaited<ReturnType<typeof retrieveBrainContext>>['sources'] = [];
  if (useContext) {
    try {
      const ctx = await retrieveBrainContext({
        query: question,
        limit: contextLimit,
        ...(scopeType && scopeId ? { scopeType, scopeId } : {}),
      });
      contextBlock = ctx.contextBlock;
      sources = ctx.sources;
    } catch {
      contextBlock = '';
      sources = [];
    }
  }

  // 2. Assemble the message list.
  const systemContent = contextBlock ? `${systemPrompt}\n\n${contextBlock}` : systemPrompt;
  const messages: ChatMessage[] = [
    { role: 'system', content: systemContent },
    ...history,
    { role: 'user', content: question },
  ];

  // 3. Stream the answer, translating OpenRouter SSE into plain text tokens.
  let upstream: Response;
  try {
    upstream = await chatCompletionStream({ model, messages });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'CHAT_FAILED', message: error instanceof Error ? error.message : 'Chat failed.' },
      { status: 502 },
    );
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let buffer = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? ''; // keep the trailing partial line
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const data = trimmed.slice(5).trim();
            if (data === '[DONE]') continue;
            try {
              const json = JSON.parse(data);
              const delta = json?.choices?.[0]?.delta?.content;
              if (typeof delta === 'string' && delta) controller.enqueue(encoder.encode(delta));
            } catch {
              // Ignore keep-alive comments / non-JSON lines.
            }
          }
        }
      } catch (err) {
        controller.enqueue(encoder.encode(`\n\n[stream error: ${(err as Error).message}]`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Brain-Sources': encodeURIComponent(JSON.stringify(sources)),
    },
  });
}
