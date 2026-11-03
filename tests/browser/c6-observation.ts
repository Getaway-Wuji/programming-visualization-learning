import type { Page } from '@playwright/test';

interface NativePacket {
  request?: ArrayBuffer;
  response?: ArrayBuffer;
  moduleSeen: boolean;
  terminated: boolean;
}
declare global {
  interface Window {
    c6CurrentPackets: NativePacket[];
  }
}

/** Passive copies of real IPC. No message, source, AST, result or proof is supplied. */
export function installC6Packets() {
  window.c6CurrentPackets = [];
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    private packet: NativePacket;
    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options);
      this.packet = { moduleSeen: false, terminated: false };
      window.c6CurrentPackets.push(this.packet);
      this.addEventListener('message', (event) => {
        if (event.data?.buffer instanceof ArrayBuffer) this.packet.response = event.data.buffer;
      });
    }
    postMessage(value: unknown, options: Transferable[] | StructuredSerializeOptions = []) {
      if (value && typeof value === 'object' && 'buffer' in value) {
        const message = value as { buffer: ArrayBuffer; module: WebAssembly.Module };
        this.packet.request = message.buffer.slice(0);
        this.packet.moduleSeen = message.module instanceof WebAssembly.Module;
      }
      if (Array.isArray(options)) super.postMessage(value, options);
      else super.postMessage(value, options);
    }
    terminate() {
      this.packet.terminated = true;
      super.terminate();
    }
  };
}

export async function observedC6Packet(page: Page, index = -1) {
  return page.evaluate((index) => {
    const packet = window.c6CurrentPackets.at(index)!;
    const encode = (buffer?: ArrayBuffer) => {
      if (!buffer) return null;
      const bytes = new Uint8Array(buffer);
      let text = '';
      for (let i = 0; i < bytes.length; i += 16384)
        text += String.fromCharCode(...bytes.subarray(i, i + 16384));
      return btoa(text);
    };
    return {
      count: window.c6CurrentPackets.length,
      moduleSeen: packet.moduleSeen,
      terminated: packet.terminated,
      request: encode(packet.request),
      response: encode(packet.response),
    };
  }, index);
}
