# 公开内容目录

现行P0.5-02：六主题静态配置`appearance.config.p05@1.0.1`按同源清单发布并打包读取，无学习授权；格式仍1.0.0，六套navigation统一sidebar-text，旧配置1.0.0原件保留，见[导航修订](../项目文档/架构决策/P0.5-02-统一左侧导航与内容宽度修订.md)。Blockly/课程学习授权为不可变1.0.6，learningVersion仍1.0.0。旧1.0.0—1.0.5授权资源原件保留；下文按历史任务记录，旧段的“当前”指各次交付时点。SAVE2只影响本地档案，不扩大课程、执行语法或判题权限。

03.3已经建立CONTENT-01 1.0.0静态读取和校验入口。目录保留标准契约样例的读取检查，包为`content.c.p0@1.0.0`、`purpose: contract-fixture`；当前正式案例使用下述独立case-view配置。05—08已验收真实Rust/WASM执行与七案例播放器；原预览包仍不具备正式课程发布或通用判题资格。

09.1新增 [一期课程候选](./c/p0/README.md)：`content.c.p0@1.0.1`包含六节完整原创讲解、六题24测试与知识点/七案例精确引用，修改的22实体升1.0.1，其余60实体原值保持。候选的`purpose: publishable`仅表示待审核的目标形态，**整包尚未取得发布资格**。10.1—10.3另交真实Blockly与C生成/执行及源码审核清单，不修改候选原字节。该包不整体复制到public；09.2/09.3/09.4采用下述独立受限投影，11.1/11.2另以窄配置接入正式积分与每日目标，整包发布拦截保持。离线`inspectContentDraft`及`scripts/verify-course-content.mts`继续审校候选，生产repository保持`parseContent`原发布拦截。

源资料保持在[冻结Schema](../项目文档/契约/02.1-内容结构.schema.json)、[标准样例](../项目文档/契约/02.1-内容样例.json)、[非法样例](../项目文档/契约/02.1-非法配置样例.json)。本目录不保存学习档案、用户源码、实际输入或轨迹。

`scripts/build-content.mjs`先核对三份冻结资料SHA256，生成`web/src/content/schema.mjs`和仅含配置元数据的`baseline.mjs`，再用浏览器同一个生产校验器验证合法样例、23个独立非法修改及2个原始JSON坏例。全部通过后，才将合法样例**原字节**复制为`web/public/content/sample/02.1-content-1.0.0.json`并生成`manifest.json`。清单记录原字节哈希、Schema哈希、82实体/405精确引用及`publicationVerified: false`。生成文件不改purpose；完整示例源码和教学正文从公共JSON按需读取，不进入主脚本包。构建可重复执行；冻结资料改变时须先走CHANGE-01，而不是静默重生成新契约。

前端入口`web/src/content/index.ts`导出`parseContent(bytes)`、`ContentError`、`ContentDiagnostic`、完整内容类型，以及`createContentRepository({url?, fetcher?})`。`load(signal?)`每次独立请求；`getSnapshot()`提供完整有效包、明确的`stale`状态与错误。成功对象递归冻结；新包任一错误整包拒绝，失败时只保留之前整份有效包并标旧包版本/过期，不混装。重新调用load即重试；某个消费者取消不会取消另一个请求，晚到旧请求不能覆盖新请求状态。

默认路径使用Vite的`BASE_URL + content/sample/02.1-content-1.0.0.json`，仅允许同源、部署根下`content/`公共目录内的无查询/片段JSON资源，拒绝跨源、凭据和重定向。请求使用`credentials: omit`、`cache: no-store`、`referrerPolicy: no-referrer`，没有请求正文、学习数据或用户会话。响应头和实际流都限制2MiB；从请求至响应读取限10秒，AbortSignal可取消，忽略取消的晚结果也不能复活当前请求。静态内容仍需网络；不宣称完整离线。

校验按冻结CFG顺序执行：严格UTF-8/唯一JSON键/成对Unicode/有限安全数字，64层与100000节点解析上限；冻结2020-12 Schema使用的`$ref`、对象/数组/标量约束、`allOf/oneOf/anyOf/not/if/then/else`及`unevaluatedProperties`闭合；ID与精确版本索引、Ref目标类型/语言/子集、固定P0规模、双向归属、先修无环、学习兼容、输入域/关系/示例、绑定元数据、20类块映射、六题24组有限判题配置、案例规则及奖励来源。Schema专用码优先于通用码，结构/索引失败停止后续级联；同一可检查阶段诊断按Pointer及code排序。诊断只含公开配置位置/ID/版本，不附源码正文。

**静态验收边界**：生产内容读取器只验证绑定与配置数据，不解析或执行C，不在前端计算答案/算法。`baseline.mjs`中的24组期望只作有限配置一致性比较。09.1通过现有Rust/WASM真实运行六题参考程序的24组测试及10个默认完整程序，正式decoder核对完整轨迹，并核对EX-05真实销毁前数组；另由原生同一Rust核心原样运行正文11个完整代码围栏，包含4个明确标注的错误示例。这些证据验证课程示例和固定预期，不能证明任意提交正确。09.1该轮仅校验参考执行，judgeResult为not-evaluated；09.3增加真实AST/有效贡献与错误解判定，实际满足时为met，否则unmet或not-evaluated，不能按源码文本判等。正式发布需全部审核门槛完成，不因离线内容审校通过而打开生产拦截。

针对性验证见`tests/unit/content-loader.test.ts`：原25坏例、Schema分支/结构闭合、编码/深度/体积、发布拒绝、同源请求、失败与旧包/重试、独立取消、晚结果和10秒超时。浏览器读取与UI反馈由03.3主窗口集成验收。

09.2增加独立课程阅读发布：`scripts/build-reading.mjs`在冻结内容检查后校验09.1原候选哈希，生成`content/reading/course-reading-1.0.0.json`及审核manifest。仅授予正文浏览、只读示例和主动开始/学习确认，完整CONTENT候选仍未发布；浏览器先校验精确发布哈希再使用。运行与学习数据继续留在当前浏览器，资源GET不携带学习档案。详见09.2架构/验收及交接。

09.3另增独立练习投影：build-practice.mjs按同一审核候选SHA生成course-practice-1.0.0.json及manifest，仅含六题/24组、关联原Program/inputSpec/judgeProfile；运行前精确哈希校验。有限答案实例只改变EXEC source，不改原Program元数据或09.2阅读字节。该资源不含LearningCatalog、不授学习事件，完整CONTENT发布门槛保持。

10.1—10.3的20类Blockly工作区取代有限答题控件，生成器仍保留Rust准备的输入声明前缀并同时生成精确blockMap。源码审核清单为`c/p0/blockly-release-1.0.0.json`，变更后须重验真实运行门槛再注册。Blockly12份图片/光标同源复制，固定库CSS按精确SHA允许，不开放外部媒体或任意inline。

09.4的`build-course-learning.mjs`仅在该源码清单与真实门槛通过后生成独立`content/learning/course-learning-1.0.0.json`和审核常量。内部`course-practice`权限只允许原课程开始/确认与完整真实通过；小节完成由统一事务派生。完整候选/reading/practice旧字节均不改，案例、目标配置、积分政策不扩权。授权故障回退阅读及临时判题，不冒称已保存。学习档案只存既定最少事实与去重权利，不存积木、源、输入或轨迹。

11.1新增独立静态窄配置`c/p0/case-view-1.0.0.json`，从已审`course-1.0.1.json`精确提取七案例/Program/inputSpec及Rust实例化声明范围，经真实WASM默认/边界输入核对后作为构建内只读资源使用。内部`case-view`只授`case.view-confirmed`，不扩course-practice权限、不发布完整CONTENT；案例讲解与实际执行同为1.0.1。原sample目录仍保留原契约读取/故障恢复检查，不获得新奖励权限。

独立`rewards/p0-1.0.0.json`配置正式首次分值10/20/5、重复0及每日目标/闯关未启用标识。前端严格闭合验证配置；奖励由统一学习服务与原子存储事务结算，不由页面或Rust自行增分。新增case-view及政策配置均不修改原冻结契约、既有阅读/练习/学习发布资源或Blockly审核注册。

11.1另将练习页过期的“积分政策尚未启用”说明改为真实账本说明，依原规则先独立完成45项积木/练习与3项导航门槛，再新增`blockly-release-1.0.2.json`、生成`course-learning-1.0.2.json`。当前授权常量钉1.0.2；旧1.0.0/1.0.1注册和版本化资源原字节保留。该修订没有修改积木语义、C子集、布局、CSS、既有阅读/练习字节或三类窄授权范围；奖励仍来自独立policy，不把整包发布或目标配置一并开放。

11.2另增构建内窄配置`goals/p0-1.0.0.json`（推荐1题/1节，界限6/6/7）及独立`rewards/daily-goal-p0-1.0.0.json`（同一本地日期达成5分）。原`rewards/p0-1.0.0.json`的内容首次政策不改；目标配置不授学习事实、不扩大CONTENT发布或course-practice权限。推荐模板保存先于首次开日，旧null日期保持，模板修改只用于后续尚未打开的日期。配置加载或保存失败明确提示不可用，不伪造正常null今日。

11.3另增构建内窄配置`profile/p0-1.0.0.json`，固定四种原创SVG基座和五级阈值0/30/100/200/400。配置只提供形象选择和已入账积分的等级展示，不授予学习事实、奖励或CONTENT发布权。头像仍仅存presetId与强调色；等级、总分和完成率均从已保存档案派生。未知历史preset原样保留并显示不可用，配置失败可独立重试；原课程资源、政策、公共契约与Blockly/学习授权1.0.2保持。
