import { copyCurrentDocument, captureKey, encodeSnapshot } from './document';
import { downloadSnapshot, renderSnapshotPng, waitFor } from './browser';
import {
  SNAPSHOT_LIMITS,
  SnapshotError,
  type SnapshotDocument,
  type SnapshotFormat,
  type SnapshotPort,
} from './types';
interface ExportStatus {
  phase: 'idle' | 'capturing' | 'download-started' | 'collected' | 'cancelled' | 'failed';
  message: string;
  filename: string;
  format: SnapshotFormat | null;
}
interface Dependencies {
  now?: () => number;
  date?: () => string;
  uuid?: () => string;
  hash?: (text: string) => Promise<string>;
  render?: typeof renderSnapshotPng;
  download?: typeof downloadSnapshot;
}
interface Operation {
  key: string;
  revision: number;
  abort: AbortController;
  start: number;
  timer?: ReturnType<typeof setTimeout>;
}
const messages: Record<SnapshotError['code'], string> = {
  SNAPSHOT_UNAVAILABLE: '当前没有可导出的最终接收状态。请先完成运行并选择步骤。',
  SNAPSHOT_CHANGED: '状态已变化，本次未发起下载。请在当前步骤重新导出。',
  SNAPSHOT_CANCELLED: '本次导出已取消，未发起下载。',
  SNAPSHOT_TIMEOUT: '生成快照超过5秒，未发起下载。可以重新选择格式重试。',
  SNAPSHOT_TOO_LARGE: '完整状态文件超过2MiB，未发起下载；没有截断内容。',
  SNAPSHOT_PICTURE_LIMIT:
    '完整图片超过尺寸、内容或8MiB上限，未发起下载。可以单独下载JSON；没有截断内容。',
  SNAPSHOT_FAILED: '浏览器未能生成快照或发起下载。请重试。',
};
export class SnapshotExporter {
  private port: SnapshotPort;
  private revision = 0;
  private key = 'unavailable';
  private active: Operation | null = null;
  private readonly listeners = new Set<() => void>();
  private state: ExportStatus = { phase: 'idle', message: '', filename: '', format: null };
  private readonly now: () => number;
  constructor(
    port: SnapshotPort,
    private readonly dependencies: Dependencies = {},
  ) {
    this.port = port;
    this.now = dependencies.now ?? (() => performance.now());
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish() {
    this.listeners.forEach((listener) => listener());
  }
  setPort(port: SnapshotPort) {
    this.port = port;
    this.observe();
  }
  observe = () => {
    const key = captureKey(this.port.read());
    if (key !== this.key) {
      this.key = key;
      this.revision++;
      if (this.active) this.stop('SNAPSHOT_CHANGED');
    }
  };
  private stop(code: SnapshotError['code']) {
    const active = this.active;
    if (!active) return;
    this.active = null;
    clearTimeout(active.timer);
    active.abort.abort();
    this.state = {
      ...this.state,
      phase: code === 'SNAPSHOT_TIMEOUT' ? 'failed' : 'cancelled',
      message: messages[code],
      filename: '',
    };
    this.publish();
  }
  cancel = () => this.stop('SNAPSHOT_CANCELLED');
  async export(
    format: SnapshotFormat,
    receive?: (document: SnapshotDocument) => void,
  ): Promise<void> {
    this.cancel();
    let record: ReturnType<SnapshotPort['read']>;
    try {
      this.port.pause();
      this.observe();
      record = this.port.read();
      if (!record) throw new SnapshotError('SNAPSHOT_UNAVAILABLE');
    } catch {
      this.state = {
        phase: 'failed',
        message: messages.SNAPSHOT_UNAVAILABLE,
        filename: '',
        format,
      };
      this.publish();
      return;
    }
    const operation: Operation = {
      key: captureKey(record),
      revision: this.revision,
      abort: new AbortController(),
      start: this.now(),
    };
    this.active = operation;
    this.key = operation.key;
    const check = () => {
      if (this.active !== operation || operation.abort.signal.aborted)
        throw new SnapshotError('SNAPSHOT_CANCELLED');
      if (this.now() - operation.start >= SNAPSHOT_LIMITS.timeoutMs)
        throw new SnapshotError('SNAPSHOT_TIMEOUT');
      if (this.revision !== operation.revision || captureKey(this.port.read()) !== operation.key)
        throw new SnapshotError('SNAPSHOT_CHANGED');
    };
    operation.timer = setTimeout(() => {
      if (this.active === operation) this.stop('SNAPSHOT_TIMEOUT');
    }, SNAPSHOT_LIMITS.timeoutMs);
    this.state = {
      phase: 'capturing',
      message: '正在生成当前暂停状态的快照；切步或更改运行会取消。',
      filename: '',
      format,
    };
    this.publish();
    try {
      const id = (this.dependencies.uuid ?? (() => crypto.randomUUID()))(),
        at = (this.dependencies.date ?? (() => new Date().toISOString()))();
      if (
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id) ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(at)
      )
        throw new SnapshotError('SNAPSHOT_FAILED');
      const document = copyCurrentDocument(record, id, at);
      check();
      const hash =
        this.dependencies.hash ??
        (async (text: string) =>
          Array.from(
            new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))),
          )
            .map((value) => value.toString(16).padStart(2, '0'))
            .join(''));
      document.source.sha256 = await waitFor(hash(document.source.text), operation.abort.signal);
      check();
      if (!/^[a-f0-9]{64}$/.test(document.source.sha256))
        throw new SnapshotError('SNAPSHOT_FAILED');
      if (document.origin.definitionVersion.scheme === 'source-sha256')
        document.origin.definitionVersion.value = document.source.sha256;
      const bytes = encodeSnapshot(document);
      check();
      if (receive) {
        receive(document);
        this.state = {
          phase: 'collected',
          message: '已加入本次笔记。刷新或清除学习数据会丢弃临时快照；请到学习笔记勾选预览。',
          filename: '',
          format,
        };
        this.publish();
        return;
      }
      const blob =
        format === 'json'
          ? new Blob([bytes], { type: 'application/json;charset=utf-8' })
          : await waitFor(
              (this.dependencies.render ?? renderSnapshotPng)(
                document,
                bytes,
                operation.abort.signal,
                check,
              ),
              operation.abort.signal,
            );
      check();
      const filename = `cviz-${at.replace(/[-:.]/g, '')}-s${document.position.cursor}-${id}.${format}`;
      (this.dependencies.download ?? downloadSnapshot)(blob, filename);
      this.state = {
        phase: 'download-started',
        message: `已发起下载：${filename}。请在浏览器下载列表确认；文件由你自行管理。`,
        filename,
        format,
      };
      this.publish();
    } catch (error) {
      if (this.active === operation) {
        const code = error instanceof SnapshotError ? error.code : 'SNAPSHOT_FAILED';
        this.state = {
          phase:
            code === 'SNAPSHOT_CHANGED' || code === 'SNAPSHOT_CANCELLED' ? 'cancelled' : 'failed',
          message:
            receive && error instanceof Error && !(error instanceof SnapshotError)
              ? error.message
              : messages[code],
          filename: '',
          format,
        };
        this.publish();
      }
    } finally {
      clearTimeout(operation.timer);
      if (this.active === operation) this.active = null;
    }
  }
}
