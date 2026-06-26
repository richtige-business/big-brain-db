// ============================================================
// /api/brain - Brain space and document API
//
// Visible hybrid-brain documents for the UI and agents, backed by
// the Supabase brain server layer.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import {
  ensureBrainSpace,
  getBrainDocument,
  getBrainSpaceByScope,
  listBrainDocuments,
  upsertBrainDocument,
  LOCAL_USER_ID,
  type BrainScopeType,
} from '@/lib/server/brain-db';

export const runtime = 'nodejs';

function isBrainScopeType(value: string | null): value is BrainScopeType {
  return Boolean(value && ['user', 'base', 'group', 'agent', 'council'].includes(value));
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const scopeType = searchParams.get('scopeType');
    const scopeId = searchParams.get('scopeId');
    const documentId = searchParams.get('documentId');
    const slug = searchParams.get('slug');
    const type = searchParams.get('type') || undefined;
    const search = searchParams.get('search') || undefined;

    if (documentId) {
      const document = await getBrainDocument({ userId: LOCAL_USER_ID, id: documentId });
      return NextResponse.json({ success: true, document });
    }

    if (!isBrainScopeType(scopeType) || !scopeId) {
      return NextResponse.json(
        { success: false, error: 'scopeType and scopeId are required' },
        { status: 400 }
      );
    }

    const space = await getBrainSpaceByScope({ userId: LOCAL_USER_ID, scopeType, scopeId });
    if (!space) {
      return NextResponse.json({ success: true, space: null, documents: [] });
    }

    if (slug) {
      const document = await getBrainDocument({ userId: LOCAL_USER_ID, spaceId: space.id, slug });
      return NextResponse.json({ success: true, space, document });
    }

    const documents = await listBrainDocuments({ userId: LOCAL_USER_ID, spaceId: space.id, type, search });
    return NextResponse.json({ success: true, space, documents });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: 'BRAIN_READ_FAILED',
        message: error instanceof Error ? error.message : 'Brain could not be loaded.',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const scopeType = body?.scopeType;
    const scopeId = String(body?.scopeId || '').trim();

    if (!isBrainScopeType(scopeType) || !scopeId) {
      return NextResponse.json(
        { success: false, error: 'scopeType and scopeId are required' },
        { status: 400 }
      );
    }

    const space = await ensureBrainSpace({
      userId: LOCAL_USER_ID,
      scopeType,
      scopeId,
      name: body?.spaceName || body?.name || `${scopeType}:${scopeId}`,
      description: body?.description || '',
      metadata: body?.metadata,
    });

    if (!body?.document) {
      return NextResponse.json({ success: true, space });
    }

    const document = await upsertBrainDocument({
      userId: LOCAL_USER_ID,
      spaceId: space.id,
      slug: body.document.slug || body.document.title,
      title: body.document.title || body.document.slug || 'Brain document',
      contentMarkdown: body.document.contentMarkdown || '',
      type: body.document.type || 'note',
      frontmatter: body.document.frontmatter || null,
      tags: Array.isArray(body.document.tags) ? body.document.tags : [],
      changeSummary: body.document.changeSummary || 'Document saved via API',
      actor: {
        id: body?.actor?.id || 'user:local-owner',
        name: body?.actor?.name || 'Local User',
        type: body?.actor?.type || 'user',
      },
    });

    return NextResponse.json({ success: true, space, document });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: 'BRAIN_WRITE_FAILED',
        message: error instanceof Error ? error.message : 'Brain could not be saved.',
      },
      { status: 500 }
    );
  }
}
