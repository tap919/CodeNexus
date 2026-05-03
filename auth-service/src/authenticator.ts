/**
 * CodeNexus Auth Service — Authenticator
 *
 * Core authentication engine fusing authelia's patterns:
 *   - Password verification with Argon2id
 *   - TOTP generation and validation (RFC 6238)
 *   - Session creation and validation
 *   - User provider abstraction (file-based, LDAP-compatible)
 */

import * as crypto from 'node:crypto';
import argon2 from 'argon2';
import { SignJWT, jwtVerify } from 'jose';
import {
  AuthLevel,
  UserSession,
} from '../../shared/src/types';
import { SessionStore } from './session-store';

// ─── Configuration ───────────────────────────────────────────

export interface AuthenticatorConfig {
  /** Pepper added to passwords before hashing. */
  passwordPepper: string;
  /** Secret for signing JWT tokens */
  jwtSecret: string;
  /** JWT issuer claim */
  jwtIssuer: string;
  /** JWT audience claim */
  jwtAudience: string;
  /** TOTP issuer name for authenticator apps */
  totpIssuer: string;
  /** Session TTL in seconds (default: 1 hour) */
  sessionTtlSeconds?: number;
  /** Maximum age for a password reset token (seconds, default: 900) */
  resetTokenTtlSeconds?: number;
}

// ─── User Provider Interface ─────────────────────────────────

/**
 * Abstract user provider — supports file-based, LDAP, or any backend.
 *
 * Fused from authelia's UserProvider abstraction.
 */
export interface UserProvider {
  /** Look up a user by username. Returns null if not found. */
  getUser(username: string): Promise<UserRecord | null>;
  /** Verify the user's password against the stored hash. */
  verifyPassword?(username: string, password: string): Promise<boolean>;
  /** Look up a user's TOTP secret. Returns null if not enrolled. */
  getTOTPSecret(username: string): Promise<string | null>;
  /** Store/update a user's TOTP secret during enrollment. */
  setTOTPSecret(username: string, secret: string): Promise<void>;
  /** Record a failed authentication attempt. */
  recordFailedAttempt?(username: string): Promise<void>;
  /** Get the number of consecutive failed attempts. */
  getFailedAttempts?(username: string): Promise<number>;
  /** Reset the failed attempts counter. */
  resetFailedAttempts?(username: string): Promise<void>;
}

/** A user record returned by the provider. */
export interface UserRecord {
  id: string;
  username: string;
  displayName: string;
  emails: string[];
  groups: string[];
  /** Argon2id password hash (if provider does its own verification, this can be empty) */
  passwordHash: string;
  /** Whether the user has TOTP enrolled */
  totpEnrolled: boolean;
  /** Whether the account is disabled */
  disabled: boolean;
}

// ─── Built-in: File-Based User Provider ──────────────────────

export interface FileUserEntry {
  username: string;
  displayName: string;
  password: string; // plaintext (will be hashed) or argon2 hash prefixed with $argon2
  emails: string[];
  groups: string[];
  totpSecret?: string;
  disabled?: boolean;
}

export interface FileUserProviderConfig {
  /** Path to a JSON file containing an array of FileUserEntry */
  usersPath: string;
  /** Password pepper (same as AuthenticatorConfig.passwordPepper) */
  pepper: string;
}

/**
 * File-based user provider.
 * Reads users from a JSON file. Supports both plaintext and pre-hashed passwords.
 * Emulates an LDAP-compatible interface.
 */
export class FileUserProvider implements UserProvider {
  private users: Map<string, FileUserEntry & { passwordHash: string }> =
    new Map();
  private failedAttempts: Map<string, number> = new Map();
  private readonly pepper: string;

  constructor(config: FileUserProviderConfig & { initialUsers?: FileUserEntry[] }) {
    this.pepper = config.pepper;

    const entries = config.initialUsers ?? [];
    if (config.usersPath) {
      // In production, the JSON file is loaded at startup by the caller
      // and passed to loadUsers(). This constructor accepts initialUsers
      // for testing and embedded configurations.
    }

    // Users are added async via loadUsers(). The constructor stores
    // initial entries for async batch loading.
    this.pendingInit = entries;
  }

  private pendingInit: FileUserEntry[] = [];

  /** Initialize — hashes all pending plaintext passwords. Call after construction. */
  async init(): Promise<void> {
    for (const entry of this.pendingInit) {
      await this.addUser(entry);
    }
    this.pendingInit = [];
  }

  /** Load users from a parsed JSON array. */
  async loadUsers(entries: FileUserEntry[]): Promise<void> {
    for (const entry of entries) {
      await this.addUser(entry);
    }
  }

  private async addUser(entry: FileUserEntry): Promise<void> {
    // If the password is already an argon2 hash, use it directly
    const passwordHash = entry.password.startsWith('$argon2')
      ? entry.password
      : await argon2Hash(entry.password, this.pepper);

    this.users.set(entry.username, {
      ...entry,
      passwordHash,
    });
  }

  async getUser(username: string): Promise<UserRecord | null> {
    const entry = this.users.get(username);
    if (!entry) return null;

    return {
      id: username,
      username: entry.username,
      displayName: entry.displayName,
      emails: entry.emails,
      groups: entry.groups,
      passwordHash: entry.passwordHash,
      totpEnrolled: !!entry.totpSecret,
      disabled: entry.disabled ?? false,
    };
  }

  async getTOTPSecret(username: string): Promise<string | null> {
    const entry = this.users.get(username);
    return entry?.totpSecret ?? null;
  }

  async setTOTPSecret(username: string, secret: string): Promise<void> {
    const entry = this.users.get(username);
    if (entry) {
      entry.totpSecret = secret;
    }
  }

  async recordFailedAttempt(username: string): Promise<void> {
    const current = this.failedAttempts.get(username) ?? 0;
    this.failedAttempts.set(username, current + 1);
  }

  async getFailedAttempts(username: string): Promise<number> {
    return this.failedAttempts.get(username) ?? 0;
  }

  async resetFailedAttempts(username: string): Promise<void> {
    this.failedAttempts.delete(username);
  }
}

// ─── Native TOTP (RFC 6238) ──────────────────────────────────

function base32Encode(buf: Buffer): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let result = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      result += alphabet[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    result += alphabet[(value << (5 - bits)) & 0x1f];
  }
  return result;
}

function generateTOTPSecret(length = 20): string {
  return base32Encode(crypto.randomBytes(length));
}

function base32Decode(str: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  str = str.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  const bits: number[] = [];
  for (const char of str) {
    const val = alphabet.indexOf(char);
    if (val === -1) throw new Error('Invalid base32 character');
    bits.push(val >> 4 & 1, val >> 3 & 1, val >> 2 & 1, val >> 1 & 1, val & 1);
  }
  const bytes: number[] = [];
  for (let i = 0; i + 7 < bits.length; i += 8) {
    bytes.push((bits[i] << 7) | (bits[i + 1] << 6) | (bits[i + 2] << 5) | (bits[i + 3] << 4) |
               (bits[i + 4] << 3) | (bits[i + 5] << 2) | (bits[i + 6] << 1) | bits[i + 7]);
  }
  return Buffer.from(bytes);
}

function verifyTOTP(token: string, secret: string, window = 1): boolean {
  for (let w = -window; w <= window; w++) {
    const counter = Math.floor(Date.now() / 1000 / 30) + w;
    const counterBuf = Buffer.alloc(8);
    counterBuf.writeBigUInt64BE(BigInt(Math.max(0, counter)), 0);
    try {
      const key = base32Decode(secret);
      const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
      const offset = hmac[hmac.length - 1] & 0x0f;
      const code = ((hmac[offset] & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8) |
        (hmac[offset + 3] & 0xff);
      const expected = (code % 10 ** 6).toString().padStart(6, '0');
      if (token === expected) return true;
    } catch {
      continue;
    }
  }
  return false;
}

// ─── Authenticator Class ────────────────────────────────────

export class Authenticator {
  private readonly config: Required<AuthenticatorConfig>;
  private readonly sessionStore: SessionStore;
  private userProvider: UserProvider;

  constructor(
    config: AuthenticatorConfig,
    sessionStore: SessionStore,
    userProvider: UserProvider
  ) {
    this.config = {
      sessionTtlSeconds: 3600,
      resetTokenTtlSeconds: 900,
      ...config,
    };
    this.sessionStore = sessionStore;
    this.userProvider = userProvider;
  }

  /** Replace the user provider at runtime (e.g., swap file → LDAP). */
  setUserProvider(provider: UserProvider): void {
    this.userProvider = provider;
  }

  // ─── First-Factor: Password Authentication ────────────────

  /**
   * Authenticate a user with username + password (first factor).
   *
   * Steps:
   * 1. Look up user by username
   * 2. Check account is not disabled
   * 3. Check brute-force threshold
   * 4. Verify password with Argon2id
   * 5. Create an AuthLevel.OneFactor session
   * 6. Return session + encrypted cookie
   */
  async authenticatePassword(
    username: string,
    password: string,
  ): Promise<PasswordAuthResult> {
    // 1. Look up user
    const user = await this.userProvider.getUser(username);
    if (!user) {
      return {
        success: false,
        error: 'invalid_credentials',
        message: 'Invalid username or password',
      };
    }

    // 2. Account disabled check
    if (user.disabled) {
      return {
        success: false,
        error: 'account_disabled',
        message: 'This account has been disabled',
      };
    }

    // 3. Brute-force check
    const attempts = await this.userProvider.getFailedAttempts?.(username) ?? 0;
    if (attempts >= 5) {
      return {
        success: false,
        error: 'account_locked',
        message: 'Account temporarily locked due to too many failed attempts',
        remainingLockout: this.getLockoutRemaining(attempts),
      };
    }

    // 4. Verify password
    const passwordValid = await this.verifyPassword(user, password);
    if (!passwordValid) {
      await this.userProvider.recordFailedAttempt?.(username);
      const remaining = 5 - (attempts + 1);
      return {
        success: false,
        error: 'invalid_credentials',
        message: 'Invalid username or password',
        remainingAttempts: Math.max(0, remaining),
      };
    }

    // Reset failed attempts on success
    await this.userProvider.resetFailedAttempts?.(username);

    // 5. Create session
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.sessionTtlSeconds * 1000);

    const session: UserSession = {
      id: crypto.randomUUID(),
      username: user.username,
      groups: user.groups,
      emails: user.emails,
      authenticationLevel: AuthLevel.OneFactor,
      authenticationMethods: ['pwd'],
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    // 6. Persist and encrypt
    const encryptedCookie = await this.sessionStore.createSession(session);

    // Generate a one-time JWT for OIDC token exchange
    const accessToken = await this.generateAccessToken(session);
    const refreshToken = await this.generateRefreshToken(session);

    return {
      success: true,
      session,
      encryptedCookie,
      accessToken,
      refreshToken,
      requiresTwoFactor: user.totpEnrolled,
    };
  }

  // ─── Second-Factor: TOTP Authentication ───────────────────

  /**
   * Verify a TOTP token for a given session (second factor).
   *
   * Steps:
   * 1. Load the session
   * 2. Get the user's TOTP secret from the provider
   * 3. Validate the token
   * 4. Upgrade the session to AuthLevel.TwoFactor
   */
  async authenticateTOTP(
    sessionId: string,
    token: string
  ): Promise<TOTPAuthResult> {
    // 1. Load session
    const session = await this.sessionStore.getSession(sessionId);
    if (!session) {
      return {
        success: false,
        error: 'session_not_found',
        message: 'Session not found or expired',
      };
    }

    // 2. Get TOTP secret
    const secret = await this.userProvider.getTOTPSecret(session.username);
    if (!secret) {
      return {
        success: false,
        error: 'totp_not_enrolled',
        message: 'TOTP is not enrolled for this account',
      };
    }

    // 3. Validate token
    const isValid = verifyTOTP(token, secret);
    if (!isValid) {
      return {
        success: false,
        error: 'invalid_totp',
        message: 'Invalid TOTP token',
      };
    }

    // 4. Upgrade session
    await this.sessionStore.updateAuthenticationLevel(
      sessionId,
      AuthLevel.TwoFactor,
      ['otp']
    );

    const upgraded = await this.sessionStore.getSession(sessionId);

    return {
      success: true,
      session: upgraded!,
    };
  }

  // ─── TOTP Enrollment ──────────────────────────────────────

  /**
   * Generate a new TOTP secret for a user, returning the secret
   * and an otpauth:// URI for QR code rendering.
   */
  async enrollTOTP(
    username: string
  ): Promise<{ secret: string; uri: string; qrCodeUrl: string }> {
    const secret = generateTOTPSecret();
    await this.userProvider.setTOTPSecret(username, secret);

    const label = encodeURIComponent(`${this.config.totpIssuer}:${username}`);
    const issuer = encodeURIComponent(this.config.totpIssuer);
    const uri = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;

    return { secret, uri, qrCodeUrl: uri };
  }

  /**
   * Verify a TOTP token during enrollment (to confirm the user
   * has correctly set up their authenticator app).
   */
  verifyTOTPEnrollment(username: string, token: string): Promise<boolean> {
    return this.verifyTOTP(username, token);
  }

  // ─── Session Validation ───────────────────────────────────

  /**
   * Validate a session from an encrypted cookie.
   * Returns the session if valid, null otherwise.
   */
  async validateSessionFromCookie(
    encryptedCookie: string
  ): Promise<UserSession | null> {
    return this.sessionStore.restoreFromCookie(encryptedCookie);
  }

  /**
   * Validate a session by ID.
   */
  async validateSession(sessionId: string): Promise<UserSession | null> {
    return this.sessionStore.getSession(sessionId);
  }

  /**
   * End a session (logout).
   */
  async destroySession(sessionId: string): Promise<void> {
    await this.sessionStore.deleteSession(sessionId);
  }

  /**
   * Extend a session's TTL.
   */
  async touchSession(sessionId: string): Promise<void> {
    await this.sessionStore.touchSession(sessionId);
  }

  // ─── Utility: Verify password against stored hash ─────────

  private async verifyPassword(
    user: UserRecord,
    password: string
  ): Promise<boolean> {
    // If the user provider has its own verification method, delegate
    if (this.userProvider.verifyPassword) {
      return this.userProvider.verifyPassword(user.username, password);
    }

    // Apply pepper before verification
    const pepperedPassword = password + this.config.passwordPepper;

    // Otherwise, verify against the stored Argon2id hash
    try {
      return await argon2.verify(user.passwordHash, pepperedPassword);
    } catch {
      return false;
    }
  }

  // ─── JWT Token Generation ─────────────────────────────────

  /**
   * Generate a signed JWT access token for OIDC flows.
   * Uses HS256 for HMAC secrets, RS256 for RSA keys.
   */
  async generateAccessToken(session: UserSession, scopes?: string[]): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const amr = SessionStore.buildAmrClaims(
      session.authenticationLevel,
      session.authenticationMethods
    );
    const secret = new TextEncoder().encode(this.config.jwtSecret);
    const alg = this.config.jwtSecret.includes('-----BEGIN') ? 'RS256' : 'HS256';

    const payload: Record<string, unknown> = {
      sub: session.username,
      aud: this.config.jwtAudience,
      auth_time: Math.floor(new Date(session.createdAt).getTime() / 1000),
      amr,
      groups: session.groups,
      emails: session.emails,
      session_id: session.id,
      authentication_level: session.authenticationLevel,
    };

    if (scopes?.includes('profile')) {
      payload.name = session.username;
      payload.preferred_username = session.username;
    }
    if (scopes?.includes('email')) {
      payload.email = session.emails[0] ?? '';
      payload.email_verified = true;
    }

    return new SignJWT(payload)
      .setProtectedHeader({ alg })
      .setIssuer(this.config.jwtIssuer)
      .setIssuedAt(now)
      .setExpirationTime(now + this.config.sessionTtlSeconds)
      .sign(secret);
  }

  /**
   * Generate a signed JWT refresh token for token rotation.
   * Uses HS256 for HMAC secrets, RS256 for RSA keys.
   * Refresh tokens have a 24x longer TTL than access tokens.
   */
  async generateRefreshToken(session: UserSession): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const secret = new TextEncoder().encode(this.config.jwtSecret);
    const alg = this.config.jwtSecret.includes('-----BEGIN') ? 'RS256' : 'HS256';

    return new SignJWT({
      sub: session.username,
      aud: this.config.jwtAudience,
      iat: now,
      jti: crypto.randomUUID(),
      session_id: session.id,
      token_type: 'refresh',
    })
      .setProtectedHeader({ alg })
      .setIssuer(this.config.jwtIssuer)
      .setExpirationTime(now + (this.config.sessionTtlSeconds ?? 3600) * 24)
      .sign(secret);
  }

  /**
   * Verify and decode a refresh token. Returns the payload or null.
   * Only accepts tokens with token_type === 'refresh'.
   */
  async verifyRefreshToken(token: string): Promise<Record<string, unknown> | null> {
    try {
      const secret = new TextEncoder().encode(this.config.jwtSecret);
      const alg = this.config.jwtSecret.includes('-----BEGIN') ? 'RS256' : 'HS256';
      const { payload } = await jwtVerify(token, secret, {
        algorithms: [alg],
        issuer: this.config.jwtIssuer,
        audience: this.config.jwtAudience,
      });
      if (payload.token_type !== 'refresh') return null;
      return payload as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /**
   * Verify and decode an access token. Returns the payload or null.
   * Restricts accepted algorithms to prevent algorithm confusion attacks.
   */
  async verifyAccessToken(token: string): Promise<Record<string, unknown> | null> {
    try {
      const secret = new TextEncoder().encode(this.config.jwtSecret);
      const alg = this.config.jwtSecret.includes('-----BEGIN') ? 'RS256' : 'HS256';
      const { payload } = await jwtVerify(token, secret, {
        issuer: this.config.jwtIssuer,
        audience: this.config.jwtAudience,
        algorithms: [alg],
      });
      return payload as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  // ─── Private: TOTP Verification ───────────────────────────

  private async verifyTOTP(
    username: string,
    token: string
  ): Promise<boolean> {
    const secret = await this.userProvider.getTOTPSecret(username);
    if (!secret) return false;
    try {
      return verifyTOTP(token, secret);
    } catch {
      return false;
    }
  }

  // ─── Private: Lockout ─────────────────────────────────────

  private getLockoutRemaining(attempts: number): number {
    // Exponential backoff: 30s, 60s, 120s, 240s, 480s...
    const lockoutSeconds = Math.min(30 * Math.pow(2, attempts - 5), 3600);
    return lockoutSeconds;
  }
}

// ─── Standalone Utility: Argon2id Hash ──────────────────────

/**
 * Asynchronously hash a password with Argon2id and a pepper.
 * Used internally for the file-based provider.
 */
async function argon2Hash(password: string, pepper: string): Promise<string> {
  const peppered = password + pepper;
  return argon2.hash(peppered);
}

// ─── Result Types ────────────────────────────────────────────

export interface PasswordAuthResult {
  success: boolean;
  session?: UserSession;
  encryptedCookie?: string;
  accessToken?: string;
  refreshToken?: string;
  requiresTwoFactor?: boolean;
  remainingAttempts?: number;
  remainingLockout?: number;
  error?: string;
  message?: string;
}

export interface TOTPAuthResult {
  success: boolean;
  session?: UserSession;
  error?: string;
  message?: string;
}
