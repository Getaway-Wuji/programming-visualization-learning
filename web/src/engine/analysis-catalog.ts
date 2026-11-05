import { c6SupplementRelease } from '../c6-learning/supplements.generated';
import type { CoursePractice, ExerciseCatalog } from '../content/practice';

/** Workers have their own module state. Load the small, pinned Bug supplement
 * directly instead of bootstrapping the complete legacy course on every edit. */
export async function loadAnalysisCatalog(
  id: string,
  signal: AbortSignal,
): Promise<ExerciseCatalog> {
  if (id.startsWith('exercise.c.bug-')) {
    const { default: raw } =
      await import('../../../content/c/primer6-learning/supplements-1.0.0.json?raw');
    const bytes = new TextEncoder().encode(raw);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (n) =>
      n.toString(16).padStart(2, '0'),
    ).join('');
    if (signal.aborted) throw new Error('E_CANCELLED');
    if (bytes.length !== c6SupplementRelease.bytes || hash !== c6SupplementRelease.sha256)
      throw new Error('E_CONTENT_MISMATCH');
    const practice = (JSON.parse(raw) as { practice: CoursePractice }).practice;
    const subject = practice.exercises.find((entry) => entry.id === id);
    const program = practice.programs.find((entry) => entry.id === subject?.programRef.id);
    const inputSpec = practice.inputSpecs.find((entry) => entry.id === program?.inputRef.id);
    const judgeProfile = practice.judgeProfiles.find((entry) => entry.id === subject?.judgeRef.id);
    if (!subject || !program || !inputSpec || !judgeProfile) throw new Error('E_CONTENT_MISMATCH');
    return { packageRef: practice.packageRef, subject, program, inputSpec, judgeProfile };
  }
  const { exerciseCatalog, loadCoursePractice } = await import('../content/practice');
  return exerciseCatalog(await loadCoursePractice(signal), id);
}
