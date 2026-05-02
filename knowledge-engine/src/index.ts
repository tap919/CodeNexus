/**
 * index.ts — KnowledgeEngine
 *
 * Top-level entry point for the CodeNexus knowledge-engine module.
 *
 * Orchestrates:
 * - Multi-format document ingestion (PDF, EPUB, DOCX, TXT)
 * - Text chunking with configurable overlap
 * - TF-IDF embedding generation
 * - Hybrid search (FTS5 keyword + TF-IDF semantic via RRF)
 * - Multi-source synthesis with confidence scoring
 * - Citation generation (6 styles)
 * - Reading plan generation
 * - Flashcard extraction
 *
 * Fuses Book-Synthesis (PDF/EPUB ingestion, TF-IDF, citations)
 * and BookBridge (DOCX/TXT ingestion, reading plans, flashcards)
 * capabilities into a single production-grade module.
 *
 * Usage:
 * ```ts
 * import { KnowledgeEngine } from '@codenexus/knowledge-engine';
 *
 * const engine = new KnowledgeEngine();
 *
 * const doc = await engine.ingestDocument('./book.pdf', 'pdf');
 * const report = await engine.synthesize();
 * const results = await engine.search('machine learning');
 * ```
 */

import { DocumentProcessor } from './document-processor';
import { KnowledgeSynthesizer } from './synthesizer';
import { SearchEngine } from './search';
import type { ChunkedDocument, TextChunk, ChunkOptions } from './document-processor';
import type {
  CitationStyle,
  CitationSource,
  Flashcard,
  ReadingPlan,
  ReadingPlanEntry,
  SynthesisOptions,
} from './synthesizer';
import type {
  EquationResult,
  FigureTableResult,
  HybridSearchHit,
  SearchOptions,
} from './search';
import type {
  BookSource,
  Citation,
  KnowledgeSynthesis,
  SearchResult,
} from '../../shared/src/types';

// Re-export all public types for downstream consumers.
export type {
  ChunkedDocument,
  TextChunk,
  ChunkOptions,
  CitationStyle,
  CitationSource,
  Flashcard,
  ReadingPlan,
  ReadingPlanEntry,
  SynthesisOptions,
  EquationResult,
  FigureTableResult,
  HybridSearchHit,
  SearchOptions,
  BookSource,
  Citation,
  KnowledgeSynthesis,
  SearchResult,
};

// ─── Default Configuration ────────────────────────────────────

/** Global engine configuration. */
export interface KnowledgeEngineConfig {
  /** Default chunk size in characters (default: 1000). */
  chunkSize?: number;
  /** Default chunk overlap in characters (default: 200). */
  chunkOverlap?: number;
  /** Minimum confidence threshold for synthesis results (default: 0.0). */
  minConfidence?: number;
  /** Book confidence weight (default: 0.7). */
  bookWeight?: number;
  /** Web confidence weight (default: 0.3). */
  webWeight?: number;
}

const DEFAULT_CONFIG: KnowledgeEngineConfig = {
  chunkSize: 1000,
  chunkOverlap: 200,
  minConfidence: 0.0,
  bookWeight: 0.7,
  webWeight: 0.3,
};

// ─── KnowledgeEngine ──────────────────────────────────────────

/**
 * Central orchestrator for document ingestion, search, and synthesis.
 *
 * All three subsystems (`DocumentProcessor`, `KnowledgeSynthesizer`,
 * `SearchEngine`) are composed internally.  The engine maintains
 * an in-memory registry of ingested documents and their chunks.
 */
export class KnowledgeEngine {
  private config: Required<KnowledgeEngineConfig>;
  private processor: DocumentProcessor;
  private synthesizer: KnowledgeSynthesizer;
  private searchEngine: SearchEngine;

  /** All documents currently loaded into the engine. */
  private documents: BookSource[] = [];

  /** Chunked variants of ingested documents (indexed by title). */
  private chunkedDocuments: Map<string, ChunkedDocument> = new Map();

  /** Whether the search index has been populated. */
  private indexed = false;

  /**
   * @param config  Optional overrides for default engine configuration.
   */
  constructor(config: KnowledgeEngineConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config } as Required<KnowledgeEngineConfig>;
    this.processor = new DocumentProcessor();
    this.synthesizer = new KnowledgeSynthesizer();
    this.searchEngine = new SearchEngine();
  }

  // ── Document Ingestion ──────────────────────────────────

  /**
   * Ingest a single document from the file system.
   *
   * The document is extracted, chunked, and added to the in-memory
   * index so it becomes immediately searchable.
   *
   * @param filePath  Path to the source file.
   * @param format    One of 'pdf' | 'epub' | 'docx' | 'txt'.
   * @returns         The ingested `BookSource`.
   */
  async ingestDocument(filePath: string, format: BookSource['format']): Promise<BookSource> {
    const source = await this.processor.extractText(filePath, format);

    // Chunk and store.
    const chunked = this.processor.splitIntoChunks(source, {
      chunkSize: this.config.chunkSize,
      overlap: this.config.chunkOverlap,
    });

    this.documents.push(source);
    this.chunkedDocuments.set(source.title, chunked);

    // Rebuild the search index incrementally.
    this.rebuildSearchIndex();

    return source;
  }

  /**
   * Ingest multiple documents at once.
   *
   * @param entries  Array of { filePath, format } tuples.
   * @returns        Array of ingested `BookSource` objects.
   */
  async ingestDocuments(
    entries: Array<{ filePath: string; format: BookSource['format'] }>,
  ): Promise<BookSource[]> {
    const sources: BookSource[] = [];
    for (const entry of entries) {
      const source = await this.ingestDocument(entry.filePath, entry.format);
      sources.push(source);
    }
    return sources;
  }

  /**
   * Add a `BookSource` that was created programmatically (e.g. from
   * a database or network stream) without touching the file system.
   *
   * @param source  A pre-built `BookSource`.
   */
  addSource(source: BookSource): void {
    const chunked = this.processor.splitIntoChunks(source, {
      chunkSize: this.config.chunkSize,
      overlap: this.config.chunkOverlap,
    });

    this.documents.push(source);
    this.chunkedDocuments.set(source.title, chunked);
    this.rebuildSearchIndex();
  }

  /**
   * Return all currently loaded documents.
   */
  getDocuments(): BookSource[] {
    return [...this.documents];
  }

  /**
   * Remove all documents and reset the engine.
   */
  clear(): void {
    this.documents = [];
    this.chunkedDocuments.clear();
    this.searchEngine.clear();
    this.indexed = false;
  }

  // ── Synthesis ───────────────────────────────────────────

  /**
   * Generate a synthesis report across all ingested documents.
   *
   * Extracts key concepts, identifies cross-source themes, computes
   * a composite confidence score, and produces a structured report.
   *
   * @param options  Optional overrides for extraction parameters.
   * @returns        A `KnowledgeSynthesis` report.
   */
  synthesize(options?: SynthesisOptions): KnowledgeSynthesis {
    if (this.documents.length === 0) {
      return {
        overview: 'No documents have been ingested.',
        keyConcepts: [],
        crossSourceInsights: [],
        confidence: 0,
        sources: [],
      };
    }

    const mergedOptions: SynthesisOptions = {
      bookWeight: this.config.bookWeight,
      webWeight: this.config.webWeight,
      ...options,
    };

    return this.synthesizer.generateSynthesisReport(this.documents, mergedOptions);
  }

  // ── Search ──────────────────────────────────────────────

  /**
   * Perform a hybrid FTS + TF-IDF search.
   *
   * @param query    Search query string.
   * @param options  Search configuration (limit, weights, RRF k, etc.).
   * @returns        RRF-fused hybrid search hits.
   */
  search(query: string, options?: SearchOptions): HybridSearchHit[] {
    this.ensureIndexed();
    return this.searchEngine.hybridSearch(query, options);
  }

  /**
   * Full-text keyword search only.
   *
   * @param query  Search keywords.
   * @param limit  Maximum results.
   * @returns      Results sorted by keyword relevance.
   */
  ftsSearch(query: string, limit?: number): SearchResult[] {
    this.ensureIndexed();
    return this.searchEngine.ftsSearch(query, limit);
  }

  /**
   * TF-IDF vector similarity search only.
   *
   * @param query  Natural-language query.
   * @param limit  Maximum results.
   * @returns      Results sorted by cosine similarity.
   */
  tfidfSearch(query: string, limit?: number): SearchResult[] {
    this.ensureIndexed();
    return this.searchEngine.tfidfSearch(query, limit);
  }

  // ── Specialised Searches ────────────────────────────────

  /**
   * Search for figures and tables across all indexed documents.
   *
   * @param query  Optional keyword to narrow results.
   * @returns      Matched figure/table references with context.
   */
  searchFiguresAndTables(query?: string): FigureTableResult[] {
    this.ensureIndexed();
    return this.searchEngine.searchFiguresAndTables(query);
  }

  /**
   * Search for mathematical equations.
   *
   * @param query  Optional keyword to narrow results.
   * @returns      Matched equations with context.
   */
  searchEquations(query?: string): EquationResult[] {
    this.ensureIndexed();
    return this.searchEngine.searchEquations(query);
  }

  /**
   * Discover concepts related to a given term.
   *
   * @param concept  The seed concept.
   * @param topN     Maximum number of related concepts.
   * @returns        Ranked list of related terms.
   */
  discoverRelatedConcepts(concept: string, topN?: number): { term: string; score: number }[] {
    this.ensureIndexed();
    return this.searchEngine.discoverRelatedConcepts(concept, topN);
  }

  // ── Citations ───────────────────────────────────────────

  /**
   * Generate a citation string in one of six supported styles.
   *
   * @param source  Metadata for the work being cited.
   * @param style   Target citation style (APA, MLA, Chicago, BibTeX, Vancouver, IEEE).
   * @returns       A `Citation` object.
   */
  generateCitation(source: CitationSource, style: CitationStyle): Citation {
    return this.synthesizer.generateCitation(source, style);
  }

  // ── Reading Plans ───────────────────────────────────────

  /**
   * Generate a reading plan tailored to a learning goal.
   *
   * @param goal  The learning objective.
   * @returns     A structured `ReadingPlan`.
   */
  generateReadingPlan(goal: string): ReadingPlan {
    return this.synthesizer.generateReadingPlan(this.documents, goal);
  }

  // ── Flashcards ──────────────────────────────────────────

  /**
   * Extract flashcards from all ingested documents.
   *
   * @param limit  Maximum number of cards (default: 50).
   * @returns      Array of `Flashcard` objects.
   */
  extractFlashcards(limit?: number): Flashcard[] {
    return this.synthesizer.extractFlashcards(this.documents, limit);
  }

  // ── Private ─────────────────────────────────────────────

  /**
   * Rebuild the search index from all chunked documents.
   */
  private rebuildSearchIndex(): void {
    const indexMap = new Map<string, { chunks: TextChunk[]; format: string }>();

    for (const [title, chunked] of this.chunkedDocuments) {
      indexMap.set(title, {
        chunks: chunked.chunks,
        format: chunked.source.format,
      });
    }

    this.searchEngine.clear();
    this.searchEngine.indexChunks(indexMap);
    this.indexed = true;
  }

  /**
   * Ensure the search index is populated before a query.
   */
  private ensureIndexed(): void {
    if (!this.indexed && this.chunkedDocuments.size > 0) {
      this.rebuildSearchIndex();
    }
  }
}

// ─── Default Export ───────────────────────────────────────────

export default KnowledgeEngine;
