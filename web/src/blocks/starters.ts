import type { InputBinding } from '../content/types';
import type { BlockExpression, BlockProgram, BlockStatement } from './model';

function lessonProgram(
  exerciseId: string,
  bindings: readonly InputBinding[],
  correct: boolean,
): BlockProgram {
  let next = 0;
  const id = () => `lesson.block.${++next}`;
  const integer = (value: number): BlockExpression => ({
    id: id(),
    kind: 'integer',
    value: String(value),
  });
  const variable = (name: string): BlockExpression => ({ id: id(), kind: 'variable', name });
  const arithmetic = (
    operator: '+' | '-' | '*',
    left: BlockExpression,
    right: BlockExpression,
  ): BlockExpression => ({ id: id(), kind: 'arithmetic', operator, left, right });
  const compare = (
    operator: '<' | '<=' | '>' | '>=',
    left: BlockExpression,
    right: BlockExpression,
  ): BlockExpression => ({ id: id(), kind: 'compare', operator, left, right });
  const read = (name: string, index: BlockExpression): BlockExpression => ({
    id: id(),
    kind: 'array_read',
    name,
    index,
  });
  const declare = (
    name: string,
    initial: BlockExpression,
  ): BlockStatement & { kind: 'declare' } => ({ id: id(), kind: 'declare', name, initial });
  const assign = (name: string, value: BlockExpression): BlockStatement & { kind: 'assign' } => ({
    id: id(),
    kind: 'assign',
    name,
    value,
  });
  const print = (...args: BlockExpression[]): BlockStatement => ({
    id: id(),
    kind: 'print',
    format: args.map(() => '%d\n').join(''),
    args,
  });
  const body: BlockStatement[] = bindings.map((binding) => ({
    id: id(),
    kind: 'input',
    bindingKey: binding.bindingKey,
    name: binding.targetName,
    targetKind: binding.targetKind,
  }));
  switch (exerciseId) {
    case 'exercise.c.echo':
      body.push({
        id: id(),
        kind: 'print',
        format: correct ? '%d\n' : '%d',
        args: [variable('x')],
      });
      break;
    case 'exercise.c.two-x-plus-three':
      body.push(
        declare(
          'result',
          arithmetic('+', arithmetic('*', integer(correct ? 2 : 1), variable('x')), integer(3)),
        ),
        print(variable('result')),
      );
      break;
    case 'exercise.c.nonnegative':
      body.push({
        id: id(),
        kind: 'if',
        condition: compare(correct ? '>=' : '>', variable('x'), integer(0)),
        then: [print(integer(1))],
        else: [print(integer(0))],
      });
      break;
    case 'exercise.c.two-loop-sums':
      body.push(
        declare('i', integer(1)),
        declare('sumWhile', integer(0)),
        {
          id: id(),
          kind: 'while',
          condition: compare(correct ? '<=' : '<', variable('i'), variable('n')),
          body: [
            assign('sumWhile', arithmetic('+', variable('sumWhile'), variable('i'))),
            assign('i', arithmetic('+', variable('i'), integer(1))),
          ],
        },
        declare('sumFor', integer(0)),
        {
          id: id(),
          kind: 'for',
          init: declare('j', integer(1)),
          condition: compare(correct ? '<=' : '<', variable('j'), variable('n')),
          update: assign('j', arithmetic('+', variable('j'), integer(1))),
          body: [assign('sumFor', arithmetic('+', variable('sumFor'), variable('j')))],
        },
        print(variable('sumWhile'), variable('sumFor')),
      );
      break;
    case 'exercise.c.increment-at-index':
      body.push(
        {
          id: id(),
          kind: 'array_write',
          name: 'values',
          index: variable('k'),
          value: arithmetic('+', read('values', variable('k')), integer(correct ? 1 : 0)),
        },
        print(read('values', variable('k'))),
      );
      break;
    case 'exercise.c.array-sum':
      body.push(
        declare('sum', integer(correct ? 0 : 1)),
        {
          id: id(),
          kind: 'for',
          init: declare('i', integer(0)),
          condition: compare('<', variable('i'), variable('n')),
          update: assign('i', arithmetic('+', variable('i'), integer(1))),
          body: [assign('sum', arithmetic('+', variable('sum'), read('values', variable('i'))))],
        },
        print(variable('sum')),
      );
      break;
    default:
      throw new Error('BLOCK_EXERCISE_UNSUPPORTED');
  }
  return { id: 'lesson.main', kind: 'main', body };
}

/** Independent practice starts with input declarations only, never answer logic. */
export function starterProgram(
  _exerciseId: string,
  bindings: readonly InputBinding[],
): BlockProgram {
  return {
    id: 'lesson.main',
    kind: 'main',
    body: bindings.map((binding, index) => ({
      id: `lesson.block.${index + 1}`,
      kind: 'input',
      bindingKey: binding.bindingKey,
      name: binding.targetName,
      targetKind: binding.targetKind,
    })),
  };
}

/** The earlier unfinished solution is available only through explicit correction mode. */
export function correctionProgram(
  exerciseId: string,
  bindings: readonly InputBinding[],
): BlockProgram {
  return lessonProgram(exerciseId, bindings, false);
}

/** Explicit acceptance fixture, never an execution result or a product default. */
export function correctBlockProgram(
  exerciseId: string,
  bindings: readonly InputBinding[],
): BlockProgram {
  return lessonProgram(exerciseId, bindings, true);
}
