import { C6ExecutionClient, c6RunRequest, acceptedC6Request } from '../../web/src/engine/c6-client';
import { C6Player, c6Equal } from '../../web/src/engine/c6-player';
import {
  c6SourceHash,
  type C6JudgeRequest,
  type C6EditRequest,
  type C6Result,
} from '../../web/src/engine/c6-protocol';
import { engineBuild } from '../../web/src/generated/c6-teaching/engine-build';
const client = new C6ExecutionClient();
let accepted: C6Result | null = null;
let generation = 0;
const api = {
  build: engineBuild,
  async run(source: string, input = '') {
    const token = ++generation;
    accepted = null;
    const started = performance.now(),
      request = await c6RunRequest(source, input);
    if (token !== generation) throw new Error('E_CANCELLED');
    const result = (await client.execute(request, { started })) as C6Result;
    if (token !== generation) throw new Error('E_CANCELLED');
    accepted = result;
    const player = result.trace ? new C6Player(result) : null;
    const final = player?.seek(result.trace!.steps.length);
    return {
      result,
      final,
      elapsedMs: performance.now() - started,
      receipt: acceptedC6Request(result) !== null,
      inspect: client.inspect(),
    };
  },
  async judge(source: string, profileRef: { id: string; version: string }) {
    ++generation;
    accepted = null;
    const started = performance.now(),
      run = await c6RunRequest(source);
    const { input, ...common } = run;
    void input;
    const request: C6JudgeRequest = {
      ...common,
      judgeVersion: '2.0.0',
      profileRef,
      packageRef: { id: 'content.c.primer6', version: '1.0.0' },
    };
    const result = await client.execute(request, { started });
    if (!('cases' in result)) throw new Error('Wrong result');
    return {
      status: result.status,
      aggregate: result.aggregate,
      cases: result.cases.map((c) => ({
        key: c.caseKey,
        observed: c.observationMatches,
        status: c.packet.terminal.status,
        steps: c.packet.trace?.steps.length,
        proofs: c.observations,
      })),
      elapsedMs: performance.now() - started,
      receipt: acceptedC6Request(result) !== null,
      inspect: client.inspect(),
    };
  },
  async edit(source: string) {
    ++generation;
    accepted = null;
    const started = performance.now();
    const request: C6EditRequest = {
      editVersion: '2.0.0',
      documentId: 'browser-document',
      packageRef: { id: 'content.c.primer6', version: '1.0.0' },
      engine: { id: 'engine.rust.c6', version: '0.1.0' },
      sourceRevision: crypto.randomUUID(),
      sourceSha256: await c6SourceHash(source),
      source,
    };
    return client.execute(request, { started });
  },
  replay() {
    if (!accepted?.trace) throw new Error('No real trace');
    const player = new C6Player(accepted);
    const initial = structuredClone(player.state);
    const sampleFrames = [];
    for (let i = 1; i <= accepted.trace.steps.length; i++) {
      player.seek(i);
      sampleFrames.push(player.state.frames.length);
    }
    const final = structuredClone(player.state);
    for (let i = accepted.trace.steps.length - 1; i >= 0; i--) player.seek(i);
    return {
      restored: c6Equal(initial, player.state),
      final,
      maxFrames: Math.max(0, ...sampleFrames),
    };
  },
  async cancelRun() {
    const request = await c6RunRequest('int main(){int x=0;while(1){x=x+1;}}');
    const promise = client.execute(request).then(
      () => 'accepted',
      (error) => (error as Error).message,
    );
    setTimeout(() => client.cancel(), 5);
    return { outcome: await promise, inspect: client.inspect() };
  },
  inspect() {
    return client.inspect();
  },
  cancel() {
    ++generation;
    client.cancel();
    accepted = null;
  },
  invalidate() {
    ++generation;
    client.invalidate();
    accepted = null;
  },
};
declare global {
  interface Window {
    c6Test: typeof api;
  }
}
window.c6Test = api;
