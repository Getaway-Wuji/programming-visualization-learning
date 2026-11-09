import { mysqlEvents, mysqlFeatures } from '../../../shared/contracts/mysql-execution.mjs';
import {
  initialMysqlState,
  createMysqlStateValidator,
  mysqlAssert,
  mysqlEqual,
  mysqlJsonBytes,
} from './mysql-data';
import type {
  MysqlNode,
  MysqlReplay,
  MysqlSession,
  MysqlState,
  MysqlStep,
  MysqlTrace,
} from './mysql-types';
export { mysqlAssert, mysqlEqual } from './mysql-data';

export function projectMysqlStep(state: MysqlState, step: MysqlStep, forward = true): MysqlState {
  const next = { ...state };
  const components = new Set<string>();
  for (const change of step.changes) {
    mysqlAssert(
      ['session', 'result', 'control'].includes(change.component) &&
        !components.has(change.component),
    );
    components.add(change.component);
    mysqlAssert(mysqlEqual(state[change.component], forward ? change.before : change.after));
    Object.assign(next, { [change.component]: forward ? change.after : change.before });
  }
  return next;
}
const writes = new Set(['create', 'drop', 'truncate', 'insert', 'update', 'delete']);
const transactions = new Set(['begin', 'commit', 'rollback']);
function writeTransition(before: MysqlState, after: MysqlState, event: string) {
  const first = before.session.database,
    second = after.session.database;
  const oldTables = new Map(first.tables.map((table) => [table.name, table]));
  const newTables = new Map(second.tables.map((table) => [table.name, table]));
  const added = second.tables.filter((table) => !oldTables.has(table.name));
  const removed = first.tables.filter((table) => !newTables.has(table.name));
  const changed = first.tables.filter(
    (table) => newTables.has(table.name) && !mysqlEqual(table, newTables.get(table.name)),
  );
  if (event === 'create') {
    mysqlAssert(
      !removed.length &&
        !changed.length &&
        added.length <= 1 &&
        added.every((table) => !table.rows.length),
    );
    mysqlAssert(second.nextRowId === first.nextRowId);
    return;
  }
  if (event === 'drop') {
    mysqlAssert(
      !added.length &&
        !changed.length &&
        removed.length <= 1 &&
        second.nextRowId === first.nextRowId,
    );
    return;
  }
  mysqlAssert(!added.length && !removed.length && changed.length <= 1);
  mysqlAssert(
    mysqlEqual(
      first.tables.map((table) => ({ name: table.name, columns: table.columns })),
      second.tables.map((table) => ({ name: table.name, columns: table.columns })),
    ),
  );
  let affected = 0,
    allocated = 0;
  for (const table of changed) {
    const next = newTables.get(table.name)!;
    if (event === 'insert') {
      mysqlAssert(
        next.rows.length >= table.rows.length &&
          mysqlEqual(next.rows.slice(0, table.rows.length), table.rows),
      );
      const inserted = next.rows.slice(table.rows.length);
      inserted.forEach((row, index) => mysqlAssert(row.id === first.nextRowId + index));
      allocated = inserted.length;
      affected = inserted.length;
    } else if (event === 'update') {
      mysqlAssert(
        mysqlEqual(
          table.rows.map((row) => row.id),
          next.rows.map((row) => row.id),
        ),
      );
      affected = table.rows.filter((row, index) => !mysqlEqual(row, next.rows[index])).length;
      mysqlAssert(after.result.matchedRows <= table.rows.length);
    } else {
      const retained = new Set(next.rows.map((row) => row.id));
      mysqlAssert(
        mysqlEqual(
          table.rows.filter((row) => retained.has(row.id)),
          next.rows,
        ),
      );
      if (event === 'truncate') mysqlAssert(!next.rows.length);
      affected = table.rows.length - next.rows.length;
    }
    const target = after.control.table ?? before.control.table;
    if (target !== null) mysqlAssert(target.toLowerCase() === table.name.toLowerCase());
  }
  mysqlAssert(second.nextRowId === first.nextRowId + allocated);
  if (event !== 'truncate') mysqlAssert(after.result.affectedRows === affected);
}
function transition(before: MysqlState, after: MysqlState, step: MysqlStep, node: MysqlNode) {
  mysqlAssert(after.control.statement === node.id);
  if (step.event === 'statement')
    mysqlAssert(after.control.phase === 'statement' && mysqlEqual(before.result, after.result));
  else if (step.event === 'done')
    mysqlAssert(node.kind === 'select' && after.control.phase === 'done');
  else if (!writes.has(step.event) && !transactions.has(step.event)) {
    mysqlAssert(after.control.phase === step.event);
    mysqlAssert(
      ['scan', 'filter'].includes(step.event)
        ? ['select', 'update', 'delete'].includes(node.kind)
        : node.kind === 'select',
    );
  }
  const sessionChanged = !mysqlEqual(before.session, after.session);
  if (writes.has(step.event)) {
    mysqlAssert(step.event === node.kind && after.control.phase === 'done');
    mysqlAssert(
      after.result.kind ===
        (['insert', 'update', 'delete'].includes(step.event) ? 'mutation' : 'ddl'),
    );
    mysqlAssert(mysqlEqual(before.session.transaction, after.session.transaction));
    mysqlAssert(after.session.database.nextRowId >= before.session.database.nextRowId);
    if (['create', 'drop', 'truncate'].includes(step.event))
      mysqlAssert(!before.session.transaction.active);
    if (['delete', 'truncate'].includes(step.event)) mysqlAssert(after.control.rowIds.length === 0);
    if (step.event === 'drop')
      mysqlAssert(after.control.table === null && after.control.rowIds.length === 0);
    if (step.event === 'update') mysqlAssert(after.result.affectedRows <= after.result.matchedRows);
    else if (after.result.kind === 'mutation') mysqlAssert(after.result.matchedRows === 0);
    writeTransition(before, after, step.event);
  } else if (transactions.has(step.event)) {
    mysqlAssert(
      step.event === node.kind &&
        after.control.phase === 'done' &&
        after.result.kind === 'transaction',
    );
    const first = before.session,
      second = after.session;
    if (step.event === 'begin')
      mysqlAssert(
        !first.transaction.active &&
          second.transaction.active &&
          mysqlEqual(second.database, first.database) &&
          mysqlEqual(second.transaction.base, first.database),
      );
    else {
      mysqlAssert(!second.transaction.active);
      mysqlAssert(
        mysqlEqual(
          second.database,
          step.event === 'rollback' && first.transaction.active
            ? first.transaction.base
            : first.database,
        ),
      );
    }
  } else mysqlAssert(!sessionChanged);
  if (!writes.has(step.event) && !transactions.has(step.event) && node.kind !== 'select')
    mysqlAssert(mysqlEqual(before.result, after.result));
  if (node.kind === 'select' && after.control.phase === 'done')
    mysqlAssert(after.result.kind === 'query');
}
export function* verifyMysqlTrace(
  trace: MysqlTrace,
  nodes: ReadonlyMap<number, MysqlNode>,
  session: MysqlSession,
  features: readonly string[] = [],
) {
  mysqlAssert(mysqlEqual(trace.initialState, initialMysqlState(session)));
  mysqlAssert(
    trace.steps.length <= 2048 &&
      trace.checkpoints.length === Math.floor(trace.steps.length / 128) + 1,
  );
  mysqlAssert(
    new Set(features).size === features.length &&
      features.every((feature) => mysqlFeatures.includes(feature)),
  );
  const ids = new Set(nodes.keys()),
    events = new Set<string>(),
    evidence = new Set<string>();
  const validateState = createMysqlStateValidator(ids);
  let state = trace.initialState,
    peak = validateState(state),
    statement = 0;
  let statementSession = state.session;
  let episodeWritten = false,
    rolledBackWrite = false;
  for (let cursor = 0; cursor <= trace.steps.length; cursor++) {
    if (cursor % 128 === 0) {
      const checkpoint = trace.checkpoints[cursor / 128];
      mysqlAssert(checkpoint.cursor === cursor && mysqlEqual(checkpoint.state, state));
    }
    if (cursor === trace.steps.length) break;
    const step = trace.steps[cursor],
      node = nodes.get(step.nodeId);
    mysqlAssert(step.seq === cursor + 1 && node && mysqlEvents.includes(step.event));
    if (step.event === 'statement') {
      mysqlAssert(
        step.nodeId === statement + 1 && (statement === 0 || state.control.phase === 'done'),
      );
      statement = step.nodeId;
      statementSession = state.session;
    } else mysqlAssert(statement === step.nodeId && state.control.phase !== 'done');
    const next = projectMysqlStep(state, step);
    peak = Math.max(peak, validateState(next));
    transition(state, next, step, node);
    mysqlAssert(mysqlEqual(projectMysqlStep(next, step, false), state));
    const wrote =
      state.session.transaction.active &&
      !mysqlEqual(state.session.database, next.session.database) &&
      ['insert', 'update', 'delete'].includes(step.event);
    if (step.event === 'rollback' && state.session.transaction.active && episodeWritten)
      rolledBackWrite = true;
    if (['begin', 'commit', 'rollback'].includes(step.event)) episodeWritten = false;
    if (wrote) {
      episodeWritten = true;
      evidence.add('transaction-write');
    }
    events.add(step.event);
    if (node.kind === 'select') evidence.add('select');
    state = next;
    if (cursor % 16 === 0) yield;
  }
  if (trace.completeness === 'complete')
    mysqlAssert(statement === nodes.size && (nodes.size === 0 || state.control.phase === 'done'));
  else if (statement > 0 && state.control.phase !== 'done')
    mysqlAssert(mysqlEqual(state.session, statementSession));
  const featureEvents: Record<string, string[]> = {
    projection: ['project'],
    filter: ['filter'],
    distinct: ['distinct'],
    order: ['order'],
    limit: ['limit'],
    group: ['group'],
    aggregate: ['group', 'project'],
    'inner-join': ['join'],
    'left-join': ['join'],
    create: ['create'],
    insert: ['insert'],
    update: ['update'],
    delete: ['delete'],
    begin: ['begin'],
    commit: ['commit'],
    rollback: ['rollback'],
  };
  for (const feature of features)
    mysqlAssert(
      evidence.has(feature) || featureEvents[feature]?.some((event) => events.has(event)),
    );
  const replayBytes = mysqlJsonBytes(trace);
  mysqlAssert(replayBytes <= 8388608);
  // Reconstruct the complete reverse chain, including all checkpoints, independently.
  let reversed = state;
  for (let cursor = trace.steps.length; cursor > 0; cursor--) {
    reversed = projectMysqlStep(reversed, trace.steps[cursor - 1], false);
    if ((cursor - 1) % 128 === 0)
      mysqlAssert(mysqlEqual(reversed, trace.checkpoints[(cursor - 1) / 128].state));
    if (cursor % 32 === 0) yield;
  }
  mysqlAssert(mysqlEqual(reversed, trace.initialState));
  return {
    state,
    steps: trace.steps.length,
    databaseBytes: peak,
    replayBytes,
    evidence: { rolledBackWrite },
  };
}

export class MysqlPlayer {
  private position = 0;
  private current: MysqlState;
  private playing = false;
  constructor(private readonly replay: MysqlReplay) {
    this.current = structuredClone(replay.trace.initialState);
  }
  get cursor() {
    return this.position;
  }
  get length() {
    return this.replay.trace.steps.length;
  }
  get state() {
    return structuredClone(this.current);
  }
  snapshot() {
    return this.state;
  }
  play() {
    this.playing = this.position < this.length;
  }
  pause() {
    this.playing = false;
  }
  get isPlaying() {
    return this.playing;
  }
  tick(steps = 1) {
    mysqlAssert(Number.isInteger(steps) && steps >= 0 && steps <= 2048);
    if (this.playing) this.seek(Math.min(this.length, this.position + steps));
    if (this.position === this.length) this.playing = false;
    return this.state;
  }
  seek(cursor: number) {
    mysqlAssert(Number.isInteger(cursor) && cursor >= 0 && cursor <= this.length);
    const checkpoint = this.replay.trace.checkpoints[Math.floor(cursor / 128)];
    if (checkpoint && Math.abs(cursor - this.position) > cursor - checkpoint.cursor) {
      this.current = structuredClone(checkpoint.state);
      this.position = checkpoint.cursor;
    }
    while (this.position < cursor) {
      this.current = projectMysqlStep(this.current, this.replay.trace.steps[this.position]);
      this.position++;
    }
    while (this.position > cursor) {
      this.position--;
      this.current = projectMysqlStep(this.current, this.replay.trace.steps[this.position], false);
    }
    return this.state;
  }
}
