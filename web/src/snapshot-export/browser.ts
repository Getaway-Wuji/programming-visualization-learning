import { layoutSnapshot } from './layout';
import { attachPngSnapshot } from './png';
import { SNAPSHOT_LIMITS, SnapshotError, type SnapshotDocument } from './types';
export function waitFor<T>(promise: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancelled = () => reject(new SnapshotError('SNAPSHOT_CANCELLED'));
    if (signal.aborted) {
      cancelled();
      return;
    }
    signal.addEventListener('abort', cancelled, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener('abort', cancelled);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', cancelled);
        reject(error);
      },
    );
  });
}
export async function renderSnapshotPng(
  record: SnapshotDocument,
  json: Uint8Array<ArrayBuffer>,
  signal: AbortSignal,
  check: () => void,
): Promise<Blob> {
  await waitFor(document.fonts.ready, signal);
  check();
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new SnapshotError('SNAPSHOT_FAILED');
  try {
    const picture = layoutSnapshot(
      record,
      (text, font) => {
        context.font = font;
        return context.measureText(text).width;
      },
      check,
    );
    canvas.width = picture.width;
    canvas.height = picture.height;
    context.textBaseline = 'top';
    for (const [index, operation] of picture.operations.entries()) {
      if (index % 32 === 0) check();
      if (operation.kind === 'box') {
        context.fillStyle = operation.fill;
        context.fillRect(operation.x, operation.y, operation.width, operation.height);
        if (operation.stroke) {
          context.strokeStyle = operation.stroke;
          context.lineWidth = 1;
          context.strokeRect(
            operation.x + 0.5,
            operation.y + 0.5,
            operation.width - 1,
            operation.height - 1,
          );
        }
      } else {
        context.font = operation.font;
        context.fillStyle = operation.color;
        context.fillText(operation.text, operation.x, operation.y);
      }
    }
    check();
    const png = await waitFor(
      new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new SnapshotError('SNAPSHOT_FAILED'))),
          'image/png',
        ),
      ),
      signal,
    );
    check();
    if (png.size > SNAPSHOT_LIMITS.pngBytes) throw new SnapshotError('SNAPSHOT_PICTURE_LIMIT');
    const buffer = await waitFor(png.arrayBuffer(), signal);
    check();
    return new Blob([attachPngSnapshot(new Uint8Array(buffer), json)], { type: 'image/png' });
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
}
export function downloadSnapshot(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob),
    anchor = document.createElement('a');
  try {
    anchor.href = url;
    anchor.download = filename;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  } finally {
    anchor.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
