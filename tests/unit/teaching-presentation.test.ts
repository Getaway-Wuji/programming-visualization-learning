import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  decodeTeachingPresentation,
  loadTeachingPresentation,
  resolvePreferredEditor,
} from '../../web/src/content/teaching-presentation';

const loaded = await loadTeachingPresentation();
if (!loaded.configuration) throw new Error(`Bundled recommendations failed: ${loaded.errorCode}`);
const configuration = loaded.configuration;
const copy = () => structuredClone(configuration);

describe('TEACHING-PRESENTATION-01 course display recommendations', () => {
  it('binds the six existing course lessons by exact published identities without learning rights', () => {
    const course = JSON.parse(
      readFileSync(new URL('../../content/c/p0/course-1.0.1.json', import.meta.url), 'utf8'),
    ) as {
      packageId: string;
      packageVersion: string;
      lessons: { id: string; version: string }[];
    };
    expect(configuration.entries.map((entry) => entry.lessonRef)).toEqual(
      course.lessons.map(({ id, version }) => ({ id, version })),
    );
    expect(configuration.entries.map((entry) => entry.preferredEditor)).toEqual([
      'code',
      'code',
      'blocks',
      'blocks',
      'blocks',
      'blocks',
    ]);
    for (const entry of configuration.entries) {
      expect(entry.packageRef).toEqual({ id: course.packageId, version: course.packageVersion });
      expect(resolvePreferredEditor(configuration, entry.packageRef, entry.lessonRef)).toBe(
        entry.preferredEditor,
      );
    }
    expect(configuration).not.toHaveProperty('capabilities');
    expect(Object.isFrozen(configuration.entries[0].lessonRef)).toBe(true);
  });

  it('falls back to code for missing entries, missing configuration or either mismatched identity', () => {
    const entry = configuration.entries[2];
    for (const packageRef of [
      undefined,
      { id: 'content.c.other', version: entry.packageRef.version },
      { id: entry.packageRef.id, version: '1.0.0' },
    ])
      expect(resolvePreferredEditor(configuration, packageRef, entry.lessonRef)).toBe('code');
    for (const lessonRef of [
      undefined,
      { id: 'lesson.c.future', version: entry.lessonRef.version },
      { id: entry.lessonRef.id, version: '1.0.2' },
    ])
      expect(resolvePreferredEditor(configuration, entry.packageRef, lessonRef)).toBe('code');
    expect(resolvePreferredEditor(null, entry.packageRef, entry.lessonRef)).toBe('code');
    const empty = decodeTeachingPresentation({ ...copy(), entries: [] });
    expect(resolvePreferredEditor(empty, entry.packageRef, entry.lessonRef)).toBe('code');
  });

  it('rejects unknown protocols, config versions, capabilities and uncontrolled editor values', () => {
    const extraEntry = { ...configuration.entries[0], preferredEditor: 'javascript' };
    for (const value of [
      { ...copy(), contractVersion: '1.1.0' },
      { ...copy(), schemaVersion: '1.0.1' },
      { ...copy(), configRef: { id: configuration.configRef.id, version: '1.0.1' } },
      { ...copy(), capabilities: ['exercise.passed'] },
      { ...copy(), entries: [extraEntry] },
      { ...copy(), entries: [{ ...configuration.entries[0], source: 'int main() {}' }] },
    ])
      expect(() => decodeTeachingPresentation(value)).toThrow('TEACHING_PRESENTATION_INVALID');
  });

  it('rejects ambiguous duplicate identities and malformed or excessive reference data', () => {
    const entry = configuration.entries[0];
    for (const entries of [
      [entry, { ...entry, preferredEditor: 'blocks' }],
      Array.from({ length: 129 }, () => entry),
      [{ ...entry, lessonRef: { id: 'https://external.example', version: '1.0.1' } }],
      [{ ...entry, packageRef: { id: 'content.c.p0', version: 'latest' } }],
      [{ ...entry, lessonRef: { id: 'lesson.c.' + 'a'.repeat(129), version: '1.0.1' } }],
    ])
      expect(() => decodeTeachingPresentation({ ...copy(), entries })).toThrow();
  });

  it('rejects getters and hidden/inherited/symbol properties without invoking accessors', () => {
    const get = vi.fn(() => 'blocks');
    const accessor = { ...configuration.entries[0] };
    Object.defineProperty(accessor, 'preferredEditor', { get, enumerable: true });
    const hidden = Object.defineProperty(copy(), 'capabilities', { value: ['exercise.passed'] });
    const inherited = Object.assign(Object.create({ source: 'untrusted' }), copy());
    const nested = copy();
    Object.defineProperty(nested.entries[0].lessonRef, 'id', { get, enumerable: true });
    const arrayAccessor = [...configuration.entries];
    Object.defineProperty(arrayAccessor, '0', { get, enumerable: true });
    for (const value of [
      { ...copy(), entries: [accessor] },
      hidden,
      inherited,
      { ...copy(), [Symbol('extra')]: true },
      nested,
      { ...copy(), entries: arrayAccessor },
    ])
      expect(() => decodeTeachingPresentation(value)).toThrow();
    expect(get).not.toHaveBeenCalled();
  });

  it('returns code fallback on malformed or unavailable resources without exposing loader errors', async () => {
    const invalid = await loadTeachingPresentation(async () => ({
      ...copy(),
      schemaVersion: '9.0.0',
    }));
    const unavailable = await loadTeachingPresentation(async () => {
      throw new Error('private payload');
    });
    expect(invalid).toEqual({
      status: 'fallback',
      configuration: null,
      errorCode: 'TEACHING_PRESENTATION_INVALID',
    });
    expect(unavailable).toEqual({
      status: 'fallback',
      configuration: null,
      errorCode: 'TEACHING_PRESENTATION_UNAVAILABLE',
    });
    expect(
      resolvePreferredEditor(
        invalid.configuration,
        configuration.entries[2].packageRef,
        configuration.entries[2].lessonRef,
      ),
    ).toBe('code');
  });

  it('bounds a never-settling loader and ignores its late completion', async () => {
    vi.useFakeTimers();
    try {
      let resolveLate: ((value: unknown) => void) | undefined;
      const pending = loadTeachingPresentation(
        () =>
          new Promise((resolve) => {
            resolveLate = resolve;
          }),
      );
      await vi.advanceTimersByTimeAsync(3000);
      const result = await pending;
      expect(result).toEqual({
        status: 'fallback',
        configuration: null,
        errorCode: 'TEACHING_PRESENTATION_UNAVAILABLE',
      });
      resolveLate?.(copy());
      await Promise.resolve();
      expect(result.configuration).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
