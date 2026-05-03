import { spawn, ChildProcess } from 'child_process';
import * as rpc from 'vscode-jsonrpc/node';
import * as lsp from 'vscode-languageserver-protocol';
import { readFileSync } from 'fs';

export interface SymbolImpact {
  changedSymbol: string;
  filePath: string;
  usageSites: Array<{ file: string; line: number; context: string }>;
  typeErrors: Array<{ file: string; line: number; message: string }>;
}

export class LSPAdapter {
  private connection: rpc.MessageConnection | null = null;
  private serverProcess: ChildProcess | null = null;
  private workspacePath: string;
  private diagnosticsSubscriptions = new Map<string, rpc.Disposable>();

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  async start(language: 'typescript' | 'python' | 'rust'): Promise<void> {
    const command = this.resolveServerCommand(language);
    this.serverProcess = spawn(command.bin, command.args, { stdio: 'pipe' });

    this.connection = rpc.createMessageConnection(
      new rpc.StreamMessageReader(this.serverProcess.stdout!),
      new rpc.StreamMessageWriter(this.serverProcess.stdin!),
    );
    this.connection.listen();

    await this.connection.sendRequest(lsp.InitializeRequest.type, {
      processId: process.pid,
      rootUri: `file://${this.workspacePath}`,
      capabilities: {
        textDocument: {
          definition: { dynamicRegistration: false },
          references: { dynamicRegistration: false },
          publishDiagnostics: {},
        },
      },
    });

    await this.connection.sendNotification(lsp.InitializedNotification.type, {});
    await this.sleep(2000);
  }

  async findReferences(filePath: string, line: number, character: number): Promise<lsp.Location[]> {
    if (!this.connection) throw new Error('LSP not started');
    const result = await this.connection.sendRequest(lsp.ReferencesRequest.type, {
      textDocument: { uri: `file://${filePath}` },
      position: { line, character },
      context: { includeDeclaration: false },
    });
    return result ?? [];
  }

  async getDiagnostics(filePath: string): Promise<lsp.Diagnostic[]> {
    if (!this.connection) throw new Error('LSP not started');

    return new Promise((resolve) => {
      const fileKey = `file://${filePath}`;
      const timeout = setTimeout(() => {
        this.cleanupSubscription(fileKey);
        resolve([]);
      }, 5000);

      const subscription = this.connection!.onNotification(
        lsp.PublishDiagnosticsNotification.type,
        (params: lsp.PublishDiagnosticsParams) => {
          if (params.uri === fileKey) {
            clearTimeout(timeout);
            this.cleanupSubscription(fileKey);
            resolve(params.diagnostics);
          }
        },
      );

      this.diagnosticsSubscriptions.set(fileKey, subscription);

      this.connection!.sendNotification(lsp.DidOpenTextDocumentNotification.type, {
        textDocument: {
          uri: fileKey,
          languageId: 'typescript',
          version: 1,
          text: readFileSync(filePath, 'utf8'),
        },
      });
    });
  }

  async analyzeChangedSymbols(changedFiles: Array<{ path: string; patch: string }>): Promise<SymbolImpact[]> {
    const impacts: SymbolImpact[] = [];

    for (const file of changedFiles) {
      const fullPath = `${this.workspacePath}/${file.path}`;
      const changedLines = this.extractChangedLines(file.patch);

      for (const line of changedLines) {
        const refs = await this.findReferences(fullPath, line, 0);
        const externalRefs = refs.filter(r => !r.uri.includes(file.path));

        let diagnostics: lsp.Diagnostic[] = [];
        if (externalRefs.length > 0) {
          diagnostics = await this.getDiagnostics(fullPath);
        }

        if (externalRefs.length > 0 || diagnostics.length > 0) {
          impacts.push({
            changedSymbol: `${file.path}:${line}`,
            filePath: file.path,
            usageSites: externalRefs.map(r => ({
              file: r.uri.replace('file://', ''),
              line: r.range.start.line,
              context: '',
            })),
            typeErrors: diagnostics.map(d => ({
              file: file.path,
              line: d.range.start.line,
              message: d.message,
            })),
          });
        }
      }
    }

    return impacts;
  }

  async stop(): Promise<void> {
    for (const [, subscription] of this.diagnosticsSubscriptions) {
      subscription.dispose();
    }
    this.diagnosticsSubscriptions.clear();

    try {
      await this.connection?.sendRequest(lsp.ShutdownRequest.type);
    } catch {
      // server may already be dead
    }
    this.connection?.dispose();
    this.serverProcess?.kill();
  }

  private cleanupSubscription(key: string): void {
    const subscription = this.diagnosticsSubscriptions.get(key);
    if (subscription) {
      subscription.dispose();
      this.diagnosticsSubscriptions.delete(key);
    }
  }

  private resolveServerCommand(language: string) {
    const commands: Record<string, { bin: string; args: string[] }> = {
      typescript: { bin: 'typescript-language-server', args: ['--stdio'] },
      python: { bin: 'pylsp', args: [] },
      rust: { bin: 'rust-analyzer', args: [] },
    };
    return commands[language] ?? commands.typescript;
  }

  private extractChangedLines(patch: string): number[] {
    const lines: number[] = [];
    const hunkHeader = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm;
    let match;
    while ((match = hunkHeader.exec(patch)) !== null) {
      const start = parseInt(match[3], 10);
      const count = match[4] ? parseInt(match[4], 10) : 1;
      for (let i = start; i < start + count; i++) lines.push(i - 1);
    }
    return lines;
  }

  private sleep(ms: number) {
    return new Promise(r => setTimeout(r, ms));
  }
}
