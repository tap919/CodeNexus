/**
 * CodeNexus Auth Service — Session Store
 *
 * Provides session persistence (Redis-backed or in-memory fallback),
 * AES-256-GCM encrypted cookie serialization, TTL management,
 * and Authentication Method Reference (AMR) tracking.
 *
 * Fused from authelia's session management patterns.
 */

import * as crypto from 'node:crypto';
import { createClient, RedisClientType } from 'redis';
import {
  AuthLevel,
  UserSession,
} from '../../shared/src/types';

// ─── Configuration ───────────────────────────────────────────

export interface SessionStoreConfig {
  /** AES-256-GCM encryption key (32 bytes, hex-encoded) */
  encryptionKey: string;
  /** Default session TTL in seconds (default: 1 hour) */
  ttlSeconds?: number;
  /** Redis connection string. If empty, uses in-memory store. */
  redisUrl?: string;
  /** Cookie name for the session token (default: 'codenexus_session') */
  cookieName?: string;
  /** Cookie domain */
  cookieDomain?: string;
  /** Whether the cookie should be HTTP-only (default: true) */
  cookieHttpOnly?: boolean;
  /** Whether the cookie should be secure (default: true) */
  cookieSecure?: boolean;
  /** SameSite policy (default: 'lax') */
  cookieSameSite?: 'strict' | 'lax' | 'none';
}

// ─── In-Memory Store ─────────────────────────────────────────

interface MemoryRecord {
  session: StoredSession;
  expiresAt: number;
}

interface StoredSession {
  id: string;
  username: string;
  groups: string[];
  emails: string[];
  authenticationLevel: AuthLevel;
  authenticationMethods: string[];
  createdAt: string;
  expiresAt: string;
  /** Encrypted payload for cookie round-tripping */
  encryptedBlob: string | null;
}

// ─── Session Store Class ─────────────────────────────────────

export class SessionStore {
  private readonly config: Required<SessionStoreConfig>;
  private redisClient: RedisClientType | null = null;
  private memoryStore: Map<string, MemoryRecord> = new Map();
  private memoryTtlCheckInterval: ReturnType<typeof setInterval> | null = null;
  private readonly encKey: Buffer;

  constructor(config: SessionStoreConfig) {
    this.config = {
      ttlSeconds: 3600,
      redisUrl: '',
      cookieName: 'codenexus_session',
      cookieDomain: '',
      cookieHttpOnly: true,
      cookieSecure: true,
      cookieSameSite: 'lax',
      ...config,
    };

    // Validate and derive encryption key
    const keyBytes = Buffer.from(this.config.encryptionKey, 'hex');
    if (keyBytes.length !== 32) {
      throw new Error(
        `SessionStore: encryptionKey must be 32 bytes (64 hex chars), got ${keyBytes.length} bytes`
      );
    }
    this.encKey = keyBytes;

    // Schedule in-memory TTL sweep every 60 seconds
    this.memoryTtlCheckInterval = setInterval(() => {
      this.sweepExpiredMemorySessions();
    }, 60_000);
    this.memoryTtlCheckInterval.unref();
  }

  // ─── Lifecycle ────────────────────────────────────────────

  /** Initialize the store (connect to Redis if configured). */
  async init(): Promise<void> {
    if (this.config.redisUrl) {
      this.redisClient = createClient({ url: this.config.redisUrl });
      this.redisClient.on('error', (err) => {
        console.error('[SessionStore] Redis error:', err);
      });
      await this.redisClient.connect();
    }
  }

  /** Gracefully shut down the store. */
  async destroy(): Promise<void> {
    if (this.memoryTtlCheckInterval) {
      clearInterval(this.memoryTtlCheckInterval);
      this.memoryTtlCheckInterval = null;
    }
    if (this.redisClient) {
      await this.redisClient.quit();
      this.redisClient = null;
    }
    this.memoryStore.clear();
  }

  // ─── Session CRUD ─────────────────────────────────────────

  /** Create a new session, persist it, and return the encrypted cookie value. */
  async createSession(session: UserSession): Promise<string> {
    const expiresAt = new Date(session.expiresAt).getTime();
    const stored: StoredSession = {
      ...session,
      encryptedBlob: null,
    };

    // Serialize + encrypt the session for the cookie
    const plaintext = JSON.stringify(session);
    const encrypted = this.aesEncrypt(plaintext);
    stored.encryptedBlob = encrypted;

    const record: MemoryRecord = {
      session: stored,
      expiresAt,
    };

    const key = this.sessionKey(session.id);

    if (this.redisClient) {
      await this.redisClient.set(key, JSON.stringify(stored), {
        PX: expiresAt - Date.now(),
      });
    } else {
      this.memoryStore.set(key, record);
    }

    return encrypted;
  }

  /** Retrieve a session by its ID. Returns null if not found or expired. */
  async getSession(sessionId: string): Promise<UserSession | null> {
    const key = this.sessionKey(sessionId);
    let record: StoredSession | null = null;

    if (this.redisClient) {
      const raw = await this.redisClient.get(key);
      if (raw) {
        record = JSON.parse(raw) as StoredSession;
      }
    } else {
      const mem = this.memoryStore.get(key);
      if (mem) {
        if (Date.now() > mem.expiresAt) {
          this.memoryStore.delete(key);
          return null;
        }
        record = mem.session;
      }
    }

    if (!record) return null;

    const now = Date.now();
    const exp = new Date(record.expiresAt).getTime();
    if (now > exp) {
      await this.deleteSession(sessionId);
      return null;
    }

    return this.toUserSession(record);
  }

  /** Restore a session from an encrypted cookie value. */
  async restoreFromCookie(encryptedBlob: string): Promise<UserSession | null> {
    try {
      const plaintext = this.aesDecrypt(encryptedBlob);
      const parsed = JSON.parse(plaintext) as UserSession;
      // Verify it still exists in the store and isn't expired
      const stored = await this.getSession(parsed.id);
      return stored;
    } catch {
      return null;
    }
  }

  /** Update the authentication level and methods on a session. */
  async updateAuthenticationLevel(
    sessionId: string,
    level: AuthLevel,
    methods: string[]
  ): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) return;

    session.authenticationLevel = level;
    session.authenticationMethods = [
      ...new Set([...session.authenticationMethods, ...methods]),
    ];

    // Re-save
    const expiresAt = new Date(session.expiresAt).getTime();
    const stored: StoredSession = {
      ...session,
      encryptedBlob: null,
    };
    const plaintext = JSON.stringify(session);
    stored.encryptedBlob = this.aesEncrypt(plaintext);

    const record: MemoryRecord = { session: stored, expiresAt };
    const key = this.sessionKey(sessionId);

    if (this.redisClient) {
      await this.redisClient.set(key, JSON.stringify(stored), {
        PX: expiresAt - Date.now(),
      });
    } else {
      this.memoryStore.set(key, record);
    }
  }

  /** Delete a session from the store. */
  async deleteSession(sessionId: string): Promise<void> {
    const key = this.sessionKey(sessionId);
    if (this.redisClient) {
      await this.redisClient.del(key);
    } else {
      this.memoryStore.delete(key);
    }
  }

  /** Touch a session — extend its TTL. */
  async touchSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) return;

    const newExpires = new Date(
      Date.now() + this.config.ttlSeconds * 1000
    ).toISOString();
    session.expiresAt = newExpires;

    await this.createSession(session);
  }

  // ─── Cookie Utilities ─────────────────────────────────────

  /** Generate cookie options for Express. */
  getCookieOptions(): {
    name: string;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'strict' | 'lax' | 'none';
    domain?: string;
    maxAge: number;
    path: string;
  } {
    return {
      name: this.config.cookieName,
      httpOnly: this.config.cookieHttpOnly,
      secure: this.config.cookieSecure,
      sameSite: this.config.cookieSameSite,
      domain: this.config.cookieDomain || undefined,
      maxAge: this.config.ttlSeconds * 1000,
      path: '/',
    };
  }

  // ─── Encryption (AES-256-GCM) ─────────────────────────────

  /**
   * Encrypt a plaintext string using AES-256-GCM.
   * Output format: hex(iv) : hex(authTag) : hex(ciphertext)
   */
  private aesEncrypt(plaintext: string): string {
    const iv = crypto.randomBytes(12); // 96-bit nonce for GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encKey, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  /**
   * Decrypt an AES-256-GCM encrypted string.
   * Input format: hex(iv) : hex(authTag) : hex(ciphertext)
   */
  private aesDecrypt(encrypted: string): string {
    const parts = encrypted.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted payload format');
    }
    const [ivHex, authTagHex, ciphertextHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encKey, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  // ─── AMR Helpers ──────────────────────────────────────────

  /**
   * Build AMR (Authentication Methods References) claims
   * per RFC 8176.
   */
  static buildAmrClaims(level: AuthLevel, methods: string[]): string[] {
    const amr = new Set<string>();

    if (level >= AuthLevel.OneFactor) {
      amr.add('pwd'); // Password authentication
    }
    if (level >= AuthLevel.TwoFactor) {
      amr.add('otp'); // Time-based OTP
    }
    for (const m of methods) {
      amr.add(m);
    }

    return [...amr];
  }

  // ─── Private Helpers ──────────────────────────────────────

  private sessionKey(id: string): string {
    return `codenexus:session:${id}`;
  }

  private sweepExpiredMemorySessions(): void {
    const now = Date.now();
    for (const [key, record] of this.memoryStore.entries()) {
      if (now > record.expiresAt) {
        this.memoryStore.delete(key);
      }
    }
  }

  private toUserSession(stored: StoredSession): UserSession {
    return {
      id: stored.id,
      username: stored.username,
      groups: stored.groups,
      emails: stored.emails,
      authenticationLevel: stored.authenticationLevel,
      authenticationMethods: stored.authenticationMethods,
      createdAt: stored.createdAt,
      expiresAt: stored.expiresAt,
    };
  }
}
