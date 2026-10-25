import { parseContent } from '../../../web/src/content';
import type { InputValues } from '../../../web/src/content/types';
import {
  caseRequest,
  ExecutionClient,
  type ExecutionCatalog,
  type PreparedSource,
} from '../../../web/src/engine/execution-client';
import { generateInput } from '../../../web/src/engine/input-data';
import type { ExecuteRequest, ExecuteResult } from '../../../web/src/engine/protocol';

/** Public input fixtures only; this separate checks entry never changes a static template. */
let client = new ExecutionClient();
let catalog: ExecutionCatalog | undefined;
let source: PreparedSource | undefined;
let values: InputValues | undefined;
let random: ExecuteRequest['input']['random'] = null;
let contextId = crypto.randomUUID();
let revision = 1;
let last: ExecuteResult | undefined;
let lastRequest: ExecuteRequest | undefined;
let commitCount = 0;
let elapsedMs = 0;

function summary(result: ExecuteResult) {
  return {
    identity: result.identity,
    producer: result.producer,
    status: result.terminal.status,
    exitCode: result.terminal.exitCode,
    codes: result.terminal.diagnostics.map((diagnostic) => diagnostic.code),
    cursor: result.terminal.cursor,
    steps: result.trace?.steps.length ?? null,
    completeness: result.trace?.completeness ?? null,
    nodeCount: result.nodeMap.length,
    bindingCount: result.resolvedBindings.length,
    output: result.trace
      ? result.trace.initialState.output +
        result.trace.steps
          .flatMap((step) =>
            step.changes.filter((change) => change.op === 'output').map((change) => change.append),
          )
          .join('')
      : null,
    stats: result.stats,
    judge: result.judgeResult,
    elapsedMs,
  };
}

export const inputChecks = {
  async open(
    caseId = 'case.c.assignment',
    inputValues?: InputValues,
    randomInput: ExecuteRequest['input']['random'] = null,
  ) {
    client.invalidate();
    client = new ExecutionClient();
    source = undefined;
    last = undefined;
    lastRequest = undefined;
    commitCount = 0;
    elapsedMs = 0;
    contextId = crypto.randomUUID();
    revision++;
    const response = await fetch('/content/sample/02.1-content-1.0.0.json', {
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Public test content unavailable.');
    const content = parseContent(new Uint8Array(await response.arrayBuffer()));
    const subject = content.cases.find((item) => item.id === caseId);
    if (!subject) throw new Error('Unknown public input case.');
    const program = content.programs.find((item) => item.id === subject.programRef.id)!;
    const inputSpec = content.inputSpecs.find((item) => item.id === program.inputRef.id)!;
    catalog = {
      packageRef: { id: content.packageId, version: content.packageVersion },
      subject,
      program,
      inputSpec,
    };
    values = structuredClone(inputValues ?? program.exampleInput);
    random = structuredClone(randomInput);
    const originalExample = JSON.stringify(program.exampleInput);
    source = await client.prepare(catalog, values);
    if (JSON.stringify(program.exampleInput) !== originalExample)
      throw new Error('Static public example was mutated.');
    return {
      source: source.text,
      bindings: source.bindingMap.length,
      values,
      exampleInput: program.exampleInput,
      inspect: client.inspect(),
    };
  },
  async run() {
    if (!catalog || !source || !values) throw new Error('Prepare a public input first.');
    const request = caseRequest(
      catalog,
      source,
      { contextId, contextRevision: revision, sourceRevision: revision },
      { values, random },
    );
    lastRequest = structuredClone(request);
    const start = performance.now();
    const result = await client.execute(request, catalog, () => {
      commitCount++;
    });
    elapsedMs = performance.now() - start;
    last = result;
    return summary(result);
  },
  async openRandom(caseId: string, seed: string, length?: number) {
    await inputChecks.open(caseId);
    if (!catalog) throw new Error('Public random specification unavailable.');
    const generated = generateInput(catalog.inputSpec, seed, length);
    return inputChecks.open(caseId, generated.values, generated.random);
  },
  inspect() {
    return {
      ...client.inspect(),
      commitCount,
      source: source?.text ?? null,
      request: lastRequest,
      last: last ? summary(last) : null,
    };
  },
  close() {
    client.invalidate();
    catalog = undefined;
    source = undefined;
    values = undefined;
    random = null;
    last = undefined;
    lastRequest = undefined;
  },
};

declare global {
  interface Window {
    inputChecks: typeof inputChecks;
  }
}
window.inputChecks = inputChecks;
window.addEventListener('pagehide', () => inputChecks.close());
