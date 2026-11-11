import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseJava3CourseManifest } from '../../shared/contracts/java-content.mjs';
import { parsePython3CourseManifest } from '../../shared/contracts/python3-content.mjs';
import {
  isTeachingEditorial,
  compareTeachingVersions,
} from '../../shared/contracts/teaching-editorial.mjs';

describe('independent teaching revision identities', () => {
  it('accepts a bounded canonical revision without changing the learning identity', () => {
    expect(
      isTeachingEditorial(
        { id: 'editorial.java.runoob', version: '1.1.0' },
        'editorial.java.runoob',
      ),
    ).toBe(true);
  });
  it.each(['01.1.0', '1.01.0', '1.0', '../1.1.0', '1.1.0.json', '1.1.0-beta', '1000.0.0'])(
    'rejects an ambiguous or path-like version: %s',
    (version) => {
      expect(
        isTeachingEditorial({ id: 'editorial.java.runoob', version }, 'editorial.java.runoob'),
      ).toBe(false);
    },
  );
  it('rejects extra provenance fields and a different editorial owner', () => {
    expect(
      isTeachingEditorial({ id: 'editorial.other', version: '1.1.0' }, 'editorial.java.runoob'),
    ).toBe(false);
    expect(
      isTeachingEditorial(
        { id: 'editorial.java.runoob', version: '1.1.0', localPath: 'C:/private' },
        'editorial.java.runoob',
      ),
    ).toBe(false);
  });
  it('orders numeric components rather than filenames', () => {
    expect(compareTeachingVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareTeachingVersions('2.0.0', '1.99.99')).toBe(1);
    expect(compareTeachingVersions('1.1.0', '1.1.0')).toBe(0);
    expect(compareTeachingVersions('1.0.9', '1.1.0')).toBe(-1);
  });
});

for (const language of ['java', 'python3']) {
  const parse = language === 'java' ? parseJava3CourseManifest : parsePython3CourseManifest;
  const sourceRelease = JSON.parse(
    readFileSync(`content/build/${language}-course-editorial-1.0.0.json`, 'utf8'),
  );
  const draft = () =>
    JSON.parse(readFileSync(`content/${language}/course/${sourceRelease.manifestFile}`, 'utf8'));
  const pin = (manifest: unknown) => {
    const bytes = new TextEncoder().encode(JSON.stringify(manifest) + '\n');
    return {
      bytes,
      release: {
        ...sourceRelease,
        editorialRef: { ...sourceRelease.editorialRef, version: '1.1.0' },
        manifestFile: 'manifest-1.0.0-editorial-1.1.0.json',
        manifestBytes: bytes.length,
        manifestSha256: createHash('sha256').update(bytes).digest('hex'),
      },
    };
  };
  it(`${language}: a later manifest can retain earlier immutable teaching chapters`, async () => {
    const manifest = draft();
    manifest.editorialRef.version = '1.1.0';
    const bound = pin(manifest);
    const accepted = await parse(bound.bytes, bound.release);
    expect(accepted.chunks.find((entry) => entry.editorialRef)?.editorialRef?.version).toBe(
      '1.0.0',
    );
    expect(accepted.packageRef).toEqual(sourceRelease.packageRef);
  });
  it(`${language}: a manifest cannot silently refer to a future chapter revision`, async () => {
    const manifest = draft();
    manifest.editorialRef.version = '1.1.0';
    const chapter = manifest.chunks.find((entry: { editorialRef?: object }) => entry.editorialRef);
    chapter.editorialRef.version = '1.2.0';
    chapter.file = chapter.file.replace('editorial-1.0.0', 'editorial-1.2.0');
    const bound = pin(manifest);
    await expect(parse(bound.bytes, bound.release)).rejects.toThrow('article entry');
  });
}
