import type { InputSpecEntity } from '../content/types';
import type { InputDraft, InputIssue } from '../engine/input-data';

interface Props {
  spec: InputSpecEntity;
  draft: InputDraft;
  seed: string;
  length: string;
  issues: readonly InputIssue[];
  onField: (key: string, value: string) => void;
  onSeed: (value: string) => void;
  onLength: (value: string) => void;
  onGenerate: (newSeed: boolean) => void;
  onReset: () => void;
  onPrepare: () => void;
  preparing: boolean;
}
const names: Record<string, string> = {
  values: '数组 values',
  x: '整数 x',
  n: '循环次数 n',
  target: '查找目标 target',
  k: '下标 k',
};
export function InputPanel(props: Props) {
  const sequence = props.spec.fields.find((field) => field.kind === 'sequence');
  const ordered = props.spec.relations.some((relation) => relation.kind === 'nondecreasing');
  return (
    <section
      className="card section-card input-panel"
      data-testid="input-panel"
      aria-label="案例输入设置"
    >
      <h2>案例输入</h2>
      <p className="muted"></p>
      {ordered && (
        <p className="notice">
          二分搜索要求数组非递减（前一项不大于后一项）。手动乱序会被拒绝；随机生成按非递减顺序排列，查找首次匹配位置。
        </p>
      )}
      <div className="input-fields">
        {props.spec.fields.map((field) => {
          const errors = props.issues.filter((issue) => issue.field === field.key);
          return (
            <div className="input-field" key={field.key}>
              <label htmlFor={`input-${field.key}`}>{names[field.key] ?? field.key}</label>
              {field.kind === 'sequence' ? (
                <textarea
                  id={`input-${field.key}`}
                  data-testid={`input-field-${field.key}`}
                  value={props.draft[field.key] ?? ''}
                  rows={3}
                  maxLength={4097}
                  spellCheck={false}
                  aria-invalid={errors.length > 0}
                  aria-describedby={`input-help-${field.key}`}
                  onChange={(event) => props.onField(field.key, event.target.value)}
                />
              ) : (
                <input
                  id={`input-${field.key}`}
                  data-testid={`input-field-${field.key}`}
                  type="text"
                  inputMode="numeric"
                  maxLength={4097}
                  value={props.draft[field.key] ?? ''}
                  spellCheck={false}
                  aria-invalid={errors.length > 0}
                  aria-describedby={`input-help-${field.key}`}
                  onChange={(event) => props.onField(field.key, event.target.value)}
                />
              )}
              <p className="muted" id={`input-help-${field.key}`}>
                {field.kind === 'sequence'
                  ? `整数范围 ${field.min}～${field.max}；长度 ${field.minItems}～${field.maxItems}。用逗号或空格分隔；${field.minItems === 0 ? '空数组请写 []，' : ''}空白不是有效输入。`
                  : `请输入 ${field.min}～${field.max} 的十进制整数。`}
              </p>
              {field.kind === 'sequence' && field.minItems === 0 && (
                <button
                  className="button button-small"
                  onClick={() => props.onField(field.key, '[]')}
                >
                  使用空数组
                </button>
              )}
            </div>
          );
        })}
      </div>
      {sequence && <p className="muted">数组的逻辑长度 n 根据实际项数生成，无需重复填写。</p>}
      <div className="input-fields">
        {sequence && (
          <div className="input-field">
            <label htmlFor="input-length">随机数组长度</label>
            <input
              id="input-length"
              data-testid={`input-length-${sequence.key}`}
              type="text"
              inputMode="numeric"
              value={props.length}
              maxLength={33}
              onChange={(event) => props.onLength(event.target.value)}
            />
            <p className="muted">
              范围 {sequence.minItems}～{sequence.maxItems}；先选择长度，再生成。
            </p>
          </div>
        )}
      </div>
      <details>
        <summary>复现随机数据</summary>
        <div className="input-field">
          <label htmlFor="input-seed">随机种子</label>
          <input
            id="input-seed"
            data-testid="input-seed"
            type="text"
            value={props.seed}
            maxLength={257}
            spellCheck={false}
            onChange={(event) => props.onSeed(event.target.value)}
            aria-describedby="seed-help"
          />
          <p className="muted" id="seed-help">
            输入 1～128
            个字符。同一版本、输入约束、种子与长度可以生成同一组数据；种子仅在本页临时保留。
          </p>
          <button className="button button-secondary" onClick={() => props.onGenerate(false)}>
            按种子复现
          </button>
        </div>
      </details>
      {props.issues.length > 0 && (
        <ul role="alert" id="input-errors" data-testid="input-errors">
          {props.issues.map((issue, index) => (
            <li key={`${issue.field}-${index}`}>{issue.message}</li>
          ))}
        </ul>
      )}
      <div className="inline-actions">
        <button className="button button-secondary" onClick={() => props.onGenerate(true)}>
          生成随机数据
        </button>

        <button className="button button-secondary" onClick={props.onReset}>
          恢复示例输入
        </button>
        <button
          className="button button-primary"
          disabled={props.preparing || props.issues.length > 0}
          onClick={props.onPrepare}
        >
          应用输入并准备
        </button>
      </div>
    </section>
  );
}
