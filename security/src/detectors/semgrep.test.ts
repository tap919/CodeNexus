import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SemgrepScanner } from './semgrep';
import { Severity } from '../../../shared/src/types';
import { execSync } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

describe('SemgrepScanner', () => {
  beforeEach(() => {
    vi.mocked(execSync).mockReset();
  });

  it('detects semgrep availability', () => {
    vi.mocked(execSync).mockReturnValue('1.0.0');
    const scanner = new SemgrepScanner();
    expect(scanner).toBeDefined();
  });

  it('provides availability status', () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('not found'); });
    const scanner = new SemgrepScanner();
    expect((scanner as any).semgrepAvailable).toBe(false);
  });

  it('returns empty array when semgrep unavailable', async () => {
    const scanner = new SemgrepScanner();
    (scanner as any).semgrepAvailable = false;
    const results = await scanner.scan('/tmp');
    expect(results).toEqual([]);
  });

  it('parses semgrep JSON output correctly', async () => {
    const scanner = new SemgrepScanner();
    (scanner as any).semgrepAvailable = true;

    vi.mocked(execSync).mockReturnValue(JSON.stringify({
      results: [
        {
          check_id: 'python.lang.security.eval',
          extra: { message: 'eval() is dangerous', severity: 'ERROR', language: 'python' },
          path: '/tmp/test.py',
          start: { line: 5, col: 1 },
        },
        {
          check_id: 'python.lang.maintainability.debug-print',
          extra: { message: 'print() left in code', severity: 'INFO', language: 'python' },
          path: '/tmp/test.py',
          start: { line: 10, col: 1 },
        },
      ],
    }));

    const results = await scanner.scan('/tmp');
    expect(results).toHaveLength(2);
    expect(results[0].checkId).toBe('python.lang.security.eval');
    expect(results[0].severity).toBe(Severity.Critical);
    expect(results[1].severity).toBe(Severity.Medium);
    expect(results[0].line).toBe(5);
  });

  it('filters by rules when provided', async () => {
    const scanner = new SemgrepScanner();
    (scanner as any).semgrepAvailable = true;

    const output = JSON.stringify({
      results: [
        { check_id: 'r1', extra: { message: 'm', severity: 'WARNING', language: 'py' }, path: 'f.py', start: { line: 1, col: 1 } },
      ],
    });

    await scanner.scan('/tmp', 'p/python');
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('--config="p/python"'),
      expect.anything()
    );
  });

  it('handles empty semgrep output', async () => {
    const scanner = new SemgrepScanner();
    (scanner as any).semgrepAvailable = true;
    vi.mocked(execSync).mockReturnValue(JSON.stringify({ results: [] }));
    const results = await scanner.scan('/tmp');
    expect(results).toEqual([]);
  });

  it('handles semgrep execution failure', async () => {
    const scanner = new SemgrepScanner();
    (scanner as any).semgrepAvailable = true;
    vi.mocked(execSync).mockImplementation(() => { throw new Error('semgrep crashed'); });
    const results = await scanner.scan('/tmp');
    expect(results).toEqual([]);
  });

  it('maps semgrep severities correctly', async () => {
    const scanner = new SemgrepScanner();
    (scanner as any).semgrepAvailable = true;

    vi.mocked(execSync).mockReturnValue(JSON.stringify({
      results: [
        { check_id: 'e', extra: { message: 'm', severity: 'ERROR' }, path: 'f', start: { line: 1, col: 1 } },
        { check_id: 'w', extra: { message: 'm', severity: 'WARNING' }, path: 'f', start: { line: 2, col: 1 } },
        { check_id: 'i', extra: { message: 'm', severity: 'INFO' }, path: 'f', start: { line: 3, col: 1 } },
        { check_id: 'u', extra: { message: 'm' }, path: 'f', start: { line: 4, col: 1 } },
      ],
    }));

    const results = await scanner.scan('/tmp');
    expect(results[0].severity).toBe(Severity.Critical);
    expect(results[1].severity).toBe(Severity.High);
    expect(results[2].severity).toBe(Severity.Medium);
    expect(results[3].severity).toBe(Severity.Low);
  });
});
