import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import * as wasm from '../../web/src/generated/c_viz_wasm';
import { exerciseCatalog, type CoursePractice } from '../../web/src/content/practice';
import type { PreparedSource } from '../../web/src/engine/execution-client';
import { encodeAnalysisRequest } from '../../web/src/engine/analysis-protocol';
import type {
  AnalysisRequest,
  AnalysisResult,
  ReverseProjection,
  ValidAnalysisResult,
} from '../../web/src/blocks/analysis-types';
import type { BlockProgram, BlockStatement } from '../../web/src/blocks/model';
import { generateBlockSource } from '../../web/src/blocks/generator';
import { correctBlockProgram } from '../../web/src/blocks/starters';
import {
  programNodes,
  programStructure,
  reverseAnalysis,
  UnmappedSourceError,
} from '../../web/src/blocks/reverse';
import { generatedSyntheticRanges, patchBlockSource } from '../../web/src/blocks/source-patch';

const course = JSON.parse(
  readFileSync('web/public/content/practice/course-practice-1.0.0.json', 'utf8'),
) as CoursePractice;
const catalog = exerciseCatalog(course, 'exercise.c.echo');
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const input = catalog.subject.tests[0].input;
let sequence = 0;
function prepare(values = input): PreparedSource {
  return (
    JSON.parse(
      decoder.decode(
        wasm.prepare_input(JSON.stringify(catalog), encoder.encode(JSON.stringify(values)), 1000),
      ),
    ) as { source: PreparedSource }
  ).source;
}
function source(body: string, newline = '\n'): string {
  const prepared = prepare();
  const prefixEnd = Math.max(0, ...prepared.bindingMap.map((entry) => entry.byteRange.end));
  const prefix = decoder
    .decode(encoder.encode(prepared.text).slice(0, prefixEnd))
    .replace(/\r?\n/g, newline);
  return `${prefix}${newline}${body}${newline}}${newline}`;
}
function analyze(text: string, values = input): ValidAnalysisResult {
  const request: AnalysisRequest = {
    kind: 'analysisRequest',
    analysisVersion: '1.0.0',
    identity: {
      contextId: 'mapping.context',
      contextRevision: 1,
      documentRevision: ++sequence,
      editId: `mapping.edit.${sequence}`,
      operationId: `mapping.analysis.${sequence}`,
    },
    refs: {
      packageRef: catalog.packageRef,
      programRef: { id: catalog.program.id, version: catalog.program.version },
      subsetRef: catalog.program.subsetRef,
    },
    sourceText: text,
    input: { specRef: catalog.program.inputRef, values, random: null },
  };
  const result = JSON.parse(
    decoder.decode(
      wasm.analyze_code_draft(
        decoder.decode(encodeAnalysisRequest(request, catalog)),
        JSON.stringify(catalog),
        1000,
      ),
    ),
  ) as AnalysisResult;
  expect(result.kind).toBe('analysisResult');
  if (result.kind !== 'analysisResult' || result.status !== 'valid')
    throw new Error(JSON.stringify(result));
  expect(result.diagnostics).toEqual([]);
  return result;
}
function project(body: string, newline = '\n'): ReverseProjection {
  const text = source(body, newline);
  return reverseAnalysis(analyze(text), text, catalog.program.bindings);
}
function changeInteger(program: BlockProgram, original: string, replacement: string): BlockProgram {
  let changed = false;
  return JSON.parse(
    JSON.stringify(program, (_key, value: unknown) => {
      if (
        !changed &&
        value &&
        typeof value === 'object' &&
        'kind' in value &&
        value.kind === 'integer' &&
        'value' in value &&
        value.value === original
      ) {
        changed = true;
        return { ...value, value: replacement };
      }
      return value;
    }),
  ) as BlockProgram;
}
function withBody(program: BlockProgram, body: readonly BlockStatement[]): BlockProgram {
  return { ...program, body };
}
function printNode(id: string, text: string): BlockStatement {
  return { id, kind: 'print', format: text, args: [] };
}
function occurrences(text: string, fragment: string): number {
  return text.split(fragment).length - 1;
}
function reproject(before: ReverseProjection, next: BlockProgram): ReverseProjection {
  const patch = patchBlockSource(before, next, catalog.program.bindings);
  return reverseAnalysis(analyze(patch.text), patch.text, catalog.program.bindings, {
    previous: before,
    stableProgram: next,
    trustedSyntheticRanges: patch.syntheticRanges,
    generationMode: 'preserve',
  });
}

beforeAll(() => wasm.initSync({ module: readFileSync('web/src/generated/c_viz_wasm_bg.wasm') }));

describe('20-kind reverse mapping from the real bounded Rust analysis producer', () => {
  it('maps every visible block kind and the controlled input role with exact AST ranges', () => {
    const projection = project(`int y = 1;
int a[3] = {+7, -2, -0};
y = (+ y);
y = (- y);
y = (! y);
a[0] = ((a[1] + 4) * 2) / 2 % 3;
if ((x >= 0) && ((y == 0) || (x != 7))) { printf("%d\\n", x); } else {}
while (y < 3) { y = y + 1; if (y > 2) { break; } }
for (int i = 0; i <= 2; i = i + 1) { if (i == 1) { continue; } y = y + a[i]; }
{ int local = 0; printf("%d %%\\n", local); }
return 0;`);
    const nodes = programNodes(projection.program);
    expect(new Set([...nodes.values()].map((node) => node.kind))).toEqual(
      new Set([
        'main',
        'input',
        'integer',
        'declare',
        'variable',
        'assign',
        'unary',
        'arithmetic',
        'compare',
        'logic',
        'if',
        'while',
        'for',
        'break',
        'continue',
        'array_declare',
        'array_read',
        'array_write',
        'print',
        'return',
        'scope',
      ]),
    );
    expect(projection.source.text).toBe(projection.sourceText);
    expect(new Set(projection.source.blockMap.map((entry) => entry.blockId)).size).toBe(nodes.size);
    for (const entry of projection.source.blockMap)
      expect(
        projection.analysis.checkedAst.nodes.some(
          (node) =>
            node.byteRange.start === entry.byteRange.start &&
            node.byteRange.end === entry.byteRange.end,
        ),
      ).toBe(true);
    const array = [...nodes.values()].find((node) => node.kind === 'array_declare');
    expect(array).toMatchObject({ length: '3', values: ['7', '-2', '0'] });
    expect(projection.program.body[0]).toMatchObject({
      kind: 'input',
      bindingKey: catalog.program.bindings[0].bindingKey,
    });
  });
  it('preserves null and explicit empty branches, missing for slots, uninitialized declarations and scopes', () => {
    const projection = project('int y; if(1){} if(0){}else{} for(;;){break;} {}');
    const statements = projection.program.body;
    expect(statements[1]).toMatchObject({ kind: 'declare', initial: null });
    expect(statements[2]).toMatchObject({ kind: 'if', then: [], else: null });
    expect(statements[3]).toMatchObject({ kind: 'if', then: [], else: [] });
    expect(statements[4]).toMatchObject({ kind: 'for', init: null, condition: null, update: null });
    expect(statements[5]).toMatchObject({ kind: 'scope', body: [] });
  });
  it.each([
    [';', 'EMPTY_STATEMENT'],
    ['int a[1]={0}; for(a[0]=0; a[0]<1; a[0]=a[0]+1){}', 'FOR_ARRAY_TARGET'],
    ['int _local=1; printf("%d",_local);', 'BLOCK_NAME'],
    ['printf("raw\ttab");', 'BLOCK_FORMAT'],
  ])('keeps Rust-valid but unmapped source explicit: %s', (body, reason) => {
    const text = source(body);
    const checked = analyze(text);
    try {
      reverseAnalysis(checked, text, catalog.program.bindings);
      throw new Error('expected unmapped');
    } catch (error) {
      expect(error).toBeInstanceOf(UnmappedSourceError);
      expect((error as UnmappedSourceError).issues[0]).toMatchObject({ reason });
      expect((error as UnmappedSourceError).issues[0].byteRange).not.toBeNull();
    }
  });
  it('reuses exact original block IDs across all real echo test declarations', () => {
    const first = project('if(x >= 0){printf("%d\\n", x);}else{printf("%d\\n",x);} return 0;');
    const keys = [...programNodes(first.program).keys()];
    for (const test of catalog.subject.tests) {
      const base = prepare(test.input);
      const original = encoder.encode(first.sourceText);
      const target = encoder.encode(base.text);
      const old = first.source.bindingMap[0].byteRange;
      const replacement = base.bindingMap[0].byteRange;
      const text =
        decoder.decode(original.slice(0, old.start)) +
        decoder.decode(target.slice(replacement.start, replacement.end)) +
        decoder.decode(original.slice(old.end));
      const result = reverseAnalysis(analyze(text, test.input), text, catalog.program.bindings, {
        stableProgram: first.program,
      });
      expect(programStructure(result.program)).toBe(programStructure(first.program));
      expect([...programNodes(result.program).keys()]).toEqual(keys);
    }
  });
  it('rejects a frozen structure mismatch rather than inventing control sites', () => {
    const first = project('printf("%d\\n",x);');
    const otherText = source('if(x){printf("%d\\n",x);}');
    expect(() =>
      reverseAnalysis(analyze(otherText), otherText, catalog.program.bindings, {
        stableProgram: first.program,
      }),
    ).toThrow(UnmappedSourceError);
  });
  it('retains unchanged spans across a code edit but never reuses an identifier whose declaration changed', () => {
    const before = project('int y=1; {int z=2;printf("%d",y);}');
    const oldOutput = [...programNodes(before.program).values()].find(
      (node) => node.kind === 'print',
    )!;
    const unrelated = source('int y=3; {int z=2;printf("%d",y);}');
    const sameBinding = reverseAnalysis(analyze(unrelated), unrelated, catalog.program.bindings, {
      previous: before,
    });
    expect(
      [...programNodes(sameBinding.program).values()].find((node) => node.kind === 'print')!.id,
    ).toBe(oldOutput.id);
    const rebound = source('int z=1; {int y=2;printf("%d",y);}');
    const differentBinding = reverseAnalysis(analyze(rebound), rebound, catalog.program.bindings, {
      previous: before,
    });
    expect(
      [...programNodes(differentBinding.program).values()].find((node) => node.kind === 'print')!
        .id,
    ).not.toBe(oldOutput.id);
  });
  it('allows the declared signed-literal normalization in a frozen array structure', () => {
    const before = project('int a[3]={7,0};');
    const program = withBody(
      before.program,
      before.program.body.map((node) =>
        node.kind === 'array_declare' ? { ...node, values: ['+7', '-0'] } : node,
      ),
    );
    const generated = generateBlockSource(program, prepare(), catalog.program.bindings);
    const mapped = reverseAnalysis(
      analyze(generated.text),
      generated.text,
      catalog.program.bindings,
      {
        stableProgram: program,
        trustedSyntheticRanges: generatedSyntheticRanges(generated, program),
      },
    );
    expect(programStructure(mapped.program)).toBe(programStructure(program));
    expect(mapped.program.body[1]).toMatchObject({ values: ['7', '0'] });
  });
  it('preserves explicit user returns and removes only a trusted generated tail over repeated conversion', () => {
    const base = prepare();
    let program = correctBlockProgram(catalog.subject.id, catalog.program.bindings);
    for (let turn = 0; turn < 5; turn++) {
      const generated = generateBlockSource(program, base, catalog.program.bindings);
      const result = reverseAnalysis(
        analyze(generated.text),
        generated.text,
        catalog.program.bindings,
        {
          stableProgram: program,
          generationMode: 'canonical',
          trustedSyntheticRanges: generatedSyntheticRanges(generated, program),
        },
      );
      expect(programStructure(result.program)).toBe(programStructure(program));
      expect(result.provenance.syntheticSegments).toHaveLength(1);
      program = result.program;
    }
    const explicit = project('return 0;');
    expect(explicit.program.body.at(-1)?.kind).toBe('return');
    expect(explicit.provenance.syntheticSegments).toHaveLength(0);
  });
  it.each([0, 7])(
    'preserves an explicit final return %s through repeated canonical conversion',
    (exitCode) => {
      let program = project(`return ${exitCode};`).program;
      const base = prepare();
      for (let turn = 0; turn < 5; turn++) {
        const generated = generateBlockSource(program, base, catalog.program.bindings);
        expect(occurrences(generated.text, 'return ')).toBe(1);
        const synthetic = generatedSyntheticRanges(generated, program);
        expect(synthetic).toEqual([]);
        const result = reverseAnalysis(
          analyze(generated.text),
          generated.text,
          catalog.program.bindings,
          {
            stableProgram: program,
            generationMode: 'canonical',
            trustedSyntheticRanges: synthetic,
          },
        );
        expect(result.provenance.syntheticSegments).toEqual([]);
        expect(programStructure(result.program)).toBe(programStructure(program));
        program = result.program;
      }
    },
  );

  it('does not suppress an arbitrary return just because its bytes look generated', () => {
    const before = project('return 0;');
    expect(() =>
      reverseAnalysis(before.analysis, before.sourceText, catalog.program.bindings, {
        trustedSyntheticRanges: [{ start: 0, end: 1 }],
      }),
    ).toThrow();
  });
});

describe('source-preserving block patches are checked again by the same Rust producer', () => {
  it('changes the smallest statement and preserves Unicode, CRLF, header and unrelated bytes', () => {
    const before = project(
      '    // 中文😀前注释\r\n    int y = (1 /* 内部😀 */ + 2); // 尾注释\r\n    printf("%d\\n", x);\r\n    return 0;',
      '\r\n',
    );
    const next = changeInteger(before.program, '2', '3');
    const patched = patchBlockSource(before, next, catalog.program.bindings);
    expect(patched.commentsMoved).toBe(true);
    expect(occurrences(patched.text, '/* 内部😀 */')).toBe(1);
    expect(patched.text).toContain('// 中文😀前注释\r\n');
    expect(patched.text).toContain('// 尾注释\r\n    printf("%d\\n", x);\r\n    return 0;');
    expect(patched.text.replaceAll('\r\n', '')).not.toContain('\n');
    expect(
      reverseAnalysis(analyze(patched.text), patched.text, catalog.program.bindings, {
        stableProgram: next,
      }).program,
    ).toEqual(next);
  });
  it('inserts and deletes statements without formatting unrelated code or losing deleted comments', () => {
    const before = project('int y = (1 /* keep comment */ + 2);\nprintf("%d\\n",x);');
    const inserted = printNode('new.output', 'added\n');
    const next = withBody(before.program, [...before.program.body, inserted]);
    const added = reproject(before, next);
    expect(added.sourceText).toContain('int y = (1 /* keep comment */ + 2);\nprintf("%d\\n",x);');
    const removed = withBody(
      added.program,
      added.program.body.filter((node) => node.kind !== 'declare'),
    );
    const patch = patchBlockSource(added, removed, catalog.program.bindings);
    expect(occurrences(patch.text, '/* keep comment */')).toBe(1);
    expect(patch.text).not.toContain('int y');
    expect(
      reverseAnalysis(analyze(patch.text), patch.text, catalog.program.bindings, {
        stableProgram: removed,
      }).program,
    ).toEqual(removed);
  });
  it('moves a statement across parents with its internal comments exactly once', () => {
    const before = project('int y=0; { y = (1 /* travel */ + 2); } { printf("%d",x); }');
    const first = before.program.body[2];
    const second = before.program.body[3];
    expect(first.kind).toBe('scope');
    expect(second.kind).toBe('scope');
    if (first.kind !== 'scope' || second.kind !== 'scope') throw new Error('fixture');
    const moved = first.body[0];
    const next = withBody(before.program, [
      before.program.body[0],
      before.program.body[1],
      { ...first, body: [] },
      { ...second, body: [moved, ...second.body] },
    ]);
    const result = reproject(before, next);
    expect(occurrences(result.sourceText, '/* travel */')).toBe(1);
    expect(result.program).toEqual(next);
  });
  it('refuses ambiguous simultaneous parent replacement and a commented descendant move', () => {
    const before = project('int y=0; while(y<2){y=(1 /* travel once */ + 2);}');
    const loop = before.program.body[2];
    if (loop.kind !== 'while') throw new Error('fixture');
    const changed = changeInteger(
      withBody(before.program, [
        before.program.body[0],
        before.program.body[1],
        { ...loop, body: [] },
        ...loop.body,
      ]),
      '2',
      '3',
    );
    expect(() => patchBlockSource(before, changed, catalog.program.bindings)).toThrow(
      'UNSUPPORTED_RANGE',
    );
    expect(occurrences(before.sourceText, '/* travel once */')).toBe(1);
  });
  it('rewrites a for header as a whole while preserving the code before and after it', () => {
    const before = project(
      'int y=0;\nfor(int i=0; i<2; i=i+1){ y=y+i; /* inside */ }\nprintf("%d",x);',
    );
    const next = changeInteger(before.program, '2', '3');
    const patched = patchBlockSource(before, next, catalog.program.bindings);
    expect(patched.text).toContain('int y=0;\n');
    expect(patched.text).toContain('\nprintf("%d",x);');
    expect(occurrences(patched.text, '/* inside */')).toBe(1);
    expect(reproject(before, next).program).toEqual(next);
  });
  it('keeps current generated-tail provenance when a trusted block patch shifts it', () => {
    const base = prepare();
    const program = correctBlockProgram(catalog.subject.id, catalog.program.bindings);
    const generated = generateBlockSource(program, base, catalog.program.bindings);
    const before = reverseAnalysis(
      analyze(generated.text),
      generated.text,
      catalog.program.bindings,
      {
        stableProgram: program,
        trustedSyntheticRanges: generatedSyntheticRanges(generated, program),
        generationMode: 'preserve',
      },
    );
    const next = withBody(before.program, [
      ...before.program.body,
      printNode('append.output', 'tail check'),
    ]);
    const result = reproject(before, next);
    expect(result.provenance.syntheticSegments).toHaveLength(1);
    expect(result.program.body.filter((node) => node.kind === 'return')).toHaveLength(
      program.body.filter((node) => node.kind === 'return').length,
    );
    expect(occurrences(result.sourceText, 'return 0;')).toBe(
      occurrences(before.sourceText, 'return 0;'),
    );
  });
  it('refuses any protected input edit without replacing it with the previous answer', () => {
    const before = project('printf("%d\\n",x);');
    const inputNode = before.program.body[0];
    if (inputNode.kind !== 'input') throw new Error('fixture');
    const next = withBody(before.program, [
      { ...inputNode, name: 'changed' },
      ...before.program.body.slice(1),
    ]);
    expect(() => patchBlockSource(before, next, catalog.program.bindings)).toThrow('BLOCK_INPUT');
    expect(before.sourceText).toContain('printf("%d\\n",x);');
  });
  it('returns original source exactly when there is no logical edit', () => {
    const before = project('/* comment */ printf("%d\\n", x);');
    const patch = patchBlockSource(
      before,
      structuredClone(before.program),
      catalog.program.bindings,
    );
    expect(patch.text).toBe(before.sourceText);
    expect(patch.commentsMoved).toBe(false);
  });
});
