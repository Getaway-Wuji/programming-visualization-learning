interface MemoryPacketObservation {
  postedAt?: number;
  receivedAt?: number;
  request?: ArrayBuffer;
  response?: ArrayBuffer;
}
declare global {
  interface Window {
    memoryPacketObservations: MemoryPacketObservation[];
  }
}
/** Observe real IPC without altering messages, clocks or the execution budget. */
export function observeMemoryPackets() {
  window.memoryPacketObservations = [];
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    private packet: MemoryPacketObservation = {};
    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options);
      window.memoryPacketObservations.push(this.packet);
      this.addEventListener('message', (event) => {
        if (event.data?.buffer instanceof ArrayBuffer) {
          this.packet.receivedAt = performance.now();
          this.packet.response = event.data.buffer;
        }
      });
    }
    postMessage(value: unknown, options: Transferable[] | StructuredSerializeOptions = []) {
      if (
        value &&
        typeof value === 'object' &&
        'buffer' in value &&
        value.buffer instanceof ArrayBuffer
      ) {
        this.packet.postedAt = performance.now();
        this.packet.request = value.buffer.slice(0);
      }
      if (Array.isArray(options)) super.postMessage(value, options);
      else super.postMessage(value, options);
    }
  };
}
