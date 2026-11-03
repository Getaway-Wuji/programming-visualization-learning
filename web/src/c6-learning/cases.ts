import raw from '../../../content/c/primer6-learning/cases-1.0.0.json?raw';
import type { CaseExecutionCatalog } from '../content/case-learning';
import type { C6LearningIndex } from './index';
import { isLoadedC6LearningIndex } from './index';
import { c6SourceHash } from '../engine/c6-protocol';

interface CaseRelease {
  caseViewVersion: '1.1.0';
  purpose: 'case-view';
  capabilities: ['case.view-confirmed'];
  sourceSha256: string;
  catalogs: readonly CaseExecutionCatalog[];
  templateBindings: Readonly<
    Record<string, readonly { bindingKey: string; byteRange: { start: number; end: number } }[]>
  >;
}
const releaseSha256 = 'a389fea06289ffa3da40ff9f0f28296e498d6d5be54dc0d206885bec8d57d3be';
let active: CaseRelease | null = null;
export function c6IndependentCases() {
  return active;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
/** Same seven reviewed C cases, activated without loading or publishing the old course. */
export async function activateC6IndependentCases(index: C6LearningIndex): Promise<void> {
  if (!isLoadedC6LearningIndex(index)) throw Error('C6_CASES_UNVERIFIED');
  if (active) return;
  if (new TextEncoder().encode(raw).length !== 37098 || (await c6SourceHash(raw)) !== releaseSha256)
    throw Error('C6_CASES_INTEGRITY');
  const value = JSON.parse(raw) as CaseRelease;
  if (
    value.caseViewVersion !== '1.1.0' ||
    value.purpose !== 'case-view' ||
    JSON.stringify(value.capabilities) !== '["case.view-confirmed"]' ||
    value.sourceSha256 !== '85fd3d38faf4f677e50c860d30a0390b84f2d092a77fdcd08036a4d4e5a57948' ||
    value.catalogs.length !== 7 ||
    new Set(value.catalogs.map((c) => c.subject.id)).size !== 7 ||
    value.catalogs.some(
      (c) =>
        c.packageRef.id !== 'content.c.p05' ||
        c.packageRef.version !== '1.0.0' ||
        c.subject.languageRef.id !== 'lang.c' ||
        c.program.languageRef.id !== 'lang.c',
    )
  )
    throw Error('C6_CASES_INVALID');
  active = freeze(value);
}
