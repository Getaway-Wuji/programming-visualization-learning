import { expect, test } from 'vitest';
import {
  canonicalMysqlJson,
  defaultMysqlSession,
  initialMysqlState,
  mysqlCaseReason,
  mysqlProfile,
  validateMysqlSession,
  validateMysqlState,
  createMysqlStateValidator,
} from '../../web/src/engine/mysql-data';
import { MysqlPlayer, projectMysqlStep, verifyMysqlTrace } from '../../web/src/engine/mysql-player';
import type {
  MysqlNode,
  MysqlReplay,
  MysqlSession,
  MysqlState,
  MysqlTrace,
  MysqlChange,
} from '../../web/src/engine/mysql-types';

const empty = (): MysqlSession => ({
  database: { tables: [], nextRowId: 1 },
  transaction: { active: false, base: null },
});
function consume<T>(iterator: Generator<void, T, unknown>) {
  while (true) {
    const next = iterator.next();
    if (next.done) return next.value;
  }
}
function queryTrace(): { trace: MysqlTrace; nodes: Map<number, MysqlNode>; session: MysqlSession } {
  const session = empty(),
    initial = initialMysqlState(session),
    started: MysqlState = {
      ...initial,
      control: { statement: 1, phase: 'statement', table: null, rowIds: [] },
    };
  const projected: MysqlState = {
    ...started,
    result: {
      kind: 'query',
      columns: ['1'],
      rows: [[{ kind: 'int', value: 1 }]],
      affectedRows: 0,
      matchedRows: 0,
    },
    control: { ...started.control, phase: 'project' },
  };
  const done = { ...projected, control: { ...projected.control, phase: 'done' as const } };
  const states = [initial, started, projected, done];
  const trace: MysqlTrace = {
    initialState: initial,
    checkpoints: [{ cursor: 0, state: initial }],
    completeness: 'complete',
    steps: states.slice(1).map((after, i) => ({
      seq: i + 1,
      nodeId: 1,
      event: ['statement', 'project', 'done'][i],
      changes: [
        ...(i === 1
          ? [{ component: 'result' as const, before: states[i].result, after: after.result }]
          : []),
        { component: 'control' as const, before: states[i].control, after: after.control },
      ],
    })),
  };
  return {
    trace,
    nodes: new Map([[1, { id: 1, kind: 'select', byteRange: { start: 0, end: 8 } }]]),
    session,
  };
}
test('SQL graph validates complete keys, INT32 storage, logical identities, NULL-aware uniqueness and defaults', () => {
  const session = defaultMysqlSession();
  expect(() => validateMysqlSession(session)).not.toThrow();
  const changes: ((s: MysqlSession) => void)[] = [
    (s) => {
      s.database.tables[0].rows[0].id = s.database.tables[1].rows[0].id;
    },
    (s) => {
      s.database.tables[0].rows[0].values[0] = { kind: 'int', value: 2147483648 };
    },
    (s) => {
      s.database.tables[0].rows[0].values[0] = { kind: 'decimal', value: '1' };
    },
    (s) => {
      s.database.tables[0].rows[0].values[0] = { kind: 'null' };
    },
    (s) => {
      s.database.tables[0].rows[0].values[0] = s.database.tables[0].rows[1].values[0];
    },
    (s) => {
      s.database.tables[0].columns[0].defaultValue = { kind: 'text', value: '1' };
    },
    (s) => {
      s.database.tables[0].name = '中文';
    },
    (s) => {
      Object.assign(s.database, { extra: true });
    },
  ];
  for (const change of changes) {
    const bad = structuredClone(session);
    change(bad);
    expect(() => validateMysqlSession(bad)).toThrow('E_PROTOCOL_INVALID');
  }
  const nullable = session.database.tables[0].columns[2];
  nullable.unique = true;
  session.database.tables[0].rows.forEach((row) => {
    row.values[2] = { kind: 'null' };
  });
  expect(() => validateMysqlSession(session)).not.toThrow();
});
test('transaction schema, unicode scalar lengths, live row targets and decimal precision are checked', () => {
  const session = defaultMysqlSession();
  session.transaction = { active: true, base: structuredClone(session.database) };
  expect(() => validateMysqlSession(session)).not.toThrow();
  session.database.tables[0].columns[0].name = 'changed';
  expect(() => validateMysqlSession(session)).toThrow();
  const state = initialMysqlState(empty());
  state.result = {
    kind: 'query',
    columns: ['avg'],
    rows: [[{ kind: 'decimal', value: '-0.0000' }]],
    affectedRows: 0,
    matchedRows: 0,
  };
  expect(() => validateMysqlState(state)).toThrow();
  state.result.rows[0][0] = { kind: 'decimal', value: '0.0313' };
  expect(() => validateMysqlState(state)).not.toThrow();
  state.control = { statement: 1, phase: 'scan', table: 'missing', rowIds: [1] };
  expect(() => validateMysqlState(state)).toThrow();
  expect(() => canonicalMysqlJson({ value: '\ud800' })).toThrow();
});
test('trace verifies every before, checkpoint, event and full forward/reverse reconstruction', () => {
  const { trace, nodes, session } = queryTrace();
  const result = consume(verifyMysqlTrace(trace, nodes, session, ['select', 'projection']));
  expect(result.state.result.rows).toEqual([[{ kind: 'int', value: 1 }]]);
  const replay: MysqlReplay = {
    trace,
    features: ['select', 'projection'],
    terminal: { status: 'completed', diagnostic: null, cursor: trace.steps.length },
  };
  const player = new MysqlPlayer(replay);
  expect(player.seek(3)).toEqual(result.state);
  expect(player.seek(0)).toEqual(trace.initialState);
  player.play();
  player.tick(1);
  player.pause();
  const cursor = player.cursor;
  player.tick();
  expect(player.cursor).toBe(cursor);
  const copy = player.snapshot();
  copy.result.columns.push('external');
  expect(player.snapshot().result.columns).toEqual([]);
  for (const mutate of [
    (t: MysqlTrace) => {
      t.steps[1].seq = 3;
    },
    (t: MysqlTrace) => {
      t.steps[1].changes[0].before = {
        kind: 'query',
        columns: [],
        rows: [],
        affectedRows: 0,
        matchedRows: 0,
      };
    },
    (t: MysqlTrace) => {
      t.checkpoints[0].cursor = 1;
    },
    (t: MysqlTrace) => {
      t.steps[1].nodeId = 2;
    },
  ]) {
    const bad = structuredClone(trace);
    mutate(bad);
    expect(() => consume(verifyMysqlTrace(bad, nodes, session))).toThrow();
  }
  expect(() => consume(verifyMysqlTrace(trace, nodes, session, ['transaction-write']))).toThrow();
});
test('writes cannot publish a partial database or a stale deleted row target', () => {
  const session = defaultMysqlSession(),
    state = initialMysqlState(session),
    trace: MysqlTrace = {
      initialState: state,
      checkpoints: [{ cursor: 0, state }],
      completeness: 'prefix',
      steps: [],
    };
  const started = { ...state.control, statement: 1, phase: 'statement' as const };
  trace.steps.push({
    seq: 1,
    nodeId: 1,
    event: 'statement',
    changes: [{ component: 'control', before: state.control, after: started }],
  });
  const changed = structuredClone(session);
  changed.database.tables[0].rows = [];
  trace.steps.push({
    seq: 2,
    nodeId: 1,
    event: 'scan',
    changes: [{ component: 'session', before: session, after: changed }],
  });
  expect(() =>
    consume(
      verifyMysqlTrace(
        trace,
        new Map([[1, { id: 1, kind: 'delete', byteRange: { start: 0, end: 1 } }]]),
        session,
      ),
    ),
  ).toThrow();
});

test('checkpoint 128 matches the same state in both seek directions and is mandatory', () => {
  const { trace, nodes, session } = queryTrace();
  const statement = trace.steps[0],
    final = trace.steps[2];
  const started = projectMysqlStep(trace.initialState, statement).control;
  const scanned = { ...started, phase: 'scan' as const };
  const scan = {
    seq: 2,
    nodeId: 1,
    event: 'scan',
    changes: [
      {
        component: 'control' as const,
        before: started,
        after: scanned,
      },
    ],
  };
  const steps = [
    statement,
    scan,
    ...Array.from({ length: 127 }, (_, index) => ({
      seq: index + 3,
      nodeId: 1,
      event: 'scan',
      changes: [],
    })),
    {
      ...trace.steps[1],
      seq: 130,
      changes: trace.steps[1].changes.map((change) =>
        change.component === 'control' ? { ...change, before: scanned } : change,
      ),
    },
    { ...final, seq: 131 },
  ];
  trace.steps = steps;
  let state = trace.initialState;
  for (const step of steps.slice(0, 128)) state = projectMysqlStep(state, step);
  trace.checkpoints.push({ cursor: 128, state });
  expect(consume(verifyMysqlTrace(trace, nodes, session)).steps).toBe(131);
  const player = new MysqlPlayer({
    trace,
    features: [],
    terminal: { status: 'completed', diagnostic: null, cursor: 131 },
  });
  player.seek(131);
  expect(player.seek(128)).toEqual(state);
  expect(player.seek(0)).toEqual(trace.initialState);
  trace.checkpoints.pop();
  expect(() => consume(verifyMysqlTrace(trace, nodes, session))).toThrow();
});

test('a statement marker cannot impersonate the atomic completion of a write or transaction', () => {
  for (const kind of ['select', 'create', 'insert', 'begin']) {
    const session = empty(),
      initial = initialMysqlState(session);
    const trace: MysqlTrace = {
      initialState: initial,
      completeness: 'complete',
      checkpoints: [{ cursor: 0, state: initial }],
      steps: [
        {
          seq: 1,
          nodeId: 1,
          event: 'statement',
          changes: [
            {
              component: 'control',
              before: initial.control,
              after: { statement: 1, phase: 'done', table: null, rowIds: [] },
            },
          ],
        },
      ],
    };
    expect(() =>
      consume(
        verifyMysqlTrace(
          trace,
          new Map([[1, { id: 1, kind, byteRange: { start: 0, end: 1 } }]]),
          session,
        ),
      ),
    ).toThrow('E_PROTOCOL_INVALID');
  }
});
test('unordered judging preserves duplicates and protects every other database table', () => {
  const profile = mysqlProfile('mysql.exercise.projection')!,
    expected = structuredClone(profile.cases[0]);
  expected.ordered = false;
  const state = initialMysqlState(expected.session);
  state.result = structuredClone(expected.expectedResult);
  expect(mysqlCaseReason(state, expected.requiredFeatures, expected)).toBe('passed');
  state.result.rows.reverse();
  expect(mysqlCaseReason(state, expected.requiredFeatures, expected)).toBe('passed');
  state.result.rows.push(structuredClone(state.result.rows[0]));
  expect(mysqlCaseReason(state, expected.requiredFeatures, expected)).toBe('wrong-result');
  state.result = structuredClone(expected.expectedResult);
  state.session.database.tables[1].rows = [];
  expect(mysqlCaseReason(state, expected.requiredFeatures, expected)).toBe('wrong-database');
});

test('validated trace evidence associates rollback with this request and the same written transaction', () => {
  const verifyEpisode = (ending: string[], importedActive = false) => {
    const session = defaultMysqlSession();
    if (importedActive)
      session.transaction = { active: true, base: structuredClone(session.database) };
    const initial = initialMysqlState(session),
      trace: MysqlTrace = {
        initialState: initial,
        steps: [],
        checkpoints: [{ cursor: 0, state: initial }],
        completeness: 'complete',
      };
    const nodes = new Map<number, MysqlNode>();
    let state = initial;
    const kinds = importedActive ? ending : ['begin', 'update', 'update', ...ending];
    for (const [index, kind] of kinds.entries()) {
      const nodeId = index + 1;
      nodes.set(nodeId, { id: nodeId, kind, byteRange: { start: index, end: index + 1 } });
      const started: MysqlState = {
        ...state,
        control: { statement: nodeId, phase: 'statement' as const, table: null, rowIds: [] },
      };
      trace.steps.push({
        seq: trace.steps.length + 1,
        nodeId,
        event: 'statement',
        changes: [{ component: 'control', before: state.control, after: started.control }],
      });
      const after = structuredClone(started);
      after.control = {
        statement: nodeId,
        phase: 'done',
        table: kind === 'update' ? 'students' : null,
        rowIds: [],
      };
      if (kind === 'begin')
        after.session.transaction = { active: true, base: structuredClone(after.session.database) };
      else if (kind === 'update') {
        const students = after.session.database.tables[0],
          row = students.rows.find(
            (row) => row.values[0].kind === 'int' && row.values[0].value === 1,
          )!;
        row.values[3] = { kind: 'int', value: index === 1 ? 90 : 88 };
      } else if (kind === 'rollback' && after.session.transaction.active) {
        after.session.database = structuredClone(after.session.transaction.base);
        after.session.transaction = { active: false, base: null };
      } else after.session.transaction = { active: false, base: null };
      after.result = {
        kind: kind === 'update' ? 'mutation' : 'transaction',
        columns: [],
        rows: [],
        affectedRows: kind === 'update' ? 1 : 0,
        matchedRows: kind === 'update' ? 1 : 0,
      };
      const changes: MysqlChange[] = [
        { component: 'session', before: started.session, after: after.session },
        { component: 'result', before: started.result, after: after.result },
        { component: 'control', before: started.control, after: after.control },
      ];
      trace.steps.push({ seq: trace.steps.length + 1, nodeId, event: kind, changes });
      state = after;
    }
    return consume(verifyMysqlTrace(trace, nodes, session)).evidence;
  };
  expect(verifyEpisode(['rollback']).rolledBackWrite).toBe(true);
  expect(verifyEpisode(['commit', 'rollback']).rolledBackWrite).toBe(false);
  expect(verifyEpisode(['commit', 'begin', 'rollback']).rolledBackWrite).toBe(false);
  expect(verifyEpisode(['rollback'], true).rolledBackWrite).toBe(false);
  const expected = mysqlProfile('mysql.exercise.transaction')!.cases[0],
    state = initialMysqlState(expected.session);
  state.result = structuredClone(expected.expectedResult);
  expect(
    mysqlCaseReason(state, expected.requiredFeatures, expected, { rolledBackWrite: false }),
  ).toBe('goal-unmet');
  expect(
    mysqlCaseReason(state, expected.requiredFeatures, expected, { rolledBackWrite: true }),
  ).toBe('passed');
});

test('trace-local immutable-component reuse preserves validation and always checks fresh graphs and control contexts', () => {
  const state = initialMysqlState(defaultMysqlSession());
  const ids = new Set([1]),
    validate = createMysqlStateValidator(ids);
  expect(validate(state)).toBe(validateMysqlState(state, ids));
  expect(Object.isFrozen(state.session.database.tables[0].rows[0].values[0])).toBe(true);
  expect(Object.isFrozen(state.result.rows)).toBe(true);
  expect(() => {
    state.session.database.tables[0].rows[0].values[0] = { kind: 'int', value: 999 };
  }).toThrow();
  const copy = structuredClone(state);
  copy.session.database.tables[0].rows[0].id = copy.session.database.tables[1].rows[0].id;
  Object.freeze(copy.session);
  expect(() => validate(copy)).toThrow('E_PROTOCOL_INVALID');
  const badResult = {
    ...state,
    result: {
      kind: 'query' as const,
      columns: ['one'],
      rows: [[]],
      affectedRows: 0,
      matchedRows: 0,
    },
  };
  Object.freeze(badResult.result);
  expect(() => validate(badResult)).toThrow('E_PROTOCOL_INVALID');
  const scanning = {
    ...state,
    control: {
      statement: 1,
      phase: 'scan' as const,
      table: 'students',
      rowIds: [state.session.database.tables[0].rows[0].id],
    },
  };
  expect(validate(scanning)).toBe(validateMysqlState(scanning, ids));
  const otherContext = createMysqlStateValidator(new Set([2]));
  expect(() => otherContext(scanning)).toThrow('E_PROTOCOL_INVALID');
  const removed = structuredClone(scanning);
  removed.session.database.tables[0].rows.shift();
  expect(() => validate(removed)).toThrow('E_PROTOCOL_INVALID');
  scanning.control.rowIds = [4096];
  expect(() => validate(scanning)).toThrow('E_PROTOCOL_INVALID');
  const externallyShallowFrozen = structuredClone(state);
  Object.freeze(externallyShallowFrozen.session);
  expect(validate(externallyShallowFrozen)).toBe(validateMysqlState(externallyShallowFrozen, ids));
  expect(Object.isFrozen(externallyShallowFrozen.session.database.tables[0].rows)).toBe(true);
});
