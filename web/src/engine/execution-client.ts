import type {
  CaseEntity,
  ExerciseEntity,
  JudgeProfileEntity,
  EntityRef,
  InputSpecEntity,
  InputValues,
  ProgramEntity,
} from '../content/types';
import { validateInputValues } from './input-data';
import { tryPreparePublishedSource } from './prepared-source';
import { engineBuild } from '../generated/engine-build';
import { claimEngineSlot, ModuleStore, sharedModuleStore, type ModuleDependencies } from './module';
import {
  decodeResult,
  encodeRequest,
  makeAdapterResult,
  type DiagnosticCode,
  type ExecuteRequest,
  type ExecuteResult,
} from './protocol';

export interface ExecutionCatalog {
  packageRef: EntityRef;
  subject: CaseEntity | ExerciseEntity;
  program: ProgramEntity;
  inputSpec: InputSpecEntity;
  judgeProfile?: JudgeProfileEntity;
}
export type PreparedSource = ExecuteRequest['source'];
export interface CaseInput {
  values: InputValues;
  random: ExecuteRequest['input']['random'];
}
export type ExecutionState =
  | 'idle'
  | 'preparing'
  | 'running'
  | 'validating'
  | 'accepted'
  | 'cancelled'
  | 'expired'
  | 'invalidated'
  | 'failed';
export class ExecutionFailure extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
export interface ExecutionDependencies extends ModuleDependencies {
  now?: () => number;
  createWorker?: () => Worker;
  decode?: typeof decodeResult;
}
interface Operation {
  id: string;
  start: number;
  controller: AbortController;
  timer?: ReturnType<typeof setTimeout>;
  worker?: Worker;
  responded: boolean;
  reject: (reason: ExecutionFailure) => void;
  releaseSlot?: () => void;
}

export function caseRequest(
  catalog: ExecutionCatalog,
  source: PreparedSource,
  context: { contextId: string; contextRevision: number; sourceRevision: number },
  input: CaseInput = { values: catalog.program.exampleInput, random: null },
): ExecuteRequest {
  return {
    kind: 'execute',
    protocolVersion: '1.0.0',
    traceVersion: '1.0.0',
    diagnosticVersion: '1.0.0',
    judgeVersion: '1.0.0',
    encodingVersion: '1.0.0',
    identity: {
      contextId: context.contextId,
      contextRevision: context.contextRevision,
      sourceRevision: context.sourceRevision,
      submissionId: crypto.randomUUID(),
      runId: crypto.randomUUID(),
      testCaseKey: null,
    },
    mode: 'case',
    packageRef: catalog.packageRef,
    languageRef: catalog.program.languageRef,
    subsetRef: catalog.program.subsetRef,
    programRef: { id: catalog.program.id, version: catalog.program.version },
    subjectRef: { id: catalog.subject.id, version: catalog.subject.version },
    learningRevision: catalog.subject.learningRevision,
    engineRef: { id: 'engine.c.p0', version: '1.0.0', buildId: engineBuild.wasmSha256 },
    source,
    input: {
      specRef: catalog.program.inputRef,
      values: input.values,
      random: input.random,
    },
    judge: null,
    budgetRef: { id: 'budget.p0', version: '1.0.0' },
    remainingMs: 1000,
  };
}

export class ExecutionClient {
  private active?: Operation;
  private state: ExecutionState = 'idle';
  private readonly store: ModuleStore;
  private readonly now: () => number;
  private readonly createWorker: () => Worker;
  constructor(private readonly dependencies: ExecutionDependencies = {}) {
    this.store =
      Object.keys(dependencies).length === 0 ? sharedModuleStore : new ModuleStore(dependencies);
    this.now = dependencies.now ?? (() => performance.now());
    this.createWorker =
      dependencies.createWorker ??
      (() => new Worker(new URL('./execution.worker.ts', import.meta.url), { type: 'module' }));
  }
  inspect() {
    return {
      state: this.state,
      activeWorkers: this.active?.worker ? 1 : 0,
      cachedModules: this.store.module ? 1 : 0,
    };
  }
  cancel() {
    if (this.active) this.fail(this.active, 'E_CANCELLED');
  }
  invalidate() {
    if (this.active) this.fail(this.active, 'E_CANCELLED');
    this.state = 'invalidated';
  }
  checkDeadline() {
    if (this.active) {
      try {
        this.guard(this.active);
      } catch {
        /* fail already invalidated the operation. */
      }
    }
  }
  private release(operation: Operation) {
    this.active = undefined;
    operation.releaseSlot?.();
    clearTimeout(operation.timer);
    operation.controller.abort();
    if (operation.worker) {
      operation.worker.onmessage = null;
      operation.worker.onerror = null;
      operation.worker.onmessageerror = null;
      operation.worker.terminate();
    }
  }
  private fail(operation: Operation, code: string) {
    if (this.active !== operation) return;
    this.state =
      code === 'E_CANCELLED' ? 'cancelled' : code === 'E_DEADLINE' ? 'expired' : 'failed';
    this.release(operation);
    operation.reject(new ExecutionFailure(code));
  }
  private guard(operation: Operation) {
    if (this.active !== operation) throw new ExecutionFailure('E_CANCELLED');
    if (this.now() - operation.start >= 1000) {
      this.fail(operation, 'E_DEADLINE');
      throw new ExecutionFailure('E_DEADLINE');
    }
  }
  private begin<T>(
    kind: 'prepare-case' | 'execute',
    catalog: ExecutionCatalog,
    request: ExecuteRequest | undefined,
    validate: (buffer: ArrayBuffer, guard: () => void) => Promise<T>,
    commit?: (value: T) => void,
    triggeredAt = this.now(),
    preparationBuffer?: ArrayBuffer,
    localPreparation?: (guard: () => void) => Promise<ArrayBuffer | null>,
  ): Promise<T> {
    this.cancel();
    this.state = 'preparing';
    return new Promise<T>((resolve, reject) => {
      const operation: Operation = {
        id: crypto.randomUUID(),
        start: triggeredAt,
        controller: new AbortController(),
        responded: false,
        reject,
      };
      this.active = operation;
      operation.releaseSlot = claimEngineSlot(() => this.fail(operation, 'E_CANCELLED'));
      operation.timer = setTimeout(
        () => this.fail(operation, 'E_DEADLINE'),
        Math.max(0, 1000 - (this.now() - triggeredAt)),
      );
      const guard = () => this.guard(operation);
      void (async () => {
        try {
          const catalogJson = JSON.stringify(catalog);
          if (new TextEncoder().encode(catalogJson).byteLength > 65536)
            throw new ExecutionFailure('E_CONTENT_MISMATCH');
          if (localPreparation) {
            const prepared = await localPreparation(guard);
            guard();
            if (prepared !== null) {
              this.state = 'validating';
              const value = await validate(prepared, guard);
              guard();
              commit?.(value);
              guard();
              this.state = 'idle';
              this.release(operation);
              resolve(value);
              return;
            }
          }
          const module = await this.store.load(operation.controller.signal, guard);
          guard();
          const worker = this.createWorker();
          operation.worker = worker;
          worker.onerror = (event) => {
            event.preventDefault();
            this.fail(operation, 'E_WORKER_FAILURE');
          };
          worker.onmessageerror = () => this.fail(operation, 'E_PROTOCOL_INVALID');
          worker.onmessage = (event: MessageEvent<unknown>) => {
            if (this.active !== operation || operation.worker !== worker || operation.responded)
              return;
            void (async () => {
              try {
                guard();
                operation.responded = true;
                const data = event.data as Record<string, unknown>;
                if (!data || data.operationId !== operation.id)
                  throw new ExecutionFailure('E_PROTOCOL_INVALID');
                if (data.ok === false) {
                  const allowed = [
                    'E_MODULE_LOAD',
                    'E_WORKER_FAILURE',
                    'E_WASM_TRAP',
                    'E_ENCODING_FAILURE',
                    'E_PROTOCOL_INVALID',
                    'E_PROTOCOL_VERSION',
                    'E_CONTENT_MISMATCH',
                    'E_DEADLINE',
                    'E_CANCELLED',
                    'E_REQUEST_LIMIT',
                    'E_SOURCE_LIMIT',
                    'E_FUEL_LIMIT',
                    'E_RESULT_LIMIT',
                    'E_INPUT_INVALID',
                    'E_INPUT_ORDER',
                  ];
                  throw new ExecutionFailure(
                    typeof data.code === 'string' && allowed.includes(data.code)
                      ? data.code
                      : 'E_WORKER_FAILURE',
                  );
                }
                if (
                  data.ok !== true ||
                  !(data.buffer instanceof ArrayBuffer) ||
                  data.buffer.byteLength > (kind === 'execute' ? 16777216 : 65536)
                )
                  throw new ExecutionFailure('E_PROTOCOL_INVALID');
                this.state = 'validating';
                const value = await validate(data.buffer, guard);
                guard();
                commit?.(value);
                guard();
                this.state = kind === 'execute' ? 'accepted' : 'idle';
                this.release(operation);
                resolve(value);
              } catch (error) {
                this.fail(
                  operation,
                  error instanceof Error && /^E_[A-Z_]+$/.test(error.message)
                    ? error.message
                    : 'E_PROTOCOL_INVALID',
                );
              }
            })();
          };
          let buffer: ArrayBuffer | undefined = preparationBuffer;
          if (request) {
            request.remainingMs = Math.floor(1000 - (this.now() - operation.start));
            guard();
            if (request.remainingMs < 1) throw new ExecutionFailure('E_DEADLINE');
            buffer = encodeRequest(request).buffer;
          }
          guard();
          this.state = kind === 'execute' ? 'running' : 'preparing';
          worker.postMessage(
            {
              kind,
              operationId: operation.id,
              module,
              catalogJson,
              buffer,
              buildId: engineBuild.wasmSha256,
              remainingMs: Math.floor(1000 - (this.now() - operation.start)),
            },
            buffer ? [buffer] : [],
          );
        } catch (error) {
          this.fail(
            operation,
            error instanceof Error && /^E_[A-Z_]+$/.test(error.message)
              ? error.message
              : 'E_MODULE_LOAD',
          );
        }
      })();
    });
  }
  prepare(
    catalog: ExecutionCatalog,
    values: InputValues = catalog.program.exampleInput,
    triggeredAt = this.now(),
  ): Promise<PreparedSource> {
    const snapshot = structuredClone(catalog);
    const selected = structuredClone(values);
    const validation = validateInputValues(snapshot.inputSpec, selected);
    if (!validation.ok) {
      this.invalidate();
      return Promise.reject(new ExecutionFailure('E_INPUT_INVALID'));
    }
    const bytes = new TextEncoder().encode(
      JSON.stringify(
        Object.fromEntries(
          Object.keys(selected)
            .sort()
            .map((key) => [key, selected[key]]),
        ),
      ),
    );
    if (bytes.byteLength > 65536) return Promise.reject(new ExecutionFailure('E_INPUT_INVALID'));
    return this.begin(
      'prepare-case',
      snapshot,
      undefined,
      async (buffer, guard) => {
        guard();
        const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)) as {
          source: PreparedSource;
        };
        if (
          !value ||
          Object.keys(value).join() !== 'source' ||
          !value.source ||
          typeof value.source.text !== 'string' ||
          new TextEncoder().encode(value.source.text).byteLength > 32768 ||
          !Array.isArray(value.source.bindingMap) ||
          !Array.isArray(value.source.blockMap)
        )
          throw new ExecutionFailure('E_PROTOCOL_INVALID');
        // The ordinary request validator checks every prepared range and field.
        encodeRequest(
          caseRequest(
            snapshot,
            value.source,
            {
              contextId: 'prepare',
              contextRevision: 1,
              sourceRevision: 1,
            },
            { values: selected, random: null },
          ),
        );
        guard();
        return value.source;
      },
      undefined,
      triggeredAt,
      bytes.buffer,
      async (guard) => {
        const source = await tryPreparePublishedSource(snapshot, selected, guard);
        guard();
        if (source === null) return null;
        const prepared = new TextEncoder().encode(JSON.stringify({ source }));
        if (prepared.byteLength > 65536) throw new ExecutionFailure('E_PROTOCOL_INVALID');
        return prepared.buffer;
      },
    );
  }
  async execute(
    request: ExecuteRequest,
    catalog: ExecutionCatalog,
    commit?: (result: ExecuteResult) => void,
    triggeredAt = this.now(),
  ): Promise<ExecuteResult> {
    // Snapshot before any await. The caller cannot mutate an in-flight identity/source.
    const snapshot = structuredClone(request);
    try {
      if (snapshot.mode === 'contract-probe') {
        this.cancel();
        this.state = 'failed';
        throw new ExecutionFailure('E_PROTOCOL_INVALID');
      }
      return await this.begin(
        'execute',
        structuredClone(catalog),
        snapshot,
        async (buffer, guard) => {
          const result = await (this.dependencies.decode ?? decodeResult)(buffer, snapshot, guard);
          guard();
          if (result.producer !== 'rust') throw new ExecutionFailure('E_PROTOCOL_INVALID');
          return result;
        },
        commit,
        triggeredAt,
      );
    } catch (error) {
      const code = error instanceof ExecutionFailure ? error.code : 'E_PROTOCOL_INVALID';
      const status =
        code === 'E_CANCELLED'
          ? 'cancelled'
          : [
                'E_DEADLINE',
                'E_REQUEST_LIMIT',
                'E_SOURCE_LIMIT',
                'E_FUEL_LIMIT',
                'E_RESULT_LIMIT',
              ].includes(code)
            ? 'resource-limit'
            : ['E_PROTOCOL_VERSION', 'E_CONTENT_MISMATCH'].includes(code)
              ? 'rejected'
              : 'infrastructure-failure';
      const result = makeAdapterResult(snapshot, status, code as DiagnosticCode);
      if (code === 'E_PROTOCOL_VERSION') {
        const actual = (
          [
            snapshot.protocolVersion,
            snapshot.traceVersion,
            snapshot.diagnosticVersion,
            snapshot.judgeVersion,
            snapshot.encodingVersion,
          ] as string[]
        ).find((version) => version !== '1.0.0');
        result.terminal.diagnostics[0]!.details = {
          expected: '1.0.0',
          actual:
            typeof actual === 'string' && actual.length <= 96 ? actual : 'unsupported-version',
        };
      }
      if (code === 'E_DEADLINE')
        result.terminal.diagnostics[0]!.details = {
          dimension: 'deadline',
          limit: 1000,
          used: Math.max(1000, Math.floor(this.now() - triggeredAt)),
        };
      return result;
    }
  }
}

export const executionClient = new ExecutionClient();
