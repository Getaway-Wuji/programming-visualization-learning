// Public, project-authored acceptance inputs. These never supply execution results.
import { caseSetSamples } from '../tests/fixtures/case-set.ts';

const ascending = Array.from({ length: 30 }, (_, index) => index + 1);
const mixed = Array.from({ length: 30 }, (_, index) => (index % 2 ? 999 : -999));
const equal = Array(30).fill(2);
const sortedMixed = [...mixed].sort((left, right) => left - right);
const negative = Array.from({ length: 30 }, (_, index) => index - 30);
const sortExtras = ['bubble-sort', 'selection-sort'].flatMap((name) =>
  [
    ['ascending30', ascending],
    ['equal30', equal],
    ['mixed30', mixed],
  ].map(([key, values]) => ({
    key: `${name}-${key}`,
    caseId: `case.c.${name}`,
    values: { values },
    stdout: `${[...values].sort((left, right) => left - right).join(' ')}\n`,
  })),
);
const searchExtras = [
  ['head30', ascending, 1, 0],
  ['middle30', ascending, 15, 14],
  ['below30', ascending, 0, -1],
  ['above30', ascending, 31, -1],
  ['duplicate-first30', sortedMixed, 999, 15],
  ['negative30', negative, -15, 15],
].map(([key, values, target, found]) => ({
  key: `search-${key}`,
  caseId: 'case.c.binary-search-first',
  values: { values, target },
  stdout: `${found}\n`,
}));

export const performanceCases = [
  ...caseSetSamples,
  { key: 'branch-max', caseId: 'case.c.branch', values: { x: 999 }, stdout: '1\n' },
  ...sortExtras,
  ...searchExtras,
];
export const performanceExercises = [
  'exercise.c.echo',
  'exercise.c.two-x-plus-three',
  'exercise.c.nonnegative',
  'exercise.c.two-loop-sums',
  'exercise.c.increment-at-index',
  'exercise.c.array-sum',
];
if (performanceCases.length !== 55 || new Set(performanceCases.map((item) => item.key)).size !== 55)
  throw new Error('The registered 11.4 workload count changed.');

export const performancePages = [
  { id: 'PAGE-01', route: '/', selector: '[data-testid="home-continue-learning"]' },
  { id: 'PAGE-02', route: '/courses', selector: '[data-course-lesson]' },
  {
    id: 'PAGE-03',
    route: '/lessons/lesson.c.variables-output',
    selector: '[data-testid="lesson-reading"][data-state="ready"]',
  },
  {
    id: 'PAGE-04',
    route: '/practice/exercise.c.echo',
    selector: '[aria-label="积木工作区"] .blocklySvg',
    workspace: 'practice',
  },
  { id: 'PAGE-05', route: '/cases', selector: '[data-page-id="PAGE-05"] a[href*="visualize"]' },
  {
    id: 'PAGE-06',
    route: '/visualize/case.c.assignment',
    selector: '[data-testid="input-panel"]',
    workspace: 'case',
  },
  {
    id: 'PAGE-07',
    route: '/settings',
    selector: '[data-testid="learning-save-status"][data-save-status="ready"]',
  },
];
