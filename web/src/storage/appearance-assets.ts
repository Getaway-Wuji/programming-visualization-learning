import type { AppearanceAsset } from './model';

/** Runs outside IndexedDB transactions. Never accepts filenames or remote URLs. */
export async function usableBackground(asset: AppearanceAsset): Promise<boolean> {
  let bitmap: ImageBitmap | undefined;
  try {
    const bytes = new Uint8Array(await asset.blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const text = (at: number, count: number) =>
      String.fromCharCode(...bytes.subarray(at, at + count));
    let width = 0,
      height = 0;
    if (asset.mimeType === 'image/png') {
      if (bytes.length < 45 || ![137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n))
        return false;
      let end = false;
      for (let at = 8; at + 12 <= bytes.length;) {
        const length = view.getUint32(at),
          kind = text(at + 4, 4);
        if (length > bytes.length - at - 12 || kind === 'acTL') return false;
        if (at === 8) {
          if (kind !== 'IHDR' || length !== 13) return false;
          width = view.getUint32(at + 8);
          height = view.getUint32(at + 12);
        }
        at += length + 12;
        if (kind === 'IEND') {
          end = length === 0 && at === bytes.length;
          break;
        }
      }
      if (!end) return false;
    } else if (asset.mimeType === 'image/jpeg') {
      if (bytes[0] !== 255 || bytes[1] !== 216) return false;
      for (let at = 2; at + 4 <= bytes.length;) {
        if (bytes[at++] !== 255) return false;
        while (bytes[at] === 255) at++;
        const marker = bytes[at++];
        if (marker === 218 || marker === 217) break;
        if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
        const length = view.getUint16(at);
        if (length < 2 || at + length > bytes.length) return false;
        if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
          if (length < 8) return false;
          height = view.getUint16(at + 3);
          width = view.getUint16(at + 5);
          break;
        }
        at += length;
      }
    } else {
      if (
        bytes.length < 20 ||
        text(0, 4) !== 'RIFF' ||
        text(8, 4) !== 'WEBP' ||
        view.getUint32(4, true) + 8 !== bytes.length
      )
        return false;
      for (let at = 12; at + 8 <= bytes.length;) {
        const kind = text(at, 4),
          length = view.getUint32(at + 4, true),
          start = at + 8;
        if (length > bytes.length - start || kind === 'ANIM' || kind === 'ANMF') return false;
        if (kind === 'VP8X') {
          if (length < 10 || (bytes[start] & 2) !== 0) return false;
          width = 1 + bytes[start + 4] + (bytes[start + 5] << 8) + (bytes[start + 6] << 16);
          height = 1 + bytes[start + 7] + (bytes[start + 8] << 8) + (bytes[start + 9] << 16);
        } else if (kind === 'VP8 ' && !width) {
          if (length < 10 || text(start + 3, 3) !== String.fromCharCode(157, 1, 42)) return false;
          width = view.getUint16(start + 6, true) & 16383;
          height = view.getUint16(start + 8, true) & 16383;
        } else if (kind === 'VP8L' && !width) {
          if (length < 5 || bytes[start] !== 47) return false;
          width = 1 + ((bytes[start + 1] | (bytes[start + 2] << 8)) & 16383);
          height =
            1 +
            (((bytes[start + 2] >> 6) | (bytes[start + 3] << 2) | (bytes[start + 4] << 10)) &
              16383);
        }
        at = start + length + (length & 1);
        if (at > bytes.length) return false;
      }
    }
    if (width < 1 || height < 1 || width > 4096 || height > 4096) return false;
    // JPEG orientation may exchange dimensions; decoded dimensions remain authoritative.
    if (!(
      (width === asset.width && height === asset.height) ||
      (asset.mimeType === 'image/jpeg' && width === asset.height && height === asset.width)
    ))
      return false;
    bitmap = await createImageBitmap(asset.blob);
    return bitmap.width === asset.width && bitmap.height === asset.height;
  } catch {
    return false;
  } finally {
    bitmap?.close();
  }
}
