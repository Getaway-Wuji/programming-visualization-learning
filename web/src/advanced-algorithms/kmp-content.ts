import registry from '../../../content/algorithms/cpp/kmp-1.0.0.json';
import source from '../../../content/algorithms/cpp/kmp-1.0.0.cpp?raw';
import type { AdvancedState } from '../engine/advanced-protocol';
export const kmpSpec = registry.case;
export const kmpRegistryRef = { id: registry.id, version: registry.version };
export const validKmpLine = (v: unknown): v is string =>
  typeof v === 'string' && /^[\x20-\x7e]{0,30}$/.test(v);
/** Domain validation only. Empty strings and spaces retain their exact values. */
export function parseKmpInput(text: unknown, pattern: unknown) {
  return {
    valid: validKmpLine(text) && validKmpLine(pattern),
    issue: '文本与模式都必须为0～30个可打印ASCII字节（空格至~）；空字段是空串，空格不省略。',
  };
}
export function prepareKmp(text: unknown, pattern: unknown) {
  if (!validKmpLine(text) || !validKmpLine(pattern)) throw Error('E_INPUT_INVALID');
  return { source, input: { kind: 'lines' as const, values: [text, pattern] } };
}
export const kmpScalarNames = [
  'phase',
  'n',
  'm',
  'built',
  'buildIndex',
  'border',
  'textIndex',
  'matched',
  'answer',
] as const;
/** Reads only current live Rust objects. No prefix construction or matching. */
export function projectKmpState(state: AdvancedState) {
  const object = (name: string) => state.objects.find((o) => o.alive && o.name === name);
  const scalars = Object.fromEntries(
    kmpScalarNames.map((name) => {
      const v = object(name)?.cells[0]?.value;
      return [name, typeof v === 'number' ? v : null];
    }),
  ) as Record<(typeof kmpScalarNames)[number], number | null>;
  const strings = (['text', 'pattern'] as const).map((name) => {
    const o = object(name),
      v = o?.cells[0]?.value;
    return { name, present: !!o, value: typeof v === 'string' ? v : null };
  });
  const prefix = object('prefix'),
    extent = scalars.m;
  return {
    scalars,
    strings,
    prefix: {
      present: !!prefix,
      capacity: prefix?.length ?? null,
      extent,
      values:
        prefix && extent !== null
          ? Array.from({ length: Math.max(0, Math.min(prefix.length, extent)) }, (_, i) => {
              const v = prefix.cells.find((c) => c.byteOffset === i * 4)?.value;
              return typeof v === 'number' ? v : null;
            })
          : [],
    },
  };
}
