'use client';

import { useState } from 'react';
import { useAuth } from '@/providers/auth-provider';

export function LoginScreen() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Invalid credentials';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen flex items-center justify-center bg-canvas">
      <div className="w-full max-w-sm mx-4">
        <div className="text-center mb-8">
          <h1 className="text-xl font-semibold text-fg-primary tracking-tight">CodeNexus</h1>
          <p className="text-sm text-fg-muted mt-1">Decision Cockpit</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="username" className="sr-only">Username</label>
            <input
              id="username"
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-2.5 bg-surface border border-border-subtle rounded-lg text-sm text-fg-primary placeholder:text-fg-disabled focus:border-intent-action focus:outline-none transition-colors"
              autoComplete="username"
              aria-describedby={error ? 'login-error' : undefined}
              autoFocus
              required
            />
          </div>
          <div>
            <label htmlFor="password" className="sr-only">Password</label>
            <input
              id="password"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 bg-surface border border-border-subtle rounded-lg text-sm text-fg-primary placeholder:text-fg-disabled focus:border-intent-action focus:outline-none transition-colors"
              autoComplete="current-password"
              aria-describedby={error ? 'login-error' : undefined}
              required
            />
          </div>
          {error && (
            <p id="login-error" role="alert" className="text-xs text-intent-critical">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-intent-action text-white rounded-lg text-sm font-medium hover:bg-intent-action-hover disabled:opacity-50 transition-colors"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
