# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: reconstruction.spec.ts >> 13.5 native reconstruction: wrong answer, real pass, quota retry and shared first reward
- Location: tests\browser\reconstruction.spec.ts:150:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  -  1
+ Received  + 19

- Array []
+ Array [
+   Object {
+     "eventType": "exercise.attempt-evaluated",
+     "failedCaseKey": "positive",
+     "firstAt": "2026-10-31T06:34:31.043Z",
+     "lastAt": "2026-10-31T06:34:31.043Z",
+     "learningRevision": 1,
+     "packageRef": Object {
+       "id": "content.c.p05",
+       "version": "1.0.0",
+     },
+     "result": "failed",
+     "resultCategory": "wrong-answer",
+     "subjectRef": Object {
+       "id": "exercise.c.echo",
+       "version": "1.1.0",
+     },
+   },
+ ]
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
        - button "进入专注模式" [ref=e60] [cursor=pointer]:
          - generic [ref=e63]: 专注
        - generic [ref=e64]: 本地学习
        - link "本地数据" [ref=e65] [cursor=pointer]:
          - /url: "#/settings?panel=data"
        - button "切换为深色" [ref=e69] [cursor=pointer]
    - main [ref=e72]:
      - generic [ref=e73]:
        - navigation "当前位置" [ref=e74]:
          - list [ref=e75]:
            - listitem [ref=e76]:
              - link "C 语言课程" [ref=e77] [cursor=pointer]:
                - /url: "#/courses"
            - listitem [ref=e78]:
              - link "变量和输出" [ref=e81] [cursor=pointer]:
                - /url: "#/lessons/lesson.c.variables-output"
            - listitem [ref=e82]:
              - generic [ref=e85]: 输出输入变量
        - generic [ref=e86]:
          - paragraph [ref=e87]: 动手练习 · 程序与输入
          - heading "输出输入变量" [level=1] [ref=e88]
          - paragraph [ref=e89]: 用 C 代码或积木解答，提交后逐步复盘真实执行。
        - paragraph [ref=e93]: 已有当前内容兼容的历史尝试记录
        - generic [ref=e94]:
          - generic [ref=e96]:
            - heading "题目与答题区" [level=2] [ref=e97]
            - paragraph [ref=e98]: 保留输入源变量x（-999到999），用输出积木读取x，输出它的十进制整数和一个换行，不要加提示文字。例：x=7输出7并换行，x=0输出0，x=-9输出-9。必须实际声明、读取输入变量，不能打印固定答案。所有测试正常结束且main返回0。思路：先找到输入声明，再把变量读取放进printf的%d参数。
            - paragraph [ref=e99]: 教学目标：真实声明并读取x，输出依赖输入，不打印固定答案。
            - group [ref=e100]:
              - generic "练习与保存说明" [ref=e101] [cursor=pointer]
          - generic [ref=e102]:
            - generic [ref=e103]:
              - generic "练习起点" [ref=e104]:
                - button "独立练习" [ref=e105] [cursor=pointer]
                - button "改错练习" [ref=e106] [cursor=pointer]
                - button "拆积木练习" [pressed] [ref=e107] [cursor=pointer]
              - link "查看课程示例" [ref=e108] [cursor=pointer]:
                - /url: "#/lessons/lesson.c.variables-output"
            - paragraph [ref=e109]: 对照参考 C，用积木还原程序；生成代码只读。各模式草稿独立保留，切换会清除本次结果；已保存的编辑历史可在离题或刷新后选择恢复，未保存内容可能丢失。示例在新标签页打开。
            - generic [ref=e111]:
              - strong [ref=e112]: 需要一点帮助？
              - button "查看第 1 层提示" [ref=e113] [cursor=pointer]
          - region "拆积木参考程序" [ref=e114]:
            - generic [ref=e115]:
              - heading "把输入送到输出" [level=3] [ref=e116]
              - paragraph [ref=e117]: 读懂右侧 C 程序，再用积木搭出相同的行为。输入声明已备好，参考代码不会自动填入你的解答。
              - paragraph [ref=e118]: 沿着 x 的值，从输入声明找到输出参数；输出末尾保留换行。
              - paragraph [ref=e119]: 可以使用不同的搭法；判题同时检查本题教学结构、输入的实际参与和全部测试结果。
              - paragraph [ref=e120]: 与本题其他作答方式共用通过记录和首次积分；已通过的题目再次提交不重复奖励。
            - generic [ref=e121]:
              - heading "参考 C · 第一组输入" [level=4] [ref=e122]
              - generic "只读参考 C 代码" [ref=e123]: "#include <stdio.h> int main(void) { int x = 7; printf(\"%d\\n\", x); return 0; }"
          - generic [ref=e124]:
            - button "运行本组" [ref=e125] [cursor=pointer]
            - button "准备代码" [ref=e126] [cursor=pointer]
            - button "提交练习" [ref=e127] [cursor=pointer]
            - button "取消提交" [disabled] [ref=e128]
            - link "查看本次复盘" [ref=e129] [cursor=pointer]:
              - /url: "#/practice/exercise.c.echo/review"
            - status [ref=e130]: 当前代码与积木已同步。
          - paragraph [ref=e131]: 运行本组只检查第一组输入，不记录通过或积分；提交练习才检查全部3 组与教学目标。准备代码只生成源码。 修改积木或代码会立即使旧判定和轨迹失效；已保存的历史通过仍保留。
          - paragraph [ref=e132]: 本模式显示积木并保留你的显示偏好；切回其他模式后继续使用原设置。
          - group [ref=e133]:
            - generic "积木权限：已永久解锁 0 / 20 · 本节临时开放 8 类" [ref=e134] [cursor=pointer]
          - group [ref=e135]:
            - generic "编辑历史 · 1 条已保存" [ref=e136] [cursor=pointer]
          - generic [ref=e138]:
            - generic [ref=e139]:
              - generic [ref=e140]: 拖动中间分隔条调整宽度
              - button "恢复默认比例" [disabled] [ref=e141] [cursor=pointer]
            - generic [ref=e142]:
              - region "积木" [ref=e143]:
                - generic [ref=e144]:
                  - generic [ref=e145]: 积木
                  - button "展开积木" [ref=e146] [cursor=pointer]:
                    - generic [ref=e149]: 展开
                - region "积木工作区" [ref=e152]:
                  - paragraph [ref=e153]: 从左侧分类拖入积木，右侧同步显示生成的 C 代码。键盘操作可展开下方“逐块编辑与键盘连接”。
                  - generic [ref=e154]:
                    - group "积木编辑操作" [ref=e155]:
                      - button "撤销" [disabled] [ref=e156]
                      - button "重做" [disabled] [ref=e157]
                    - status [ref=e158]: 拖动到匹配的插槽即可拼接。
                  - generic "可拖拽积木画布" [ref=e159]:
                    - application [ref=e160]:
                      - tree [ref=e162]:
                        - treeitem "程序与作用域" [level=1] [ref=e163]
                        - treeitem "整数与变量" [level=1] [ref=e165]
                        - treeitem "运算与判断" [level=1] [ref=e167]
                        - treeitem "条件与循环" [level=1] [ref=e169]
                        - treeitem "数组与输出" [level=1] [ref=e171]
                      - region "Blocks工作区。" [ref=e173]:
                        - figure "0个块堆"
                        - figure "块堆开始, 主程序 int main, 执行, 结尾默认返回 0," [ref=e176]
                        - figure "声明 int, x, Not checked, 设置初值 · 课程输入（按测试组实例化）, 有输入," [ref=e177]
                        - generic [aria-hidden] [ref=e179]: 声明 int
                        - 'button "text: x" [ref=e180]':
                          - generic [aria-hidden]: x
                        - checkbox "checkbox" [ref=e182]
                        - generic [aria-hidden] [ref=e185]: 设置初值
                        - generic [aria-hidden] [ref=e187]: · 课程输入（按测试组实例化）
                        - figure [ref=e188]
                        - figure [ref=e189]
                        - generic [aria-hidden] [ref=e191]: 主程序 int main
                        - generic [aria-hidden] [ref=e193]: 执行
                        - generic [aria-hidden] [ref=e195]: 结尾默认返回 0
                        - figure [ref=e196]
                        - button "垃圾桶，当前为空" [disabled] [ref=e197]
                        - button "Zoom out" [ref=e200]
                        - button "Zoom in" [ref=e203]
                        - button "Reset zoom" [ref=e206]
                      - status [ref=e211]
                  - group [ref=e212]:
                    - generic "逐块编辑与键盘连接" [ref=e213] [cursor=pointer]
                    - option "请选择积木"
                    - option "1. 主程序" [selected]
                    - option "2. 声明整数 · x"
                    - option "主程序"
                    - option "整数" [selected]
                    - option "声明整数"
                    - option "读取变量"
                    - option "变量赋值"
                    - option "一元运算"
                    - option "算术运算（未解锁）" [disabled]
                    - option "比较（未解锁）" [disabled]
                    - option "逻辑运算（未解锁）" [disabled]
                    - option "条件分支（未解锁）" [disabled]
                    - option "while 循环（未解锁）" [disabled]
                    - option "for 循环（未解锁）" [disabled]
                    - option "跳出循环（未解锁）" [disabled]
                    - option "继续下轮（未解锁）" [disabled]
                    - option "声明数组（未解锁）" [disabled]
                    - option "读取数组（未解锁）" [disabled]
                    - option "写入数组（未解锁）" [disabled]
                    - option "输出"
                    - option "返回"
                    - option "独立作用域（未解锁）" [disabled]
                    - option "请选择目标积木" [selected]
                    - option "1. 声明整数 · x"
                    - option "请选择插槽" [selected]
              - separator "调整面板宽度" [ref=e214]
              - region "生成代码" [ref=e216]:
                - generic [ref=e217]:
                  - generic [ref=e218]: 生成代码
                  - button "展开生成代码" [ref=e219] [cursor=pointer]:
                    - generic [ref=e222]: 展开
                - complementary "代码与积木联动" [ref=e224]:
                  - region "执行代码区域" [ref=e225]:
                    - generic [ref=e226]:
                      - heading "本次执行的 C 代码" [level=3] [ref=e227]
                      - generic [ref=e228]: 只读
                    - paragraph [ref=e229]: 初始状态，尚未完成源码步骤。
                    - generic [ref=e230]:
                      - generic [aria-hidden]:
                        - code: "#include <stdio.h> int main(void) { int x = 7; return 0; }"
                      - textbox "当前执行的 C 代码" [ref=e231]: "#include <stdio.h> int main(void) { int x = 7; return 0; }"
          - generic [ref=e232]:
            - heading "本次提交未通过" [level=3] [ref=e233]
            - paragraph [ref=e234]:
              - text: 本次有效错误已保存到错题记录。
              - link "查看错题与陌生点" [ref=e235] [cursor=pointer]:
                - /url: "#/notebook"
            - paragraph [ref=e236]: 输出必须来自本组输入 x 的实际读取，固定数值不能代替输入。当前有限教学检查无法证明的复杂等价解也不会默认通过。
            - paragraph [ref=e237]: 已检查 1/3 组；首个未通过即停止。
            - list [ref=e238]:
              - listitem [ref=e239]:
                - text: positive：本组未通过
                - generic [ref=e240]: · 逐字输出符合预期未满足
                - generic [ref=e241]: · 符合本题教学目标未满足
            - paragraph [ref=e242]: 程序正常结束，返回值 0。程序能够结束，但本题要求尚未全部满足。
            - list [ref=e243]:
              - listitem [ref=e244]: 输入声明与实际输入一致：满足
              - listitem [ref=e245]:
                - text: 逐字输出符合预期：未满足
                - generic [ref=e246]: · J_STDOUT_MISMATCH
              - listitem [ref=e247]: 正常返回 0：满足
              - listitem [ref=e248]:
                - text: 符合本题教学目标：未满足
                - generic [ref=e249]: · J_TEACHING_TARGET
            - paragraph [ref=e250]: 输出按原样比较，空格与换行也计入；教学目标需要真实的输入贡献或控制路径，只有输出相同仍可能未通过。
            - generic [ref=e251]:
              - generic [ref=e252]:
                - heading "本组实际输出" [level=4] [ref=e253]
                - generic [ref=e254]: （无输出）
              - generic [ref=e255]:
                - heading "本组预期输出" [level=4] [ref=e256]
                - generic [ref=e257]: "7"
          - status [ref=e259]:
            - generic [ref=e263]:
              - heading "本地档案已读取" [level=2] [ref=e264]
              - paragraph [ref=e265]: 正在显示当前浏览器中已保存的记录与设置。
          - region "小节完成清单" [ref=e266]:
            - generic [ref=e267]:
              - heading "小节完成清单" [level=3] [ref=e268]
              - generic [ref=e269]: 0/2 项已保存
            - list [ref=e270]:
              - listitem [ref=e271]:
                - generic [ref=e272]: 阅读并主动确认学习
                - strong [ref=e273]: 待确认
              - listitem [ref=e274]:
                - generic [ref=e275]: 输出输入变量
                - strong [ref=e276]: 待通过并保存
            - paragraph [ref=e277]: 小节尚未完成
            - link "阅读并确认本节学习" [ref=e278] [cursor=pointer]:
              - /url: "#/lessons/lesson.c.variables-output#lesson-study-confirmation"
          - paragraph [ref=e279]: 当前源码与复盘对应测试组：positive。只保留本组轨迹；复盘不重新运行。
          - paragraph [ref=e280]:
            - text: 本组输入：
            - code [ref=e281]: "{\"x\":7}"
          - generic "执行播放工作区" [ref=e282]:
            - region "运行结果" [ref=e283]:
              - heading "当前步骤画面" [level=3] [ref=e285]
              - generic "播放控制" [ref=e286]:
                - generic [ref=e287]:
                  - button "后退" [disabled] [ref=e288]
                  - button "播放" [ref=e289] [cursor=pointer]
                  - button "前进" [ref=e290] [cursor=pointer]
                  - button "重播" [ref=e291] [cursor=pointer]
                - generic [ref=e292]:
                  - text: 速度
                  - combobox "播放速度" [ref=e293]:
                    - option "0.25×"
                    - option "0.5×"
                    - option "1×" [selected]
                    - option "1.5×"
                    - option "2×"
                    - option "4×"
                - generic [ref=e294]:
                  - generic [ref=e295]: 步骤 0 / 4
                  - status [ref=e296]: 已回到初始状态
                - paragraph [ref=e297]: 聚焦播放工作区后，空格播放或暂停，左右方向键单步查看。重播从初始状态开始播放。
              - generic [ref=e298]:
                - paragraph [ref=e299]: 初始状态：尚未执行任何步骤
                - generic [ref=e300]:
                  - generic [ref=e301]:
                    - text: 比较
                    - strong [ref=e302]: "0"
                  - generic [ref=e303]:
                    - text: 变量写入
                    - strong [ref=e304]: "0"
                  - generic [ref=e305]:
                    - text: 数组写入
                    - strong [ref=e306]: "0"
                  - generic [ref=e307]:
                    - text: 交换
                    - strong [ref=e308]: "0"
                - region "当前变量" [ref=e309]:
                  - heading "变量" [level=4] [ref=e310]
                  - paragraph [ref=e311]: 当前没有存活变量。
                - region "当前数组" [ref=e312]:
                  - heading "数组" [level=4] [ref=e313]
                  - paragraph [ref=e314]: 当前没有存活数组。
                - region "当前步骤的读写与比较" [ref=e315]:
                  - heading "本步读写与比较" [level=4] [ref=e316]
                  - paragraph [ref=e317]: 本步没有读写或比较观测。
                - region "当前步骤输出" [ref=e318]:
                  - heading "截至当前步骤的输出" [level=4] [ref=e319]
                  - generic [ref=e320]: （无输出）
        - paragraph [ref=e321]: 积木只生成受支持的 C 程序。返回本节可查看已保存的历史进度。
        - link "返回本节学习" [ref=e322] [cursor=pointer]:
          - /url: "#/lessons/lesson.c.variables-output"
```

# Test source

```ts
  75  |   await blockWorkspace(page).getByRole('button', { name: '连接选中积木', exact: true }).click();
  76  |   await expect(blockWorkspace(page).locator('.block-notice')).toHaveText('积木已连接。');
  77  | }
  78  | async function buildEcho(page: Page) {
  79  |   expect(await blockOptions(page, /^\d+\. 输出 ·/)).toEqual([]);
  80  |   const inputs = await blockOptions(page, /^\d+\. 声明整数 · x$/);
  81  |   expect(inputs).toHaveLength(1);
  82  |   const print = await add(page, 'print');
  83  |   await blockWorkspace(page).getByRole('textbox', { name: '输出格式', exact: true }).fill('%d\\n');
  84  |   await connect(page, print, inputs[0], '$next');
  85  |   const variable = await add(page, 'variable');
  86  |   await blockWorkspace(page).getByRole('textbox', { name: '变量名称', exact: true }).fill('x');
  87  |   await connect(page, variable, print, 'ARG0');
  88  |   await expect(source(page)).toHaveValue(/printf\("%d\\n", x\)/);
  89  |   await expect(action(page, '提交练习')).toBeEnabled();
  90  |   return print;
  91  | }
  92  | async function restore(page: Page, id: string) {
  93  |   const details = history(page);
  94  |   if ((await details.getAttribute('open')) === null) await details.locator('summary').click();
  95  |   await page.getByRole('combobox', { name: '历史版本', exact: true }).selectOption(id);
  96  |   await details.getByRole('button', { name: '恢复所选版本', exact: true }).click();
  97  |   await expect
  98  |     .poll(async () =>
  99  |       (await archive(page)).editHistory.some(
  100 |         (row) => row.reason === 'restore' && row.restoredFrom === id && row.state === 'synced',
  101 |       ),
  102 |     )
  103 |     .toBe(true);
  104 | }
  105 | 
  106 | test('13.5 six configured references, exact native start, permissions and representative layout', async ({
  107 |   page,
  108 | }, info) => {
  109 |   test.setTimeout(90000);
  110 |   await page.goto('/#/courses');
  111 |   const library = page.getByTestId('reconstruction-catalog');
  112 |   await library.locator('summary').click();
  113 |   await expect(library.getByRole('link')).toHaveCount(6);
  114 |   for (const question of reconstructionQuestions) {
  115 |     await open(page, question.exerciseRef.id);
  116 |     await expect(page.getByTestId('reconstruction-reference')).toContainText(question.hint);
  117 |     await expect(page.getByLabel('只读参考 C 代码', { exact: true })).toContainText('printf');
  118 |     await expect(source(page)).not.toHaveValue(/printf/);
  119 |     await expect(page.getByRole('textbox', { name: '编辑 C 代码', exact: true })).toHaveCount(0);
  120 |     await expect(action(page, '编辑 C 并同步积木')).toHaveCount(0);
  121 |     await expect(action(page, '收起代码编辑')).toHaveCount(0);
  122 |     expect((await archive(page)).progress).toEqual([]);
  123 |   }
  124 |   await open(page);
  125 |   await blockOptions(page, /./);
  126 |   await expect(
  127 |     blockWorkspace(page)
  128 |       .getByRole('combobox', { name: '添加积木类型', exact: true })
  129 |       .locator('option[value="while"]'),
  130 |   ).toHaveAttribute('disabled', '');
  131 |   const folder = `.artifacts/13.5/visual/${process.env.TASK_EVIDENCE_LABEL ?? 'initial'}`;
  132 |   await mkdir(folder, { recursive: true });
  133 |   for (const width of [1440, 768, 390]) {
  134 |     await page.setViewportSize({ width, height: 900 });
  135 |     await page.getByTestId('reconstruction-reference').scrollIntoViewIfNeeded();
  136 |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
  137 |       true,
  138 |     );
  139 |     await page.screenshot({ path: `${folder}/${width}.png`, fullPage: true });
  140 |   }
  141 |   await info.attach('configured-references', {
  142 |     body: JSON.stringify({
  143 |       questions: reconstructionQuestions.map((q) => q.exerciseRef),
  144 |       archive: await archive(page),
  145 |     }),
  146 |     contentType: 'application/json',
  147 |   });
  148 | });
  149 | 
  150 | test('13.5 native reconstruction: wrong answer, real pass, quota retry and shared first reward', async ({
  151 |   page,
  152 | }, info) => {
  153 |   test.setTimeout(90000);
  154 |   await observeCaseSetExecution(page);
  155 |   await page.addInitScript(() => {
  156 |     const fault = { armed: false, hits: 0 };
  157 |     Object.assign(window, { __reconstructionFault: fault });
  158 |     // Instance prototype operation: real transaction abort, never fabricate a receipt.
  159 |     const add = IDBObjectStore.prototype.add;
  160 |     IDBObjectStore.prototype.add = function (value: unknown, key?: IDBValidKey) {
  161 |       if (
  162 |         fault.armed &&
  163 |         this.name === 'receipts' &&
  164 |         (value as { eventType?: string })?.eventType === 'exercise.passed'
  165 |       ) {
  166 |         fault.hits++;
  167 |         throw new DOMException('13.5 isolated quota', 'QuotaExceededError');
  168 |       }
  169 |       return key === undefined ? add.call(this, value) : add.call(this, value, key);
  170 |     };
  171 |   });
  172 |   await open(page);
  173 |   await action(page, '提交练习').click();
  174 |   await expect(panel(page)).toHaveAttribute('data-state', 'unmet');
> 175 |   expect((await archive(page)).progress).toEqual([]);
      |                                          ^ Error: expect(received).toEqual(expected) // deep equality
  176 |   const print = await buildEcho(page);
  177 |   await selectBlock(page, print);
  178 |   await blockWorkspace(page).getByRole('textbox', { name: '输出格式', exact: true }).fill('%d');
  179 |   await expect(action(page, '提交练习')).toBeEnabled();
  180 |   await action(page, '提交练习').click();
  181 |   await expect(panel(page)).toHaveAttribute('data-state', 'unmet');
  182 |   expect((await archive(page)).ledger).toEqual([]);
  183 |   await blockWorkspace(page).getByRole('textbox', { name: '输出格式', exact: true }).fill('%d\\n');
  184 |   await expect(action(page, '提交练习')).toBeEnabled();
  185 |   if (p05CourseRelease.registered)
  186 |     await page.evaluate(() => {
  187 |       (
  188 |         window as unknown as { __reconstructionFault: { armed: boolean } }
  189 |       ).__reconstructionFault.armed = true;
  190 |     });
  191 |   await action(page, '提交练习').click();
  192 |   await expect(panel(page)).toHaveAttribute('data-state', 'passed');
  193 |   await expect(page.getByTestId('practice-pass-save')).toHaveAttribute(
  194 |     'data-save-state',
  195 |     p05CourseRelease.registered ? 'unsaved' : saved,
  196 |   );
  197 |   if (p05CourseRelease.registered) {
  198 |     expect((await archive(page)).progress).toEqual([]);
  199 |     await page.evaluate(() => {
  200 |       (
  201 |         window as unknown as { __reconstructionFault: { armed: boolean } }
  202 |       ).__reconstructionFault.armed = false;
  203 |     });
  204 |     await page.getByRole('button', { name: '重试未保存操作', exact: true }).click();
  205 |     await expect(page.getByTestId('learning-save-status')).toHaveAttribute(
  206 |       'data-save-status',
  207 |       'ready',
  208 |     );
  209 |   }
  210 |   const first = await archive(page);
  211 |   const awards = first.ledger.filter((r) => r.sourceId === 'reward.exercise.first-pass');
  212 |   expect(awards).toHaveLength(p05CourseRelease.registered ? 1 : 0);
  213 |   if (awards.length) expect(awards[0].points).toBe(10);
  214 |   await action(page, '提交练习').click();
  215 |   await expect(page.getByTestId('practice-pass-save')).toHaveAttribute('data-save-state', saved);
  216 |   expect((await archive(page)).ledger).toEqual(first.ledger);
  217 |   const worker = await observedCaseSetExecute(page);
  218 |   const request = JSON.parse(Buffer.from(worker.requestBytes!).toString()) as ExecuteRequest;
  219 |   const result = await decodeResult(Uint8Array.from(worker.responseBytes!).buffer, request);
  220 |   expect(result.producer).toBe('rust');
  221 |   expect(result.judgeResult?.status).toBe('met');
  222 |   expect(request.remainingMs).toBeLessThanOrEqual(1000);
  223 |   // The ordinary code mode shares the same genuine exercise entitlement.
  224 |   const text = (await archive(page)).editHistory
  225 |     .filter(
  226 |       (row) =>
  227 |         row.scope.mode === 'reconstruction' &&
  228 |         row.state === 'synced' &&
  229 |         row.codeText.includes('printf'),
  230 |     )
  231 |     .sort((a, b) => b.sequence - a.sequence)[0].codeText;
  232 |   await page.getByRole('button', { name: '独立练习', exact: true }).click();
  233 |   await page.getByRole('combobox', { name: '积木显示', exact: true }).selectOption('hide');
  234 |   const code = page.getByRole('textbox', { name: '编辑 C 代码', exact: true });
  235 |   await code.fill(text);
  236 |   await expect(page.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'synced');
  237 |   await action(page, '提交练习').click();
  238 |   await expect(page.getByTestId('practice-pass-save')).toHaveAttribute('data-save-state', saved);
  239 |   expect((await archive(page)).ledger).toEqual(first.ledger);
  240 |   await info.attach('real-rust-and-rewards', {
  241 |     body: JSON.stringify({ request, result, first, repeat: await archive(page) }),
  242 |     contentType: 'application/json',
  243 |   });
  244 | });
  245 | 
  246 | test('13.5 isolated drafts and native history survive refresh while display preference and old execution stay correct', async ({
  247 |   page,
  248 | }) => {
  249 |   test.setTimeout(60000);
  250 |   await page.goto('/#/practice/exercise.c.echo');
  251 |   await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
  252 |   await expect(history(page)).toHaveAttribute('data-save-state', 'ready');
  253 |   await page.getByRole('combobox', { name: '积木显示', exact: true }).selectOption('hide');
  254 |   const preference = page.getByTestId('block-preference-save-status');
  255 |   await expect(preference).not.toHaveAttribute('data-save-state', 'saving');
  256 |   if ((await preference.getAttribute('data-save-state')) === 'temporary') {
  257 |     await page.getByRole('button', { name: '重新读取并保存选择', exact: true }).click();
  258 |   }
  259 |   await expect(preference).toHaveAttribute('data-save-state', 'saved');
  260 |   const code = page.getByRole('textbox', { name: '编辑 C 代码', exact: true });
  261 |   await expect(code).toBeEditable();
  262 |   const invalid = (await code.inputValue()) + '\nint';
  263 |   await code.fill(invalid);
  264 |   await expect(page.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'invalid');
  265 |   await page.getByRole('button', { name: '拆积木练习', exact: true }).click();
  266 |   await buildEcho(page);
  267 |   await expect(history(page)).toHaveAttribute('data-save-state', 'ready');
  268 |   const version = (await archive(page)).editHistory
  269 |     .filter(
  270 |       (r) =>
  271 |         r.scope.mode === 'reconstruction' && r.state === 'synced' && r.codeText.includes('printf'),
  272 |     )
  273 |     .sort((a, b) => b.sequence - a.sequence)[0];
  274 |   expect(version.historyVersion).toBe('1.1.0');
  275 |   await action(page, '运行本组').click();
```