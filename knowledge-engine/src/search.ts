/**
 * search.ts — Hybrid Search Engine
 *
 * Provides FTS5-style full-text keyword search, TF-IDF vector similarity
 * search, and hybrid RRF (Reciprocal Rank Fusion) merging.  Also supports
 * specialised searches for figures/tables and mathematical equations, and
 * related-concept discovery.
 *
 * Fuses Book-Synthesis (TF-IDF vector space) and BookBridge (FTS keyword)
 * search strategies.
 */

import type { SearchResult } from '../../shared/src/types';
import type { TextChunk } from './document-processor';

// ─── Internal Tokenizer ──────────────────────────────────────

function tokenize(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2);
}

// ─── Internal TF-IDF ─────────────────────────────────────────

class SimpleTFIDF {
  private documents: Map<string, Map<string, number>> = new Map();
  private docCount = 0;

  addDocument(id: string, terms: string[]): void {
    const tf = new Map<string, number>();
    for (const term of terms) {
      tf.set(term, (tf.get(term) || 0) + 1);
    }
    const maxFreq = Math.max(...tf.values(), 1);
    for (const [term, freq] of tf) {
      tf.set(term, freq / maxFreq);
    }
    this.documents.set(id, tf);
    this.docCount++;
  }

  search(queryTerms: string[]): { id: string; score: number }[] {
    const df = new Map<string, number>();
    for (const [, tf] of this.documents) {
      for (const term of queryTerms) {
        if (tf.has(term)) df.set(term, (df.get(term) || 0) + 1);
      }
    }

    const results: { id: string; score: number }[] = [];
    for (const [id, tf] of this.documents) {
      let score = 0;
      for (const term of queryTerms) {
        const docFreq = df.get(term) || 0;
        if (docFreq === 0) continue;
        const idf = Math.log((this.docCount + 1) / (docFreq + 1)) + 1;
        score += (tf.get(term) || 0) * idf;
      }
      if (score > 0) results.push({ id, score });
    }
    return results.sort((a, b) => b.score - a.score);
  }
}

// ─── Internal Inverted Index ─────────────────────────────────

class SimpleInvertedIndex {
  private index = new Map<string, Set<string>>();

  addDocument(id: string, terms: string[]): void {
    for (const term of terms) {
      if (!this.index.has(term)) this.index.set(term, new Set());
      this.index.get(term)!.add(id);
    }
  }

  search(term: string): string[] {
    return [...(this.index.get(term.toLowerCase()) || [])];
  }

  searchMulti(terms: string[]): Map<string, number> {
    const scores = new Map<string, number>();
    for (const term of terms) {
      const docs = this.index.get(term.toLowerCase());
      if (docs) docs.forEach(id => scores.set(id, (scores.get(id) || 0) + 1));
    }
    return scores;
  }
}

// ─── Additional Types ─────────────────────────────────────────

/** Options to fine-tune a search query. */
export interface SearchOptions {
  /** Maximum number of results to return (default: 20). */
  limit?: number;
  /** Minimum relevance score threshold (0.0 – 1.0, default: 0.0). */
  minScore?: number;
  /** FTS5 keyword search weight (default: 0.5). */
  keywordWeight?: number;
  /** TF-IDF vector search weight (default: 0.5). */
  semanticWeight?: number;
  /** An RRF k-constant (default: 60). */
  rrfK?: number;
}

/** A single search hit enriched with both scores. */
export interface HybridSearchHit {
  /** The matching chunk. */
  chunk: TextChunk;
  /** FTS5 rank (lower is better). */
  ftsRank: number;
  /** TF-IDF cosine similarity (higher is better). */
  tfidfScore: number;
  /** Combined RRF score. */
  rrfScore: number;
  /** Source document title. */
  sourceTitle: string;
  /** Source document format. */
  sourceFormat: string;
}

/** Result of a specialised figure / table search. */
export interface FigureTableResult {
  /** Unique identifier. */
  id: string;
  /** Caption or label (e.g. "Figure 3.2"). */
  label: string;
  /** Surrounding text providing context. */
  context: string;
  /** Source document title. */
  sourceTitle: string;
  /** Either 'figure' or 'table'. */
  type: 'figure' | 'table';
}

/** Result of an equation search. */
export interface EquationResult {
  /** Unique identifier. */
  id: string;
  /** The equation text as found in the source. */
  equation: string;
  /** Surrounding context. */
  context: string;
  /** Source document title. */
  sourceTitle: string;
  /** Confidence that this is a genuine equation (0.0–1.0). */
  confidence: number;
}

// ─── Internal Index Types ────────────────────────────────────

interface IndexedChunk {
  chunk: TextChunk;
  docTitle: string;
  docFormat: string;
  /** Bag of words for FTS matching. */
  tokens: { term: string; positions: number[] }[];
}

// ─── Defaults ─────────────────────────────────────────────────

const DEFAULT_LIMIT = 20;
const DEFAULT_MIN_SCORE = 0;
const DEFAULT_KEYWORD_WEIGHT = 0.5;
const DEFAULT_SEMANTIC_WEIGHT = 0.5;
const DEFAULT_RRF_K = 60;

// Regex patterns for special searches.
const FIGURE_PATTERN = /\b(?:Figure|Fig\.?|Illustration|Diagram)\s*\d+(?:\.[\d]+)?\b/gi;
const TABLE_PATTERN = /\b(?:Table|Tbl\.?)\s*\d+(?:\.[\d]+)?\b/gi;
const EQUATION_PATTERN = /(?:\\[\(\[\{]|\\[\)\]\}]|\\begin\{equation\}|\\end\{equation\}|\\\(|\\\)|\\\[|\\\])/g;

// ─── SearchEngine ────────────────────────────────────────────

/**
 * In-memory hybrid search engine over chunked documents.
 *
 * Implements:
 * - FTS5-style keyword search with term-position ranking.
 * - TF-IDF vector similarity via internal SimpleTFIDF.
 * - Hybrid RRF (Reciprocal Rank Fusion) merging.
 * - Figure / table / equation specialised searches.
 * - Related concept discovery.
 *
 * Usage:
 * ```ts
 * const engine = new SearchEngine();
 * engine.indexChunks(chunkedDocs);
 * const results = engine.hybridSearch('machine learning');
 * ```
 */
export class SearchEngine {
  private indexedChunks: IndexedChunk[] = [];
  private chunkMap: Map<string, IndexedChunk> = new Map();
  private ftsIndex: SimpleInvertedIndex;
  private tfidf: SimpleTFIDF;

  constructor() {
    this.tfidf = new SimpleTFIDF();
    this.ftsIndex = new SimpleInvertedIndex();
  }

  // ── Indexing ────────────────────────────────────────────

  /**
   * Index an array of TextChunks (typically from one or more
   * `ChunkedDocument` objects) for searching.
   *
   * @param chunksByDoc  A map of document title → array of chunks.
   */
  indexChunks(chunksByDoc: Map<string, { chunks: TextChunk[]; format: string }>): void {
    for (const [docTitle, { chunks, format }] of chunksByDoc) {
      for (const chunk of chunks) {
        const tokens = this.tokenizeWithPositions(chunk.text);
        const terms = tokens.map((t) => t.term);

        const entry: IndexedChunk = {
          chunk,
          docTitle,
          docFormat: format,
          tokens,
        };

        this.indexedChunks.push(entry);
        this.chunkMap.set(chunk.id, entry);

        // Build inverted index.
        this.ftsIndex.addDocument(chunk.id, terms);

        // Feed into TF-IDF.
        this.tfidf.addDocument(chunk.id, terms);
      }
    }
  }

  /**
   * Remove all indexed data and re-index from scratch.
   */
  clear(): void {
    this.indexedChunks = [];
    this.chunkMap.clear();
    this.ftsIndex = new SimpleInvertedIndex();
    this.tfidf = new SimpleTFIDF();
  }

  // ── FTS5-style Keyword Search ───────────────────────────

  /**
   * Full-text keyword search using an in-memory FTS5-style index.
   *
   * Ranks results by term frequency × proximity bonus.
   *
   * @param query  Space-separated keywords.
   * @param limit  Maximum results.
   * @returns      Results sorted by decreasing relevance.
   */
  ftsSearch(query: string, limit = DEFAULT_LIMIT): SearchResult[] {
    const queryTerms = tokenize(query);
    if (queryTerms.length === 0) return [];

    // Use inverted index to find candidate chunks.
    const candidates = this.ftsIndex.searchMulti(queryTerms);
    if (candidates.size === 0) return [];

    // Score each candidate chunk.
    const scores = new Map<string, { chunk: IndexedChunk; score: number }>();

    for (const [chunkId, matchCount] of candidates) {
      const idx = this.chunkMap.get(chunkId);
      if (!idx) continue;

      let score = matchCount;
      let matchedTerms = 0;

      for (const qt of queryTerms) {
        const idxTokens = idx.tokens.filter((t) => t.term === qt);

        if (idxTokens.length > 0) {
          matchedTerms++;

          // Proximity bonus: if multiple query terms appear close together.
          const allPositions = idxTokens.flatMap((t) => t.positions).sort((a, b) => a - b);
          for (let i = 1; i < allPositions.length; i++) {
            const gap = allPositions[i] - allPositions[i - 1];
            if (gap <= 5) {
              score += 0.1;
            }
          }
        }
      }

      // Bonus for matching all query terms.
      if (matchedTerms === queryTerms.length && queryTerms.length > 1) {
        score *= 1.5;
      }

      if (score > 0) {
        scores.set(idx.chunk.id, { chunk: idx, score });
      }
    }

    return [...scores.entries()]
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, limit)
      .map(([_, { chunk, score }]) => ({
        bookId: chunk.chunk.id,
        title: chunk.docTitle,
        chunk: chunk.chunk.text,
        relevance: Math.min(1, score / 10),
        pageRange: [chunk.chunk.startPos, chunk.chunk.endPos] as [number, number],
      }));
  }

  // ── TF-IDF Vector Similarity Search ─────────────────────

  /**
   * Semantic similarity search using TF-IDF vector cosine distance.
   *
   * @param query  Natural-language query string.
   * @param limit  Maximum results.
   * @returns      Results sorted by decreasing cosine similarity.
   */
  tfidfSearch(query: string, limit = DEFAULT_LIMIT): SearchResult[] {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const sims = this.tfidf.search(queryTokens);

    return sims
      .slice(0, limit)
      .map(({ id, score }) => {
        const idx = this.chunkMap.get(id);
        if (!idx) return null;
        return {
          bookId: idx.chunk.id,
          title: idx.docTitle,
          chunk: idx.chunk.text,
          relevance: Math.min(1, score),
          pageRange: [idx.chunk.startPos, idx.chunk.endPos] as [number, number],
        };
      })
      .filter(Boolean) as SearchResult[];
  }

  // ── Hybrid RRF Fusion Search ────────────────────────────

  /**
   * Hybrid search combining FTS keyword and TF-IDF semantic results
   * via Reciprocal Rank Fusion (RRF).
   *
   * @param query   Search query string.
   * @param options Search configuration.
   * @returns       RRF-fused results sorted by combined relevance.
   */
  hybridSearch(query: string, options: SearchOptions = {}): HybridSearchHit[] {
    const limit = options.limit ?? DEFAULT_LIMIT;
    const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
    const kwWeight = options.keywordWeight ?? DEFAULT_KEYWORD_WEIGHT;
    const semWeight = options.semanticWeight ?? DEFAULT_SEMANTIC_WEIGHT;
    const rrfK = options.rrfK ?? DEFAULT_RRF_K;

    // Get ranked lists from both engines.
    const ftsResults = this.ftsSearch(query, this.indexedChunks.length);
    const tfidfResults = this.tfidfSearch(query, this.indexedChunks.length);

    // Build rank maps: chunkId → rank (1-based).
    const ftsRankMap = new Map<string, number>();
    ftsResults.forEach((r, i) => ftsRankMap.set(r.bookId, i + 1));

    const tfidfRankMap = new Map<string, number>();
    tfidfResults.forEach((r, i) => tfidfRankMap.set(r.bookId, i + 1));

    // Collect all unique chunk IDs.
    const allIds = new Set([
      ...ftsRankMap.keys(),
      ...tfidfRankMap.keys(),
    ]);

    // Compute RRF scores.
    const rrfScores: HybridSearchHit[] = [];

    for (const chunkId of allIds) {
      const ftsRank = ftsRankMap.get(chunkId);
      const tfidfRank = tfidfRankMap.get(chunkId);

      const ftsRRF = ftsRank ? kwWeight * (1 / (rrfK + ftsRank)) : 0;
      const tfidfRRF = tfidfRank ? semWeight * (1 / (rrfK + tfidfRank)) : 0;
      const combinedRRF = ftsRRF + tfidfRRF;

      if (combinedRRF < minScore) continue;

      // Find the indexed chunk.
      const idx = this.chunkMap.get(chunkId);
      if (!idx) continue;

      // Normalise the RRF score so the top result ≈ 1.0.
      rrfScores.push({
        chunk: idx.chunk,
        ftsRank: ftsRank ?? Infinity,
        tfidfScore: tfidfResults.find((r) => r.bookId === chunkId)?.relevance ?? 0,
        rrfScore: combinedRRF,
        sourceTitle: idx.docTitle,
        sourceFormat: idx.docFormat,
      });
    }

    // Sort descending by RRF score.
    rrfScores.sort((a, b) => b.rrfScore - a.rrfScore);

    // Normalise scores so the max becomes 1.0.
    const maxRRF = rrfScores.length > 0 ? rrfScores[0].rrfScore : 1;
    if (maxRRF > 0) {
      for (const hit of rrfScores) {
        hit.rrfScore = Math.min(1, hit.rrfScore / maxRRF);
      }
    }

    return rrfScores.slice(0, limit);
  }

  // ── Figure / Table Search ───────────────────────────────

  /**
   * Search for figures and tables across all indexed chunks.
   *
   * Uses regex patterns to locate common figure/table labels and
   * extracts the surrounding context.
   *
   * @param query  Optional keyword to filter results (e.g. "neural network").
   * @returns      Matched figures and tables.
   */
  searchFiguresAndTables(query?: string): FigureTableResult[] {
    const results: FigureTableResult[] = [];

    for (const idx of this.indexedChunks) {
      const text = idx.chunk.text;

      // Find figures.
      let match: RegExpExecArray | null;
      const figRe = new RegExp(FIGURE_PATTERN.source, 'gi');
      while ((match = figRe.exec(text)) !== null) {
        if (query && !text.toLowerCase().includes(query.toLowerCase())) continue;

        const contextStart = Math.max(0, match.index - 150);
        const contextEnd = Math.min(text.length, match.index + match[0].length + 200);
        const context = text.slice(contextStart, contextEnd).trim();

        results.push({
          id: `fig-${idx.chunk.id}-${results.length}`,
          label: match[0],
          context,
          sourceTitle: idx.docTitle,
          type: 'figure',
        });
      }

      // Find tables.
      const tblRe = new RegExp(TABLE_PATTERN.source, 'gi');
      while ((match = tblRe.exec(text)) !== null) {
        if (query && !text.toLowerCase().includes(query.toLowerCase())) continue;

        const contextStart = Math.max(0, match.index - 150);
        const contextEnd = Math.min(text.length, match.index + match[0].length + 200);
        const context = text.slice(contextStart, contextEnd).trim();

        results.push({
          id: `tbl-${idx.chunk.id}-${results.length}`,
          label: match[0],
          context,
          sourceTitle: idx.docTitle,
          type: 'table',
        });
      }
    }

    return results;
  }

  // ── Equation Search ─────────────────────────────────────

  /**
   * Search for mathematical equations.
   *
   * Detects LaTeX-style equation markers and extracts the equation
   * content along with surrounding context.
   *
   * @param query  Optional keyword to filter results.
   * @returns      Matched equations.
   */
  searchEquations(query?: string): EquationResult[] {
    const results: EquationResult[] = [];

    for (const idx of this.indexedChunks) {
      const text = idx.chunk.text;

      // Check for LaTeX equation markers.
      if (!EQUATION_PATTERN.test(text)) {
        // Also try to detect inline equations with simple pattern.
        // This runs on the chunk; reset state.
        EQUATION_PATTERN.lastIndex = 0;
        continue;
      }

      // Reset regex state.
      EQUATION_PATTERN.lastIndex = 0;

      let match: RegExpExecArray | null;
      while ((match = EQUATION_PATTERN.exec(text)) !== null) {
        if (query && !text.toLowerCase().includes(query.toLowerCase())) continue;

        // Extract ~200 chars around the equation marker.
        const contextStart = Math.max(0, match.index - 80);
        const contextEnd = Math.min(text.length, match.index + match[0].length + 200);
        const context = text.slice(contextStart, contextEnd).trim();

        // The equation "text" is the few words around the marker.
        const eqText = text.slice(match.index, Math.min(text.length, match.index + 100)).trim();

        results.push({
          id: `eq-${idx.chunk.id}-${results.length}`,
          equation: eqText,
          context,
          sourceTitle: idx.docTitle,
          confidence: 0.85, // High confidence for LaTeX-detected equations.
        });
      }
    }

    // Also detect plain-text equations (e.g. "y = mx + b", "E = mc²").
    for (const idx of this.indexedChunks) {
      const text = idx.chunk.text;
      const eqCandidates = this.detectPlainTextEquations(text);

      for (const eq of eqCandidates) {
        if (query && !text.toLowerCase().includes(query.toLowerCase())) continue;

        const eqIndex = text.indexOf(eq);
        const contextStart = Math.max(0, eqIndex - 80);
        const contextEnd = Math.min(text.length, eqIndex + eq.length + 80);

        results.push({
          id: `eq-plain-${idx.chunk.id}-${results.length}`,
          equation: eq,
          context: text.slice(contextStart, contextEnd).trim(),
          sourceTitle: idx.docTitle,
          confidence: 0.6, // Moderate confidence for heuristic detection.
        });
      }
    }

    return results;
  }

  // ── Related Concept Discovery ───────────────────────────

  /**
   * Discover concepts related to a given term by analysing
   * co-occurrence patterns in the TF-IDF vector space.
   *
   * @param concept  The seed concept.
   * @param topN     Number of related concepts to return (default: 10).
   * @returns        Array of { term, score } pairs.
   */
  discoverRelatedConcepts(concept: string, topN = 10): { term: string; score: number }[] {
    const lowerConcept = concept.toLowerCase();

    // Find all chunks containing the concept.
    const relevantChunks = this.indexedChunks.filter((idx) =>
      idx.tokens.some((t) => t.term === lowerConcept),
    );

    if (relevantChunks.length === 0) return [];

    // Collect co-occurring terms and their frequencies.
    const coOccurrences = new Map<string, number>();

    for (const idx of relevantChunks) {
      const uniqueTerms = new Set(idx.tokens.map((t) => t.term));
      for (const term of uniqueTerms) {
        if (term === lowerConcept || term.length < 3) continue;
        coOccurrences.set(term, (coOccurrences.get(term) ?? 0) + 1);
      }
    }

    // Score: co-occurrence count / total relevant chunks (co-occurrence probability).
    const totalRelevant = relevantChunks.length;

    return [...coOccurrences.entries()]
      .map(([term, count]) => ({
        term,
        score: count / totalRelevant,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);
  }

  // ── Private: Helpers ────────────────────────────────────

  /**
   * Tokenise text and record word positions.
   */
  private tokenizeWithPositions(text: string): { term: string; positions: number[] }[] {
    const tokens = tokenize(text);

    const termMap = new Map<string, number[]>();

    tokens.forEach((token, index) => {
      if (!termMap.has(token)) {
        termMap.set(token, []);
      }
      termMap.get(token)!.push(index);
    });

    const result: { term: string; positions: number[] }[] = [];
    for (const [term, positions] of termMap) {
      result.push({ term, positions });
    }

    return result;
  }

  /**
   * Detect simple plain-text equations heuristically.
   *
   * Looks for patterns like "x = y + z", "E = mc²", etc.
   */
  private detectPlainTextEquations(text: string): string[] {
    const equations: string[] = [];
    const lines = text.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Criteria: contains '=' and at least one math-like symbol.
      if (
        trimmed.includes('=') &&
        /[+\-*/^√∫∑∏πθαβγδελμσ]/.test(trimmed) &&
        trimmed.length > 3 &&
        trimmed.length < 200
      ) {
        equations.push(trimmed);
      }
    }

    return equations;
  }
}
