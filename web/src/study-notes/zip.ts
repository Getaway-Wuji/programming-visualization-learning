export interface ZipFile {
  name: string;
  bytes: Uint8Array<ArrayBuffer>;
}
const table = Uint32Array.from({ length: 256 }, (_, n) => {
  let v = n;
  for (let i = 0; i < 8; i++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1;
  return v >>> 0;
});
const yieldTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
/** Standard stored ZIP, UTF-8 names, bounded entries and cooperative CRC work. */
export async function createNotesZip(
  files: readonly ZipFile[],
  maxBytes: number,
  check: () => void,
): Promise<Blob> {
  if (!files.length || files.length > 19) throw Error('ZIP_FILES');
  const names = new Set<string>(),
    local: BlobPart[] = [],
    central: BlobPart[] = [];
  let offset = 0,
    centralSize = 0;
  for (const file of files) {
    check();
    const name = new TextEncoder().encode(file.name);
    if (
      names.has(file.name) ||
      name.length > 255 ||
      !file.name ||
      file.name.startsWith('/') ||
      file.name.includes('\\') ||
      Array.from(file.name).some(
        (character) => character.charCodeAt(0) < 32 || character === ':',
      ) ||
      file.name.split('/').some((s) => !s || s === '.' || s === '..')
    )
      throw Error('ZIP_PATH');
    names.add(file.name);
    if (
      offset + file.bytes.length + 30 + name.length + centralSize + 46 + name.length + 22 >
      maxBytes
    )
      throw Error('ZIP_SIZE');
    let crc = 0xffffffff;
    for (let p = 0; p < file.bytes.length; p += 262144) {
      const end = Math.min(p + 262144, file.bytes.length);
      for (let i = p; i < end; i++) crc = table[(crc ^ file.bytes[i]) & 255] ^ (crc >>> 8);
      check();
      await yieldTask();
      check();
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = new Uint8Array(30 + name.length),
      h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true);
    h.setUint16(12, 33, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, file.bytes.length, true);
    h.setUint32(22, file.bytes.length, true);
    h.setUint16(26, name.length, true);
    header.set(name, 30);
    const directory = new Uint8Array(46 + name.length),
      d = new DataView(directory.buffer);
    d.setUint32(0, 0x02014b50, true);
    d.setUint16(4, 20, true);
    d.setUint16(6, 20, true);
    d.setUint16(8, 0x0800, true);
    d.setUint16(14, 33, true);
    d.setUint32(16, crc, true);
    d.setUint32(20, file.bytes.length, true);
    d.setUint32(24, file.bytes.length, true);
    d.setUint16(28, name.length, true);
    d.setUint32(42, offset, true);
    directory.set(name, 46);
    local.push(header, file.bytes);
    central.push(directory);
    offset += header.length + file.bytes.length;
    centralSize += directory.length;
  }
  const end = new Uint8Array(22),
    e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, centralSize, true);
  e.setUint32(16, offset, true);
  check();
  const blob = new Blob([...local, ...central, end], { type: 'application/zip' });
  if (blob.size > maxBytes) throw Error('ZIP_SIZE');
  return blob;
}
