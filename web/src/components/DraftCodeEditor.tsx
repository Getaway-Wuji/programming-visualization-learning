import { useEffect, useId, useMemo, useRef } from 'react';
import type { ByteRange } from '../engine/protocol';
import type { EditDocumentSnapshot } from '../practice/edit-document';
import { createSourceIndex } from '../player/source-location';
import './draft-code-editor.css';

const reasons: Record<string, string> = {
  EMPTY_STATEMENT: '单独的空语句目前没有对应积木，请删除多余的分号。',
  FOR_ARRAY_TARGET: 'for 头部的数组写入目前不能映射为积木。',
  BLOCK_NAME: '积木变量名需要以英文字母开头。',
  BLOCK_FORMAT: '输出包含目前不能映射为积木的字符。',
  BLOCK_STRUCTURE: '积木连接尚不完整，请在积木区继续修复。',
  INPUT_BINDING: '请保留本题受控输入声明的名称、位置、类型和初值。',
  UNSUPPORTED_RANGE: '本次积木修改不能安全保留原稿，请在代码中完成这次修改。',
};
export function DraftCodeEditor({
  document,
  selection,
  selectionRevision,
  commentsMoved,
  editRejection,
  onChange,
  onSelect,
  onRetry,
}: {
  document: EditDocumentSnapshot;
  selection?: ByteRange;
  selectionRevision?: number;
  commentsMoved?: boolean;
  editRejection?: string;
  onChange(text: string, changedRange?: ByteRange): void;
  onSelect(range: ByteRange): void;
  onRetry(): void;
}) {
  const text = document.codeDraft;
  const area = useRef<HTMLTextAreaElement>(null);
  const overlay = useRef<HTMLElement>(null);
  const inputRange = useRef<ByteRange | undefined>(undefined);
  const descriptionId = useId();
  const index = useMemo(() => createSourceIndex(text), [text]);
  const selected = useMemo(() => (selection ? index.range(selection) : null), [index, selection]);
  const pending = document.analysisPending;
  const valid =
    !pending &&
    !document.analysisError &&
    document.syncStatus === 'synced' &&
    document.validatedDocumentRevision === document.identity.documentRevision;
  const status = pending
    ? '正在分析当前代码…'
    : document.analysisError
      ? '分析未完成，原稿已保留'
      : valid
        ? '代码与积木已同步'
        : document.syncStatus === 'unmapped'
          ? '代码合法，当前尚未映射'
          : '当前草稿未同步';
  const highlight = selected?.utf16Range;
  const scroll = () => {
    if (overlay.current && area.current)
      overlay.current.style.transform = `translate(${-area.current.scrollLeft}px, ${-area.current.scrollTop}px)`;
  };
  const issueLocation = (range: ByteRange | null) => (range ? index.range(range) : null);
  const locateIssue = (range: ByteRange) => {
    const location = issueLocation(range);
    const target = area.current;
    if (!location || !target) return;
    target.focus({ preventScroll: true });
    target.setSelectionRange(location.utf16Range.start, location.utf16Range.end);
    const style = getComputedStyle(target);
    const lineHeight = parseFloat(style.lineHeight);
    target.scrollTop = Math.max(0, (location.start.line - 3) * lineHeight);
    const prefix =
      text
        .slice(0, location.utf16Range.start)
        .split(/\r\n|\r|\n/)
        .at(-1) ?? '';
    const context = window.document.createElement('canvas').getContext('2d');
    if (context) {
      context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const tab = context.measureText(' ').width * (parseFloat(style.tabSize) || 4);
      const parts = prefix.split('\t');
      let width = 0;
      parts.forEach((part, index) => {
        width += context.measureText(part).width;
        if (index < parts.length - 1 && tab > 0) width = (Math.floor(width / tab) + 1) * tab;
      });
      target.scrollLeft = Math.max(0, width - 24);
    }
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    scroll();
  };
  useEffect(() => {
    const target = area.current;
    if (!target || !selected) return;
    target.setSelectionRange(selected.utf16Range.start, selected.utf16Range.end);
    const before = text.slice(0, selected.utf16Range.start);
    const line = (before.match(/\r\n|\r|\n/g) ?? []).length;
    const lineHeight = parseFloat(getComputedStyle(target).lineHeight);
    if (
      line * lineHeight < target.scrollTop ||
      line * lineHeight > target.scrollTop + target.clientHeight - lineHeight
    )
      target.scrollTop = Math.max(0, line * lineHeight - lineHeight * 2);
    scroll();
  }, [selected, selectionRevision, text]);
  return (
    <section
      className="workbench-panel code-pane draft-code-editor"
      data-testid="draft-code-editor"
      data-sync={pending ? 'pending' : document.analysisError ? 'error' : document.syncStatus}
      data-document-revision={document.identity.documentRevision}
    >
      <header className="panel-heading">
        <h3>编辑 C 代码</h3>
        <span className="badge badge-muted">
          {document.authoritativeDraft.kind === 'blocks' && !valid
            ? '积木尚未完整，代码供对照'
            : '当前草稿'}
        </span>
      </header>
      <p
        className="source-position draft-sync-status"
        id={descriptionId}
        role="status"
        data-testid="code-sync-status"
      >
        {status}。{!valid && '运行与提交暂不可用。'}
      </p>
      <div className="source-view">
        <pre className="source-highlight" aria-hidden="true">
          <code className="source-highlight-text" ref={overlay}>
            {highlight ? (
              <>
                {text.slice(0, highlight.start)}
                <mark className="source-step-mark" data-testid="code-block-highlight">
                  {text.slice(highlight.start, highlight.end)}
                </mark>
                {text.slice(highlight.end)}
              </>
            ) : (
              text
            )}
          </code>
        </pre>
        <textarea
          ref={area}
          className="source-copyarea"
          aria-label="编辑 C 代码"
          aria-describedby={descriptionId}
          value={text}
          onBeforeInput={(event) => {
            const target = event.currentTarget;
            inputRange.current = {
              start: new TextEncoder().encode(text.slice(0, target.selectionStart)).byteLength,
              end: new TextEncoder().encode(text.slice(0, target.selectionEnd)).byteLength,
            };
          }}
          onChange={(event) => {
            const range = inputRange.current;
            inputRange.current = undefined;
            onChange(event.target.value, range);
          }}
          spellCheck={false}
          wrap="off"
          autoCapitalize="off"
          autoCorrect="off"
          onScroll={scroll}
          onSelect={(event) => {
            const target = event.currentTarget;
            const byte = (offset: number) => {
              if (
                offset > 0 &&
                /[\uD800-\uDBFF]/.test(text[offset - 1]) &&
                /[\uDC00-\uDFFF]/.test(text[offset] ?? '')
              )
                offset--;
              return new TextEncoder().encode(text.slice(0, offset)).byteLength;
            };
            onSelect({ start: byte(target.selectionStart), end: byte(target.selectionEnd) });
          }}
        />
      </div>
      {document.analysisError && (
        <p className="draft-code-notice" role="alert">
          {document.analysisError.code === 'budget'
            ? '本次分析达到资源限制。可缩短代码或重试。'
            : document.analysisError.code === 'cancelled'
              ? '分析已取消。草稿仍在本题会话中。'
              : '执行模块暂未完成分析，可以重试。'}{' '}
          <button className="button button-small" onClick={onRetry}>
            重试分析
          </button>
        </p>
      )}
      {editRejection && (
        <p className="draft-code-notice" role="alert">
          {editRejection}
        </p>
      )}
      {!pending && document.diagnostics.length > 0 && (
        <ul className="draft-code-notice" role="alert">
          {document.diagnostics.map((diagnostic, index) => (
            <li key={index}>
              {diagnostic.code}：当前代码或输入声明未通过检查，请修复后继续。
              {diagnostic.location.kind === 'source' &&
                diagnostic.location.byteRange &&
                issueLocation(diagnostic.location.byteRange) && (
                  <button
                    className="button button-small"
                    onClick={() =>
                      locateIssue(
                        diagnostic.location.kind === 'source'
                          ? diagnostic.location.byteRange!
                          : { start: 0, end: 0 },
                      )
                    }
                  >
                    定位问题：第 {issueLocation(diagnostic.location.byteRange)!.start.line} 行，第{' '}
                    {issueLocation(diagnostic.location.byteRange)!.start.column} 列
                  </button>
                )}
            </li>
          ))}
        </ul>
      )}
      {!pending && document.issues.length > 0 && (
        <ul className="draft-code-notice" role="alert">
          {document.issues.map((issue, index) => (
            <li key={index}>
              {reasons[issue.reason]}
              {issue.byteRange && issueLocation(issue.byteRange) && (
                <button
                  className="button button-small"
                  onClick={() => locateIssue(issue.byteRange!)}
                >
                  定位问题：第 {issueLocation(issue.byteRange)!.start.line} 行，第{' '}
                  {issueLocation(issue.byteRange)!.start.column} 列
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {commentsMoved && (
        <p className="draft-code-notice">本次积木编辑调整了注释位置，注释文字已保留。</p>
      )}
      <p className="source-position">
        编辑稿使用本题第一组输入：<code>{JSON.stringify(document.input.values)}</code>
        。已保存的编辑历史可在刷新后选择恢复，未保存内容仅在本次页面保留；选择代码或积木可查看对应位置。
      </p>
    </section>
  );
}
