import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { C6TeachingReading } from '../../web/src/components/C6TeachingReading';

const render = (text: string) => renderToStaticMarkup(createElement(C6TeachingReading, { text }));

describe('complete course reading', () => {
  it('shows a page title once while retaining its full teaching and subordinate headings', () => {
    const text = '# 使用`Result`\n\n完整说明。\n\n## 使用Result\n\n~~~rust\nfn main() {}\n~~~';
    const html = renderToStaticMarkup(
      createElement(C6TeachingReading, { text, repeatedTitle: '使用Result' }),
    );
    expect(html).not.toContain('<h1>');
    expect(html).toContain('<p>完整说明。</p>');
    expect(html).toContain('<h2>使用Result</h2>');
    expect(html).toContain('fn main() {}\n');
    expect(render(text)).toContain('<h1>使用<code>Result</code></h1>');
  });

  it('retains a distinct or later heading even when its wording matches the page title', () => {
    for (const text of ['# 另一标题\n\n完整说明。', '导语。\n\n# 使用Result']) {
      const html = renderToStaticMarkup(
        createElement(C6TeachingReading, { text, repeatedTitle: '使用Result' }),
      );
      expect(html).toContain('<h1>');
    }
  });

  it('keeps Chinese explanations beside sample URLs as text and retains explicit resource links', () => {
    const sentence =
      '只保留https://catalog.example.invalid/products/1.html这一地址。about不符合allow。';
    const html = render(
      `${sentence}\n\n[官方接口](https://docs.python.org/3.13/library/queue.html)\n\n<https://example.org/manual>`,
    );
    expect(html).toContain(`<p>${sentence}</p>`);
    expect(html).not.toContain('href="https://catalog.example.invalid');
    expect(html).toContain('href="https://docs.python.org/3.13/library/queue.html"');
    expect(html).toContain('href="https://example.org/manual"');
  });

  it('retains full code, tables and bundled diagrams in the reading page', () => {
    const source = 'public class Demo {\n  // Preserve the complete example.\n}\n\n';
    const html = render(
      '## 完整例子\n\n```java\n' +
        source +
        '```\n\n| 输入 | 输出 |\n| --- | --- |\n| 2 | 4 |\n\n' +
        '![编译与运行流程](content/java/compile-flow.svg "流程图")',
    );
    expect(html).toContain('data-language="java"');
    expect(html).toContain(source);
    expect(html).toContain('<table>');
    expect(html).toContain('<td>4</td>');
    expect(html).toContain('src="/content/java/compile-flow.svg"');
    expect(html).toContain('alt="编译与运行流程"');
  });

  it.each([
    'https://example.com/tracker.png',
    '//example.com/tracker.png',
    'data:image/svg+xml,anything',
    'javascript:alert(1)',
    '/content/../private.png',
    '/content/%2e%2e/private.png',
    '/content/java/image.png?tracking=1',
    '/content/java/image.png#tracking',
  ])('does not load an unbundled or ambiguous image: %s', (href) => {
    const html = render(`![图解](<${href}>)`);
    expect(html).not.toContain('<img');
    expect(html).toContain('图解');
  });

  it('displays source HTML as text while preserving normal paragraphs', () => {
    const html = render('完整说明。\n\n<script>alert(1)</script>\n\n下一段。');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<p>下一段。</p>');
  });
});
