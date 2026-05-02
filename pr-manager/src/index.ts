/**
 * PR Manager
 *
 * The main entry point for the CodeNexus PR Manager module. Fuses
 * agent-reviews' comment management with GitHub API integration.
 *
 * Capabilities:
 *  - Fetch PR diffs and review comments (paginated via Link header)
 *  - Classify comments (bot vs human, meta filtering, type detection)
 *  - Process comments into unified format with reply chains
 *  - Post replies and resolve threads via GraphQL
 *  - Filter comments (unresolved, unanswered, bots-only, humans-only)
 *  - Watch mode for polling new comments
 */

import type {
  ReviewComment,
  ProcessedComments,
  CommentStats,
  RepositoryInfo,
} from '../../shared/src/types.js';
import { CommentType, SessionStatus } from '../../shared/src/types.js';

import {
  type GitHubConfig,
  type CommentItem,
  type PRDiffFile,
  type PullRequestInfo,
  type PRStackInfo,
  type StackInfo,
  GitHubClient,
  resolveToken,
  detectRepository,
  discoverCurrentPR,
  fetchPRInfo,
  fetchPRDiff,
  fetchPRReviewComments,
  fetchIssueComments,
  fetchPRReviews,
  postReplyToThread,
  resolveThread as resolveThreadGQL,
  unresolveThread as unresolveThreadGQL,
  detectIfBot,
} from './github-client.js';

import {
  processComments,
  cleanBody,
  isMetaBot,
  isReviewBot,
  isMetaBody,
  isBotReviewBody,
  classifyCommentType,
  buildReplyChains,
  threadHasHumanReply,
  threadIsResolved,
  computeStats,
  filterComments,
  type ProcessOptions,
} from './comment-processor.js';

import {
  format,
  formatJSON,
  formatTerminalDetailed,
  formatTerminalCompact,
  formatStatus,
  type FormatOptions,
} from './formatter.js';

// ─── Configuration ───────────────────────────────────────────

export interface PRManagerConfig {
  /** GitHub Personal Access Token */
  token?: string;

  /** Repository owner (username or org) */
  owner?: string;

  /** Repository name */
  repo?: string;

  /** Pull Request number (auto-discovered if omitted) */
  prNumber?: number;

  /** Polling interval in ms for watch mode (default: 30_000) */
  watchIntervalMs?: number;

  /** Working directory for git commands (default: process.cwd()) */
  cwd?: string;

  /** Default output format */
  format?: 'json' | 'terminal-detailed' | 'terminal-compact';
}

export interface ManagerState {
  config: Required<GitHubConfig>;
  prInfo: PullRequestInfo | null;
  diffFiles: PRDiffFile[];
  lastProcessed: ProcessedComments | null;
  lastFetchTimestamp: string | null;
}

// ─── Defaults ────────────────────────────────────────────────

const DEFAULT_WATCH_INTERVAL_MS = 30_000;

// ─── PR Manager Class ────────────────────────────────────────

/**
 * PRManager — central orchestrator for pull request comment management.
 *
 * ```ts
 * const mgr = new PRManager({ owner: 'myorg', repo: 'myrepo', prNumber: 42 });
 * const result = await mgr.fetchAndProcess();
 * console.log(mgr.formatOutput(result));
 * ```
 */
export class PRManager {
  private config: PRManagerConfig;
  private resolvedConfig: GitHubConfig | null = null;
  private _client: GitHubClient | null = null;
  private state: ManagerState = {
    config: { token: '', owner: '', repo: '', prNumber: 0 },
    prInfo: null,
    diffFiles: [],
    lastProcessed: null,
    lastFetchTimestamp: null,
  };
  private watchHandle: ReturnType<typeof setInterval> | null = null;
  private watchCallback: ((processed: ProcessedComments) => void) | null = null;
  private _isWatching = false;

  constructor(config: PRManagerConfig = {}) {
    this.config = {
      watchIntervalMs: DEFAULT_WATCH_INTERVAL_MS,
      ...config,
    };
  }

  // ─── Initialization ──────────────────────────────────────

  /**
   * Resolve token, repository, and PR number.
   * Must be called before any fetch operations unless all config is provided.
   */
  async initialize(): Promise<GitHubConfig> {
    const token = this.config.token ?? (await resolveToken());
    const repoInfo = this.config.owner && this.config.repo
      ? { owner: this.config.owner, repo: this.config.repo }
      : detectRepository(this.config.cwd);

    let prNumber = this.config.prNumber;
    if (!prNumber) {
      prNumber = (await discoverCurrentPR(
        { token, ...repoInfo },
        this.config.cwd,
      )) ?? undefined;
    }

    if (!prNumber) {
      throw new Error(
        'Could not determine PR number. Provide `prNumber` in config, ' +
        'or ensure the current branch has an open pull request.',
      );
    }

    this.resolvedConfig = {
      token,
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      prNumber,
    };

    this.state.config = this.resolvedConfig;
    return this.resolvedConfig;
  }

  /**
   * Ensure the manager is initialized (lazy init).
   */
  private async ensureInitialized(): Promise<GitHubConfig> {
    if (this.resolvedConfig) return this.resolvedConfig;
    return this.initialize();
  }

  // ─── Fetching ────────────────────────────────────────────

  /**
   * Fetch PR information, diff, and all comments from the GitHub API.
   */
  async fetchAll(): Promise<{
    prInfo: PullRequestInfo;
    diffFiles: PRDiffFile[];
    reviewComments: CommentItem[];
    issueComments: CommentItem[];
    reviews: CommentItem[];
  }> {
    const cfg = await this.ensureInitialized();

    const [prInfo, diffFiles, reviewComments, issueComments, reviews] =
      await Promise.all([
        fetchPRInfo(cfg.owner, cfg.repo, cfg.prNumber, cfg.token),
        fetchPRDiff(cfg.owner, cfg.repo, cfg.prNumber, cfg.token),
        fetchPRReviewComments(cfg.owner, cfg.repo, cfg.prNumber, cfg.token),
        fetchIssueComments(cfg.owner, cfg.repo, cfg.prNumber, cfg.token),
        fetchPRReviews(cfg.owner, cfg.repo, cfg.prNumber, cfg.token),
      ]);

    this.state.prInfo = prInfo;
    this.state.diffFiles = diffFiles;
    this.state.lastFetchTimestamp = new Date().toISOString();

    return { prInfo, diffFiles, reviewComments, issueComments, reviews };
  }

  /**
   * Fetch and process all PR comments in one call.
   */
  async fetchAndProcess(
    processOptions: ProcessOptions = {},
  ): Promise<ProcessedComments> {
    const { reviewComments, issueComments, reviews } = await this.fetchAll();

    // Merge all comment sources
    const allItems = [
      ...reviewComments,
      ...issueComments,
      ...reviews,
    ];

    // Process (clean, classify, chain, filter)
    const processed = processComments(allItems, processOptions);
    this.state.lastProcessed = processed;

    return processed;
  }

  // ─── Filtering ───────────────────────────────────────────

  /**
   * Filter previously-processed comments with new options.
   */
  filterComments(
    options: ProcessOptions = {},
  ): ReviewComment[] {
    if (!this.state.lastProcessed) return [];
    return filterComments(this.state.lastProcessed.comments, options);
  }

  /**
   * Get unresolved comments from the last processed result.
   */
  getUnresolved(): ReviewComment[] {
    return this.filterComments({ unresolvedOnly: true });
  }

  /**
   * Get unanswered comments (no human reply) from the last processed result.
   */
  getUnanswered(): ReviewComment[] {
    return this.filterComments({ unansweredOnly: true });
  }

  // ─── Actions (Post / Resolve) ────────────────────────────

  /**
   * Post a reply to a review thread via GraphQL.
   *
   * @param threadId - The GraphQL node ID of the review thread
   * @param body - The reply text
   * @returns The created comment data
   */
  async postReply(
    threadId: string,
    body: string,
  ): Promise<string> {
    const cfg = await this.ensureInitialized();
    return postReplyToThread(threadId, body, cfg.token);
  }

  /**
   * Resolve a review thread via GraphQL.
   */
  async resolveThread(threadId: string): Promise<void> {
    const cfg = await this.ensureInitialized();
    await resolveThreadGQL(threadId, cfg.token);
  }

  /**
   * Unresolve a previously resolved review thread via GraphQL.
   */
  async unresolveThread(threadId: string): Promise<void> {
    const cfg = await this.ensureInitialized();
    await unresolveThreadGQL(threadId, cfg.token);
  }

  /**
   * Lazy-initialized GitHubClient instance for GraphQL operations.
   */
  private get client(): GitHubClient {
    if (!this._client) {
      this._client = new GitHubClient(
        this.resolvedConfig?.token,
      );
    }
    return this._client;
  }

  /**
   * Post a pull request review with inline comments via GraphQL.
   *
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param prNumber - Pull request number
   * @param commitId - Head commit OID to review
   * @param body - Review body text
   * @param comments - Array of inline comments with path, position, body
   */
  async postReview(
    owner: string,
    repo: string,
    prNumber: number,
    commitId: string,
    body: string,
    comments: Array<{ path: string; position: number; body: string }>,
  ): Promise<void> {
    const mutation = `mutation($input: SubmitPullRequestReviewInput!) {
      submitPullRequestReview(input: $input) {
        clientMutationId
      }
    }`;
    await this.client.graphqlQuery(mutation, {
      input: {
        pullRequestId: await this.client.getPullRequestNodeId(owner, repo, prNumber),
        commitOID: commitId,
        body,
        event: 'COMMENT',
        comments,
      },
    });
  }

  // ─── Output ──────────────────────────────────────────────

  /**
   * Format processed comments for output.
   */
  formatOutput(
    processed: ProcessedComments,
    formatOptions: FormatOptions = {},
  ): string {
    const fmt = formatOptions.format ?? this.config.format ?? 'terminal-detailed';
    return format(processed, { format: fmt });
  }

  /**
   * Get the last processed comments as a JSON string.
   */
  toJSON(pretty: boolean = true): string {
    if (!this.state.lastProcessed) return '{}';
    return formatJSON(this.state.lastProcessed);
  }

  // ─── Watch Mode ──────────────────────────────────────────

  /**
   * Whether the watch mode is currently active.
   */
  get isWatching(): boolean {
    return this._isWatching;
  }

  /**
   * Start polling for new comments at the configured interval.
   *
   * @param callback - Called with each new batch of processed comments
   * @param processOptions - Filtering options for processing
   */
  startWatching(
    callback: (processed: ProcessedComments) => void,
    processOptions: ProcessOptions = {},
  ): void {
    if (this._isWatching) {
      console.warn('[PRManager] Watch mode is already active.');
      return;
    }

    this.watchCallback = callback;
    this._isWatching = true;

    // Initial fetch
    this.fetchAndProcess(processOptions)
      .then((processed) => {
        callback(processed);
      })
      .catch((err: unknown) => {
        console.error('[PRManager] Initial watch fetch failed:', err);
      });

    // Polling loop
    const interval = this.config.watchIntervalMs ?? DEFAULT_WATCH_INTERVAL_MS;
    this.watchHandle = setInterval(async () => {
      try {
        const processed = await this.fetchAndProcess(processOptions);
        callback(processed);
      } catch (err: unknown) {
        console.error('[PRManager] Watch fetch failed:', err);
      }
    }, interval);
  }

  /**
   * Stop the watch mode polling.
   */
  stopWatching(): void {
    if (this.watchHandle) {
      clearInterval(this.watchHandle);
      this.watchHandle = null;
    }
    this._isWatching = false;
    this.watchCallback = null;
  }

  // ─── State Accessors ─────────────────────────────────────

  /**
   * Get the current manager state (read-only snapshot).
   */
  getState(): Readonly<ManagerState> {
    return { ...this.state };
  }

  /**
   * Get the resolved repository info.
   */
  get repositoryInfo(): RepositoryInfo | null {
    if (!this.resolvedConfig) return null;
    return {
      owner: this.resolvedConfig.owner,
      repo: this.resolvedConfig.repo,
      branch: this.state.prInfo?.headBranch ?? '',
      prNumber: this.resolvedConfig.prNumber,
      cloneUrl: `https://github.com/${this.resolvedConfig.owner}/${this.resolvedConfig.repo}.git`,
    };
  }

  /**
   * Get the PR diff summary.
   */
  get diffSummary(): string {
    const files = this.state.diffFiles;
    const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
    const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);
    const totalChanges = files.reduce((sum, f) => sum + f.changes, 0);

    return [
      `${files.length} file(s) changed`,
      `${totalAdditions} additions`,
      `${totalDeletions} deletions`,
      `${totalChanges} total changes`,
    ].join(', ');
  }

  /**
   * Get the last fetch timestamp.
   */
  get lastFetchTime(): string | null {
    return this.state.lastFetchTimestamp;
  }
}

// ─── Re-exports ──────────────────────────────────────────────

export {
  // Comment processing
  processComments,
  cleanBody,
  isMetaBot,
  isReviewBot,
  isMetaBody,
  isBotReviewBody,
  classifyCommentType,
  buildReplyChains,
  threadHasHumanReply,
  threadIsResolved,
  computeStats,
  filterComments,
  type ProcessOptions,
} from './comment-processor.js';

export {
  // Output formatting
  format,
  formatJSON,
  formatTerminalDetailed,
  formatTerminalCompact,
  formatStatus,
  type FormatOptions,
} from './formatter.js';

export {
  // GitHub client
  GitHubClient,
  resolveToken,
  detectRepository,
  discoverCurrentPR,
  fetchPRInfo,
  fetchPRDiff,
  fetchPRReviewComments,
  fetchIssueComments,
  fetchPRReviews,
  postReplyToThread,
  resolveThreadGQL as resolveThread,
  unresolveThreadGQL as unresolveThread,
  detectIfBot,
  parseLinkHeader,
  fetchPaginated,
  apiGet,
  apiPost,
  graphqlQuery,
} from './github-client.js';

export type {
  GitHubConfig,
  CommentItem,
  PRDiffFile,
  PullRequestInfo,
  PRStackInfo,
  StackInfo,
  PagedResult,
  RepoIdentifier,
} from './github-client.js';

export type {
  ReviewComment,
  CommentStats,
  ProcessedComments,
  CommentAuthor,
  CommentType,
  RepositoryInfo,
} from '../../shared/src/types.js';

// ─── Default Export ──────────────────────────────────────────

export default PRManager;
