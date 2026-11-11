import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { Marked } from 'marked';
import type { Tokens } from 'marked';
import { expect, test } from '@playwright/test';
import type { JavaArticle, JavaManifest } from '../../web/src/java/content-types';
import type { PythonArticle, PythonManifest } from '../../web/src/python3/content-types';

const read = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
const markdown = new Marked();
const active = (language: 'java' | 'python3') => {
  const release = read(
    `content/build/${read(`content/build/${language}-course-current.json`).releaseFile}`,
  );
  const manifest = read(`content/${language}/course/${release.manifestFile}`) as
    JavaManifest | PythonManifest;
  return { release, manifest };
};
const article = (language: 'java' | 'python3', order: number) => {
  const entry = active(language).manifest.chunks.find((row) => row.articleSourceOrder === order)!;
  return read(`content/${language}/course/${entry.file}`) as JavaArticle | PythonArticle;
};
const program = (language: 'java' | 'python3', order: number, title: string, index: number) => {
  const node = article(language, order).nodes.find((row) => row.titleDisplay === title)!;
  const blocks = markdown
    .lexer(node.body!.join('\n\n'))
    .filter((token): token is Tokens.Code => token.type === 'code');
  return blocks[index].text;
};

test('sample URLs do not absorb Chinese explanations while explicit resource links remain usable', async ({
  page,
}) => {
  const scraper = article('python3', 69).nodes.find(
    (node) => node.titleDisplay === '12. LinkExtractor',
  )!;
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/#/python/article/69/${scraper.platformRef.id}`);
  await expect(
    page.getByRole('heading', { level: 1, name: scraper.titleDisplay, exact: true }),
  ).toBeVisible();
  const reading = page.locator('.c6-teaching-reading').first();
  await expect(reading).toContainText(
    'https://catalog.example.invalid/products/1.html这一地址。about不符合allow',
  );
  await expect(reading.locator('a[href*="catalog.example.invalid"]')).toHaveCount(0);
  const sdk = article('python3', 60).nodes.find((node) => node.titleDisplay === 'Python OpenAI')!;
  await page.goto(`/#/python/article/60/${sdk.platformRef.id}`);
  await expect(page.getByRole('link', { name: '官方Python SDK说明', exact: true })).toHaveAttribute(
    'href',
    'https://developers.openai.com/api/reference/python',
  );
});

for (const language of ['java', 'python3'] as const) {
  test(`${language} serves historical teaching editions and every diagram with exact pinned bytes`, async ({
    request,
  }) => {
    const { release, manifest } = active(language);
    const response = await request.get(`/content/${language}/course/${release.manifestFile}`);
    expect(response.ok()).toBe(true);
    const body = await response.body();
    expect(body.length).toBe(release.manifestBytes);
    expect(createHash('sha256').update(body).digest('hex')).toBe(release.manifestSha256);
    for (const file of readdirSync('content/build').filter((file) =>
      file.startsWith(`${language}-course-editorial-`),
    )) {
      const historical = read('content/build/' + file);
      const data = await request.get(`/content/${language}/course/${historical.manifestFile}`);
      expect(data.ok()).toBe(true);
      const content = await data.body();
      expect(content.length).toBe(historical.manifestBytes);
      expect(createHash('sha256').update(content).digest('hex')).toBe(historical.manifestSha256);
    }
    for (const entry of manifest.chunks.filter((row) => row.editorialRef)) {
      const data = await request.get(`/content/${language}/course/${entry.file}`);
      expect(data.ok()).toBe(true);
      const content = await data.body();
      expect(content.length).toBe(entry.bytes);
      expect(createHash('sha256').update(content).digest('hex')).toBe(entry.sha256);
      const legacy = await request.get(
        `/content/${language}/course/article-${String(entry.articleSourceOrder).padStart(2, '0')}-1.0.0.json`,
      );
      expect(legacy.ok()).toBe(true);
    }
    for (const entry of manifest.media ?? []) {
      const data = await request.get(`/content/${language}/media/${entry.file}`);
      expect(data.ok()).toBe(true);
      const content = await data.body();
      expect(content.length).toBe(entry.bytes);
      expect(createHash('sha256').update(content).digest('hex')).toBe(entry.sha256);
    }
  });
}

for (const [language, orders] of [
  ['java', [52, 57]],
  ['python3', [39, 61]],
] as const) {
  test(`${language} reference guides contain full explanations without duplicate external indexes or reading rewards`, async ({
    page,
  }) => {
    for (const order of orders) {
      const data = article(language, order);
      const legacy = read(
        `content/${language}/course/article-${String(order).padStart(2, '0')}-1.0.0.json`,
      ) as JavaArticle | PythonArticle;
      expect(data.references).toEqual(legacy.references);
      expect(data.nodes.map((node) => ({ ...node, body: undefined }))).toEqual(
        legacy.nodes.map((node) => ({ ...node, body: undefined })),
      );
      const nodes = data.nodes.filter((node) => node.status === 'reference-only');
      expect(nodes.length).toBeGreaterThan(0);
      for (const node of nodes) expect(node.body!.join('\n\n').length).toBeGreaterThan(650);
      for (const width of [1440, 810, 390]) {
        await page.setViewportSize({ width, height: 900 });
        const node = nodes[0];
        await page.goto(
          `/#/${language === 'python3' ? 'python' : language}/article/${order}/${node.platformRef.id}`,
        );
        await expect(
          page.getByRole('heading', { level: 1, name: node.titleDisplay, exact: true }),
        ).toBeVisible();
        const reading = page.locator('.python-reading');
        const blocks = markdown
          .lexer(node.body!.join('\n\n'))
          .filter((token): token is Tokens.Code => token.type === 'code');
        expect(await reading.locator('pre code').allTextContents()).toEqual(
          blocks.map((block) => block.text + '\n'),
        );
        await expect(reading.locator(':scope > ul')).toHaveCount(0);
        await expect(page.getByTestId('reading-end')).toHaveCount(0);
        await expect(reading.getByRole('link', { name: /返回.*课程目录/ })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      }
    }
  });
}

test('expanded loop teaching shows the complete state trace and a legible sequence diagram', async ({
  page,
}, testInfo) => {
  for (const width of [1440, 810, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/java/article/12/java.lesson.ef07f951e5f66d257c0b');
    const source = article('java', 12).examples.find(
      (example) => example.id === 'java.example.ef07f951e5f66d257c0b',
    )!;
    if (!('source' in source)) throw new Error('Expected the published runnable loop');
    await expect(page.locator('.c6-teaching-reading pre').first()).toHaveText(source.source);
    await expect(
      page.getByRole('cell', { name: '没有，首次测试就失败', exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath(`loop-trace-${width}.png`) });
    await page.goto('/#/java/article/12/java.source.c4187039986962488a3b');
    const diagram = page.getByRole('img', {
      name: 'while、do while和for的条件与状态更新顺序',
      exact: true,
    });
    await diagram.scrollIntoViewIfNeeded();
    await expect
      .poll(() => diagram.evaluate((node) => (node as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await diagram.locator('..').getByRole('button', { name: '放大图解', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`loop-diagram-${width}.png`) });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await page
      .getByRole('navigation', { name: '返回课程', exact: true })
      .getByRole('link', { name: '← 返回课程目录', exact: true })
      .click();
    await expect(page).toHaveURL(/#\/java$/);
  }
});

test('collection choices keep Map separate and the diagram readable at three widths', async ({
  page,
}, testInfo) => {
  for (const width of [1440, 810, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/java/article/37/java.lesson.541b9f1ca466d4ecea3f');
    const diagram = page.getByRole('img', {
      name: 'Collection下的常用入口与独立Map分支功能示意',
      exact: true,
    });
    await diagram.scrollIntoViewIfNeeded();
    await expect
      .poll(() => diagram.evaluate((node) => (node as HTMLImageElement).naturalWidth))
      .toBe(1260);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await diagram.locator('..').getByRole('button', { name: '放大图解', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('img')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`collection-choices-${width}.png`) });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  }
});

test('CGI reading preserves response escapes and the complete browser-server flow diagram', async ({
  page,
}, testInfo) => {
  const node = article('python3', 42).nodes.find(
    (row) => row.platformRef.id === 'py3.section.6f468113c85bf9874f89dd30',
  )!;
  const source = markdown
    .lexer(node.body!.join('\n\n'))
    .filter(
      (token): token is Tokens.Code => token.type === 'code' && token.lang === 'python',
    )[0].text;
  expect(source).toContain('\\r\\n');
  for (const width of [1440, 810, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/python/article/42/py3.section.6f468113c85bf9874f89dd30');
    await expect(
      page.getByRole('heading', { level: 1, name: node.titleDisplay, exact: true }),
    ).toBeVisible();
    expect(
      await page.locator('.c6-teaching-reading').first().locator('pre').first().textContent(),
    ).toBe(source + '\n');
    await page.goto('/#/python/article/42/py3.section.f4104ae25f35cc604b26a06e');
    const diagram = page.getByRole('img', {
      name: '浏览器发HTTP请求，服务器通过环境与stdin调用CGI，脚本响应再返回浏览器',
      exact: true,
    });
    await diagram.scrollIntoViewIfNeeded();
    await expect
      .poll(() => diagram.evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBe(1260);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await diagram.locator('..').getByRole('button', { name: '放大图解', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`cgi-flow-${width}.png`) });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
});

test('escaped Java source and the UTF-16 explanation remain complete on a phone', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/#/java/article/16/java.source.e304eae1f9c24ebdd89e');
  const table = page.locator('.c6-teaching-reading').first().locator('table');
  await expect(table).toBeVisible();
  expect(await table.locator('tbody tr td:first-child').allTextContents()).toEqual([
    '\\n',
    '\\r',
    '\\t',
    '\\\\',
    '\\"',
    "\\'",
    '\\b',
    '\\f',
  ]);
  await table.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('java-escaped-source-phone.png') });
  await page.goto('/#/java/article/21/java.lesson.fa7f844529b0f0432b40');
  const patterns = page.locator('.c6-teaching-reading').first().locator('table');
  await expect(patterns).toBeVisible();
  expect(await patterns.locator('tbody tr td:first-child').allTextContents()).toEqual([
    '\\.',
    '\\d+',
    '\\\\',
  ]);
  await patterns.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('java-regex-escaped-patterns-phone.png') });
  await page.goto('/#/java/article/17/java.lesson.a1541210b46dc9301e13');
  const source = article('java', 17).examples.find(
    (example) => example.id === 'java.example.a1541210b46dc9301e13',
  )!;
  if (!('source' in source)) throw new Error('Expected the published string-length program');
  await expect(page.locator('.c6-teaching-reading pre').first()).toHaveText(source.source);
  const diagram = page.getByRole('img', {
    name: '树与微笑符号的两个码点对应三个UTF-16代码单元',
    exact: true,
  });
  await diagram.scrollIntoViewIfNeeded();
  await expect
    .poll(() => diagram.evaluate((node) => (node as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  await diagram.locator('..').getByRole('button', { name: '放大图解', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('java-utf16-units-phone.png') });
  await dialog
    .getByRole('region', { name: '放大图解，可横向滚动', exact: true })
    .evaluate((node) => {
      node.scrollLeft = node.scrollWidth;
    });
  await page.screenshot({ path: testInfo.outputPath('java-utf16-units-phone-right.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Python stack and queue teaching keeps distinct removal paths readable at three widths', async ({
  page,
}, testInfo) => {
  for (const width of [1440, 810, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/python/article/27/py3.chapter.python3-data-structure');
    const diagram = page.getByRole('img', {
      name: '同样先加入A、B、C，栈先取出C，队列先取出A',
      exact: true,
    });
    await diagram.scrollIntoViewIfNeeded();
    await expect
      .poll(() => diagram.evaluate((node) => (node as HTMLImageElement).naturalWidth))
      .toBe(1120);
    await diagram.locator('..').getByRole('button', { name: '放大图解', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`python-stack-queue-${width}.png`) });
    if (width === 390) {
      await dialog
        .getByRole('region', { name: '放大图解，可横向滚动', exact: true })
        .evaluate((node) => {
          node.scrollLeft = node.scrollWidth;
        });
      await page.screenshot({ path: testInfo.outputPath('python-stack-queue-phone-right.png') });
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});

for (const [language, order] of [
  ['java', 1],
  ['python3', 4],
] as const) {
  test(`${language} example captions open their teaching context instead of an empty lesson`, async ({
    page,
  }) => {
    const unit = article(language, order);
    const caption = unit.nodes.find((node) => node.status === 'context-only')!;
    let parent = unit.nodes.find((node) => node.sourceNodeId === caption.parent)!;
    while (parent.status === 'context-only') {
      const parentId = parent.parent;
      parent = unit.nodes.find((node) => node.sourceNodeId === parentId)!;
    }
    const path = language === 'python3' ? 'python' : language;
    await page.goto(`/#/${path}/article/${order}/${caption.platformRef.id}`);
    await expect(page).toHaveURL(new RegExp(parent.platformRef.id.replaceAll('.', '\\.') + '$'));
    await expect(
      page.getByRole('heading', { name: parent.titleDisplay, level: 1, exact: true }),
    ).toBeVisible();
    await expect(page.getByText('这是原文章中的示例标题。', { exact: true })).toHaveCount(0);
  });
}

test('new Java explanations retain full programs and readable diagrams at three widths', async ({
  page,
}, testInfo) => {
  for (const width of [1440, 810, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/java/article/2/java.lesson.6b7b5f950b05e17d1042');
    await expect(
      page.getByRole('heading', { name: '类型检查把一部分错误提前暴露', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.c6-teaching-reading pre').first()).toContainText('int seats = 24;');
    const diagram = page.getByRole('img', {
      name: 'original与alias保存的引用指向同一数组',
      exact: true,
    });
    await diagram.scrollIntoViewIfNeeded();
    await expect
      .poll(() => diagram.evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    const openDiagram = diagram
      .locator('..')
      .getByRole('button', { name: '放大图解', exact: true });
    expect((await openDiagram.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await openDiagram.click();
    const enlarged = page.getByRole('dialog', {
      name: 'original与alias保存的引用指向同一数组',
      exact: true,
    });
    await expect(enlarged).toBeVisible();
    await expect(enlarged.getByRole('img')).toBeVisible();
    const closeDiagram = enlarged.getByRole('button', { name: '关闭图解', exact: true });
    expect((await closeDiagram.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await closeDiagram.click();
    await expect(enlarged).toHaveCount(0);
    const textSize = await page
      .locator('.c6-teaching-reading p')
      .first()
      .evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize));
    expect(textSize).toBeGreaterThanOrEqual(16);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`detailed-java-${width}.png`) });
    await page.getByRole('heading', { name: '主要特性', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`detailed-java-top-${width}.png`) });
  }
  await page.locator('.theme-mode-toggle').click();
  const diagram = page.getByRole('img', {
    name: 'original与alias保存的引用指向同一数组',
    exact: true,
  });
  await diagram.locator('..').getByRole('button', { name: '放大图解', exact: true }).click();
  const enlarged = page.getByRole('dialog');
  await expect(enlarged).not.toHaveCSS('background-color', 'rgb(255, 255, 255)');
  const close = enlarged.getByRole('button', { name: '关闭图解', exact: true });
  const colors = await enlarged.evaluate((node) => ({
    color: getComputedStyle(node).color,
    background: getComputedStyle(node).backgroundColor,
  }));
  await expect(close).toHaveCSS('color', colors.color);
  await expect(close).toHaveCSS('background-color', colors.background);
  await page.screenshot({ path: testInfo.outputPath('diagram-dark-phone.png') });
  await page.keyboard.press('Escape');
  await expect(enlarged).toHaveCount(0);
});

const javaOutputs = [
  '图书室开放了\n开放时间：09:00—17:00\n',
  '晨班到站\n',
  '晨班到站\n请从前门上车\n',
  '180\n',
  '21\n',
  '9\n',
  'Environment ready\n42\n',
  'Learning started\n3\n',
  'Planned lessons\n5\n',
  '借阅数量：3\n归还一本后：2\n',
  '你好，小林\n已完成：2\n',
  '0\n检查结束\n',
  '3\n8\n',
  null,
  null,
  'scores[0]=82\nscores[1]=0\nscores[2]=95\nlength=3\n',
  null,
  null,
  'false\n2\n',
  'https://school.example/learn\n3\n',
  '剩余课程\n3\n',
  null,
  null,
];
const javaReadingBoundaries = new Map([
  [5, 'E_JAVA_SYNTAX'],
  [9, 'E_JAVA_UNSUPPORTED'],
]);
for (const [index, stdout] of javaOutputs.entries()) {
  if (stdout === null) continue;
  test(`new Java reading program ${index + 1}`, async ({ page }) => {
    await page.goto('/checks/java.html');
    await page.waitForFunction(() => Boolean(window.javaHarness));
    const sources = [1, 2, 3, 4].flatMap((order) =>
      article('java', order).nodes.flatMap((node) =>
        markdown
          .lexer(node.body?.join('\n\n') ?? '')
          .filter((token): token is Tokens.Code => token.type === 'code' && token.lang === 'java')
          .map((token) => token.text),
      ),
    );
    expect(sources).toHaveLength(javaOutputs.length);
    const source = sources[index];
    const result = await page.evaluate((source) => window.javaHarness.run(source, ''), source);
    const readingBoundary = javaReadingBoundaries.get(index);
    if (readingBoundary) {
      expect(result.terminal.status).toBe('error');
      expect(result.terminal.diagnostic?.code).toBe(readingBoundary);
      expect(result.terminal.cursor).toBe(0);
      return;
    }
    expect(result.terminal.status, JSON.stringify(result.terminal)).toBe('completed');
    expect(result.end?.state.output).toBe(stdout);
  });
}

for (const sample of [
  { title: 'Python 3 教程', order: 1, block: 0, input: '', stdout: '图书角已准备好\n' },
  { title: '第一个Python3.x程序', order: 1, block: 0, input: '地理\n', stdout: '借阅：地理\n' },
  {
    title: '第一个Python3.x程序',
    order: 1,
    block: 0,
    input: '  地理 \n',
    stdout: '借阅：  地理 \n',
  },
  { title: '第一个Python3.x程序', order: 1, block: 0, input: '\n', stdout: '借阅：\n' },
  { title: 'Python3 简介', order: 2, block: 0, input: '', stdout: '3\n' },
  { title: 'Python 特点', order: 2, block: 0, input: '', stdout: '5\n41\n' },
]) {
  test(`new Python reading program: ${sample.title}/${sample.block}/${JSON.stringify(sample.input)}`, async ({
    page,
  }) => {
    await page.goto('/checks/python3.html');
    await page.waitForFunction(() => Boolean(window.python3Harness));
    const source = program('python3', sample.order, sample.title, sample.block);
    const result = await page.evaluate(
      ({ source, input }) => window.python3Harness.run(source, input),
      { source, input: sample.input },
    );
    expect(result.terminal.status).toBe('completed');
    expect(result.end?.state.output).toBe(sample.stdout);
  });
}
