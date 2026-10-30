import pointers from '../../../shared/fixtures/memory/pointers.c?raw';
import dangling from '../../../shared/fixtures/memory/dangling.c?raw';
import list from '../../../shared/fixtures/memory/list.cpp?raw';

export const memoryExamples = [
  {
    id: 'pointers',
    title: '指针与数组',
    language: 'c',
    source: pointers,
    input: [],
    description: '通过指针修改变量，观察数组元素的地址与值。',
  },
  {
    id: 'scope',
    title: '作用域与悬空引用',
    language: 'c',
    source: dangling,
    input: [],
    description: '局部对象离开作用域后，原指针仍保存旧对象的引用。',
  },
  {
    id: 'nodes',
    title: '节点连接与释放',
    language: 'cpp',
    source: list,
    input: [4, 2, 9],
    description: '观察三个节点的字段、指针连接和单对象释放。',
  },
  {
    id: 'null',
    title: '空指针',
    language: 'c',
    source: 'int main(){int* p=0;return *p;}',
    input: [],
    description: '空指针没有目标对象，不能用于访问值。',
  },
  {
    id: 'uninitialized',
    title: '未初始化指针',
    language: 'c',
    source: 'int main(){int* p;return *p;}',
    input: [],
    description: '尚未赋值的指针与已初始化的空指针不同。',
  },
  {
    id: 'bounds',
    title: '字段边界与尾后指针',
    language: 'cpp',
    source: 'struct Pair{int a;int b;};\nint main(){Pair pair{};int* p=&pair.a;p=p+1;return *p;}',
    input: [],
    description: '字段的尾后位置不代表可以访问下一个字段。',
  },
] as const;
export type MemoryExample = (typeof memoryExamples)[number];
