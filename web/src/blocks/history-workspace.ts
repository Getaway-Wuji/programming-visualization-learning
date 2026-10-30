import * as Blockly from 'blockly/core';
import { BLOCK_TYPES } from './block-kinds';
import type { InputBinding } from '../content/types';
import type { BlockInput, BlockProgram } from './model';
import {
  loadBlockWorkspaceDraft,
  protocolBlockId,
  readBlockWorkspace,
  type BlockWorkspaceDraft,
} from './workspace';

/** Validate data before invoking any Blockly deserializer. This does not parse C. */
export function parseHistoryWorkspace(text: string): BlockWorkspaceDraft {
  if (new TextEncoder().encode(text).byteLength > 1048576)
    throw new Error('HISTORY_WORKSPACE_LIMIT');
  const value: unknown = JSON.parse(text);
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => key !== 'blocks')
  )
    throw new Error('HISTORY_WORKSPACE_FORMAT');
  const queue: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  let count = 0,
    blocks = 0;
  const ids = new Set<string>();
  while (queue.length) {
    const current = queue.pop()!;
    if (++count > 250000 || current.depth > 512) throw new Error('HISTORY_WORKSPACE_LIMIT');
    if (!current.value || typeof current.value !== 'object') continue;
    const node = current.value as Record<string, unknown>;
    for (const [key, child] of Object.entries(node)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key))
        throw new Error('HISTORY_WORKSPACE_FORMAT');
      if (child && typeof child === 'object')
        queue.push({ value: child, depth: current.depth + 1 });
    }
    if ('type' in node) {
      if (
        typeof node.type !== 'string' ||
        !node.type.startsWith('cv_') ||
        !BLOCK_TYPES.includes(node.type.slice(3) as (typeof BLOCK_TYPES)[number]) ||
        typeof node.id !== 'string' ||
        ids.has(node.id) ||
        ++blocks > 32768
      )
        throw new Error('HISTORY_WORKSPACE_FORMAT');
      ids.add(node.id);
    }
  }
  return value as BlockWorkspaceDraft;
}
export function inspectHistoryWorkspace(
  draft: BlockWorkspaceDraft,
  bindings: readonly InputBinding[],
) {
  const workspace = new Blockly.Workspace();
  try {
    loadBlockWorkspaceDraft(workspace, draft);
    const expected: BlockInput[] = bindings.map((binding) => {
      const candidates = workspace
        .getAllBlocks(false)
        .filter(
          (block) =>
            (block as Blockly.Block & { inputBinding?: { bindingKey?: string } }).inputBinding
              ?.bindingKey === binding.bindingKey,
        );
      return {
        kind: 'input',
        id: candidates[0]
          ? protocolBlockId(candidates[0].id)
          : `history.missing.${binding.bindingKey}`,
        bindingKey: binding.bindingKey,
        name: binding.targetName,
        targetKind: binding.targetKind,
      };
    });
    const read = readBlockWorkspace(workspace, expected);
    const fallback: BlockProgram = { kind: 'main', id: 'history.main', body: expected };
    return { ...read, fallback };
  } finally {
    workspace.dispose();
  }
}
