import { Project, SourceFile } from 'ts-morph';
import path from 'path';

export interface CrossFileImpact {
  changedFile: string;
  changedExport: string;
  affectedFiles: string[];
  breakageRisk: 'high' | 'medium' | 'low';
  reason: string;
}

export class ImpactAnalyzer {
  private project: Project;

  constructor(workspacePath: string) {
    this.project = new Project({
      tsConfigFilePath: path.join(workspacePath, 'tsconfig.json'),
      skipAddingFilesFromTsConfig: false,
    });
  }

  async analyze(
    changedFiles: string[],
    prDiffFiles: string[],
  ): Promise<CrossFileImpact[]> {
    const impacts: CrossFileImpact[] = [];

    for (const filePath of changedFiles) {
      const sourceFile = this.project.getSourceFile(filePath);
      if (!sourceFile) continue;

      const changedExports = this.getExportedSymbols(sourceFile);

      for (const exportName of changedExports) {
        const references = this.findAllReferencingFiles(exportName, filePath);
        const missedFiles = references.filter(f => !prDiffFiles.includes(f));

        if (missedFiles.length > 0) {
          impacts.push({
            changedFile: filePath,
            changedExport: exportName,
            affectedFiles: missedFiles,
            breakageRisk: missedFiles.length > 5 ? 'high' : missedFiles.length > 2 ? 'medium' : 'low',
            reason: `${exportName} is imported by ${missedFiles.length} file(s) not in this PR`,
          });
        }
      }
    }

    return impacts;
  }

  private getExportedSymbols(sourceFile: SourceFile): string[] {
    return Array.from(sourceFile.getExportedDeclarations().keys());
  }

  private findAllReferencingFiles(exportName: string, sourceFilePath: string): string[] {
    const referencingFiles = new Set<string>();

    for (const sourceFile of this.project.getSourceFiles()) {
      const imports = sourceFile.getImportDeclarations();
      for (const imp of imports) {
        const moduleSpecifier = imp.getModuleSpecifierValue();
        if (this.resolvesToFile(moduleSpecifier, sourceFile.getFilePath(), sourceFilePath)) {
          const namedImports = imp.getNamedImports().map(n => n.getName());
          if (namedImports.includes(exportName) || imp.getDefaultImport()) {
            referencingFiles.add(sourceFile.getFilePath());
          }
        }
      }
    }

    return Array.from(referencingFiles);
  }

  private resolvesToFile(specifier: string, fromFile: string, targetFile: string): boolean {
    try {
      const resolved = require.resolve(
        path.resolve(path.dirname(fromFile), specifier),
        { paths: [path.dirname(fromFile)] },
      );
      return resolved === targetFile || resolved === `${targetFile}.ts`;
    } catch {
      return false;
    }
  }
}
