import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const summaries = [];
for (const name of ['default-pair', 'empty', 'single', 'equal', 'sorted', 'reverse', 'limits', 'max30']) {
  const path = `.artifacts/16.2/browser/formal-comparison/${name}.json.gz`;
  const workers = JSON.parse(gunzipSync(readFileSync(path)));
  assert.equal(workers.length, 2);
  const decoded = workers.map((worker) => {
    assert.equal(worker.moduleSeen, true); assert.equal(worker.responseOk, true);
    const request = JSON.parse(Buffer.from(worker.requestBase64, 'base64'));
    const buffer = Buffer.from(worker.responseBase64, 'base64'), result = JSON.parse(buffer);
    assert.equal(result.producer, 'rust'); assert.equal(result.terminal.status, 'completed');
    assert.deepEqual(result.identity, request.identity);
    assert.equal(request.languageRef.id, 'lang.c');
    assert.ok(request.remainingMs > 0 && request.remainingMs <= 1000);
    assert.ok(result.trace.steps.length <= 20000 && buffer.length <= 16 * 1024 * 1024);
    const counterChanges = result.trace.steps.flatMap((step) => step.changes).filter((change) => change.op === 'counters');
    return { request, result, summary: {
      program: result.programRef, subject: result.subjectRef, identity: result.identity,
      sourceSha256: sha(Buffer.from(request.source.text)), requestRemainingMs: request.remainingMs,
      responseBytes: buffer.length, responseSha256: sha(buffer), steps: result.trace.steps.length,
      counters: counterChanges.at(-1)?.after ?? result.trace.initialState.counters,
      terminal: result.terminal, stats: result.stats,
    } };
  });
  assert.deepEqual(decoded[0].request.input, decoded[1].request.input);
  for (const key of ['contextId', 'submissionId', 'runId']) assert.notEqual(decoded[0].request.identity[key], decoded[1].request.identity[key]);
  assert.ok(decoded[1].request.remainingMs < decoded[0].request.remainingMs);
  summaries.push({ name, source: { path, sha256: sha(readFileSync(path)) }, inputEqual: true, distinctIdentities: true, sharedDeadlineObserved: true, programs: decoded.map((item) => item.summary) });
}
writeFileSync('.artifacts/16.2/real-pair-summary.json', JSON.stringify({ version: '1.0.0', task: '16.2', pairs: summaries }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ realPairs: summaries.length, realRustExecutions: summaries.length * 2, max30: summaries.at(-1).programs.map((program) => ({ steps: program.steps, counters: program.counters, remainingMs: program.requestRemainingMs })) }));
