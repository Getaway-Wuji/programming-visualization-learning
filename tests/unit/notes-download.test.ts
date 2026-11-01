import { readFileSync } from 'node:fs';
import { gunzipSync, crc32 } from 'node:zlib';
import { describe, it, expect, vi } from 'vitest';
import { createNotesZip } from '../../web/src/study-notes/zip';
import { notesMarkdown, noteTitle, safeNoteFilename } from '../../web/src/study-notes/markdown';
import { NotesDownloader } from '../../web/src/study-notes/download';
import type { NoteEntry, NotesPackage } from '../../web/src/study-notes/types';
import type { SnapshotDocument } from '../../web/src/snapshot-export/types';
const at = '2026-11-01T01:00:00.000Z',
  uuid = '20200000-0000-4000-8000-000000000001';
function realDocument() {
  const index = JSON.parse(readFileSync('项目文档/验收/20.1-验证原件/index.json', 'utf8')) as {
    files: { sourcePath: string; file: string }[];
  };
  const e = index.files.find(
    (e) => e.sourcePath === '.artifacts/20.1/browser/r201-final67/snapshot-cpp.json.gz',
  )!;
  return (
    JSON.parse(
      gunzipSync(gunzipSync(readFileSync(`项目文档/验收/20.1-验证原件/${e.file}`))).toString(),
    ) as { doc: SnapshotDocument }
  ).doc;
}
const entry = (): NoteEntry => ({
  id: 'one',
  kind: 'learning',
  title: '中文学习记录',
  date: '2026-11-01',
  occurredAt: at,
  timeMeaning: 'legacy-summary',
  chapterIds: [],
  language: null,
  origin: {
    packageRef: { id: 'content.old', version: '1.0.0' },
    subjectRef: { id: 'lesson.old', version: '1.0.0' },
    learningRevision: 1,
  },
  currentRef: null,
  href: null,
  text: '旧记录保留',
  warnings: ['旧教材解析不可确认'],
  reference: null,
  snapshot: null,
});
const pack = (rows: NoteEntry[] = [entry()]): NotesPackage => ({
  formatId: 'urn:c-viz:study-notes:1.0.0',
  formatVersion: '1.0.0',
  createdAt: at,
  lease: 'internal-generation-never-export',
  timeZone: 'Asia/Shanghai',
  filter: {
    chapterId: '',
    from: '',
    to: '',
    types: ['learning', 'mistake', 'analysis', 'snapshot'],
  },
  entries: rows,
});
function captured(): NoteEntry {
  const d = realDocument();
  return {
    ...entry(),
    id: 'captured',
    kind: 'snapshot',
    language: 'cpp',
    snapshot: d,
    title: d.origin.title,
    date: d.capturedAt.slice(0, 10),
    occurredAt: d.capturedAt,
    timeMeaning: 'capture',
  };
}
async function unzip(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer()),
    out = new Map<string, Uint8Array>();
  let p = 0;
  while (new DataView(bytes.buffer, p, 4).getUint32(0, true) === 0x04034b50) {
    const h = new DataView(bytes.buffer, p);
    expect(h.getUint16(6, true) & 0x800).toBe(0x800);
    expect(h.getUint16(8, true)).toBe(0);
    const len = h.getUint32(18, true),
      n = h.getUint16(26, true),
      extra = h.getUint16(28, true),
      name = new TextDecoder('utf8', { fatal: true }).decode(bytes.slice(p + 30, p + 30 + n)),
      body = bytes.slice(p + 30 + n + extra, p + 30 + n + extra + len);
    expect(crc32(body)).toBe(h.getUint32(14, true));
    out.set(name, body);
    p += 30 + n + extra + len;
  }
  expect(new DataView(bytes.buffer, p).getUint32(0, true)).toBe(0x02014b50);
  const end = new DataView(bytes.buffer, bytes.length - 22);
  expect(end.getUint32(0, true)).toBe(0x06054b50);
  expect(end.getUint16(10, true)).toBe(out.size);
  return out;
}
describe('20.2 standard ZIP and Markdown safety', () => {
  it('creates a UTF-8 stored archive with independently checked CRC and exact binary bytes', async () => {
    const b = new Uint8Array([0, 255, 17, 34]);
    const files = await unzip(
      await createNotesZip(
        [
          { name: '笔记.md', bytes: new TextEncoder().encode('中文🙂') },
          { name: 'assets/a.png', bytes: b },
        ],
        1024,
        () => {},
      ),
    );
    expect(new TextDecoder().decode(files.get('笔记.md'))).toBe('中文🙂');
    expect(files.get('assets/a.png')).toEqual(b);
  });
  it.each(['../a', '/a', 'a\\b', 'a/../b', 'a//b', 'a:b'])(
    'refuses unsafe internal path %s',
    async (name) => {
      await expect(
        createNotesZip([{ name, bytes: new Uint8Array() }], 1024, () => {}),
      ).rejects.toThrow('ZIP_PATH');
    },
  );
  it('refuses duplicate names, excess files and total byte overflow', async () => {
    await expect(
      createNotesZip(
        [
          { name: 'x', bytes: new Uint8Array() },
          { name: 'x', bytes: new Uint8Array() },
        ],
        1024,
        () => {},
      ),
    ).rejects.toThrow();
    await expect(
      createNotesZip(
        Array.from({ length: 20 }, (_, i) => ({ name: String(i), bytes: new Uint8Array() })),
        1024,
        () => {},
      ),
    ).rejects.toThrow('ZIP_FILES');
    await expect(
      createNotesZip([{ name: 'x', bytes: new Uint8Array(200) }], 100, () => {}),
    ).rejects.toThrow('ZIP_SIZE');
  });
  it('keeps Chinese title, controls/reserved names and paths out of the outer filename', () => {
    expect(noteTitle(' 中文\n笔记\u202e ')).toBe('中文 笔记');
    expect(() => noteTitle('\n\u202e')).toThrow('TITLE_EMPTY');
    for (const s of ['CON', '../a<b>:"/\\|?*', '中文🙂复习']) {
      const name = safeNoteFilename(s, at, uuid);
      expect(name).toMatch(/\.zip$/);
      expect(name).not.toMatch(/[<>:"/\\|?*\u202e]/);
      expect(Array.from(name).some((character) => character.codePointAt(0)! < 32)).toBe(false);
      expect(name.length).toBeLessThan(256);
    }
    expect(safeNoteFilename('中文🙂', at, uuid)).toContain('中文🙂');
  });
  it('renders literal Markdown/HTML safely while exact source survives a longer dynamic fence', () => {
    const e = entry();
    e.title = '<img src=x onerror=alert(1)> [点击](javascript:x)';
    e.text = '# 标题\n![外图](https://example.invalid/x)';
    e.kind = 'analysis';
    e.reference = {
      packageRef: { id: 'c', version: '1.0.0' },
      contentSha256: 'a'.repeat(64),
      registryRef: null,
      subjectRef: { id: 'p', version: '1.0.0' },
      document: '课程来源.md',
      locator: '第1节',
      programRef: null,
      source: '// ``` 中文🙂\r\nint main() { return 0; }\r\n',
    };
    e.language = 'c';
    const md = notesMarkdown(pack([e]), '<script>中文</script>', at, []);
    expect(md).not.toContain('<script>');
    expect(md).not.toContain('![外图]');
    expect(md).toContain('````c\n' + e.reference.source + '````');
    expect(md).toContain('非历史作答');
    expect(md).toContain('课程来源.md');
  });
});
describe('20.2 note download lifecycle and exact selection', () => {
  it('exports only selected old record, preserves warnings and excludes internal lease', async () => {
    let blob!: Blob;
    const download = vi.fn((b: Blob) => {
      blob = b;
    });
    const data = pack(),
      before = JSON.stringify(data),
      d = new NotesDownloader({ download, date: () => at, uuid: () => uuid });
    await d.start(
      data,
      '中文笔记',
      () => true,
      async (action) => action(),
    );
    expect(d.getSnapshot().phase).toBe('download-started');
    expect(download).toHaveBeenCalledTimes(1);
    const files = await unzip(blob);
    expect([...files.keys()]).toEqual(['笔记.md', '说明.txt', 'notes.json']);
    const raw = new TextDecoder().decode(files.get('notes.json'));
    expect(raw).not.toContain('internal-generation');
    expect(JSON.parse(raw).entries).toEqual(data.entries);
    expect(new TextDecoder().decode(files.get('笔记.md'))).toContain('旧教材解析不可确认');
    expect(JSON.stringify(data)).toBe(before);
  });
  it('keeps real C++ captured source, input and complete state in the independent file and image input', async () => {
    let blob!: Blob;
    const data = pack([captured()]);
    const render = vi.fn(async (doc: SnapshotDocument, bytes: Uint8Array) => {
      expect(doc).toEqual(data.entries[0].snapshot);
      expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual(doc);
      return new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    });
    const d = new NotesDownloader({
      render,
      download: (b) => {
        blob = b;
      },
      date: () => at,
      uuid: () => uuid,
    });
    await d.start(
      data,
      '真实C++',
      () => true,
      async (a) => a(),
    );
    const files = await unzip(blob);
    expect([...files.keys()]).toEqual([
      '笔记.md',
      '说明.txt',
      'notes.json',
      'assets/snapshot-01.png',
      'snapshots/snapshot-01.json',
    ]);
    expect(JSON.parse(new TextDecoder().decode(files.get('snapshots/snapshot-01.json')))).toEqual(
      data.entries[0].snapshot,
    );
    const md = new TextDecoder().decode(files.get('笔记.md'));
    expect(md).toContain(data.entries[0].snapshot!.source.text);
    expect(md).toContain('```cpp');
    expect(md).toContain('](assets/snapshot-01.png)');
    expect(md).toContain('](snapshots/snapshot-01.json)');
    expect(render).toHaveBeenCalledTimes(1);
  });
  it('cancels a pending image, ignores its late result, then permits an explicit retry', async () => {
    let finish!: (b: Blob) => void;
    const download = vi.fn(),
      render = vi.fn(
        () =>
          new Promise<Blob>((r) => {
            finish = r;
          }),
      );
    const d = new NotesDownloader({ render, download }),
      pending = d.start(
        pack([captured()]),
        '中文',
        () => true,
        async (a) => a(),
      );
    d.cancel();
    finish(new Blob(['image']));
    await pending;
    expect(download).not.toHaveBeenCalled();
    expect(d.getSnapshot().phase).toBe('cancelled');
    await d.start(
      pack(),
      '重试',
      () => true,
      async (a) => a(),
    );
    expect(download).toHaveBeenCalledTimes(1);
  });
  it('rechecks the live lease inside final commit and refuses stale state', async () => {
    let valid = true;
    const download = vi.fn(),
      d = new NotesDownloader({ download });
    await d.start(
      pack(),
      '中文',
      () => valid,
      async (a) => {
        valid = false;
        a();
      },
    );
    expect(download).not.toHaveBeenCalled();
    expect(d.getSnapshot().phase).toBe('cancelled');
  });
  it('reports download-started immediately and cannot report a later cancellation as no download', async () => {
    let release!: () => void;
    const download = vi.fn(),
      d = new NotesDownloader({ download });
    const pending = d.start(
      pack(),
      '中文',
      () => true,
      async (a) => {
        a();
        await new Promise<void>((r) => {
          release = r;
        });
      },
    );
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(d.getSnapshot().phase).toBe('download-started');
    d.cancel();
    expect(d.getSnapshot().phase).toBe('download-started');
    release();
    await pending;
  });
  it('refuses image failures and oversized images without a partial ZIP, and recovers', async () => {
    for (const render of [
      async () => {
        throw Error('fail');
      },
      async () => new Blob([new Uint8Array(8 * 1024 * 1024 + 1)]),
    ]) {
      const download = vi.fn(),
        d = new NotesDownloader({ render, download });
      await d.start(
        pack([captured()]),
        '中文',
        () => true,
        async (a) => a(),
      );
      expect(download).not.toHaveBeenCalled();
      expect(d.getSnapshot().phase).toBe('failed');
      await d.start(
        pack(),
        '无图重试',
        () => true,
        async (a) => a(),
      );
      expect(download).toHaveBeenCalledTimes(1);
    }
  });
  it('refuses a timed-out operation and a native download failure', async () => {
    let clock = 0;
    const download = vi.fn(),
      d = new NotesDownloader({
        now: () => clock,
        render: async () => {
          clock = 45000;
          return new Blob(['x']);
        },
        download,
      });
    await d.start(
      pack([captured()]),
      '中文',
      () => true,
      async (a) => a(),
    );
    expect(download).not.toHaveBeenCalled();
    expect(d.getSnapshot()).toMatchObject({
      phase: 'failed',
      message: expect.stringContaining('45秒'),
    });
    const failed = new NotesDownloader({
      download: () => {
        throw Error('browser');
      },
    });
    await failed.start(
      pack(),
      '中文',
      () => true,
      async (a) => a(),
    );
    expect(failed.getSnapshot().phase).toBe('failed');
  });
});
