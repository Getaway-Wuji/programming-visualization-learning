import { SNAPSHOT_LIMITS, SnapshotError } from './types';
const signature = [137, 80, 78, 71, 13, 10, 26, 10];
const table = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
export function pngCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
/** Canvas PNG plus a Unicode iTXt record. No whole trace or foreign resource enters it. */
export function attachPngSnapshot(png: Uint8Array, document: Uint8Array): Uint8Array<ArrayBuffer> {
  if (document.byteLength > SNAPSHOT_LIMITS.jsonBytes)
    throw new SnapshotError('SNAPSHOT_TOO_LARGE');
  if (png.length < 20 || !signature.every((value, index) => png[index] === value))
    throw new SnapshotError('SNAPSHOT_FAILED');
  const dataHeader = new TextEncoder().encode('c-viz.snapshot\0\0\0\0\0');
  const data = new Uint8Array(dataHeader.length + document.length);
  data.set(dataHeader);
  data.set(document, dataHeader.length);
  const chunk = new Uint8Array(12 + data.length),
    view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set([105, 84, 88, 116], 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, pngCrc32(chunk.subarray(4, 8 + data.length)));
  let end = -1;
  for (let offset = 8; offset + 12 <= png.length;) {
    const length = new DataView(png.buffer, png.byteOffset + offset, 4).getUint32(0);
    if (offset + 12 + length > png.length) throw new SnapshotError('SNAPSHOT_FAILED');
    if (
      png[offset + 4] === 73 &&
      png[offset + 5] === 69 &&
      png[offset + 6] === 78 &&
      png[offset + 7] === 68
    ) {
      if (length !== 0 || offset + 12 !== png.length) throw new SnapshotError('SNAPSHOT_FAILED');
      end = offset;
      break;
    }
    offset += 12 + length;
  }
  if (end < 0) throw new SnapshotError('SNAPSHOT_FAILED');
  if (png.length + chunk.length > SNAPSHOT_LIMITS.pngBytes)
    throw new SnapshotError('SNAPSHOT_PICTURE_LIMIT');
  const output = new Uint8Array(png.length + chunk.length);
  output.set(png.subarray(0, end));
  output.set(chunk, end);
  output.set(png.subarray(end), end + chunk.length);
  return output;
}
