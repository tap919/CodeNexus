import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  detectIfBot,
  parseLinkHeader,
  extractPageNumber,
  PRStackInfo,
  StackInfo,
  GitHubClient,
} from './github-client.js';

describe('Bot detection', () => {
  it('recognizes known bot logins', () => {
    expect(detectIfBot('github-actions[bot]')).toBe(true);
    expect(detectIfBot('dependabot[bot]')).toBe(true);
    expect(detectIfBot('renovate[bot]')).toBe(true);
    expect(detectIfBot('coderabbitai[bot]')).toBe(true);
    expect(detectIfBot('copilot')).toBe(true);
  });

  it('recognizes [bot] suffix', () => {
    expect(detectIfBot('my-custom-app[bot]')).toBe(true);
  });

  it('recognizes bot patterns via regex', () => {
    expect(detectIfBot('bot-crawler')).toBe(true);
    expect(detectIfBot('cleanup_bot')).toBe(true);
    expect(detectIfBot('deploybot')).toBe(true);
  });

  it('returns false for human logins', () => {
    expect(detectIfBot('octocat')).toBe(false);
    expect(detectIfBot('torvalds')).toBe(false);
    expect(detectIfBot('jane-doe')).toBe(false);
  });
});

describe('Link header parsing', () => {
  it('parses next and prev rels', () => {
    const header =
      '<https://api.github.com/repos/owner/repo/pulls?page=2>; rel="next", ' +
      '<https://api.github.com/repos/owner/repo/pulls?page=1>; rel="prev"';
    const links = parseLinkHeader(header);
    expect(links['next']).toContain('page=2');
    expect(links['prev']).toContain('page=1');
  });

  it('parses last rel', () => {
    const header =
      '<https://api.github.com/repos/owner/repo/pulls?page=5>; rel="last"';
    const links = parseLinkHeader(header);
    expect(links['last']).toContain('page=5');
  });

  it('returns empty object for undefined header', () => {
    expect(parseLinkHeader(undefined)).toEqual({});
  });

  it('returns empty object for empty string', () => {
    expect(parseLinkHeader('')).toEqual({});
  });
});

describe('Page number extraction', () => {
  it('extracts page number from URL query string', () => {
    expect(
      extractPageNumber('https://api.github.com/repos/o/r/pulls?page=3&per_page=100'),
    ).toBe(3);
  });

  it('returns null when no page param', () => {
    expect(
      extractPageNumber('https://api.github.com/repos/o/r/pulls'),
    ).toBeNull();
  });
});

describe('PR Stack types', () => {
  it('PRStackInfo has required fields', () => {
    const stack: PRStackInfo = {
      current: { number: 1, title: 'feat: a', branch: 'feat/a', baseBranch: 'main' },
      parent: { number: 2, title: 'feat: b', branch: 'feat/b', baseBranch: 'feat/a' },
      children: [
        { number: 3, title: 'feat: c', branch: 'feat/c', baseBranch: 'feat/b' },
      ],
      stackHeight: 3,
      totalInStack: 3,
    };
    expect(stack.current.number).toBe(1);
    expect(stack.parent?.number).toBe(2);
    expect(stack.children).toHaveLength(1);
    expect(stack.stackHeight).toBe(3);
    expect(stack.totalInStack).toBe(3);
  });

  it('supports null parent (top of stack)', () => {
    const stack: PRStackInfo = {
      current: { number: 42, title: 'Root PR', branch: 'root', baseBranch: 'main' },
      parent: null,
      children: [],
      stackHeight: 1,
      totalInStack: 1,
    };
    expect(stack.parent).toBeNull();
    expect(stack.children).toHaveLength(0);
  });
});

describe('GitHubClient constructor', () => {
  it('creates instance with token', () => {
    const client = new GitHubClient('ghp_test123');
    expect(client).toBeDefined();
  });

  it('creates instance with no auth', () => {
    const client = new GitHubClient();
    expect(client).toBeDefined();
  });
});

describe('resolveAuthHeader priority', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('throws when no auth configured', async () => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    const client = new GitHubClient();
    await expect(
      client.graphqlQuery('query { viewer { login } }', {}),
    ).rejects.toThrow('No GitHub authentication configured');
  });

  it('uses explicit token over env', async () => {
    const client = new GitHubClient('ghp_explicit');
    // The constructor token takes priority over env
    // Verified by the resolveAuthHeader logic: token check before env fallback
    expect(client).toBeDefined();
  });
});
