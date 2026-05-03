import crypto from 'crypto';
import type { UserSession, AccessControlRule } from '../../../shared/src/types';
import type { ModuleAdapters } from '../orchestrator';
import { Authorizer } from '@codenexus/auth-service';

const authorizer = new Authorizer({});

export function createDefaultAuth(): ModuleAdapters['auth'] {
  return {
    async validateWebhook(payload: string, signature: string, secret: string): Promise<boolean> {
      if (!signature || !secret) return false;

      const expected = `sha256=${crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex')}`;

      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected),
      );
    },

    async authenticate(token: string): Promise<UserSession> {
      if (!token) {
        throw new Error('Authentication token required');
      }

      return {
        id: crypto.randomUUID(),
        username: 'codenexus-bot',
        groups: ['developers', 'reviewers'],
        emails: [],
        authenticationLevel: 2,
        authenticationMethods: ['github_oauth'],
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      };
    },

    async checkAccess(user: UserSession, rules: AccessControlRule[]): Promise<boolean> {
      if (!rules || rules.length === 0) return true;

      for (const rule of rules) {
        if (rule.policy === 'deny') {
          return false;
        }
        if (rule.subjects) {
          const matched = rule.subjects.some(s =>
            s === `user:${user.username}` || user.groups.some(g => s === `group:${g}`)
          );
          if (!matched) return false;
        }
      }

      return true;
    },
  };
}
