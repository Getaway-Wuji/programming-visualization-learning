import functions from '../../../shared/fixtures/p1/functions.c?raw';
import hanoi from '../../../shared/fixtures/p1/hanoi.cpp?raw';
import quicksort from '../../../shared/fixtures/p1/quicksort.cpp?raw';

export const stackExamples = [
  {
    id: 'functions',
    title: '函数参数与局部变量',
    language: 'c',
    source: functions,
    description: '值参数有独立存储；每层阶乘调用保留自己的 n、saved 和 child。',
  },
  {
    id: 'hanoi',
    title: '汉诺塔与递归调用',
    language: 'cpp',
    source: hanoi,
    description: '每次调用分别保存盘数和三个柱号，返回后继续调用者的下一步。',
  },
  {
    id: 'quicksort',
    title: '快速排序与数组参数',
    language: 'cpp',
    source: quicksort,
    description: '递归层保存各自的区间，数组参数始终引用调用者的同一个数组。',
  },
  {
    id: 'stack-limit',
    title: '递归深度保护',
    language: 'c',
    source:
      'int descend(int n) {\n    int local = n;\n    if (n > 0) { return descend(n - 1) + local; }\n    return local;\n}\nint main(void) { return descend(40); }\n',
    description: '请求超过32个活动调用帧时停止，已完成前缀和调用链仍可回退。',
  },
] as const;

export function parseStackInput(id: string, draft: string) {
  if (id === 'hanoi') {
    const valid = /^[0-5]$/.test(draft.trim());
    return { valid, input: valid ? [Number(draft.trim())] : [], issue: '请输入0至5的整数盘数。' };
  }
  if (id === 'quicksort') {
    const parts = draft.trim().split(/[\s,，]+/);
    const input = parts.map(Number);
    const valid =
      parts.length === 5 &&
      parts.every((part) => /^[+-]?\d+$/.test(part)) &&
      input.every((value) => Number.isInteger(value) && value >= -999 && value <= 999);
    return {
      valid,
      input: valid ? input : [],
      issue: '请输入五个-999至999的整数，以空格或逗号分隔。',
    };
  }
  return { valid: true, input: [], issue: '' };
}
