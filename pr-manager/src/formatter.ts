/**
 * Output Formatter
 *
 * JSON format for AI agent consumption, ANSI-colored terminal output,
 * and compact/detailed views.
 *
 * Fuses: agent-reviews display, CLI-Anything formatting.
 */

import chalk from 'chalk';
import type {
  ReviewComment,
  CommentStats,
  ProcessedComments,
  CommentAuthor,
} from '../../shared/src/types.js';
import { CommentType } from '../../shared/src/types.js';

// ─── Constants ───────────────────────────────────────────────

const TYPE_LABELS: Record<CommentType, string> = {
  [CommentType.Code]: chalk.cyan('CODE'),
  [CommentType.Issue]: chalk.yellow('ISSUE'),
  [CommentType.Review]: chalk.magenta('REVIEW'),
};

const TYPE_ICONS: Record<CommentType, string> = {
  [CommentType.Code]: '📝',
  [CommentType.Issue]: '💬',
  [CommentType.Review]: '🔍',
};

const BOT_BADGE = chalk.dim('🤖');
const HUMAN_BADGE = chalk.green('👤');
const RESOLVED_BADGE = chalk.green('✓');
const UNRESOLVED_BADGE = chalk.red('✗');
const REPLY_BADGE = chalk.dim('↳');

// ─── JSON Format ─────────────────────────────────────────────

/**
 * Format processed comments as JSON for AI agent consumption.
 * Produces a clean, structured output with stats and comment data.
 */
export function formatJSON(processed: ProcessedComments): string {
  return JSON.stringify(
    {
      version: '1.0',
      stats: processed.stats,
      comments: processed.comments.map(serializeComment),
    },
    null,
    2,
  );
}

/**
 * Serialize a single comment for JSON output with reply chain.
 */
function serializeComment(comment: ReviewComment): Record<string, unknown> {
  return {
    id: comment.id,
    type: comment.type,
    author: {
      login: comment.author.login,
      isBot: comment.author.isBot,
    },
    body: comment.body,
    createdAt: comment.createdAt,
    isResolved: comment.isResolved,
    hasReplies: comment.replies.length > 0,
    replyCount: comment.replies.length,
    replies: comment.replies.map(serializeComment),
  };
}

// ─── Terminal Output ─────────────────────────────────────────

/**
 * Format processed comments as ANSI-colored terminal output (detailed).
 */
export function formatTerminalDetailed(processed: ProcessedComments): string {
  const lines: string[] = [];

  // Header
  lines.push('');
  lines.push(chalk.bold.underline('📋 PR Comments'));
  lines.push(formatStatsLine(processed.stats));
  lines.push('');

  // Comments
  if (processed.comments.length === 0) {
    lines.push(chalk.dim('  No comments to display.\n'));
    return lines.join('\n');
  }

  for (let i = 0; i < processed.comments.length; i++) {
    lines.push(formatCommentDetailed(processed.comments[i], i + 1));
  }

  return lines.join('\n');
}

/**
 * Format processed comments as ANSI-colored terminal output (compact).
 */
export function formatTerminalCompact(processed: ProcessedComments): string {
  const lines: string[] = [];

  // One-line summary
  lines.push(
    chalk.bold(`📋 ${processed.comments.length} comments`) +
    chalk.dim(` (${processed.stats.total} total, ${processed.stats.unresolved} unresolved, ${processed.stats.unanswered} unanswered)`),
  );

  // Comments (compact)
  for (const comment of processed.comments) {
    lines.push(formatCommentCompact(comment));
  }

  return lines.join('\n');
}

// ─── Internal Formatters ─────────────────────────────────────

function formatStatsLine(stats: CommentStats): string {
  const parts: string[] = [];

  parts.push(chalk.dim(`Total: ${chalk.bold(stats.total)}`));
  parts.push(chalk.dim(`Code: ${chalk.bold(stats.code)}`));
  parts.push(chalk.dim(`Issue: ${chalk.bold(stats.issue)}`));
  parts.push(chalk.dim(`Review: ${chalk.bold(stats.review)}`));
  parts.push(chalk.dim(`Bot: ${chalk.bold(stats.bot)}`));
  parts.push(chalk.dim(`Human: ${chalk.bold(stats.human)}`));
  parts.push(chalk.dim(`Unresolved: ${chalk.bold(stats.unresolved)}`));
  parts.push(chalk.dim(`Unanswered: ${chalk.bold(stats.unanswered)}`));

  return `  ${parts.join(' • ')}`;
}

function formatCommentDetailed(comment: ReviewComment, index: number): string {
  const lines: string[] = [];

  // Header with type icon and number
  const icon = TYPE_ICONS[comment.type as CommentType] ?? '💬';
  const typeLabel = TYPE_LABELS[comment.type as CommentType] ?? 'COMMENT';
  const authorBadge = comment.author.isBot ? BOT_BADGE : HUMAN_BADGE;
  const resolveBadge = comment.isResolved ? RESOLVED_BADGE : UNRESOLVED_BADGE;

  lines.push(
    `  ${chalk.bold(`#${index}`)} ${icon} ${typeLabel} ${resolveBadge} ${authorBadge} ${chalk.cyan(comment.author.login)}`,
  );
  lines.push(chalk.dim(`  ─${'─'.repeat(50)}`));

  // Body (truncated if too long)
  const bodyLines = comment.body.split('\n');
  const displayBody = bodyLines.length > 15
    ? bodyLines.slice(0, 12).join('\n') + `\n${chalk.dim('  ... (${bodyLines.length - 12} more lines)')}`
    : comment.body;

  for (const line of displayBody.split('\n')) {
    lines.push(`  ${chalk.dim('│')} ${line}`);
  }

  lines.push('');

  // Replies
  if (comment.replies.length > 0) {
    lines.push(chalk.dim(`  ${comment.replies.length} ${comment.replies.length === 1 ? 'reply' : 'replies'}:`));
    for (const reply of comment.replies) {
      lines.push(formatReply(reply, 2));
    }
  }

  lines.push('');
  return lines.join('\n');
}

function formatReply(reply: ReviewComment, depth: number): string {
  const indent = '  '.repeat(depth);
  const authorBadge = reply.author.isBot ? BOT_BADGE : HUMAN_BADGE;
  const resolveBadge = reply.isResolved ? RESOLVED_BADGE : UNRESOLVED_BADGE;
  const prefix = depth > 1 ? REPLY_BADGE : REPLY_BADGE;

  const lines: string[] = [];
  const firstLine = reply.body.split('\n')[0] ?? '';
  const truncated = firstLine.length > 100
    ? firstLine.slice(0, 97) + '...'
    : firstLine;

  lines.push(
    `  ${indent}${prefix} ${resolveBadge} ${authorBadge} ${chalk.cyan(reply.author.login)}: ${chalk.dim(truncated)}`,
  );

  for (const nestedReply of reply.replies) {
    lines.push(formatReply(nestedReply, depth + 1));
  }

  return lines.join('\n');
}

function formatCommentCompact(comment: ReviewComment): string {
  const icon = TYPE_ICONS[comment.type as CommentType] ?? '💬';
  const authorBadge = comment.author.isBot ? BOT_BADGE : HUMAN_BADGE;
  const resolveBadge = comment.isResolved ? RESOLVED_BADGE : UNRESOLVED_BADGE;

  const firstLine = comment.body.split('\n')[0] ?? '';
  const truncated = firstLine.length > 120
    ? firstLine.slice(0, 117) + '...'
    : firstLine;

  const replyCount = comment.replies.length > 0
    ? chalk.dim(` [${comment.replies.length} replies]`)
    : '';

  return `  ${icon} ${resolveBadge} ${authorBadge} ${chalk.cyan(comment.author.login)}${replyCount}: ${truncated}`;
}

// ─── Utility ─────────────────────────────────────────────────

export interface FormatOptions {
  format?: 'json' | 'terminal-detailed' | 'terminal-compact';
}

/**
 * Format processed comments according to the given options.
 */
export function format(
  processed: ProcessedComments,
  options: FormatOptions = {},
): string {
  switch (options.format) {
    case 'json':
      return formatJSON(processed);
    case 'terminal-compact':
      return formatTerminalCompact(processed);
    case 'terminal-detailed':
    default:
      return formatTerminalDetailed(processed);
  }
}

/**
 * Format a simple status message in terminal.
 */
export function formatStatus(message: string, type: 'info' | 'success' | 'warn' | 'error' = 'info'): string {
  switch (type) {
    case 'success':
      return chalk.green(`✔ ${message}`);
    case 'warn':
      return chalk.yellow(`⚠ ${message}`);
    case 'error':
      return chalk.red(`✘ ${message}`);
    case 'info':
    default:
      return chalk.blue(`ℹ ${message}`);
  }
}

/**
 * Format a single comment for quick display (minimal view).
 */
export function formatQuick(comment: ReviewComment): string {
  const icon = TYPE_ICONS[comment.type as CommentType] ?? '💬';
  const author = comment.author.isBot
    ? chalk.dim(comment.author.login)
    : chalk.cyan(comment.author.login);

  return `${icon} ${author}: ${comment.body.slice(0, 80)}`;
}
