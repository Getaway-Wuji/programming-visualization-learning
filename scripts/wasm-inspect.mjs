// Inspect the final bindgen output, not just the Cargo link configuration.
export function inspectWasm(bytes) {
  const data = new Uint8Array(bytes);
  const module = new WebAssembly.Module(data);
  let offset = 8;
  const memories = [];
  const readUnsigned = () => {
    let value = 0;
    let shift = 0;
    for (let count = 0; count < 5; count++) {
      const byte = data[offset++];
      if (byte === undefined) throw new Error('Truncated WASM integer.');
      value += (byte & 127) * 2 ** shift;
      if ((byte & 128) === 0) return value;
      shift += 7;
    }
    throw new Error('Unsupported WASM integer size.');
  };
  while (offset < data.length) {
    const section = data[offset++];
    const length = readUnsigned();
    const end = offset + length;
    if (end > data.length) throw new Error('Truncated WASM section.');
    if (section === 5) {
      const count = readUnsigned();
      for (let index = 0; index < count; index++) {
        const flags = readUnsigned();
        if (flags & ~3) throw new Error('Unsupported memory64 WASM memory.');
        const minimum = readUnsigned();
        const maximum = flags & 1 ? readUnsigned() : null;
        memories.push({ minimum, maximum, shared: Boolean(flags & 2) });
      }
    }
    offset = end;
  }
  const features = [];
  for (const section of WebAssembly.Module.customSections(module, 'target_features')) {
    const view = new Uint8Array(section);
    let cursor = 0;
    const leb = () => {
      let result = 0;
      let shift = 0;
      let value;
      do {
        value = view[cursor++];
        result += (value & 127) * 2 ** shift;
        shift += 7;
      } while (value & 128);
      return result;
    };
    const count = leb();
    for (let index = 0; index < count; index++) {
      const prefix = String.fromCharCode(view[cursor++]);
      const length = leb();
      const feature = new TextDecoder().decode(view.subarray(cursor, cursor + length));
      cursor += length;
      features.push(`${prefix}${feature}`);
    }
  }
  return {
    memories,
    features,
    imports: WebAssembly.Module.imports(module),
    exports: WebAssembly.Module.exports(module),
  };
}
