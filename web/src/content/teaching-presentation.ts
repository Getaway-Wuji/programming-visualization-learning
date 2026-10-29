import configurationJson from '../../../content/c/presentation/teaching-presentation-1.0.0.json?raw';
import type { EntityRef } from './types';
import { currentCourseBundle } from './course-bundle';

export type PreferredEditor = 'code' | 'blocks';
export interface TeachingPresentationEntry {
  readonly packageRef: EntityRef;
  readonly lessonRef: EntityRef;
  readonly preferredEditor: PreferredEditor;
}
export interface TeachingPresentationConfiguration {
  readonly contractVersion: '1.0.0';
  readonly schemaVersion: '1.0.0';
  readonly configRef: {
    readonly id: 'teaching.presentation.c.p05';
    readonly version: '1.0.0';
  };
  readonly entries: readonly TeachingPresentationEntry[];
}
export interface TeachingPresentationLoad {
  readonly status: 'ready' | 'fallback';
  readonly configuration: TeachingPresentationConfiguration | null;
  readonly errorCode: null | 'TEACHING_PRESENTATION_INVALID' | 'TEACHING_PRESENTATION_UNAVAILABLE';
}

const maxBytes = 64 * 1024;
const maxEntries = 128;
function requireRule(condition: unknown): asserts condition {
  if (!condition) throw new Error('TEACHING_PRESENTATION_INVALID');
}
function row(value: unknown, fields: readonly string[]): asserts value is Record<string, unknown> {
  requireRule(
    value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype,
  );
  const keys = Reflect.ownKeys(value);
  requireRule(
    keys.length === fields.length &&
      keys.every((key) => typeof key === 'string' && fields.includes(key)),
  );
  requireRule(
    Object.values(Object.getOwnPropertyDescriptors(value)).every(
      (descriptor) => 'value' in descriptor && descriptor.enumerable,
    ),
  );
}
function reference(value: unknown, prefix: string) {
  row(value, ['id', 'version']);
  requireRule(
    typeof value.id === 'string' &&
      value.id.length <= 128 &&
      value.id.startsWith(prefix) &&
      /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(value.id),
  );
  requireRule(
    typeof value.version === 'string' &&
      value.version.length <= 32 &&
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value.version),
  );
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Display recommendations only: no source, judgement, learning rights or arbitrary fields. */
export function decodeTeachingPresentation(value: unknown): TeachingPresentationConfiguration {
  row(value, ['contractVersion', 'schemaVersion', 'configRef', 'entries']);
  requireRule(value.contractVersion === '1.0.0' && value.schemaVersion === '1.0.0');
  row(value.configRef, ['id', 'version']);
  requireRule(
    value.configRef.id === 'teaching.presentation.c.p05' && value.configRef.version === '1.0.0',
  );
  const entries = value.entries;
  requireRule(Array.isArray(entries) && entries.length <= maxEntries);
  // A non-JSON caller must not smuggle getters or named properties through an array.
  const keys = Reflect.ownKeys(entries);
  requireRule(
    keys.length === entries.length + 1 &&
      keys.every((key) => key === 'length' || /^(0|[1-9]\d*)$/.test(String(key))),
  );
  const descriptors = Object.getOwnPropertyDescriptors(entries);
  requireRule(Object.values(descriptors).every((descriptor) => 'value' in descriptor));
  const seen = new Set<string>();
  for (let index = 0; index < entries.length; index++) {
    const entry: unknown = entries[index];
    row(entry, ['packageRef', 'lessonRef', 'preferredEditor']);
    reference(entry.packageRef, 'content.');
    reference(entry.lessonRef, 'lesson.');
    requireRule(entry.preferredEditor === 'code' || entry.preferredEditor === 'blocks');
    const packageRef = entry.packageRef as unknown as EntityRef;
    const lessonRef = entry.lessonRef as unknown as EntityRef;
    const key = JSON.stringify([
      packageRef.id,
      packageRef.version,
      lessonRef.id,
      lessonRef.version,
    ]);
    requireRule(!seen.has(key));
    seen.add(key);
  }
  requireRule(new TextEncoder().encode(JSON.stringify(value)).byteLength <= maxBytes);
  return freeze(structuredClone(value) as unknown as TeachingPresentationConfiguration);
}

/** Same reviewed static bytes are bundled; a failed load always resolves to code-only auto. */
export async function loadTeachingPresentation(
  loader: () => Promise<unknown> = async () => {
    requireRule(new TextEncoder().encode(configurationJson).byteLength <= maxBytes);
    return JSON.parse(configurationJson) as unknown;
  },
): Promise<TeachingPresentationLoad> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let candidate: unknown;
  try {
    candidate = await Promise.race([
      Promise.resolve().then(loader),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('TEACHING_PRESENTATION_UNAVAILABLE')), 3000);
      }),
    ]);
  } catch {
    return {
      status: 'fallback',
      configuration: null,
      errorCode: 'TEACHING_PRESENTATION_UNAVAILABLE',
    };
  } finally {
    clearTimeout(timer);
  }
  try {
    return {
      status: 'ready',
      configuration: decodeTeachingPresentation(candidate),
      errorCode: null,
    };
  } catch {
    return { status: 'fallback', configuration: null, errorCode: 'TEACHING_PRESENTATION_INVALID' };
  }
}

/** Exact package AND lesson identities; missing/unknown versions never inherit another course. */
export function resolvePreferredEditor(
  configuration: TeachingPresentationConfiguration | null,
  packageRef: EntityRef | undefined,
  lessonRef: EntityRef | undefined,
): PreferredEditor {
  const bundle = currentCourseBundle();
  if (
    bundle &&
    packageRef?.id === bundle.reading.packageRef.id &&
    packageRef.version === bundle.reading.packageRef.version &&
    lessonRef
  ) {
    const lesson = bundle.reading.lessons.find(
      (entry) => entry.id === lessonRef.id && entry.version === lessonRef.version,
    );
    const ref = lesson?.requiredExerciseRefs[0];
    const guide = bundle.guidance.find(
      (entry) => entry.exerciseRef.id === ref?.id && entry.exerciseRef.version === ref.version,
    );
    if (guide) return guide.preferredEditor;
  }
  if (!configuration || !packageRef || !lessonRef) return 'code';
  return (
    configuration.entries.find(
      (entry) =>
        entry.packageRef.id === packageRef.id &&
        entry.packageRef.version === packageRef.version &&
        entry.lessonRef.id === lessonRef.id &&
        entry.lessonRef.version === lessonRef.version,
    )?.preferredEditor ?? 'code'
  );
}
