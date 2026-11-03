import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import init, { execute_c6, type InitOutput } from '../../web/src/generated/c6/c_viz_c6';
import { engineBuild } from '../../web/src/generated/c6/engine-build';
import { c6RunRequest } from '../../web/src/engine/c6-client';
import {
  canonicalC6Json,
  c6SourceHash,
  decodeC6Response,
  encodeC6Request,
  type C6EditRequest,
  type C6EditResult,
  type C6JudgeRequest,
  type C6Result,
} from '../../web/src/engine/c6-protocol';
import { applyC6Step, C6Player, C6TypeTable } from '../../web/src/engine/c6-player';

let wasm: InitOutput;
beforeAll(async () => {
  wasm = await init({ module_or_path: readFileSync('web/src/generated/c6/c_viz_c6_bg.wasm') });
});
function packet(request: Parameters<typeof encodeC6Request>[0]) {
  return execute_c6(encodeC6Request(request), engineBuild.wasmSha256, 1000).slice().buffer;
}
const recode = (value: unknown) => new TextEncoder().encode(canonicalC6Json(value)).buffer;
describe('real C6 Rust/WASM protocol', () => {
  it('validates all independent boundary packets and reverses every real prefix', async () => {
    const matrix = JSON.parse(readFileSync('shared/fixtures/c6/21.3/boundaries.json', 'utf8')) as {
      cases: {
        id: string;
        source: string;
        input: string;
        returnValue: number;
        stdout: string;
        code: string | null;
        adapterError: boolean;
        cells: Record<string, unknown>;
      }[];
    };
    const failures: string[] = [];
    for (const c of matrix.cases) {
      try {
        const request = await c6RunRequest(c.source, c.input);
        let buffer: ArrayBuffer;
        try {
          buffer = execute_c6(
            new TextEncoder().encode(canonicalC6Json(request)),
            engineBuild.wasmSha256,
            1000,
          ).slice().buffer;
        } catch (error) {
          if (c.adapterError) {
            expect(String(error)).toBe(c.code);
            continue;
          }
          throw error;
        }
        expect(c.adapterError).toBe(false);
        const result = (await decodeC6Response(
          buffer,
          request,
          engineBuild.wasmSha256,
        )) as C6Result;
        expect(result.terminal.code).toBe(c.code);
        if (c.code === null) expect(result.terminal.returnValue).toBe(c.returnValue);
        if (result.trace) {
          const player = new C6Player(result),
            final = player.seek(result.trace.steps.length);
          expect(final.output).toBe(c.stdout);
          for (const [name, value] of Object.entries(c.cells)) {
            const object = final.objects.find((o) => o.name === name)!;
            expect(player.types.cell(object, 0)).toEqual(value);
          }
          player.seek(0);
          expect(player.state).toEqual(result.trace.initialState);
        }
      } catch (error) {
        failures.push(`${c.id}: ${error instanceof Error ? error.stack : String(error)}`);
      }
    }
    expect(failures).toEqual([]);
  }, 30000);
  it('consumes typed float/structure/pointer/array facts and fully reverses them', async () => {
    const source =
      '#include <stdio.h>\nstruct Item{char text[4];double price;int count;};int main(){struct Item item={"a",-0.0,2};struct Item *p=&item;p->count+=3;float f=.125f;double d=f;int values[3]={1,2,3};int *q=values+1;*q=7;printf("%s %.2f %d %d\\n",item.text,d,item.count,values[1]);return 0;}';
    const request = await c6RunRequest(source);
    const result = (await decodeC6Response(
      packet(request),
      request,
      engineBuild.wasmSha256,
    )) as C6Result;
    expect(result.terminal.status).toBe('completed');
    const player = new C6Player(result);
    const initial = structuredClone(player.state);
    expect(player.seek(result.trace!.steps.length).output).toBe('a 0.12 5 7\n');
    player.seek(0);
    expect(player.state).toEqual(initial);
    expect(wasm.memory.buffer.byteLength).toBeLessThanOrEqual(134217728);
  });
  it('validates actual source changes, stdin identities and compiler errors', async () => {
    const a = await c6RunRequest(
      '#include <stdio.h>\nint main(){int n;scanf("%d",&n);printf("%d\\n",n*7);return 0;}',
      '3',
    );
    const result = (await decodeC6Response(packet(a), a, engineBuild.wasmSha256)) as C6Result;
    expect(new C6Player(result).seek(result.trace!.steps.length).output).toBe('21\n');
    const changed = await c6RunRequest(a.source.replace('n*7', 'n*8'), '3');
    await expect(decodeC6Response(recode(result), changed, engineBuild.wasmSha256)).rejects.toThrow(
      'E_PROTOCOL_INVALID',
    );
    const invalid = await c6RunRequest('//中文\nint main(){return missing;}');
    const failure = (await decodeC6Response(
      packet(invalid),
      invalid,
      engineBuild.wasmSha256,
    )) as C6Result;
    expect(failure.terminal.code).toBe('E_UNDECLARED');
    expect(failure.trace).toBeNull();
  });
  it('runs a real four-case judge and checks one aggregate', async () => {
    const run = await c6RunRequest(
      '#include <stdio.h>\nint f(int x){return 5*x+1;}int main(){int n;scanf("%d",&n);printf("%d\\n",f(n));return 0;}',
    );
    const { input, ...common } = run;
    void input;
    const request: C6JudgeRequest = {
      ...common,
      judgeVersion: '2.0.0',
      profileRef: { id: 'judge.c6.s9.1.3', version: '1.0.0' },
      packageRef: { id: 'content.c.primer6', version: '1.0.0' },
    };
    const response = await decodeC6Response(packet(request), request, engineBuild.wasmSha256);
    expect('cases' in response && response.status).toBe('passed');
    if ('aggregate' in response) {
      expect(response.aggregate.wasmPeakBytes).toBeLessThanOrEqual(wasm.memory.buffer.byteLength);
      expect(response.cases).toHaveLength(4);
    }
  });
  it('validates all 44 profiles with both independent real WASM implementations', async () => {
    const fixtures = JSON.parse(
      readFileSync('shared/fixtures/c6/21.3/judge-programs.json', 'utf8'),
    ) as {
      programs: {
        profileRef: { id: string; version: string };
        primary: string;
        alternative: string;
      }[];
    };
    const failures: string[] = [];
    for (const row of fixtures.programs) {
      for (const variant of ['primary', 'alternative'] as const) {
        try {
          const run = await c6RunRequest(row[variant]);
          const { input, ...common } = run;
          void input;
          const request: C6JudgeRequest = {
            ...common,
            judgeVersion: '2.0.0',
            profileRef: row.profileRef,
            packageRef: { id: 'content.c.primer6', version: '1.0.0' },
          };
          const result = await decodeC6Response(packet(request), request, engineBuild.wasmSha256);
          expect('cases' in result && result.status).toBe('passed');
        } catch (error) {
          failures.push(`${row.profileRef.id} ${variant}: ${String(error)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  }, 30000);
  it('keeps original EDIT2 drafts and accepts full Rust block mappings', async () => {
    const source =
      '#include <stdio.h>\nint main(){int n=3;while(n>0){n=n-1;}printf("%d\\n",n);return 0;}';
    const request: C6EditRequest = {
      editVersion: '2.0.0',
      documentId: 'document-1',
      packageRef: { id: 'content.c.primer6', version: '1.0.0' },
      engine: { id: 'engine.rust.c6', version: '0.1.0' },
      sourceRevision: 'revision-1',
      sourceSha256: await c6SourceHash(source),
      source,
    };
    const result = await decodeC6Response(packet(request), request, engineBuild.wasmSha256);
    expect('editVersion' in result && result.status).toBe('mapped');
    expect('source' in result && result.source).toBe(source);
  });
  it('rejects corrupt typed values, before images, checkpoints and whole identity', async () => {
    const request = await c6RunRequest('int main(){int x=7;x=x+2;return x;}');
    const original = (await decodeC6Response(
      packet(request),
      request,
      engineBuild.wasmSha256,
    )) as C6Result;
    for (const mutate of [
      (v: C6Result) => {
        v.engine.buildId = 'f'.repeat(64);
      },
      (v: C6Result) => {
        v.types.find((t) => t.kind === 'int')!.byteSize = 8;
      },
      (v: C6Result) => {
        v.trace!.checkpoints[0].state.allocator.liveBytes = 1;
      },
      (v: C6Result) => {
        v.trace!.steps.find((s) => s.changes.some((c) => c.op === 'cell'))!.changes.forEach((c) => {
          if (c.op === 'cell') c.before = 999;
        });
      },
      (v: C6Result) => {
        v.trace!.initialState.output = 'forged';
      },
    ]) {
      const changed = structuredClone(original);
      mutate(changed);
      await expect(
        decodeC6Response(recode(changed), request, engineBuild.wasmSha256),
      ).rejects.toThrow('E_PROTOCOL_INVALID');
    }
  });
  it('rolls back all atoms when a later forward/reverse atom is invalid', async () => {
    const request = await c6RunRequest('int main(){int x=7;x=x+2;return x;}');
    const result = (await decodeC6Response(
      packet(request),
      request,
      engineBuild.wasmSha256,
    )) as C6Result;
    const player = new C6Player(result);
    const at = result.trace!.steps.findIndex((s) => s.changes.some((c) => c.op === 'cell'));
    player.seek(at);
    const before = structuredClone(player.state),
      step = structuredClone(result.trace!.steps[at]);
    step.changes.push({
      op: 'control',
      before: { ...before.control, inputCursor: 999 },
      after: before.control,
    });
    expect(() => applyC6Step(player.state, step, new C6TypeTable(result.types))).toThrow(
      'E_PROTOCOL_INVALID',
    );
    expect(player.state).toEqual(before);
    player.seek(at + 1);
    const after = structuredClone(player.state);
    const reverse = structuredClone(result.trace!.steps[at]);
    reverse.changes.unshift({
      op: 'control',
      before: before.control,
      after: { ...after.control, inputCursor: 999 },
    });
    expect(() => applyC6Step(player.state, reverse, player.types, true)).toThrow(
      'E_PROTOCOL_INVALID',
    );
    expect(player.state).toEqual(after);
  });
  it('accepts a depth64 flat EDIT graph and rejects cycles, unused nodes and unknown diagnostics', async () => {
    const source = 'int main(){return ' + '+ '.repeat(61) + '1;}';
    const request: C6EditRequest = {
      editVersion: '2.0.0',
      documentId: 'deep-document',
      packageRef: { id: 'content.c.primer6', version: '1.0.0' },
      engine: { id: 'engine.rust.c6', version: '0.1.0' },
      sourceRevision: 'r1',
      sourceSha256: await c6SourceHash(source),
      source,
    };
    const result = (await decodeC6Response(
      packet(request),
      request,
      engineBuild.wasmSha256,
    )) as C6EditResult;
    expect(result.status).toBe('mapped');
    expect(result.program!.nodes.length).toBeGreaterThan(60);
    for (const corrupt of [
      (v: C6EditResult) => {
        const n = v.program!.nodes.find((n) => n.kind === 'unary')!;
        n.operand = n.id;
      },
      (v: C6EditResult) => {
        v.program!.nodes.push({ id: 'unused', kind: 'integer', value: '1' });
      },
      (v: C6EditResult) => {
        v.blockMap.pop();
      },
      (v: C6EditResult) => {
        v.nodeMap[0].kind = 'unknown-kind';
      },
    ]) {
      const changed = structuredClone(result);
      corrupt(changed);
      await expect(
        decodeC6Response(recode(changed), request, engineBuild.wasmSha256),
      ).rejects.toThrow('E_PROTOCOL_INVALID');
    }
    const badSource = 'int main(){return missing;}';
    const badRequest = {
      ...request,
      source: badSource,
      sourceSha256: await c6SourceHash(badSource),
    };
    const bad = (await decodeC6Response(
      packet(badRequest),
      badRequest,
      engineBuild.wasmSha256,
    )) as C6EditResult;
    bad.diagnostics[0].code = 'E_NOT_REAL';
    await expect(decodeC6Response(recode(bad), badRequest, engineBuild.wasmSha256)).rejects.toThrow(
      'E_PROTOCOL_INVALID',
    );
  });
  it('rejects every correct-output bypass and one-case-only wrong program in real WASM judging', async () => {
    const rows = JSON.parse(readFileSync('shared/fixtures/c6/21.3/judge-programs.json', 'utf8'))
      .programs as {
      profileRef: { id: string; version: string };
      bypass: string;
      wrongCase4: string;
    }[];
    for (const row of rows) {
      for (const variant of ['bypass', 'wrongCase4'] as const) {
        const run = await c6RunRequest(row[variant]);
        const { input, ...common } = run;
        void input;
        const request: C6JudgeRequest = {
          ...common,
          judgeVersion: '2.0.0',
          profileRef: row.profileRef,
          packageRef: { id: 'content.c.primer6', version: '1.0.0' },
        };
        const result = await decodeC6Response(packet(request), request, engineBuild.wasmSha256);
        expect('cases' in result && result.status, `${row.profileRef.id}/${variant}`).toBe(
          'failed',
        );
      }
    }
  }, 30000);
  it('rejects all twelve real no-op and wrong-type goal bypasses despite correct stdout', async () => {
    const fixtures = JSON.parse(
      readFileSync('shared/fixtures/c6/21.3/judge-programs.json', 'utf8'),
    ) as { adversarial: { profileRef: { id: string; version: string }; source: string }[] };
    expect(fixtures.adversarial).toHaveLength(12);
    for (const row of fixtures.adversarial) {
      const { input, ...common } = await c6RunRequest(row.source);
      void input;
      const request: C6JudgeRequest = {
        ...common,
        judgeVersion: '2.0.0',
        profileRef: row.profileRef,
        packageRef: { id: 'content.c.primer6', version: '1.0.0' },
      };
      const result = await decodeC6Response(packet(request), request, engineBuild.wasmSha256);
      expect('cases' in result && result.status, row.profileRef.id).toBe('failed');
      if ('cases' in result) expect(result.cases.every((c) => c.stdoutMatches)).toBe(true);
    }
  });
  // Last: this deliberately grows the QA instance to the actual module's hard maximum.
  it('rejects readonly stores, lifetime metadata edits, nonfinite bits and forged pointer bounds', async () => {
    const request = await c6RunRequest(
      'int main(){const int fixed=7;float f=.125f;int a[2]={1,2};int *p=a;return fixed+*p;}',
    );
    const original = (await decodeC6Response(
      packet(request),
      request,
      engineBuild.wasmSha256,
    )) as C6Result;
    const readonlyObject = original
      .trace!.steps.flatMap((s) => s.changes)
      .find(
        (c) =>
          c.op === 'record' &&
          c.table === 'objects' &&
          c.after !== null &&
          'name' in c.after &&
          c.after.name === 'fixed',
      );
    expect(readonlyObject?.op).toBe('record');
    const oid = readonlyObject!.op === 'record' ? readonlyObject!.id : '';
    for (const mutate of [
      (v: C6Result) => {
        v.trace!.steps.find((s) =>
          s.changes.some((c) => c.op === 'cell' && c.objectId === oid),
        )!.kind = 'value.write';
      },
      (v: C6Result) => {
        const change = v
          .trace!.steps.flatMap((s) => s.changes)
          .find(
            (c) => c.op === 'record' && c.table === 'objects' && c.before !== null && c.id === oid,
          )!;
        if (change.op === 'record' && change.after && 'writable' in change.after)
          change.after.writable = true;
      },
      (v: C6Result) => {
        for (const s of v.trace!.steps)
          for (const c of s.changes)
            if (c.op === 'cell' && c.after && typeof c.after === 'object' && 'kind' in c.after) {
              c.after.bits = '7fc00000';
              return;
            }
      },
      (v: C6Result) => {
        for (const s of v.trace!.steps)
          for (const c of s.changes)
            if (
              c.op === 'cell' &&
              c.after &&
              typeof c.after === 'object' &&
              'pointeeType' in c.after
            ) {
              c.after.upperBound += 4;
              return;
            }
      },
    ]) {
      const changed = structuredClone(original);
      mutate(changed);
      await expect(
        decodeC6Response(recode(changed), request, engineBuild.wasmSha256),
      ).rejects.toThrow('E_PROTOCOL_INVALID');
    }
  });
  // Last: this deliberately grows the QA instance to the actual module's hard maximum.
  it('enforces the actual WASM maximum at 128 MiB and rejects one more page', () => {
    const pages = wasm.memory.buffer.byteLength / 65536;
    expect(wasm.memory.grow(2048 - pages)).toBe(pages);
    expect(wasm.memory.buffer.byteLength).toBe(134217728);
    expect(() => wasm.memory.grow(1)).toThrow(RangeError);
  });
});
