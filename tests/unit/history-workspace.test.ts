import { describe, expect, it } from 'vitest';
import {
  parseHistoryWorkspace,
  inspectHistoryWorkspace,
} from '../../web/src/blocks/history-workspace';
import { draftFromBlockProgram } from '../../web/src/blocks/workspace';

describe('untrusted historical Blockly data', () => {
  it('retains IDs/coordinates and reports disconnected drafts instead of repairing them', () => {
    const draft = draftFromBlockProgram({ kind: 'main', id: 'history.main', body: [] });
    (draft.blocks as { blocks: unknown[] }).blocks.push({
      type: 'cv_integer',
      id: 'history.loose',
      x: 301,
      y: 205,
      fields: { VALUE: 7 },
    });
    const text = JSON.stringify(draft);
    const read = inspectHistoryWorkspace(parseHistoryWorkspace(text), []);
    expect(read.program).toBeNull();
    expect(read.issues.some((issue) => issue.code === 'DISCONNECTED_BLOCK')).toBe(true);
    expect(JSON.stringify(draft)).toBe(text);
  });
  it.each([
    '{"blocks":{"blocks":[{"type":"other","id":"bad"}]}}',
    '{"blocks":{"blocks":[{"type":"cv_integer","id":"same"},{"type":"cv_integer","id":"same"}]}}',
    '{"__proto__":{"polluted":true}}',
    '{"blocks":{"constructor":{}}}',
    '{"variables":[]}',
    '[]',
    '{',
    ' '.repeat(1048577),
  ])('rejects unsupported/corrupt payload before deserialization (%#)', (text) => {
    expect(() => parseHistoryWorkspace(text)).toThrow();
  });
});
