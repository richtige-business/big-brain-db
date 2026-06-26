// ============================================================
// /api/brain/[documentId] - Single brain document
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getBrainDocument, upsertBrainDocument, LOCAL_USER_ID } from '@/lib/server/brain-db';

export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ documentId: string }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { documentId } = await context.params;
    const document = await getBrainDocument({ userId: LOCAL_USER_ID, id: documentId });

    if (!document) {
      return NextResponse.json({ success: false, error: 'BRAIN_DOCUMENT_NOT_FOUND' }, { status: 404 });
    }

    return NextResponse.json({ success: true, document });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: 'BRAIN_DOCUMENT_READ_FAILED',
        message: error instanceof Error ? error.message : 'Brain document could not be loaded.',
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { documentId } = await context.params;
    const existing = await getBrainDocument({ userId: LOCAL_USER_ID, id: documentId });

    if (!existing) {
      return NextResponse.json({ success: false, error: 'BRAIN_DOCUMENT_NOT_FOUND' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const document = await upsertBrainDocument({
      userId: LOCAL_USER_ID,
      spaceId: existing.spaceId,
      slug: body?.slug || existing.slug,
      title: body?.title || existing.title,
      contentMarkdown: body?.contentMarkdown ?? existing.contentMarkdown,
      type: body?.type || existing.type,
      frontmatter: body?.frontmatter ?? existing.frontmatter,
      tags: Array.isArray(body?.tags) ? body.tags : existing.tags,
      sourceId: existing.sourceId,
      changeSummary: body?.changeSummary || 'Document updated via API',
      actor: {
        id: body?.actor?.id || 'user:local-owner',
        name: body?.actor?.name || 'Local User',
        type: body?.actor?.type || 'user',
      },
    });

    return NextResponse.json({ success: true, document });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: 'BRAIN_DOCUMENT_WRITE_FAILED',
        message: error instanceof Error ? error.message : 'Brain document could not be saved.',
      },
      { status: 500 }
    );
  }
}
