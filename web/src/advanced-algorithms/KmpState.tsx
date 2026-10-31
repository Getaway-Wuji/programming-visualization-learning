import type { AdvancedState } from '../engine/advanced-protocol';
import { projectKmpState } from './kmp-content';
export function KmpState({ state }: { state: AdvancedState }) {
  const v = projectKmpState(state),
    s = v.scalars;
  return (
    <section
      className="kmp-state"
      aria-label="KMP真实字符与前缀状态"
      data-testid="kmp-state"
      data-phase={s.phase ?? 'absent'}
    >
      <h3>字符、前缀表与指针</h3>
      <p>
        {s.phase === null
          ? '本阶段对象尚未声明或已结束；后退可查看存活状态。'
          : ['读取输入', '构造前缀表', '匹配文本', '搜索结束'][s.phase]}
      </p>
      <p>
        下标从0开始，在可打印ASCII范围内同时表示字节和字符位置。␠表示一个实际空格；空串没有字符槽。
      </p>
      {v.strings.map((row) => {
        const pointers =
          row.name === 'text'
            ? s.phase === 2 && s.textIndex !== null
              ? [s.textIndex]
              : []
            : s.phase === 1
              ? [s.buildIndex, s.border].filter((n): n is number => n !== null)
              : s.phase === 2 && s.matched !== null
                ? [s.matched]
                : [];
        return (
          <section
            key={row.name}
            data-testid="kmp-string"
            data-name={row.name}
            data-present={row.present}
            data-value={row.value ?? ''}
          >
            <h4>{row.name === 'text' ? 'text · 文本' : 'pattern · 模式'}</h4>
            {row.value === null ? (
              <p>此字符串尚未声明或已结束。</p>
            ) : (
              <>
                <p>
                  当前真实长度{row.value.length}；
                  {pointers.length
                    ? `指针位置${pointers.join('、')}。等于长度时位于边界，不读取字符。`
                    : '此阶段没有字符读取指针。'}
                </p>
                {row.value.length ? (
                  <ol className="advanced-array-grid kmp-character-grid">
                    {Array.from(row.value, (char, i) => (
                      <li key={i} data-index={i} data-current={pointers.includes(i)}>
                        <small>
                          [{i}]{pointers.includes(i) ? ' · 指针' : ''}
                        </small>
                        <strong>{char === ' ' ? '␠' : char}</strong>
                        <small>ASCII {char.charCodeAt(0)}</small>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p>空串（长度0）。</p>
                )}
              </>
            )}
          </section>
        );
      })}
      <section
        data-testid="kmp-prefix"
        data-present={v.prefix.present}
        data-extent={v.prefix.extent ?? 'unknown'}
      >
        <h4>prefix · 最长真前后缀长度</h4>
        {v.prefix.present ? (
          <>
            <p>
              物理容量{v.prefix.capacity}，当前逻辑长度{v.prefix.extent ?? '尚未声明m'}；built=
              {s.built ?? '尚未声明'}。尚未写入的槽保持未初始化。
            </p>
            {v.prefix.values.length ? (
              <ol className="advanced-array-grid">
                {v.prefix.values.map((n, i) => (
                  <li key={i} data-index={i} data-current={s.phase === 1 && s.buildIndex === i}>
                    <small>[{i}]</small>
                    <strong>{n === null ? '未初始化' : n}</strong>
                  </li>
                ))}
              </ol>
            ) : (
              <p>当前没有逻辑前缀项。</p>
            )}
          </>
        ) : (
          <p>此前缀数组尚未声明或已结束。</p>
        )}
      </section>
      <dl className="kmp-scalars">
        {Object.entries(s).map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd data-testid="kmp-scalar" data-name={key}>
              {value ?? '尚未声明或已结束'}
            </dd>
          </div>
        ))}
      </dl>
      <p className="muted">
        phase：0读取、1建表、2匹配、3结束。buildIndex/border用于建表，textIndex/matched用于匹配；它们都是程序实际标量。完整匹配后matched可以等于m，随后不再读取pattern[matched]。
      </p>
    </section>
  );
}
