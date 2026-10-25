import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createContentRepository } from '../../web/src/content/repository';
import { ContentError, MAX_CONTENT_BYTES, parseContent } from '../../web/src/content/validator.mjs';

const fixtureUrl = new URL('../../项目文档/契约/02.1-内容样例.json', import.meta.url);
const bytes = new Uint8Array(readFileSync(fixtureUrl));
interface Operation {
  op: 'set' | 'append' | 'remove';
  path: string;
  value?: unknown;
}
interface Scenario {
  id: string;
  operations: Operation[];
  expectedCode: string;
}
const bad = JSON.parse(
  readFileSync(new URL('../../项目文档/契约/02.1-非法配置样例.json', import.meta.url), 'utf8'),
) as {
  scenarios: Scenario[];
  rawJsonScenarios: { id: string; rawJson: string; expectedCode: string }[];
};
const encode = (source: string) => new TextEncoder().encode(source);
function mutate(operations: Operation[]) {
  const object = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  for (const operation of operations) {
    const parts = operation.path
      .slice(1)
      .split('/')
      .map((key) => key.replace(/~1/g, '/').replace(/~0/g, '~'));
    const last = parts.pop()!;
    let parent = object;
    for (const key of parts) parent = parent[key] as Record<string, unknown>;
    if (operation.op === 'set') parent[last] = operation.value;
    else if (operation.op === 'append') (parent[last] as unknown[]).push(operation.value);
    else if (Array.isArray(parent)) parent.splice(Number(last), 1);
    else delete parent[last];
  }
  return encode(JSON.stringify(object));
}
function failure(input: Uint8Array) {
  try {
    parseContent(input);
  } catch (error) {
    expect(error).toBeInstanceOf(ContentError);
    return error as ContentError;
  }
  throw new Error('Invalid content was accepted');
}
const set = (path: string, value: unknown): Operation => ({ op: 'set', path, value });
const remove = (path: string): Operation => ({ op: 'remove', path });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('production CONTENT-01 static validation', () => {
  it('loads the complete immutable 82-entity / 405-reference graph and original teaching text', () => {
    const content = parseContent(bytes);
    expect(content.purpose).toBe('contract-fixture');
    expect(content.chapters).toHaveLength(3);
    expect(content.lessons).toHaveLength(6);
    expect(content.exercises).toHaveLength(6);
    expect(content.exercises.reduce((count, exercise) => count + exercise.tests.length, 0)).toBe(
      24,
    );
    expect(content.cases.filter((item) => item.kind === 'demo')).toHaveLength(4);
    expect(content.cases.filter((item) => item.kind === 'algorithm')).toHaveLength(3);
    expect(content.blocks).toHaveLength(20);
    expect(content.lessons[0].teaching.objectives).toContain('声明并读取一个 int 输入变量');
    expect(content.programs[0].sourceExample).toContain('int x = 7;');
    expect(content).toEqual(JSON.parse(new TextDecoder().decode(bytes)));
    expect(Object.isFrozen(content)).toBe(true);
    expect(Object.isFrozen(content.exercises[4].tests[0].input.values)).toBe(true);
    expect(() => Reflect.set(content.lessons[0], 'title', 'changed')).not.toThrow();
    expect(content.lessons[0].title).toBe('变量和输出');
  });

  for (const scenario of bad.scenarios) {
    it(`matches frozen rejection ${scenario.id}`, () => {
      const error = failure(mutate(scenario.operations));
      expect(error.code).toBe(scenario.expectedCode);
      expect(
        error.diagnostics.every((item) => item.severity === 'error' && item.path.startsWith('/')),
      ).toBe(true);
    });
  }
  for (const scenario of bad.rawJsonScenarios) {
    it(`matches frozen raw rejection ${scenario.id}`, () => {
      expect(failure(encode(scenario.rawJson)).code).toBe(scenario.expectedCode);
    });
  }

  const schemaCases: [string, Operation[]][] = [
    ['root closure', [set('/unregistered', true)]],
    ['allOf entity closure', [set('/programs/0/hiddenRewrite', true)]],
    ['nested closure', [set('/lessons/0/teaching/source/remote', 'https://example.test/')]],
    ['integer else/not/anyOf', [set('/inputSpecs/0/fields/0/minItems', 0)]],
    ['sequence if/then', [remove('/inputSpecs/2/fields/0/maxItems')]],
    ['nondecreasing else/not', [set('/inputSpecs/4/relations/1/target', 'values')]],
    ['length-of then', [remove('/inputSpecs/2/relations/0/target')]],
    ['scalar else/not', [set('/programs/0/bindings/0/emptyStorage', 'one-zero-placeholder')]],
    ['array if/then', [remove('/programs/4/bindings/1/emptyStorage')]],
    ['input oneOf', [set('/programs/0/exampleInput/x', { value: 7 })]],
    ['input array items', [set('/programs/4/exampleInput/values', [1, 'two'])]],
    ['input minProperties', [set('/programs/0/exampleInput', {})]],
    ['unknown enum', [set('/cases/0/kind', 'advanced')]],
    ['finite integer type', [set('/lessons/0/learningRevision', 1.5)]],
    ['numeric bound', [set('/inputSpecs/0/fields/0/min', -1000)]],
    ['minLength', [set('/lessons/0/teaching/explanation', '')]],
    ['maxItems', [set('/exercises/4/tests/0/expectedArray', Array(31).fill(0))]],
    ['expected exit const', [set('/exercises/0/tests/0/expectedExitCode', 1)]],
  ];
  for (const [name, operations] of schemaCases) {
    it(`enforces frozen Schema ${name}`, () => {
      expect(failure(mutate(operations)).code).toBe('CONTENT_SCHEMA_INVALID');
    });
  }
  it('compares duplicate refs by value even when object key order differs', () => {
    expect(
      failure(
        mutate([
          {
            op: 'append',
            path: '/lessons/0/knowledgeRefs',
            value: { version: '1.0.0', id: 'knowledge.c.entry' },
          },
        ]),
      ).code,
    ).toBe('CONTENT_LIST_DUPLICATE');
  });
  it('prioritizes dedicated structure codes and stops before dependent semantic checks', () => {
    const error = failure(
      mutate([
        set('/contractVersion', '2.0.0'),
        set('/future', 1),
        set('/exercises/0/programRef/id', 'missing.reference'),
      ]),
    );
    expect(error.code).toBe('CONTENT_CONTRACT_UNSUPPORTED');
    expect(error.diagnostics).toHaveLength(1);
    expect(failure(mutate([set('/lessons/0/id', 'LESSON-01')])).code).toBe('CONTENT_ID_INVALID');
    expect(failure(mutate([set('/lessons/0/id', 'l.' + 'x'.repeat(95))])).code).toBe(
      'CONTENT_ID_INVALID',
    );
  });
  it('rejects unsafe publication and unreviewed learning compatibility', () => {
    expect(failure(mutate([set('/purpose', 'publishable')])).code).toBe(
      'CONTENT_PUBLICATION_UNVERIFIED',
    );
    expect(failure(mutate([set('/lessons/0/acceptedPriorVersions', ['0.9.0'])])).code).toBe(
      'CONTENT_LEARNING_COMPATIBILITY_INVALID',
    );
    expect(failure(mutate([set('/lessons/0/teaching/explanation', '  ')])).code).toBe(
      'CONTENT_PUBLICATION_UNVERIFIED',
    );
  });
  it('validates input metadata and exact fields without calculating any C results', () => {
    expect(failure(mutate([set('/inputSpecs/0/fields/0/max', 998)])).code).toBe(
      'CONTENT_INPUT_SPEC_INVALID',
    );
    expect(failure(mutate([set('/programs/0/exampleInput/unknown', 7)])).code).toBe(
      'CONTENT_INPUT_INVALID',
    );
    expect(failure(mutate([set('/programs/9/bindings/2/targetName', 'values')])).code).toBe(
      'CONTENT_BINDING_INVALID',
    );
    expect(failure(mutate([set('/exercises/4/tests/0/expectedArray', [4, 0, -2])])).code).toBe(
      'CONTENT_JUDGE_INVALID',
    );
    expect(failure(mutate([set('/rewardSources/3/repeat', 'first-only')])).code).toBe(
      'CONTENT_REWARD_INVALID',
    );
  });
  it('keeps source as plain preview text and does not pretend to parse C', () => {
    const content = parseContent(
      mutate([set('/programs/0/sourceExample', 'C parsing is deliberately deferred to Rust.')]),
    );
    expect(content.programs[0].sourceExample).toBe('C parsing is deliberately deferred to Rust.');
  });
  it('accepts paired Unicode and rejects malformed UTF-8, BOM, unpaired Unicode, nonfinite numbers and excess depth', () => {
    expect(parseContent(mutate([set('/lessons/0/title', '变量 🌱')])).lessons[0].title).toBe(
      '变量 🌱',
    );
    for (const raw of [
      '{"a":"\\ud800"}',
      '{"\\udc00":1}',
      '{"a":1e999}',
      '{"a":9007199254740993}',
      '['.repeat(66) + '0' + ']'.repeat(66),
      '\ufeff{}',
    ]) {
      expect(failure(encode(raw)).code).toBe('CONTENT_JSON_INVALID');
    }
    expect(failure(new Uint8Array([0xc3, 0x28])).code).toBe('CONTENT_JSON_INVALID');
    expect(failure(encode('{"a":1,"\\u0061":2}')).code).toBe('CONTENT_JSON_DUPLICATE_KEY');
    expect(failure(new Uint8Array(MAX_CONTENT_BYTES + 1)).code).toBe('CONTENT_SIZE_EXCEEDED');
  });
});

function browserEnvironment() {
  vi.stubGlobal('location', {
    href: 'https://learning.test/app/#/',
    origin: 'https://learning.test',
  });
  vi.stubEnv('BASE_URL', '/app/');
}
function response() {
  return new Response(bytes.slice(), { headers: { 'Content-Type': 'application/json' } });
}
describe('public static content repository', () => {
  it('uses the controlled same-origin static path and excludes credentials, referrer and request body', async () => {
    browserEnvironment();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response());
    const repository = createContentRepository({ fetcher });
    await repository.load();
    const [target, options] = fetcher.mock.calls[0];
    expect(String(target)).toBe('https://learning.test/app/content/sample/02.1-content-1.0.0.json');
    expect(options).toMatchObject({
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json' },
    });
    expect(options?.body).toBeUndefined();
    expect(repository.getSnapshot()).toMatchObject({ stale: false, error: null });
  });
  it.each([
    'https://foreign.test/app/content/sample.json',
    '/app/private/user.json',
    '/app/content/../private.json',
    '/app/content/sample.json?input=7',
    '/app/content/sample.json#input',
    'data:application/json,{}',
  ])('rejects an uncontrolled resource URL %s before requesting', async (url) => {
    browserEnvironment();
    const fetcher = vi.fn<typeof fetch>();
    await expect(createContentRepository({ url, fetcher }).load()).rejects.toMatchObject({
      code: 'CONTENT_RESOURCE_FORBIDDEN',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects the entire new package, explicitly retains the valid version as stale, and retries cleanly', async () => {
    browserEnvironment();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(new Response(mutate([set('/purpose', 'publishable')])))
      .mockResolvedValueOnce(response());
    const repository = createContentRepository({ fetcher });
    const previous = await repository.load();
    await expect(repository.load()).rejects.toMatchObject({
      code: 'CONTENT_PUBLICATION_UNVERIFIED',
    });
    expect(repository.getSnapshot()).toMatchObject({
      package: previous,
      stale: true,
      error: { code: 'CONTENT_PUBLICATION_UNVERIFIED' },
    });
    await repository.load();
    expect(repository.getSnapshot()).toMatchObject({ stale: false, error: null });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('shows no package on HTTP/transport failures and can recover', async () => {
    browserEnvironment();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(response());
    const repository = createContentRepository({ fetcher });
    await expect(repository.load()).rejects.toMatchObject({ code: 'CONTENT_LOAD_FAILED' });
    expect(repository.getSnapshot()).toMatchObject({ package: null, stale: false });
    await expect(repository.load()).rejects.toMatchObject({ code: 'CONTENT_LOAD_FAILED' });
    await expect(repository.load()).resolves.toMatchObject({ purpose: 'contract-fixture' });
  });
  it('cancels one request without sharing its abort with another consumer, including ignored cancellation', async () => {
    browserEnvironment();
    let resolveFirst!: (value: Response) => void;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(response());
    const repository = createContentRepository({ fetcher });
    const abort = new AbortController();
    const first = repository.load(abort.signal);
    const rejected = expect(first).rejects.toMatchObject({ code: 'CONTENT_LOAD_CANCELLED' });
    const second = await repository.load();
    abort.abort();
    await rejected;
    resolveFirst(new Response('{}'));
    await Promise.resolve();
    expect(repository.getSnapshot()).toMatchObject({ package: second, stale: false, error: null });
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(fetcher.mock.calls[1][1]?.signal).not.toBe(fetcher.mock.calls[0][1]?.signal);
  });
  it('prevents a late older failure from replacing a newer successful package', async () => {
    browserEnvironment();
    let resolveFirst!: (value: Response) => void;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(response());
    const repository = createContentRepository({ fetcher });
    const first = repository.load();
    const failureExpected = expect(first).rejects.toMatchObject({
      code: 'CONTENT_CONTRACT_UNSUPPORTED',
    });
    const latest = await repository.load();
    resolveFirst(new Response('{}'));
    await failureExpected;
    expect(repository.getSnapshot()).toMatchObject({ package: latest, stale: false, error: null });
  });
  it('bounds the response both by content-length and actual streamed bytes', async () => {
    browserEnvironment();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('{}', { headers: { 'Content-Length': String(MAX_CONTENT_BYTES + 1) } }),
      )
      .mockResolvedValueOnce(new Response(new Uint8Array(MAX_CONTENT_BYTES + 1)));
    const repository = createContentRepository({ fetcher });
    await expect(repository.load()).rejects.toMatchObject({ code: 'CONTENT_SIZE_EXCEEDED' });
    await expect(repository.load()).rejects.toMatchObject({ code: 'CONTENT_SIZE_EXCEEDED' });
  });
  it('times out both a hung fetch and a hung response body at 10 seconds', async () => {
    browserEnvironment();
    vi.useFakeTimers();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => new Promise(() => undefined))
      .mockResolvedValueOnce(new Response(new ReadableStream()));
    const repository = createContentRepository({ fetcher });
    const first = expect(repository.load()).rejects.toMatchObject({ code: 'CONTENT_LOAD_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(10_000);
    await first;
    const second = expect(repository.load()).rejects.toMatchObject({
      code: 'CONTENT_LOAD_TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await second;
  });
});
