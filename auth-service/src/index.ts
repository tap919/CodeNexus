/**
 * CodeNexus Auth Service — Main Entry Point
 *
 * Express server fusing authelia's authentication patterns:
 *   - First-factor: Password-based with Argon2id hashing
 *   - Second-factor: TOTP (RFC 6238)
 *   - Session management with AES-256-GCM encrypted JWT cookies
 *   - RBAC authorization middleware
 *   - OIDC provider endpoints (discovery, token, userinfo, jwks)
 *   - Rate limiting and brute-force protection
 */

// ─── Imports ────────────────────────────────────────────────

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import express, {
  type Application,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { SignJWT } from "jose";
import {
  AuthLevel,
  Policy,
  UserSession,
  OIDCClient,
} from "../../shared/src/types";
import { SessionStore } from "./session-store";
import {
  Authenticator,
  FileUserProvider,
  type AuthenticatorConfig,
  type FileUserEntry,
} from "./authenticator";
import {
  Authorizer,
  createAuthorizationMiddleware,
  type AuthorizerConfig,
} from "./authorizer";

// ─── PKCE Verification Helper ───────────────────────────────

/**
 * Verify a PKCE code verifier against a stored code challenge.
 * Supports S256 (SHA-256) and plain methods (plain is not recommended).
 */
function verifyPKCE(codeVerifier: string, codeChallenge: string, method: string = 'S256'): boolean {
  if (method !== 'S256') {
    return false;
  }
  const hash = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return hash === codeChallenge;
}

// ─── Server Configuration ───────────────────────────────────

export interface AuthServiceConfig {
  /** HTTP port (default: 9000) */
  port?: number;
  /** Host to bind to (default: '0.0.0.0') */
  host?: string;
  /** Session store configuration */
  session: {
    encryptionKey: string;
    ttlSeconds?: number;
    redisUrl?: string;
    cookieName?: string;
    cookieDomain?: string;
    cookieSecure?: boolean;
  };
  /** Authentication configuration */
  auth: {
    passwordPepper: string;
    jwtSecret: string;
    jwtIssuer: string;
    jwtAudience: string;
    totpIssuer: string;
  };
  /** OIDC provider configuration */
  oidc: {
    issuer: string;
    clients: OIDCClient[];
    /** Path to the RSA private key (PEM) for signing JWTs.
     *  If absent, uses the jwtSecret (HMAC) instead. */
    signingKeyPath?: string;
    /** Path to the RSA public key (PEM) for JWKS. */
    verificationKeyPath?: string;
  };
  /** Authorization access control rules */
  accessControl: AuthorizerConfig["rules"];
  /** Default policy for unmatched rules */
  defaultPolicy?: Policy;
  /** Path to users JSON file (optional — for file-based provider) */
  usersFile?: string;
  /** Initial users for the file-based provider (overrides file) */
  initialUsers?: FileUserEntry[];
  /** Trusted proxy CIDR ranges */
  trustedProxies?: string[];
  /** Trust proxy setting for Express */
  trustProxy?: boolean | string | number | string[];
}

// ─── Global State ────────────────────────────────────────────

interface AppState {
  app: Application;
  sessionStore: SessionStore;
  authenticator: Authenticator;
  authorizer: Authorizer;
  userProvider: FileUserProvider;
  server: ReturnType<Application["listen"]> | null;
  oidcSigningKey: crypto.KeyLike | null;
  oidcVerificationKey: crypto.KeyLike | null;
  oidcKeyId: string;
}

// ─── Server Bootstrap ───────────────────────────────────────

/**
 * Create and configure the auth service application.
 * Returns the Express app and all internal state for testing.
 */
export async function createAuthService(
  config: AuthServiceConfig,
): Promise<AppState> {
  // Validate required config
  if (!config.session.encryptionKey) {
    throw new Error("AuthService: session.encryptionKey is required");
  }
  if (!config.auth.jwtSecret) {
    throw new Error("AuthService: auth.jwtSecret is required");
  }
  if (!config.oidc.issuer) {
    throw new Error("AuthService: oidc.issuer is required");
  }

  // ── Initialize Session Store ──────────────────────────────

  const sessionStore = new SessionStore({
    encryptionKey: config.session.encryptionKey,
    ttlSeconds: config.session.ttlSeconds ?? 3600,
    redisUrl: config.session.redisUrl,
    cookieName: config.session.cookieName ?? "codenexus_session",
    cookieDomain: config.session.cookieDomain,
    cookieSecure: config.session.cookieSecure ?? true,
  });
  await sessionStore.init();

  // ── Initialize User Provider ──────────────────────────────

  const userProvider = new FileUserProvider({
    pepper: config.auth.passwordPepper,
    initialUsers: config.initialUsers,
    usersPath: config.usersFile ?? "",
  });

  // Initialize: hash any plaintext passwords
  await userProvider.init();

  // If a users file exists, load it
  if (config.usersFile && fs.existsSync(config.usersFile)) {
    const raw = fs.readFileSync(config.usersFile, "utf-8");
    const entries: FileUserEntry[] = JSON.parse(raw);
    await userProvider.loadUsers(entries);
  }

  // ── Initialize Authenticator ──────────────────────────────

  const authConfig: AuthenticatorConfig = {
    passwordPepper: config.auth.passwordPepper,
    jwtSecret: config.auth.jwtSecret,
    jwtIssuer: config.auth.jwtIssuer,
    jwtAudience: config.auth.jwtAudience,
    totpIssuer: config.auth.totpIssuer,
    sessionTtlSeconds: config.session.ttlSeconds ?? 3600,
  };

  const authenticator = new Authenticator(
    authConfig,
    sessionStore,
    userProvider,
  );

  // ── Initialize Authorizer ─────────────────────────────────

  const authorizer = new Authorizer({
    rules: config.accessControl,
    defaultPolicy: config.defaultPolicy ?? Policy.Deny,
    trustedProxies: config.trustedProxies,
  });

  // ── Load OIDC Signing Keys ────────────────────────────────

  let oidcSigningKey: crypto.KeyLike | null = null;
  let oidcVerificationKey: crypto.KeyLike | null = null;
  const oidcKeyId = crypto.randomUUID().slice(0, 8);

  // ── Authorization Code Store ──────────────────────────────

  const authorizationCodes = new Map<string, {
    clientId: string;
    redirectUri: string;
    scope: string;
    codeChallenge?: string;
    codeChallengeMethod?: string;
    nonce?: string;
    expiresAt: number;
    used: boolean;
    sessionId: string | null;
  }>();

  if (config.oidc.signingKeyPath && fs.existsSync(config.oidc.signingKeyPath)) {
    const pem = fs.readFileSync(config.oidc.signingKeyPath, "utf-8");
    oidcSigningKey = crypto.createPrivateKey(pem);
  }

  if (
    config.oidc.verificationKeyPath &&
    fs.existsSync(config.oidc.verificationKeyPath)
  ) {
    const pem = fs.readFileSync(config.oidc.verificationKeyPath, "utf-8");
    oidcVerificationKey = crypto.createPublicKey(pem);
  }

  // ── Create Express App ────────────────────────────────────

  const app = express();

  // Trust proxy if configured
  if (config.trustProxy !== undefined) {
    app.set("trust proxy", config.trustProxy);
  }

  // Global middleware
  app.use(express.json());
  app.use(cookieParser());
  app.use(requestLogger);
  app.use(corsHeaders);

  // ── Rate Limiting ────────────────────────────────────────
  // NOTE: For production multi-instance deployments, replace the default
  // in-memory store with rate-limit-redis. Example:
  //   import { RedisStore } from 'rate-limit-redis';
  //   const store = new RedisStore({ client: redisClient });
  // Then pass `store` to each rateLimit() call below.
  // Without Redis, rate limit counters reset on server restart.
  // Set TEST_MODE=true to disable rate limiting during tests.

  const isTestMode = process.env.TEST_MODE === 'true';

  const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: isTestMode ? 10000 : 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too_many_requests", message: "Rate limit exceeded" },
  });
  if (!isTestMode) app.use(globalLimiter);

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: isTestMode ? 10000 : 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: "too_many_login_attempts",
      message: "Too many login attempts. Try again later.",
    },
  });

  const totpLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: isTestMode ? 10000 : 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: "too_many_totp_attempts",
      message: "Too many TOTP attempts. Try again later.",
    },
  });

  const tokenLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: "too_many_token_requests",
      message: "Too many token requests. Try again later.",
    },
  });

  // ── Session Extraction Helper ─────────────────────────────

  /**
   * Extract the current user session from the request.
   * Checks the encrypted cookie first, then the Authorization header.
   */
  async function getSessionFromRequest(
    req: Request,
  ): Promise<UserSession | null> {
    // 1. Try cookie
    const cookieName = config.session.cookieName ?? "codenexus_session";
    const encryptedCookie = req.cookies?.[cookieName];
    if (encryptedCookie) {
      const session = await sessionStore.restoreFromCookie(encryptedCookie);
      if (session) return session;
    }

    // 2. Try Authorization header (bearer token with session_id claim)
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const payload = await authenticator.verifyAccessToken(token);
      if (payload && typeof payload.session_id === "string") {
        const session = await sessionStore.getSession(payload.session_id);
        if (session) return session;
      }
    }

    return null;
  }

  /**
   * Session extraction for middleware (async).
   */
  async function getSessionAsync(req: Request): Promise<UserSession | null> {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const payload = await authenticator.verifyAccessToken(token);
      if (payload && typeof payload.session_id === "string") {
        return {
          id: payload.session_id as string,
          username: payload.sub as string,
          groups: (payload.groups as string[]) ?? [],
          emails: (payload.emails as string[]) ?? [],
          authenticationLevel: (payload.authentication_level as AuthLevel) ?? 0,
          authenticationMethods: (payload.amr as string[]) ?? [],
          createdAt: "",
          expiresAt: "",
        };
      }
    }
    return null;
  }

  // ── Authorization Middleware ──────────────────────────────

  const authzMiddleware = createAuthorizationMiddleware(
    authorizer,
    getSessionAsync,
  );

  // ── Routes ────────────────────────────────────────────────

  // Health check
  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      service: "auth-service",
      timestamp: new Date().toISOString(),
    });
  });

  // ──────── First-Factor Authentication ────────────────────

  /**
   * POST /api/auth/login
   *
   * Authenticate with username and password (first factor).
   * On success, sets an encrypted session cookie and returns
   * a JWT access token. If the user has TOTP enrolled,
   * requiresTwoFactor is set to true.
   */
  app.post(
    "/api/auth/login",
    loginLimiter,
    async (req: Request, res: Response) => {
      try {
        const { username, password } = req.body;

        if (!username || !password) {
          res.status(400).json({
            error: "invalid_request",
            message: "Username and password are required",
          });
          return;
        }

        if (typeof username !== "string" || typeof password !== "string") {
          res.status(400).json({
            error: "invalid_request",
            message: "Username and password must be strings",
          });
          return;
        }

        const result = await authenticator.authenticatePassword(
          username,
          password,
          req.ip,
        );

        if (!result.success) {
          const statusCode =
            result.error === "account_disabled"
              ? 403
              : result.error === "account_locked"
                ? 429
                : 401;

          res.status(statusCode).json({
            success: false,
            error: result.error,
            message: result.message,
            remainingAttempts: result.remainingAttempts,
            remainingLockout: result.remainingLockout,
          });
          return;
        }

        // Set encrypted session cookie
        const cookieOpts = sessionStore.getCookieOptions();
        res.cookie(cookieOpts.name, result.encryptedCookie, {
          httpOnly: cookieOpts.httpOnly,
          secure: cookieOpts.secure,
          sameSite: cookieOpts.sameSite,
          domain: cookieOpts.domain,
          maxAge: cookieOpts.maxAge,
          path: cookieOpts.path,
        });

        // Set refresh token as httpOnly cookie (safer than JSON body)
        if (result.refreshToken) {
          res.cookie('codenexus_refresh_token', result.refreshToken, {
            httpOnly: true,
            secure: cookieOpts.secure,
            sameSite: cookieOpts.sameSite,
            domain: cookieOpts.domain,
            maxAge: cookieOpts.maxAge * 24,
            path: '/api/auth',
          });
        }

        res.json({
          success: true,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          sessionId: result.session!.id,
          authenticationLevel: AuthLevel.OneFactor,
          requiresTwoFactor: result.requiresTwoFactor,
          expiresAt: result.session!.expiresAt,
        });
      } catch (err) {
        console.error("[AuthService] Login error:", err);
        res.status(500).json({
          error: "internal_error",
          message: "An internal error occurred",
        });
      }
    },
  );

  // ──────── Second-Factor Authentication (TOTP) ────────────

  /**
   * POST /api/auth/2fa/totp
   *
   * Verify a TOTP token to complete second-factor authentication.
   * Requires an active session from the first factor (via cookie).
   */
  app.post(
    "/api/auth/2fa/totp",
    totpLimiter,
    async (req: Request, res: Response) => {
      try {
        const { token } = req.body;

        if (!token || typeof token !== "string") {
          res.status(400).json({
            error: "invalid_request",
            message: "TOTP token is required",
          });
          return;
        }

        // Get session from cookie
        const cookieName = config.session.cookieName ?? "codenexus_session";
        const encryptedCookie = req.cookies?.[cookieName];

        if (!encryptedCookie) {
          res.status(401).json({
            error: "session_required",
            message:
              "Authentication session required. Complete first-factor first.",
          });
          return;
        }

        const session = await sessionStore.restoreFromCookie(encryptedCookie);
        if (!session) {
          res.status(401).json({
            error: "session_expired",
            message: "Session expired or invalid. Please log in again.",
          });
          return;
        }

        const result = await authenticator.authenticateTOTP(session.id, token);

        if (!result.success) {
          res.status(401).json({
            error: result.error,
            message: result.message,
          });
          return;
        }

        // Generate a new access token with upgraded auth level
        const newAccessToken = await authenticator.generateAccessToken(
          result.session!,
          ["openid", "profile", "email"],
        );

        // Update the encrypted cookie
        const updatedCookie = await sessionStore.createSession(result.session!);
        const cookieOpts = sessionStore.getCookieOptions();
        res.cookie(cookieOpts.name, updatedCookie, {
          httpOnly: cookieOpts.httpOnly,
          secure: cookieOpts.secure,
          sameSite: cookieOpts.sameSite,
          domain: cookieOpts.domain,
          maxAge: cookieOpts.maxAge,
          path: cookieOpts.path,
        });

        res.json({
          success: true,
          accessToken: newAccessToken,
          sessionId: result.session!.id,
          authenticationLevel: AuthLevel.TwoFactor,
          expiresAt: result.session!.expiresAt,
        });
      } catch (err) {
        console.error("[AuthService] TOTP error:", err);
        res.status(500).json({
          error: "internal_error",
          message: "An internal error occurred",
        });
      }
    },
  );

  // ──────── TOTP Enrollment ─────────────────────────────────

  /**
   * POST /api/auth/2fa/enroll
   *
   * Generate a new TOTP secret for the authenticated user.
   * Requires an active session.
   */
  app.post(
    "/api/auth/2fa/enroll",
    requireAuth(sessionStore, config),
    async (req: Request, res: Response) => {
      try {
        const session = res.locals.session as UserSession;
        const enrollment = await authenticator.enrollTOTP(session.username);

        res.json({
          secret: enrollment.secret,
          uri: enrollment.uri,
          qrCodeUrl: enrollment.qrCodeUrl,
        });
      } catch (err) {
        console.error("[AuthService] TOTP enroll error:", err);
        res.status(500).json({
          error: "internal_error",
          message: "Failed to enroll TOTP",
        });
      }
    },
  );

  /**
   * POST /api/auth/2fa/verify-enrollment
   *
   * Verify a TOTP token to confirm successful enrollment.
   */
  app.post(
    "/api/auth/2fa/verify-enrollment",
    requireAuth(sessionStore, config),
    async (req: Request, res: Response) => {
      try {
        const { token } = req.body;
        const session = res.locals.session as UserSession;

        if (!token || typeof token !== "string") {
          res.status(400).json({
            error: "invalid_request",
            message: "TOTP token is required",
          });
          return;
        }

        const valid = await authenticator.verifyTOTPEnrollment(
          session.username,
          token,
        );

        if (!valid) {
          res.status(400).json({
            error: "invalid_totp",
            message: "Invalid TOTP token. Please try again.",
          });
          return;
        }

        res.json({ success: true, message: "TOTP enrollment verified" });
      } catch (err) {
        console.error("[AuthService] TOTP verify enrollment error:", err);
        res.status(500).json({
          error: "internal_error",
          message: "Failed to verify enrollment",
        });
      }
    },
  );

  // ──────── Session Management ─────────────────────────────

  /**
   * GET /api/auth/session
   *
   * Get the current session information.
   */
  app.get("/api/auth/session", async (req: Request, res: Response) => {
    const session = await getSessionFromRequest(req);

    if (!session) {
      res.json({
        authenticated: false,
        authenticationLevel: AuthLevel.NotAuthenticated,
      });
      return;
    }

    res.json({
      authenticated: true,
      session: {
        id: session.id,
        username: session.username,
        groups: session.groups,
        emails: session.emails,
        authenticationLevel: session.authenticationLevel,
        authenticationMethods: session.authenticationMethods,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
      },
    });
  });

  /**
   * POST /api/auth/logout
   *
   * Destroy the current session.
   */
  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    try {
      const session = await getSessionFromRequest(req);

      if (session) {
        await sessionStore.deleteSession(session.id);
      }

      // Clear the cookie
      const cookieName = config.session.cookieName ?? "codenexus_session";
      res.clearCookie(cookieName, { path: "/" });

      res.json({ success: true, message: "Logged out" });
    } catch (err) {
      console.error("[AuthService] Logout error:", err);
      res.status(500).json({
        error: "internal_error",
        message: "An internal error occurred",
      });
    }
  });

  // ──────── Token Refresh ──────────────────────────────────

  /**
   * POST /api/auth/token/refresh
   *
   * Exchange a refresh token for a new access token.
   * Accepts refresh_token via JSON body OR httpOnly cookie.
   * Performs token rotation — issues a new refresh token on each use.
   */
  app.post("/api/auth/token/refresh", tokenLimiter, async (req: Request, res: Response) => {
    try {
      const refresh_token = req.body?.refresh_token || req.cookies?.codenexus_refresh_token;
      if (!refresh_token || typeof refresh_token !== 'string') {
        res.status(400).json({ error: 'invalid_request', message: 'refresh_token is required' });
        return;
      }

      const payload = await authenticator.verifyRefreshToken(refresh_token);
      if (!payload || typeof payload.session_id !== 'string') {
        res.status(401).json({ error: 'invalid_token', message: 'Invalid or expired refresh token' });
        return;
      }

      const session = await sessionStore.getSession(payload.session_id);
      if (!session) {
        res.status(401).json({ error: 'session_not_found', message: 'Session expired' });
        return;
      }

      const accessToken = await authenticator.generateAccessToken(session, ['openid', 'profile', 'email']);
      const newRefreshToken = await authenticator.generateRefreshToken(session);

      // Set refresh token cookie BEFORE sending JSON response
      const cookieOpts = sessionStore.getCookieOptions();
      res.cookie('codenexus_refresh_token', newRefreshToken, {
        httpOnly: true,
        secure: cookieOpts.secure,
        sameSite: cookieOpts.sameSite,
        domain: cookieOpts.domain,
        maxAge: cookieOpts.maxAge * 24,
        path: '/api/auth',
      });

      res.json({
        access_token: accessToken,
        refresh_token: newRefreshToken,
        token_type: 'Bearer',
        expires_in: 3600,
      });
    } catch (err) {
      console.error('[AuthService] Token refresh error:', err);
      res.status(500).json({ error: 'internal_error', message: 'An internal error occurred' });
    }
  });

  // ──────── OIDC Provider Endpoints ────────────────────────

  /**
   * GET /.well-known/openid-configuration
   *
   * OpenID Connect Discovery endpoint.
   */
  app.get(
    "/.well-known/openid-configuration",
    (_req: Request, res: Response) => {
      const issuer = config.oidc.issuer.replace(/\/+$/, "");
      res.json({
        issuer,
        authorization_endpoint: `${issuer}/oidc/auth`,
        token_endpoint: `${issuer}/oidc/token`,
        userinfo_endpoint: `${issuer}/oidc/userinfo`,
        jwks_uri: `${issuer}/oidc/jwks`,
        registration_endpoint: `${issuer}/oidc/register`,
        scopes_supported: [
          "openid",
          "profile",
          "email",
          "groups",
          "offline_access",
        ],
        response_types_supported: ["code", "token", "id_token"],
        response_modes_supported: ["fragment", "form_post"],
        grant_types_supported: [
          "authorization_code",
          "refresh_token",
          "client_credentials",
        ],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: oidcSigningKey
          ? ["RS256"]
          : ["HS256"],
        token_endpoint_auth_methods_supported: [
          "client_secret_basic",
          "client_secret_post",
        ],
        claims_supported: [
          "sub",
          "iss",
          "aud",
          "exp",
          "iat",
          "auth_time",
          "amr",
          "groups",
          "emails",
          "name",
          "preferred_username",
          "email",
          "email_verified",
        ],
        claims_parameter_supported: false,
        request_parameter_supported: false,
        request_uri_parameter_supported: false,
        require_request_uri_registration: false,
      });
    },
  );

  /**
   * GET /oidc/auth
   *
   * OIDC Authorization endpoint — initiates the authorization code flow.
   */
  app.get("/oidc/auth", (req: Request, res: Response) => {
    const { client_id, redirect_uri, response_type, scope, state, code_challenge, code_challenge_method, nonce } = req.query;

    // Validate client
    const client = config.oidc.clients.find(c => c.clientId === client_id);
    if (!client) {
      res.status(400).json({ error: 'invalid_client' });
      return;
    }

    // Validate redirect URI
    if (!client.redirectUris.includes(redirect_uri as string)) {
      res.status(400).json({ error: 'invalid_redirect_uri' });
      return;
    }

    // Generate authorization code (short-lived, single-use)
    const code = crypto.randomBytes(32).toString('hex');
    const codeExpires = Date.now() + 5 * 60 * 1000; // 5 minutes

    // Store code with its metadata
    authorizationCodes.set(code, {
      clientId: client_id as string,
      redirectUri: redirect_uri as string,
      scope: scope as string || 'openid',
      codeChallenge: code_challenge as string,
      codeChallengeMethod: code_challenge_method as string,
      nonce: nonce as string,
      expiresAt: codeExpires,
      used: false,
      sessionId: null,
    });

    // Build redirect URL
    const params = new URLSearchParams({ code });
    if (state) params.set('state', state as string);
    const redirectUrl = `${redirect_uri}?${params.toString()}`;

    res.redirect(302, redirectUrl);
  });

  /**
   * POST /oidc/token
   *
   * OIDC Token endpoint — exchanges authorization codes,
   * refresh tokens, or client credentials for tokens.
   */
  app.post("/oidc/token", tokenLimiter, async (req: Request, res: Response) => {
    try {
      const { grant_type, code, refresh_token, client_id, client_secret } =
        req.body;

      // Client authentication
      const client = config.oidc.clients.find((c) => c.clientId === client_id);
      if (!client) {
        res.status(401).json({
          error: "invalid_client",
          message: "Unknown client",
        });
        return;
      }

      if (client.clientSecret) {
        const secretBuffer = Buffer.from(client.clientSecret);
        const providedBuffer = Buffer.from(client_secret ?? '');
        if (secretBuffer.length !== providedBuffer.length ||
            !crypto.timingSafeEqual(secretBuffer, providedBuffer)) {
          res.status(401).json({
            error: "invalid_client",
            message: "Invalid client secret",
          });
          return;
        }
      }

      switch (grant_type) {
        case "client_credentials": {
          // Client credentials grant
          const now = Math.floor(Date.now() / 1000);
          const secret = new TextEncoder().encode(config.auth.jwtSecret);
          const accessToken = await new SignJWT({
            sub: client_id,
            aud: config.auth.jwtAudience,
            iat: now,
            client_id,
          })
            .setProtectedHeader({ alg: 'HS256' })
            .setIssuer(config.auth.jwtIssuer)
            .setExpirationTime(now + 3600)
            .sign(secret);

          res.json({
            access_token: accessToken,
            token_type: "Bearer",
            expires_in: 3600,
            scope: "openid",
          });
          return;
        }

        case "authorization_code": {
          const { code, code_verifier, redirect_uri } = req.body;

          if (!code) {
            res.status(400).json({ error: 'invalid_request', message: 'Authorization code is required' });
            return;
          }

          const codeData = authorizationCodes.get(code);
          if (!codeData || codeData.used || codeData.expiresAt < Date.now()) {
            res.status(400).json({ error: 'invalid_grant', message: 'Invalid, expired, or already used authorization code' });
            return;
          }

          // PKCE verification
          if (codeData.codeChallenge) {
            if (!code_verifier) {
              res.status(400).json({ error: 'invalid_grant', message: 'code_verifier is required for PKCE' });
              return;
            }
            if (!verifyPKCE(code_verifier, codeData.codeChallenge, codeData.codeChallengeMethod || 'S256')) {
              res.status(400).json({ error: 'invalid_grant', message: 'PKCE verification failed' });
              return;
            }
          }

          // Verify redirect_uri matches
          if (redirect_uri && redirect_uri !== codeData.redirectUri) {
            res.status(400).json({ error: 'invalid_grant', message: 'redirect_uri mismatch' });
            return;
          }

          // Mark code as used
          codeData.used = true;
          authorizationCodes.delete(code);

          // Generate tokens
          const now = Math.floor(Date.now() / 1000);
          const accessToken = await authenticator.generateAccessToken({
            id: codeData.sessionId || 'anonymous',
            username: codeData.clientId,
            groups: [],
            emails: [],
            authenticationLevel: 1,
            authenticationMethods: ['pwd'],
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          }, codeData.scope.split(' '));

          const refreshToken = await authenticator.generateRefreshToken({
            id: crypto.randomUUID(),
            username: codeData.clientId,
            groups: [],
            emails: [],
            authenticationLevel: 1,
            authenticationMethods: ['pwd'],
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
          });

          // Build id_token
          const idToken = codeData.nonce
            ? await authenticator.generateAccessToken({
                id: codeData.sessionId || 'anonymous',
                username: codeData.clientId,
                groups: [],
                emails: [],
                authenticationLevel: 1,
                authenticationMethods: ['pwd'],
                createdAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 3600000).toISOString(),
              }, ['openid', 'profile'])
            : undefined;

          res.json({
            access_token: accessToken,
            refresh_token: refreshToken,
            id_token: idToken,
            token_type: 'Bearer',
            expires_in: 3600,
            scope: codeData.scope,
          });
          return;
        }

        case "refresh_token": {
          if (!refresh_token || typeof refresh_token !== 'string') {
            res.status(400).json({ error: 'invalid_request', message: 'refresh_token is required' });
            return;
          }
          const rtPayload = await authenticator.verifyRefreshToken(refresh_token);
          if (!rtPayload || typeof rtPayload.session_id !== 'string') {
            res.status(401).json({ error: 'invalid_grant', message: 'Invalid or expired refresh token' });
            return;
          }
          const session = await sessionStore.getSession(rtPayload.session_id);
          if (!session) {
            res.status(401).json({ error: 'invalid_grant', message: 'Session expired' });
            return;
          }
          const newAccessToken = await authenticator.generateAccessToken(session, ['openid', 'profile', 'email']);
          const newRefreshToken = await authenticator.generateRefreshToken(session);
          const now = Math.floor(Date.now() / 1000);
          const idSecret = new TextEncoder().encode(config.auth.jwtSecret);
          const idToken = await new SignJWT({
            sub: session.username,
            aud: config.auth.jwtAudience,
            iat: now,
            auth_time: now,
            session_id: session.id,
          })
            .setProtectedHeader({ alg: 'HS256' })
            .setIssuer(config.auth.jwtIssuer)
            .setExpirationTime(now + 3600)
            .sign(idSecret);
          res.json({
            access_token: newAccessToken,
            refresh_token: newRefreshToken,
            token_type: 'Bearer',
            expires_in: 3600,
            id_token: idToken,
          });
          return;
        }

        default:
          res.status(400).json({
            error: "unsupported_grant_type",
            message: `Grant type '${grant_type}' is not supported`,
          });
      }
    } catch (err) {
      console.error("[AuthService] Token error:", err);
      res.status(500).json({
        error: "internal_error",
        message: "An internal error occurred",
      });
    }
  });

  /**
   * GET /oidc/userinfo
   *
   * OIDC UserInfo endpoint — returns claims about the
   * authenticated user.
   */
  app.get("/oidc/userinfo", async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        res.status(401).json({
          error: "invalid_token",
          message: "Bearer token required",
        });
        return;
      }

      const token = authHeader.slice(7);
      const payload = await authenticator.verifyAccessToken(token);

      if (!payload) {
        res.status(401).json({
          error: "invalid_token",
          message: "Invalid or expired token",
        });
        return;
      }

      // Look up full session for accurate data
      const sessionId = payload.session_id as string | undefined;
      let session: UserSession | null = null;

      if (sessionId) {
        session = await sessionStore.getSession(sessionId);
      }

      const username = session?.username ?? (payload.sub as string);
      const amr = SessionStore.buildAmrClaims(
        session?.authenticationLevel ?? AuthLevel.OneFactor,
        session?.authenticationMethods ?? [],
      );

      // Build userinfo response per OpenID Connect Core 1.0
      res.json({
        sub: payload.sub,
        name: username,
        preferred_username: username,
        groups: session?.groups ?? payload.groups ?? [],
        email: session?.emails[0] ?? payload.email ?? "",
        email_verified: true,
        amr,
        auth_time: payload.auth_time,
      });
    } catch (err) {
      console.error("[AuthService] UserInfo error:", err);
      res.status(500).json({
        error: "internal_error",
        message: "An internal error occurred",
      });
    }
  });

  /**
   * GET /oidc/jwks
   *
   * JWKS endpoint — returns the public keys used to verify
   * signed tokens.
   */
  app.get("/oidc/jwks", (_req: Request, res: Response) => {
    if (!oidcVerificationKey) {
      // No asymmetric keys configured; return empty key set.
      // Clients should use HS256 verification via the shared secret.
      res.json({ keys: [] });
      return;
    }

    try {
      const jwk = crypto.createPublicKey(oidcVerificationKey).export({
        format: "jwk",
      });

      res.json({
        keys: [
          {
            ...jwk,
            kid: oidcKeyId,
            use: "sig",
            alg: "RS256",
          },
        ],
      });
    } catch (err) {
      console.error("[AuthService] JWKS error:", err);
      res.status(500).json({
        error: "internal_error",
        message: "Failed to export JWK",
      });
    }
  });

  // ──────── RBAC-Authorized Example Route ──────────────────

  /**
   * GET /api/protected
   *
   * Example of a protected route that requires at least
   * one-factor authentication.
   */
  app.get("/api/protected", authzMiddleware, (_req: Request, res: Response) => {
    res.json({
      message: "You have accessed a protected resource",
    });
  });

  // ──────── Error Handler ──────────────────────────────────

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[AuthService] Unhandled error:", err);
    res.status(500).json({
      error: "internal_error",
      message: "An unexpected error occurred",
    });
  });

  // ── Return State ─────────────────────────────────────────

  return {
    app,
    sessionStore,
    authenticator,
    authorizer,
    userProvider,
    server: null,
    oidcSigningKey,
    oidcVerificationKey,
    oidcKeyId,
  };
}

// ─── Start Server ───────────────────────────────────────────

/**
 * Start the auth service server.
 */
export async function startAuthService(
  config: AuthServiceConfig,
): Promise<AppState> {
  const state = await createAuthService(config);
  const port = config.port ?? 9000;
  const host = config.host ?? "0.0.0.0";

  state.server = state.app.listen(port, host, () => {
    console.log(`[AuthService] Listening on http://${host}:${port}`);
    console.log(`[AuthService] OIDC Issuer: ${config.oidc.issuer}`);
    console.log(
      `[AuthService] Session store: ${config.session.redisUrl ? "Redis" : "In-Memory"}`,
    );
  });

  return state;
}

// ─── Middleware Helpers ──────────────────────────────────────

/**
 * Middleware that extracts a session from the request cookie
 * and attaches it to res.locals.session. Returns 401 if
 * no valid session is found.
 */
function requireAuth(sessionStore: SessionStore, config: AuthServiceConfig) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const cookieName = config.session.cookieName ?? "codenexus_session";
    const encryptedCookie = req.cookies?.[cookieName];

    if (!encryptedCookie) {
      res.status(401).json({
        error: "authentication_required",
        message: "Authentication required",
      });
      return;
    }

    const session = await sessionStore.restoreFromCookie(encryptedCookie);
    if (!session) {
      res.status(401).json({
        error: "session_expired",
        message: "Session expired or invalid",
      });
      return;
    }

    res.locals.session = session;
    next();
  };
}

/**
 * Simple request logger middleware.
 */
function requestLogger(req: Request, _res: Response, next: NextFunction): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  next();
}

/**
 * CORS headers middleware.
 */
function corsHeaders(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',').map(s => s.trim()).filter(Boolean);

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, DELETE, OPTIONS',
  );
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
}

// ─── Standalone Entry Point ─────────────────────────────────

// When running directly (not imported as a module)
if (require.main === module) {
  (async () => {
    try {
      const config: AuthServiceConfig = {
        port: parseInt(process.env.AUTH_PORT ?? "9000", 10),
        host: process.env.AUTH_HOST ?? "0.0.0.0",
        session: {
          encryptionKey:
            process.env.SESSION_ENCRYPTION_KEY ??
            (() => {
              throw new Error(
                "SESSION_ENCRYPTION_KEY environment variable is required",
              );
            })(),
          ttlSeconds: parseInt(process.env.SESSION_TTL ?? "3600", 10),
          redisUrl: process.env.REDIS_URL ?? "",
          cookieName: process.env.COOKIE_NAME ?? "codenexus_session",
          cookieDomain: process.env.COOKIE_DOMAIN,
          cookieSecure: process.env.COOKIE_SECURE !== "false",
        },
        auth: {
          passwordPepper:
            process.env.AUTH_PASSWORD_PEPPER ??
            (() => {
              throw new Error(
                "AUTH_PASSWORD_PEPPER environment variable is required",
              );
            })(),
          jwtSecret:
            process.env.AUTH_JWT_SECRET ??
            (() => {
              throw new Error(
                "AUTH_JWT_SECRET environment variable is required",
              );
            })(),
          jwtIssuer:
            process.env.AUTH_JWT_ISSUER ?? "https://auth.codenexus.dev",
          jwtAudience: process.env.AUTH_JWT_AUDIENCE ?? "codenexus-api",
          totpIssuer: process.env.AUTH_TOTP_ISSUER ?? "CodeNexus",
        },
        oidc: {
          issuer: process.env.OIDC_ISSUER ?? "https://auth.codenexus.dev",
          clients: [],
          signingKeyPath: process.env.OIDC_SIGNING_KEY_PATH,
          verificationKeyPath: process.env.OIDC_VERIFICATION_KEY_PATH,
        },
        accessControl: [],
        defaultPolicy: Policy.Deny,
        usersFile: process.env.AUTH_USERS_FILE,
        trustProxy: process.env.TRUST_PROXY === "true",
      };

      // Parse OIDC clients from environment
      const clientsJson = process.env.OIDC_CLIENTS;
      if (clientsJson) {
        try {
          config.oidc.clients = JSON.parse(clientsJson);
        } catch {
          console.error("[AuthService] Invalid OIDC_CLIENTS JSON");
        }
      }

      // Parse access control rules from environment
      const rulesJson = process.env.ACCESS_CONTROL_RULES;
      if (rulesJson) {
        try {
          config.accessControl = JSON.parse(rulesJson);
        } catch {
          console.error("[AuthService] Invalid ACCESS_CONTROL_RULES JSON");
        }
      }

      await startAuthService(config);
    } catch (err) {
      console.error("[AuthService] Failed to start:", err);
      process.exit(1);
    }
  })();
}
