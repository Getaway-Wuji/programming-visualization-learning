# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: phase2-integration.spec.ts >> one native archive connects real failure, review, completion, challenge, both execution families and downloaded current state
- Location: tests\browser\phase2-integration.spec.ts:14:1

# Error details

```
Test timeout of 90000ms exceeded.
```

```
Error: locator.click: Test timeout of 90000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: '记得', exact: true })

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - link "跳到主要内容" [ref=e4] [cursor=pointer]:
    - /url: "#main-content"
  - complementary [ref=e5]:
    - button "收起侧栏" [expanded] [ref=e6] [cursor=pointer]
    - link "编程可视化教学平台 · 学习首页" [ref=e10] [cursor=pointer]:
      - /url: "#/"
      - generic [ref=e11]: "{ }"
      - generic [ref=e12]:
        - text: 一步一懂
        - generic [ref=e13]: 编程可视化教学平台
    - paragraph [ref=e14]: 从代码，到理解。
    - navigation "主导航" [ref=e15]:
      - link "学习首页" [ref=e16] [cursor=pointer]:
        - /url: "#/"
      - link "C 语言课程" [ref=e20] [cursor=pointer]:
        - /url: "#/courses"
      - link "算法与演示" [ref=e24] [cursor=pointer]:
        - /url: "#/cases"
      - link "编译流程" [ref=e28] [cursor=pointer]:
        - /url: "#/compilation"
      - link "错题与陌生点" [ref=e32] [cursor=pointer]:
        - /url: "#/notebook"
      - link "今日复习" [ref=e36] [cursor=pointer]:
        - /url: "#/reviews"
      - link "学习成就" [ref=e40] [cursor=pointer]:
        - /url: "#/achievements"
      - link "本地设置" [ref=e44] [cursor=pointer]:
        - /url: "#/settings"
    - generic [ref=e48]:
      - strong [ref=e51]: 按自己的节奏学习
      - paragraph [ref=e52]: 学习记录将保存在当前浏览器，不跨设备同步。
      - link "了解本地数据" [ref=e53] [cursor=pointer]:
        - /url: "#/settings?panel=data"
  - generic [ref=e56]:
    - banner [ref=e57]:
      - generic [ref=e58]: C 语言 · 从零开始
      - generic [ref=e59]:
        - generic [ref=e60]: 本地学习
        - link "本地数据" [ref=e61] [cursor=pointer]:
          - /url: "#/settings?panel=data"
        - button "切换为深色" [ref=e65] [cursor=pointer]
    - main [ref=e68]:
      - generic [ref=e69]:
        - generic [ref=e70]:
          - paragraph [ref=e71]: 本地复习
          - heading "今日复习" [active] [level=1] [ref=e72]
          - paragraph [ref=e73]: 回顾真实错题和自己标记的陌生点，再用自评安排下一次复习。
        - status [ref=e74]:
          - paragraph [ref=e75]: 复习计划已保存于当前浏览器。
        - paragraph [ref=e76]: 2026-10-31 · Asia/Shanghai · 自评不代表练习通过，不增加积分或课程完成。
        - paragraph [ref=e77]: 到期 1 · 未到期 0 · 暂停 0
        - generic [ref=e78]:
          - region "复习卡片列表" [ref=e79]:
            - generic [ref=e80]:
              - heading "到期 · 1" [level=2] [ref=e81]
              - list [ref=e82]:
                - listitem [ref=e83]:
                  - button "输出输入变量 错题 · 2026-10-31" [pressed] [ref=e84] [cursor=pointer]:
                    - generic [ref=e85]: 输出输入变量
                    - generic [ref=e86]: 错题 · 2026-10-31
            - generic [ref=e87]:
              - heading "未到期 · 0" [level=2] [ref=e88]
              - paragraph [ref=e89]: 没有尚未到期的计划。
            - generic [ref=e90]:
              - heading "暂停 · 0" [level=2] [ref=e91]
              - paragraph [ref=e92]: 没有暂停的卡片。
          - region [ref=e93]:
            - paragraph [ref=e94]: 真实错题复习
            - heading "输出输入变量" [level=2] [ref=e95]
            - paragraph [ref=e96]: 待复习 · 下次复习 2026-10-31 · 已评价 0 次
            - paragraph [ref=e97]: 先回顾来源，想一想概念或解题方法，再选择最接近当前情况的评价。
            - generic [ref=e98]:
              - link "复习：变量和输出" [ref=e99] [cursor=pointer]:
                - /url: "#/lessons/lesson.c.variables-output"
              - link "重新练习" [ref=e100] [cursor=pointer]:
                - /url: "#/practice/exercise.c.echo"
            - generic "本次复习评价" [ref=e101]:
              - button "重学 下次 2026-11-01" [ref=e102] [cursor=pointer]:
                - generic [ref=e103]: 重学
                - generic [ref=e104]: 下次 2026-11-01
              - button "吃力 下次 2026-11-01" [ref=e105] [cursor=pointer]:
                - generic [ref=e106]: 吃力
                - generic [ref=e107]: 下次 2026-11-01
              - button "记得 下次 2026-11-01" [ref=e108] [cursor=pointer]:
                - generic [ref=e109]: 记得
                - generic [ref=e110]: 下次 2026-11-01
              - button "熟练 下次 2026-11-03" [ref=e111] [cursor=pointer]:
                - generic [ref=e112]: 熟练
                - generic [ref=e113]: 下次 2026-11-03
            - button "重新学习此卡（今天到期）" [ref=e114] [cursor=pointer]
        - group [ref=e115]:
          - generic "复习日期怎样安排" [ref=e116] [cursor=pointer]
```

# Test source

```ts
  1   | import { readFileSync } from 'node:fs';
  2   | import { mkdir, writeFile } from 'node:fs/promises';
  3   | import { gzipSync } from 'node:zlib';
  4   | import { test, expect } from '@playwright/test';
  5   | import { openAnswer, code, panel, submit, confirm, ready } from './notebook-helpers';
  6   | import { native } from './achievement-helpers';
  7   | import { observeCaseSetExecution, observedCaseSetExecute } from './case-set-observation';
  8   | import { waitForPhase2Archive } from './phase2-ready';
  9   | import type { SnapshotDocument } from '../../web/src/snapshot-export/types';
  10  | 
  11  | const directory = `.artifacts/16.10/combined/${process.env.TASK_EVIDENCE_LABEL}`;
  12  | const questions = JSON.parse(readFileSync('content/challenges/cases-1.0.0.json', 'utf8'))
  13  |   .questions as { ref: { id: string }; anchorKind: string }[];
  14  | test('one native archive connects real failure, review, completion, challenge, both execution families and downloaded current state', async ({
  15  |   page: p,
  16  | }) => {
  17  |   test.setTimeout(90000);
  18  |   await mkdir(directory, { recursive: true });
  19  |   await observeCaseSetExecution(p);
  20  |   await openAnswer(p, 'exercise.c.echo');
  21  |   await waitForPhase2Archive(p);
  22  |   const solution = await code(p).inputValue(),
  23  |     wrong = solution.replace(/\bx\);/, '0);');
  24  |   expect(wrong).not.toBe(solution);
  25  |   await code(p).fill(wrong);
  26  |   await expect(p.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'synced');
  27  |   await panel(p).getByRole('button', { name: '提交练习', exact: true }).click();
  28  |   await expect(panel(p)).toHaveAttribute('data-state', 'unmet');
  29  |   await expect(p.getByTestId('practice-attempt-save')).toHaveAttribute('data-save-state', 'saved');
  30  |   await writeFile(
  31  |     `${directory}/wrong-worker.json.gz`,
  32  |     gzipSync(JSON.stringify(await observedCaseSetExecute(p))),
  33  |     { flag: 'wx' },
  34  |   );
  35  |   await p.goto('/#/notebook');
  36  |   await expect(p.locator('[data-mistake-id="exercise.c.echo"]')).toHaveCount(1);
  37  |   await p.goto('/#/reviews');
  38  |   await expect(p.getByTestId('review-detail')).toBeVisible();
> 39  |   await p.getByRole('button', { name: '记得', exact: true }).click();
      |                                                            ^ Error: locator.click: Test timeout of 90000ms exceeded.
  40  |   await expect.poll(async () => (await native(p)).reviewCards[0]?.reviewCount).toBe(1);
  41  |   await openAnswer(p, 'exercise.c.echo');
  42  |   await submit(p);
  43  |   await confirm(p, 'lesson.c.variables-output');
  44  |   const completed = await native(p);
  45  |   expect(completed.progress.some((r) => r.eventType === 'lesson.completed')).toBe(true);
  46  |   expect(completed.progress.some((r) => r.eventType === 'exercise.passed')).toBe(true);
  47  |   await p.goto('/#/visualize/case.c.assignment');
  48  |   await ready(p);
  49  |   await p.getByRole('button', { name: '运行示例', exact: true }).click();
  50  |   await expect(p.getByTestId('case-execution')).toHaveAttribute('data-state', 'completed');
  51  |   await p.getByRole('button', { name: '预测挑战', exact: true }).click();
  52  |   await p
  53  |     .getByRole('group', { name: '本次挑战题目', exact: true })
  54  |     .getByRole('button')
  55  |     .first()
  56  |     .click();
  57  |   const id = await p.getByTestId('challenge-question').getAttribute('data-question-id'),
  58  |     question = questions.find((q) => q.ref.id === id)!;
  59  |   await p.locator(`[data-answer-kind="${question.anchorKind}"]`).click();
  60  |   await expect(p.getByTestId('challenge-feedback')).toContainText('本次答案已保存');
  61  |   const answered = await native(p);
  62  |   expect(answered.progress).toEqual(completed.progress);
  63  |   expect(answered.dailyFacts).toEqual(completed.dailyFacts);
  64  |   expect(
  65  |     answered.ledger.filter((r) => r.sourceId === 'reward.challenge.first-answer'),
  66  |   ).toHaveLength(1);
  67  |   await p.goto('/#/compare?pair=cpp-recursive');
  68  |   await ready(p);
  69  |   await p.getByTestId('pair-input').fill('7 -3 0 5 -3 2 9');
  70  |   await p.getByRole('button', { name: '应用共同输入', exact: true }).click();
  71  |   await p.getByRole('button', { name: '运行两份C++', exact: true }).click();
  72  |   await expect(p.getByTestId('recursive-comparison')).toHaveAttribute('data-phase', 'settled');
  73  |   for (const index of [0, 1])
  74  |     await expect(p.getByTestId(`pair-lane-${index}`)).toHaveAttribute('data-phase', 'accepted');
  75  |   await p.getByRole('slider', { name: 'C++对比统一步骤', exact: true }).fill('10');
  76  |   await expect(p.getByTestId('pair-lane-0')).toHaveAttribute('data-cursor', '10');
  77  |   await expect(p.getByTestId('pair-lane-1')).toHaveAttribute('data-cursor', '10');
  78  |   expect(await native(p)).toEqual(answered);
  79  |   await p.goto('/#/memory?example=nodes&view=memory');
  80  |   await ready(p);
  81  |   await p.getByRole('button', { name: '运行样例', exact: true }).click();
  82  |   const memory = p.getByTestId('memory-workspace');
  83  |   await expect(memory).toHaveAttribute('data-state', 'ready');
  84  |   const run = await memory.getAttribute('data-run-id'),
  85  |     slider = p.getByRole('slider', { name: '执行步骤', exact: true }),
  86  |     length = Number(await slider.getAttribute('max')),
  87  |     cursor = Math.floor(length / 2);
  88  |   expect(cursor).toBeGreaterThan(0);
  89  |   await slider.fill(String(cursor));
  90  |   await p.getByRole('button', { name: '调用栈视图', exact: true }).click();
  91  |   await expect(memory).toHaveAttribute('data-cursor', String(cursor));
  92  |   await expect(memory).toHaveAttribute('data-run-id', run!);
  93  |   await p.getByRole('button', { name: '内存视图', exact: true }).click();
  94  |   const download = p.waitForEvent('download');
  95  |   await p.getByRole('button', { name: '下载状态文件（JSON）', exact: true }).click();
  96  |   const file = await download;
  97  |   await file.saveAs(`${directory}/current-state.json`);
  98  |   const document = JSON.parse(
  99  |     readFileSync(`${directory}/current-state.json`, 'utf8'),
  100 |   ) as SnapshotDocument;
  101 |   expect(document.position.cursor).toBe(cursor);
  102 |   expect(document.currentState).toBeTruthy();
  103 |   await writeFile(
  104 |     `${directory}/memory-worker.json.gz`,
  105 |     gzipSync(JSON.stringify(await observedCaseSetExecute(p))),
  106 |     { flag: 'wx' },
  107 |   );
  108 |   expect(await native(p)).toEqual(answered);
  109 |   await p.goto('/#/');
  110 |   await p.reload();
  111 |   await ready(p);
  112 |   const restored = await native(p);
  113 |   expect(restored.progress).toEqual(answered.progress);
  114 |   expect(restored.ledger).toEqual(answered.ledger);
  115 |   expect(restored.reviewCards).toEqual(answered.reviewCards);
  116 |   expect(restored.meta.generation).toBe(answered.meta.generation);
  117 |   await writeFile(
  118 |     `${directory}/native-states.json`,
  119 |     JSON.stringify(
  120 |       { task: '16.10', completed, answered, restored, exportCursor: cursor, run },
  121 |       null,
  122 |       2,
  123 |     ) + '\n',
  124 |     { flag: 'wx' },
  125 |   );
  126 |   await p.screenshot({ path: `${directory}/restored-home.png`, fullPage: true });
  127 | });
  128 | 
```