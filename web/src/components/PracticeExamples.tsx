import { useState } from 'react';
import './practice-examples.css';

export interface PracticeExample {
  readonly input: string;
  readonly output: string;
}

/** Samples are presentation of the question's registered cases, never calculated answers. */
export function PracticeExamples({
  samples,
  inputFormat,
  outputFormat,
}: {
  samples: readonly PracticeExample[];
  inputFormat?: string;
  outputFormat?: string;
}) {
  const [copied, setCopied] = useState('');
  const [failed, setFailed] = useState(false);
  const seen = new Set<string>();
  const examples = samples
    .filter((sample) => {
      const key = JSON.stringify([sample.input, sample.output]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 2);
  async function copy(value: string, key: string) {
    setCopied('');
    setFailed(false);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
    } catch {
      setFailed(true);
    }
  }
  return (
    <section
      className="practice-examples"
      aria-label="输入输出示例"
      data-testid="practice-examples"
    >
      {(inputFormat || outputFormat) && (
        <div className="practice-io-formats">
          {inputFormat && (
            <section>
              <h3>输入格式</h3>
              <p>{inputFormat}</p>
            </section>
          )}
          {outputFormat && (
            <section>
              <h3>输出格式</h3>
              <p>{outputFormat}</p>
            </section>
          )}
        </div>
      )}
      <p className="practice-output-policy">行尾空格和末尾换行不影响判题。</p>
      <h3>输入输出示例</h3>
      {examples.map((sample, index) => (
        <div className="practice-sample-pair" key={index} data-testid="practice-sample-pair">
          {(['input', 'output'] as const).map((kind) => {
            const label = kind === 'input' ? '输入' : '输出';
            const value = sample[kind];
            const key = `${index}:${kind}`;
            return (
              <section className="practice-sample" key={kind}>
                <header>
                  <h4>
                    {label} #{index + 1}
                  </h4>
                  <button
                    type="button"
                    className="button button-secondary practice-sample-copy"
                    aria-label={`复制${label} #${index + 1}`}
                    disabled={!value}
                    onClick={() => void copy(value, key)}
                  >
                    {copied === key ? '已复制' : '复制'}
                  </button>
                </header>
                <pre tabIndex={0} aria-label={`${label}示例 ${index + 1}`}>
                  <code>{value || (kind === 'input' ? '（无输入）' : '（无输出）')}</code>
                </pre>
                {value && !value.trim() && (
                  <p className="practice-sample-note">
                    {value === '\n'
                      ? `${label}一条空行。`
                      : `${label}仅包含空白字符，复制时会完整保留。`}
                  </p>
                )}
              </section>
            );
          })}
        </div>
      ))}
      {failed && <p role="alert">复制未完成，请在示例框内手动选择并复制。</p>}
    </section>
  );
}
