/**
 * GitHub API Client
 *
 * Proxy-aware HTTP client with token resolution (env → gh CLI → .env.local),
 * repository detection (git remote → env), PR auto-discovery from current
 * branch, and pagination via Link header parsing.
 *
 * Fusion of: agent-reviews auth, CLI-Anything env resolution, and undici
 * best practices.
 */

import { readFileSync, existsSync } from 'node:fs';
import { readFile, access } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { request } from 'node:https';
import { env } from 'node:process';
import { createSign } from 'node:crypto';

// ─── Types ───────────────────────────────────────────────────

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  prNumber: number;
}

export interface PagedResult<T> {
  items: T[];
  nextPage: number | null;
  hasMore: boolean;
}

export interface CommentItem {
  id: number;
  pullRequestUrl: string;
  diffHunk: string | null;
  path: string | null;
  body: string;
  author: { login: string; isBot: boolean; avatarUrl: string };
  createdAt: string;
  type: 'CODE' | 'COMMENT' | 'REVIEW';
  isResolved: boolean;
  isReply: boolean;
  replyToId: number | null;
}

export interface PRDiffFile {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  additions: number;
  deletions: number;
  changes: number;
  patch: string | null;
  sha: string;
  blobUrl: string;
}

export interface PullRequestInfo {
  number: number;
  title: string;
  state: string;
  body: string;
  author: { login: string; avatarUrl: string };
  baseBranch: string;
  headBranch: string;
  baseSha: string;
  headSha: string;
  createdAt: string;
  updatedAt: string;
  mergeable: boolean | null;
  labels: string[];
}

export interface PRStackInfo {
  current: StackInfo;
  parent: StackInfo | null;
  children: StackInfo[];
  stackHeight: number;
  totalInStack: number;
}

export interface StackInfo {
  number: number;
  title: string;
  branch: string;
  baseBranch: string;
}

// ─── HTTP helpers ────────────────────────────────────────────

interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

async function httpsFetch(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<HttpResponse> {
  const { method = 'GET', headers = {} } = options;
  const urlObj = new URL(url);

  return new Promise((resolve, reject) => {
    const req = request(
      urlObj,
      {
        method,
        headers: {
          'User-Agent': 'CodeNexus-PR-Manager/0.1.0',
          Accept: 'application/vnd.github.v3+json',
          ...headers,
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const responseHeaders: Record<string, string> = {};
        for (let i = 0; i < res.rawHeaders.length; i += 2) {
          responseHeaders[res.rawHeaders[i].toLowerCase()] = res.rawHeaders[i + 1];
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          resolve({ status, headers: responseHeaders, body });
        });
      },
    );

    if (options.body) req.write(options.body);
    req.on('error', reject);
    req.end();
  });
}

// ─── Token Resolution ────────────────────────────────────────

const KNOWN_BOT_SUFFIXES = new Set([
  '[bot]',
]);

const KNOWN_BOT_LOGINS = new Set([
  'vercel[bot]',
  'github-actions[bot]',
  'dependabot[bot]',
  'renovate[bot]',
  'codecov[bot]',
  'codacy-bot',
  'coveralls',
  'snyk-bot',
  'lgtm-com[bot]',
  'codeclimate[bot]',
  'sonarcloud[bot]',
  'deepsource-autofix[bot]',
  'prettier-bot',
  'goreleaser-bot',
  'release-please[bot]',
  'changeset-bot[bot]',
  'mergify[bot]',
  'kodiakhq[bot]',
  'coderabbitai[bot]',
  'copilot',
  'github-copilot',
  'github-copilot[bot]',
  'sourcery-ai[bot]',
  'stackhawk[bot]',
]);

export function detectIfBot(login: string): boolean {
  if (KNOWN_BOT_LOGINS.has(login)) return true;
  for (const suffix of KNOWN_BOT_SUFFIXES) {
    if (login.endsWith(suffix)) return true;
  }
  return /^bot[-_]/i.test(login) || /[-_]bot$/i.test(login) || /^[a-z]+bot$/i.test(login);
}

/**
 * Resolve a GitHub token from these sources (in priority order):
 * 1. `GITHUB_TOKEN` or `GH_TOKEN` env var
 * 2. `gh` CLI cached credentials (`~/.config/gh/hosts.yml`)
 * 3. `.env.local` file in CWD
 */
export async function resolveToken(): Promise<string> {
  // 1. Environment variables
  if (env.GITHUB_TOKEN) return env.GITHUB_TOKEN;
  if (env.GH_TOKEN) return env.GH_TOKEN;

  // 2. gh CLI
  try {
    const ghHostsPath = join(homedir(), '.config', 'gh', 'hosts.yml');
    if (existsSync(ghHostsPath)) {
      const content = readFileSync(ghHostsPath, 'utf-8');
      const tokenMatch = content.match(/github\.com:\s*\n\s+oauth_token:\s*(\S+)/);
      if (tokenMatch) return tokenMatch[1];
    }
  } catch {
    // Fall through
  }

  // 3. .env.local in CWD
  const envLocalPath = resolve(process.cwd(), '.env.local');
  if (existsSync(envLocalPath)) {
    const content = readFileSync(envLocalPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('GITHUB_TOKEN=')) {
        return trimmed.slice('GITHUB_TOKEN='.length).replace(/^['"]|['"]$/g, '');
      }
      if (trimmed.startsWith('GH_TOKEN=')) {
        return trimmed.slice('GH_TOKEN='.length).replace(/^['"]|['"]$/g, '');
      }
    }
  }

  throw new Error(
    'No GitHub token found. Set GITHUB_TOKEN or GH_TOKEN in environment, ' +
    'authenticate via `gh auth login`, or create a .env.local file.',
  );
}

// ─── Repository Detection ────────────────────────────────────

export interface RepoIdentifier {
  owner: string;
  repo: string;
}

/**
 * Detect repository owner/name from:
 * 1. `GITHUB_REPOSITORY` env var (`owner/repo`)
 * 2. Git remote origin URL
 */
export function detectRepository(cwd?: string): RepoIdentifier {
  // 1. Environment variable
  if (env.GITHUB_REPOSITORY) {
    const parts = env.GITHUB_REPOSITORY.split('/');
    if (parts.length === 2) {
      return { owner: parts[0], repo: parts[1] };
    }
  }

  // 2. Git remote
  try {
    const remoteUrl = execSync('git remote get-url origin', {
      cwd: cwd ?? process.cwd(),
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();

    const parts = parseGitRemote(remoteUrl);
    if (parts) return parts;
  } catch {
    // Fall through
  }

  // 3. GIT_URL env var (CI)
  if (env.GIT_URL) {
    const parts = parseGitRemote(env.GIT_URL);
    if (parts) return parts;
  }

  throw new Error(
    'Could not detect repository. Set GITHUB_REPOSITORY env var or ' +
    'ensure a valid git remote "origin" exists.',
  );
}

function parseGitRemote(url: string): RepoIdentifier | null {
  // HTTPS: https://github.com/owner/repo.git or /owner/repo
  const httpsMatch = url.match(
    /github\.com[/:]([^/]+)\/([^/\s.]+)(?:\.git)?(?:\s|$)/,
  );
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  // SSH: git@github.com:owner/repo.git
  const sshMatch = url.match(
    /git@github\.com:([^/]+)\/([^/\s.]+)(?:\.git)?$/,
  );
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  return null;
}

// ─── PR Auto-Discovery ───────────────────────────────────────

/**
 * Detect the PR number for the current branch by querying the GitHub API.
 */
export async function discoverCurrentPR(
  config?: Partial<GitHubConfig>,
  cwd?: string,
): Promise<number | null> {
  const owner = config?.owner ?? detectRepository(cwd).owner;
  const repo = config?.repo ?? detectRepository(cwd).repo;
  const token = config?.token ?? (await resolveToken());

  let branch: string;
  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: cwd ?? process.cwd(),
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }

  if (branch === 'HEAD') return null;

  // GitHub search API to find open PR for this branch
  const query = encodeURIComponent(`repo:${owner}/${repo} head:${branch} state:open`);
  const url = `https://api.github.com/search/issues?q=${query}&per_page=1`;

  const response = await apiGet(url, token);
  const data = JSON.parse(response.body);

  if (data.items && data.items.length > 0) {
    return data.items[0].number;
  }

  return null;
}

// ─── Pagination ───────────────────────────────────────────────

/**
 * Parse the `Link` header into a map of rel → URL.
 */
export function parseLinkHeader(linkHeader: string | undefined): Record<string, string> {
  const links: Record<string, string> = {};
  if (!linkHeader) return links;

  const pattern = /<([^>]+)>;\s*rel="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(linkHeader)) !== null) {
    links[match[2]] = match[1];
  }
  return links;
}

/**
 * Extract the page number from a GitHub API URL's query string.
 */
export function extractPageNumber(url: string): number | null {
  const parsed = new URL(url);
  const page = parsed.searchParams.get('page');
  return page ? parseInt(page, 10) : null;
}

// ─── API Request Helpers ─────────────────────────────────────

export async function apiGet(
  url: string,
  token: string,
): Promise<HttpResponse> {
  const response = await httpsFetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (response.status === 401) {
    throw new Error('GitHub API returned 401 — token may be invalid or expired.');
  }
  if (response.status === 403) {
    throw new Error('GitHub API rate limit exceeded. Try again later.');
  }
  if (response.status === 404) {
    throw new Error('GitHub API returned 404 — resource not found.');
  }
  if (response.status >= 400) {
    throw new Error(`GitHub API error ${response.status}: ${response.body.slice(0, 200)}`);
  }

  return response;
}

export async function apiPost(
  url: string,
  token: string,
  body: unknown,
): Promise<HttpResponse> {
  const bodyStr = body ? JSON.stringify(body) : undefined;
  const response = await httpsFetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: bodyStr,
  });

  return response;
}

// ─── High-Level API Methods ──────────────────────────────────

/**
 * Fetch all items from a paginated GitHub API endpoint.
 * Follows the `Link` header's `next` rel until exhausted.
 */
export async function fetchPaginated<T>(
  url: string,
  token: string,
): Promise<T[]> {
  const allItems: T[] = [];
  let nextUrl: string | null = url;

  while (nextUrl) {
    const response = await apiGet(nextUrl, token);
    const data = JSON.parse(response.body) as T[];
    allItems.push(...data);

    const links = parseLinkHeader(response.headers['link']);
    nextUrl = links['next'] ?? null;
  }

  return allItems;
}

/**
 * Fetch PR info using the GitHub API.
 */
export async function fetchPRInfo(
  owner: string,
  repo: string,
  prNumber: number,
  token: string,
): Promise<PullRequestInfo> {
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`;
  const response = await apiGet(url, token);
  const data = JSON.parse(response.body);

  return {
    number: data.number,
    title: data.title,
    state: data.state,
    body: data.body ?? '',
    author: {
      login: data.user.login,
      avatarUrl: data.user.avatar_url,
    },
    baseBranch: data.base.ref,
    headBranch: data.head.ref,
    baseSha: data.base.sha,
    headSha: data.head.sha,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    mergeable: data.mergeable,
    labels: data.labels?.map((l: { name: string }) => l.name) ?? [],
  };
}

/**
 * Fetch the PR diff (list of changed files with patches).
 */
export async function fetchPRDiff(
  owner: string,
  repo: string,
  prNumber: number,
  token: string,
): Promise<PRDiffFile[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`;
  const files = await fetchPaginated<Record<string, unknown>>(url, token);

  return files.map((f) => ({
    filename: f.filename as string,
    status: (f.status as PRDiffFile['status']) ?? 'modified',
    additions: (f.additions as number) ?? 0,
    deletions: (f.deletions as number) ?? 0,
    changes: (f.changes as number) ?? 0,
    patch: (f.patch as string | null) ?? null,
    sha: f.sha as string,
    blobUrl: f.blob_url as string,
  }));
}

/**
 * Fetch all review comments on a PR (comments on diffs).
 */
export async function fetchPRReviewComments(
  owner: string,
  repo: string,
  prNumber: number,
  token: string,
): Promise<CommentItem[]> {
  const url =
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/comments?per_page=100&direction=asc`;
  const items = await fetchPaginated<Record<string, unknown>>(url, token);

  return items.map(mapCommentItem);
}

/**
 * Fetch all issue comments on a PR (general comments, not on diffs).
 */
export async function fetchIssueComments(
  owner: string,
  repo: string,
  prNumber: number,
  token: string,
): Promise<CommentItem[]> {
  const url =
    `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100&direction=asc`;
  const items = await fetchPaginated<Record<string, unknown>>(url, token);

  return items.map((item) => ({
    id: item.id as number,
    pullRequestUrl: item.html_url as string,
    diffHunk: null,
    path: null,
    body: (item.body as string) ?? '',
    author: {
      login: ((item.user as Record<string, unknown>)?.login as string) ?? 'unknown',
      isBot: detectIfBot(
        ((item.user as Record<string, unknown>)?.login as string) ?? '',
      ),
      avatarUrl: ((item.user as Record<string, unknown>)?.avatar_url as string) ?? '',
    },
    createdAt: (item.created_at as string) ?? '',
    type: 'COMMENT' as const,
    isResolved: false,
    isReply: false,
    replyToId: null,
  }));
}

/**
 * Fetch PR reviews (summaries with body comments).
 */
export async function fetchPRReviews(
  owner: string,
  repo: string,
  prNumber: number,
  token: string,
): Promise<CommentItem[]> {
  const url =
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/reviews?per_page=100`;
  const items = await fetchPaginated<Record<string, unknown>>(url, token);

  return items
    .filter((r) => (r.body as string)?.trim())
    .map((item) => ({
      id: (item.id as number) * -1, // Negative ID to distinguish from comments
      pullRequestUrl: item.html_url as string,
      diffHunk: null,
      path: null,
      body: (item.body as string) ?? '',
      author: {
        login: ((item.user as Record<string, unknown>)?.login as string) ?? 'unknown',
        isBot: detectIfBot(
          ((item.user as Record<string, unknown>)?.login as string) ?? '',
        ),
        avatarUrl: ((item.user as Record<string, unknown>)?.avatar_url as string) ?? '',
      },
      createdAt: (item.submitted_at as string) ?? (item.created_at as string) ?? '',
      type: 'REVIEW' as const,
      isResolved: false,
      isReply: false,
      replyToId: null,
    }));
}

// ─── Internal Mapping ────────────────────────────────────────

function mapCommentItem(item: Record<string, unknown>): CommentItem {
  const user = item.user as Record<string, unknown> | undefined;
  const login = (user?.login as string) ?? 'unknown';

  return {
    id: item.id as number,
    pullRequestUrl: item.html_url as string,
    diffHunk: (item.diff_hunk as string | null) ?? null,
    path: (item.path as string | null) ?? null,
    body: (item.body as string) ?? '',
    author: {
      login,
      isBot: detectIfBot(login),
      avatarUrl: (user?.avatar_url as string) ?? '',
    },
    createdAt: (item.created_at as string) ?? '',
    type: 'CODE' as const,
    isResolved: false,
    replyToId: (item.in_reply_to_id as number | null) ?? null,
    isReply: (item.in_reply_to_id as number | null) !== null,
  };
}

// ─── GraphQL API ─────────────────────────────────────────────

const GRAPHQL_URL = 'https://api.github.com/graphql';

/**
 * Execute a GitHub GraphQL query.
 */
export async function graphqlQuery(
  query: string,
  variables: Record<string, unknown>,
  token: string,
): Promise<Record<string, unknown>> {
  const response = await httpsFetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  const respBody = JSON.parse(response.body);
  if (respBody.errors) {
    const messages = (respBody.errors as Array<{ message: string }>)
      .map((e) => e.message)
      .join('; ');
    throw new Error(`GraphQL error: ${messages}`);
  }

  return respBody.data as Record<string, unknown>;
}

/**
 * Post a reply to a review thread using GraphQL.
 * Requires the `addPullRequestReviewThreadReply` mutation.
 */
export async function postReplyToThread(
  threadId: string,
  body: string,
  token: string,
): Promise<string> {
  const mutation = `
    mutation($threadId: ID!, $body: String!) {
      addPullRequestReviewThreadReply(input: {
        pullRequestReviewThreadId: $threadId
        body: $body
      }) {
        comment {
          id
          url
        }
      }
    }
  `;

  const data = await graphqlQuery(
    mutation,
    { threadId, body },
    token,
  );

  return (
    (data as Record<string, unknown>).addPullRequestReviewThreadReply as Record<string, unknown>
  )?.comment as string;
}

/**
 * Resolve a review thread using GraphQL.
 */
export async function resolveThread(
  threadId: string,
  token: string,
): Promise<void> {
  const mutation = `
    mutation($threadId: ID!) {
      resolveReviewThread(input: {
        threadId: $threadId
      }) {
        thread {
          id
          isResolved
        }
      }
    }
  `;

  await graphqlQuery(mutation, { threadId }, token);
}

/**
 * Unresolve a review thread using GraphQL.
 */
export async function unresolveThread(
  threadId: string,
  token: string,
): Promise<void> {
  const mutation = `
    mutation($threadId: ID!) {
      unresolveReviewThread(input: {
        threadId: $threadId
      }) {
        thread {
          id
          isResolved
        }
      }
    }
  `;

  await graphqlQuery(mutation, { threadId }, token);
}

// ─── GitHub App Config ────────────────────────────────────────

export interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  installationId?: number;
}

// ─── GitHubClient ─────────────────────────────────────────────

export class GitHubClient {
  private token: string | null = null;
  private appConfig: GitHubAppConfig | null = null;
  private installationToken: string | null = null;
  private installationTokenExpiry: number = 0;

  constructor(token?: string, appConfig?: GitHubAppConfig) {
    this.token = token || null;
    this.appConfig = appConfig || null;
  }

  private async resolveAuthHeader(): Promise<string> {
    if (this.appConfig) {
      const token = await this.getInstallationToken();
      return `Bearer ${token}`;
    }
    if (this.token) return `Bearer ${this.token}`;
    const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (envToken) return `Bearer ${envToken}`;
    throw new Error('No GitHub authentication configured');
  }

  private async getInstallationToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.installationToken && now < this.installationTokenExpiry - 60) {
      return this.installationToken;
    }

    if (!this.appConfig) throw new Error('No GitHub App config');

    // Generate JWT for the GitHub App
    const jwt = await this.generateAppJWT();

    // Get installation token
    const result = await this.httpsFetch(
      `https://api.github.com/app/installations/${this.appConfig.installationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'CodeNexus-PR-Manager/0.1.0',
        },
      },
    );

    const data = JSON.parse(result.body);
    this.installationToken = data.token;
    this.installationTokenExpiry = now + 3600; // tokens last 1 hour
    return this.installationToken!;
  }

  private async generateAppJWT(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iat: now - 60,
      exp: now + 600,
      iss: this.appConfig!.appId,
    };
    const header = { alg: 'RS256', typ: 'JWT' };
    const segments = [
      Buffer.from(JSON.stringify(header)).toString('base64url'),
      Buffer.from(JSON.stringify(payload)).toString('base64url'),
    ];
    const signer = createSign('RSA-SHA256');
    signer.update(segments.join('.'));
    const signature = signer.sign(this.appConfig!.privateKey, 'base64url');
    return `${segments.join('.')}.${signature}`;
  }

  // ─── GraphQL ──────────────────────────────────────────────

  async graphqlQuery(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const auth = await this.resolveAuthHeader();
    const response = await httpsFetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    const respBody = JSON.parse(response.body);
    if (respBody.errors) {
      const messages = (respBody.errors as Array<{ message: string }>)
        .map((e) => e.message)
        .join('; ');
      throw new Error(`GraphQL error: ${messages}`);
    }

    return respBody.data as Record<string, unknown>;
  }

  // ─── PR Stack Detection ───────────────────────────────────

  async getPullRequestNodeId(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<string> {
    const query = `query($owner: String!, $repo: String!, $pr: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $pr) { id, headRefOid }
      }
    }`;
    const result = await this.graphqlQuery(query, { owner, repo, pr: prNumber });
    return ((result.repository as Record<string, unknown>)
      .pullRequest as Record<string, unknown>).id as string;
  }

  async getPRStack(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<PRStackInfo> {
    const currentQuery = `query($owner: String!, $repo: String!, $pr: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $pr) { number, title, headRefName, baseRefName }
      }
    }`;
    const currentResult = await this.graphqlQuery(currentQuery, { owner, repo, pr: prNumber });
    const currentData = ((currentResult.repository as Record<string, unknown>)
      .pullRequest as Record<string, unknown>);
    const current: StackInfo = {
      number: currentData.number as number,
      title: currentData.title as string,
      branch: currentData.headRefName as string,
      baseBranch: currentData.baseRefName as string,
    };

    const defaultBranch = await this.getDefaultBranch(owner, repo);

    // Find parent: PR whose head branch matches this PR's base branch
    let parent: StackInfo | null = null;
    if (current.baseBranch !== defaultBranch) {
      const parentQuery = `query($owner: String!, $repo: String!, $branch: String!) {
        repository(owner: $owner, name: $repo) {
          pullRequests(headRefName: $branch, states: OPEN, first: 1) {
            nodes { number, title, headRefName, baseRefName }
          }
        }
      }`;
      const parentResult = await this.graphqlQuery(parentQuery, {
        owner, repo, branch: current.baseBranch,
      });
      const parentNodes = (((parentResult.repository as Record<string, unknown>)
        .pullRequests as Record<string, unknown>).nodes as Array<Record<string, unknown>>) ?? [];
      if (parentNodes.length > 0) {
        parent = {
          number: parentNodes[0].number as number,
          title: parentNodes[0].title as string,
          branch: parentNodes[0].headRefName as string,
          baseBranch: parentNodes[0].baseRefName as string,
        };
      }
    }

    const children = await this.findChildPRs(owner, repo, current.branch);
    const stackHeight = await this.getStackHeight(owner, repo, prNumber);

    return {
      current,
      parent,
      children,
      stackHeight,
      totalInStack: 1 + children.length + (parent ? 1 : 0),
    };
  }

  private async findChildPRs(
    owner: string,
    repo: string,
    branch: string,
  ): Promise<StackInfo[]> {
    const query = `query($owner: String!, $repo: String!, $branch: String!) {
      repository(owner: $owner, name: $repo) {
        pullRequests(baseRefName: $branch, states: OPEN, first: 10) {
          nodes { number, title, headRefName, baseRefName }
        }
      }
    }`;
    const result = await this.graphqlQuery(query, { owner, repo, branch });
    const nodes = ((((result.repository as Record<string, unknown>)
      .pullRequests as Record<string, unknown>).nodes) as Array<Record<string, unknown>>) ?? [];
    return nodes.map((n) => ({
      number: n.number as number,
      title: n.title as string,
      branch: n.headRefName as string,
      baseBranch: n.baseRefName as string,
    }));
  }

  private async getStackHeight(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<number> {
    const query = `query($owner: String!, $repo: String!, $pr: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $pr) { number, baseRefName }
      }
    }`;
    const result = await this.graphqlQuery(query, { owner, repo, pr: prNumber });
    const prData = ((result.repository as Record<string, unknown>)
      .pullRequest as Record<string, unknown>);
    const baseBranch = prData.baseRefName as string;

    const defaultBranch = await this.getDefaultBranch(owner, repo);
    if (baseBranch === defaultBranch) return 1;

    const parentQuery = `query($owner: String!, $repo: String!, $branch: String!) {
      repository(owner: $owner, name: $repo) {
        pullRequests(headRefName: $branch, states: OPEN, first: 1) {
          nodes { number }
        }
      }
    }`;
    const parentResult = await this.graphqlQuery(parentQuery, {
      owner, repo, branch: baseBranch,
    });
    const parentNodes = (((parentResult.repository as Record<string, unknown>)
      .pullRequests as Record<string, unknown>).nodes as Array<Record<string, unknown>>) ?? [];

    if (parentNodes.length === 0) return 1;
    return 1 + await this.getStackHeight(owner, repo, parentNodes[0].number as number);
  }

  private async getDefaultBranch(
    owner: string,
    repo: string,
  ): Promise<string> {
    const query = `query($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        defaultBranchRef { name }
      }
    }`;
    const result = await this.graphqlQuery(query, { owner, repo });
    return (((result.repository as Record<string, unknown>)
      .defaultBranchRef as Record<string, unknown>).name) as string;
  }
}
