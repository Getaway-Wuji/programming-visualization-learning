import { afterEach, expect, test, vi } from 'vitest';
import { StorageClient } from '../../web/src/storage/client';
import { DB_NAME } from '../../web/src/storage/model';

afterEach(() => vi.unstubAllGlobals());

test('notification permission failure does not reject the established IndexedDB connection', () => {
  vi.stubGlobal(
    'BroadcastChannel',
    class {
      constructor() {
        throw new DOMException('Notification unavailable', 'SecurityError');
      }
    },
  );
  // Only the independent notification setup is simulated. Native persistence and
  // transaction behavior are covered by storage.spec.ts in real browsers.
  const close = vi.fn();
  const db = { name: DB_NAME, close } as unknown as IDBDatabase;
  const client = new StorageClient(db, false, {} as IDBFactory);
  expect(client.timeZoneFallback).toBe(false);
  expect(close).not.toHaveBeenCalled();
  client.close();
  expect(close).toHaveBeenCalledOnce();
});
