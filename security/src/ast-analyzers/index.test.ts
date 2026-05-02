import { describe, it, expect } from 'vitest';
import { analyzeFile, getSupportedLanguages, type ASTFinding } from './index';
import './typescript';
import './python';
import './java';

describe('AST Analyzer Registry', () => {
  it('detects TypeScript files by extension', () => {
    const findings = analyzeFile('src/app.ts', 'var x = 1;');
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some(f => f.ruleId === 'TS008')).toBe(true);
  });

  it('detects .js files route to TypeScript analyzer', () => {
    const findings = analyzeFile('app.js', "console.log('test')");
    expect(findings.some(f => f.ruleId === 'TS003')).toBe(true);
  });

  it('detects .tsx files route to TypeScript analyzer', () => {
    const findings = analyzeFile('Component.tsx', 'var x = 1;');
    expect(findings.some(f => f.ruleId === 'TS008')).toBe(true);
  });

  it('detects Python files by extension', () => {
    const findings = analyzeFile('script.py', "import os\nos.system('ls')");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some(f => f.ruleId === 'PY006')).toBe(true);
  });

  it('detects Java files by extension', () => {
    const findings = analyzeFile('Main.java', 'System.out.println("debug")');
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some(f => f.ruleId === 'JV002')).toBe(true);
  });

  it('returns empty array for unsupported extensions', () => {
    expect(analyzeFile('test.rb', 'puts "hello"')).toEqual([]);
    expect(analyzeFile('test.go', 'fmt.Println("hello")')).toEqual([]);
    expect(analyzeFile('test.rs', 'fn main() {}')).toEqual([]);
  });

  it('reports supported languages', () => {
    const langs = getSupportedLanguages();
    expect(langs).toContain('typescript');
    expect(langs).toContain('python');
    expect(langs).toContain('java');
  });
});

describe('TypeScript Analyzer', () => {
  function analyze(code: string): ASTFinding[] {
    return analyzeFile('test.ts', code);
  }

  it('TS001: detects == instead of ===', () => {
    const findings = analyze('if (x == null) {}');
    expect(findings.some(f => f.ruleId === 'TS001')).toBe(true);
  });

  it('TS002: detects any type annotation', () => {
    const findings = analyze('function foo(x: any) {}');
    expect(findings.some(f => f.ruleId === 'TS002')).toBe(true);
  });

  it('TS003: detects console.log', () => {
    const findings = analyze("console.log('debug')");
    expect(findings.some(f => f.ruleId === 'TS003')).toBe(true);
  });

  it('TS003: detects console.debug/warn/info', () => {
    const findings = analyze("console.warn('oh no')");
    expect(findings.some(f => f.ruleId === 'TS003')).toBe(true);
  });

  it('TS004: detects empty catch block', () => {
    const findings = analyze('try { throw 1 } catch(e) {}');
    expect(findings.some(f => f.ruleId === 'TS004')).toBe(true);
  });

  it('TS005: detects eval() as critical', () => {
    const findings = analyze("eval('1+1')");
    expect(findings.some(f => f.ruleId === 'TS005')).toBe(true);
    expect(findings.find(f => f.ruleId === 'TS005')!.severity).toBe('critical');
  });

  it('TS006: detects innerHTML assignment', () => {
    const findings = analyze("el.innerHTML = '<div>hi</div>'");
    expect(findings.some(f => f.ruleId === 'TS006')).toBe(true);
    expect(findings.find(f => f.ruleId === 'TS006')!.severity).toBe('high');
  });

  it('TS007: detects setTimeout with string argument', () => {
    const findings = analyze("setTimeout('doStuff()', 1000)");
    expect(findings.some(f => f.ruleId === 'TS007')).toBe(true);
  });

  it('TS008: detects var usage', () => {
    const findings = analyze('var x = 1;');
    expect(findings.some(f => f.ruleId === 'TS008')).toBe(true);
  });

  it('TS010: detects hardcoded password as critical', () => {
    const findings = analyze("const password = 'supersecret123'");
    expect(findings.some(f => f.ruleId === 'TS010')).toBe(true);
    expect(findings.find(f => f.ruleId === 'TS010')!.severity).toBe('critical');
  });

  it('TS010: detects hardcoded apiKey', () => {
    const findings = analyze('const apiKey = "abcdefgh12345678"');
    expect(findings.some(f => f.ruleId === 'TS010')).toBe(true);
  });

  it('TS011: detects await without .catch() or try/catch', () => {
    const findings = analyze('async function f() { await fetch("/api"); }');
    expect(findings.some(f => f.ruleId === 'TS011')).toBe(true);
  });

  it('TS011: does not fire when .catch() is present', () => {
    const findings = analyze('async function f() { await fetch("/api").catch(e => {}); }');
    expect(findings.some(f => f.ruleId === 'TS011')).toBe(false);
  });

  it('TS012: detects JSON.parse', () => {
    const findings = analyze('const data = JSON.parse(raw)');
    expect(findings.some(f => f.ruleId === 'TS012')).toBe(true);
  });

  it('TS013: detects readFileSync', () => {
    const findings = analyze("fs.readFileSync('/etc/passwd')");
    expect(findings.some(f => f.ruleId === 'TS013')).toBe(true);
  });

  it('TS014: detects new Function() as critical', () => {
    const findings = analyze('const fn = new Function("a", "b", "return a + b")');
    expect(findings.some(f => f.ruleId === 'TS014')).toBe(true);
    expect(findings.find(f => f.ruleId === 'TS014')!.severity).toBe('critical');
  });

  it('TS015: detects process.env without fallback', () => {
    const findings = analyze('const port = process.env.PORT');
    expect(findings.some(f => f.ruleId === 'TS015')).toBe(true);
  });

  it('clean code produces no high-or-critical findings', () => {
    const findings = analyze('const x = 42;\nfunction add(a: number, b: number): number { return a + b; }');
    const criticalOrHigh = findings.filter(f => f.severity === 'critical' || f.severity === 'high');
    expect(criticalOrHigh.length).toBe(0);
  });

  it('findings include path and line number', () => {
    const findings = analyzeFile('src/utils.ts', 'var x = 1;');
    const ts008 = findings.find(f => f.ruleId === 'TS008')!;
    expect(ts008.path).toBe('src/utils.ts');
    expect(ts008.line).toBeGreaterThanOrEqual(1);
  });
});

describe('Python Analyzer', () => {
  function analyze(code: string): ASTFinding[] {
    return analyzeFile('test.py', code);
  }

  it('PY001: detects except: pass (bare except on its own line)', () => {
    const findings = analyze('try:\n  x\nexcept:\n  pass');
    expect(findings.some(f => f.ruleId === 'PY001')).toBe(true);
  });

  it('PY002: detects bare except: clause', () => {
    const findings = analyze('try:\n  risky()\nexcept:\n  handle()');
    expect(findings.some(f => f.ruleId === 'PY002')).toBe(true);
  });

  it('PY003: detects eval() as critical', () => {
    const findings = analyze("eval('1+1')");
    expect(findings.some(f => f.ruleId === 'PY003')).toBe(true);
    expect(findings.find(f => f.ruleId === 'PY003')!.severity).toBe('critical');
  });

  it('PY004: detects hardcoded secrets', () => {
    const findings = analyze("api_key = 'sk-abc123def456'");
    expect(findings.some(f => f.ruleId === 'PY004')).toBe(true);
  });

  it('PY004: detects hardcoded password', () => {
    const findings = analyze("password = 'super secret pw'");
    expect(findings.some(f => f.ruleId === 'PY004')).toBe(true);
  });

  it('PY005: detects subprocess with shell=True', () => {
    const findings = analyze("import subprocess; subprocess.run('ls', shell=True)");
    expect(findings.some(f => f.ruleId === 'PY005')).toBe(true);
    expect(findings.find(f => f.ruleId === 'PY005')!.severity).toBe('high');
  });

  it('PY006: detects os.system()', () => {
    const findings = analyze("import os; os.system('rm -rf /')");
    expect(findings.some(f => f.ruleId === 'PY006')).toBe(true);
    expect(findings.find(f => f.ruleId === 'PY006')!.severity).toBe('high');
  });

  it('PY007: detects pickle.load/loads', () => {
    const findings = analyze("import pickle; data = pickle.loads(user_input)");
    expect(findings.some(f => f.ruleId === 'PY007')).toBe(true);
  });

  it('PY008: detects yaml.load without SafeLoader', () => {
    const findings = analyze("import yaml; data = yaml.load(open('config.yaml'))");
    expect(findings.some(f => f.ruleId === 'PY008')).toBe(true);
  });

  it('PY009: detects assert statements', () => {
    const findings = analyze('assert x > 0');
    expect(findings.some(f => f.ruleId === 'PY009')).toBe(true);
  });

  it('PY010: detects mutable default argument (dict)', () => {
    const findings = analyze('def foo(items={}):\n  pass');
    expect(findings.some(f => f.ruleId === 'PY010')).toBe(true);
  });

  it('PY011: detects print() statements', () => {
    const findings = analyze("print('debug info')");
    expect(findings.some(f => f.ruleId === 'PY011')).toBe(true);
  });

  it('clean Python code produces no critical findings', () => {
    const findings = analyze(
      'def add(a: int, b: int) -> int:\n    return a + b\n\nresult = add(1, 2)',
    );
    const critical = findings.filter(f => f.severity === 'critical');
    expect(critical.length).toBe(0);
  });
});

describe('Java Analyzer', () => {
  function analyze(code: string): ASTFinding[] {
    return analyzeFile('Test.java', code);
  }

  it('JV001: detects == on Strings', () => {
    const findings = analyze('String name = "foo";\nif (name == "test") {}');
    expect(findings.some(f => f.ruleId === 'JV001')).toBe(true);
  });

  it('JV001: does not fire when no String is present', () => {
    const findings = analyze('int x = 1;\nif (x == 2) {}');
    expect(findings.some(f => f.ruleId === 'JV001')).toBe(false);
  });

  it('JV002: detects System.out.println', () => {
    const findings = analyze('System.out.println("debug");');
    expect(findings.some(f => f.ruleId === 'JV002')).toBe(true);
  });

  it('JV002: detects System.out.print', () => {
    const findings = analyze('System.out.print("no newline");');
    expect(findings.some(f => f.ruleId === 'JV002')).toBe(true);
  });

  it('JV003: detects hardcoded secrets as critical', () => {
    const findings = analyze('String password = "admin123";');
    expect(findings.some(f => f.ruleId === 'JV003')).toBe(true);
    expect(findings.find(f => f.ruleId === 'JV003')!.severity).toBe('critical');
  });

  it('JV004: detects Runtime.exec()', () => {
    const findings = analyze('Runtime.getRuntime().exec("cmd");');
    expect(findings.some(f => f.ruleId === 'JV004')).toBe(true);
    expect(findings.find(f => f.ruleId === 'JV004')!.severity).toBe('high');
  });

  it('JV005: detects empty catch block', () => {
    const findings = analyze('try { risky(); } catch (Exception e) {}');
    expect(findings.some(f => f.ruleId === 'JV005')).toBe(true);
  });

  it('JV006: detects Thread.sleep()', () => {
    const findings = analyze('Thread.sleep(1000);');
    expect(findings.some(f => f.ruleId === 'JV006')).toBe(true);
  });

  it('JV007: detects raw type usage (List without generic)', () => {
    const findings = analyze('List items = new ArrayList();');
    expect(findings.some(f => f.ruleId === 'JV007')).toBe(true);
  });

  it('JV008: detects @SuppressWarnings("unchecked")', () => {
    const findings = analyze('@SuppressWarnings("unchecked")\nList items = new ArrayList();');
    expect(findings.some(f => f.ruleId === 'JV008')).toBe(true);
  });

  it('clean Java code produces no high-or-critical findings', () => {
    const findings = analyze(
      'public class Test { private int value; public int getValue() { return value; } }',
    );
    const criticalOrHigh = findings.filter(
      f => f.severity === 'critical' || f.severity === 'high',
    );
    expect(criticalOrHigh.length).toBe(0);
  });
});

describe('Edge Cases', () => {
  it('empty source produces no findings', () => {
    expect(analyzeFile('test.ts', '')).toEqual([]);
    expect(analyzeFile('test.py', '')).toEqual([]);
    expect(analyzeFile('Test.java', '')).toEqual([]);
  });

  it('comments-only source produces minimal findings', () => {
    const ts = analyzeFile('test.ts', '// this is a comment\n/* block comment */');
    const py = analyzeFile('test.py', '# just a comment');
    // Neither should have critical or high findings
    expect(ts.filter(f => f.severity === 'critical' || f.severity === 'high')).toEqual([]);
    expect(py.filter(f => f.severity === 'critical' || f.severity === 'high')).toEqual([]);
  });

  it('finds multiple rules in a single file', () => {
    const findings = analyzeFile(
      'bad.ts',
      "var x = 1;\nconsole.log(x);\nconst password = 'hunter2secret';",
    );
    const ids = findings.map(f => f.ruleId);
    expect(ids).toContain('TS008'); // var
    expect(ids).toContain('TS003'); // console.log
    expect(ids).toContain('TS010'); // hardcoded password
  });

  it('handles code with single-line if/for blocks', () => {
    const findings = analyzeFile('test.ts', 'if (x == y) console.log(x)');
    expect(findings.some(f => f.ruleId === 'TS001')).toBe(true);
    expect(findings.some(f => f.ruleId === 'TS003')).toBe(true);
  });
});
