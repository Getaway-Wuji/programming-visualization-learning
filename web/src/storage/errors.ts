export type StorageErrorCode =
  | 'S_VERSION_UNKNOWN'
  | 'S_GENERATION_STALE'
  | 'S_REVISION_CONFLICT'
  | 'S_EVENT_ID_REUSED'
  | 'S_CONTENT_INCOMPATIBLE'
  | 'S_RECORD_INVALID'
  | 'S_DATE_INVALID'
  | 'S_STORAGE_UNAVAILABLE'
  | 'S_QUOTA'
  | 'S_ABORTED'
  | 'S_UPGRADE_BLOCKED'
  | 'S_MIGRATION_UNSUPPORTED';

export class StorageError extends Error {
  readonly saved = false;
  constructor(readonly code: StorageErrorCode) {
    super(code);
    this.name = 'StorageError';
  }
}

// Preserve only a stable code. Never log or persist an exception/record body.
export function storageError(error: unknown): StorageError {
  if (error instanceof StorageError) return error;
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    [
      'S_VERSION_UNKNOWN',
      'S_GENERATION_STALE',
      'S_REVISION_CONFLICT',
      'S_EVENT_ID_REUSED',
      'S_CONTENT_INCOMPATIBLE',
      'S_RECORD_INVALID',
      'S_DATE_INVALID',
      'S_STORAGE_UNAVAILABLE',
      'S_QUOTA',
      'S_ABORTED',
      'S_UPGRADE_BLOCKED',
      'S_MIGRATION_UNSUPPORTED',
    ].includes(error.code)
  ) {
    return new StorageError(error.code as StorageErrorCode);
  }
  const name = error && typeof error === 'object' && 'name' in error ? error.name : '';
  if (name === 'QuotaExceededError') return new StorageError('S_QUOTA');
  if (name === 'VersionError') return new StorageError('S_VERSION_UNKNOWN');
  if (name === 'AbortError') return new StorageError('S_ABORTED');
  return new StorageError('S_STORAGE_UNAVAILABLE');
}
