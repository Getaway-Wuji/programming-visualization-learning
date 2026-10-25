import { parseContent } from '../../../web/src/content';
import {
  caseRequest,
  ExecutionClient,
  type ExecutionCatalog,
  type PreparedSource,
} from '../../../web/src/engine/execution-client';
import {
  decodeResult,
  type ExecuteRequest,
  type ExecuteResult,
} from '../../../web/src/engine/protocol';

/** Public developer examples only. This separately built /checks entry never issues learning facts. */
export type ExecutionVariant =
  | 'normal'
  | 'changed'
  | 'division'
  | 'uninitialized'
  | 'resource'
  | 'markup'
  | 'array-first-30'
  | 'array-tail-30'
  | 'array-single';
export const executionMarker = 'CVIZ-07.1-PUBLIC-AUDIT';
let client = new ExecutionClient();
let catalog: ExecutionCatalog | undefined;
let source: PreparedSource | undefined;
let contextId = crypto.randomUUID();
let revision = 1;
let validationDelay = 0;
let committed: ExecuteResult | undefined;
let commitCount = 0;
let last: ExecuteResult | undefined;
let lastRun:
  { catalog: ExecutionCatalog; request: ExecuteRequest; result: ExecuteResult } | undefined;
const jobs = new Map<string, Promise<ReturnType<typeof summary>>>();

// Finite, authored mechanism fixtures. They retain the real param.x input
// binding and use ordinary Rust preparation/execution; no arbitrary source
// entry or product custom-code capability is exposed by this checks bundle.
const array30 =
  '1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30';

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
  };
}

function connected() {
  if (!catalog || !source) throw new Error('Prepare a public example first.');
  return { catalog, source };
}

export const executionChecks = {
  async open(caseId = 'case.c.assignment', variant: ExecutionVariant = 'normal', delay = 0) {
    client.invalidate();
    validationDelay = delay;
    client = new ExecutionClient({
      decode: async (buffer, request, guard) => {
        if (validationDelay)
          await new Promise<void>((resolve) => setTimeout(resolve, validationDelay));
        return decodeResult(buffer, request, guard);
      },
    });
    committed = undefined;
    last = undefined;
    lastRun = undefined;
    commitCount = 0;
    contextId = crypto.randomUUID();
    revision = 1;
    const response = await fetch('/content/sample/02.1-content-1.0.0.json', {
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Public test content unavailable.');
    const content = parseContent(new Uint8Array(await response.arrayBuffer()));
    const subject = content.cases.find((item) => item.id === caseId);
    if (!subject) throw new Error('Unknown public case.');
    const program = structuredClone(
      content.programs.find((item) => item.id === subject.programRef.id)!,
    );
    const inputSpec = content.inputSpecs.find((item) => item.id === program.inputRef.id)!;
    if (variant !== 'normal') {
      if (caseId !== 'case.c.assignment')
        throw new Error('Variants use the public scalar example.');
      const replacement = {
        changed: 'x = x + 7;',
        division: 'x = x / 0;',
        uninitialized: 'int missing; x = missing;',
        resource: 'while (1) { ; }',
        markup: `printf("${executionMarker} <b>safe text</b>\\n"); x = x + 2;`,
        'array-first-30': `int values[30] = {${array30}};\n    values[0] = x + 100;\n    x = x + 2;`,
        'array-tail-30': `int values[30] = {${array30}};\n    values[29] = x + 100;\n    x = x + 2;`,
        'array-single': 'int values[1] = {7};\n    values[0] = x + 100;\n    x = x + 2;',
      }[variant];
      Object.assign(program, {
        sourceExample: `/* ${executionMarker} */\n${program.sourceExample.replace('x = x + 2;', replacement)}`,
      });
    }
    catalog = {
      packageRef: { id: content.packageId, version: content.packageVersion },
      subject,
      program,
      inputSpec,
    };
    source = await client.prepare(catalog);
    return { source: source.text, bindings: source.bindingMap.length, inspect: client.inspect() };
  },
  start(patch: Partial<ExecuteRequest> = {}) {
    const active = connected();
    const request = {
      ...caseRequest(active.catalog, active.source, {
        contextId,
        contextRevision: revision,
        sourceRevision: revision,
      }),
      ...patch,
    };
    const capturedRequest = structuredClone(request);
    const id = request.identity.runId;
    const pending = client
      .execute(request, active.catalog, (result) => {
        committed = result;
        commitCount++;
      })
      .then((result) => {
        last = result;
        lastRun = { catalog: active.catalog, request: capturedRequest, result };
        return summary(result);
      });
    jobs.set(id, pending);
    return id;
  },
  async run(patch: Partial<ExecuteRequest> = {}) {
    return executionChecks.wait(executionChecks.start(patch));
  },
  wait(id: string) {
    const job = jobs.get(id);
    if (!job) throw new Error('Unknown execution check.');
    return job;
  },
  cancel() {
    client.cancel();
  },
  invalidate() {
    revision++;
    client.invalidate();
    committed = undefined;
  },
  inspect() {
    return {
      ...client.inspect(),
      commitCount,
      committed: committed ? summary(committed) : null,
      last: last ? summary(last) : null,
    };
  },
  /** Copy the actual most recently settled run only after it has completed.
   * Tests may inspect every supplied delta; this never synthesizes a result. */
  get() {
    if (!lastRun) throw new Error('No settled execution check is available.');
    return structuredClone(lastRun);
  },
  close() {
    client.invalidate();
    catalog = undefined;
    source = undefined;
    committed = undefined;
    lastRun = undefined;
    jobs.clear();
  },
};

declare global {
  interface Window {
    executionChecks: typeof executionChecks;
  }
}
window.executionChecks = executionChecks;
window.addEventListener('pagehide', () => executionChecks.close());
