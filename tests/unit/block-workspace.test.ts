import { afterEach, describe, expect, test } from 'vitest';
import * as Blockly from 'blockly/core';
import { BLOCK_TYPES, registerTeachingBlocks } from '../../web/src/blocks/definitions';
import { generateBlockSource } from '../../web/src/blocks/generator';
import {
  inputBlocks,
  loadBlockProgram,
  loadBlockWorkspaceDraft,
  protocolBlockId,
  readBlockWorkspace,
  saveBlockWorkspaceDraft,
} from '../../web/src/blocks/workspace';
import type { BlockExpression, BlockProgram, BlockStatement } from '../../web/src/blocks/model';

const workspaces: Blockly.Workspace[] = [];
const workspace = () => {
  registerTeachingBlocks();
  const result = new Blockly.Workspace();
  workspaces.push(result);
  return result;
};
afterEach(() => {
  for (const editor of workspaces.splice(0)) editor.dispose();
});
let next = 0;
const id = () => `workspace.${++next}`;
const integer = (value = '0'): BlockExpression => ({ id: id(), kind: 'integer', value });
const variable = (name = 'x'): BlockExpression => ({ id: id(), kind: 'variable', name });
const assign = (): BlockStatement & { kind: 'assign' } => ({
  id: id(),
  kind: 'assign',
  name: 'x',
  value: integer('1'),
});
const program = (body: BlockStatement[] = []): BlockProgram => ({ id: id(), kind: 'main', body });

describe('real Blockly finite teaching workspace', () => {
  test('native newBlock ids become stable EXEC-compatible ids while native drafts retain them', () => {
    const editor = workspace();
    const value = program();
    loadBlockProgram(editor, value);
    const result = editor.newBlock('cv_return');
    const number = editor.newBlock('cv_integer', 'native[integer]%');
    result.getInput('VALUE')!.connection!.connect(number.outputConnection!);
    editor
      .getBlockById(value.id)!
      .getInput('BODY')!
      .connection!.connect(result.previousConnection!);
    const tree = readBlockWorkspace(editor);
    expect(tree.issues).toEqual([]);
    const source = generateBlockSource(
      tree.program!,
      { text: '', bindingMap: [], blockMap: [] },
      [],
    );
    expect(source.text.match(/return 0;/g)).toHaveLength(1);
    expect(source.blockMap.some((entry) => entry.blockId === protocolBlockId(number.id))).toBe(
      true,
    );
    expect(
      source.blockMap.every((entry) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(entry.blockId)),
    ).toBe(true);
    const restored = workspace();
    loadBlockWorkspaceDraft(restored, saveBlockWorkspaceDraft(editor));
    expect(restored.getBlockById(number.id)).not.toBeNull();
    expect(readBlockWorkspace(restored)).toEqual(tree);
  });

  test('encoded id collisions and over-capacity ids explicitly reject instead of merging nodes', () => {
    const editor = workspace();
    const value = program();
    loadBlockProgram(editor, value);
    const first = editor.newBlock('cv_scope', '[');
    const second = editor.newBlock('cv_scope', protocolBlockId('['));
    editor.getBlockById(value.id)!.getInput('BODY')!.connection!.connect(first.previousConnection!);
    first.nextConnection!.connect(second.previousConnection!);
    expect(
      readBlockWorkspace(editor).issues.some((issue) => issue.code === 'BLOCK_ID_COLLISION'),
    ).toBe(true);
    expect(readBlockWorkspace(editor).program).toBeNull();
    second.dispose(true);
    const oversized = editor.newBlock('cv_scope', '['.repeat(60));
    first.nextConnection!.connect(oversized.previousConnection!);
    expect(readBlockWorkspace(editor).issues).toContainEqual(
      expect.objectContaining({ code: 'BLOCK_ID_LIMIT', blockId: null }),
    );
    expect(readBlockWorkspace(editor).program).toBeNull();
  });

  test('thirty-three printf arguments round-trip without an extra editor limit', () => {
    const editor = workspace();
    const value = program([
      {
        id: id(),
        kind: 'print',
        format: '%d'.repeat(33),
        args: Array.from({ length: 33 }, () => integer('1')),
      },
    ]);
    loadBlockProgram(editor, value);
    expect(editor.getBlockById(value.body[0].id)!.getInput('ARG32')).not.toBeNull();
    expect(readBlockWorkspace(editor)).toEqual({ program: value, issues: [] });
    const restored = workspace();
    loadBlockWorkspaceDraft(restored, saveBlockWorkspaceDraft(editor));
    expect(readBlockWorkspace(restored)).toEqual({ program: value, issues: [] });
    const source = generateBlockSource(value, { text: '', bindingMap: [], blockMap: [] }, []);
    expect(source.text.match(/, 1/g)).toHaveLength(33);
  });
  test('registers exactly twenty finite blocks with expression/statement/header checks', () => {
    const editor = workspace();
    expect(BLOCK_TYPES).toHaveLength(20);
    for (const kind of BLOCK_TYPES) expect(editor.newBlock(`cv_${kind}`).type).toBe(`cv_${kind}`);
    const condition = editor.newBlock('cv_if');
    const number = editor.newBlock('cv_integer');
    const assignment = editor.newBlock('cv_assign');
    const loop = editor.newBlock('cv_for');
    const array = editor.newBlock('cv_array_declare');
    expect(
      editor.connectionChecker.canConnect(
        condition.getInput('CONDITION')!.connection,
        number.outputConnection,
        false,
      ),
    ).toBe(true);
    expect(
      editor.connectionChecker.canConnect(
        condition.getInput('CONDITION')!.connection,
        assignment.previousConnection,
        false,
      ),
    ).toBe(false);
    expect(
      editor.connectionChecker.canConnect(
        loop.getInput('INIT')!.connection,
        assignment.previousConnection,
        false,
      ),
    ).toBe(true);
    expect(
      editor.connectionChecker.canConnect(
        loop.getInput('INIT')!.connection,
        array.previousConnection,
        false,
      ),
    ).toBe(false);
  });

  test('round-trips all twenty kinds, optional branches, pure expressions, scope and for slots', () => {
    const editor = workspace();
    const value: BlockProgram = program([
      { id: id(), kind: 'declare', name: 'x', initial: integer('3') },
      { id: id(), kind: 'declare', name: 'uninitialized', initial: null },
      { id: id(), kind: 'array_declare', name: 'values', length: '3', values: ['1', '-2', '3'] },
      { id: id(), kind: 'array_declare', name: 'other', length: '1', values: null },
      assign(),
      {
        id: id(),
        kind: 'if',
        condition: {
          id: id(),
          kind: 'logic',
          operator: '&&',
          left: { id: id(), kind: 'compare', operator: '>=', left: variable(), right: integer() },
          right: { id: id(), kind: 'unary', operator: '!', operand: integer() },
        },
        then: [],
        else: [{ id: id(), kind: 'scope', body: [] }],
      },
      { id: id(), kind: 'if', condition: integer('1'), then: [], else: null },
      { id: id(), kind: 'while', condition: integer('1'), body: [{ id: id(), kind: 'break' }] },
      {
        id: id(),
        kind: 'for',
        init: { id: id(), kind: 'declare', name: 'i', initial: integer() },
        condition: integer(),
        update: assign(),
        body: [{ id: id(), kind: 'continue' }],
      },
      { id: id(), kind: 'for', init: null, condition: null, update: null, body: [] },
      {
        id: id(),
        kind: 'array_write',
        name: 'values',
        index: integer(),
        value: {
          id: id(),
          kind: 'arithmetic',
          operator: '+',
          left: { id: id(), kind: 'array_read', name: 'values', index: integer() },
          right: integer('1'),
        },
      },
      {
        id: id(),
        kind: 'print',
        format: 'quote" slash\\ %% %d\n%d\n',
        args: [variable(), integer('2')],
      },
      { id: id(), kind: 'return', value: integer() },
    ]);
    loadBlockProgram(editor, value);
    expect(readBlockWorkspace(editor)).toEqual({ program: value, issues: [] });
    const restored = workspace();
    loadBlockWorkspaceDraft(
      restored,
      JSON.parse(JSON.stringify(saveBlockWorkspaceDraft(editor))) as Record<string, unknown>,
    );
    expect(readBlockWorkspace(restored)).toEqual({ program: value, issues: [] });
  });

  test('real field edits, creation, connection and deletion change the IR without raw source', () => {
    const editor = workspace();
    const value = program();
    loadBlockProgram(editor, value);
    const declaration = editor.newBlock('cv_declare');
    declaration.setFieldValue('count', 'NAME');
    const initial = editor.newBlock('cv_integer');
    initial.setFieldValue('7', 'VALUE');
    declaration.getInput('INITIAL')!.connection!.connect(initial.outputConnection!);
    editor
      .getBlockById(value.id)!
      .getInput('BODY')!
      .connection!.connect(declaration.previousConnection!);
    expect(readBlockWorkspace(editor).program?.body[0]).toMatchObject({
      kind: 'declare',
      name: 'count',
      initial: { kind: 'integer', value: '7' },
    });
    initial.setFieldValue('9', 'VALUE');
    expect(readBlockWorkspace(editor).program?.body[0]).toMatchObject({ initial: { value: '9' } });
    declaration.dispose(true);
    expect(readBlockWorkspace(editor).program).toEqual(value);
  });

  test('missing expression retains the actual draft and never returns a partial valid program', () => {
    const editor = workspace();
    const value = program([{ id: id(), kind: 'print', format: '%d\n', args: [integer('7')] }]);
    loadBlockProgram(editor, value);
    const print = editor.getBlockById(value.body[0].id)!;
    print.getInputTargetBlock('ARG0')!.dispose(false);
    const result = readBlockWorkspace(editor);
    expect(result.program).toBeNull();
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'MISSING_INPUT', blockId: print.id }),
    ]);
    const restored = workspace();
    loadBlockWorkspaceDraft(restored, saveBlockWorkspaceDraft(editor));
    expect(readBlockWorkspace(restored)).toEqual(result);
  });

  test('detects disconnected blocks, zero/two main programs, and loop-only jumps', () => {
    const editor = workspace();
    expect(readBlockWorkspace(editor).issues[0].code).toBe('MAIN_COUNT');
    const value = program([{ id: id(), kind: 'break' }]);
    loadBlockProgram(editor, value);
    expect(readBlockWorkspace(editor).issues[0].code).toBe('LOOP_CONTEXT');
    editor.newBlock('cv_integer');
    expect(
      readBlockWorkspace(editor).issues.some((issue) => issue.code === 'DISCONNECTED_BLOCK'),
    ).toBe(true);
    editor.newBlock('cv_main');
    expect(readBlockWorkspace(editor).program).toBeNull();
    expect(readBlockWorkspace(editor).issues.some((issue) => issue.code === 'MAIN_COUNT')).toBe(
      true,
    );
  });

  test('rejects chained for initialization/update even though ordinary statements may chain', () => {
    const editor = workspace();
    const loopId = id();
    const value = program([
      { id: loopId, kind: 'for', init: assign(), condition: null, update: null, body: [] },
    ]);
    loadBlockProgram(editor, value);
    const init = editor.getBlockById(loopId)!.getInputTargetBlock('INIT')!;
    const second = editor.newBlock('cv_assign');
    const number = editor.newBlock('cv_integer');
    second.getInput('VALUE')!.connection!.connect(number.outputConnection!);
    init.nextConnection!.connect(second.previousConnection!);
    expect(readBlockWorkspace(editor).issues.some((issue) => issue.code === 'FOR_INIT')).toBe(true);
    expect(readBlockWorkspace(editor).program).toBeNull();
  });

  test('course scalar/logical-length/array sources survive JSON and cannot be silently deleted', () => {
    const editor = workspace();
    const value = program([
      { id: id(), kind: 'input', bindingKey: 'x', name: 'x', targetKind: 'scalar' },
      { id: id(), kind: 'input', bindingKey: 'n', name: 'n', targetKind: 'logical-length' },
      { id: id(), kind: 'input', bindingKey: 'values', name: 'values', targetKind: 'array' },
    ]);
    loadBlockProgram(editor, value);
    const expected = inputBlocks(value);
    expect(editor.getBlockById(value.body[0].id)!.isEditable()).toBe(false);
    expect(readBlockWorkspace(editor, expected)).toEqual({ program: value, issues: [] });
    const restored = workspace();
    loadBlockWorkspaceDraft(restored, saveBlockWorkspaceDraft(editor));
    expect(readBlockWorkspace(restored, expected)).toEqual({ program: value, issues: [] });
    restored.getBlockById(value.body[1].id)!.dispose(true);
    expect(readBlockWorkspace(restored, expected).issues).toEqual([
      expect.objectContaining({ code: 'INPUT_BINDING', message: expect.stringContaining('n') }),
    ]);
    expect(readBlockWorkspace(restored, expected).program).toBeNull();
  });

  test('changing output format adjusts real argument sockets and rejects unsupported escapes', () => {
    const editor = workspace();
    const value = program([{ id: id(), kind: 'print', format: '\n', args: [] }]);
    loadBlockProgram(editor, value);
    const print = editor.getBlockById(value.body[0].id)!;
    expect(print.getInput('ARG0')).toBeNull();
    print.setFieldValue('%d %d\\n', 'FORMAT');
    expect(print.getInput('ARG1')).not.toBeNull();
    expect(
      readBlockWorkspace(editor).issues.filter((issue) => issue.code === 'MISSING_INPUT'),
    ).toHaveLength(2);
    print.setFieldValue('unsupported\\t', 'FORMAT');
    expect(readBlockWorkspace(editor).issues[0].message).toContain('转义');
    expect(readBlockWorkspace(editor).program).toBeNull();
  });
});
