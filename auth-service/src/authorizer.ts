/**
 * CodeNexus Auth Service — Authorizer
 *
 * Authorization engine fusing authelia's access control patterns:
 *   - Access Control List (ACL) evaluator
 *   - Policy enforcement (bypass, one_factor, two_factor, deny)
 *   - RBAC with user/group matching
 *   - Request context evaluation (domain, resource, method, network)
 */

import { IncomingMessage } from "node:http";
import * as net from "node:net";
import {
  AccessControlRule,
  AuthLevel,
  Policy,
  UserSession,
} from "../../shared/src/types";

// ─── Request Context ─────────────────────────────────────────

/**
 * Represents an incoming request for authorization decisions.
 */
export interface RequestContext {
  /** Requested domain (e.g. "api.codenexus.dev") */
  domain: string;
  /** Requested resource path (e.g. "/api/users") */
  resource: string;
  /** HTTP method (e.g. "GET", "POST", "DELETE") */
  method: string;
  /** Remote IP address of the client */
  remoteIp: string;
  /** Original Node IncomingMessage (optional, for advanced inspection) */
  raw?: IncomingMessage;
}

// ─── Authorization Result ───────────────────────────────────

export interface AuthorizationResult {
  /** Whether access is granted */
  allowed: boolean;
  /** The matched policy that determined the outcome */
  matchedPolicy: Policy;
  /** The matched rule, if any */
  matchedRule?: AccessControlRule;
  /** Human-readable reason */
  reason: string;
  /** Whether the user needs to re-authenticate */
  requiresReAuth: boolean;
  /** The required authentication level to access this resource */
  requiredLevel: AuthLevel;
}

// ─── Configuration ───────────────────────────────────────────

export interface AuthorizerConfig {
  /** Ordered list of access control rules (first match wins) */
  rules: AccessControlRule[];
  /** Default policy when no rule matches (default: Policy.Deny) */
  defaultPolicy?: Policy;
  /** Trusted proxy CIDR ranges (e.g. ["10.0.0.0/8", "172.16.0.0/12"]) */
  trustedProxies?: string[];
}

// ─── Authorizer Class ────────────────────────────────────────

interface CidrRange {
  address: string;
  prefix: number;
}

export class Authorizer {
  private readonly config: Required<AuthorizerConfig>;
  private readonly trustedCidrs: CidrRange[] = [];

  constructor(config: AuthorizerConfig) {
    this.config = {
      defaultPolicy: Policy.Deny,
      trustedProxies: [] as string[],
      rules: [],
      ...config,
    };

    // Parse trusted proxy CIDR ranges
    const proxies = this.config.trustedProxies || [];
    for (const cidr of proxies) {
      try {
        const [ip, bits] = cidr.split("/");
        const subnet = parseInt(bits ?? "32", 10);
        this.trustedCidrs.push({ address: ip, prefix: subnet });
      } catch {
        // Skip invalid CIDR
      }
    }
  }

  // ─── Main Authorization Entry Point ───────────────────────

  /**
   * Authorize a request based on the access control rules and
   * the user's current session.
   *
   * @param context - The request context (domain, resource, method, IP)
   * @param session - The user's session (null if unauthenticated)
   * @returns AuthorizationResult with the decision.
   */
  authorize(
    context: RequestContext,
    session: UserSession | null,
  ): AuthorizationResult {
    // 1. Find the first matching rule
    const matchedRule = this.findMatchingRule(context);

    if (!matchedRule) {
      // No rule matched — apply default policy
      return this.buildResult(
        false,
        this.config.defaultPolicy,
        undefined,
        session,
      );
    }

    // 2. Evaluate the matched policy against the user's session
    return this.evaluatePolicy(matchedRule, session);
  }

  /**
   * Quick check: does this user have the required authentication level?
   */
  hasMinimumAuthLevel(
    session: UserSession | null,
    required: AuthLevel,
  ): boolean {
    if (!session) return required === AuthLevel.NotAuthenticated;
    return session.authenticationLevel >= required;
  }

  /**
   * Check if a user belongs to any of the specified groups.
   */
  isMemberOf(session: UserSession | null, groups: string[]): boolean {
    if (!session) return false;
    return groups.some((g) => session.groups.includes(g));
  }

  // ─── Rule Matching ────────────────────────────────────────

  /**
   * Find the first access control rule matching the request context.
   * Rules are evaluated in order (first match wins).
   */
  private findMatchingRule(
    context: RequestContext,
  ): AccessControlRule | undefined {
    for (const rule of this.config.rules) {
      if (this.ruleMatches(rule, context)) {
        return rule;
      }
    }
    return undefined;
  }

  /**
   * Check if a single rule matches the request context.
   * All specified criteria must match (AND logic within a rule).
   */
  private ruleMatches(
    rule: AccessControlRule,
    context: RequestContext,
  ): boolean {
    // Domain matching (required — always present)
    if (!this.domainMatches(rule.domain, context.domain)) {
      return false;
    }

    // Resource matching (optional)
    if (rule.resources && rule.resources.length > 0) {
      if (!this.resourceMatches(rule.resources, context.resource)) {
        return false;
      }
    }

    // Method matching (optional)
    if (rule.methods && rule.methods.length > 0) {
      if (!this.methodMatches(rule.methods, context.method)) {
        return false;
      }
    }

    // Network matching (optional)
    if (rule.networks && rule.networks.length > 0) {
      if (!this.networkMatches(rule.networks, context.remoteIp)) {
        return false;
      }
    }

    // Subjects are NOT matched here — they're checked in evaluatePolicy
    // because subjects depend on the user session, not the request alone.
    return true;
  }

  // ─── Policy Evaluation ────────────────────────────────────

  /**
   * Evaluate the policy of the matched rule against the user's session.
   */
  private evaluatePolicy(
    rule: AccessControlRule,
    session: UserSession | null,
  ): AuthorizationResult {
    switch (rule.policy) {
      case Policy.Bypass:
        return this.evaluateBypass(rule, session);

      case Policy.OneFactor:
        return this.evaluateOneFactor(rule, session);

      case Policy.TwoFactor:
        return this.evaluateTwoFactor(rule, session);

      case Policy.Deny:
        return this.evaluateDeny(rule, session);

      default:
        return this.buildResult(
          false,
          Policy.Deny,
          rule,
          session,
          "Unknown policy",
        );
    }
  }

  /**
   * Bypass policy — always allowed unless subject filtering denies.
   */
  private evaluateBypass(
    rule: AccessControlRule,
    session: UserSession | null,
  ): AuthorizationResult {
    // If subjects are specified, check membership
    if (rule.subjects && rule.subjects.length > 0) {
      if (!session || !this.subjectMatches(rule.subjects, session)) {
        // Subject filtering with bypass: only allowed for matching users
        return this.buildResult(
          false,
          Policy.Deny,
          rule,
          session,
          "Access denied by subject filter",
        );
      }
    }

    return this.buildResult(true, Policy.Bypass, rule, session, "Bypass");
  }

  /**
   * One-factor policy — requires the user to be authenticated
   * with at least password (AuthLevel.OneFactor).
   */
  private evaluateOneFactor(
    rule: AccessControlRule,
    session: UserSession | null,
  ): AuthorizationResult {
    // Check subjects first
    if (rule.subjects && rule.subjects.length > 0) {
      if (!session || !this.subjectMatches(rule.subjects, session)) {
        return this.buildResult(
          false,
          Policy.Deny,
          rule,
          session,
          "Access denied by subject filter",
        );
      }
    }

    if (!session) {
      return this.buildResult(
        false,
        Policy.OneFactor,
        rule,
        null,
        "Authentication required",
        true,
      );
    }

    if (session.authenticationLevel < AuthLevel.OneFactor) {
      return this.buildResult(
        false,
        Policy.OneFactor,
        rule,
        session,
        "One-factor authentication required",
        true,
      );
    }

    return this.buildResult(
      true,
      Policy.OneFactor,
      rule,
      session,
      "Authorized (one-factor)",
    );
  }

  /**
   * Two-factor policy — requires the user to be authenticated
   * with both factors (AuthLevel.TwoFactor).
   */
  private evaluateTwoFactor(
    rule: AccessControlRule,
    session: UserSession | null,
  ): AuthorizationResult {
    // Check subjects first
    if (rule.subjects && rule.subjects.length > 0) {
      if (!session || !this.subjectMatches(rule.subjects, session)) {
        return this.buildResult(
          false,
          Policy.Deny,
          rule,
          session,
          "Access denied by subject filter",
        );
      }
    }

    if (!session) {
      return this.buildResult(
        false,
        Policy.TwoFactor,
        rule,
        null,
        "Authentication required",
        true,
      );
    }

    if (session.authenticationLevel < AuthLevel.TwoFactor) {
      return this.buildResult(
        false,
        Policy.TwoFactor,
        rule,
        session,
        "Two-factor authentication required",
        true,
      );
    }

    return this.buildResult(
      true,
      Policy.TwoFactor,
      rule,
      session,
      "Authorized (two-factor)",
    );
  }

  /**
   * Deny policy — always denied unless overridden by a more
   * specific rule that matches first.
   */
  private evaluateDeny(
    rule: AccessControlRule,
    session: UserSession | null,
  ): AuthorizationResult {
    return this.buildResult(
      false,
      Policy.Deny,
      rule,
      session,
      "Access denied by policy",
    );
  }

  // ─── Subject Matching (RBAC) ──────────────────────────────

  /**
   * Check if the user's session matches the subjects list.
   *
   * Subject syntax (fused from authelia):
   *   - "user:alice"       — matches by username
   *   - "group:admin"      — matches by group membership
   *   - "user:*"           — matches any authenticated user
   */
  private subjectMatches(subjects: string[], session: UserSession): boolean {
    // If subjects is empty, it matches everyone
    if (subjects.length === 0) return true;

    for (const subject of subjects) {
      if (subject.startsWith("user:")) {
        const username = subject.slice(5);
        if (username === "*" || username === session.username) {
          return true;
        }
      } else if (subject.startsWith("group:")) {
        const groupName = subject.slice(6);
        if (groupName === "*" || session.groups.includes(groupName)) {
          return true;
        }
      }
    }

    return false;
  }

  // ─── Matching Helpers ─────────────────────────────────────

  /**
   * Domain matching supports:
   *   - Exact: "api.codenexus.dev"
   *   - Wildcard: "*.codenexus.dev"
   *   - Any: "*"
   */
  private domainMatches(pattern: string, domain: string): boolean {
    if (pattern === "*") return true;
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(2); // Remove "*."
      return domain === suffix || domain.endsWith(`.${suffix}`);
    }
    return pattern === domain;
  }

  /**
   * Resource matching supports:
   *   - Exact: "/api/users"
   *   - Prefix: "/api/*"
   *   - Any: "*"
   */
  private resourceMatches(patterns: string[], resource: string): boolean {
    return patterns.some((pattern) => {
      if (pattern === "*") return true;
      if (pattern.endsWith("*")) {
        const prefix = pattern.slice(0, -1);
        return resource.startsWith(prefix);
      }
      return pattern === resource;
    });
  }

  /**
   * Method matching (case-insensitive).
   */
  private methodMatches(patterns: string[], method: string): boolean {
    const upperMethod = method.toUpperCase();
    return patterns.some((p) => p.toUpperCase() === upperMethod || p === "*");
  }

  /**
   * Network matching supports CIDR notation.
   * Examples: "10.0.0.0/8", "192.168.1.0/24", "::1/128"
   */
  private networkMatches(patterns: string[], remoteIp: string): boolean {
    return patterns.some((pattern) => {
      if (pattern === "*") return true;
      return this.ipInCIDR(remoteIp, pattern);
    });
  }

  /**
   * Check if an IP address falls within a CIDR range.
   */
  private ipInCIDR(ip: string, cidr: string): boolean {
    try {
      const [rangeIp, bitsStr] = cidr.split("/");
      const prefix = parseInt(bitsStr ?? "32", 10);

      const ipNum = this.ipToLong(ip);
      const rangeNum = this.ipToLong(rangeIp);

      if (ipNum === null || rangeNum === null) return false;

      const mask = prefix === 0 ? 0 : ~(2 ** (32 - prefix) - 1);
      return (ipNum & mask) === (rangeNum & mask);
    } catch {
      return false;
    }
  }

  /**
   * Convert an IPv4 address to a 32-bit integer.
   */
  private ipToLong(ip: string): number | null {
    if (net.isIPv6(ip)) {
      // IPv6 not fully supported for numeric matching in this simple implementation
      // Convert embedded IPv4 if applicable
      if (ip.startsWith("::ffff:")) {
        return this.ipToLong(ip.slice(7));
      }
      return null;
    }

    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) return null;

    return (
      ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
    );
  }

  // ─── Result Builder ───────────────────────────────────────

  private buildResult(
    allowed: boolean,
    matchedPolicy: Policy,
    matchedRule: AccessControlRule | undefined,
    session: UserSession | null,
    reason?: string,
    requiresReAuth = false,
  ): AuthorizationResult {
    const requiredLevel = this.policyToAuthLevel(matchedPolicy, session);

    return {
      allowed,
      matchedPolicy,
      matchedRule,
      reason: reason ?? this.defaultReason(matchedPolicy, allowed),
      requiresReAuth,
      requiredLevel,
    };
  }

  private policyToAuthLevel(
    policy: Policy,
    session: UserSession | null,
  ): AuthLevel {
    switch (policy) {
      case Policy.Bypass:
        return AuthLevel.NotAuthenticated;
      case Policy.OneFactor:
        return AuthLevel.OneFactor;
      case Policy.TwoFactor:
        return AuthLevel.TwoFactor;
      case Policy.Deny:
        return AuthLevel.NotAuthenticated;
      default:
        return AuthLevel.NotAuthenticated;
    }
  }

  private defaultReason(policy: Policy, allowed: boolean): string {
    if (allowed) return `Access granted (${policy})`;
    return `Access denied (${policy})`;
  }
}

// ─── Express Middleware Factory ──────────────────────────────

import type { Request, Response, NextFunction } from "express";

/**
 * Create an Express middleware that enforces authorization
 * for a specific set of rules.
 *
 * @param authorizer - The Authorizer instance
 * @param getSession - A function that extracts the UserSession from the request
 * @returns Express middleware
 */
export function createAuthorizationMiddleware(
  authorizer: Authorizer,
  getSession: (req: Request) => Promise<UserSession | null> | UserSession | null,
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const context: RequestContext = {
      domain: req.hostname,
      resource: req.path,
      method: req.method,
      remoteIp: req.ip ?? req.socket.remoteAddress ?? "127.0.0.1",
      raw: req as unknown as IncomingMessage,
    };

    const session = await getSession(req);
    const result = authorizer.authorize(context, session);

    if (!result.allowed) {
      res.status(403).json({
        error: "access_denied",
        message: "Access denied",
      });
      return;
    }

    next();
  };
}
