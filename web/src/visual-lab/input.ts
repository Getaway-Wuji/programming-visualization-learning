import type { VisualSpec } from './catalog';

export type VisualDraft = Record<string, string>;
const integer = (text: string, min: number, max: number) => {
  if (!/^[+-]?\d+$/.test(text.trim())) throw Error(`请输入 ${min}～${max} 的整数。`);
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw Error(`请输入 ${min}～${max} 的整数。`);
  return value === 0 ? 0 : value;
};
const numbers = (text: string, min: number, max: number, limit: number) => {
  if (text.trim() === '[]') return [];
  const parts = text.trim().split(/[\s,，]+/);
  if (parts.length > limit) throw Error(`最多输入 ${limit} 项。`);
  return parts.map((part) => integer(part, min, max));
};
const lines = (text: string) =>
  text.trim() === '[]' || !text.trim()
    ? []
    : text
        .trim()
        .split(/\r?\n/)
        .filter((s) => s.trim());

/** Input validation and wire formatting only. Algorithms execute in Rust/WASM. */
export function parseVisualInput(
  spec: VisualSpec,
  draft: VisualDraft,
): { values: number[]; issue: string } {
  try {
    if (Object.values(draft).some((text) => text.length > 1024))
      throw Error('输入过长，请缩短后再运行。');
    let values: number[] = [];
    if (['sequence', 'search', 'array', 'traversal', 'tree-query'].includes(spec.inputKind)) {
      const tree = ['tree', 'heap'].includes(spec.kind);
      const min = ['counting', 'radix'].includes(spec.slug) ? 0 : -99;
      const max = spec.slug === 'counting' ? 20 : spec.slug === 'radix' ? 999 : 99;
      const a = numbers(draft.values ?? '', min, max, tree ? 7 : 12);
      if (['binary', 'block'].includes(spec.slug) && a.some((v, i) => i > 0 && v < a[i - 1]))
        throw Error('请按从小到大的顺序输入数组。');
      values = [a.length, ...a];
      if (['search', 'tree-query'].includes(spec.inputKind))
        values.push(integer(draft.target ?? '', -99, 99));
      if (spec.inputKind === 'traversal') values.push(integer(draft.order ?? '1', 1, 3));
      if (spec.inputKind === 'array') {
        const action = integer(draft.action ?? '1', 1, spec.slug === 'array' ? 4 : 3);
        values.push(
          action,
          action === 1 || action === 2
            ? integer(draft.position ?? '0', 0, Math.max(0, a.length - (action === 2 ? 1 : 0)))
            : 0,
          action === 1 || action === 4 ? integer(draft.value ?? '0', -99, 99) : 0,
        );
      }
      if (spec.inputKind === 'array' && draft.action === '1' && a.length >= 12)
        throw Error('数组已满，请先删除一项。');
      if (spec.inputKind === 'array' && draft.action === '2' && !a.length)
        throw Error('空表没有可以删除的位置。');
    } else if (spec.inputKind === 'operations') {
      const commands = lines(draft.operations ?? '');
      if (commands.length > 12) throw Error('最多输入 12 次操作。');
      values = [commands.length];
      for (const line of commands) {
        if (line.trim() === '出') values.push(2, 0);
        else {
          const match = /^入\s+([+-]?\d+)$/.exec(line.trim());
          if (!match) throw Error('每行写“入 7”或“出”。');
          values.push(1, integer(match[1], -99, 99));
        }
      }
    } else if (spec.inputKind === 'unions') {
      const n = integer(draft.number ?? '', 1, 8);
      const commands = lines(draft.operations ?? '');
      if (commands.length > 8) throw Error('最多输入 8 次操作。');
      values = [n, commands.length];
      for (const command of commands) {
        const parts = command.trim().split(/\s+/);
        if (parts[0] === '合' && parts.length === 3)
          values.push(1, integer(parts[1], 0, n - 1), integer(parts[2], 0, n - 1));
        else if (parts[0] === '查' && parts.length === 2)
          values.push(2, integer(parts[1], 0, n - 1), 0);
        else throw Error('每行写“合 0 1”或“查 2”。');
      }
    } else if (spec.inputKind === 'graph') {
      const n = integer(draft.number ?? '', 1, 6);
      const edges = lines(draft.edges ?? '');
      if (edges.length > 8) throw Error('最多输入 8 条边。');
      values = [
        n,
        edges.length,
        integer(draft.start ?? '0', 0, n - 1),
        integer(draft.order ?? '1', 1, 2),
      ];
      const seen = new Set<string>();
      for (const edge of edges) {
        const parts = numbers(edge, 0, 99, 3);
        if (parts.length !== 3 || parts[0] >= n || parts[1] >= n || parts[2] < 1 || parts[2] > 9)
          throw Error('每行写“起点 终点 权重”，节点从 0 开始，权重 1～9。');
        if (parts[0] === parts[1]) throw Error('本例不接受节点连向自己的边。');
        const pair = ['topological', 'floyd'].includes(spec.slug)
          ? parts.slice(0, 2).join(':')
          : parts
              .slice(0, 2)
              .sort((a, b) => a - b)
              .join(':');
        if (seen.has(pair)) throw Error('请勿重复输入同一条边。');
        seen.add(pair);
        values.push(...parts);
      }
    } else if (spec.inputKind === 'knapsack') {
      const capacity = integer(draft.capacity ?? '', 0, 8);
      const items = lines(draft.items ?? '');
      if (items.length > 4) throw Error('最多输入 4 种物品。');
      values = [items.length, capacity];
      for (const item of items) {
        const pair = numbers(item, 0, 99, 2);
        if (pair.length !== 2 || pair[0] < 1 || pair[0] > 8)
          throw Error('每行写“重量 价值”，重量 1～8，价值 0～99。');
        values.push(...pair);
      }
    } else if (spec.inputKind === 'strings') {
      const a = draft.text ?? '',
        b = draft.pattern ?? '';
      if (!/^[a-z]{0,8}$/.test(a) || !/^[a-z]{0,8}$/.test(b))
        throw Error('每个字符串最多 8 个小写英文字母。');
      if (spec.slug === 'kmp' && !b.length) throw Error('请输入至少一个字符的匹配串。');
      values = [
        a.length,
        ...[...a].map((s) => s.charCodeAt(0)),
        b.length,
        ...[...b].map((s) => s.charCodeAt(0)),
      ];
    } else if (spec.inputKind === 'trie') {
      const words = (draft.words ?? '').trim().split(/\s+/).filter(Boolean);
      const query = draft.pattern ?? '';
      if (
        words.length > 3 ||
        !words.every((s) => /^[abc]{1,5}$/.test(s)) ||
        !/^[abc]{1,5}$/.test(query) ||
        words.join('').length > 12
      )
        throw Error('最多 3 个单词，共 12 个字母；单词和查询使用 a、b、c，每项 1～5 个字母。');
      values = [
        words.length,
        ...words.flatMap((s) => [s.length, ...[...s].map((c) => c.charCodeAt(0) - 97)]),
        query.length,
        ...[...query].map((c) => c.charCodeAt(0) - 97),
      ];
    } else if (spec.inputKind === 'scalar')
      values = [integer(draft.number ?? '', 0, spec.slug === 'hanoi' ? 5 : 12)];
    if (values.length > 30) throw Error('输入过多，请减少数据或操作次数。');
    return { values, issue: '' };
  } catch (error) {
    return { values: [], issue: error instanceof Error ? error.message : '请检查输入。' };
  }
}
