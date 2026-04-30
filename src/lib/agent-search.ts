import { createWikiSearchIndex, searchWiki, type WikiSearchResponse } from './search';
import type { WikiFile } from './wiki';

export function searchWikiForAgent(
  files: WikiFile[],
  query: string,
  options?: {
    limit?: number;
    neighbors?: number;
    includeChunks?: boolean;
  },
): WikiSearchResponse {
  const index = createWikiSearchIndex(files);
  const response = searchWiki(index, {
    query,
    mode: 'agent',
    limit: options?.limit ?? 10,
    includeNeighbors: options?.neighbors ?? 1,
  });

  if (options?.includeChunks === false) {
    return {
      ...response,
      hits: response.hits.map((hit) => ({ ...hit, bestChunks: [] })),
    };
  }

  return response;
}
