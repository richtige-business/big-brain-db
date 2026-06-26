// ============================================================
// /api/brain/import - Markdown brain import
//
// Import Big-Brain-DB / markdown vaults as visible brain documents
// into a scoped brain space.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { importBrainMarkdownFiles, LOCAL_USER_ID, type BrainImportFileInput, type BrainScopeType } from '@/lib/server/brain-db';

export const runtime = 'nodejs';

function isBrainScopeType(value: string | undefined): value is BrainScopeType {
  return Boolean(value && ['user', 'base', 'group', 'agent', 'council'].includes(value));
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const scopeType = body?.scopeType;
    const scopeId = String(body?.scopeId || '').trim();
    const files = Array.isArray(body?.files) ? body.files : [];

    if (!isBrainScopeType(scopeType) || !scopeId) {
      return NextResponse.json(
        { success: false, error: 'scopeType and scopeId are required' },
        { status: 400 }
      );
    }

    const normalizedFiles: BrainImportFileInput[] = files
      .map((file: Record<string, unknown>) => ({
        name: String(file.name || file.relativePath || 'document.md'),
        relativePath: String(file.relativePath || file.name || 'document.md'),
        contentText: String(file.contentText || ''),
        mimeType: String(file.mimeType || 'text/markdown'),
        source: String(file.source || 'brain-import'),
      }))
      .filter((file: BrainImportFileInput) => file.contentText.trim().length > 0);

    if (normalizedFiles.length === 0) {
      return NextResponse.json(
        { success: false, error: 'At least one markdown file is required' },
        { status: 400 }
      );
    }

    const result = await importBrainMarkdownFiles({
      userId: LOCAL_USER_ID,
      scopeType,
      scopeId,
      spaceName: body?.spaceName || body?.name || `${scopeType}:${scopeId}`,
      description: body?.description || '',
      files: normalizedFiles,
      actor: {
        id: body?.actor?.id || 'user:local-owner',
        name: body?.actor?.name || 'Local User',
        type: body?.actor?.type || 'user',
      },
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: 'BRAIN_IMPORT_FAILED',
        message: error instanceof Error ? error.message : 'Brain import failed.',
      },
      { status: 500 }
    );
  }
}
