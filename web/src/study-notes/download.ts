import { renderSnapshotPng, downloadSnapshot, waitFor } from '../snapshot-export/browser';
import { encodeSnapshot } from '../snapshot-export/document';
import { SNAPSHOT_LIMITS, SnapshotError } from '../snapshot-export/types';
import { NOTE_LIMITS, type NotesPackage } from './types';
import { createNotesPackage } from './model';
import { noteTitle, notesMarkdown, safeNoteFilename, type SnapshotAsset } from './markdown';
import { createNotesZip, type ZipFile } from './zip';
export const NOTES_DOWNLOAD_LIMITS = Object.freeze({
  timeoutMs: 45000,
  markdownBytes: 24 * 1024 * 1024,
  archiveBytes: 112 * 1024 * 1024,
});
type Phase = 'idle' | 'building' | 'download-started' | 'cancelled' | 'failed';
interface Status {
  phase: Phase;
  message: string;
  filename: string;
}
interface Dependencies {
  render?: typeof renderSnapshotPng;
  download?: typeof downloadSnapshot;
  now?: () => number;
  date?: () => string;
  uuid?: () => string;
}
interface Operation {
  abort: AbortController;
  start: number;
  timer: ReturnType<typeof setTimeout> | null;
}
export class NotesDownloader {
  private state: Status = { phase: 'idle', message: '', filename: '' };
  private active: Operation | null = null;
  private listeners = new Set<() => void>();
  constructor(private dependencies: Dependencies = {}) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(state: Status) {
    this.state = state;
    this.listeners.forEach((l) => l());
  }
  cancel = (reason: 'user' | 'changed' = 'user') => {
    const op = this.active;
    if (!op) return;
    this.active = null;
    op.abort.abort();
    if (op.timer) clearTimeout(op.timer);
    this.publish({
      phase: 'cancelled',
      filename: '',
      message:
        reason === 'changed'
          ? '标题、选择或档案已变化，本次未发起下载。请重新核对预览。'
          : '本次打包已取消，未发起下载。',
    });
  };
  async start(
    input: NotesPackage,
    titleInput: string,
    isCurrent: () => boolean,
    commit: (download: () => void) => Promise<void>,
  ): Promise<void> {
    this.cancel();
    const now = this.dependencies.now ?? (() => performance.now());
    const op: Operation = { abort: new AbortController(), start: now(), timer: null };
    this.active = op;
    const check = () => {
      if (this.active !== op || op.abort.signal.aborted) throw Error('CANCELLED');
      if (now() - op.start >= NOTES_DOWNLOAD_LIMITS.timeoutMs) throw Error('TIMEOUT');
      if (!isCurrent()) throw Error('CHANGED');
    };
    op.timer = setTimeout(() => {
      if (this.active === op) {
        this.active = null;
        op.abort.abort();
        this.publish({
          phase: 'failed',
          filename: '',
          message: '生成超过45秒，未发起下载；请减少快照后重试。',
        });
      }
    }, NOTES_DOWNLOAD_LIMITS.timeoutMs);
    this.publish({
      phase: 'building',
      message: '正在打包已预览内容与完整快照图片，可取消。',
      filename: '',
    });
    try {
      check();
      const title = noteTitle(titleInput);
      if (input.formatId !== 'urn:c-viz:study-notes:1.0.0' || input.formatVersion !== '1.0.0')
        throw Error('PACKAGE');
      const pack = createNotesPackage(
        input.entries,
        input.entries.map((e) => e.id),
        input.filter,
        input.lease,
        input.timeZone,
        input.createdAt,
      );
      const at = (this.dependencies.date ?? (() => new Date().toISOString()))(),
        id = (this.dependencies.uuid ?? (() => crypto.randomUUID()))();
      const filename = safeNoteFilename(title, at, id),
        files: ZipFile[] = [],
        assets: SnapshotAsset[] = [];
      let count = 0,
        snapshotBytes = 0;
      for (const entry of pack.entries) {
        if (!entry.snapshot) continue;
        check();
        if (++count > NOTE_LIMITS.snapshots) throw Error('SIZE');
        const bytes = encodeSnapshot(entry.snapshot);
        snapshotBytes += bytes.length;
        if (snapshotBytes > NOTE_LIMITS.snapshotBytes) throw Error('SIZE');
        const name = `snapshot-${String(count).padStart(2, '0')}`;
        let image: Blob;
        const imageAbort = new AbortController();
        const abort = () => imageAbort.abort();
        op.abort.signal.addEventListener('abort', abort, { once: true });
        const imageTimer = setTimeout(abort, SNAPSHOT_LIMITS.timeoutMs);
        try {
          image = await waitFor(
            (this.dependencies.render ?? renderSnapshotPng)(
              entry.snapshot,
              bytes,
              imageAbort.signal,
              check,
            ),
            imageAbort.signal,
          );
        } finally {
          clearTimeout(imageTimer);
          op.abort.signal.removeEventListener('abort', abort);
        }
        check();
        if (image.size > SNAPSHOT_LIMITS.pngBytes) throw Error('SIZE');
        const imageBytes = new Uint8Array(await waitFor(image.arrayBuffer(), op.abort.signal));
        check();
        files.push(
          { name: `assets/${name}.png`, bytes: imageBytes },
          { name: `snapshots/${name}.json`, bytes },
        );
        assets.push({
          entryId: entry.id,
          image: `assets/${name}.png`,
          state: `snapshots/${name}.json`,
        });
      }
      check();
      const markdown = new TextEncoder().encode(notesMarkdown(pack, title, at, assets));
      if (markdown.length > NOTES_DOWNLOAD_LIMITS.markdownBytes) throw Error('SIZE');
      // Internal lease stays in the tab; only selected public note payload leaves it.
      const metadata = {
        formatId: 'urn:c-viz:study-notes-download:1.0.0',
        formatVersion: '1.0.0',
        title,
        exportedAt: at,
        previewedAt: pack.createdAt,
        timeZone: pack.timeZone,
        filter: pack.filter,
        entries: pack.entries,
        assets,
      };
      files.unshift(
        { name: '笔记.md', bytes: markdown },
        {
          name: '说明.txt',
          bytes: new TextEncoder().encode(
            '请完整解压后用Markdown阅读器打开“笔记.md”，保持assets与snapshots目录相对位置。\n本包仅包含已选择内容，完全在浏览器内生成，未上传档案。\nPNG也带完整源码、输入和运行状态；JSON不提供导入或执行功能。\n下载发起不等于磁盘保存成功；已下载文件由你管理，清除学习数据不会删除文件。\n',
          ),
        },
        {
          name: 'notes.json',
          bytes: new TextEncoder().encode(JSON.stringify(metadata, null, 2) + '\n'),
        },
      );
      const zip = await waitFor(
        createNotesZip(files, NOTES_DOWNLOAD_LIMITS.archiveBytes, check),
        op.abort.signal,
      );
      check();
      await waitFor(
        commit(() => {
          check();
          (this.dependencies.download ?? downloadSnapshot)(zip, filename);
          // Download has already been handed to the browser; later cancellation cannot undo it.
          this.active = null;
          if (op.timer) clearTimeout(op.timer);
          this.publish({
            phase: 'download-started',
            filename,
            message: `已发起下载：${filename}。请到浏览器下载列表确认，完整解压后打开“笔记.md”。`,
          });
        }),
        op.abort.signal,
      );
    } catch (error) {
      if (this.active === op) {
        const code = error instanceof Error ? error.message : '';
        const cancelled = code === 'CHANGED' || code === 'CANCELLED';
        this.publish({
          phase: cancelled ? 'cancelled' : 'failed',
          filename: '',
          message:
            code === 'TITLE_EMPTY'
              ? '请填写笔记标题后重试。'
              : code === 'CHANGED'
                ? '标题、选择或档案已变化，本次未发起下载。请重新核对预览。'
                : code === 'TIMEOUT'
                  ? '生成超过45秒，未发起下载；请减少快照后重试。'
                  : code === 'SIZE' || code === 'ZIP_SIZE'
                    ? '所选内容超过完整打包预算，未发起下载；请减少快照或记录，没有截断内容。'
                    : error instanceof SnapshotError
                      ? '完整快照图片生成失败或超限，未发起下载；可以重试或减少快照。'
                      : cancelled
                        ? '本次打包已取消，未发起下载。'
                        : '笔记打包或下载失败，未发起下载。档案可能已变化，请重新核对预览后重试。',
        });
      }
    } finally {
      if (op.timer) clearTimeout(op.timer);
      if (this.active === op) this.active = null;
    }
  }
}
