import { describe, expect, it, vi } from 'vitest';
import { LearningService } from '../../web/src/learning/service';
import { createLearningAuthority, type LearningEvent } from '../../web/src/learning/authority';
import { createLearningCatalog } from '../../web/src/learning/catalog';
import { StorageError } from '../../web/src/storage/errors';
import type { StorageClient } from '../../web/src/storage/client';
import { createMeta, emptySnapshot } from '../../web/src/storage/model';
import type { LearningCatalog } from '../../web/src/learning/types';

const packageRef = { id: 'content.synthetic.service', version: '1.0.0' };
const exerciseRef = { id: 'exercise.synthetic.service', version: '1.0.0' };
const lessonRef = { id: 'lesson.synthetic.service', version: '1.0.0' };
function catalog(purpose: LearningCatalog['purpose'] = 'contract-fixture') {
  return createLearningCatalog({
    purpose,
    packageRef,
    lessons: [
      {
        ref: lessonRef,
        learningRevision: 1,
        acceptedPriorVersions: [],
        requiredExerciseRefs: [exerciseRef],
      },
    ],
    exercises: [
      {
        ref: exerciseRef,
        learningRevision: 1,
        acceptedPriorVersions: [],
        lessonRef,
        caseKeys: ['normal'],
      },
    ],
    cases: [],
  });
}
function snapshot(revision = 0) {
  return emptySnapshot(
    createMeta({
      generation: '12345678-1234-4234-8234-123456789abc',
      timeZone: 'Asia/Shanghai',
      createdAt: '2026-10-15T02:00:00.000Z',
      activePackageRef: packageRef,
      revision,
    }),
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
/** Lifecycle-only DI: these mocks establish no IndexedDB persistence claim. */
function lifecycleClient() {
  const fake = {
    read: vi.fn(async () => snapshot()),
    close: vi.fn(),
    commit: vi.fn(async () => ({ saved: true as const, revision: 1, replayed: false })),
    timeZoneFallback: false,
  };
  return { fake, client: fake as unknown as StorageClient };
}

describe('learning service state and asynchronous acknowledgment', () => {
  it('has no saved defaults while storage is still opening and applies the actual read state', async () => {
    const { client, fake } = lifecycleClient();
    const loaded = snapshot();
    loaded.settings.theme = 'dark';
    fake.read.mockResolvedValue(loaded);
    const opening = deferred<StorageClient>();
    const service = new LearningService({ catalog: catalog(), openStorage: () => opening.promise });
    const start = service.start();
    expect(service.getState()).toMatchObject({
      status: 'loading',
      snapshot: null,
      projection: null,
      lastSaved: false,
    });
    opening.resolve(client);
    await start;
    expect(service.getState()).toMatchObject({
      status: 'ready',
      lastSaved: false,
      snapshot: { settings: { theme: 'dark' } },
    });
    expect(service.getState().projection!.settings).toEqual(loaded.settings);
    service.dispose();
  });

  it('reports unavailable storage without claiming default values were saved', async () => {
    const service = new LearningService({
      catalog: catalog(),
      openStorage: async () => {
        throw new StorageError('S_STORAGE_UNAVAILABLE');
      },
    });
    await service.start();
    expect(service.getState()).toMatchObject({
      status: 'unsaved',
      errorCode: 'S_STORAGE_UNAVAILABLE',
      lastSaved: false,
      snapshot: null,
    });
    service.dispose();
  });

  it('closes a late opened connection after disposal without publishing a ready state', async () => {
    const { client, fake } = lifecycleClient();
    const opening = deferred<StorageClient>();
    const service = new LearningService({ catalog: catalog(), openStorage: () => opening.promise });
    const listener = vi.fn();
    service.subscribe(listener);
    const start = service.start();
    service.dispose();
    opening.resolve(client);
    await start;
    expect(fake.close).toHaveBeenCalledOnce();
    expect(fake.read).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(service.getState().status).toBe('loading');
  });

  it('keeps the final newer snapshot when two refreshes are requested together', async () => {
    const { client, fake } = lifecycleClient();
    const service = new LearningService({ catalog: catalog(), openStorage: async () => client });
    await service.start();
    const old = deferred<ReturnType<typeof snapshot>>();
    const recent = snapshot(2);
    recent.settings.theme = 'dark';
    fake.read.mockImplementationOnce(() => old.promise).mockResolvedValueOnce(recent);
    const earlierRead = service.refresh();
    const laterRead = service.refresh();
    old.resolve(snapshot(1));
    await Promise.all([earlierRead, laterRead]);
    expect(service.getState().snapshot!.meta.revision).toBe(2);
    expect(service.getState().projection!.settings.theme).toBe('dark');
    service.dispose();
  });

  it('exposes revision conflicts independently from persisted progress and avoids a saved acknowledgment', async () => {
    const { client, fake } = lifecycleClient();
    const service = new LearningService({ catalog: catalog(), openStorage: async () => client });
    await service.start();
    const before = service.getState().snapshot;
    fake.commit.mockRejectedValueOnce(new StorageError('S_REVISION_CONFLICT'));
    await service.saveDisplay({ theme: 'dark', reducedMotion: 'on', playbackRate: 2 }, 0);
    expect(service.getState()).toMatchObject({
      status: 'conflict',
      errorCode: 'S_REVISION_CONFLICT',
      lastSaved: false,
    });
    expect(service.getState().snapshot).toEqual(before);
    service.dispose();
  });

  it('does not announce saved when commit confirmation is followed by a failed verification read', async () => {
    const { client, fake } = lifecycleClient();
    const service = new LearningService({ catalog: catalog(), openStorage: async () => client });
    await service.start();
    fake.read.mockRejectedValueOnce(new StorageError('S_STORAGE_UNAVAILABLE'));
    await service.saveDisplay({ theme: 'dark', reducedMotion: 'off', playbackRate: 1 }, 0);
    expect(fake.commit).toHaveBeenCalledOnce();
    expect(service.getState()).toMatchObject({ status: 'unsaved', lastSaved: false });
    service.dispose();
  });

  it('retries an initially unavailable storage open when the user refreshes', async () => {
    const { client } = lifecycleClient();
    const open = vi
      .fn<() => Promise<StorageClient>>()
      .mockRejectedValueOnce(new StorageError('S_STORAGE_UNAVAILABLE'))
      .mockResolvedValueOnce(client);
    const service = new LearningService({ catalog: catalog(), openStorage: open });
    await service.start();
    expect(service.getState()).toMatchObject({
      status: 'unsaved',
      snapshot: null,
      lastSaved: false,
    });
    await service.refresh();
    expect(open).toHaveBeenCalledTimes(2);
    expect(service.getState()).toMatchObject({
      status: 'ready',
      errorCode: null,
      lastSaved: false,
    });
    expect(service.getState().snapshot).toEqual(snapshot());
    service.dispose();
  });

  it('a pending focus refresh cannot suppress a successful save verification or produce a false unavailable result', async () => {
    const { client, fake } = lifecycleClient();
    const service = new LearningService({ catalog: catalog(), openStorage: async () => client });
    await service.start();
    const verification = deferred<ReturnType<typeof snapshot>>();
    const focusRead = deferred<ReturnType<typeof snapshot>>();
    const saved = snapshot(1);
    saved.settings.theme = 'dark';
    fake.read
      .mockImplementationOnce(() => verification.promise)
      .mockImplementationOnce(() => focusRead.promise);
    const saving = service.saveDisplay(
      { theme: 'dark', reducedMotion: 'system', playbackRate: 1 },
      0,
    );
    await vi.waitFor(() => expect(fake.read).toHaveBeenCalledTimes(2));
    const focus = service.refresh();
    try {
      verification.resolve(saved);
      await saving;
      expect(service.getState()).toMatchObject({
        status: 'ready',
        errorCode: null,
        lastSaved: true,
        snapshot: { meta: { revision: 1 }, settings: { theme: 'dark' } },
      });
    } finally {
      focusRead.resolve(saved);
      await focus;
      service.dispose();
    }
  });

  it('a concurrent successful focus read cannot turn a failed save verification into an acknowledgment', async () => {
    const { client, fake } = lifecycleClient();
    const service = new LearningService({ catalog: catalog(), openStorage: async () => client });
    await service.start();
    const verification = deferred<ReturnType<typeof snapshot>>();
    const refreshed = snapshot(1);
    refreshed.settings.theme = 'dark';
    const acknowledgments: boolean[] = [];
    service.subscribe(() => acknowledgments.push(service.getState().lastSaved));
    fake.read.mockImplementationOnce(() => verification.promise).mockResolvedValueOnce(refreshed);
    const saving = service.saveDisplay(
      { theme: 'dark', reducedMotion: 'system', playbackRate: 1 },
      0,
    );
    await vi.waitFor(() => expect(fake.read).toHaveBeenCalledTimes(2));
    const focus = service.refresh();
    verification.reject(new StorageError('S_STORAGE_UNAVAILABLE'));
    await Promise.all([saving, focus]);
    expect(acknowledgments).not.toContain(true);
    expect(service.getState().lastSaved).toBe(false);
    service.dispose();
  });
});

describe('trusted capture identity and original occurrence time', () => {
  function passedEvent(): LearningEvent {
    return {
      eventContractVersion: '1.0.0',
      eventType: 'exercise.passed',
      subjectRef: exerciseRef,
      packageRef,
      learningRevision: 1,
      result: 'passed',
    };
  }
  function openedDays() {
    const value = snapshot();
    value.goals = [
      { localDate: '2026-10-15', goalVersion: 1, targets: null, achievedAt: null },
      { localDate: '2026-10-16', goalVersion: 1, targets: null, achievedAt: null },
    ];
    return value;
  }

  it('recapturing the same token on another day returns the original command; a new token represents a new occurrence', async () => {
    const content = catalog('publishable');
    const { client, fake } = lifecycleClient();
    fake.read.mockResolvedValue(openedDays());
    let at = '2026-10-15T15:59:00.000Z';
    const clock = vi.fn(() => at);
    const id = vi
      .fn()
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002');
    const service = new LearningService({
      catalog: content,
      openStorage: async () => client,
      clock,
      id,
    });
    const authority = createLearningAuthority(content, () => true);
    await service.start();
    const fact = authority.issue(passedEvent());
    const first = await service.capture(fact);
    at = '2026-10-15T16:01:00.000Z';
    const repeated = await service.capture(fact);
    expect(repeated).toBe(first);
    expect(repeated.receipt).toMatchObject({
      eventId: '00000000-0000-4000-8000-000000000001',
      occurredAt: '2026-10-15T15:59:00.000Z',
      localDate: '2026-10-15',
    });
    expect(clock).toHaveBeenCalledOnce();
    expect(id).toHaveBeenCalledOnce();
    const next = await service.capture(authority.issue(passedEvent()));
    expect(next).not.toBe(first);
    expect(next.receipt).toMatchObject({
      eventId: '00000000-0000-4000-8000-000000000002',
      occurredAt: '2026-10-15T16:01:00.000Z',
      localDate: '2026-10-16',
    });
    service.dispose();
  });

  it('fixes the occurrence time and ID before a storage read delayed across local midnight', async () => {
    const content = catalog('publishable');
    const { client, fake } = lifecycleClient();
    const days = openedDays();
    fake.read.mockResolvedValue(days);
    let at = '2026-10-15T15:59:00.000Z';
    let eventId = '00000000-0000-4000-8000-000000000001';
    const service = new LearningService({
      catalog: content,
      openStorage: async () => client,
      clock: () => at,
      id: () => eventId,
    });
    const authority = createLearningAuthority(content, () => true);
    await service.start();
    const read = deferred<ReturnType<typeof snapshot>>();
    fake.read.mockImplementationOnce(() => read.promise);
    const capture = service.capture(authority.issue(passedEvent()));
    at = '2026-10-15T16:01:00.000Z';
    eventId = '00000000-0000-4000-8000-000000000002';
    read.resolve(days);
    const command = await capture;
    expect(command.receipt).toMatchObject({
      eventId: '00000000-0000-4000-8000-000000000001',
      occurredAt: '2026-10-15T15:59:00.000Z',
      localDate: '2026-10-15',
    });
    service.dispose();
  });

  it('retries a failed capture of the same token with its original day, generation and event ID', async () => {
    const content = catalog('publishable');
    const { client, fake } = lifecycleClient();
    fake.read.mockResolvedValue(openedDays());
    let at = '2026-10-15T15:59:00.000Z';
    const clock = vi.fn(() => at);
    const id = vi.fn().mockReturnValue('00000000-0000-4000-8000-000000000001');
    const service = new LearningService({
      catalog: content,
      openStorage: async () => client,
      clock,
      id,
    });
    const authority = createLearningAuthority(content, () => true);
    await service.start();
    const fact = authority.issue(passedEvent());
    fake.read.mockRejectedValueOnce(new StorageError('S_STORAGE_UNAVAILABLE'));
    await expect(service.capture(fact)).rejects.toMatchObject({ code: 'S_STORAGE_UNAVAILABLE' });
    at = '2026-10-15T16:01:00.000Z';
    const retry = await service.capture(fact);
    expect(retry).toMatchObject({
      generation: '12345678-1234-4234-8234-123456789abc',
      receipt: {
        eventId: '00000000-0000-4000-8000-000000000001',
        occurredAt: '2026-10-15T15:59:00.000Z',
        localDate: '2026-10-15',
      },
    });
    expect(clock).toHaveBeenCalledOnce();
    expect(id).toHaveBeenCalledOnce();
    service.dispose();
  });
});

describe('private learning authority boundary', () => {
  const event = (): LearningEvent => ({
    eventContractVersion: '1.0.0',
    eventType: 'exercise.passed',
    subjectRef: { ...exerciseRef },
    packageRef: { ...packageRef },
    learningRevision: 1,
    result: 'passed',
  });
  it('rejects fixture provenance even when a synthetic verifier returns true', () => {
    const authority = createLearningAuthority(catalog(), () => true);
    expect(() => authority.issue(event())).toThrowError(
      expect.objectContaining({ code: 'S_CONTENT_INCOMPATIBLE' }),
    );
  });
  it('rejects the UI validated flag and unsupported derived-event types', () => {
    const authority = createLearningAuthority(catalog('publishable'), () => true);
    expect(() =>
      authority.issue({ ...event(), validated: true } as unknown as LearningEvent),
    ).toThrowError(expect.objectContaining({ code: 'S_RECORD_INVALID' }));
    expect(() =>
      authority.issue({
        ...event(),
        eventType: 'lesson.completed',
        subjectRef: lessonRef,
        result: 'completed',
      } as unknown as LearningEvent),
    ).toThrowError(expect.objectContaining({ code: 'S_RECORD_INVALID' }));
  });
});
