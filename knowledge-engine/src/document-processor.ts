/**
 * document-processor.ts — Document Extraction & Chunking
 *
 * Handles ingestion of PDF, EPUB, DOCX, and TXT documents.
 * Extracts raw text, detects encodings, and splits content into
 * configurable overlapping chunks for downstream processing.
 *
 * Fuses Book-Synthesis (PDF/EPUB) and BookBridge (DOCX/TXT) extraction patterns.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type { BookSource } from '../../shared/src/types';

// ─── Supporting Types ─────────────────────────────────────────

/** A single text fragment produced by chunking. */
export interface TextChunk {
  /** Unique identifier for this chunk. */
  id: string;
  /** The extracted text content. */
  text: string;
  /** Character offset where this chunk begins in the source. */
  startPos: number;
  /** Character offset where this chunk ends in the source. */
  endPos: number;
  /** Optional page reference (page number or range, if available). */
  pageRef?: string;
}

/** Wraps a fully processed document together with its chunks. */
export interface ChunkedDocument {
  /** The original source metadata. */
  source: BookSource;
  /** Overlapping text chunks ready for indexing. */
  chunks: TextChunk[];
  /** Extraction metadata. */
  metadata: {
    /** Raw character count before chunking. */
    rawLength: number;
    /** Number of chunks produced. */
    chunkCount: number;
    /** Chunk size used. */
    chunkSize: number;
    /** Overlap used. */
    overlap: number;
    /** When the document was processed (ISO-8601). */
    processedAt: string;
  };
}

/** Options for the chunking algorithm. */
export interface ChunkOptions {
  /** Target chunk size in characters (default: 1000). */
  chunkSize?: number;
  /** Overlap between consecutive chunks in characters (default: 200). */
  overlap?: number;
  /** Whether to split on paragraph boundaries first (default: true). */
  splitOnParagraph?: boolean;
}

// ─── Defaults ─────────────────────────────────────────────────

const DEFAULT_CHUNK_SIZE = 1000;
const DEFAULT_OVERLAP = 200;
const ALLOWED_BOOK_DIR = process.env.BOOKS_DIRECTORY || process.cwd();
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

// ─── DocumentProcessor ────────────────────────────────────────

/**
 * Orchestrates multi-format document ingestion.
 *
 * Usage:
 * ```ts
 * const proc = new DocumentProcessor();
 * const doc = await proc.extractText('./path/to/book.pdf', 'pdf');
 * const chunked = proc.splitIntoChunks(doc, { chunkSize: 800 });
 * ```
 */
export class DocumentProcessor {
  /**
   * Extract the full text content from a file.
   *
   * @param filePath  Absolute or relative path to the source file.
   * @param format    One of 'pdf' | 'epub' | 'docx' | 'txt'.
   * @returns         A `BookSource` with the extracted plain text.
   */
  async extractText(filePath: string, format: BookSource['format']): Promise<BookSource> {
    const resolvedPath = path.resolve(filePath);

    // Path traversal prevention
    if (!resolvedPath.startsWith(path.resolve(ALLOWED_BOOK_DIR))) {
      throw new Error(`Path traversal detected: "${filePath}" is outside the allowed books directory`);
    }

    // File size limit
    const fileStat = fs.statSync(resolvedPath);
    if (fileStat.size > MAX_FILE_SIZE) {
      throw new Error(`File too large: ${fileStat.size} bytes exceeds maximum ${MAX_FILE_SIZE} bytes`);
    }

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`File not found: ${resolvedPath}`);
    }

    const title = path.basename(resolvedPath, path.extname(resolvedPath));

    let content: string;

    switch (format) {
      case 'pdf':
        content = await this.extractPdf(resolvedPath);
        break;
      case 'epub':
        content = await this.extractEpub(resolvedPath);
        break;
      case 'docx':
        content = await this.extractDocx(resolvedPath);
        break;
      case 'txt':
        content = await this.extractTxt(resolvedPath);
        break;
      default:
        throw new Error(`Unsupported format: ${format}`);
    }

    return {
      path: resolvedPath,
      title,
      format,
      content,
    };
  }

  /**
   * Split a BookSource's text into overlapping chunks.
   *
   * @param source   The ingested document.
   * @param options  Chunking configuration.
   * @returns        A `ChunkedDocument` containing the chunks.
   */
  splitIntoChunks(source: BookSource, options: ChunkOptions = {}): ChunkedDocument {
    const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
    const overlap = options.overlap ?? DEFAULT_OVERLAP;
    const splitOnParagraph = options.splitOnParagraph ?? true;

    if (chunkSize <= 0) {
      throw new Error('chunkSize must be > 0');
    }
    if (overlap < 0 || overlap >= chunkSize) {
      throw new Error('overlap must be >= 0 and < chunkSize');
    }

    const text = source.content;
    const rawLength = text.length;

    // Split into paragraphs first if requested, then greedily fill chunks.
    let segments: string[];

    if (splitOnParagraph) {
      segments = text.split(/\n\s*\n/).filter((s) => s.trim().length > 0);
    } else {
      segments = [text];
    }

    const chunks: TextChunk[] = [];
    let current = '';
    let currentStart = 0;
    let globalPos = 0;

    for (const seg of segments) {
      if (current.length + seg.length + 1 <= chunkSize || current.length === 0) {
        // Start or continue building the current chunk.
        if (current.length === 0) {
          currentStart = globalPos;
        }
        current += (current.length > 0 ? '\n\n' : '') + seg;
        globalPos += seg.length + 2;
      } else {
        // Flush current chunk.
        chunks.push(this.makeChunk(current, currentStart));

        // Overlap: carry over the tail of the last chunk.
        const carryLen = Math.min(overlap, current.length);
        const carryText = current.slice(-carryLen);

        current = carryText + '\n\n' + seg;
        currentStart = globalPos - carryLen;
        globalPos += seg.length + 2;
      }
    }

    // Flush the final buffer.
    if (current.length > 0) {
      chunks.push(this.makeChunk(current, currentStart));
    }

    return {
      source,
      chunks,
      metadata: {
        rawLength,
        chunkCount: chunks.length,
        chunkSize,
        overlap,
        processedAt: new Date().toISOString(),
      },
    };
  }

  // ── Private helpers ──────────────────────────────────────

  private makeChunk(text: string, startPos: number): TextChunk {
    return {
      id: uuidv4(),
      text,
      startPos,
      endPos: startPos + text.length,
    };
  }

  /**
   * Extract text from a PDF using pdf-parse.
   * Falls back gracefully if no pages are found.
   */
  private async extractPdf(filePath: string): Promise<string> {
    const dataBuffer = fs.readFileSync(filePath);
    // pdf-parse is a CommonJS module; use dynamic import for ESM compatibility.
    const pdfParse = (await import('pdf-parse')).default;

    const result = await pdfParse(dataBuffer, {
      // Preserve whitespace for layout-aware extraction.
      preserveWhitespace: true,
    });

    const pages: string[] = [];
    for (let i = 0; i < result.numpages; i++) {
      // pdf-parse returns all text in `result.text`, but per-page data
      // may be accessed via `result.text` split by form feed chars.
      pages.push(result.text);
    }

    return result.text || '';
  }

  /**
   * Extract text from an EPUB archive.
   * Uses epub2 to parse the OPF manifest and read each spine item.
   */
  private async extractEpub(filePath: string): Promise<string> {
    // epub2 requires a file descriptor or path.
    const EPub = (await import('epub2')).EPub;

    return new Promise<string>((resolve, reject) => {
      const book = new EPub(filePath);

      const textParts: string[] = [];

      book.on('end', () => {
        // Collect all spine chapters.
        const chapters = book.spine?.flow ?? [];

        if (chapters.length === 0) {
          resolve('');
          return;
        }

        let completed = 0;

        for (const chapter of chapters) {
          const chapterId = chapter.id; // may be undefined
          if (!chapterId) {
            completed++;
            if (completed >= chapters.length) {
              resolve(textParts.join('\n\n').trim());
            }
            continue;
          }

          book.getChapter(chapterId, (err: Error | null, chapterText?: string) => {
            if (!err && chapterText) {
              // Strip HTML tags to get plain text.
              const plain = chapterText
                .replace(/<[^>]*>/g, ' ')
                .replace(/&[a-z]+;/gi, ' ')
                .replace(/\s+/g, ' ')
                .trim();
              if (plain.length > 0) {
                textParts.push(plain);
              }
            }

            completed++;
            if (completed >= chapters.length) {
              resolve(textParts.join('\n\n').trim());
            }
          });
        }
      });

      book.on('error', (err: Error) => reject(err));

      book.parse();
    });
  }

  /**
   * Extract text from a DOCX file using mammoth.
   */
  private async extractDocx(filePath: string): Promise<string> {
    const mammoth = await import('mammoth');

    const result = await mammoth.extractRawText({ path: filePath });

    if (result.messages && result.messages.length > 0) {
      // Log warnings (e.g. unsupported features) but continue.
      for (const msg of result.messages) {
        if (msg.type === 'warning') {
          console.warn(`[DocumentProcessor] mammoth warning: ${msg.message}`);
        }
      }
    }

    return result.value || '';
  }

  /**
   * Extract text from a plain-text file with encoding detection.
   *
   * Tries UTF-8 first, then falls back to iconv-lite for common
   * single-byte encodings (Latin-1, Windows-1252, etc.).
   */
  private async extractTxt(filePath: string): Promise<string> {
    const raw = fs.readFileSync(filePath);

    // Try UTF-8 first (Node's default).
    let text: string;
    try {
      text = raw.toString('utf8');
      // If the string contains replacement characters the encoding is likely wrong.
      if (!text.includes('\uFFFD')) {
        return text;
      }
    } catch {
      // Fall through to auto-detection.
    }

    // Automatic detection via iconv-lite.
    const iconv = await import('iconv-lite');

    // Attempt common encodings.
    const encodings = ['utf-8', 'latin1', 'windows-1252', 'iso-8859-15', 'utf-16le', 'utf-16be'];
    for (const enc of encodings) {
      if (iconv.encodingExists(enc)) {
        try {
          text = iconv.decode(raw, enc);
          // If decoding produced meaningful text, return it.
          if (text.length > 0 && !text.includes('\uFFFD')) {
            return text;
          }
        } catch {
          continue;
        }
      }
    }

    // Last resort: strip non-ASCII bytes and return as Latin-1.
    return raw.toString('latin1');
  }
}
