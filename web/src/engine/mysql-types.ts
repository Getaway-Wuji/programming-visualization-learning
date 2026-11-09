export interface MysqlRange {
  start: number;
  end: number;
}
export interface MysqlDiagnostic {
  code: string;
  byteRange: MysqlRange;
}
export type MysqlStatus = 'completed' | 'error' | 'limited';
export type MysqlCell =
  { kind: 'null' } | { kind: 'int'; value: number } | { kind: 'text' | 'decimal'; value: string };
export interface MysqlColumn {
  name: string;
  type: 'int' | 'varchar';
  length: number | null;
  nullable: boolean;
  primaryKey: boolean;
  unique: boolean;
  defaultValue: MysqlCell | null;
}
export interface MysqlRow {
  id: number;
  values: MysqlCell[];
}
export interface MysqlTable {
  name: string;
  columns: MysqlColumn[];
  rows: MysqlRow[];
}
export interface MysqlDatabase {
  tables: MysqlTable[];
  nextRowId: number;
}
export type MysqlTransaction =
  { active: false; base: null } | { active: true; base: MysqlDatabase };
export interface MysqlSession {
  database: MysqlDatabase;
  transaction: MysqlTransaction;
}
export interface MysqlResult {
  kind: 'none' | 'query' | 'mutation' | 'ddl' | 'transaction';
  columns: string[];
  rows: MysqlCell[][];
  affectedRows: number;
  matchedRows: number;
}
export interface MysqlControl {
  statement: number | null;
  phase:
    | 'ready'
    | 'statement'
    | 'scan'
    | 'filter'
    | 'join'
    | 'group'
    | 'project'
    | 'distinct'
    | 'order'
    | 'limit'
    | 'write'
    | 'transaction'
    | 'done';
  table: string | null;
  rowIds: number[];
}
export interface MysqlState {
  session: MysqlSession;
  result: MysqlResult;
  control: MysqlControl;
}
export type MysqlChange = {
  [K in keyof MysqlState]: { component: K; before: MysqlState[K]; after: MysqlState[K] };
}[keyof MysqlState];
export interface MysqlNode {
  id: number;
  kind: string;
  byteRange: MysqlRange;
}
export interface MysqlStep {
  seq: number;
  nodeId: number;
  event: string;
  changes: MysqlChange[];
}
export interface MysqlTrace {
  initialState: MysqlState;
  steps: MysqlStep[];
  checkpoints: { cursor: number; state: MysqlState }[];
  completeness: 'complete' | 'prefix';
}
export interface MysqlReplay {
  terminal: { status: MysqlStatus; diagnostic: MysqlDiagnostic | null; cursor: number };
  trace: MysqlTrace;
  features: string[];
}
export type MysqlOperation =
  | { operation: 'execute'; session: MysqlSession }
  | { operation: 'judge'; profile: string; reviewCase: number };
export type MysqlRequest = MysqlOperation & {
  version: '1.0.0';
  language: 'mysql';
  dialect: '8.0';
  runId: string;
  sourceRevision: string;
  source: string;
};
export interface MysqlCaseResult {
  index: number;
  status: MysqlStatus;
  passed: boolean;
  reason: 'passed' | 'wrong-result' | 'wrong-database' | 'goal-unmet' | 'program-error' | 'limited';
  diagnostic: MysqlDiagnostic | null;
}
export interface MysqlResponse {
  version: '1.0.0';
  language: 'mysql';
  dialect: '8.0';
  operation: MysqlOperation['operation'];
  buildId: string;
  identity: { runId: string; sourceRevision: string };
  status: MysqlStatus;
  diagnostic: MysqlDiagnostic | null;
  nodeMap: MysqlNode[];
  judgement: {
    passed: boolean;
    reviewCase: number;
    complete: boolean;
    cases: MysqlCaseResult[];
  } | null;
  replay: MysqlReplay | null;
  usage: {
    fuel: number;
    steps: number;
    rowsExamined: number;
    databaseBytes: number;
    resultBytes: number;
  };
}
export interface MysqlProfileCase {
  index: number;
  session: MysqlSession;
  expectedResult: MysqlResult;
  expectedDatabase: { tables: { name: string; columns: MysqlColumn[]; rows: MysqlCell[][] }[] };
  expectedTransactionActive: boolean;
  ordered: boolean;
  checkColumnNames: boolean;
  requiredFeatures: string[];
}
/** Derived from validated state transitions; never serialized in the execution wire. */
export interface MysqlTraceEvidence {
  rolledBackWrite: boolean;
}
export interface MysqlProfile {
  id: string;
  sourceNodeId: string;
  lessonId: string;
  title: string;
  referenceSource: string;
  starter: string;
  goal: string;
  hints: string[];
  cases: MysqlProfileCase[];
}
