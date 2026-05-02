import {
  createAuthService,
  type AuthServiceConfig,
} from '../../../auth-service/src/index';
import { AuthLevel, Policy } from '../../../shared/src/types';
import {
  AnalyticsCollector,
  createAnalyticsRouter,
} from '../../../analytics/src/index';
import argon2 from 'argon2';

// --- Test keys (shared across auth and analytics services) ---
export const TEST_JWT_SECRET = 'test-jwt-secret-for-e2e-tests-2026';
export const TEST_ENCRYPTION_KEY = 'abcd'.repeat(16);
export const TEST_PEPPER = 'e2e-test-pepper';
export const TEST_ISSUER = 'https://test.local';
export const TEST_AUDIENCE = 'codenexus-api';

// Set env vars for analytics JWT auth middleware
process.env.AUTH_JWT_SECRET = TEST_JWT_SECRET;
process.env.AUTH_JWT_ISSUER = TEST_ISSUER;
process.env.TEST_MODE = 'true';

// --- API response types for test assertions ---

export interface LoginSuccess {
  success: true;
  accessToken: string;
  sessionId: string;
  authenticationLevel: number;
  requiresTwoFactor: boolean;
  expiresAt: string;
}

export interface LoginFailure {
  success: false;
  error: string;
  message: string;
  remainingAttempts?: number;
  remainingLockout?: number;
}

export interface TOTPEnrollResponse {
  secret: string;
  uri: string;
  qrCodeUrl: string;
}

export interface SessionInfo {
  authenticated: boolean;
  session?: {
    id: string;
    username: string;
    groups: string[];
    emails: string[];
    authenticationLevel: number;
    authenticationMethods: string[];
    createdAt: string;
    expiresAt: string;
  };
}

export interface DashboardData {
  totalPRsReviewed: number;
  totalFixesApplied: number;
  averageFixTime: number;
  botVsHumanRatio: number;
  topRepositories: string[];
  recentActivity: unknown[];
  securityAlerts: number;
}

// --- Test user setup ---

export async function createTestUser(
  username: string,
  password: string,
  groups: string[] = [],
) {
  const hash = await argon2.hash(password + TEST_PEPPER);
  return {
    username,
    displayName: username.charAt(0).toUpperCase() + username.slice(1),
    password: hash,
    emails: [`${username}@test.local`],
    groups,
    disabled: false,
  };
}

// --- Auth service startup (in-memory, no Redis) ---

export async function startTestAuthService(initialUsers: any[] = []) {
  if (!initialUsers.length) {
    initialUsers = [await createTestUser('admin', 'admin123', ['admin'])];
  }

  const config: AuthServiceConfig = {
    session: {
      encryptionKey: TEST_ENCRYPTION_KEY,
      redisUrl: '',
      cookieSecure: false,
      cookieName: 'codenexus_session',
    },
    auth: {
      passwordPepper: TEST_PEPPER,
      jwtSecret: TEST_JWT_SECRET,
      jwtIssuer: TEST_ISSUER,
      jwtAudience: TEST_AUDIENCE,
      totpIssuer: 'CodeNexus',
    },
    oidc: {
      issuer: TEST_ISSUER,
      clients: [
        {
          clientId: 'test-client',
          clientSecret: 'test-client-secret',
          redirectUris: ['http://localhost/callback'],
          grantTypes: ['client_credentials'],
          scopes: ['openid'],
        },
      ],
    },
    accessControl: [],
    defaultPolicy: Policy.Deny,
    initialUsers,
  };

  const state = await createAuthService(config);
  return state;
}

// --- Analytics service startup ---

export function startTestAnalytics() {
  const collector = new AnalyticsCollector();
  const router = createAnalyticsRouter(collector);
  return { collector, router };
}

// --- Login helper ---

export async function loginAs(
  request: any,
  baseURL: string,
  username: string,
  password: string,
) {
  const res = await request.post(`${baseURL}/api/auth/login`, {
    data: { username, password },
  });
  const body = await res.json();
  const setCookie = res.headers()['set-cookie'];
  // Extract only the session cookie (codenexus_session), not refresh token cookie
  const cookie = typeof setCookie === 'string'
    ? setCookie.split(',').find((c: string) => c.trim().startsWith('codenexus_session'))
    : setCookie;
  return { statusCode: res.status(), body, cookie: cookie || '' };
}

// --- Auth header helper ---

export function getAuthHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}
