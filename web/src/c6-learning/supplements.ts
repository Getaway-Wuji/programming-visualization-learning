import { c6SupplementRelease } from './supplements.generated';
import { isLoadedC6LearningIndex, type C6LearningIndex } from './index';
import { createLearningCatalog } from '../learning/catalog';
import type { LearningCatalog } from '../learning/types';
import type { CoursePractice } from '../content/practice';
import { hasMemoryBugLearningSupplement } from '../memory-bugs/content';

let current: { learning: LearningCatalog; practice: CoursePractice } | null = null;
export const c6IndependentSupplement = () => current;
export async function activateC6IndependentSupplement(index: C6LearningIndex) {
  if (!isLoadedC6LearningIndex(index)) throw new Error('C6_SUPPLEMENT_AUTHORITY');
  if (current) return current;
  const { default: raw } =
    await import('../../../content/c/primer6-learning/supplements-1.0.0.json?raw');
  const bytes = new TextEncoder().encode(raw);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
  if (bytes.length !== c6SupplementRelease.bytes || hash !== c6SupplementRelease.sha256)
    throw new Error('C6_SUPPLEMENT_INTEGRITY');
  const source = JSON.parse(raw);
  const learning = createLearningCatalog(source.learning);
  if (
    source.supplementVersion !== '1.0.0' ||
    !hasMemoryBugLearningSupplement(learning.exercises) ||
    source.practice.exercises.length !== 4
  )
    throw new Error('C6_SUPPLEMENT_INVALID');
  const freeze = (v: unknown): void => {
    if (v && typeof v === 'object') {
      Object.values(v).forEach(freeze);
      Object.freeze(v);
    }
  };
  freeze(source.practice);
  current = Object.freeze({ learning, practice: source.practice as CoursePractice });
  return current;
}
