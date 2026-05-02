/**
 * synthesizer.ts — Knowledge Synthesis Engine
 *
 * Extracts key concepts, identifies cross-source themes, computes
 * confidence scores, generates citations (6 styles), builds reading
 * plans, and extracts flashcards from ingested documents.
 *
 * Fuses Book-Synthesis (confidence scoring, citation styles) and
 * BookBridge (reading plans, flashcards) capabilities.
 */

import type {
  BookSource,
  Citation,
  ConfidenceLevel,
  CrossSourceInsight,
  KeyConcept,
  KnowledgeSynthesis,
} from '../../shared/src/types';

// ─── Additional Types ─────────────────────────────────────────

/** Citation style identifiers supported by the engine. */
export type CitationStyle = 'APA' | 'MLA' | 'Chicago' | 'BibTeX' | 'Vancouver' | 'IEEE';

/** Metadata about a single cited work. */
export interface CitationSource {
  /** Author(s) full name(s). */
  authors: string[];
  /** Year of publication. */
  year: number;
  /** Title of the work. */
  title: string;
  /** Publisher name. */
  publisher: string;
  /** Edition string (e.g. "2nd ed."). */
  edition?: string;
  /** URL if available online. */
  url?: string;
  /** DOI identifier. */
  doi?: string;
  /** Page range for the specific reference. */
  pages?: string;
}

/** A single entry in a reading plan. */
export interface ReadingPlanEntry {
  /** Order index (1-based). */
  order: number;
  /** Source title. */
  title: string;
  /** Reason this entry is included. */
  rationale: string;
  /** Estimated reading time in minutes. */
  estimatedMinutes: number;
  /** Key chapters or sections to focus on. */
  focusAreas: string[];
  /** Prerequisite entry orders (empty for foundational). */
  prerequisites: number[];
}

/** A complete reading plan. */
export interface ReadingPlan {
  /** Human-readable title. */
  title: string;
  /** Goal of the reading plan. */
  goal: string;
  /** Ordered entries. */
  entries: ReadingPlanEntry[];
  /** Total estimated time in minutes. */
  totalEstimatedMinutes: number;
  /** When the plan was generated. */
  generatedAt: string;
}

/** A single flashcard for spaced-repetition review. */
export interface Flashcard {
  /** Unique identifier. */
  id: string;
  /** The prompt or question. */
  front: string;
  /** The answer or explanation. */
  back: string;
  /** Source document titles. */
  sources: string[];
  /** Associated key concept names. */
  tags: string[];
}

/** Options to control synthesis behaviour. */
export interface SynthesisOptions {
  /** Minimum frequency for a term to be considered a key concept. */
  minTermFrequency?: number;
  /** Maximum number of key concepts to extract. */
  maxKeyConcepts?: number;
  /** Confidence weight for book sources (0-1, default 0.7). */
  bookWeight?: number;
  /** Confidence weight for web sources (0-1, default 0.3). */
  webWeight?: number;
}

// ─── Defaults ─────────────────────────────────────────────────

const DEFAULT_MIN_TERM_FREQ = 3;
const DEFAULT_MAX_KEY_CONCEPTS = 20;
const DEFAULT_BOOK_WEIGHT = 0.7;
const DEFAULT_WEB_WEIGHT = 0.3;

const AVERAGE_READING_SPEED_CHARS_PER_MIN = 1000;

// Common English stop words filtered during concept extraction.
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'by', 'with', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'could', 'should', 'may', 'might', 'shall', 'can', 'need',
  'dare', 'ought', 'used', 'this', 'that', 'these', 'those', 'it',
  'its', 'they', 'them', 'their', 'we', 'us', 'our', 'you', 'your',
  'he', 'him', 'his', 'she', 'her', 'hers', 'i', 'me', 'my', 'mine',
  'not', 'no', 'nor', 'none', 'nothing', 'nobody', 'neither',
  'some', 'any', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'another', 'such', 'own', 'same', 'so', 'than',
  'too', 'very', 'just', 'about', 'above', 'after', 'again', 'against',
  'below', 'between', 'through', 'during', 'before', 'behind',
  'under', 'over', 'out', 'off', 'up', 'down', 'into', 'onto',
  'upon', 'along', 'around', 'among', 'across', 'beyond', 'within',
  'without', 'because', 'since', 'until', 'while', 'although',
  'though', 'if', 'else', 'then', 'when', 'where', 'why', 'how',
  'what', 'which', 'who', 'whom', 'whose', 'whether', 'here', 'there',
]);

// ─── KnowledgeSynthesizer ────────────────────────────────────

/**
 * Synthesises knowledge across multiple ingested documents.
 *
 * Usage:
 * ```ts
 * const synth = new KnowledgeSynthesizer();
 * const keyConcepts = await synth.extractKeyConcepts(docs);
 * const report = await synth.generateSynthesisReport(docs);
 * ```
 */
export class KnowledgeSynthesizer {
  // ── Key Concept Extraction ──────────────────────────────

  /**
   * Extract key concepts from a collection of documents using
   * term frequency analysis with stop-word filtering.
   *
   * @param sources  Array of ingested `BookSource` documents.
   * @param options  Configuration for extraction.
   * @returns        Ranked list of key concepts.
   */
  extractKeyConcepts(
    sources: BookSource[],
    options: SynthesisOptions = {},
  ): KeyConcept[] {
    const minFreq = options.minTermFrequency ?? DEFAULT_MIN_TERM_FREQ;
    const maxConcepts = options.maxKeyConcepts ?? DEFAULT_MAX_KEY_CONCEPTS;

    // Build term frequency map across all documents.
    const termFrequency = new Map<string, { count: number; sources: Set<string>; quotes: string[] }>();

    for (const source of sources) {
      const words = this.tokenize(source.content);

      for (const word of words) {
        if (STOP_WORDS.has(word) || word.length < 3) continue;

        if (!termFrequency.has(word)) {
          termFrequency.set(word, { count: 0, sources: new Set(), quotes: [] });
        }

        const entry = termFrequency.get(word)!;
        entry.count++;
        entry.sources.add(source.title);
      }

      // Extract a supporting quote per concept from this source.
      const sentences = source.content.split(/[.!?]+/).filter((s) => s.trim().length > 20);
      for (const [term, entry] of termFrequency) {
        if (entry.quotes.length >= 3) continue; // Limit quotes per concept.
        const matchingSentence = sentences.find((s) =>
          s.toLowerCase().includes(term.toLowerCase()),
        );
        if (matchingSentence) {
          entry.quotes.push(matchingSentence.trim());
        }
      }
    }

    // Filter by minimum frequency and sort descending.
    const sorted = [...termFrequency.entries()]
      .filter(([_, entry]) => entry.count >= minFreq)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, maxConcepts);

    return sorted.map(([name, entry]) => ({
      name,
      frequency: entry.count,
      sourceCount: entry.sources.size,
      supportingQuotes: entry.quotes.slice(0, 3),
      confidence: this.frequencyToConfidence(entry.count, sources.length),
    }));
  }

  // ── Cross-Source Theme Identification ───────────────────

  /**
   * Identify themes that appear consistently across multiple sources.
   *
   * Groups extracted key concepts by co-occurrence patterns and
   * produces `CrossSourceInsight` entries for themes that span
   * more than one document.
   *
   * @param sources  Array of ingested documents.
   * @returns        Identified cross-source themes.
   */
  identifyCrossSourceThemes(
    sources: BookSource[],
  ): CrossSourceInsight[] {
    if (sources.length < 2) {
      return [];
    }

    const keyConcepts = this.extractKeyConcepts(sources, {
      minTermFrequency: 2,
      maxKeyConcepts: 50,
    });

    // Concepts that appear in more than one source are cross-source.
    const crossSource = keyConcepts.filter((c) => c.sourceCount > 1);

    // Group related concepts into themes based on co-occurrence.
    const themes = new Map<string, { concepts: string[]; sources: Set<string>; representativeText: string }>();

    for (let i = 0; i < crossSource.length; i++) {
      const ci = crossSource[i];

      // Extract a theme name from the concept context.
      const themeKey = this.inferTheme(ci.name, crossSource, sources);

      if (!themes.has(themeKey)) {
        themes.set(themeKey, {
          concepts: [],
          sources: new Set(),
          representativeText: '',
        });
      }

      const theme = themes.get(themeKey)!;
      theme.concepts.push(ci.name);
      ci.supportingQuotes.forEach((q) => theme.sources.add(sources.find((s) =>
        ci.supportingQuotes.includes(q),
      )?.title ?? ci.name));
    }

    return [...themes.entries()].map(([theme, data]) => ({
      theme,
      sources: [...data.sources],
      representativeText: this.findRepresentativeText(theme, sources),
    }));
  }

  // ── Confidence Scoring ──────────────────────────────────

  /**
   * Calculate a composite confidence score.
   *
   * Weighted formula:
   *   confidence = (bookWeight × avgBookConfidence) + (webWeight × avgWebConfidence)
   *
   * Default weights: 70% book, 30% web.
   *
   * @param bookConfidence  Confidence from book sources (0.0 – 1.0).
   * @param webConfidence   Confidence from web sources (0.0 – 1.0).
   * @param options         Weight configuration.
   * @returns               Composite confidence score (0.0 – 1.0).
   */
  calculateConfidence(
    bookConfidence: number,
    webConfidence: number,
    options: SynthesisOptions = {},
  ): number {
    const bookWeight = options.bookWeight ?? DEFAULT_BOOK_WEIGHT;
    const webWeight = options.webWeight ?? DEFAULT_WEB_WEIGHT;

    const totalWeight = bookWeight + webWeight;
    if (totalWeight <= 0) {
      return 0;
    }

    const weighted = (bookWeight * bookConfidence + webWeight * webConfidence) / totalWeight;
    return Math.max(0, Math.min(1, weighted));
  }

  // ── Supporting Quote Extraction ─────────────────────────

  /**
   * Find sentences from the given documents that best support
   * a particular concept.
   *
   * @param concept  The concept name to search for.
   * @param sources  Documents to mine.
   * @param limit    Maximum number of quotes to return (default 5).
   * @returns        Array of supporting sentences.
   */
  extractSupportingQuotes(
    concept: string,
    sources: BookSource[],
    limit = 5,
  ): string[] {
    const quotes: string[] = [];

    const lowerConcept = concept.toLowerCase();

    for (const source of sources) {
      const sentences = source.content.split(/[.!?]+/).filter((s) => s.trim().length > 20);

      for (const sentence of sentences) {
        if (quotes.length >= limit) break;
        if (sentence.toLowerCase().includes(lowerConcept)) {
          quotes.push(sentence.trim());
        }
      }

      if (quotes.length >= limit) break;
    }

    return quotes;
  }

  // ── Synthesis Report ────────────────────────────────────

  /**
   * Generate a complete synthesis report from multiple sources.
   *
   * Combines key concept extraction, cross-source theme identification,
   * and confidence scoring into a single `KnowledgeSynthesis` object.
   *
   * @param sources  Array of ingested documents.
   * @param options  Extraction and weighting configuration.
   * @returns        A structured synthesis report.
   */
  generateSynthesisReport(
    sources: BookSource[],
    options: SynthesisOptions = {},
  ): KnowledgeSynthesis {
    const keyConcepts = this.extractKeyConcepts(sources, options);
    const crossSourceInsights = this.identifyCrossSourceThemes(sources);

    // Compute average confidence from key concepts.
    const avgConceptConfidence = keyConcepts.length > 0
      ? keyConcepts.reduce((acc, c) => {
          const val = c.confidence === 'HIGH' ? 0.9
            : c.confidence === 'MODERATE' ? 0.7
            : 0.4;
          return acc + val;
        }, 0) / keyConcepts.length
      : 0.5;

    // Compute web confidence (default 0.5 when no web sources are present).
    const bookConfidence = avgConceptConfidence;
    const webConfidence = 0.5;

    const confidence = this.calculateConfidence(bookConfidence, webConfidence, options);

    // Build a concise overview.
    const overview = this.buildOverview(sources, keyConcepts, crossSourceInsights);

    return {
      overview,
      keyConcepts,
      crossSourceInsights,
      confidence,
      sources: sources.map((s) => s.title),
    };
  }

  // ── Citation Generation (6 styles) ──────────────────────

  /**
   * Generate a formatted citation string in the requested style.
   *
   * Supports: APA 7th, MLA 9th, Chicago (notes), BibTeX, Vancouver,
   * and IEEE styles.
   *
   * @param source  Metadata of the work being cited.
   * @param style   Target citation style.
   * @returns       A `Citation` object with the formatted text.
   */
  generateCitation(source: CitationSource, style: CitationStyle): Citation {
    let text: string;

    switch (style) {
      case 'APA':
        text = this.citationAPA(source);
        break;
      case 'MLA':
        text = this.citationMLA(source);
        break;
      case 'Chicago':
        text = this.citationChicago(source);
        break;
      case 'BibTeX':
        text = this.citationBibTeX(source);
        break;
      case 'Vancouver':
        text = this.citationVancouver(source);
        break;
      case 'IEEE':
        text = this.citationIEEE(source);
        break;
      default:
        throw new Error(`Unsupported citation style: ${style as string}`);
    }

    return { style: style as Citation['style'], text };
  }

  // ── Reading Plan Generation ─────────────────────────────

  /**
   * Generate a structured reading plan based on a learning goal.
   *
   * @param sources  Available documents.
   * @param goal     Learning objective.
   * @returns        A reading plan with prioritised entries.
   */
  generateReadingPlan(sources: BookSource[], goal: string): ReadingPlan {
    const keyConcepts = this.extractKeyConcepts(sources);

    // Build an ordered reading plan by scoring each document's relevance.
    const scored = sources.map((source) => {
      const matchingConcepts = keyConcepts.filter((c) =>
        source.content.toLowerCase().includes(c.name.toLowerCase()),
      );
      const relevanceScore = matchingConcepts.reduce((acc, c) => acc + c.frequency, 0);

      return { source, relevanceScore, matchingConcepts };
    });

    // Sort by relevance (foundational/general first).
    scored.sort((a, b) => b.relevanceScore - a.relevanceScore);

    const entries: ReadingPlanEntry[] = scored.map((item, idx) => {
      const wordCount = item.source.content.split(/\s+/).length;
      const estimatedMinutes = Math.max(1, Math.round(wordCount / AVERAGE_READING_SPEED_CHARS_PER_MIN));

      return {
        order: idx + 1,
        title: item.source.title,
        rationale: `Covers ${item.matchingConcepts.length} key concepts including: ${
          item.matchingConcepts.slice(0, 5).map((c) => c.name).join(', ')
        }`,
        estimatedMinutes,
        focusAreas: item.matchingConcepts.slice(0, 5).map((c) => c.name),
        prerequisites: idx > 0 ? [idx] : [],
      };
    });

    const totalEstimatedMinutes = entries.reduce((acc, e) => acc + e.estimatedMinutes, 0);

    return {
      title: `Reading Plan: ${goal}`,
      goal,
      entries,
      totalEstimatedMinutes,
      generatedAt: new Date().toISOString(),
    };
  }

  // ── Flashcard Extraction ────────────────────────────────

  /**
   * Extract flashcards from a set of documents.
   *
   * For each key concept that appears with a supporting quote,
   * generates a "front → back" flashcard suitable for spaced
   * repetition systems (e.g. Anki).
   *
   * @param sources  Documents to process.
   * @param limit    Maximum number of cards to generate (default 50).
   * @returns        Array of flashcards.
   */
  extractFlashcards(sources: BookSource[], limit = 50): Flashcard[] {
    const keyConcepts = this.extractKeyConcepts(sources);
    const flashcards: Flashcard[] = [];

    for (const concept of keyConcepts) {
      if (flashcards.length >= limit) break;

      // Create a "definition" card.
      if (concept.supportingQuotes.length > 0) {
        flashcards.push({
          id: `fc-${concept.name.toLowerCase().replace(/\s+/g, '-')}-def`,
          front: `What is "${concept.name}"?`,
          back: concept.supportingQuotes[0],
          sources: concept.supportingQuotes.map((_, i) =>
            sources[i]?.title ?? 'Unknown',
          ).filter((t, i, a) => a.indexOf(t) === i),
          tags: [concept.name, 'definition'],
        });
      }

      // Create a "fill-in-the-blank" card using a supporting quote.
      if (concept.supportingQuotes.length > 1) {
        const quote = concept.supportingQuotes[1];
        const blanked = quote.replace(
          new RegExp(concept.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
          '______',
        );

        flashcards.push({
          id: `fc-${concept.name.toLowerCase().replace(/\s+/g, '-')}-fill`,
          front: `Complete: ${blanked}`,
          back: quote,
          sources: [sources[0]?.title ?? 'Unknown'],
          tags: [concept.name, 'fill-blank'],
        });
      }
    }

    return flashcards.slice(0, limit);
  }

  // ── Private: Citation Formatters ─────────────────────────

  private formatAuthors(authors: string[]): string {
    if (authors.length === 0) return 'Anonymous';
    if (authors.length === 1) return authors[0];
    if (authors.length === 2) return `${authors[0]} & ${authors[1]}`;
    return `${authors[0]} et al.`;
  }

  private formatAuthorsFull(authors: string[]): string {
    if (authors.length === 0) return 'Anonymous';
    return authors.join(', ');
  }

  private citationAPA(source: CitationSource): string {
    const authors = source.authors.length > 0
      ? `${source.authors.join(', ')}`
      : 'Anonymous';
    const year = source.year || 'n.d.';
    const title = source.title;
    const publisher = source.publisher;
    const doi = source.doi ? ` https://doi.org/${source.doi}` : '';
    const url = source.url && !source.doi ? ` Retrieved from ${source.url}` : '';

    return `${authors} (${year}). *${title}*. ${publisher}.${doi}${url}`;
  }

  private citationMLA(source: CitationSource): string {
    const authors = this.formatAuthorsFull(source.authors);
    const title = source.title;
    const publisher = source.publisher;
    const year = source.year || 'n.d.';
    const url = source.url ? ` ${source.url}` : '';

    return `${authors}. *${title}*. ${publisher}, ${year}.${url}`;
  }

  private citationChicago(source: CitationSource): string {
    const authors = this.formatAuthorsFull(source.authors);
    const title = source.title;
    const publisher = source.publisher;
    const year = source.year || 'n.d.';
    const url = source.url ? ` URL: ${source.url}.` : '';

    return `${authors}. *${title}*. ${publisher}, ${year}.${url}`;
  }

  private citationBibTeX(source: CitationSource): string {
    const key = source.authors.length > 0
      ? `${source.authors[0].split(' ').pop()?.toLowerCase() ?? 'ref'}${source.year}`
      : `ref${source.year}`;

    const authorField = source.authors.length > 0
      ? `  author    = {${source.authors.join(' and ')}},`
      : '';

    return `@book{${key},
${authorField}
  title     = {${source.title}},
  publisher = {${source.publisher}},
  year      = {${source.year}},${source.edition ? `\n  edition   = {${source.edition}},` : ''}
${source.url ? `  url       = {${source.url}},` : ''}
${source.doi ? `  doi       = {${source.doi}},` : ''}
}`;
  }

  private citationVancouver(source: CitationSource): string {
    const authors = source.authors.length > 0
      ? `${source.authors.join(', ')}. `
      : '';
    const title = source.title;
    const publisher = source.publisher;
    const year = source.year || 'n.d.';
    const pages = source.pages ? ` p. ${source.pages}.` : '.';

    return `${authors}${title}. ${publisher}; ${year}${pages}`;
  }

  private citationIEEE(source: CitationSource): string {
    const authors = source.authors.length > 0
      ? `${source.authors.join(', ')}, `
      : '';
    const title = source.title;
    const publisher = source.publisher;
    const year = source.year || 'n.d.';
    const pages = source.pages ? ` pp. ${source.pages}.` : '.';

    return `${authors}"${title}," ${publisher}, ${year}${pages}`;
  }

  // ── Private: Utility ────────────────────────────────────

  /**
   * Tokenise text: lower-case, strip punctuation, return word array.
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s'-]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 0);
  }

  /**
   * Map a raw frequency count to a `ConfidenceLevel`.
   */
  private frequencyToConfidence(frequency: number, sourceCount: number): ConfidenceLevel {
    const maxPossible = sourceCount * 10; // arbitrary scaling
    const ratio = Math.min(1, frequency / Math.max(1, maxPossible));

    if (ratio >= 0.8) return 'HIGH';
    if (ratio >= 0.6) return 'MODERATE';
    return 'LOW';
  }

  /**
   * Attempt to infer a broader theme name from a concept.
   */
  private inferTheme(
    concept: string,
    _allConcepts: KeyConcept[],
    sources: BookSource[],
  ): string {
    // Use the first source's title as a theme hint, or the concept itself.
    for (const source of sources) {
      const titleWords = source.title.toLowerCase().split(/\s+/);
      if (titleWords.some((w) => concept.toLowerCase().includes(w))) {
        return source.title;
      }
    }

    // Fall back to the concept's first two words as theme.
    const parts = concept.split(/\s+/);
    return parts.slice(0, Math.min(2, parts.length)).join(' ');
  }

  /**
   * Find a single representative sentence for a given theme.
   */
  private findRepresentativeText(theme: string, sources: BookSource[]): string {
    const lowerTheme = theme.toLowerCase();

    for (const source of sources) {
      const sentences = source.content.split(/[.!?]+/).filter((s) => s.trim().length > 20);
      const match = sentences.find((s) => s.toLowerCase().includes(lowerTheme));
      if (match) return match.trim();
    }

    return `Discussed in the context of "${theme}".`;
  }

  /**
   * Build a concise overview paragraph from extracted concepts and insights.
   */
  private buildOverview(
    sources: BookSource[],
    keyConcepts: KeyConcept[],
    crossSourceInsights: CrossSourceInsight[],
  ): string {
    const sourceCount = sources.length;
    const conceptSummary = keyConcepts.slice(0, 5).map((c) => c.name).join(', ');

    let overview = `Synthesis of ${sourceCount} source${sourceCount > 1 ? 's' : ''}. `;
    overview += `Key concepts identified: ${conceptSummary}${keyConcepts.length > 5 ? `, and ${keyConcepts.length - 5} more.` : '.'} `;

    if (crossSourceInsights.length > 0) {
      overview += `Cross-source themes: ${crossSourceInsights.slice(0, 3).map((i) => i.theme).join(', ')}.`;
    }

    return overview;
  }
}
