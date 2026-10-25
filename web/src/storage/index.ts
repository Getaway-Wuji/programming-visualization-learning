import { openStorage } from './client';
import type { Ref } from './model';

// Pages receive read/probe capability. Trusted mutations remain in the storage
// internals until 04.2 supplies a validated, closed learning command layer.
export async function openLearningStorage(activePackageRef: Ref, signal?: AbortSignal) {
  const client = await openStorage({ activePackageRef, signal });
  return {
    read: () => client.read(),
    probe: () => client.probe(),
    close: () => client.close(),
    timeZoneFallback: client.timeZoneFallback,
  };
}
export { StorageError } from './errors';
export type { StorageSnapshot, Meta, Ref } from './model';
