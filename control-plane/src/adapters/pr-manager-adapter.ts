/**
 * PR Manager Adapter — Wires the orchestrator's ModuleAdapters.prManager interface
 * to the real GitHub operations in @codenexus/pr-manager.
 *
 * This replaces the stub implementation with real diff fetching, comment
 * processing, and PR interaction. Token is resolved lazily at call time from
 * loaded config or CNX_GITHUB_TOKEN env var.
 */

import type { RepositoryInfo, ProcessedComments, ReviewComment } from '../../../shared/src/types';
import type { ModuleAdapters } from '../orchestrator';
import { getConfig } from '../config';
import {
  fetchPRDiff,
  fetchPRInfo,
  fetchPRReviewComments,
  fetchIssueComments,
  fetchPRReviews,
  processComments,
  apiPost,
  apiGet,
} from '@codenexus/pr-manager';

function resolveGitHubToken(): string {
  try {
    const config = getConfig();
    if (config.github?.token) {
      return config.github.token;
    }
  } catch {
    // Config not loaded yet
  }

  const envToken = process.env.CNX_GITHUB_TOKEN;
  if (envToken && envToken.trim()) {
    return envToken;
  }

  throw new Error(
    '[pr-manager-adapter] GitHub token not configured. Call loadConfig() first or set CNX_GITHUB_TOKEN env var.',
  );
}

function serializeDiffFiles(
  diffFiles: Array<{ filename: string; patch: string | null }>,
): string {
  return diffFiles
    .map((f) => f.patch ?? '')
    .join('\n');
}

export function createDefaultPRManager(): ModuleAdapters['prManager'] {
  return {
    async getDiff(repo: RepositoryInfo): Promise<string> {
      const token = resolveGitHubToken();

      if (!repo.prNumber) {
        console.warn('[pr-manager-adapter] getDiff: no prNumber, returning empty diff');
        return '';
      }

      try {
        const diffFiles = await fetchPRDiff(repo.owner, repo.repo, repo.prNumber, token);
        return serializeDiffFiles(diffFiles);
      } catch (error) {
        console.error(
          `[pr-manager-adapter] getDiff failed for ${repo.owner}/${repo.repo}#${repo.prNumber}:`,
          error,
        );
        return '';
      }
    },

    async getComments(repo: RepositoryInfo): Promise<ProcessedComments> {
      const token = resolveGitHubToken();

      if (!repo.prNumber) {
        return {
          comments: [],
          stats: {
            total: 0,
            code: 0,
            issue: 0,
            review: 0,
            bot: 0,
            human: 0,
            unresolved: 0,
            unanswered: 0,
          },
        };
      }

      try {
        const [reviewComments, issueComments, reviews] = await Promise.all([
          fetchPRReviewComments(repo.owner, repo.repo, repo.prNumber, token),
          fetchIssueComments(repo.owner, repo.repo, repo.prNumber, token),
          fetchPRReviews(repo.owner, repo.repo, repo.prNumber, token),
        ]);

        const allItems = [...reviewComments, ...issueComments, ...reviews];
        return processComments(allItems);
      } catch (error) {
        console.error(
          `[pr-manager-adapter] getComments failed for ${repo.owner}/${repo.repo}#${repo.prNumber}:`,
          error,
        );
        return {
          comments: [],
          stats: {
            total: 0,
            code: 0,
            issue: 0,
            review: 0,
            bot: 0,
            human: 0,
            unresolved: 0,
            unanswered: 0,
          },
        };
      }
    },

    async postComment(repo: RepositoryInfo, comment: ReviewComment): Promise<void> {
      const token = resolveGitHubToken();

      if (!repo.prNumber) {
        throw new Error('[pr-manager-adapter] postComment: no prNumber');
      }

      try {
        const commentBody = comment.body;
        await apiPost(
          `https://api.github.com/repos/${repo.owner}/${repo.repo}/issues/${repo.prNumber}/comments`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ body: commentBody }),
          },
        );
      } catch (error) {
        console.error('[pr-manager-adapter] postComment failed:', error);
        throw error;
      }
    },

    async postReview(
      repo: RepositoryInfo,
      comments: ReviewComment[],
    ): Promise<void> {
      const token = resolveGitHubToken();

      if (!repo.prNumber) {
        throw new Error('[pr-manager-adapter] postReview: no prNumber');
      }

      try {
        const prInfo = await fetchPRInfo(repo.owner, repo.repo, repo.prNumber, token);
        const body = comments.map((c) => c.body).join('\n\n');

        const formattedComments = comments
          .filter((c) => c.path && c.diffHunk)
          .map((c) => ({
            path: c.path!,
            body: c.body,
          }));

        const mutation = `mutation($input: SubmitPullRequestReviewInput!) {
          submitPullRequestReview(input: $input) {
            clientMutationId
          }
        }`;

        const input: Record<string, unknown> = {
          pullRequestReviewId: prInfo.nodeId,
          body,
          event: comments.length > 0 ? 'COMMENT' : 'APPROVE',
          comments: formattedComments,
        };

        const response = await fetch('https://api.github.com/graphql', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query: mutation, variables: { input } }),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`GraphQL review post failed: ${response.status} ${text}`);
        }
      } catch (error) {
        console.error('[pr-manager-adapter] postReview failed:', error);
        throw error;
      }
    },

    async updatePR(repo: RepositoryInfo, body: string): Promise<void> {
      const token = resolveGitHubToken();

      if (!repo.prNumber) {
        throw new Error('[pr-manager-adapter] updatePR: no prNumber');
      }

      try {
        const response = await fetch(
          `https://api.github.com/repos/${repo.owner}/${repo.repo}/pulls/${repo.prNumber}`,
          {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ body }),
          },
        );

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`PR body update failed: ${response.status} ${text}`);
        }
      } catch (error) {
        console.error('[pr-manager-adapter] updatePR failed:', error);
        throw error;
      }
    },
  };
}