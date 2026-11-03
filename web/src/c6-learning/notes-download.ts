import { downloadSnapshot, renderSnapshotPng, waitFor } from '../snapshot-export/browser';
import { encodeSnapshot } from '../snapshot-export/document';
import { SNAPSHOT_LIMITS } from '../snapshot-export/types';
import { NOTE_LIMITS, noteKinds } from '../study-notes/types';
import { createNotesZip, type ZipFile } from '../study-notes/zip';
import {
  markdownText,
  fencedCode,
  noteTitle,
  safeNoteFilename,
  type SnapshotAsset,
} from '../study-notes/markdown';
import { NOTES_DOWNLOAD_LIMITS } from '../study-notes/download';
import { createC6NotesPackage, type C6NotesPackage } from './notes';
import { encodeC6Snapshot } from './snapshot';
import { renderC6SnapshotPng } from './snapshot-picture';
import { isUtcTime, isUuid } from '../storage/validation';

export function c6NotesMarkdown(
  pack: C6NotesPackage,
  title: string,
  at: string,
  assets: readonly SnapshotAsset[],
): string {
  const lines = [
    `# ${markdownText(title)}`,
    '',
    `导出时间：${at}；预览时间：${pack.createdAt}；时区：${markdownText(pack.timeZone)}。`,
    '',
    `本包仅包含明确选择的 ${pack.entries.length} 条记录。当前教材引用、保存草稿和运行快照分别标明来源。`,
    '',
  ];
  for (const [i, entry] of pack.entries.entries()) {
    lines.push(
      `## ${i + 1}. ${markdownText(entry.title)}`,
      '',
      `${noteKinds[entry.kind]} · ${entry.date} · ${entry.language === 'cpp' ? 'C++' : entry.language === 'c' ? 'C' : '语言未确认'}`,
      '',
      markdownText(entry.text),
      '',
    );
    if (entry.reference)
      lines.push(
        `教材：${entry.reference.document} · 书页 ${entry.reference.physicalPage} · ${markdownText(entry.reference.nodeRef.id)}@${entry.reference.nodeRef.version}`,
        '',
        `教材来源摘要：${entry.reference.sourceSha256}`,
        '',
      );
    if (entry.origin.packageRef || entry.origin.subjectRef)
      lines.push(`原记录引用：${markdownText(JSON.stringify(entry.origin))}`, '');
    if (entry.source)
      lines.push(
        '### 当前已保存草稿（不代表历史判题源码）',
        '',
        fencedCode(entry.source.text, entry.language ?? 'text'),
        '### 当前已保存输入',
        '',
        fencedCode(entry.source.input, 'text'),
      );
    if (entry.snapshot) {
      const snapshot = entry.snapshot,
        asset = assets.find((a) => a.entryId === entry.id);
      lines.push(
        `捕获时间：${snapshot.capturedAt}；步骤 ${snapshot.position.cursor}/${snapshot.position.length}；快照格式 ${snapshot.formatVersion}。`,
        '',
        '### 捕获时的完整源码',
        '',
        fencedCode(snapshot.source.text, entry.language ?? 'text'),
        '### 捕获输入',
        '',
        fencedCode(JSON.stringify(snapshot.input, null, 2), 'json'),
      );
      if (asset)
        lines.push(
          `![完整当前状态图片](${asset.image})`,
          '',
          `[完整当前状态 JSON](${asset.state})`,
          '',
        );
    }
  }
  return lines.join('\n') + '\n';
}
interface Status {
  phase: 'idle' | 'building' | 'cancelled' | 'failed' | 'download-started';
  message: string;
  filename: string;
}
interface Dependencies {
  download?: typeof downloadSnapshot;
  renderC6?: typeof renderC6SnapshotPng;
  renderLegacy?: typeof renderSnapshotPng;
  now?: () => number;
}
export class C6NotesDownloader {
  private state: Status = { phase: 'idle', message: '', filename: '' };
  private listeners = new Set<() => void>();
  private operation: AbortController | null = null;
  constructor(private readonly dependencies: Dependencies = {}) {}
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
  cancel = () => {
    if (!this.operation) return;
    this.operation.abort();
    this.operation = null;
    this.publish({ phase: 'cancelled', message: '本次笔记打包已取消，未发起下载。', filename: '' });
  };
  async start(
    input: C6NotesPackage,
    titleInput: string,
    isCurrent: () => boolean,
    commit: (download: () => void) => Promise<void>,
  ): Promise<void> {
    this.cancel();
    const abort = new AbortController();
    this.operation = abort;
    const now = this.dependencies.now ?? (() => performance.now()),
      started = now();
    const timer = setTimeout(() => abort.abort(), NOTES_DOWNLOAD_LIMITS.timeoutMs);
    const check = () => {
      if (this.operation !== abort || abort.signal.aborted) throw Error('CANCELLED');
      if (now() - started >= NOTES_DOWNLOAD_LIMITS.timeoutMs) throw Error('TIMEOUT');
      if (!isCurrent()) throw Error('CHANGED');
    };
    this.publish({ phase: 'building', message: '正在打包已预览内容与完整快照……', filename: '' });
    try {
      check();
      if (
        input.formatId !== 'urn:c-viz:study-notes:2.0.0' ||
        input.formatVersion !== '2.0.0' ||
        !isUtcTime(input.createdAt) ||
        !isUuid(input.lease)
      )
        throw Error('FORMAT');
      // Revalidate the same selection/quotas, while keeping the actual preview time and lease.
      createC6NotesPackage(
        input.entries,
        input.entries.map((e) => e.id),
        input.filter,
        input.timeZone,
      );
      const pack = structuredClone(input),
        title = noteTitle(titleInput),
        at = new Date().toISOString();
      const filename = safeNoteFilename(title, at, crypto.randomUUID());
      const files: ZipFile[] = [],
        assets: SnapshotAsset[] = [];
      let count = 0,
        bytes = 0;
      for (const entry of pack.entries) {
        const snapshot = entry.snapshot;
        if (!snapshot) continue;
        check();
        if (++count > NOTE_LIMITS.snapshots) throw Error('SIZE');
        const json =
          snapshot.formatVersion === '2.0.0'
            ? encodeC6Snapshot(snapshot)
            : encodeSnapshot(snapshot);
        bytes += json.length;
        if (bytes > NOTE_LIMITS.snapshotBytes) throw Error('SIZE');
        const imageAbort = new AbortController(),
          imageStart = now();
        const cancelImage = () => imageAbort.abort();
        abort.signal.addEventListener('abort', cancelImage, { once: true });
        const imageTimer = setTimeout(cancelImage, SNAPSHOT_LIMITS.timeoutMs);
        const imageCheck = () => {
          check();
          if (imageAbort.signal.aborted || now() - imageStart >= SNAPSHOT_LIMITS.timeoutMs)
            throw Error('IMAGE_TIMEOUT');
        };
        let image: Blob;
        try {
          image = await waitFor(
            snapshot.formatVersion === '2.0.0'
              ? (this.dependencies.renderC6 ?? renderC6SnapshotPng)(
                  snapshot,
                  json,
                  imageAbort.signal,
                  imageCheck,
                )
              : (this.dependencies.renderLegacy ?? renderSnapshotPng)(
                  snapshot,
                  json,
                  imageAbort.signal,
                  imageCheck,
                ),
            imageAbort.signal,
          );
        } finally {
          clearTimeout(imageTimer);
          abort.signal.removeEventListener('abort', cancelImage);
        }
        check();
        if (image.size > SNAPSHOT_LIMITS.pngBytes) throw Error('SIZE');
        const png = new Uint8Array(await waitFor(image.arrayBuffer(), abort.signal));
        check();
        const stem = `snapshot-${String(count).padStart(2, '0')}`;
        files.push(
          { name: `assets/${stem}.png`, bytes: png },
          { name: `snapshots/${stem}.json`, bytes: json },
        );
        assets.push({
          entryId: entry.id,
          image: `assets/${stem}.png`,
          state: `snapshots/${stem}.json`,
        });
      }
      const markdown = new TextEncoder().encode(c6NotesMarkdown(pack, title, at, assets));
      if (markdown.length > NOTES_DOWNLOAD_LIMITS.markdownBytes) throw Error('SIZE');
      const metadata = {
        formatId: 'urn:c-viz:study-notes-download:2.0.0',
        formatVersion: '2.0.0',
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
          name: 'notes.json',
          bytes: new TextEncoder().encode(JSON.stringify(metadata, null, 2) + '\n'),
        },
        {
          name: '说明.txt',
          bytes: new TextEncoder().encode(
            '请完整解压并打开“笔记.md”，保持assets与snapshots相对位置。\n本包仅含已选择记录，在此浏览器生成，未上传学习资料。\n快照是捕获时的完整状态，虚拟地址不是宿主地址。草稿不代表历史通过作答。JSON不提供导入或执行。\n发起下载不等于磁盘保存成功，已下载文件由你管理。\n',
          ),
        },
      );
      check();
      const archive = await waitFor(
        createNotesZip(files, NOTES_DOWNLOAD_LIMITS.archiveBytes, check),
        abort.signal,
      );
      check();
      await waitFor(
        commit(() => {
          check();
          (this.dependencies.download ?? downloadSnapshot)(archive, filename);
        }),
        abort.signal,
      );
      check();
      this.publish({
        phase: 'download-started',
        message: '已发起笔记压缩包下载，请在浏览器下载列表确认。',
        filename,
      });
    } catch (error) {
      if (this.operation === abort)
        this.publish({
          phase: abort.signal.aborted || !isCurrent() ? 'cancelled' : 'failed',
          filename: '',
          message:
            abort.signal.aborted || !isCurrent()
              ? '范围、标题或档案已变化，或本次已取消；未发起下载。'
              : error instanceof Error &&
                  ['SIZE', 'SNAPSHOT_PICTURE_LIMIT', 'SNAPSHOT_TOO_LARGE'].includes(error.message)
                ? '完整笔记或图片超过上限，未截断或发起下载。请减少所选内容。'
                : '本次笔记打包未完成，未发起下载；请核对预览后重试。',
        });
    } finally {
      clearTimeout(timer);
      if (this.operation === abort) this.operation = null;
    }
  }
}
