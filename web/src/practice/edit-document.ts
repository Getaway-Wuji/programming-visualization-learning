import type { InputBinding } from '../content/types';
import type { PreparedSource } from '../engine/execution-client';
import type { ExerciseCatalog } from '../content/practice';
import { analysisClient, type AnalysisClient } from '../engine/analysis-client';
import type { Diagnostic, ExecuteRequest } from '../engine/protocol';
import type { BlockProgram } from '../blocks/model';
import type { BlockWorkspaceDraft } from '../blocks/workspace';
import type {
  AnalysisIdentity,
  AnalysisRefs,
  MappingIssue,
  ReverseProjection,
  SourceProvenance,
} from '../blocks/analysis-types';
import { reverseAnalysis, UnmappedSourceError } from '../blocks/reverse';
import { generatedSyntheticRanges, patchBlockSource } from '../blocks/source-patch';

export type AnalysisPort = Pick<AnalysisClient, 'analyze' | 'cancel'>;
type SavedProjection = {
  documentRevision: number;
  sourceText: string;
  program: BlockProgram;
  blockMap: PreparedSource['blockMap'];
  bindingMap: PreparedSource['bindingMap'];
  provenance: SourceProvenance;
};
export interface EditDocumentSnapshot {
  kind: 'editDocument';
  editVersion: '1.0.0';
  identity: AnalysisIdentity;
  refs: AnalysisRefs;
  origin: 'code' | 'blocks' | 'input';
  authoritativeDraft:
    { kind: 'code'; text: string } | { kind: 'blocks'; workspaceSnapshotId: string };
  codeDraft: string;
  blockDraft: {
    workspaceSnapshotId: string;
    blocklyVersion: '13.4.0';
    program: BlockProgram | null;
  };
  input: ExecuteRequest['input'];
  inputBindings: (Omit<InputBinding, 'emptyStorage'> & {
    emptyStorage: 'one-zero-placeholder' | null;
  })[];
  syncStatus: 'synced' | 'invalid' | 'unmapped';
  analysisPending: boolean;
  analysisError: {
    code: 'module' | 'transport' | 'cancelled' | 'budget' | 'response' | 'version';
  } | null;
  validatedDocumentRevision: number | null;
  diagnostics: readonly Diagnostic[];
  issues: readonly MappingIssue[];
  lastSynced: SavedProjection | null;
}
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const saved = (projection: ReverseProjection): SavedProjection => ({
  documentRevision: projection.documentRevision,
  sourceText: projection.sourceText,
  program: projection.program,
  blockMap: projection.source.blockMap,
  bindingMap: projection.source.bindingMap,
  provenance: projection.provenance,
});
export function retainedSyntheticRanges(projection: ReverseProjection | undefined, text: string) {
  if (!projection) return [];
  const before = encoder.encode(projection.sourceText),
    after = encoder.encode(text);
  let prefix = 0,
    suffix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix])
    prefix++;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]
  )
    suffix++;
  return projection.provenance.syntheticSegments.flatMap(({ byteRange }) => {
    if (byteRange.end <= prefix) return [{ ...byteRange }];
    if (byteRange.start >= before.length - suffix) {
      const shift = after.length - before.length;
      return [{ start: byteRange.start + shift, end: byteRange.end + shift }];
    }
    return [];
  });
}
export function replaceInputDeclarations(source: PreparedSource, prepared: PreparedSource): string {
  const original = encoder.encode(source.text);
  const replacement = encoder.encode(prepared.text);
  const keys = new Set(source.bindingMap.map((binding) => binding.bindingKey));
  if (keys.size !== source.bindingMap.length || keys.size !== prepared.bindingMap.length)
    throw new Error('INPUT_BINDING');
  const changes = source.bindingMap
    .map((binding) => {
      const matches = prepared.bindingMap.filter((item) => item.bindingKey === binding.bindingKey);
      if (matches.length !== 1) throw new Error('INPUT_BINDING');
      const target = matches[0].byteRange;
      return { range: binding.byteRange, bytes: replacement.slice(target.start, target.end) };
    })
    .sort((a, b) => a.range.start - b.range.start);
  const chunks: Uint8Array[] = [];
  let cursor = 0;
  for (const change of changes) {
    if (
      change.range.start < cursor ||
      change.range.end <= change.range.start ||
      change.range.end > original.length
    )
      throw new Error('INPUT_BINDING');
    chunks.push(original.slice(cursor, change.range.start), change.bytes);
    cursor = change.range.end;
  }
  chunks.push(original.slice(cursor));
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (length > 32768) throw new Error('SOURCE_LIMIT');
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return decoder.decode(result);
}

/** One ephemeral authority. This has no storage or learning-event capabilities. */
export class EditDocumentController {
  private state: EditDocumentSnapshot;
  private projection?: ReverseProjection;
  private pending?: Promise<void>;
  private serial = 0;
  private disposed = false;
  private workspaceDraft: BlockWorkspaceDraft;
  private generationMode: 'canonical' | 'preserve' = 'canonical';
  private syntheticRanges: { start: number; end: number }[] = [];
  commentsMoved = false;
  constructor(
    private readonly catalog: ExerciseCatalog,
    private readonly context: () => { contextId: string; contextRevision: number },
    program: BlockProgram,
    source: PreparedSource,
    draft: BlockWorkspaceDraft,
    private readonly change: (controller: EditDocumentController) => void,
    private readonly analyzer: AnalysisPort = analysisClient,
  ) {
    this.workspaceDraft = draft;
    const workspaceSnapshotId = crypto.randomUUID();
    this.state = {
      kind: 'editDocument',
      editVersion: '1.0.0',
      identity: {
        ...context(),
        documentRevision: 1,
        editId: crypto.randomUUID(),
        operationId: crypto.randomUUID(),
      },
      refs: {
        packageRef: catalog.packageRef,
        programRef: { id: catalog.program.id, version: catalog.program.version },
        subsetRef: catalog.program.subsetRef,
      },
      origin: 'blocks',
      authoritativeDraft: { kind: 'blocks', workspaceSnapshotId },
      codeDraft: source.text,
      blockDraft: { workspaceSnapshotId, blocklyVersion: '13.4.0', program },
      input: {
        specRef: catalog.program.inputRef,
        values: structuredClone(catalog.subject.tests[0].input),
        random: null,
      },
      inputBindings: catalog.program.bindings.map((binding) => ({
        ...binding,
        emptyStorage: binding.emptyStorage ?? null,
      })),
      syncStatus: 'synced',
      analysisPending: true,
      analysisError: null,
      validatedDocumentRevision: null,
      diagnostics: [],
      issues: [],
      lastSynced: null,
    };
    this.syntheticRanges = generatedSyntheticRanges(source, program);
    this.pending = this.analyze(source.text, this.syntheticRanges, 'canonical', program);
  }
  getSnapshot() {
    return this.state;
  }
  getDraft() {
    return this.workspaceDraft;
  }
  getProjection() {
    return this.projection;
  }
  ready() {
    return (
      !this.disposed &&
      !this.state.analysisPending &&
      !this.state.analysisError &&
      this.state.syncStatus === 'synced' &&
      this.state.validatedDocumentRevision === this.state.identity.documentRevision &&
      this.projection?.documentRevision === this.state.identity.documentRevision
    );
  }
  private emit(patch: Partial<EditDocumentSnapshot>) {
    this.state = { ...this.state, ...patch };
    this.change(this);
  }
  private edited(origin: EditDocumentSnapshot['origin']) {
    this.analyzer.cancel();
    this.commentsMoved = false;
    this.state = {
      ...this.state,
      origin,
      identity: {
        ...this.context(),
        documentRevision: this.state.identity.documentRevision + 1,
        editId: crypto.randomUUID(),
        operationId: crypto.randomUUID(),
      },
      analysisPending: true,
      analysisError: null,
      diagnostics: [],
      issues: [],
    };
  }
  editCode(text: string, changedRange?: { start: number; end: number }) {
    if (this.disposed || text === this.state.codeDraft) return;
    const before = encoder.encode(this.state.codeDraft),
      after = encoder.encode(text);
    const range = changedRange;
    const shift = after.length - before.length;
    const proven =
      range &&
      range.start >= 0 &&
      range.end >= range.start &&
      range.end <= before.length &&
      range.end + shift >= range.start &&
      before.slice(0, range.start).every((byte, index) => byte === after[index]) &&
      before.slice(range.end).every((byte, index) => byte === after[range.end + shift + index]);
    this.syntheticRanges = proven
      ? this.syntheticRanges.flatMap((segment) =>
          segment.end <= range.start
            ? [{ ...segment }]
            : segment.start >= range.end
              ? [{ start: segment.start + shift, end: segment.end + shift }]
              : [],
        )
      : [];
    this.generationMode = 'preserve';
    this.edited('code');
    this.state = { ...this.state, codeDraft: text, authoritativeDraft: { kind: 'code', text } };
    this.change(this);
    this.pending = this.analyze(text, this.syntheticRanges, 'preserve');
  }
  editBlocks(
    program: BlockProgram | null,
    source: PreparedSource | undefined,
    draft: BlockWorkspaceDraft,
  ) {
    this.edited('blocks');
    this.workspaceDraft = draft;
    const workspaceSnapshotId = crypto.randomUUID();
    this.state = {
      ...this.state,
      authoritativeDraft: { kind: 'blocks', workspaceSnapshotId },
      blockDraft: { workspaceSnapshotId, blocklyVersion: '13.4.0', program },
    };
    if (!program || !source) {
      this.pending = undefined;
      this.emit({
        analysisPending: false,
        syncStatus: 'invalid',
        validatedDocumentRevision: this.state.identity.documentRevision,
        issues: [{ reason: 'BLOCK_STRUCTURE', nodeId: null, blockId: null, byteRange: null }],
      });
      return;
    }
    try {
      const patch =
        this.projection?.provenance.generationMode === 'preserve'
          ? patchBlockSource(this.projection, program, this.catalog.program.bindings)
          : {
              text: source.text,
              syntheticRanges: generatedSyntheticRanges(source, program),
              commentsMoved: false,
            };
      this.commentsMoved = patch.commentsMoved;
      this.syntheticRanges = patch.syntheticRanges;
      this.generationMode = this.projection?.provenance.generationMode ?? this.generationMode;
      this.state = { ...this.state, codeDraft: patch.text };
      this.change(this);
      this.pending = this.analyze(patch.text, patch.syntheticRanges, this.generationMode, program);
    } catch {
      this.pending = undefined;
      this.emit({
        analysisPending: false,
        syncStatus: 'invalid',
        validatedDocumentRevision: this.state.identity.documentRevision,
        issues: [{ reason: 'UNSUPPORTED_RANGE', nodeId: null, blockId: null, byteRange: null }],
      });
    }
  }
  async retry() {
    if (this.disposed) return;
    if (
      this.state.authoritativeDraft.kind === 'blocks' &&
      (this.state.blockDraft.program === null ||
        this.state.issues.some(
          (issue) => issue.reason === 'UNSUPPORTED_RANGE' || issue.reason === 'BLOCK_STRUCTURE',
        ))
    )
      return;
    this.analyzer.cancel();
    this.state = {
      ...this.state,
      identity: { ...this.state.identity, ...this.context(), operationId: crypto.randomUUID() },
      analysisPending: true,
      analysisError: null,
      validatedDocumentRevision: null,
    };
    this.change(this);
    this.pending = this.analyze(this.state.codeDraft, this.syntheticRanges, this.generationMode);
    await this.pending;
  }
  resume() {
    const incomplete =
      this.state.authoritativeDraft.kind === 'blocks' &&
      (this.state.blockDraft.program === null ||
        this.state.issues.some(
          (issue) => issue.reason === 'UNSUPPORTED_RANGE' || issue.reason === 'BLOCK_STRUCTURE',
        ));
    this.edited(this.state.origin);
    if (incomplete) {
      this.emit({
        analysisPending: false,
        syncStatus: 'invalid',
        validatedDocumentRevision: this.state.identity.documentRevision,
        issues: [{ reason: 'BLOCK_STRUCTURE', nodeId: null, blockId: null, byteRange: null }],
      });
      return;
    }
    this.change(this);
    this.pending = this.analyze(this.state.codeDraft, this.syntheticRanges, this.generationMode);
  }
  cancel(preserveSynced = false) {
    const keepValidation = preserveSynced && this.ready();
    this.analyzer.cancel();
    this.emit({
      identity: { ...this.state.identity, ...this.context(), operationId: crypto.randomUUID() },
      analysisPending: false,
      analysisError: keepValidation ? null : { code: 'cancelled' },
    });
  }
  dispose() {
    this.disposed = true;
    this.analyzer.cancel();
  }
  async wait() {
    await this.pending;
    return this.ready();
  }
  private async analyze(
    text: string,
    syntheticRanges: { start: number; end: number }[],
    generationMode: 'canonical' | 'preserve',
    stableProgram?: BlockProgram,
  ) {
    const identity = this.state.identity;
    try {
      const result = await this.analyzer.analyze(this.catalog, {
        kind: 'analysisRequest',
        analysisVersion: '1.0.0',
        identity,
        refs: this.state.refs,
        sourceText: text,
        input: this.state.input,
      });
      if (this.disposed || this.state.identity !== identity) return;
      if (result.kind === 'analysisFailure') {
        this.emit({ analysisPending: false, analysisError: result.error });
        return;
      }
      if (result.status === 'invalid') {
        this.emit({
          analysisPending: false,
          syncStatus: 'invalid',
          diagnostics: result.diagnostics,
          validatedDocumentRevision: identity.documentRevision,
        });
        return;
      }
      const projection = reverseAnalysis(result, text, this.catalog.program.bindings, {
        previous: this.projection,
        stableProgram,
        trustedSyntheticRanges: syntheticRanges,
        generationMode,
        allocateId: () => `block.code.${++this.serial}`,
      });
      if (projection.issues.length) {
        this.emit({
          analysisPending: false,
          syncStatus: 'unmapped',
          issues: projection.issues,
          validatedDocumentRevision: identity.documentRevision,
        });
        return;
      }
      let draft = this.workspaceDraft;
      if (this.state.authoritativeDraft.kind === 'code') {
        const { draftFromBlockProgram } = await import('../blocks/workspace');
        draft = draftFromBlockProgram(projection.program);
      }
      if (this.disposed || this.state.identity !== identity) return;
      this.projection = projection;
      this.workspaceDraft = draft;
      const workspaceSnapshotId = crypto.randomUUID();
      this.emit({
        analysisPending: false,
        analysisError: null,
        syncStatus: 'synced',
        diagnostics: [],
        issues: [],
        validatedDocumentRevision: identity.documentRevision,
        lastSynced: saved(projection),
        ...(this.state.authoritativeDraft.kind === 'blocks'
          ? { authoritativeDraft: { kind: 'blocks' as const, workspaceSnapshotId } }
          : {}),
        blockDraft: { workspaceSnapshotId, blocklyVersion: '13.4.0', program: projection.program },
      });
    } catch (error) {
      if (!this.disposed && this.state.identity === identity) {
        if (error instanceof UnmappedSourceError)
          this.emit({
            analysisPending: false,
            syncStatus: 'unmapped',
            issues: error.issues,
            validatedDocumentRevision: identity.documentRevision,
          });
        else this.emit({ analysisPending: false, analysisError: { code: 'response' } });
      }
    }
  }
  async prepareForTest(
    prepared: PreparedSource,
    input: ExecuteRequest['input']['values'],
    started: number,
  ): Promise<PreparedSource> {
    if (!this.ready() || !this.projection) throw new Error('UNSYNCED');
    const frozen = this.projection;
    const identity = this.state.identity;
    if (JSON.stringify(input) === JSON.stringify(this.state.input.values)) return frozen.source;
    const text = replaceInputDeclarations(frozen.source, prepared);
    const result = await this.analyzer.analyze(
      this.catalog,
      {
        kind: 'analysisRequest',
        analysisVersion: '1.0.0',
        identity: { ...identity, operationId: crypto.randomUUID() },
        refs: this.state.refs,
        sourceText: text,
        input: { ...this.state.input, values: input },
      },
      { started },
    );
    if (
      this.disposed ||
      this.state.identity !== identity ||
      result.kind !== 'analysisResult' ||
      result.status !== 'valid'
    )
      throw new Error('UNSYNCED');
    const mapped = reverseAnalysis(result, text, this.catalog.program.bindings, {
      stableProgram: frozen.program,
      trustedSyntheticRanges: retainedSyntheticRanges(frozen, text),
      generationMode: 'preserve',
      allocateId: () => `block.code.${++this.serial}`,
    });
    if (mapped.issues.length) throw new Error('UNMAPPED');
    return mapped.source;
  }
}
