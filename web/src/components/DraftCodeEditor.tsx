import { useEffect, useId, useMemo, useRef } from 'react';
import type { ByteRange } from '../engine/protocol';
import type { EditDocumentSnapshot } from '../practice/edit-document';
import { createSourceIndex } from '../player/source-location';
import { DiagnosticPanel } from '../diagnostics/DiagnosticPanel';
import './draft-code-editor.css';
import { CodeEditor, type CodeEditorHandle } from './CodeEditor';

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
  const area = useRef<CodeEditorHandle>(null);
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
  const issueLocation = (range: ByteRange | null) => (range ? index.range(range) : null);
  const locateIssue = (range: ByteRange) => {
    const location = issueLocation(range);
    const target = area.current;
    if (!location || !target) return;
    target.select(location.utf16Range.start, location.utf16Range.end);
  };
  useEffect(() => {
    const target = area.current;
    if (!target || !selected) return;
    target.select(selected.utf16Range.start, selected.utf16Range.end, false);
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
        className={valid ? 'screen-reader-only' : 'source-position draft-sync-status'}
        id={descriptionId}
        role="status"
        data-testid="code-sync-status"
      >
        {status}。{!valid && '运行与提交暂不可用。'}
      </p>
      <CodeEditor
        ref={area}
        label="编辑 C 代码"
        dialect="c"
        value={text}
        onChange={onChange}
        onSelect={onSelect}
      />
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
      {!pending && !document.analysisError && (
        <DiagnosticPanel
          diagnostics={document.diagnostics}
          source={{ text }}
          onLocateSource={locateIssue}
        />
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
    </section>
  );
}
