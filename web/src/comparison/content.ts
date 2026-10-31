import { caseExecutionCatalog, type CaseExecutionCatalog } from '../content/case-learning';

export const comparisonAlgorithms = [
  {
    id: 'case.c.bubble-sort',
    title: '冒泡排序',
    detail: '逐对比较相邻元素，严格大于才交换；本模板没有提前退出。',
    complexity: '最好 / 平均 / 最坏 Θ(n²)；辅助空间 O(1)；稳定。',
  },
  {
    id: 'case.c.selection-sort',
    title: '选择排序',
    detail: '扫描剩余区间寻找最小值，位置不同时交换；最多 n−1 次交换。',
    complexity: '最好 / 平均 / 最坏 Θ(n²)；辅助空间 O(1)；不稳定。',
  },
] as const;

export const comparisonExample = Object.freeze({ values: Object.freeze([7, -3, 0, 5, -3, 2, 9]) });

/** Only the two already reviewed original C cases can enter this screen. */
export function comparisonCatalogs(swapped = false): [CaseExecutionCatalog, CaseExecutionCatalog] {
  const entries = comparisonAlgorithms.map(({ id }) => caseExecutionCatalog(id));
  if (
    entries.some(
      (entry) =>
        !entry ||
        entry.program.languageRef.id !== 'lang.c' ||
        entry.program.subsetRef.id !== 'subset.c.p0' ||
        entry.inputSpec.id !== 'input.c.int-sequence',
    ) ||
    JSON.stringify(entries[0]!.inputSpec) !== JSON.stringify(entries[1]!.inputSpec)
  )
    throw new Error('COMPARISON_CATALOG_UNAVAILABLE');
  return (swapped ? entries.reverse() : entries) as [CaseExecutionCatalog, CaseExecutionCatalog];
}
