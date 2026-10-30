import { useState } from 'react';
import { Link } from 'react-router';
import { paths } from '../navigation';
import type { PracticeSnapshot } from '../practice/session';
import './practice-experience.css';
import { currentCourseBundle } from '../content/course-bundle';

const hints: Record<string, readonly string[]> = {
  'exercise.c.echo': [
    '本题练习读取输入 x，再把它输出；输入值会随测试组变化。',
    '从“输出”积木开始，把变量 x 接到输出参数。格式中的 %d 对应一个整数参数。',
    '检查输出末尾是否换行；不要把某组输入的具体数值写成固定输出。',
  ],
  'exercise.c.two-x-plus-three': [
    '先把题意拆成两步：将输入翻倍，再加上三。',
    '用算术表达式组合乘法和加法，再把运算结果交给输出积木。可以先存入一个变量。',
    '检查运算的先后顺序，以及零和负数输入。输入 x 必须实际参与乘法、加法和最终输出。',
  ],
  'exercise.c.nonnegative': [
    '把输入分成非负与负数两类，特别留意零属于哪一类。',
    '使用同一个 if/else 判断输入 x，在两个分支中分别输出题目要求的结果。',
    '分别检查负数、零和正数；比较条件要覆盖零，输出也要包含换行。',
  ],
  'exercise.c.two-loop-sums': [
    '本题需要两次独立的累加，分别使用 while 和 for。',
    '为每次累加准备从零开始的和与循环变量，每轮累加当前项后推进循环。',
    '检查最后一项是否参与累加。n 为零时，两段循环都不执行，并输出两行零；公式不能代替循环。',
  ],
  'exercise.c.increment-at-index': [
    'k 是要修改的逻辑下标，目标是更新数组中的这一项。',
    '先读取目标元素，在原值上增加，再写回同一个位置，最后输出更新后的元素。',
    '检查是否误改了其他下标，或只算出了新值而没有写回数组。',
  ],
  'exercise.c.array-sum': [
    '需要让每个逻辑元素都参与累加，空数组的和也要有定义。',
    '准备一个累加变量，用循环依次读取逻辑范围内的元素；循环结束后再输出总和。',
    '检查累加初值、循环边界和下标推进。n 为零时不能读取用于存放空数组的占位元素。',
  ],
};

export function PracticeGuidance({
  id,
  lessonId,
  mode,
  onMode,
  reconstruction = false,
}: {
  id: string;
  lessonId: string;
  mode: PracticeSnapshot['mode'];
  onMode: (mode: PracticeSnapshot['mode']) => void;
  reconstruction?: boolean;
}) {
  const [shown, setShown] = useState(0);
  const layers =
    currentCourseBundle()?.guidance.find((entry) => entry.exerciseRef.id === id)?.hints ??
    hints[id] ??
    [];
  return (
    <div className="practice-guidance">
      <div className="practice-mode-row">
        <div className="practice-modes" data-testid="practice-mode" aria-label="练习起点">
          <button
            className="button button-secondary"
            aria-pressed={mode === 'independent'}
            onClick={() => onMode('independent')}
          >
            独立练习
          </button>
          <button
            className="button button-secondary"
            aria-pressed={mode === 'correction'}
            onClick={() => onMode('correction')}
          >
            改错练习
          </button>
          {reconstruction && (
            <button
              className="button button-secondary"
              aria-pressed={mode === 'reconstruction'}
              onClick={() => onMode('reconstruction')}
            >
              拆积木练习
            </button>
          )}
        </div>
        <Link
          className="text-link"
          to={paths.lesson(lessonId)}
          target="_blank"
          rel="noopener"
          title="在新标签页打开，保留当前解答"
        >
          查看课程示例
        </Link>
      </div>
      <p className="muted" data-testid="practice-mode-description">
        {mode === 'independent'
          ? '从零搭建解答。已保留本题输入声明，请在 main 中加入你的程序。'
          : mode === 'reconstruction'
            ? '对照参考 C，用积木还原程序；生成代码只读。'
            : '这份程序有待修正，请找出问题后提交测试。'}
        各模式草稿独立保留，切换会清除本次结果；已保存的编辑历史可在离题或刷新后选择恢复，未保存内容可能丢失。示例在新标签页打开。
      </p>
      <div className="practice-hints" data-testid="practice-hints">
        <div className="practice-hints-heading">
          <strong>需要一点帮助？</strong>
          {shown < layers.length ? (
            <button
              className="button button-secondary"
              aria-controls="practice-hint-layers"
              onClick={() => setShown((value) => value + 1)}
            >
              查看第 {shown + 1} 层提示
            </button>
          ) : (
            <span>已展开全部 {layers.length} 层提示</span>
          )}
        </div>
        <div id="practice-hint-layers" aria-live="polite">
          {shown > 0 && (
            <ol>
              {layers.slice(0, shown).map((hint) => (
                <li key={hint}>{hint}</li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
