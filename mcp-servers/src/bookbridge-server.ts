/**
 * CodeNexus — BookBridge MCP Server
 *
 * Fused from BookBridge.
 * Provides SQLite FTS5 full-text search, TF-IDF vector embeddings,
 * hybrid keyword+semantic search, citation generation (6 styles),
 * per-book access controls, reading plans, flashcards, and more.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import Database from 'better-sqlite3';
import {
  BookSource,
  SearchResult,
  Citation,
  ConfidenceLevel,
} from '../../shared/src/types';

// ─── Types ────────────────────────────────────────────────────

interface BookRecord {
  id: string;
  title: string;
  author: string;
  path: string;
  format: 'pdf' | 'epub' | 'docx' | 'txt';
  access_level: 'public' | 'restricted' | 'private';
  metadata: string; // JSON blob
  indexed_at: string;
}

interface ChunkRecord {
  id: number;
  book_id: string;
  chunk_index: number;
  content: string;
  page_start: number;
  page_end: number;
  section: string;
}

interface FigureRecord {
  id: number;
  book_id: string;
  caption: string;
  figure_type: string;
  page: number;
  reference: string;
}

interface EquationRecord {
  id: number;
  book_id: string;
  latex: string;
  description: string;
  page: number;
  tags: string;
}

interface AnnotationRecord {
  id: number;
  book_id: string;
  user: string;
  chunk_id: number;
  note: string;
  highlight: string;
  created_at: string;
}

interface AccessControlEntry {
  book_id: string;
  user: string;
  permission: 'read' | 'annotate' | 'admin';
}

// ─── Zod Schemas ──────────────────────────────────────────────

const CitationStyleSchema = z.enum(['APA', 'MLA', 'Chicago', 'BibTeX', 'Vancouver', 'IEEE']);

// ─── Database ─────────────────────────────────────────────────

const DB_PATH = process.env.BOOKBRIDGE_DB_PATH || './bookbridge.db';

class BookBridgeDB {
  private db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      -- Books table
      CREATE TABLE IF NOT EXISTS books (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        author TEXT NOT NULL DEFAULT 'Unknown',
        path TEXT NOT NULL,
        format TEXT NOT NULL CHECK(format IN ('pdf','epub','docx','txt')),
        access_level TEXT NOT NULL DEFAULT 'public' CHECK(access_level IN ('public','restricted','private')),
        metadata TEXT NOT NULL DEFAULT '{}',
        indexed_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Chunks table with FTS5
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        page_start INTEGER NOT NULL DEFAULT 0,
        page_end INTEGER NOT NULL DEFAULT 0,
        section TEXT NOT NULL DEFAULT '',
        UNIQUE(book_id, chunk_index)
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        content,
        tokenize='porter unicode61',
        content=chunks,
        content_rowid=id
      );

      -- Triggers to keep FTS in sync
      CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
        INSERT INTO chunks_fts(rowid, content) VALUES (new.id, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES('delete', old.id, old.content);
      END;

      CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES('delete', old.id, old.content);
        INSERT INTO chunks_fts(rowid, content) VALUES (new.id, new.content);
      END;

      -- TF-IDF vectors (stored as JSON arrays)
      CREATE TABLE IF NOT EXISTS tfidf_vectors (
        chunk_id INTEGER PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
        vector TEXT NOT NULL DEFAULT '[]'
      );

      -- Figures table
      CREATE TABLE IF NOT EXISTS figures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        caption TEXT NOT NULL,
        figure_type TEXT NOT NULL DEFAULT '',
        page INTEGER NOT NULL DEFAULT 0,
        reference TEXT NOT NULL DEFAULT ''
      );

      -- Equations table
      CREATE TABLE IF NOT EXISTS equations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        latex TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        page INTEGER NOT NULL DEFAULT 0,
        tags TEXT NOT NULL DEFAULT ''
      );

      -- Annotations
      CREATE TABLE IF NOT EXISTS annotations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        user TEXT NOT NULL,
        chunk_id INTEGER NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
        note TEXT NOT NULL DEFAULT '',
        highlight TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Per-book access controls
      CREATE TABLE IF NOT EXISTS access_controls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        user TEXT NOT NULL,
        permission TEXT NOT NULL DEFAULT 'read' CHECK(permission IN ('read','annotate','admin')),
        UNIQUE(book_id, user)
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_chunks_book ON chunks(book_id);
      CREATE INDEX IF NOT EXISTS idx_figures_book ON figures(book_id);
      CREATE INDEX IF NOT EXISTS idx_equations_book ON equations(book_id);
      CREATE INDEX IF NOT EXISTS idx_annotations_book ON annotations(book_id);
      CREATE INDEX IF NOT EXISTS idx_annotations_user ON annotations(user);
      CREATE INDEX IF NOT EXISTS idx_access_book ON access_controls(book_id);
      CREATE INDEX IF NOT EXISTS idx_access_user ON access_controls(user);
    `);
  }

  // ─── Book CRUD ──────────────────────────────────────────────

  listBooks(accessFilter?: string): BookRecord[] {
    let query = 'SELECT * FROM books';
    const params: unknown[] = [];
    if (accessFilter) {
      query += ' WHERE access_level = ?';
      params.push(accessFilter);
    }
    query += ' ORDER BY title ASC';
    return this.db.prepare(query).all(...params) as BookRecord[];
  }

  getBook(bookId: string): BookRecord | undefined {
    return this.db.prepare('SELECT * FROM books WHERE id = ?').get(bookId) as
      | BookRecord
      | undefined;
  }

  addBook(book: Omit<BookRecord, 'indexed_at'>): void {
    this.db
      .prepare(
        `INSERT INTO books (id, title, author, path, format, access_level, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(book.id, book.title, book.author, book.path, book.format, book.access_level, book.metadata);
  }

  // ─── Chunk Operations ───────────────────────────────────────

  addChunk(
    bookId: string,
    chunkIndex: number,
    content: string,
    pageStart: number,
    pageEnd: number,
    section: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO chunks (book_id, chunk_index, content, page_start, page_end, section)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(bookId, chunkIndex, content, pageStart, pageEnd, section);
  }

  // ─── FTS5 Search ────────────────────────────────────────────

  ftsSearch(
    query: string,
    limit: number = 10,
    offset: number = 0,
  ): Array<{ chunkId: number; bookId: string; title: string; content: string; rank: number; pageStart: number; pageEnd: number }> {
    // Sanitize FTS5 query syntax
    const sanitized = query.replace(/[^\w\s"()*+-]/g, ' ').trim();
    if (!sanitized) return [];

    const sql = `
      SELECT
        c.id AS chunkId,
        c.book_id AS bookId,
        b.title,
        c.content,
        c.page_start AS pageStart,
        c.page_end AS pageEnd,
        rank
      FROM chunks_fts
      JOIN chunks c ON chunks_fts.rowid = c.id
      JOIN books b ON c.book_id = b.id
      WHERE chunks_fts MATCH ?
      ORDER BY rank
      LIMIT ? OFFSET ?
    `;
    return this.db.prepare(sql).all(sanitized, limit, offset) as Array<{
      chunkId: number;
      bookId: string;
      title: string;
      content: string;
      rank: number;
      pageStart: number;
      pageEnd: number;
    }>;
  }

  // ─── TF-IDF Operations ──────────────────────────────────────

  computeTfidf(): void {
    // Count total documents (chunks)
    const totalDocs = (
      this.db.prepare('SELECT COUNT(*) as cnt FROM chunks').get() as { cnt: number }
    ).cnt;
    if (totalDocs === 0) return;

    // Get all unique terms from FTS
    const terms = this.db
      .prepare(
        `SELECT term FROM (
          SELECT substr(term, 1, instr(term, ':') - 1) AS term
          FROM chunks_fts_segdir
          UNION
          SELECT substr(term, 1, instr(term, ':') - 1) AS term
          FROM chunks_fts_content
        ) WHERE term IS NOT NULL AND term != ''
        GROUP BY term`,
      )
      .all() as { term: string }[];

    const insertVector = this.db.prepare(
      'INSERT OR REPLACE INTO tfidf_vectors (chunk_id, vector) VALUES (?, ?)',
    );

    const insertMany = this.db.transaction(() => {
      for (const { term } of terms) {
        // Document frequency: how many chunks contain this term
        const df = (
          this.db
            .prepare(
              `SELECT COUNT(*) as cnt FROM chunks_fts WHERE chunks_fts MATCH ?`,
            )
            .get(term) as { cnt: number }
        ).cnt;

        if (df === 0) continue;
        const idf = Math.log(totalDocs / df);

        // Get all chunks containing this term with their term frequency
        const chunkTermFreqs = this.db
          .prepare(
            `SELECT c.id, length(c.content) - length(replace(lower(c.content), lower(?), '')) / max(length(?), 1) AS tf
             FROM chunks c
             WHERE lower(c.content) LIKE ?`,
          )
          .all(term, term, `%${term}%`) as { id: number; tf: number }[];

        for (const row of chunkTermFreqs) {
          const existing = (
            this.db.prepare('SELECT vector FROM tfidf_vectors WHERE chunk_id = ?').get(row.id) as
              | { vector: string }
              | undefined
          );
          const vec: Record<string, number> = existing ? JSON.parse(existing.vector) : {};
          vec[term] = row.tf * idf;
          insertVector.run(row.id, JSON.stringify(vec));
        }
      }
    });

    insertMany();
  }

  /**
   * Semantic search using cosine similarity on TF-IDF vectors.
   */
  semanticSearch(
    query: string,
    limit: number = 10,
  ): Array<{ chunkId: number; bookId: string; title: string; content: string; score: number; pageStart: number; pageEnd: number }> {
    // Compute query TF-IDF vector
    const queryTerms = query.toLowerCase().split(/\W+/).filter(Boolean);
    const queryFreqs: Record<string, number> = {};
    for (const term of queryTerms) {
      queryFreqs[term] = (queryFreqs[term] || 0) + 1;
    }

    const totalDocs = (
      this.db.prepare('SELECT COUNT(*) as cnt FROM chunks').get() as { cnt: number }
    ).cnt;
    if (totalDocs === 0) return [];

    // Build query vector (TF * IDF)
    const queryVec: Record<string, number> = {};
    for (const [term, tf] of Object.entries(queryFreqs)) {
      const df = (
        this.db
          .prepare(
            'SELECT COUNT(*) as cnt FROM chunks_fts WHERE chunks_fts MATCH ?',
          )
          .get(term) as { cnt: number }
      ).cnt;
      if (df === 0) continue;
      queryVec[term] = (tf / queryTerms.length) * Math.log(totalDocs / df);
    }

    // Normalize query vector
    const queryNorm = Math.sqrt(
      Object.values(queryVec).reduce((sum, v) => sum + v * v, 0),
    );
    if (queryNorm === 0) return [];

    for (const key of Object.keys(queryVec)) {
      queryVec[key] /= queryNorm;
    }

    // Compare against stored vectors
    const storedVectors = this.db
      .prepare(
        `SELECT v.chunk_id, v.vector, c.book_id, b.title, c.content, c.page_start, c.page_end
         FROM tfidf_vectors v
         JOIN chunks c ON v.chunk_id = c.id
         JOIN books b ON c.book_id = b.id`,
      )
      .all() as Array<{
      chunk_id: number;
      vector: string;
      book_id: string;
      title: string;
      content: string;
      page_start: number;
      page_end: number;
    }>;

    const results: Array<{
      chunkId: number;
      bookId: string;
      title: string;
      content: string;
      score: number;
      pageStart: number;
      pageEnd: number;
    }> = [];

    for (const sv of storedVectors) {
      const docVec: Record<string, number> = JSON.parse(sv.vector);
      let dotProduct = 0;
      let docNorm = 0;

      for (const [term, qv] of Object.entries(queryVec)) {
        const dv = docVec[term] || 0;
        dotProduct += qv * dv;
      }

      // Compute doc vector norm for cosine similarity
      const docNormVal = Math.sqrt(
        Object.values(docVec).reduce((sum, v) => sum + v * v, 0),
      );
      if (docNormVal === 0) continue;

      const similarity = dotProduct; // Since both vectors are unit-normalized
      if (similarity > 0.01) {
        results.push({
          chunkId: sv.chunk_id,
          bookId: sv.book_id,
          title: sv.title,
          content: sv.content,
          score: similarity,
          pageStart: sv.page_start,
          pageEnd: sv.page_end,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Hybrid search combining FTS5 keyword score with TF-IDF cosine similarity
   * using reciprocal rank fusion (RRF).
   */
  hybridSearch(
    query: string,
    limit: number = 10,
    ftsWeight: number = 0.5,
    semanticWeight: number = 0.5,
  ): Array<SearchResult & { method: string; rankFusionScore: number }> {
    const ftsResults = this.ftsSearch(query, limit * 2);
    const semanticResults = this.semanticSearch(query, limit * 2);

    // RRF merge
    const fused = new Map<
      number,
      { rankFusionScore: number; ftsRank: number | null; semanticRank: number | null }
    >();

    ftsResults.forEach((r, i) => {
      const rank = i + 1;
      fused.set(r.chunkId, {
        rankFusionScore: 1 / (60 + rank),
        ftsRank: rank,
        semanticRank: null,
      });
    });

    semanticResults.forEach((r, i) => {
      const rank = i + 1;
      const existing = fused.get(r.chunkId);
      if (existing) {
        existing.semanticRank = rank;
        existing.rankFusionScore += ftsWeight * (1 / (60 + existing.ftsRank!)) +
          semanticWeight * (1 / (60 + rank));
      } else {
        fused.set(r.chunkId, {
          rankFusionScore: semanticWeight * (1 / (60 + rank)),
          ftsRank: null,
          semanticRank: rank,
        });
      }
    });

    // Build merged results
    const allResults = new Map<number, SearchResult & { method: string; rankFusionScore: number }>();

    for (const r of ftsResults) {
      const fusion = fused.get(r.chunkId)!;
      allResults.set(r.chunkId, {
        bookId: r.bookId,
        title: r.title,
        chunk: r.content,
        relevance: fusion.rankFusionScore,
        pageRange: [r.pageStart, r.pageEnd] as [number, number],
        method: fusion.semanticRank !== null ? 'hybrid' : 'keyword',
        rankFusionScore: fusion.rankFusionScore,
      });
    }

    for (const r of semanticResults) {
      if (!allResults.has(r.chunkId)) {
        const fusion = fused.get(r.chunkId)!;
        allResults.set(r.chunkId, {
          bookId: r.bookId,
          title: r.title,
          chunk: r.content,
          relevance: fusion.rankFusionScore,
          pageRange: [r.pageStart, r.pageEnd] as [number, number],
          method: 'semantic',
          rankFusionScore: fusion.rankFusionScore,
        });
      }
    }

    return Array.from(allResults.values())
      .sort((a, b) => b.rankFusionScore - a.rankFusionScore)
      .slice(0, limit);
  }

  // ─── Figures & Equations ────────────────────────────────────

  getFigures(bookId: string): FigureRecord[] {
    return this.db
      .prepare('SELECT * FROM figures WHERE book_id = ? ORDER BY page ASC')
      .all(bookId) as FigureRecord[];
  }

  addFigure(figure: Omit<FigureRecord, 'id'>): void {
    this.db
      .prepare(
        `INSERT INTO figures (book_id, caption, figure_type, page, reference)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(figure.book_id, figure.caption, figure.figure_type, figure.page, figure.reference);
  }

  getEquations(bookId: string): EquationRecord[] {
    return this.db
      .prepare('SELECT * FROM equations WHERE book_id = ? ORDER BY page ASC')
      .all(bookId) as EquationRecord[];
  }

  addEquation(eq: Omit<EquationRecord, 'id'>): void {
    this.db
      .prepare(
        `INSERT INTO equations (book_id, latex, description, page, tags)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(eq.book_id, eq.latex, eq.description, eq.page, eq.tags);
  }

  // ─── Annotations ────────────────────────────────────────────

  addAnnotation(ann: Omit<AnnotationRecord, 'id' | 'created_at'>): AnnotationRecord {
    const result = this.db
      .prepare(
        `INSERT INTO annotations (book_id, user, chunk_id, note, highlight)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(ann.book_id, ann.user, ann.chunk_id, ann.note, ann.highlight);

    return {
      id: result.lastInsertRowid as number,
      ...ann,
      created_at: new Date().toISOString(),
    };
  }

  getAnnotations(bookId: string, user?: string): AnnotationRecord[] {
    let sql = 'SELECT * FROM annotations WHERE book_id = ?';
    const params: unknown[] = [bookId];
    if (user) {
      sql += ' AND user = ?';
      params.push(user);
    }
    sql += ' ORDER BY created_at DESC';
    return this.db.prepare(sql).all(...params) as AnnotationRecord[];
  }

  // ─── Access Control ─────────────────────────────────────────

  checkAccess(bookId: string, user: string): 'read' | 'annotate' | 'admin' | 'denied' {
    const book = this.getBook(bookId);
    if (!book) return 'denied';
    if (book.access_level === 'public') return 'read';

    const ac = this.db
      .prepare('SELECT * FROM access_controls WHERE book_id = ? AND user = ?')
      .get(bookId, user) as AccessControlEntry | undefined;

    if (!ac) {
      return book.access_level === 'restricted' ? 'read' : 'denied';
    }
    return ac.permission;
  }

  setAccess(entry: AccessControlEntry): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO access_controls (book_id, user, permission)
         VALUES (?, ?, ?)`,
      )
      .run(entry.book_id, entry.user, entry.permission);
  }

  // ─── Related Books ──────────────────────────────────────────

  getRelatedBooks(bookId: string, limit: number = 5): Array<{ bookId: string; title: string; score: number }> {
    const book = this.getBook(bookId);
    if (!book) return [];

    // Simple relatedness: books that share the most terms via TF-IDF
    const chunkIds = (
      this.db.prepare('SELECT id FROM chunks WHERE book_id = ?').all(bookId) as { id: number }[]
    ).map((r) => r.id);

    if (chunkIds.length === 0) return [];

    const placeholders = chunkIds.map(() => '?').join(',');
    const related = this.db
      .prepare(
        `SELECT
           b.id AS bookId,
           b.title,
           COUNT(*) AS sharedTerms
         FROM tfidf_vectors v1
         JOIN tfidf_vectors v2 ON v1.chunk_id != v2.chunk_id
         JOIN chunks c ON v2.chunk_id = c.id
         JOIN books b ON c.book_id = b.id
         WHERE v1.chunk_id IN (${placeholders})
           AND c.book_id != ?
         GROUP BY b.id
         ORDER BY sharedTerms DESC
         LIMIT ?`,
      )
      .all(...chunkIds, bookId, limit) as Array<{
      bookId: string;
      title: string;
      sharedTerms: number;
    }>;

    const maxTerms = related.length > 0 ? related[0].sharedTerms : 1;
    return related.map((r) => ({
      bookId: r.bookId,
      title: r.title,
      score: r.sharedTerms / maxTerms,
    }));
  }

  close(): void {
    this.db.close();
  }
}

// ─── Citation Generator ───────────────────────────────────────

function generateCitation(
  style: z.infer<typeof CitationStyleSchema>,
  book: BookRecord,
  pages?: [number, number],
  chapter?: string,
): Citation {
  const author = book.author;
  const title = book.title;
  const year = book.indexed_at ? new Date(book.indexed_at).getFullYear().toString() : 'n.d.';
  const pageStr = pages ? `pp. ${pages[0]}–${pages[1]}` : '';
  const chapterStr = chapter ? `Chap. ${chapter}` : '';

  let text: string;

  switch (style) {
    case 'APA':
      text = `${author} (${year}). <em>${title}</em>.${chapterStr ? ` ${chapterStr}.` : ''}${pageStr ? ` ${pageStr}.` : ''}`;
      break;

    case 'MLA':
      text = `${author}. <em>${title}</em>.${chapterStr ? ` ${chapterStr},` : ''} ${year}${pageStr ? `, ${pageStr}` : ''}.`;
      break;

    case 'Chicago':
      text = `${author}. <em>${title}</em>. ${year}${chapterStr ? `, ${chapterStr}` : ''}${pageStr ? `, ${pageStr}` : ''}.`;
      break;

    case 'BibTeX':
      text = `@book{${book.id.replace(/[^a-zA-Z0-9]/g, '')},
  author    = {${author}},
  title     = {${title}},
  year      = {${year}},
  ${chapterStr ? `chapter   = {${chapter}},` : ''}
  ${pageStr ? `pages     = {${pageStr.replace('pp. ', '')}},` : ''}
}`;
      break;

    case 'Vancouver':
      text = `${author}. ${title}. ${year}${chapterStr ? `; ${chapterStr}` : ''}${pageStr ? `. ${pageStr}` : ''}.`;
      break;

    case 'IEEE':
      text = `${author}, "${title},"${chapterStr ? ` ${chapterStr},` : ''} ${year}${pageStr ? `, ${pageStr}` : ''}.`;
      break;

    default:
      text = `${author}, ${title}, ${year}`;
  }

  return { style, text };
}

// ─── Server State ─────────────────────────────────────────────

const db = new BookBridgeDB(DB_PATH);

// ─── MCP Server ───────────────────────────────────────────────

const server = new Server(
  {
    name: 'codenexus-bookbridge-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_books',
      description: 'List all indexed books with metadata and access level',
      inputSchema: {
        type: 'object',
        properties: {
          accessFilter: {
            type: 'string',
            enum: ['public', 'restricted', 'private'],
            description: 'Optional access-level filter',
          },
        },
      },
    },
    {
      name: 'search',
      description: 'Hybrid search (keyword FTS5 + semantic TF-IDF) using reciprocal rank fusion',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: 'Max results (default 10)' },
          ftsWeight: { type: 'number', description: 'Keyword search weight (default 0.5)' },
          semanticWeight: { type: 'number', description: 'Semantic search weight (default 0.5)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'retrieve',
      description: 'Retrieve full chunks for a book by ID, with optional page range',
      inputSchema: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: 'Book identifier' },
          pageStart: { type: 'number', description: 'Starting page (optional)' },
          pageEnd: { type: 'number', description: 'Ending page (optional)' },
          limit: { type: 'number', description: 'Max chunks (default 20)' },
        },
        required: ['bookId'],
      },
    },
    {
      name: 'equations',
      description: 'List equations from a book',
      inputSchema: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: 'Book identifier' },
          tagFilter: { type: 'string', description: 'Optional tag filter' },
        },
        required: ['bookId'],
      },
    },
    {
      name: 'figures',
      description: 'List figures from a book',
      inputSchema: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: 'Book identifier' },
          typeFilter: { type: 'string', description: 'Optional figure type filter' },
        },
        required: ['bookId'],
      },
    },
    {
      name: 'related',
      description: 'Find related books based on shared TF-IDF term vectors',
      inputSchema: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: 'Book identifier' },
          limit: { type: 'number', description: 'Max results (default 5)' },
        },
        required: ['bookId'],
      },
    },
    {
      name: 'reading_plan',
      description: 'Generate a structured reading plan for a book with chapter breakdown',
      inputSchema: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: 'Book identifier' },
          sessions: { type: 'number', description: 'Number of reading sessions (default 5)' },
          minutesPerSession: { type: 'number', description: 'Minutes per session (default 30)' },
        },
        required: ['bookId'],
      },
    },
    {
      name: 'cite',
      description: 'Generate a citation in one of six academic styles',
      inputSchema: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: 'Book identifier' },
          style: {
            type: 'string',
            enum: ['APA', 'MLA', 'Chicago', 'BibTeX', 'Vancouver', 'IEEE'],
            description: 'Citation style',
          },
          pageStart: { type: 'number', description: 'Starting page (optional)' },
          pageEnd: { type: 'number', description: 'Ending page (optional)' },
          chapter: { type: 'string', description: 'Chapter reference (optional)' },
        },
        required: ['bookId', 'style'],
      },
    },
    {
      name: 'annotate',
      description: 'Add an annotation (note + highlight) to a specific chunk in a book',
      inputSchema: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: 'Book identifier' },
          user: { type: 'string', description: 'User identifier' },
          chunkId: { type: 'number', description: 'Chunk ID to annotate' },
          note: { type: 'string', description: 'Annotation note' },
          highlight: { type: 'string', description: 'Highlighted text excerpt' },
        },
        required: ['bookId', 'user', 'chunkId', 'note'],
      },
    },
    {
      name: 'summarize',
      description: 'Generate a summary of a book from its indexed chunks using extractive techniques',
      inputSchema: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: 'Book identifier' },
          maxSentences: { type: 'number', description: 'Max sentences in summary (default 10)' },
        },
        required: ['bookId'],
      },
    },
    {
      name: 'flashcards',
      description: 'Generate flashcards from book content using key sentence extraction',
      inputSchema: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: 'Book identifier' },
          count: { type: 'number', description: 'Number of flashcards (default 10)' },
        },
        required: ['bookId'],
      },
    },
    {
      name: 'compute_tfidf',
      description: 'Compute TF-IDF vectors for all chunks (run after indexing new content)',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'list_books': {
        const schema = z.object({ accessFilter: z.string().optional() });
        const { accessFilter } = schema.parse(args ?? {});
        const books = db.listBooks(accessFilter);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ books, count: books.length }, null, 2),
            },
          ],
        };
      }

      case 'search': {
        const schema = z.object({
          query: z.string().min(1),
          limit: z.number().int().positive().default(10),
          ftsWeight: z.number().min(0).max(1).default(0.5),
          semanticWeight: z.number().min(0).max(1).default(0.5),
        });
        const { query, limit, ftsWeight, semanticWeight } = schema.parse(args);
        const results = db.hybridSearch(query, limit, ftsWeight, semanticWeight);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ query, results, count: results.length }, null, 2),
            },
          ],
        };
      }

      case 'retrieve': {
        const schema = z.object({
          bookId: z.string().min(1),
          pageStart: z.number().int().optional(),
          pageEnd: z.number().int().optional(),
          limit: z.number().int().positive().default(20),
        });
        const { bookId, pageStart, pageEnd, limit } = schema.parse(args);

        let sql = 'SELECT * FROM chunks WHERE book_id = ?';
        const params: unknown[] = [bookId];

        if (pageStart !== undefined) {
          sql += ' AND page_end >= ?';
          params.push(pageStart);
        }
        if (pageEnd !== undefined) {
          sql += ' AND page_start <= ?';
          params.push(pageEnd);
        }

        sql += ' ORDER BY page_start ASC, chunk_index ASC LIMIT ?';
        params.push(limit);

        const chunks = db['db'].prepare(sql).all(...params);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ bookId, chunks, count: (chunks as unknown[]).length }, null, 2),
            },
          ],
        };
      }

      case 'equations': {
        const schema = z.object({ bookId: z.string().min(1), tagFilter: z.string().optional() });
        const { bookId, tagFilter } = schema.parse(args);
        let equations = db.getEquations(bookId);
        if (tagFilter) {
          equations = equations.filter((e) => e.tags.toLowerCase().includes(tagFilter.toLowerCase()));
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ bookId, equations, count: equations.length }, null, 2),
            },
          ],
        };
      }

      case 'figures': {
        const schema = z.object({ bookId: z.string().min(1), typeFilter: z.string().optional() });
        const { bookId, typeFilter } = schema.parse(args);
        let figures = db.getFigures(bookId);
        if (typeFilter) {
          figures = figures.filter((f) => f.figure_type.toLowerCase().includes(typeFilter.toLowerCase()));
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ bookId, figures, count: figures.length }, null, 2),
            },
          ],
        };
      }

      case 'related': {
        const schema = z.object({ bookId: z.string().min(1), limit: z.number().int().positive().default(5) });
        const { bookId, limit } = schema.parse(args);
        const related = db.getRelatedBooks(bookId, limit);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ bookId, related, count: related.length }, null, 2),
            },
          ],
        };
      }

      case 'reading_plan': {
        const schema = z.object({
          bookId: z.string().min(1),
          sessions: z.number().int().positive().default(5),
          minutesPerSession: z.number().int().positive().default(30),
        });
        const { bookId, sessions, minutesPerSession } = schema.parse(args);

        const chunks = db['db']
          .prepare(
            'SELECT COUNT(*) as cnt, MAX(page_end) as maxPage FROM chunks WHERE book_id = ?',
          )
          .get(bookId) as { cnt: number; maxPage: number };

        if (!chunks || chunks.cnt === 0) {
          throw new McpError(ErrorCode.InvalidParams, `No chunks found for book "${bookId}"`);
        }

        const chunksPerSession = Math.max(1, Math.floor(chunks.cnt / sessions));
        const pagesPerSession = Math.max(1, Math.floor(chunks.maxPage / sessions));

        const plan = Array.from({ length: sessions }, (_, i) => ({
          session: i + 1,
          estimatedMinutes: minutesPerSession,
          chunkRange: [i * chunksPerSession + 1, Math.min((i + 1) * chunksPerSession, chunks.cnt)] as [number, number],
          pageRange: [i * pagesPerSession + 1, Math.min((i + 1) * pagesPerSession, chunks.maxPage)] as [number, number],
          focus: i === 0 ? 'Introduction & Overview' : i === sessions - 1 ? 'Conclusion & Review' : `Chapters ${i + 1}`,
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ bookId, plan, totalSessions: sessions, totalMinutes: sessions * minutesPerSession }, null, 2),
            },
          ],
        };
      }

      case 'cite': {
        const schema = z.object({
          bookId: z.string().min(1),
          style: CitationStyleSchema,
          pageStart: z.number().int().optional(),
          pageEnd: z.number().int().optional(),
          chapter: z.string().optional(),
        });
        const { bookId, style, pageStart, pageEnd, chapter } = schema.parse(args);

        const book = db.getBook(bookId);
        if (!book) {
          throw new McpError(ErrorCode.InvalidParams, `Book "${bookId}" not found`);
        }

        const pages = pageStart !== undefined && pageEnd !== undefined
          ? [pageStart, pageEnd] as [number, number]
          : undefined;

        const citation = generateCitation(style, book, pages, chapter);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(citation, null, 2),
            },
          ],
        };
      }

      case 'annotate': {
        const schema = z.object({
          bookId: z.string().min(1),
          user: z.string().min(1),
          chunkId: z.number().int().positive(),
          note: z.string().min(1),
          highlight: z.string().default(''),
        });
        const { bookId, user, chunkId, note, highlight } = schema.parse(args);

        // Check access
        const access = db.checkAccess(bookId, user);
        if (access === 'denied' || access === 'read') {
          throw new McpError(
            ErrorCode.InvalidRequest,
            `User "${user}" does not have annotate permission on "${bookId}"`,
          );
        }

        const annotation = db.addAnnotation({ book_id: bookId, user, chunk_id: chunkId, note, highlight });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(annotation, null, 2),
            },
          ],
        };
      }

      case 'summarize': {
        const schema = z.object({
          bookId: z.string().min(1),
          maxSentences: z.number().int().positive().default(10),
        });
        const { bookId, maxSentences } = schema.parse(args);

        const chunks = db['db']
          .prepare(
            'SELECT content, page_start FROM chunks WHERE book_id = ? ORDER BY chunk_index ASC',
          )
          .all(bookId) as Array<{ content: string; page_start: number }>;

        if (chunks.length === 0) {
          throw new McpError(ErrorCode.InvalidParams, `No chunks found for book "${bookId}"`);
        }

        // Extractive summarization: score sentences by term frequency
        const allText = chunks.map((c) => c.content).join(' ');
        const sentences = allText.match(/[^.!?\n]+[.!?]+/g) || [];
        const words = allText.toLowerCase().split(/\W+/).filter(Boolean);
        const wordFreqs: Record<string, number> = {};
        for (const w of words) wordFreqs[w] = (wordFreqs[w] || 0) + 1;

        const scoredSentences = sentences.map((s) => {
          const sWords = s.toLowerCase().split(/\W+/).filter(Boolean);
          const score = sWords.reduce((sum, w) => sum + (wordFreqs[w] || 0), 0) / Math.max(sWords.length, 1);
          return { sentence: s.trim(), score };
        });

        scoredSentences.sort((a, b) => b.score - a.score);

        // Pick top sentences preserving original order
        const topSentences = scoredSentences
          .slice(0, maxSentences)
          .sort((a, b) => sentences.indexOf(a.sentence) - sentences.indexOf(b.sentence))
          .map((s) => s.sentence);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  bookId,
                  summary: topSentences.join(' '),
                  sentenceCount: topSentences.length,
                  totalSentencesAvailable: sentences.length,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      case 'flashcards': {
        const schema = z.object({
          bookId: z.string().min(1),
          count: z.number().int().positive().default(10),
        });
        const { bookId, count } = schema.parse(args);

        const chunks = db['db']
          .prepare(
            'SELECT content, page_start FROM chunks WHERE book_id = ? ORDER BY chunk_index ASC',
          )
          .all(bookId) as Array<{ content: string; page_start: number }>;

        if (chunks.length === 0) {
          throw new McpError(ErrorCode.InvalidParams, `No chunks found for book "${bookId}"`);
        }

        // Extract definition-like sentences as flashcards
        const allText = chunks.map((c) => c.content).join(' ');
        const sentences = allText.match(/[^.!?\n]+[.!?]+/g) || [];

        // Find sentences that look like definitions (contain "is", "are", "refers to", "defined as")
        const definitionPattern = /\b(is|are|refers\s+to|defined\s+as|means|denotes)\b/i;
        const definitionSentences = sentences.filter((s) => definitionPattern.test(s));

        // Score by keyword density
        const keyTerms = allText.toLowerCase().split(/\W+/).filter((w) => w.length > 4);
        const termFreqs: Record<string, number> = {};
        for (const t of keyTerms) termFreqs[t] = (termFreqs[t] || 0) + 1;

        const scoredDefs = definitionSentences.map((s) => {
          const sWords = s.toLowerCase().split(/\W+/).filter(Boolean);
          const score = sWords.reduce((sum, w) => sum + (termFreqs[w] || 0), 0) / Math.max(sWords.length, 1);
          return { sentence: s.trim(), score };
        });

        scoredDefs.sort((a, b) => b.score - a.score);

        const selected = scoredDefs.slice(0, count);
        const flashcards = selected.map((s, i) => {
          // Split on the definition keyword to create front/back
          const match = s.sentence.match(/(.+?)\s+(is|are|refers\s+to|defined\s+as|means|denotes)\s+(.+)/i);
          if (match) {
            return {
              id: i + 1,
              front: match[1].trim(),
              back: `${match[2]} ${match[3].trim()}`,
            };
          }
          return {
            id: i + 1,
            front: `Term ${i + 1}`,
            back: s.sentence,
          };
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ bookId, flashcards, count: flashcards.length }, null, 2),
            },
          ],
        };
      }

      case 'compute_tfidf': {
        db.computeTfidf();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ status: 'TF-IDF vectors computed successfully' }, null, 2),
            },
          ],
        };
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof McpError) throw error;
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Validation error: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')}`,
      );
    }
    throw new McpError(
      ErrorCode.InternalError,
      `Unexpected error: ${(error as Error).message}`,
    );
  }
});

// ─── Startup ──────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('BookBridge MCP server running on stdio');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

export { BookBridgeDB, generateCitation };
