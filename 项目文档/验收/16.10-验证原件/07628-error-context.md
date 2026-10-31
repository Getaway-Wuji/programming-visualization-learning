# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: p05-course.spec.ts >> P05 fresh archive: 32 real code answers and 140 groups produce 32 confirmed completions and durable deduplicated rewards
- Location: tests\browser\p05-course.spec.ts:615:1

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  locator('.case-grid .case-card .card-link')
Expected: 7
Received: 14
Timeout:  5000ms

Call log:
  - Expect "toHaveCount" locator('.case-grid .case-card .card-link') with timeout 5000ms
  - waiting for locator('.case-grid .case-card .card-link')
    4 × locator resolved to 0 elements
      - unexpected value "0"
    10 × locator resolved to 14 elements
       - unexpected value "14"

```

# Page snapshot

```yaml
- generic [ref=f1e3]:
  - link "跳到主要内容" [ref=f1e4] [cursor=pointer]:
    - /url: "#main-content"
  - complementary [ref=f1e5]:
    - button "收起侧栏" [expanded] [ref=f1e6] [cursor=pointer]
    - link "编程可视化教学平台 · 学习首页" [ref=f1e10] [cursor=pointer]:
      - /url: "#/"
      - generic [ref=f1e11]: "{ }"
      - generic [ref=f1e12]:
        - text: 一步一懂
        - generic [ref=f1e13]: 编程可视化教学平台
    - paragraph [ref=f1e14]: 从代码，到理解。
    - navigation "主导航" [ref=f1e15]:
      - link "学习首页" [ref=f1e16] [cursor=pointer]:
        - /url: "#/"
      - link "C 语言课程" [ref=f1e20] [cursor=pointer]:
        - /url: "#/courses"
      - link "算法与演示" [ref=f1e24] [cursor=pointer]:
        - /url: "#/cases"
      - link "编译流程" [ref=f1e28] [cursor=pointer]:
        - /url: "#/compilation"
      - link "错题与陌生点" [ref=f1e32] [cursor=pointer]:
        - /url: "#/notebook"
      - link "今日复习" [ref=f1e36] [cursor=pointer]:
        - /url: "#/reviews"
      - link "学习成就" [ref=f1e40] [cursor=pointer]:
        - /url: "#/achievements"
      - link "本地设置" [ref=f1e44] [cursor=pointer]:
        - /url: "#/settings"
    - generic [ref=f1e48]:
      - strong [ref=f1e51]: 按自己的节奏学习
      - paragraph [ref=f1e52]: 学习记录将保存在当前浏览器，不跨设备同步。
      - link "了解本地数据" [ref=f1e53] [cursor=pointer]:
        - /url: "#/settings?panel=data"
  - generic [ref=f1e56]:
    - banner [ref=f1e57]:
      - generic [ref=f1e58]: C 语言 · 从零开始
      - generic [ref=f1e59]:
        - generic [ref=f1e60]: 本地学习
        - link "本地数据" [ref=f1e61] [cursor=pointer]:
          - /url: "#/settings?panel=data"
        - button "切换为深色" [ref=f1e65] [cursor=pointer]
    - main [ref=f1e68]:
      - generic [ref=f1e69]:
        - navigation "当前位置" [ref=f1e70]:
          - list [ref=f1e71]:
            - listitem [ref=f1e72]:
              - link "学习首页" [ref=f1e73] [cursor=pointer]:
                - /url: "#/"
            - listitem [ref=f1e74]:
              - generic [ref=f1e77]: 算法与演示
        - generic [ref=f1e78]:
          - paragraph [ref=f1e79]: 看懂程序怎样执行
          - heading "让数据变化，有迹可循。" [active] [level=1] [ref=f1e80]
          - paragraph [ref=f1e81]: 选择案例、输入数据，运行实际源码并逐步查看变化。原C案例完整观看后主动确认可获首次奖励；新增C++观察不计积分。
        - generic [ref=f1e82]:
          - paragraph [ref=f1e83]: 标准内容样例 · 尚未正式发布
          - paragraph [ref=f1e84]: 内容版本 1.0.0 · 只读预览，浏览不会产生学习记录或奖励。
          - paragraph [ref=f1e85]: 已读取 4 个语法演示和 3 个算法案例样例。下方 7 个已审核案例独立开放观看确认；本样例目录的读取与检查不触发奖励。选择案例后可查看讲解、设置输入并运行，支持单步、回退与重播。
        - paragraph [ref=f1e86]:
          - link "打开同数据双算法对比" [ref=f1e87] [cursor=pointer]:
            - /url: "#/compare"
          - text: 分别运行冒泡与选择排序，统一回放并核对真实比较、交换和写入计数。
        - paragraph [ref=f1e88]:
          - link "打开递归与调用栈" [ref=f1e89] [cursor=pointer]:
            - /url: "#/memory?example=hanoi&view=stack"
          - text: 用汉诺塔与快速排序观察函数进入、返回及局部状态，点击源码行号设置断点。
        - paragraph [ref=f1e90]:
          - link "打开内存观察" [ref=f1e91] [cursor=pointer]:
            - /url: "#/memory"
          - text: 逐步查看指针、对象与教学地址。
        - region [ref=f1e92]:
          - generic [ref=f1e93]:
            - heading "C++ · 迭代排序" [level=2] [ref=f1e94]
            - generic [ref=f1e95]: 3个独立案例
          - paragraph [ref=f1e96]: 通过实际C++程序观察插入、间隔分组和计数回填。此组观察不记课程进度或积分。
          - generic [ref=f1e97]:
            - article [ref=f1e98]:
              - heading "插入排序" [level=3] [ref=f1e99]
              - paragraph [ref=f1e100]: 暂存一个数，将左侧较大的元素右移，再放回空位。
              - paragraph [ref=f1e101]: 0～30项 · -999～999 · C++受支持子集
              - link "查看插入排序工作区 →" [ref=f1e102] [cursor=pointer]:
                - /url: "#/algorithms/case.cpp.insertion-sort"
            - article [ref=f1e103]:
              - heading "希尔排序" [level=3] [ref=f1e104]
              - paragraph [ref=f1e105]: 按逐次减半的间隔做插入，最后以间隔1完成整理。
              - paragraph [ref=f1e106]: 0～30项 · -999～999 · C++受支持子集
              - link "查看希尔排序工作区 →" [ref=f1e107] [cursor=pointer]:
                - /url: "#/algorithms/case.cpp.shell-sort"
            - article [ref=f1e108]:
              - heading "计数排序" [level=3] [ref=f1e109]
              - paragraph [ref=f1e110]: 将−20～20映射到41个频率桶，再从小到大回填原数组。
              - paragraph [ref=f1e111]: 0～30项 · -20～20 · C++受支持子集
              - link "查看计数排序工作区 →" [ref=f1e112] [cursor=pointer]:
                - /url: "#/algorithms/case.cpp.counting-sort"
        - region [ref=f1e113]:
          - generic [ref=f1e114]:
            - heading "C++ · 递归排序" [level=2] [ref=f1e115]
            - generic [ref=f1e116]: 2个独立案例与同数据对比
          - paragraph [ref=f1e117]: 观察真实调用帧、共享数组别名与当前存储。归并借助辅助数组，快速递归较小区间；不计课程进度或积分。
          - generic [ref=f1e118]:
            - article [ref=f1e119]:
              - heading "归并排序" [level=3] [ref=f1e120]
              - paragraph [ref=f1e121]: 递归整理两个闭区间，借助同一个辅助数组合并，再写回原区间。
              - paragraph [ref=f1e122]: 0～30项 · −999～999 · C++受支持子集
              - link "查看归并排序工作区 →" [ref=f1e123] [cursor=pointer]:
                - /url: "#/algorithms/case.cpp.merge-sort"
            - article [ref=f1e124]:
              - heading "快速排序" [level=3] [ref=f1e125]
              - paragraph [ref=f1e126]: 以区间末项为枢轴分区，递归较小的一侧，在当前帧循环处理较大的一侧。
              - paragraph [ref=f1e127]: 0～30项 · −999～999 · C++受支持子集
              - link "查看快速排序工作区 →" [ref=f1e128] [cursor=pointer]:
                - /url: "#/algorithms/case.cpp.quick-sort"
          - paragraph [ref=f1e129]:
            - link "归并与快速 · 同数据对比 →" [ref=f1e130] [cursor=pointer]:
              - /url: "#/compare?pair=cpp-recursive"
        - region [ref=f1e131]:
          - generic [ref=f1e132]:
            - heading "C++ · 桶排序" [level=2] [ref=f1e133]
            - generic [ref=f1e134]: 1个独立案例
          - paragraph [ref=f1e135]: 五个固定桶、真实槽位与桶内插入。物理容量与逻辑数量分开显示，不计课程进度或积分。
          - article [ref=f1e136]:
            - heading "桶排序" [level=3] [ref=f1e137]
            - paragraph [ref=f1e138]: 将有限域整数依序放入五个桶，在桶内插入排序，再按桶序写回原数组。
            - paragraph [ref=f1e139]: 0～30项 · −20～29 · 五桶各30槽 · C++受支持子集
            - link "查看桶排序工作区 →" [ref=f1e140] [cursor=pointer]:
              - /url: "#/algorithms/case.cpp.bucket-sort"
        - region [ref=f1e141]:
          - generic [ref=f1e142]:
            - heading "C++ · 栈与队列" [level=2] [ref=f1e143]
            - generic [ref=f1e144]: 2个操作案例
          - paragraph [ref=f1e145]: 给出入/出操作序列，真实执行后核对有效项、物理残值与空满结果。容量各5，不计学习进度或积分。
          - generic [ref=f1e146]:
            - article [ref=f1e147]:
              - heading "数组栈" [level=3] [ref=f1e148]
              - paragraph [ref=f1e149]: 沿真实C++操作观察后进先出，分清有效栈项、容量端点与物理残值。
              - paragraph [ref=f1e150]: 最多30个编码整数槽 · −999～999 · C++受支持子集
              - link "查看数组栈工作区 →" [ref=f1e151] [cursor=pointer]:
                - /url: "#/structures/case.cpp.array-stack"
            - article [ref=f1e152]:
              - heading "环形队列" [level=3] [ref=f1e153]
              - paragraph [ref=f1e154]: 沿真实C++操作观察先进先出，用读写序号取模复用五个物理槽。
              - paragraph [ref=f1e155]: 最多30个编码整数槽 · −999～999 · C++受支持子集
              - link "查看环形队列工作区 →" [ref=f1e156] [cursor=pointer]:
                - /url: "#/structures/case.cpp.circular-queue"
        - generic [ref=f1e157]:
          - heading "C++链表与树" [level=2] [ref=f1e158]
          - paragraph [ref=f1e159]: 真实动态节点与指针操作，和内存/调用栈共用同一执行步骤；观察不计课程或积分。
          - generic [ref=f1e160]:
            - article [ref=f1e161]:
              - heading "单链表" [level=3] [ref=f1e162]
              - paragraph [ref=f1e163]: 沿真实指针逐步核对位置插入、断链删除与遍历，分清存活节点和释放墓碑。
              - paragraph [ref=f1e164]: 容量7 · 原输入最多30整数槽 · C++子集
              - link "查看单链表工作区 →" [ref=f1e165] [cursor=pointer]:
                - /url: "#/nodes/case.cpp.singly-linked-list"
            - article [ref=f1e166]:
              - heading "二叉搜索树（BST）" [level=3] [ref=f1e167]
              - paragraph [ref=f1e168]: 沿真实左右指针观察插入与查找，用同一游标核对前中后序递归和释放。
              - paragraph [ref=f1e169]: 容量7 · 原输入最多30整数槽 · C++子集
              - link "查看二叉搜索树（BST）工作区 →" [ref=f1e170] [cursor=pointer]:
                - /url: "#/nodes/case.cpp.binary-search-tree"
        - generic [ref=f1e171]:
          - heading "C++经典问题" [level=2] [ref=f1e172]
          - paragraph [ref=f1e173]: 真实数值、盘位置与调用栈回放；四例独立观察不计课程或积分。
          - generic [ref=f1e174]:
            - article [ref=f1e175]:
              - heading "汉诺塔" [level=3] [ref=f1e176]
              - paragraph [ref=f1e177]: 读取真实盘位置数组，逐步核对递归调用、合法移动与同游标回退。
              - paragraph [ref=f1e178]: 一个0～5的整数盘数；0盘合法，最多31次移动。
              - link "查看汉诺塔工作区 →" [ref=f1e179] [cursor=pointer]:
                - /url: "#/classics/case.cpp.hanoi"
            - article [ref=f1e180]:
              - heading "辗转相除法求GCD" [level=3] [ref=f1e181]
              - paragraph [ref=f1e182]: 逐步观察符号归一、余数和a/b的真实变化，明确零参数约定。
              - paragraph [ref=f1e183]: 两个−999～999整数；结果非负，本例约定gcd(0,0)=0。
              - link "查看辗转相除法求GCD工作区 →" [ref=f1e184] [cursor=pointer]:
                - /url: "#/classics/case.cpp.euclidean-gcd"
            - article [ref=f1e185]:
              - heading "朴素素数判断" [level=3] [ref=f1e186]
              - paragraph [ref=f1e187]: 从2逐个尝试实际因子，观察判断、早停及0/1/负数边界。
              - paragraph [ref=f1e188]: 一个−999～999整数；低于2都不是素数。
              - link "查看朴素素数判断工作区 →" [ref=f1e189] [cursor=pointer]:
                - /url: "#/classics/case.cpp.trial-division-prime"
            - article [ref=f1e190]:
              - heading "回文数" [level=3] [ref=f1e191]
              - paragraph [ref=f1e192]: 读取真实拆位和完整反转过程，核对负号、零和尾零规则。
              - paragraph [ref=f1e193]: 一个−999～999整数；负数判否，非负数完整反转比较。
              - link "查看回文数工作区 →" [ref=f1e194] [cursor=pointer]:
                - /url: "#/classics/case.cpp.palindrome-number"
        - generic [ref=f1e195]:
          - generic [ref=f1e196]:
            - heading "基础语法演示" [level=2] [ref=f1e197]
            - generic [ref=f1e198]: 4 个语法演示
          - generic [ref=f1e199]:
            - article [ref=f1e200]:
              - heading "变量赋值" [level=3] [ref=f1e204]
              - paragraph [ref=f1e205]: 观察变量的值怎样改变。
              - generic [ref=f1e206]: 可运行与回放
              - paragraph [ref=f1e207]: 尚无已保存的学习记录
              - link "查看演示工作区" [ref=f1e208] [cursor=pointer]:
                - /url: "#/visualize/case.c.assignment"
            - article [ref=f1e211]:
              - heading "分支判断" [level=3] [ref=f1e215]
              - paragraph [ref=f1e216]: 看清条件选择了哪条执行路径。
              - generic [ref=f1e217]: 可运行与回放
              - paragraph [ref=f1e218]: 尚无已保存的学习记录
              - link "查看演示工作区" [ref=f1e219] [cursor=pointer]:
                - /url: "#/visualize/case.c.branch"
            - article [ref=f1e222]:
              - heading "循环" [level=3] [ref=f1e226]
              - paragraph [ref=f1e227]: 认识 while 和 for 的重复过程。
              - generic [ref=f1e228]: 可运行与回放
              - paragraph [ref=f1e229]: 尚无已保存的学习记录
              - link "查看演示工作区" [ref=f1e230] [cursor=pointer]:
                - /url: "#/visualize/case.c.loops"
            - article [ref=f1e233]:
              - heading "数组遍历" [level=3] [ref=f1e237]
              - paragraph [ref=f1e238]: 逐个访问数组中的元素。
              - generic [ref=f1e239]: 可运行与回放
              - paragraph [ref=f1e240]: 尚无已保存的学习记录
              - link "查看演示工作区" [ref=f1e241] [cursor=pointer]:
                - /url: "#/visualize/case.c.array-traversal"
        - generic [ref=f1e244]:
          - generic [ref=f1e245]:
            - heading "排序与查找" [level=2] [ref=f1e246]
            - generic [ref=f1e247]: 3 个算法案例
          - generic [ref=f1e248]:
            - article [ref=f1e249]:
              - heading "冒泡排序" [level=3] [ref=f1e253]
              - paragraph [ref=f1e254]: 比较相邻元素，理解交换的作用。
              - generic [ref=f1e255]: 可运行与回放
              - paragraph [ref=f1e256]: 尚无已保存的学习记录
              - link "查看演示工作区" [ref=f1e257] [cursor=pointer]:
                - /url: "#/visualize/case.c.bubble-sort"
            - article [ref=f1e260]:
              - heading "选择排序" [level=3] [ref=f1e264]
              - paragraph [ref=f1e265]: 寻找最小值，逐步整理数组。
              - generic [ref=f1e266]: 可运行与回放
              - paragraph [ref=f1e267]: 尚无已保存的学习记录
              - link "查看演示工作区" [ref=f1e268] [cursor=pointer]:
                - /url: "#/visualize/case.c.selection-sort"
            - article [ref=f1e271]:
              - heading "二分搜索首次匹配" [level=3] [ref=f1e275]
              - paragraph [ref=f1e276]: 在有序数组中缩小查找范围。
              - paragraph [ref=f1e277]: 输入须为非递减数组。
              - generic [ref=f1e278]: 可运行与回放
              - paragraph [ref=f1e279]: 尚无已保存的学习记录
              - link "查看演示工作区" [ref=f1e280] [cursor=pointer]:
                - /url: "#/visualize/case.c.binary-search-first"
```

# Test source

```ts
  583 |       stdout,
  584 |       viewedCursors,
  585 |       coverageBeforeConfirm,
  586 |       before,
  587 |       beforeConfirm,
  588 |     },
  589 |   };
  590 | }
  591 | async function openGoals(page: Page) {
  592 |   await page.goto('/#/?panel=goals');
  593 |   await ready(page);
  594 |   await expect(page.getByRole('dialog', { name: '每日目标', exact: true })).toBeVisible();
  595 | }
  596 | async function fillTargets(page: Page, value: GoalTargets) {
  597 |   const form = page.getByTestId('daily-goal-settings');
  598 |   for (const [name, count] of [
  599 |     ['每日练习数', value.exercise],
  600 |     ['每日小节数', value.lesson],
  601 |     ['每日案例数', value.case],
  602 |   ] as const)
  603 |     await form.getByRole('spinbutton', { name, exact: true }).fill(String(count));
  604 | }
  605 | async function saveTargets(page: Page, value: GoalTargets) {
  606 |   await fillTargets(page, value);
  607 |   await page
  608 |     .getByTestId('daily-goal-settings')
  609 |     .getByRole('button', { name: '保存自定义目标', exact: true })
  610 |     .click();
  611 |   await ready(page);
  612 |   await expect(page.getByTestId('goal-template-saved')).toContainText('目标已保存');
  613 | }
  614 | 
  615 | test('P05 fresh archive: 32 real code answers and 140 groups produce 32 confirmed completions and durable deduplicated rewards', async ({
  616 |   page,
  617 | }, info) => {
  618 |   test.setTimeout(300_000);
  619 |   bundlePath();
  620 |   const folder = await directory(info, 'fresh-32');
  621 |   expect(await page.context().storageState({ indexedDB: true })).toEqual({
  622 |     cookies: [],
  623 |     origins: [],
  624 |   });
  625 |   await page.goto('/#/courses');
  626 |   await ready(page);
  627 |   await expect(page.locator('[data-course-lesson]')).toHaveCount(32);
  628 |   const initial = await archive(page);
  629 |   expect(initial.databaseVersion).toBe(7);
  630 |   expect(initial.stores).toHaveLength(15);
  631 |   expect(initial.data.meta.activePackageRef).toEqual(p05Package);
  632 |   for (const key of ['progress', 'receipts', 'ledger', 'dailyFacts', 'goals'] as const)
  633 |     expect(initial.data[key]).toEqual([]);
  634 |   const runs = [];
  635 |   for (const [index, lesson] of current.lessons.entries()) {
  636 |     const next = await complete(
  637 |       page,
  638 |       current,
  639 |       lesson,
  640 |       folder,
  641 |       `lesson-${String(index + 1).padStart(2, '0')}`,
  642 |     );
  643 |     runs.push(...next);
  644 |     const data = (await archive(page)).data;
  645 |     expect(data.progress.filter((row) => row.eventType === 'exercise.passed')).toHaveLength(
  646 |       index + 1,
  647 |     );
  648 |     expect(data.progress.filter((row) => row.eventType === 'lesson.completed')).toHaveLength(
  649 |       index + 1,
  650 |     );
  651 |     if ([0, 19, 29].includes(index))
  652 |       await page.screenshot({ path: join(folder, `lesson-${index + 1}.png`), fullPage: true });
  653 |   }
  654 |   expect(runs).toHaveLength(140);
  655 |   const completed = await archive(page);
  656 |   expect(posted(completed.data, 'reward.exercise.first-pass')).toBe(320);
  657 |   expect(posted(completed.data, 'reward.lesson.first-completion')).toBe(640);
  658 |   expect(posted(completed.data, 'reward.daily-goal.once')).toBe(5);
  659 |   expect(posted(completed.data)).toBe(965);
  660 |   expect(completed.data.ledger).toHaveLength(65);
  661 |   expect(
  662 |     completed.data.progress.filter((row) => row.eventType === 'lesson.study-confirmed'),
  663 |   ).toHaveLength(32);
  664 |   noExecutionPersistence(completed.data);
  665 |   await page.goto('/#/courses');
  666 |   await page.reload();
  667 |   await ready(page);
  668 |   const refreshed = await archive(page);
  669 |   stableLearning(completed.data, refreshed.data);
  670 |   await openAnswer(page, current.exercises[0].id);
  671 |   await fillAnswer(page, current, current.exercises[0]);
  672 |   await submit(page);
  673 |   const repeated = await archive(page);
  674 |   expect(repeated.data.ledger).toEqual(completed.data.ledger);
  675 |   expect(repeated.data.dailyFacts).toEqual(completed.data.dailyFacts);
  676 |   expect(repeated.data.progress.filter((row) => row.eventType === 'exercise.passed')).toHaveLength(
  677 |     32,
  678 |   );
  679 |   await page.goto('/#/cases');
  680 |   // The directory has no save panel; its shell reports the shared archive state.
  681 |   await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
  682 |   const caseLinks = page.locator('.case-grid .case-card .card-link');
> 683 |   await expect(caseLinks).toHaveCount(7);
      |                           ^ Error: expect(locator).toHaveCount(expected) failed
  684 |   const caseDirectoryIds = await caseLinks.evaluateAll((links) =>
  685 |     links.map((link) =>
  686 |       decodeURIComponent((link as HTMLAnchorElement).hash.split('/visualize/')[1] ?? ''),
  687 |     ),
  688 |   );
  689 |   expect([...caseDirectoryIds].sort()).toEqual(current.cases.map((entry) => entry.id).sort());
  690 |   const once = await viewAndConfirmCase(page, folder, 'case-first');
  691 |   const caseOnce = once.saved;
  692 |   expect(posted(caseOnce.data, 'reward.case.first-view')).toBe(5);
  693 |   expect(posted(caseOnce.data)).toBe(970);
  694 |   expect(caseOnce.data.ledger).toHaveLength(66);
  695 |   const caseProgress = caseOnce.data.progress.filter(
  696 |     (row) => row.eventType === 'case.view-confirmed',
  697 |   );
  698 |   expect(caseProgress).toHaveLength(1);
  699 |   expect(caseProgress[0]).toMatchObject({
  700 |     packageRef: p05Package,
  701 |     subjectRef: { id: 'case.c.assignment', version: '1.1.0' },
  702 |   });
  703 |   await page.reload();
  704 |   await expect(page.getByTestId('case-execution')).toHaveAttribute('data-state', 'ready');
  705 |   await ready(page);
  706 |   const caseRefreshed = await archive(page);
  707 |   stableLearning(caseOnce.data, caseRefreshed.data);
  708 |   const twice = await viewAndConfirmCase(page, folder, 'case-repeat');
  709 |   const caseRepeated = twice.saved;
  710 |   expect(twice.run.identity.runId).not.toBe(once.run.identity.runId);
  711 |   expect(caseRepeated.data.ledger).toEqual(caseOnce.data.ledger);
  712 |   expect(caseRepeated.data.dailyFacts).toEqual(caseOnce.data.dailyFacts);
  713 |   expect(posted(caseRepeated.data)).toBe(970);
  714 |   expect(
  715 |     caseRepeated.data.progress.filter((row) => row.eventType === 'case.view-confirmed'),
  716 |   ).toHaveLength(1);
  717 |   expect(
  718 |     caseRepeated.data.receipts.filter((row) => row.eventType === 'case.view-confirmed'),
  719 |   ).toHaveLength(2);
  720 |   await record(folder, 'complete-evidence', {
  721 |     kind: 'real-native-ui-learning',
  722 |     browserVersion: page.context().browser()?.version(),
  723 |     initial,
  724 |     completed,
  725 |     refreshed,
  726 |     repeated,
  727 |     runs,
  728 |     groups: 140,
  729 |     repeatSubmissions: 1,
  730 |     caseDirectoryIds,
  731 |     caseOnce,
  732 |     caseRefreshed,
  733 |     caseRepeated,
  734 |     caseRuns: [once.run, twice.run],
  735 |   });
  736 | });
  737 | 
  738 | test('P05 upgrade: six genuinely completed old lessons retain their exact records, points and opened-day targets while becoming 6 of 32', async ({
  739 |   page,
  740 | }, info) => {
  741 |   test.setTimeout(180_000);
  742 |   const target = bundlePath(),
  743 |     folder = await directory(info, 'real-six-upgrade');
  744 |   await page.route(`**${target}`, (route) =>
  745 |     route.fulfill({ status: 404, body: 'Explicit legacy fallback test' }),
  746 |   );
  747 |   await page.goto('/#/courses');
  748 |   await ready(page);
  749 |   await expect(page.getByTestId('course-fallback')).toBeVisible();
  750 |   await expect(page.locator('[data-course-lesson]')).toHaveCount(6);
  751 |   await openGoals(page);
  752 |   await saveTargets(page, { exercise: 6, lesson: 6, case: 1 });
  753 |   const runs = [];
  754 |   for (const [index, lesson] of legacy.lessons.entries())
  755 |     runs.push(...(await complete(page, legacy, lesson, folder, `old-${index + 1}`)));
  756 |   expect(runs).toHaveLength(24);
  757 |   const old = await archive(page);
  758 |   expect(old.data.meta.activePackageRef).toEqual({ id: 'content.c.p0', version: '1.0.2' });
  759 |   expect(old.data.settings.goalTemplate?.targets).toEqual({ exercise: 6, lesson: 6, case: 1 });
  760 |   expect(old.data.goals).toHaveLength(1);
  761 |   expect(old.data.goals[0].targets).toEqual({ exercise: 6, lesson: 6, case: 1 });
  762 |   expect(posted(old.data)).toBe(180);
  763 |   await page.unroute(`**${target}`);
  764 |   await page.reload();
  765 |   await ready(page);
  766 |   await page.goto('/#/courses');
  767 |   await expect(page.locator('[data-course-lesson]')).toHaveCount(32);
  768 |   const upgraded = await archive(page);
  769 |   expect(upgraded.data.meta.activePackageRef).toEqual(p05Package);
  770 |   stableLearning(old.data, upgraded.data);
  771 |   expect(upgraded.data.settings).toEqual(old.data.settings);
  772 |   const newIds = new Set(
  773 |     current.exercises
  774 |       .filter((entry) => !legacy.exercises.some((oldEntry) => oldEntry.id === entry.id))
  775 |       .map((entry) => entry.id),
  776 |   );
  777 |   expect(upgraded.data.progress.filter((row) => newIds.has(row.subjectRef.id))).toEqual([]);
  778 |   for (const lesson of legacy.lessons) {
  779 |     await openLesson(
  780 |       page,
  781 |       current.lessons.find((entry) => entry.id === lesson.id)!,
  782 |       false,
  783 |     );
```