/**
 * Comment Processor
 *
 * Body cleaning, meta-comment filtering, bot detection, reply chain
 * construction, and source-type classification.
 *
 * Fuses: agent-reviews sanitization, Cursor fix button stripping,
 * and CodeRabbit/Copilot/etc. meta filtering.
 */

import type {
  ReviewComment,
  CommentAuthor,
  CommentStats,
  ProcessedComments,
} from '../../shared/src/types.js';
import { CommentType } from '../../shared/src/types.js';

// ─── Known Meta-Bots ─────────────────────────────────────────

/**
 * Known bot/automation accounts whose comments are considered "meta"
 * (deployment status, coverage reports, dependency updates, etc.)
 * and can be filtered out.
 */
const META_BOT_LOGINS = new Set([
  'vercel[bot]',
  'github-actions[bot]',
  'netlify[bot]',
  'circleci[bot]',
  'cloudflare-pages[bot]',
  'railway[bot]',
  'render[bot]',
  'heroku[bot]',
  'sentry-io[bot]',
  'codecov[bot]',
  'coveralls',
  'codacy-bot',
  'codeclimate[bot]',
  'sonarcloud[bot]',
  'deepsource-autofix[bot]',
  'lgtm-com[bot]',
  'snyk-bot',
  'stackhawk[bot]',
  'goreleaser-bot',
  'release-please[bot]',
  'changeset-bot[bot]',
  'mergify[bot]',
  'kodiakhq[bot]',
  'dependabot[bot]',
  'renovate[bot]',
  'prettier-bot',
]);

/**
 * Known code-review bots whose comments contain actual review feedback
 * (as opposed to deployment/CI status).
 */
const REVIEW_BOT_LOGINS = new Set([
  'coderabbitai[bot]',
  'copilot',
  'github-copilot',
  'github-copilot[bot]',
  'sourcery-ai[bot]',
  'codacy-bot',
  'codeclimate[bot]',
  'sonarcloud[bot]',
  'deepsource-autofix[bot]',
]);

// ─── Body Cleaning Patterns ──────────────────────────────────

// HTML/XML comments: <!-- ... -->
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

// Cursor IDE fix button markers
const CURSOR_FIX_BUTTON_RE =
  /(?:\[?\s*(?:Fix|Apply|Accept|Apply this suggestion)\s*\]?)\s*(?:\n|$)/gi;

// "Additional locations..." lines from AI-generated suggestions
const ADDITIONAL_LOCATIONS_RE =
  /(?:^|\n)\s*\*?\*?Additional(?:ly,?\s*)?(?:locations?|files?|changes?|considerations?|contexts?)?\s*:?[:\-–—]?\s*\*?\*?/gi;

// Vercel deployment preview markers
const VERCEL_DEPLOY_RE =
  /---\s*\n\s*\*\*Visit Preview\*\*:.*(?:\n|$)[\s\S]*?(?:---|$\n?)/gi;

// Review bot summary footers (CodeRabbit, etc.)
const REVIEW_BOT_FOOTER_RE =
  /<details>\s*<summary>ℹ\s*(?:Tips|Notes|Additional context).*?<\/details>/gis;

// Supabase inline deployment comments
const SUPABASE_DEPLOY_RE =
  /Supabase\s+(?:Deploy|Preview|Branch).*?(?:\n|$).*?(?:supabase\.co|app\.supabase\.com)/gi;

// ─── Filtering Rules ─────────────────────────────────────────

/** Patterns that identify meta-comments (non-review bot noise). */
const META_BODY_PATTERNS: RegExp[] = [
  // Vercel
  /\bvercel\b/i,
  /\bdeploy(?:ment)?\s+(?:preview|status)\b/i,
  /visit\s+preview/i,
  // Supabase
  /\bsupabase\s+(?:deploy|preview|branch)\b/i,
  // Coverage
  /\bcode(?:coverage|cov)\b/i,
  /\bcoverage\s+(?:report|status|threshold)\b/i,
  // CI/CD
  /\bci\s*(?:\/|vs\.?)?\s*cd\b/i,
  /\bbuild\s+(?:status|result|artifact)\b/i,
  /\btest\s+(?:run|suite|result|status)\b/i,
  // Dependencies
  /\bdependabot\b/i,
  /\brenovate\b/i,
  /\bdependency\s+(?:update|bump|upgrade)\b/i,
  // Release
  /\brelease\s+(?:please|note|artifact)\b/i,
  /\bchangelog\b/i,
  // Snyk / Security
  /\bsnyk\b/i,
  /\bsecurity\s+(?:vulnerability|advisory|scan)\b/i,
  // Linting
  /\blint(?:ing)?\s+(?:report|result|status)\b/i,
  /\beslint\b/i,
  /\bprettier\b/i,
  // Formatting-only notifications
  /^✅\s*(?:all|tests|checks|builds)\s+passed/i,
  /^❌\s*(?:some|tests|checks|builds)\s+failed/i,
  /^⚡️?\s*(?:performance|benchmark)/i,
];

// ─── Bot Detection ───────────────────────────────────────────

/** Pattern-based bot detection for usernames. */
const BOT_USERNAME_PATTERNS: RegExp[] = [
  /^[a-z]+bot$/i,
  /^bot[-_]/i,
  /[-_]bot$/i,
  /^[a-z]+-ci$/i,
  /^ci[-_][a-z]+/i,
  /^[a-z]+-service$/i,
  /^[a-z]+-automation$/i,
];

// ─── Public API ──────────────────────────────────────────────

/**
 * Options for comment processing.
 */
export interface ProcessOptions {
  /** Exclude meta-comments (deploy status, coverage, etc.) */
  excludeMeta?: boolean;
  /** Include only bot-generated comments */
  botsOnly?: boolean;
  /** Include only human-generated comments */
  humansOnly?: boolean;
  /** Include only unresolved threads */
  unresolvedOnly?: boolean;
  /** Include only unanswered threads (no human reply) */
  unansweredOnly?: boolean;
}

/**
 * Clean a comment body by stripping noise.
 */
export function cleanBody(raw: string): string {
  let cleaned = raw
    // Strip HTML comments
    .replace(HTML_COMMENT_RE, '')
    // Strip Cursor fix buttons
    .replace(CURSOR_FIX_BUTTON_RE, '')
    // Strip "Additional locations" sections
    .replace(ADDITIONAL_LOCATIONS_RE, '\n')
    // Strip Vercel deployment markers
    .replace(VERCEL_DEPLOY_RE, '')
    // Strip review bot footers
    .replace(REVIEW_BOT_FOOTER_RE, '')
    // Strip Supabase deploy links
    .replace(SUPABASE_DEPLOY_RE, '')
    // Collapse multiple blank lines
    .replace(/\n{3,}/g, '\n\n')
    // Trim leading/trailing whitespace
    .trim();

  return cleaned;
}

/**
 * Detect whether the given login is a meta-bot (one whose comments
 * are typically CI/deployment noise rather than review feedback).
 */
export function isMetaBot(login: string): boolean {
  if (META_BOT_LOGINS.has(login)) return true;
  // Prefixed or suffixed with bot marker
  for (const pattern of BOT_USERNAME_PATTERNS) {
    if (pattern.test(login)) return true;
  }
  return false;
}

/**
 * Detect whether the given login is a review bot (one whose comments
 * contain actual code review feedback we want to process).
 */
export function isReviewBot(login: string): boolean {
  return REVIEW_BOT_LOGINS.has(login);
}

/**
 * Determine if a comment body is "meta" (non-review noise).
 */
export function isMetaBody(body: string): boolean {
  for (const pattern of META_BODY_PATTERNS) {
    if (pattern.test(body)) return true;
  }
  return false;
}

/**
 * Determine if a comment body appears to be a review bot's automated review.
 */
export function isBotReviewBody(body: string): boolean {
  // Common review bot signatures
  const reviewBotSignatures = [
    /^##\s*(?:Code|AI|Automated)\s*Review/im,
    /^###\s*Summary of Changes/im,
    /^###\s*(?:Files|Code)\s*Review/im,
    /^##\s*CodeRabbit/i,
    /^##\s*Sourcery/i,
    /^###\s*Possible\s*Issues/im,
    /^###\s*Suggestions/im,
    /^##\s*🤖\s*(?:Code|AI|Automated)/im,
    /^(?:---+\s*\n)?##\s*\[?\s*(?:Code|AI)\s*\]?\s*Review/im,
    /^\*\*Copilot\*\*.*(?:review|suggestion)/i,
  ];

  for (const sig of reviewBotSignatures) {
    if (sig.test(body)) return true;
  }
  return false;
}

/**
 * Classify a comment's type based on its source and content.
 */
export function classifyCommentType(
  hasDiffHunk: boolean,
  isInReplyTo: boolean,
  authorLogin: string,
  body: string,
): CommentType {
  // If it's on a specific line of code, it's a CODE comment
  if (hasDiffHunk) return CommentType.Code;

  // If it's a review body (not on a specific line)
  if (isBotReviewBody(body) || isReviewBot(authorLogin)) {
    return CommentType.Review;
  }

  // If it's a reply to a code comment, classify based on parent
  if (isInReplyTo) return CommentType.Code;

  // General issue-style comment on the PR
  return CommentType.Issue;
}

/**
 * Build reply chains from a flat list of comments.
 *
 * Comments are grouped by their `replyToId`. Top-level comments
 * (replyToId == null) have their replies nested under them.
 */
export function buildReplyChains(
  items: Array<{
    id: number;
    body: string;
    author: CommentAuthor;
    createdAt: string;
    type: CommentType;
    isResolved: boolean;
    isReply: boolean;
    replyToId: number | null;
  }>,
): ReviewComment[] {
  const commentMap = new Map<number, ReviewComment>();
  const roots: ReviewComment[] = [];
  const orphans: Array<typeof items[0]> = [];

  // First pass: create all ReviewComment nodes
  for (const item of items) {
    const comment: ReviewComment = {
      id: item.id,
      pullRequestUrl: '',
      diffHunk: null,
      path: null,
      body: item.body,
      author: item.author,
      createdAt: item.createdAt,
      type: item.type,
      isResolved: item.isResolved,
      isReply: item.isReply,
      replyToId: item.replyToId,
      replies: [],
    };
    commentMap.set(item.id, comment);
  }

  // Second pass: link children to parents
  for (const item of items) {
    const comment = commentMap.get(item.id)!;

    if (item.replyToId !== null) {
      const parent = commentMap.get(item.replyToId);
      if (parent) {
        parent.replies.push(comment);
        // Sort replies chronologically
        parent.replies.sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
      } else {
        orphans.push(item);
      }
    } else {
      comment.isReply = false;
      roots.push(comment);
    }
  }

  // Promote orphans to roots (comments whose parent wasn't fetched)
  for (const orphan of orphans) {
    if (!roots.find((r) => r.id === orphan.id)) {
      roots.push(commentMap.get(orphan.id)!);
    }
  }

  // Sort roots chronologically
  roots.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  return roots;
}

/**
 * Determine if a human has replied to a comment thread.
 * Tracks the top-level author and checks replies for human authors.
 */
export function threadHasHumanReply(comment: ReviewComment): boolean {
  // If the comment author is a bot and there are replies from humans
  if (comment.author.isBot) {
    return comment.replies.some((reply) => !reply.author.isBot);
  }
  // If the comment is from a human, check if anyone (bot or human) replied
  return comment.replies.length > 0;
}

/**
 * Determine if a thread is resolved.
 * Recursively checks if the thread or any reply has been resolved.
 */
export function threadIsResolved(comment: ReviewComment): boolean {
  if (comment.isResolved) return true;
  return comment.replies.some((reply) => threadIsResolved(reply));
}

/**
 * Assemble processing statistics from a list of comments.
 */
export function computeStats(comments: ReviewComment[]): CommentStats {
  let total = 0;
  let code = 0;
  let issue = 0;
  let review = 0;
  let bot = 0;
  let human = 0;
  let unresolved = 0;
  let unanswered = 0;

  for (const c of comments) {
    total++;
    if (c.type === CommentType.Code) code++;
    else if (c.type === CommentType.Review) review++;
    else issue++;

    if (c.author.isBot) bot++;
    else human++;

    if (!c.isResolved) unresolved++;
    if (!threadHasHumanReply(c)) unanswered++;

    // Count replies
    for (const reply of c.replies) {
      total++;
      if (reply.author.isBot) bot++;
      else human++;
      if (!reply.isResolved) unresolved++;
    }
  }

  return { total, code, issue, review, bot, human, unresolved, unanswered };
}

/**
 * Filter comments based on processing options.
 */
export function filterComments(
  comments: ReviewComment[],
  options: ProcessOptions = {},
): ReviewComment[] {
  let filtered = [...comments];

  if (options.excludeMeta) {
    filtered = filtered.filter((c) => {
      if (c.author.isBot && isMetaBot(c.author.login)) {
        // Keep it if it's a review bot, filter meta bots
        return isReviewBot(c.author.login);
      }
      return true;
    });
  }

  if (options.botsOnly) {
    filtered = filtered.filter((c) => c.author.isBot);
  }

  if (options.humansOnly) {
    filtered = filtered.filter((c) => !c.author.isBot);
  }

  if (options.unresolvedOnly) {
    filtered = filtered.filter((c) => !threadIsResolved(c));
  }

  if (options.unansweredOnly) {
    filtered = filtered.filter((c) => !threadHasHumanReply(c));
  }

  return filtered;
}

/**
 * Main processing pipeline: clean, classify, filter, build chains, compute stats.
 */
export function processComments(
  rawItems: Array<{
    id: number;
    pullRequestUrl: string;
    diffHunk: string | null;
    path: string | null;
    body: string;
    author: CommentAuthor;
    createdAt: string;
    type: CommentType;
    isResolved: boolean;
    isReply: boolean;
    replyToId: number | null;
  }>,
  options: ProcessOptions = {},
): ProcessedComments {
  // 1. Clean all bodies
  const cleaned = rawItems.map((item) => ({
    ...item,
    body: cleanBody(item.body),
    // Re-classify type after cleaning if needed
    type: classifyCommentType(
      item.diffHunk !== null,
      item.isReply,
      item.author.login,
      item.body,
    ),
  }));

  // 2. Filter out empty bodies after cleaning
  const nonEmpty = cleaned.filter((item) => item.body.length > 0);

  // 3. Build reply chains
  const comments = buildReplyChains(nonEmpty);

  // 4. Apply filters
  const filtered = filterComments(comments, options);

  // 5. Compute stats on the raw (unfiltered) chain for accuracy
  const stats = computeStats(comments);

  return { comments: filtered, stats };
}
