import reviewedBytes from '../../../content/c/p0/case-view-1.0.1.json?raw';
import type { ExecutionCatalog } from '../engine/execution-client';
import type { ByteRange } from '../engine/protocol';
import type { CaseEntity } from './types';
import { createLearningCatalog } from '../learning/catalog';
import type { LearningCatalog } from '../learning/types';

export interface CaseExecutionCatalog extends ExecutionCatalog {
  readonly subject: CaseEntity;
}
interface TemplateBinding {
  readonly bindingKey: string;
  readonly byteRange: ByteRange;
}
interface CaseViewRelease {
  readonly caseViewVersion: '1.0.1';
  readonly purpose: 'case-view';
  readonly capabilities: readonly ['case.view-confirmed'];
  readonly sourceSha256: string;
  readonly catalogs: readonly CaseExecutionCatalog[];
  readonly templateBindings: Readonly<Record<string, readonly TemplateBinding[]>>;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

// This small bundled release authorizes only seven reviewed independent cases.
// It is not a publication of the complete CONTENT candidate or a page event issuer.
export const caseViewRelease = freeze(JSON.parse(reviewedBytes) as CaseViewRelease);
if (
  caseViewRelease.caseViewVersion !== '1.0.1' ||
  caseViewRelease.purpose !== 'case-view' ||
  JSON.stringify(caseViewRelease.capabilities) !== '["case.view-confirmed"]' ||
  caseViewRelease.sourceSha256 !==
    'c3a70258c17a780c5a3a01090dc6af13734b30d09dbb954fa1f7dc20e5e13d77' ||
  caseViewRelease.catalogs.length !== 7 ||
  new Set(caseViewRelease.catalogs.map((entry) => entry.subject.id)).size !== 7
)
  throw new Error('CASE_VIEW_RELEASE');

export function caseExecutionCatalog(id: string): CaseExecutionCatalog | null {
  return caseViewRelease.catalogs.find((entry) => entry.subject.id === id) ?? null;
}
export function caseTemplateBindings(id: string): readonly TemplateBinding[] {
  return caseViewRelease.templateBindings[id] ?? [];
}
const learningCatalog = createLearningCatalog({
  purpose: 'case-view',
  packageRef: { ...caseViewRelease.catalogs[0].packageRef },
  lessons: [],
  exercises: [],
  cases: caseViewRelease.catalogs.map(({ subject }) => ({
    ref: { id: subject.id, version: subject.version },
    learningRevision: subject.learningRevision,
    acceptedPriorVersions: [...subject.acceptedPriorVersions],
  })),
});
export function caseLearningCatalog(): LearningCatalog {
  return learningCatalog;
}
