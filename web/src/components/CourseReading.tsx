import type { ReactNode } from 'react';
import { useLearning } from '../learning/react';
import { StatePanel } from './Ui';

export function ReadingBoundary({ children }: { children: ReactNode }) {
  const { state, service } = useLearning();
  const status = state.readingStatus ?? 'loading';
  return (
    <div data-testid="course-reading" data-state={status}>
      {status === 'loading' && (
        <StatePanel
          kind="loading"
          title="正在读取课程"
          description="正在准备课程正文与本地学习记录。"
        />
      )}
      {status === 'failed' && (
        <StatePanel
          kind="error"
          title="课程内容暂不可用"
          description="课程资源未能加载或未通过完整性检查。已有学习记录会保留，请重试。"
        >
          <button className="button button-secondary" onClick={() => void service.reloadReading()}>
            重试加载课程
          </button>
        </StatePanel>
      )}
      {status === 'ready' && state.reading && children}
    </div>
  );
}

export { lessonProgress } from '../content/reading';

/** Plain text and complete code fences only; never interprets HTML or runs the examples. */
export function ReadingText({ text }: { text: string }) {
  const parts = text.split(/(```c\n[\s\S]*?\n```)/u);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith('```c\n') ? (
          <pre key={index} className="sample-source" tabIndex={0} aria-label="正文示例源码">
            {part.slice(5, -4)}
          </pre>
        ) : (
          <p key={index} className="preserve-lines">
            {part}
          </p>
        ),
      )}
    </>
  );
}
