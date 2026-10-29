// Static declaration generation is compared with real Rust prepare_input.
// No algorithm execution or browser performance acceptance occurs in this file.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test, vi } from 'vitest';
import type { ContentPackage, InputValues } from '../../web/src/content/types';
import { exerciseCatalog, type CoursePractice } from '../../web/src/content/practice';
import {
  caseRequest,
  ExecutionClient,
  type ExecutionCatalog,
  type PreparedSource,
} from '../../web/src/engine/execution-client';
import { generateInput, validateInputValues } from '../../web/src/engine/input-data';
import {
  tryPreparePublishedSource,
  type PreparedSourceEntry,
  type PreparedSourceManifest,
} from '../../web/src/engine/prepared-source';
import { encodeRequest } from '../../web/src/engine/protocol';
import { preparedSourceManifest } from '../../web/src/generated/prepared-sources';
import { initSync, prepare_input } from '../../web/src/generated/c_viz_wasm';
import { caseSetSamples } from '../fixtures/case-set';
import { exerciseRequest } from '../../web/src/practice/submission';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const canonical = (value: unknown) =>
  JSON.stringify(value, (_, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const caseView = readJson('../../content/c/p0/case-view-1.0.1.json') as {
  catalogs: ExecutionCatalog[];
};
const practice = readJson(
  '../../web/public/content/practice/course-practice-1.0.0.json',
) as CoursePractice;
const fixture = readJson('../../项目文档/契约/02.1-内容样例.json') as ContentPackage;
const catalogs = [
  ...caseView.catalogs,
  ...practice.exercises.map((subject) => exerciseCatalog(practice, subject.id)),
];
const byId = (id: string) => catalogs.find((entry) => entry.subject.id === id)!;
const entityRef = ({ id, version }: { id: string; version: string }) => ({ id, version });
const expanded = readJson('../../content/c/p05/course-1.0.0.json') as ContentPackage;
const expandedPractice: CoursePractice = {
  practiceVersion: '1.0.0',
  sourceSha256: '',
  packageRef: { id: expanded.packageId, version: expanded.packageVersion },
  exercises: expanded.exercises,
  programs: expanded.programs,
  inputSpecs: expanded.inputSpecs,
  judgeProfiles: expanded.judgeProfiles,
};
const expandedCatalogs: ExecutionCatalog[] = [
  ...expanded.cases.map((subject) => {
    const program = expanded.programs.find(
      (entry) => entry.id === subject.programRef.id && entry.version === subject.programRef.version,
    )!;
    return {
      packageRef: expandedPractice.packageRef,
      subject,
      program,
      inputSpec: expanded.inputSpecs.find(
        (entry) => entry.id === program.inputRef.id && entry.version === program.inputRef.version,
      )!,
    };
  }),
  ...expanded.exercises.map((subject) => exerciseCatalog(expandedPractice, subject.id)),
];

function rustPrepare(catalog: ExecutionCatalog, values: InputValues): PreparedSource {
  const bytes = prepare_input(JSON.stringify(catalog), encoder.encode(canonical(values)), 1000);
  return (JSON.parse(decoder.decode(bytes)) as { source: PreparedSource }).source;
}
function entryFor(
  catalog: ExecutionCatalog,
  template = rustPrepare(catalog, catalog.program.exampleInput),
): PreparedSourceEntry {
  return {
    catalogSha256: sha(canonical(catalog)),
    packageRef: entityRef(catalog.packageRef),
    subjectRef: entityRef(catalog.subject),
    programRef: entityRef(catalog.program),
    inputSpecRef: entityRef(catalog.inputSpec),
    sourceSha256: sha(catalog.program.sourceExample),
    templateSha256: sha(canonical(template)),
    template,
  };
}
function withoutDeclarations(source: PreparedSource): string {
  const bytes = encoder.encode(source.text);
  let previous = 0;
  const parts: string[] = [];
  for (const { byteRange } of source.bindingMap) {
    parts.push(decoder.decode(bytes.subarray(previous, byteRange.start)));
    previous = byteRange.end;
  }
  parts.push(decoder.decode(bytes.subarray(previous)));
  return parts.join('');
}
async function withManifest(
  manifest: PreparedSourceManifest,
  inspect: (prepare: typeof tryPreparePublishedSource) => Promise<void>,
) {
  vi.resetModules();
  vi.doMock('../../web/src/generated/prepared-sources', () => ({
    preparedSourceManifest: manifest,
  }));
  try {
    const module = await import('../../web/src/engine/prepared-source');
    await inspect(module.tryPreparePublishedSource);
  } finally {
    vi.doUnmock('../../web/src/generated/prepared-sources');
    vi.resetModules();
  }
}
beforeAll(() => {
  initSync({
    module: readFileSync(new URL('../../web/src/generated/c_viz_wasm_bg.wasm', import.meta.url)),
  });
});

test('the generated registry preserves exactly the 13 legacy published catalogs and no contract fixtures', () => {
  const legacy = preparedSourceManifest.entries.filter(
    (entry) => entry.packageRef.id === 'content.c.p0',
  );
  expect(legacy).toHaveLength(13);
  expect(new Set(legacy.map((entry) => entry.catalogSha256))).toEqual(
    new Set(catalogs.map((catalog) => sha(canonical(catalog)))),
  );
  expect(new Set(legacy.map((entry) => entry.programRef.id)).size).toBe(10);
  for (const catalog of catalogs) {
    const entry = preparedSourceManifest.entries.find(
      (item) => item.catalogSha256 === sha(canonical(catalog)),
    )!;
    expect(entry).toEqual(entryFor(catalog));
  }
});

test('all published examples, 24 fixed tests and 0/1/30 boundary inputs exactly match Rust bytes and ranges', async () => {
  let fixed = 0;
  let compared = 0;
  for (const catalog of catalogs) {
    const inputs: InputValues[] = [catalog.program.exampleInput];
    if ('tests' in catalog.subject) {
      fixed += catalog.subject.tests.length;
      inputs.push(...catalog.subject.tests.map((entry) => entry.input));
    }
    const sequence = catalog.inputSpec.fields.find((field) => field.kind === 'sequence');
    if (sequence) {
      for (const length of [0, 1, 30]) {
        if (length < (sequence.minItems ?? 0) || length > (sequence.maxItems ?? 30)) continue;
        inputs.push(generateInput(catalog.inputSpec, '声明边界🌱', length).values);
        const values = structuredClone(
          generateInput(catalog.inputSpec, '边界', length).values,
        ) as Record<string, number | number[]>;
        values[sequence.key] = Array.from({ length }, (_, index) =>
          index % 2 ? sequence.max : sequence.min,
        );
        if (catalog.inputSpec.relations.some((relation) => relation.kind === 'nondecreasing'))
          (values[sequence.key] as number[]).sort((left, right) => left - right);
        inputs.push(values);
      }
    } else {
      for (const field of catalog.inputSpec.fields) {
        inputs.push({ ...catalog.program.exampleInput, [field.key]: field.min });
        inputs.push({ ...catalog.program.exampleInput, [field.key]: field.max });
        if (field.min <= 0 && field.max >= 0)
          inputs.push({ ...catalog.program.exampleInput, [field.key]: -0 });
      }
    }
    const template = rustPrepare(catalog, catalog.program.exampleInput);
    for (const values of inputs) {
      const validated = validateInputValues(catalog.inputSpec, values);
      expect(validated.ok).toBe(true);
      if (!validated.ok) throw new Error('Expected valid test input');
      const source = await tryPreparePublishedSource(catalog, values);
      const expected = rustPrepare(catalog, values);
      expect(source).toEqual(expected);
      expect(encoder.encode(canonical(source))).toEqual(encoder.encode(canonical(expected)));
      expect(withoutDeclarations(source!)).toBe(withoutDeclarations(template));
      expect(() =>
        encodeRequest(
          caseRequest(
            catalog,
            source!,
            { contextId: 'prepared-11.4', contextRevision: 1, sourceRevision: 1 },
            { values: validated.values, random: null },
          ),
        ),
      ).not.toThrow();
      if (Array.isArray(values.values) && values.values.length === 0) {
        expect(source!.text).toContain('[1] = {0};');
        expect(source!.text).toContain('int n = 0;');
        expect(values.values).toEqual([]);
      }
      compared++;
    }
  }
  expect(fixed).toBe(24);
  expect(compared).toBeGreaterThan(75);
});

test('all 55 public performance inputs use identical Rust declarations without computing their algorithms', async () => {
  const ascending = Array.from({ length: 30 }, (_, index) => index + 1);
  const mixed = Array.from({ length: 30 }, (_, index) => (index % 2 ? 999 : -999));
  const sortedMixed = [...mixed].sort((left, right) => left - right);
  const extras: { caseId: string; values: InputValues }[] = [
    { caseId: 'case.c.branch', values: { x: 999 } },
    ...['bubble-sort', 'selection-sort'].flatMap((name) =>
      [ascending, Array(30).fill(2), mixed].map((values) => ({
        caseId: `case.c.${name}`,
        values: { values },
      })),
    ),
    ...[
      { values: ascending, target: 1 },
      { values: ascending, target: 15 },
      { values: ascending, target: 0 },
      { values: ascending, target: 31 },
      { values: sortedMixed, target: 999 },
      { values: Array.from({ length: 30 }, (_, index) => index - 30), target: -15 },
    ].map((values) => ({ caseId: 'case.c.binary-search-first', values })),
  ];
  const workloads = [...caseSetSamples, ...extras];
  expect(workloads).toHaveLength(55);
  for (const workload of workloads) {
    const catalog = byId(workload.caseId);
    expect(await tryPreparePublishedSource(catalog, workload.values)).toEqual(
      rustPrepare(catalog, workload.values),
    );
  }
});

test('unpublished contract catalogs, custom harness programs and any changed catalog identity fall back to Rust', async () => {
  for (const subject of fixture.cases) {
    const program = fixture.programs.find((item) => item.id === subject.programRef.id)!;
    const catalog = {
      packageRef: { id: fixture.packageId, version: fixture.packageVersion },
      subject,
      program,
      inputSpec: fixture.inputSpecs.find((item) => item.id === program.inputRef.id)!,
    };
    expect(await tryPreparePublishedSource(catalog, program.exampleInput)).toBeNull();
  }
  const base = byId('case.c.assignment');
  const mutations: ((catalog: ExecutionCatalog) => void)[] = [
    (catalog) => {
      catalog.packageRef = { ...catalog.packageRef, version: '1.0.0' };
    },
    (catalog) => {
      catalog.subject = { ...catalog.subject, title: 'changed published title' };
    },
    (catalog) => {
      catalog.program = {
        ...catalog.program,
        sourceExample: catalog.program.sourceExample + '// custom harness program\n',
      };
    },
    (catalog) => {
      catalog.program = { ...catalog.program, version: '1.0.1' };
    },
    (catalog) => {
      catalog.inputSpec = { ...catalog.inputSpec, title: 'changed input spec' };
    },
    (catalog) => {
      Object.defineProperty(catalog, 'unhashed', { value: true });
    },
    (catalog) => {
      Object.assign(catalog, { extra: undefined });
    },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(base);
    mutate(changed);
    expect(await tryPreparePublishedSource(changed, changed.program.exampleInput)).toBeNull();
  }
  const exercise = structuredClone(byId('exercise.c.echo'));
  exercise.judgeProfile = { ...exercise.judgeProfile!, title: 'changed judge' };
  expect(await tryPreparePublishedSource(exercise, exercise.program.exampleInput)).toBeNull();
});

test('matched declarations reject invalid input rather than silently repairing or clipping it', async () => {
  const scalar = byId('case.c.assignment');
  for (const values of [{ x: 1000 }, { x: 0.5 }, { x: NaN }, { x: 0, extra: 0 }, {}, { x: '1' }])
    await expect(tryPreparePublishedSource(scalar, values as InputValues)).rejects.toThrow(
      'E_INPUT_INVALID',
    );
  const sorting = byId('case.c.bubble-sort');
  const invalidArrays: InputValues[] = [
    { values: Array(31).fill(0) },
    { values: [1000] },
    { values: [1], n: 1 },
  ];
  for (const values of invalidArrays)
    await expect(tryPreparePublishedSource(sorting, values)).rejects.toThrow('E_INPUT_INVALID');
  await expect(
    tryPreparePublishedSource(byId('case.c.binary-search-first'), { values: [2, 1], target: 1 }),
  ).rejects.toThrow('E_INPUT_INVALID');
});

test('Unicode and CRLF trusted library templates preserve every nondeclaration byte and match Rust', async () => {
  const catalog = structuredClone(byId('case.c.bubble-sort'));
  catalog.program = {
    ...catalog.program,
    sourceExample: '// 教学🌱\r\n' + catalog.program.sourceExample.replace(/\n/g, '\r\n'),
  };
  // This test-only manifest simulates a future reviewed library publication.
  // The production manifest remains limited to the actual 13 publications.
  const entry = entryFor(catalog);
  const manifest: PreparedSourceManifest = {
    preparationVersion: '1.0.0',
    protocolVersion: '1.0.0',
    entries: [entry],
  };
  await withManifest(manifest, async (prepare) => {
    for (const values of [
      { values: [] },
      { values: [-999] },
      { values: Array.from({ length: 30 }, (_, index) => (index % 2 ? 999 : -999)) },
    ]) {
      const source = await prepare(catalog, values);
      expect(source).toEqual(rustPrepare(catalog, values));
      expect(withoutDeclarations(source!)).toBe(withoutDeclarations(entry.template));
      expect(source!.text.startsWith('// 教学🌱\r\n')).toBe(true);
    }
  });
});

test('stale hashes, altered declaration ranges and malformed metadata safely miss the static path', async () => {
  const catalog = byId('case.c.assignment');
  const mutations: ((entry: PreparedSourceEntry) => PreparedSourceEntry)[] = [
    (entry) => ({ ...entry, catalogSha256: '0'.repeat(64) }),
    (entry) => ({ ...entry, sourceSha256: '0'.repeat(64) }),
    (entry) => ({ ...entry, templateSha256: '0'.repeat(64) }),
    (entry) => {
      entry.template.bindingMap[0]!.byteRange.end--;
      return entry;
    },
    (entry) => {
      entry.template.bindingMap[0]!.byteRange.end--;
      return { ...entry, templateSha256: sha(canonical(entry.template)) };
    },
    (entry) => {
      entry.template.bindingMap[0]!.bindingKey = 'missing';
      return { ...entry, templateSha256: sha(canonical(entry.template)) };
    },
  ];
  for (const mutate of mutations) {
    const entry = mutate(structuredClone(entryFor(catalog)));
    await withManifest(
      { preparationVersion: '1.0.0', protocolVersion: '1.0.0', entries: [entry] },
      async (prepare) => {
        expect(await prepare(catalog, { x: -999 })).toBeNull();
      },
    );
  }
});

test('cancellation during hashing stops the local source and published preparation never loads the execution Module', async () => {
  const catalog = byId('case.c.assignment');
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  let started = false;
  let cancelled = false;
  const spy = vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, data) => {
    started = true;
    await pending;
    return digest(algorithm, data);
  });
  try {
    const source = tryPreparePublishedSource(catalog, { x: -999 }, () => {
      if (cancelled) throw new Error('E_CANCELLED');
    });
    expect(started).toBe(true);
    cancelled = true;
    release();
    await expect(source).rejects.toThrow('E_CANCELLED');
  } finally {
    release();
    spy.mockRestore();
  }
  const fetcher = vi.fn<typeof fetch>(() => {
    throw new Error('Execution WASM must remain cold');
  });
  const compile = vi.fn<typeof WebAssembly.compile>(() => {
    throw new Error('Execution WASM must remain cold');
  });
  const createWorker = vi.fn(() => {
    throw new Error('No prepare Worker');
  });
  const client = new ExecutionClient({ fetcher, compile, createWorker });
  try {
    expect(await client.prepare(catalog, { x: -999 })).toEqual(rustPrepare(catalog, { x: -999 }));
    expect(client.inspect()).toEqual({ state: 'idle', activeWorkers: 0, cachedModules: 0 });
    expect(fetcher).not.toHaveBeenCalled();
    expect(compile).not.toHaveBeenCalled();
    expect(createWorker).not.toHaveBeenCalled();
  } finally {
    client.invalidate();
  }
});

test('catalog and actual input arrays are snapshotted before the first asynchronous hash', async () => {
  const catalog = structuredClone(byId('case.c.bubble-sort'));
  const originalCatalog = structuredClone(catalog);
  const values = { values: [3, -999, 3] };
  const originalValues = structuredClone(values);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  const spy = vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, data) => {
    await pending;
    return digest(algorithm, data);
  });
  try {
    const source = tryPreparePublishedSource(catalog, values);
    values.values.splice(0, 3, 999);
    catalog.program = { ...catalog.program, sourceExample: 'changed after trigger' };
    release();
    expect(await source).toEqual(rustPrepare(originalCatalog, originalValues));
  } finally {
    release();
    spy.mockRestore();
  }
});

test('the expanded registry adds exactly 39 precise catalogs while retaining all 13 legacy entries', () => {
  const entries = preparedSourceManifest.entries.filter(
    (entry) => entry.packageRef.id === 'content.c.p05',
  );
  expect(entries).toHaveLength(39);
  expect(expandedCatalogs).toHaveLength(39);
  expect(preparedSourceManifest.entries).toHaveLength(52);
  expect(new Set(preparedSourceManifest.entries.map((entry) => entry.programRef.id)).size).toBe(36);
  expect(new Set(entries.map((entry) => entry.catalogSha256))).toEqual(
    new Set(expandedCatalogs.map((catalog) => sha(canonical(catalog)))),
  );
  expect(expandedCatalogs.filter((entry) => entry.subject.id.startsWith('case.'))).toHaveLength(7);
  expect(expanded.exercises.reduce((sum, entry) => sum + entry.tests.length, 0)).toBe(140);
});

test.each(expandedCatalogs.map((catalog) => [catalog.subject.id, catalog] as const))(
  'expanded %s declarations, fixed inputs and boundaries match the real Rust producer',
  async (_id, catalog) => {
    const entry = preparedSourceManifest.entries.find(
      (item) => item.catalogSha256 === sha(canonical(catalog)),
    );
    expect(entry).toEqual(entryFor(catalog));
    const inputs: InputValues[] = [catalog.program.exampleInput];
    if ('tests' in catalog.subject) inputs.push(...catalog.subject.tests.map((test) => test.input));
    const sequence = catalog.inputSpec.fields.find((field) => field.kind === 'sequence');
    if (sequence) {
      for (const length of [0, 1, 30]) {
        if (length < (sequence.minItems ?? 0) || length > (sequence.maxItems ?? 30)) continue;
        inputs.push(generateInput(catalog.inputSpec, 'P05声明范围🌱', length).values);
      }
    } else {
      for (const field of catalog.inputSpec.fields) {
        inputs.push({ ...catalog.program.exampleInput, [field.key]: field.min });
        inputs.push({ ...catalog.program.exampleInput, [field.key]: field.max });
      }
    }
    for (const values of inputs) {
      expect(validateInputValues(catalog.inputSpec, values).ok).toBe(true);
      const result = await tryPreparePublishedSource(catalog, values);
      const expected = rustPrepare(catalog, values);
      expect(result).not.toBeNull();
      expect(result).toEqual(expected);
      expect(encoder.encode(canonical(result))).toEqual(encoder.encode(canonical(expected)));
      expect(withoutDeclarations(result!)).toBe(withoutDeclarations(entry!.template));
    }
    if ('tests' in catalog.subject) {
      const exercise = exerciseCatalog(expandedPractice, catalog.subject.id);
      const source = await tryPreparePublishedSource(catalog, catalog.subject.tests[0].input);
      const request = exerciseRequest(
        exercise,
        source!,
        {
          contextId: 'prepared.p05',
          contextRevision: 1,
          sourceRevision: 1,
        },
        'prepared.p05.submission',
        catalog.subject.tests[0],
      );
      expect(() => encodeRequest(request)).not.toThrow();
    }
  },
);

test.each(['first-output', 'partial-array-init'])(
  'expanded %s declarations remain genuinely empty and reject undeclared input',
  async (suffix) => {
    const catalog = exerciseCatalog(expandedPractice, `exercise.c.${suffix}`);
    expect(catalog.inputSpec.fields).toEqual([]);
    expect(catalog.inputSpec.relations).toEqual([]);
    expect(catalog.program.bindings).toEqual([]);
    const prepared = await tryPreparePublishedSource(catalog, {});
    expect(prepared).toEqual(rustPrepare(catalog, {}));
    expect(prepared!.bindingMap).toEqual([]);
    expect(prepared!.text).toBe(catalog.program.sourceExample);
    await expect(tryPreparePublishedSource(catalog, { x: 1 })).rejects.toThrow('E_INPUT_INVALID');
  },
);

test('all 39 expanded static preparations leave the product execution Module and workers cold', async () => {
  const fetcher = vi.fn<typeof fetch>(() => {
    throw new Error('No execution fetch for static preparation');
  });
  const compile = vi.fn<typeof WebAssembly.compile>(() => {
    throw new Error('No execution compile for static preparation');
  });
  const createWorker = vi.fn(() => {
    throw new Error('No preparation worker');
  });
  const client = new ExecutionClient({ fetcher, compile, createWorker });
  try {
    for (const catalog of expandedCatalogs) {
      const prepared = await client
        .prepare(catalog, catalog.program.exampleInput)
        .catch((error: unknown) => {
          throw new Error(`${catalog.subject.id}: product preparation failed`, { cause: error });
        });
      expect(prepared).toEqual(rustPrepare(catalog, catalog.program.exampleInput));
    }
    expect(client.inspect()).toEqual({ state: 'idle', activeWorkers: 0, cachedModules: 0 });
    expect(fetcher).not.toHaveBeenCalled();
    expect(compile).not.toHaveBeenCalled();
    expect(createWorker).not.toHaveBeenCalled();
  } finally {
    client.invalidate();
  }
});

test.each(['first-output', 'partial-array-init'])(
  'ExecutionClient prepares reviewed zero-input %s without a Module or worker',
  async (suffix) => {
    const catalog = exerciseCatalog(expandedPractice, `exercise.c.${suffix}`);
    const fetcher = vi.fn<typeof fetch>(() => {
      throw new Error('No execution fetch');
    });
    const compile = vi.fn<typeof WebAssembly.compile>(() => {
      throw new Error('No execution compile');
    });
    const createWorker = vi.fn(() => {
      throw new Error('No preparation worker');
    });
    const client = new ExecutionClient({ fetcher, compile, createWorker });
    try {
      const prepared = await client.prepare(catalog, {});
      expect(prepared).toEqual(rustPrepare(catalog, {}));
      expect(prepared.bindingMap).toEqual([]);
      expect(client.inspect()).toEqual({ state: 'idle', activeWorkers: 0, cachedModules: 0 });
      await expect(client.prepare(catalog, { x: 1 })).rejects.toThrow('E_INPUT_INVALID');
      expect(fetcher).not.toHaveBeenCalled();
      expect(compile).not.toHaveBeenCalled();
      expect(createWorker).not.toHaveBeenCalled();
      for (const mutate of [
        (value: ExecutionCatalog) => {
          value.program = { ...value.program, id: 'program.c.practice-other' };
        },
        (value: ExecutionCatalog) => {
          value.judgeProfile = { ...value.judgeProfile!, id: 'judge.c.other' };
        },
        (value: ExecutionCatalog) => {
          value.inputSpec = { ...value.inputSpec, id: 'input.c.other' };
        },
      ]) {
        const forged = structuredClone(catalog);
        mutate(forged);
        expect(await tryPreparePublishedSource(forged, {})).toBeNull();
      }
    } finally {
      client.invalidate();
    }
  },
);
