import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import * as wasm from '../../web/src/generated/c_viz_wasm';
import { engineBuild } from '../../web/src/generated/engine-build';
import { exerciseCatalog, type CoursePractice } from '../../web/src/content/practice';
import type { PreparedSource } from '../../web/src/engine/execution-client';
import { encodeRequest, decodeResult, type Diagnostic } from '../../web/src/engine/protocol';
import { exerciseRequest } from '../../web/src/practice/submission';
import { presentDiagnostic } from '../../web/src/diagnostics/presentation';
import { diagnosticMessage } from '../../web/src/diagnostics/messages';
import { validateTraceRelationships } from '../../web/src/engine/trace-validation';
import type { ExecuteResult } from '../../web/src/engine/protocol';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const catalog = exerciseCatalog(
  JSON.parse(
    readFileSync('web/public/content/practice/course-practice-1.0.0.json', 'utf8'),
  ) as CoursePractice,
  'exercise.c.echo',
);
let base: PreparedSource;
beforeAll(() => {
  wasm.initSync({ module: readFileSync('web/src/generated/c_viz_wasm_bg.wasm') });
  base = JSON.parse(
    decoder.decode(
      wasm.prepare_input(
        JSON.stringify(catalog),
        encoder.encode(JSON.stringify(catalog.subject.tests[0].input)),
        1000,
      ),
    ),
  ).source;
});
function source(body: string) {
  const end = Math.max(...base.bindingMap.map((b) => b.byteRange.end));
  return {
    ...base,
    text: `${base.text.slice(0, end)}\n// 中文😀保留原稿\r\n${body}\n}\n`,
    blockMap: [],
  };
}
async function execute(body: string) {
  const prepared = source(body);
  const req = exerciseRequest(
    catalog,
    prepared,
    { contextId: 'diagnostic-real', contextRevision: 1, sourceRevision: 1 },
    crypto.randomUUID(),
    catalog.subject.tests[0],
  );
  const bytes = wasm
    .execute_request(encodeRequest(req), JSON.stringify(catalog), engineBuild.wasmSha256, 1000)
    .slice();
  return { result: await decodeResult(bytes.buffer, req), prepared, req };
}

describe('14.1 real Rust diagnostic teaching', () => {
  it.each([
    ['@', 'E_LEX_INVALID', 'lex', '无法识别'],
    ['printf("%d\\n", x)\nreturn 0;', 'E_PARSE_INVALID', 'parse', '语句结构'],
    ['printf("%d\\n", missing); return 0;', 'E_NAME_INVALID', 'semantic', '名称'],
    ['printf("%d\\n", x / 0); return 0;', 'E_DIV_ZERO', 'execute', '除数为零'],
    ['int z; printf("%d\\n", z); return 0;', 'E_UNINITIALIZED', 'execute', '初始化'],
  ])(
    'projects actual %s without changing source or terminal',
    async (body, code, stage, summary) => {
      const { result, prepared } = await execute(body);
      expect(result.terminal.status).toBe('program-error');
      const diag = result.terminal.diagnostics[0];
      expect(diag).toMatchObject({ code, stage, origin: 'rust' });
      const before = JSON.stringify({ result, prepared });
      const view = presentDiagnostic(diag, { ...prepared, nodes: result.nodeMap });
      expect(view.gcc).toMatch(/^main\.c:\d+:\d+: error:/);
      expect(view.gcc).toContain(summary);
      expect(view.range).not.toBeNull();
      expect(view.excerpt).not.toBeNull();
      expect(JSON.stringify({ result, prepared })).toBe(before);
      if (stage !== 'execute') expect(result.trace).toBeNull();
      else expect(result.trace?.completeness).toBe('prefix');
    },
  );
  it('a real repair completes and clears diagnostics; judging stays separate', async () => {
    const { result } = await execute('printf("%d\\n", x); return 0;');
    expect(result.terminal.status).toBe('completed');
    expect(result.terminal.diagnostics).toEqual([]);
    const { result: wrong } = await execute('printf("%d\\n", 0); return 0;');
    expect(wrong.terminal.status).toBe('completed');
    expect(wrong.terminal.diagnostics).toEqual([]);
    expect(wrong.judgeResult?.status).toBe('unmet');
  });
  it.each([
    [
      'overall met',
      (r: ExecuteResult) => {
        r.judgeResult!.status = 'met';
      },
    ],
    [
      'overall unmet',
      (r: ExecuteResult) => {
        r.judgeResult!.status = 'unmet';
      },
    ],
    [
      'one successful check',
      (r: ExecuteResult) => {
        r.judgeResult!.checks[0].status = 'met';
      },
    ],
    [
      'missing check',
      (r: ExecuteResult) => {
        r.judgeResult!.checks.pop();
      },
    ],
    [
      'duplicate check',
      (r: ExecuteResult) => {
        r.judgeResult!.checks[0] = r.judgeResult!.checks[1];
      },
    ],
    [
      'another profile',
      (r: ExecuteResult) => {
        r.judgeResult!.profileRef.id = 'judge.c.other';
      },
    ],
    [
      'another input case',
      (r: ExecuteResult) => {
        r.judgeResult!.caseKey = 'another';
      },
    ],
    [
      'invented step',
      (r: ExecuteResult) => {
        r.judgeResult!.checks[0].stepSeqs = [1];
      },
    ],
    [
      'invented node',
      (r: ExecuteResult) => {
        r.judgeResult!.checks[0].nodeIds = ['n1'];
      },
    ],
  ] as const)('rejects no-trace judgment with %s', async (_label, mutate) => {
    const { result, req } = await execute('@');
    mutate(result);
    expect(() => Array.from(validateTraceRelationships(result, req))).toThrow();
  });
});

describe('14.1 source positions and honest fallbacks', () => {
  const text = '// 甲😀\r\n\tint x = 1;\r\n';
  const diagnostic = (start: number, end: number): Diagnostic => ({
    code: 'E_PARSE_INVALID',
    severity: 'error',
    origin: 'rust',
    stage: 'parse',
    location: { kind: 'source', byteRange: { start, end } },
    details: {},
  });
  it('uses Unicode columns, CRLF and UTF16 without losing tabs', () => {
    const start = encoder.encode(text.slice(0, text.indexOf('x'))).length;
    const view = presentDiagnostic(diagnostic(start, start + 1), { text });
    expect(view.gcc).toContain('main.c:2:6:');
    expect(view.excerpt?.marked).toBe('x');
    expect(view.excerpt?.before).toBe('\tint ');
    expect(text.slice(view.range!.utf16Range.start, view.range!.utf16Range.end)).toBe('x');
  });
  it('keeps EOF zero-width and never moves it to another block', () => {
    const end = encoder.encode(text).length;
    const view = presentDiagnostic(diagnostic(end, end), {
      text,
      blockMap: [{ blockId: 'old', byteRange: { start: 0, end } }],
    });
    expect(view.gcc).toContain('main.c:3:1:');
    expect(view.blockIds).toEqual([]);
    expect(view.excerpt?.marked).toBe('');
  });
  it('rejects invalid scalar/CRLF boundaries and never guesses 1:1', () => {
    for (const [start, end] of [
      [4, 5],
      [-1, 2],
      [0, 999],
    ]) {
      const view = presentDiagnostic(diagnostic(start, end), { text });
      expect(view.range).toBeNull();
      expect(view.gcc).toMatch(/^main.c: error:/);
    }
  });
  it('direct ranges outrank nodes; chooses only the smallest current blocks', () => {
    const diag = diagnostic(1, 2);
    diag.location = {
      ...diag.location,
      kind: 'source',
      nodeId: 'n1',
      byteRange: { start: 1, end: 2 },
    };
    const view = presentDiagnostic(diag, {
      text: 'abc',
      nodes: [{ nodeId: 'n1', byteRange: { start: 0, end: 3 } }],
      blockMap: [
        { blockId: 'parent', byteRange: { start: 0, end: 3 } },
        { blockId: 'child', byteRange: { start: 1, end: 2 } },
      ],
    });
    expect(view.excerpt?.marked).toBe('b');
    expect(view.blockIds).toEqual(['child']);
  });
  it('resolves a node edge with no direct range', () => {
    const diag = diagnostic(0, 1);
    diag.location = { kind: 'source', nodeId: 'n1', edge: 'end' };
    expect(
      presentDiagnostic(diag, {
        text: 'abc',
        nodes: [{ nodeId: 'n1', byteRange: { start: 0, end: 3 } }],
      }).excerpt?.marked,
    ).toBe('c');
  });
  it('keeps synthetic failures, unknown codes and P1 missing stages honest', () => {
    const view = presentDiagnostic(
      { code: 'E_DEADLINE', location: { kind: 'synthetic', reason: 'adapter-deadline' } },
      { text, language: 'cpp' },
    );
    expect(view.gcc).toMatch(/^main.cpp: error:/);
    expect(view.range).toBeNull();
    expect(view.explanation).toContain('不能单独证明');
    expect(view.stage).toBe('阶段未单独提供');
    expect(diagnosticMessage('E_FUTURE').explanation).toContain('尚无专门');
  });
  it('uses exact interpreter evidence for explanation without inventing a cause', () => {
    expect(diagnosticMessage('E_PARSE_INVALID', 'printf semicolon').explanation).toContain('分号');
    expect(
      diagnosticMessage('E_NAME_INVALID', 'unique object name in this scope').explanation,
    ).toContain('已经声明');
    expect(diagnosticMessage('E_NAME_INVALID', 'unknown future evidence').explanation).toContain(
      '可能',
    );
  });
  it('bounds a long source excerpt around the actual range', () => {
    const view = presentDiagnostic(diagnostic(500, 900), { text: 'a'.repeat(1000) });
    expect(view.excerpt?.before.length).toBe(40);
    expect(view.excerpt?.marked.length).toBe(160);
    expect(view.excerpt?.clippedStart).toBe(true);
    expect(view.excerpt?.clippedEnd).toBe(true);
  });
});
