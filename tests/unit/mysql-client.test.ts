/** Controlled Worker delivery exercises lifecycle; every delivered packet comes from real SQL WASM. */
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { execute_mysql, initSync } from '../../web/src/generated/mysql/c_viz_mysql';
import { mysqlBuild } from '../../web/src/generated/mysql/engine-build';
import {
  acceptedMysqlExecution,
  currentMysqlExecution,
  MysqlClient,
} from '../../web/src/engine/mysql-client';
import { defaultMysqlSession } from '../../web/src/engine/mysql-data';

const bytes = new Uint8Array(readFileSync('web/src/generated/mysql/c_viz_mysql_bg.wasm'));
let pages = 0;
beforeAll(() => {
  const instance = initSync({ module: bytes });
  pages = instance.memory.buffer.byteLength / 65536;
});
class ControlledWorker {
  static workers: ControlledWorker[] = [];
  onmessage: Worker['onmessage'] = null;
  onerror: Worker['onerror'] = null;
  onmessageerror: Worker['onmessageerror'] = null;
  sent?: { id: string; module: WebAssembly.Module; buffer: ArrayBuffer; remaining: number };
  terminate = vi.fn();
  constructor() {
    ControlledWorker.workers.push(this);
  }
  postMessage(message: NonNullable<ControlledWorker['sent']>) {
    this.sent = message;
  }
  reply(handler = this.onmessage, extra: Record<string, unknown> = {}) {
    const sent = this.sent!;
    const buffer = execute_mysql(
      new Uint8Array(sent.buffer),
      mysqlBuild.wasmSha256,
      sent.remaining,
    ).slice().buffer;
    handler?.call(
      this as unknown as Worker,
      new MessageEvent('message', { data: { id: sent.id, buffer, wasmPages: pages, ...extra } }),
    );
  }
}
const clients: MysqlClient[] = [];
function setup() {
  vi.stubGlobal('Worker', ControlledWorker);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(bytes, { headers: { 'content-type': 'application/wasm' } })),
  );
  const client = new MysqlClient();
  clients.push(client);
  return client;
}
async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 0));
  expect(check()).toBe(true);
}
afterEach(() => {
  clients.splice(0).forEach((client) => client.cancel());
  ControlledWorker.workers = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('real accepted results are deeply frozen, request-bound and invalidated by editing', async () => {
  const client = setup(),
    session = defaultMysqlSession(),
    pending = client.run('SELECT 1;', session, 'draft-one');
  session.database.tables = [];
  await until(() => ControlledWorker.workers.length === 1 && !!ControlledWorker.workers[0].sent);
  ControlledWorker.workers[0].reply();
  const response = await pending;
  expect(Object.isFrozen(response.replay!.trace.steps)).toBe(true);
  const proof = acceptedMysqlExecution(response)!;
  expect(proof.request.sourceRevision).toBe('draft-one');
  expect(
    proof.request.operation === 'execute' && proof.request.session.database.tables.length,
  ).toBe(2);
  expect(currentMysqlExecution(response)).not.toBeNull();
  expect(acceptedMysqlExecution(structuredClone(response))).toBeNull();
  proof.request.source = 'changed outside';
  expect(acceptedMysqlExecution(response)!.request.source).toBe('SELECT 1;');
  client.invalidate();
  expect(currentMysqlExecution(response)).toBeNull();
  expect(acceptedMysqlExecution(response)).not.toBeNull();
});
test('cancel and a new run reject old deliveries and keep only the current execution', async () => {
  const client = setup(),
    old = client.run('SELECT 1;', defaultMysqlSession()).catch((error: Error) => error.message);
  await until(() => ControlledWorker.workers.length === 1 && !!ControlledWorker.workers[0].sent);
  const first = ControlledWorker.workers[0],
    late = first.onmessage;
  const next = client.run('SELECT 2;', defaultMysqlSession(), 'new');
  await until(() => ControlledWorker.workers.length === 2 && !!ControlledWorker.workers[1].sent);
  first.reply(late);
  ControlledWorker.workers[1].reply();
  expect(await old).toBe('E_CANCELLED');
  const accepted = await next;
  expect(acceptedMysqlExecution(accepted)?.request.source).toBe('SELECT 2;');
  expect(first.terminate).toHaveBeenCalledOnce();
  const cancelled = client
    .run('SELECT 3;', defaultMysqlSession())
    .catch((error: Error) => error.message);
  await until(() => ControlledWorker.workers.length === 3 && !!ControlledWorker.workers[2].sent);
  client.cancel();
  expect(await cancelled).toBe('E_CANCELLED');
});
test('one slot is shared across client instances and invalid Worker envelopes mint no proof', async () => {
  const one = setup(),
    two = setup(),
    old = one.run('SELECT 1;', defaultMysqlSession()).catch((error: Error) => error.message);
  await until(() => ControlledWorker.workers.length === 1 && !!ControlledWorker.workers[0].sent);
  const pending = two
    .run('SELECT 2;', defaultMysqlSession())
    .catch((error: Error) => error.message);
  await until(() => ControlledWorker.workers.length === 2 && !!ControlledWorker.workers[1].sent);
  ControlledWorker.workers[1].reply(undefined, { wasmPages: 2049 });
  expect(await old).toBe('E_CANCELLED');
  expect(await pending).toBe('E_PROTOCOL_INVALID');
});
test('the end-to-end deadline rejects a result delivered after the shared second', async () => {
  const client = setup();
  let time = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => time);
  const pending = client
    .run('SELECT 1;', defaultMysqlSession())
    .catch((error: Error) => error.message);
  await until(() => ControlledWorker.workers.length === 1 && !!ControlledWorker.workers[0].sent);
  time = 1000;
  ControlledWorker.workers[0].reply();
  expect(await pending).toBe('E_DEADLINE');
});
