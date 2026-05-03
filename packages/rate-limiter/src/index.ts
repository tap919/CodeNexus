import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';

export interface RateLimitOptions {
  windowMs?: number;
  maxRequests?: number;
  keyGenerator?: (req: Request) => string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  handler?: (req: Request, res: Response) => void;
}

export interface RepoRateLimitConfig {
  repo: string;
  owner: string;
  maxRequests: number;
  windowMs: number;
}

const repoRateLimits = new Map<string, RateLimitRequestHandler>();

export function createRateLimiter(options: RateLimitOptions = {}): RateLimitRequestHandler {
  const { windowMs = 60000, maxRequests = 100, keyGenerator, handler } = options;

  return rateLimit({
    windowMs,
    max: maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyGenerator ?? ((req) => (req as unknown as { ip?: string }).ip ?? 'unknown'),
    skipSuccessfulRequests: options.skipSuccessfulRequests ?? false,
    skipFailedRequests: options.skipFailedRequests ?? false,
    handler: handler ?? ((_, res) => res.status(429).json({ error: 'Too many requests' })),
  });
}

export function createRepoRateLimiter(config: RepoRateLimitConfig): RateLimitRequestHandler {
  const { repo, owner, maxRequests, windowMs } = config;
  const key = `${owner}/${repo}`;

  if (repoRateLimits.has(key)) {
    return repoRateLimits.get(key)!;
  }

  const limiter = rateLimit({
    windowMs,
    max: maxRequests,
    keyGenerator: (req) => {
      const request = req as unknown as { params?: { owner?: string; repo?: string } };
      return `${request.params?.owner ?? owner}/${request.params?.repo ?? repo}`;
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_, res) => {
      res.status(429).json({ error: 'Rate limit exceeded for repository', repo: key });
    },
  });

  repoRateLimits.set(key, limiter);
  return limiter;
}

export function createCompositeRateLimiter(
  limiters: RateLimitRequestHandler[],
): RateLimitRequestHandler {
  return (req, res, next) => {
    for (const limiter of limiters) {
      limiter(req, res, () => {});
      if (res.statusCode === 429) {
        return;
      }
    }
    next();
  };
}

export function getRepoRateLimitConfig(repo: string, owner: string): RepoRateLimitConfig {
  const customLimits = process.env.REPO_RATE_LIMITS;
  if (!customLimits) {
    return { repo, owner, maxRequests: 100, windowMs: 60000 };
  }

  try {
    const limits = JSON.parse(customLimits) as RepoRateLimitConfig[];
    return limits.find((l) => l.repo === repo && l.owner === owner) ?? { repo, owner, maxRequests: 100, windowMs: 60000 };
  } catch {
    return { repo, owner, maxRequests: 100, windowMs: 60000 };
  }
}

export { rateLimit };
export type { RateLimitRequestHandler as RequestHandler };