import { useCallback, useRef } from 'react';
import { createWikiSearchIndex, searchWiki, type WikiSearchIndex, type WikiSearchQuery, type WikiSearchResponse } from '@/lib/search';
import type { WikiFile } from '@/lib/wiki';

function emptySearchResponse(query: string): WikiSearchResponse {
  return { query, intent: 'generic', hits: [], graphContext: { nodes: [], edges: [] } };
}

export function useWikiSearch(files: WikiFile[]) {
  const cacheRef = useRef<{ files: WikiFile[]; index: WikiSearchIndex } | null>(null);

  return useCallback(
    (query: WikiSearchQuery) => {
      if (!query.query.trim()) return emptySearchResponse(query.query);
      if (cacheRef.current?.files !== files) {
        cacheRef.current = { files, index: createWikiSearchIndex(files) };
      }
      return searchWiki(cacheRef.current.index, query);
    },
    [files],
  );
}
