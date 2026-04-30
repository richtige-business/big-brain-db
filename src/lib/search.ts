import MiniSearch from 'minisearch';
import {
  buildGraph,
  buildLinkIndex,
  extractLinks,
  fileTitle,
  parseFrontmatter,
  resolveFileByLink,
  type GraphEdge,
  type Property,
  type WikiFile,
  type WikiLinkIndex,
} from './wiki';

export type QueryIntent = 'definition' | 'relation' | 'decision' | 'source' | 'task' | 'recent' | 'generic';

export interface WikiSearchDocument {
  fileId: string;
  vaultId: string;
  vaultName: string;
  path: string;
  title: string;
  content: string;
  body: string;
  properties: Property[];
  tags: string[];
  outgoingLinks: string[];
  backlinks: string[];
  chunks: WikiSearchChunk[];
  updatedAt?: string;
}

export interface WikiSearchChunk {
  id: string;
  fileId: string;
  vaultId: string;
  vaultName: string;
  path: string;
  title: string;
  headingPath: string[];
  text: string;
  startLine: number;
  endLine: number;
}

export interface WikiSearchHit {
  fileId: string;
  vaultId: string;
  vaultName: string;
  path: string;
  title: string;
  score: number;
  whyMatched: string[];
  bestChunks: WikiSearchChunk[];
  properties: Property[];
  tags: string[];
  outgoingLinks: string[];
  backlinks: string[];
  neighbors: string[];
}

export interface WikiSearchQuery {
  query: string;
  mode?: 'keyword' | 'agent';
  limit?: number;
  includeNeighbors?: number;
  filters?: {
    tags?: string[];
    types?: string[];
    paths?: string[];
  };
}

export interface WikiSearchResponse {
  query: string;
  intent: QueryIntent;
  hits: WikiSearchHit[];
  graphContext: {
    nodes: string[];
    edges: Array<{ source: string; target: string }>;
  };
}

interface FileIndexRecord {
  id: string;
  vaultName: string;
  title: string;
  path: string;
  body: string;
  tags: string;
  properties: string;
}

interface ChunkIndexRecord {
  id: string;
  fileId: string;
  vaultName: string;
  title: string;
  headingPath: string;
  text: string;
  tags: string;
}

export interface WikiSearchIndex {
  documents: WikiSearchDocument[];
  documentsById: Map<string, WikiSearchDocument>;
  chunksById: Map<string, WikiSearchChunk>;
  fileIndex: MiniSearch<FileIndexRecord>;
  chunkIndex: MiniSearch<ChunkIndexRecord>;
  graphEdges: GraphEdge[];
  neighborMap: Map<string, Set<string>>;
}

const SCORE_WEIGHTS = {
  fullText: 0.5,
  chunk: 0.25,
  graph: 0.15,
  metadata: 0.1,
};

const MAX_CHUNK_SIZE = 1400;
const TARGET_CHUNK_SIZE = 900;

function propertyValueToString(value: unknown): string {
  if (Array.isArray(value)) return value.join(' ');
  if (value === null || value === undefined) return '';
  return String(value);
}

function getProperty(document: WikiSearchDocument, key: string): Property | undefined {
  return document.properties.find((prop) => prop.key.toLowerCase() === key.toLowerCase());
}

function getPropertyText(properties: Property[]): string {
  return properties.map((prop) => `${prop.key} ${propertyValueToString(prop.value)}`).join(' ');
}

function getTags(properties: Property[]): string[] {
  const tags = properties.find((prop) => prop.key.toLowerCase() === 'tags');
  if (!tags) return [];
  if (Array.isArray(tags.value)) return tags.value.map(String);
  if (typeof tags.value === 'string') return tags.value.split(/[,\s]+/).filter(Boolean);
  return [];
}

function getUpdatedAt(properties: Property[]): string | undefined {
  const prop = properties.find((p) => ['last_updated', 'updated', 'updated_at'].includes(p.key.toLowerCase()));
  return prop ? propertyValueToString(prop.value) || undefined : undefined;
}

function bodyStartLine(content: string): number {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') return 1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') return i + 2;
  }
  return 1;
}

function slugPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
}

function splitLongSection(params: {
  file: WikiFile;
  title: string;
  path: string;
  headingPath: string[];
  text: string;
  startLine: number;
  endLine: number;
  sectionIndex: number;
}): WikiSearchChunk[] {
  const { file, title, path, headingPath, text, startLine, endLine, sectionIndex } = params;
  if (text.length <= MAX_CHUNK_SIZE) {
    return [
      {
        id: `${file.id}::chunk:${sectionIndex}`,
        fileId: file.id,
        vaultId: file.vaultId,
        vaultName: file.vaultName,
        path,
        title,
        headingPath,
        text: text.trim(),
        startLine,
        endLine,
      },
    ];
  }

  const chunks: WikiSearchChunk[] = [];
  const lines = text.split('\n');
  let buffer: string[] = [];
  let bufferStart = startLine;
  let chunkIndex = 0;

  const flush = (lineNumber: number) => {
    const chunkText = buffer.join('\n').trim();
    if (!chunkText) return;
    chunks.push({
      id: `${file.id}::chunk:${sectionIndex}.${chunkIndex}`,
      fileId: file.id,
      vaultId: file.vaultId,
      vaultName: file.vaultName,
      path,
      title,
      headingPath,
      text: chunkText,
      startLine: bufferStart,
      endLine: lineNumber,
    });
    chunkIndex += 1;
    buffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    if (buffer.length === 0) bufferStart = startLine + i;
    buffer.push(lines[i]);
    if (buffer.join('\n').length >= TARGET_CHUNK_SIZE && lines[i].trim() === '') {
      flush(startLine + i);
    }
  }
  flush(endLine);
  return chunks;
}

export function chunkMarkdownBody(file: WikiFile, body: string): WikiSearchChunk[] {
  const title = fileTitle(file);
  const baseLine = bodyStartLine(file.content);
  const lines = body.split('\n');
  const chunks: WikiSearchChunk[] = [];
  const headingStack: string[] = [];
  let sectionLines: string[] = [];
  let sectionStartLine = baseLine;
  let sectionIndex = 0;

  const currentHeadingPath = () => (headingStack.length > 0 ? [...headingStack] : [title]);

  const flushSection = (endLine: number) => {
    const text = sectionLines.join('\n').trim();
    if (!text) return;
    chunks.push(
      ...splitLongSection({
        file,
        title,
        path: file.path,
        headingPath: currentHeadingPath(),
        text,
        startLine: sectionStartLine,
        endLine,
        sectionIndex,
      }),
    );
    sectionIndex += 1;
    sectionLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushSection(baseLine + i - 1);
      const level = heading[1].length;
      headingStack.splice(level - 1);
      headingStack[level - 1] = heading[2].trim();
      sectionStartLine = baseLine + i;
    }
    if (sectionLines.length === 0) sectionStartLine = baseLine + i;
    sectionLines.push(line);
  }
  flushSection(baseLine + lines.length - 1);

  if (chunks.length === 0 && body.trim()) {
    return [
      {
        id: `${file.id}::chunk:0`,
        fileId: file.id,
        vaultId: file.vaultId,
        vaultName: file.vaultName,
        path: file.path,
        title,
        headingPath: [title],
        text: body.trim(),
        startLine: baseLine,
        endLine: baseLine + lines.length - 1,
      },
    ];
  }
  return chunks;
}

export function buildBacklinkMap(files: WikiFile[], linkIndex = buildLinkIndex(files)): Map<string, Set<string>> {
  const backlinks = new Map<string, Set<string>>();
  for (const file of files) backlinks.set(file.id, new Set());
  for (const file of files) {
    for (const target of extractLinks(file.content)) {
      const resolved = resolveFileByLink(linkIndex, target, file);
      if (!resolved || resolved.id === file.id) continue;
      if (!backlinks.has(resolved.id)) backlinks.set(resolved.id, new Set());
      backlinks.get(resolved.id)!.add(file.id);
    }
  }
  return backlinks;
}

function buildOutgoingMap(files: WikiFile[], linkIndex: WikiLinkIndex): Map<string, Set<string>> {
  const outgoing = new Map<string, Set<string>>();
  for (const file of files) {
    const links = new Set<string>();
    for (const target of extractLinks(file.content)) {
      const resolved = resolveFileByLink(linkIndex, target, file);
      links.add(resolved?.id ?? `unresolved:${target}`);
    }
    outgoing.set(file.id, links);
  }
  return outgoing;
}

function buildNeighborMap(edges: GraphEdge[]): Map<string, Set<string>> {
  const neighbors = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!neighbors.has(edge.source)) neighbors.set(edge.source, new Set());
    if (!neighbors.has(edge.target)) neighbors.set(edge.target, new Set());
    neighbors.get(edge.source)!.add(edge.target);
    neighbors.get(edge.target)!.add(edge.source);
  }
  return neighbors;
}

export function getGraphNeighbors(
  fileId: string,
  neighborMap: Map<string, Set<string>>,
  depth = 1,
): string[] {
  const visited = new Set<string>([fileId]);
  let frontier = new Set<string>([fileId]);
  for (let i = 0; i < depth; i++) {
    const next = new Set<string>();
    for (const id of frontier) {
      for (const neighbor of neighborMap.get(id) || []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        next.add(neighbor);
      }
    }
    frontier = next;
  }
  visited.delete(fileId);
  return Array.from(visited);
}

export function buildSearchDocuments(files: WikiFile[]): WikiSearchDocument[] {
  const linkIndex = buildLinkIndex(files);
  const backlinks = buildBacklinkMap(files, linkIndex);
  const outgoing = buildOutgoingMap(files, linkIndex);
  return files.map((file) => {
    const parsed = parseFrontmatter(file.content);
    const tags = getTags(parsed.properties);
    return {
      fileId: file.id,
      vaultId: file.vaultId,
      vaultName: file.vaultName,
      path: file.path,
      title: fileTitle(file),
      content: file.content,
      body: parsed.body,
      properties: parsed.properties,
      tags,
      outgoingLinks: Array.from(outgoing.get(file.id) || []),
      backlinks: Array.from(backlinks.get(file.id) || []),
      chunks: chunkMarkdownBody(file, parsed.body),
      updatedAt: getUpdatedAt(parsed.properties),
    };
  });
}

export function detectQueryIntent(query: string): QueryIntent {
  const normalized = query.toLowerCase();
  if (/(was ist|definition|meaning|bedeutet|begriff)/.test(normalized)) return 'definition';
  if (/(hängt|haengt|related|relation|connection|depends|zusammenhang|verbindung)/.test(normalized)) return 'relation';
  if (/(warum|decision|because|entscheidung|grund)/.test(normalized)) return 'decision';
  if (/(quelle|source|evidence|beleg|herkunft)/.test(normalized)) return 'source';
  if (/(todo|task|open|offen|aufgabe)/.test(normalized)) return 'task';
  if (/(latest|recent|zuletzt|neu|last_updated|aktuell)/.test(normalized)) return 'recent';
  return 'generic';
}

export function createWikiSearchIndex(files: WikiFile[]): WikiSearchIndex {
  const documents = buildSearchDocuments(files);
  const documentsById = new Map(documents.map((doc) => [doc.fileId, doc]));
  const chunks = documents.flatMap((doc) => doc.chunks);
  const chunksById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const graph = buildGraph(files);
  const neighborMap = buildNeighborMap(graph.edges);

  const fileIndex = new MiniSearch<FileIndexRecord>({
    fields: ['vaultName', 'title', 'path', 'body', 'tags', 'properties'],
    storeFields: ['id'],
    searchOptions: {
      boost: { vaultName: 1.4, title: 3, path: 1.8, tags: 2.2, properties: 1.5, body: 1 },
      prefix: true,
      fuzzy: 0.2,
    },
  });

  const chunkIndex = new MiniSearch<ChunkIndexRecord>({
    fields: ['vaultName', 'title', 'headingPath', 'text', 'tags'],
    storeFields: ['id', 'fileId'],
    searchOptions: {
      boost: { vaultName: 1.2, title: 2, headingPath: 2.2, tags: 1.6, text: 1 },
      prefix: true,
      fuzzy: 0.2,
    },
  });

  fileIndex.addAll(
    documents.map((doc) => ({
      id: doc.fileId,
      vaultName: doc.vaultName,
      title: doc.title,
      path: doc.path,
      body: doc.body,
      tags: doc.tags.join(' '),
      properties: getPropertyText(doc.properties),
    })),
  );

  chunkIndex.addAll(
    chunks.map((chunk) => {
      const doc = documentsById.get(chunk.fileId);
      return {
        id: chunk.id,
        fileId: chunk.fileId,
        vaultName: doc?.vaultName ?? '',
        title: chunk.title,
        headingPath: chunk.headingPath.join(' '),
        text: chunk.text,
        tags: doc?.tags.join(' ') ?? '',
      };
    }),
  );

  return {
    documents,
    documentsById,
    chunksById,
    fileIndex,
    chunkIndex,
    graphEdges: graph.edges,
    neighborMap,
  };
}

function queryTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).map((term) => term.trim()).filter(Boolean);
}

function hasAllFilters(doc: WikiSearchDocument, query: WikiSearchQuery): boolean {
  const filters = query.filters;
  if (!filters) return true;
  if (filters.tags?.length && !filters.tags.every((tag) => doc.tags.includes(tag))) return false;
  if (filters.paths?.length && !filters.paths.some((path) => doc.path.startsWith(path))) return false;
  if (filters.types?.length) {
    const type = getProperty(doc, 'type');
    if (!type || !filters.types.includes(propertyValueToString(type.value))) return false;
  }
  return true;
}

function metadataScore(doc: WikiSearchDocument, terms: string[], intent: QueryIntent): number {
  const metadata = `${doc.tags.join(' ')} ${getPropertyText(doc.properties)}`.toLowerCase();
  let score = terms.reduce((sum, term) => sum + (metadata.includes(term) ? 1 : 0), 0);
  const type = propertyValueToString(getProperty(doc, 'type')?.value).toLowerCase();
  if (intent === 'definition' && ['concept', 'entity'].includes(type)) score += 1.5;
  if (intent === 'source' && (doc.path.includes('/sources/') || getProperty(doc, 'sources'))) score += 1.5;
  if (intent === 'decision' && (type.includes('decision') || doc.path.includes('/decisions/'))) score += 1.5;
  if (intent === 'task' && /(todo|task|\[ \])/.test(doc.content.toLowerCase())) score += 1;
  if (intent === 'recent' && doc.updatedAt) score += 1;
  return score;
}

function chunkTermScore(chunk: WikiSearchChunk, terms: string[]): number {
  const heading = chunk.headingPath.join(' ').toLowerCase();
  const text = chunk.text.toLowerCase();
  return terms.reduce((score, term) => {
    if (heading.includes(term)) score += 2;
    if (text.includes(term)) score += 1;
    return score;
  }, 0);
}

function normalizeScore(score: number): number {
  return Math.min(10, Math.log1p(Math.max(0, score)) * 3);
}

export function searchWiki(index: WikiSearchIndex, query: WikiSearchQuery): WikiSearchResponse {
  const rawQuery = query.query.trim();
  const intent = detectQueryIntent(rawQuery);
  if (!rawQuery) return { query: rawQuery, intent, hits: [], graphContext: { nodes: [], edges: [] } };

  const terms = queryTerms(rawQuery);
  const limit = query.limit ?? 10;
  const includeNeighbors = query.includeNeighbors ?? 1;
  const fileScores = new Map<string, { fullText: number; chunk: number; metadata: number; why: Set<string> }>();
  const chunksByFile = new Map<string, WikiSearchChunk[]>();

  const ensure = (fileId: string) => {
    if (!fileScores.has(fileId)) {
      fileScores.set(fileId, { fullText: 0, chunk: 0, metadata: 0, why: new Set() });
    }
    return fileScores.get(fileId)!;
  };

  for (const result of index.fileIndex.search(rawQuery)) {
    const score = ensure(result.id);
    score.fullText += result.score;
    score.why.add('fulltext');
  }

  for (const result of index.chunkIndex.search(rawQuery)) {
    const chunk = index.chunksById.get(result.id);
    if (!chunk) continue;
    const score = ensure(chunk.fileId);
    score.chunk += result.score + chunkTermScore(chunk, terms);
    score.why.add('chunk');
    const list = chunksByFile.get(chunk.fileId) || [];
    list.push(chunk);
    chunksByFile.set(chunk.fileId, list);
  }

  for (const doc of index.documents) {
    if (!hasAllFilters(doc, query)) continue;
    const haystacks = {
      title: doc.title.toLowerCase(),
      path: doc.path.toLowerCase(),
      tags: doc.tags.join(' ').toLowerCase(),
      properties: getPropertyText(doc.properties).toLowerCase(),
    };
    const score = ensure(doc.fileId);
    if (terms.some((term) => haystacks.title.includes(term))) {
      score.fullText += 5;
      score.why.add('title');
    }
    if (terms.some((term) => haystacks.path.includes(term))) {
      score.fullText += 2;
      score.why.add('path');
    }
    if (terms.some((term) => haystacks.tags.includes(term))) {
      score.metadata += 3;
      score.why.add('tag');
    }
    if (terms.some((term) => haystacks.properties.includes(term))) {
      score.metadata += 2;
      score.why.add('property');
    }
    const meta = metadataScore(doc, terms, intent);
    if (meta > 0) {
      score.metadata += meta;
      score.why.add('metadata');
    }
  }

  const directMatchIds = new Set(fileScores.keys());
  const hits = Array.from(fileScores.entries())
    .map(([fileId, score]) => {
      const doc = index.documentsById.get(fileId);
      if (!doc || !hasAllFilters(doc, query)) return null;
      const neighborHits = getGraphNeighbors(fileId, index.neighborMap, 1).filter((id) => directMatchIds.has(id));
      const graphScore = Math.min(6, doc.backlinks.length * 0.25 + doc.outgoingLinks.length * 0.15 + neighborHits.length * 1.5);
      if (graphScore > 0) score.why.add('graph');
      const bestChunks = (chunksByFile.get(fileId) || doc.chunks)
        .map((chunk) => ({ chunk, score: chunkTermScore(chunk, terms) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((entry) => entry.chunk);
      const total =
        normalizeScore(score.fullText) * SCORE_WEIGHTS.fullText +
        normalizeScore(score.chunk) * SCORE_WEIGHTS.chunk +
        normalizeScore(graphScore) * SCORE_WEIGHTS.graph +
        normalizeScore(score.metadata) * SCORE_WEIGHTS.metadata;

      return {
        fileId,
        vaultId: doc.vaultId,
        vaultName: doc.vaultName,
        path: doc.path,
        title: doc.title,
        score: Number(total.toFixed(4)),
        whyMatched: Array.from(score.why),
        bestChunks,
        properties: doc.properties,
        tags: doc.tags,
        outgoingLinks: doc.outgoingLinks,
        backlinks: doc.backlinks,
        neighbors: getGraphNeighbors(fileId, index.neighborMap, includeNeighbors).filter((id) => !id.startsWith('unresolved:')),
      } satisfies WikiSearchHit;
    })
    .filter((hit): hit is WikiSearchHit => hit !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const contextNodes = new Set<string>();
  for (const hit of hits) {
    contextNodes.add(hit.fileId);
    for (const neighbor of hit.neighbors) contextNodes.add(neighbor);
  }
  const graphContext = {
    nodes: Array.from(contextNodes),
    edges: index.graphEdges
      .filter((edge) => contextNodes.has(edge.source) && contextNodes.has(edge.target))
      .map((edge) => ({ source: edge.source, target: edge.target })),
  };

  return { query: rawQuery, intent, hits, graphContext };
}
