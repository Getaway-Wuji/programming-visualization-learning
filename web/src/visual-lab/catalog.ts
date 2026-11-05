import catalog from '../../../content/algorithms/visual-lab/catalog.json' with { type: 'json' };

export interface VisualSpec {
  slug: string;
  title: string;
  category: string;
  kind:
    | 'bars'
    | 'array'
    | 'hash'
    | 'links'
    | 'tree'
    | 'heap'
    | 'graph'
    | 'parents'
    | 'trie'
    | 'matrix'
    | 'hanoi';
  inputKind:
    | 'sequence'
    | 'search'
    | 'array'
    | 'operations'
    | 'unions'
    | 'trie'
    | 'traversal'
    | 'tree-query'
    | 'graph'
    | 'knapsack'
    | 'strings'
    | 'scalar';
  description: string;
  complexity: string;
  defaults: Record<string, string>;
  arrays: string[];
}
export const visualModules = catalog as unknown as VisualSpec[];
export const visualCategories = [
  '排序算法',
  '查找算法',
  '数据结构',
  '树与图',
  '动态规划',
  '经典算法',
];
