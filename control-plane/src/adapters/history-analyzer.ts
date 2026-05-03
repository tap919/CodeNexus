import { spawnSync } from 'child_process';

export interface FileHistory {
  filePath: string;
  commitCount30d: number;
  uniqueAuthors: string[];
  lastBugFixDate: string | null;
  churnSignal: 'high' | 'normal' | 'low';
  recentMessages: string[];
}

export class HistoryAnalyzer {
  constructor(private workspacePath: string) {}

  async analyzeFiles(filePaths: string[]): Promise<FileHistory[]> {
    return Promise.all(filePaths.map(f => this.analyzeFile(f)));
  }

  private async analyzeFile(filePath: string): Promise<FileHistory> {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString().split('T')[0];

    const logOutput = this.git([
      'log',
      `--since=${since}`,
      '--oneline',
      '--format=%H|%ae|%s|%ad',
      '--date=short',
      '--',
      filePath,
    ]);

    const lines = logOutput.split('\n').filter(Boolean);
    const authors = [...new Set(lines.map(l => l.split('|')[1]))];
    const messages = lines.map(l => l.split('|')[2]);

    const bugFixLine = lines.find(l => {
      const msg = l.split('|')[2].toLowerCase();
      return msg.includes('fix') || msg.includes('bug') || msg.includes('revert');
    });

    return {
      filePath,
      commitCount30d: lines.length,
      uniqueAuthors: authors,
      lastBugFixDate: bugFixLine ? bugFixLine.split('|')[3] : null,
      churnSignal: lines.length > 10 ? 'high' : lines.length > 4 ? 'normal' : 'low',
      recentMessages: messages.slice(0, 5),
    };
  }

  private git(args: string[]): string {
    try {
      const result = spawnSync('git', ['-C', this.workspacePath, ...args], {
        encoding: 'utf8',
        timeout: 10000,
      });
      return result.stdout?.trim() ?? '';
    } catch {
      return '';
    }
  }
}
