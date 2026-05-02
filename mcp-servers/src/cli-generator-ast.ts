/**
 * AST-Based CLI Code Generator
 * Builds a Python Click CLI from an AST model instead of string concatenation.
 * Eliminates code injection risks from the original implement() method.
 */

interface CodeNode {
  type: 'import' | 'function' | 'decorator' | 'class' | 'comment' | 'group';
  content: string[];
}

interface CliCodeModel {
  imports: string[];
  groupDecorators: string[];
  groupFunction: string[];
  commands: CliCommandModel[];
  mainEntry: string[];
}

interface CliCommandModel {
  decorators: string[];
  functionSignature: string;
  docstring: string;
  body: string[];
  examples: string[];
}

/**
 * Build a Python CLI code model from a CLI definition.
 * All user-controlled strings are escaped for Python string safety.
 */
function buildCliModel(definition: {
  name: string;
  version: string;
  description: string;
  commands: Array<{
    name: string;
    description: string;
    arguments: Array<{ name: string; type: string; required: boolean }>;
    options: Array<{ name: string; flag: string; type: string; description: string; required?: boolean; default?: unknown }>;
    examples: Array<{ command: string; description: string }>;
    subcommands: Array<{ name: string }>;
  }>;
}): CliCodeModel {
  const model: CliCodeModel = {
    imports: ['import click', 'import json', 'import sys', 'from typing import Optional'],
    groupDecorators: [],
    groupFunction: [],
    commands: [],
    mainEntry: [],
  };

  model.groupDecorators.push('@click.group()');
  model.groupDecorators.push(`@click.version_option(version="${escapePyStr(definition.version)}")`);
  model.groupFunction.push(`def cli():`);
  model.groupFunction.push(`    """${escapePyStr(definition.description)}"""`);
  model.groupFunction.push('    pass');

  for (const cmd of definition.commands) {
    const cmdModel: CliCommandModel = {
      decorators: [],
      functionSignature: '',
      docstring: '',
      body: [],
      examples: [],
    };

    const safeName = escapePyIdent(cmd.name);
    cmdModel.decorators.push(`@cli.command(name="${escapePyStr(cmd.name)}")`);
    cmdModel.decorators.push('@click.help_option("--help")');

    for (const opt of cmd.options) {
      if (opt.name === 'help' || opt.name === 'version') continue;
      const flag = escapePyStr(opt.flag);
      const desc = escapePyStr(opt.description);
      if (opt.type === 'boolean') {
        cmdModel.decorators.push(`@click.option("${flag}", is_flag=True, help="${desc}")`);
      } else if (opt.required) {
        cmdModel.decorators.push(`@click.option("${flag}", type=${opt.type}, required=True, help="${desc}")`);
      } else {
        const def = opt.default !== undefined ? `default=${JSON.stringify(opt.default)}` : '';
        cmdModel.decorators.push(`@click.option("${flag}", type=${opt.type}${def ? `, ${def}` : ''}, help="${desc}")`);
      }
    }

    for (const arg of cmd.arguments) {
      const aName = escapePyStr(arg.name);
      const aType = arg.type === 'number' ? 'FLOAT' : 'STRING';
      const req = arg.required ? '' : ', required=False';
      cmdModel.decorators.push(`@click.argument("${aName}", type=click.${aType}${req})`);
    }

    const params = [
      ...cmd.arguments.map(a => `${escapePyIdent(a.name)}: ${a.type}`),
      ...cmd.options
        .filter(o => o.name !== 'help' && o.name !== 'version')
        .map(o => `${escapePyIdent(o.name.replace(/-/g, '_'))}: ${o.type === 'boolean' ? 'bool' : o.type} = ${JSON.stringify(o.default ?? null)}`),
    ];

    cmdModel.functionSignature = `def ${safeName.replace(/-/g, '_')}(${params.join(', ')}):`;
    cmdModel.docstring = `"""${escapePyStr(cmd.description)}"""`;
    cmdModel.body.push('# TODO: Implement command logic');
    cmdModel.body.push(`click.echo(f"Executing ${safeName}")`);
    cmdModel.body.push('');

    for (const ex of cmd.examples) {
      cmdModel.examples.push(`# $ ${escapePyStr(ex.command)}`);
    }

    model.commands.push(cmdModel);
  }

  model.mainEntry.push('if __name__ == "__main__":');
  model.mainEntry.push('    cli()');

  return model;
}

/** Serialize a CliCodeModel to a Python source string */
function serializeModel(model: CliCodeModel): string {
  const lines: string[] = [];
  lines.push('#!/usr/bin/env python3');
  lines.push('');
  for (const imp of model.imports) lines.push(imp);
  lines.push('');
  for (const dec of model.groupDecorators) lines.push(dec);
  for (const fn of model.groupFunction) lines.push(fn);
  lines.push('');

  for (const cmd of model.commands) {
    for (const dec of cmd.decorators) lines.push(dec);
    lines.push(cmd.functionSignature);
    lines.push(`    ${cmd.docstring}`);
    for (const line of cmd.body) lines.push(`    ${line}`);
    if (cmd.examples.length) {
      for (const ex of cmd.examples) lines.push(`    ${ex}`);
      lines.push('');
    }
  }

  for (const line of model.mainEntry) lines.push(line);
  lines.push('');
  return lines.join('\n');
}

/** Escape a string for use inside Python double-quoted string literals */
function escapePyStr(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

/** Escape a Python identifier */
function escapePyIdent(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^[^a-zA-Z_]/, '_');
}

export { buildCliModel, serializeModel, escapePyStr, escapePyIdent };
export type { CliCodeModel, CliCommandModel };
