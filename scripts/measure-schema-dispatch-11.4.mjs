// Isolated read-only measurement of the same archived real Rust packet.
// This does not execute user C or establish a browser acceptance result.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { MessageChannel } from 'node:worker_threads';
import { validateResultSchema as before } from '../tests/fixtures/execution-schema-before-dispatch-11.4.ts';
import { validateResultSchema as after } from '../web/src/engine/execution-schema.generated.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const label = process.env.SCHEMA_DISPATCH_LABEL;
if (!label || !/^[a-z0-9-]+$/.test(label)) throw new Error('Set a unique SCHEMA_DISPATCH_LABEL.');
const output = path.join(root, `.artifacts/11.4/schema-dispatch-${label}.json`);
if (fs.existsSync(output)) throw new Error('Measurement output already exists.');
const source = path.resolve(
  root,
  process.env.SCHEMA_PACKET_PATH ??
    '.artifacts/11.4/qa-candidate-06/regression/case-set/browser-captures/chrome/bubble-sort-maximum/result.json',
);
const bytes = fs.readFileSync(source);
const packet = JSON.parse(bytes.toString('utf8'));
if (
  packet.producer !== 'rust' ||
  packet.terminal?.status !== 'completed' ||
  packet.trace?.completeness !== 'complete' ||
  packet.trace?.steps?.length !== 5330 ||
  packet.trace?.checkpoints?.length !== 42
)
  throw new Error('Expected an archived complete real Rust maximum workload with 5,330 steps.');
const packetBefore = JSON.stringify(packet);
const samples = [];
const validators = { before, after };
function timing() {
  const start = performance.now();
  let last = start,
    calls = 0,
    maxGuardGapMs = 0;
  return {
    start,
    guard() {
      const now = performance.now();
      maxGuardGapMs = Math.max(maxGuardGapMs, now - last);
      last = now;
      calls++;
    },
    result() {
      const now = performance.now();
      return {
        ms: now - start,
        guardCalls: calls,
        maxGuardGapMs,
        trailingGapMs: now - last,
      };
    },
  };
}
for (let trial = 0; trial < 6; trial++) {
  const order = trial % 2 === 0 ? ['before', 'after'] : ['after', 'before'];
  for (const variant of order) {
    const clock = timing();
    const work = validators[variant](packet, clock.guard);
    let next = work.next(),
      yields = 0;
    while (!next.done) {
      yields++;
      next = work.next();
    }
    if (!next.value) throw new Error(`${variant} rejected the actual packet.`);
    samples.push({ trial: trial + 1, variant, firstCall: trial === 0, yields, ...clock.result() });
  }
}
function yieldTask() {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}
async function runAsync(work, guard) {
  let since = performance.now();
  guard();
  let next = work.next();
  while (!next.done) {
    guard();
    if (performance.now() - since >= 6) {
      await yieldTask();
      guard();
      since = performance.now();
    }
    next = work.next();
  }
  guard();
  return next.value;
}
const cooperative = [];
const cancellation = [];
for (const variant of ['before', 'after']) {
  const clock = timing();
  if (!(await runAsync(validators[variant](packet, clock.guard), clock.guard)))
    throw new Error(`${variant} cooperative validation failed.`);
  cooperative.push({ variant, ...clock.result() });
  let calls = 0,
    scheduled = false,
    cancelledAt = null,
    observedAt = null;
  const sentinel = new Error('owner-cancelled-schema-dispatch');
  const guard = () => {
    if (cancelledAt !== null) {
      observedAt = performance.now();
      throw sentinel;
    }
    if (++calls === 1000) {
      scheduled = true;
      setTimeout(() => {
        cancelledAt = performance.now();
      }, 0);
    }
  };
  let rejected = false;
  try {
    await runAsync(validators[variant](packet, guard), guard);
  } catch (error) {
    if (error !== sentinel) throw error;
    rejected = true;
  }
  cancellation.push({
    variant,
    guardCallsBeforeCancellation: calls,
    scheduled,
    rejected,
    observedAfterCancellationMs:
      observedAt !== null && cancelledAt !== null ? observedAt - cancelledAt : null,
  });
  if (!scheduled || !rejected) throw new Error(`${variant} did not observe owner cancellation.`);
}
if (JSON.stringify(packet) !== packetBefore)
  throw new Error('Schema validation mutated the packet.');
fs.writeFileSync(
  output,
  JSON.stringify(
    {
      note: 'Isolated Node same-packet schema-only AB/BA measurements. Every trial, including each implementation first call, is retained. Not a new C execution, full decode benchmark, or browser acceptance result. Cooperative runs use the production 6ms MessageChannel scheduling pattern.',
      source: path.relative(root, source).split(path.sep).join('/'),
      packetSha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
      buildId: packet.engineRef.buildId,
      steps: packet.trace.steps.length,
      checkpoints: packet.trace.checkpoints.length,
      nodeVersion: process.version,
      samples,
      cooperative,
      cancellation,
    },
    null,
    2,
  ),
  { flag: 'wx' },
);
process.stdout.write(`${path.relative(root, output)}\n`);
