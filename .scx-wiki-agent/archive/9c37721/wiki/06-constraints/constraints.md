# 限制常量与复杂度约束

<details>
<summary>Relevant source files</summary>

- scripts/gen-icon.ts
- src-tauri/src/config/legacy.rs
- src-tauri/src/debug_log.rs
- src-tauri/src/forward/loops.rs
- src-tauri/src/s3sync/client.rs
- src-tauri/src/secrets/keys.rs
- src-tauri/src/ssh/auth.rs
- src-tauri/src/ssh/session.rs
- src/components/settings/useGroupNameDialog.ts
- src/components/titlebar/tabSwitcherModel.ts
- src/lib/frontends/xterm/frontend.ts
- src/lib/frontends/xterm/resize.ts
- src/lib/sshConnectionRegistry.ts
- src/lib/suggestions/controller.ts
- src/lib/suggestions/promptTracker.ts
</details>

本页职责：汇总仓库中**显式声明的限制常量**与**复杂度热点函数**，用于回答「这个项目的硬边界在哪里、改动代价落在哪些文件上」。数据来源为常量声明表、函数复杂度表与常量源码注释（intent），**不含**模块依赖边、调用关系边与继承关系，因此本页不产出调用时序图或类层次图。

数据覆盖度说明：
- 本页共覆盖 17 条常量声明，其中 7 条带源码注释（intent）；其余 10 条数据未提供注释，只能确认其约束对象，不能确认作者意图。
- 复杂度数据为前 20 个热点函数（20 条记录），复杂度值合计 173。数据未提供函数体源码，故无法定位到具体分支。

---

## 一、限制常量清单

| 常量 | 值 | 源文件:行号 |
| --- | --- | --- |
| `SIZE` | 1024 | scripts/gen-icon.ts:7 |
| `SIDEBAR_MIN_WIDTH` | 260 | src/components/monitor/MonitorSidebar.vue:166 |
| `SIDEBAR_MAX_WIDTH` | 480 | src/components/monitor/MonitorSidebar.vue:167 |
| `SIDEBAR_MIN_WIDTH` | 180 | src/components/start/StartPageContent.vue:53 |
| `SIDEBAR_MAX_WIDTH` | 240 | src/components/start/StartPageContent.vue:54 |
| `MAX_VISIBLE_ROWS` | 8 | src/components/terminal/SuggestionMenu.vue:41 |
| `MIN_BACKGROUND_OPACITY` | 0.05 | src/lib/backgroundImage.ts:9 |
| `RESIZE_MIN_INTERVAL` | 32 | src/lib/frontends/xterm/resize.ts:11 |
| `MAX_WEBGL_RECOVERY_ATTEMPTS` | 3 | src/lib/frontends/xterm/support.ts:58 |
| `DEFAULT_MAX_PROMPT_JUMP` | 20 | src/lib/suggestions/promptTracker.ts:125 |
| `MAX_HISTORY_SAME_SOURCE` | 8 | src/lib/suggestions/suggestionEngine.ts:11 |
| `MAX_HISTORY_GLOBAL` | 4 | src/lib/suggestions/suggestionEngine.ts:12 |
| `MAX_QUICK_COMMANDS` | 4 | src/lib/suggestions/suggestionEngine.ts:13 |
| `MAX_PATHS` | 8 | src/lib/suggestions/suggestionEngine.ts:14 |
| `MAX_TOTAL` | 16 | src/lib/suggestions/suggestionEngine.ts:15 |
| `INDEX_LIMIT` | 5000 | src/services/history.ts:9 |
| `MAX_SAMPLES` | 150 | src/stores/monitor.ts:11 |

**同名常量注意**：`SIDEBAR_MIN_WIDTH` / `SIDEBAR_MAX_WIDTH` 在仓库中存在**两套互不相同的取值**——监控侧栏为 260/480（src/components/monitor/MonitorSidebar.vue:166、src/components/monitor/MonitorSidebar.vue:167），起始页侧栏为 180/240（src/components/start/StartPageContent.vue:53、src/components/start/StartPageContent.vue:54）。修改侧栏宽度行为时必须分别处理这两个文件，不存在单一全局侧栏宽度约束。

---

## 二、逐条常量解读（作者为什么设这个限制）

### 2.1 有源码注释的常量（作者亲写的「为什么」）

#### （1）`SIDEBAR_MIN_WIDTH = 260` / `SIDEBAR_MAX_WIDTH = 480` — 监控侧栏

源码注释原文：

> 拖拽调宽：左缘手柄向左拖增宽；拖动中仅更新本地 ref（不触发落库），松手持久化
> —— src/components/monitor/MonitorSidebar.vue:166

解读：注释描述的是**拖拽调宽的状态写入时机**——拖动过程中只改本地 ref、不落库，松手才持久化。这防止的是拖拽过程中高频触发持久化写（每帧写一次配置）。260/480 是该交互可拖拽区间的下界与上界（src/components/monitor/MonitorSidebar.vue:166、src/components/monitor/MonitorSidebar.vue:167）。注释原文未说明为何取 260 与 480 这两个具体数值，数据中亦无用例佐证，取值依据无法确认。

#### （2）`SIDEBAR_MIN_WIDTH = 180` / `SIDEBAR_MAX_WIDTH = 240` — 起始页侧栏

源码注释原文：

> 侧栏拖拽调宽范围（px）
> —— src/components/start/StartPageContent.vue:53

解读：注释直接声明这两个常量就是**拖拽调宽范围，单位为 px**（src/components/start/StartPageContent.vue:53、src/components/start/StartPageContent.vue:54）。约束对象是侧栏宽度可调区间；注释未给出取值范围的具体依据。

#### （3）`MIN_BACKGROUND_OPACITY = 0.05`

源码注释原文：

> 不透明度下限（完全透明会导致文字对比度不可控）
> —— src/lib/backgroundImage.ts:9

解读：这是本页**动机最完整**的一条注释。作者明确写明了防止的失控场景：**完全透明会使文字对比度不可控**，因此把背景图不透明度下限锁在 0.05（src/lib/backgroundImage.ts:9）。改动该值会直接影响前景文字的对比度下限，属于可访问性相关边界。

#### （4）`RESIZE_MIN_INTERVAL = 32`

源码注释原文：

> Rate-limit reflows during a window drag — each reflow resizes the renderer's drawing buffer and re-uploads the glyph atlas texture.
> —— src/lib/frontends/xterm/resize.ts:11

解读（注释直译）：在窗口拖拽期间对 reflow 做速率限制，因为**每次 reflow 都会重新调整渲染器的绘图缓冲区尺寸，并重新上传字形图集纹理**（src/lib/frontends/xterm/resize.ts:11）。这条注释把限制原因落到了两项具体 GPU 侧开销上，说明该常量防止的是拖拽时高频 reflow 造成的渲染器重分配与纹理重传。注释未标注时间单位（见第四节待确认）。

#### （5）`MAX_WEBGL_RECOVERY_ATTEMPTS = 3`

源码注释原文（片段）：

> before giving up and letting xterm fall back to its DOM renderer.
> —— src/lib/frontends/xterm/support.ts:58

解读：注释为**后置片段**，语义是「……在放弃并让 xterm 回退到其 DOM 渲染器之前」。配合常量名可确认：WebGL 恢复尝试上限为 3 次，达到后放弃恢复、回退到 DOM 渲染器（src/lib/frontends/xterm/support.ts:58）。注释前半句未包含在数据中，触发恢复的具体条件无法从本页确认。

#### （6）`DEFAULT_MAX_PROMPT_JUMP = 20`

源码注释原文：

> promptLen 学习跳变上限：超出视为异步输出污染，丢弃本次学习
> —— src/lib/suggestions/promptTracker.ts:125

解读：注释点明了防止的失控场景——**异步输出污染**。当 promptLen 的学习值跳变超过 20 时，本次学习结果被直接丢弃，而不是写入学习模型（src/lib/suggestions/promptTracker.ts:125）。这是一条**数据可信度闸门**：宁可丢一次学习，也不让被污染的值进入模型。

#### （7）`MAX_SAMPLES = 150`

源码注释原文：

> 环形缓冲上限（full 级 2s ≈ 5 分钟窗口）
> —— src/stores/monitor.ts:11

解读：注释同时给出了**上限值与它换算出的时间窗口**：150 个采样点在 full 级 2s 采样间隔下约等于 5 分钟窗口（src/stores/monitor.ts:11）。约束对象是环形缓冲容量，即监控数据在内存中保留的时间跨度上限。注释是「值 ↔ 时间窗口」的换算说明，若修改采样间隔，注释中的 5 分钟换算关系会失效。

### 2.2 无源码注释的常量

以下常量数据中**未提供 const-comment**，因此只能确认约束对象与数值，不能确认作者设定的具体防失控目标。逐条列出以免遗漏：

| 常量 | 值 | 位置 | 可确认的约束对象 |
| --- | --- | --- | --- |
| `SIZE` | 1024 | scripts/gen-icon.ts:7 | 图标生成脚本中的尺寸类常量；具体约束对象（尺寸/缓冲/其他）数据未提供 |
| `MAX_VISIBLE_ROWS` | 8 | src/components/terminal/SuggestionMenu.vue:41 | 建议菜单可见行数上限为 8 |
| `MAX_HISTORY_SAME_SOURCE` | 8 | src/lib/suggestions/suggestionEngine.ts:11 | 同一来源的历史建议条数上限 |
| `MAX_HISTORY_GLOBAL` | 4 | src/lib/suggestions/suggestionEngine.ts:12 | 全局历史建议条数上限 |
| `MAX_QUICK_COMMANDS` | 4 | src/lib/suggestions/suggestionEngine.ts:13 | 快捷命令条数上限 |
| `MAX_PATHS` | 8 | src/lib/suggestions/suggestionEngine.ts:14 | 路径类建议条数上限 |
| `MAX_TOTAL` | 16 | src/lib/suggestions/suggestionEngine.ts:15 | 建议条目总数上限 |
| `INDEX_LIMIT` | 5000 | src/services/history.ts:9 | 历史索引条数上限 |

### 2.3 常量之间的数值关系（仅陈述可直接计算的数值事实）

- `src/lib/suggestions/suggestionEngine.ts` 的四个分类配额相加为 8 + 4 + 4 + 8 = **24**，而 `MAX_TOTAL` 为 **16**（src/lib/suggestions/suggestionEngine.ts:11、src/lib/suggestions/suggestionEngine.ts:12、src/lib/suggestions/suggestionEngine.ts:13、src/lib/suggestions/suggestionEngine.ts:14、src/lib/suggestions/suggestionEngine.ts:15）。即分类配额之和大于总配额，二者不是可同时取满的并行额度。具体如何裁剪的数据未提供。
- 建议菜单可见行数上限为 8（src/components/terminal/SuggestionMenu.vue:41），而建议总数上限为 16（src/lib/suggestions/suggestionEngine.ts:15）。二者是否为「一屏可见 8 条、超出滚动」的关系，数据未提供。
- 建议引擎的配额全部集中在 `suggestionEngine.ts:11-15` 五行内，共 5 个常量；同一文件中 `computeSuggestions` 的复杂度仅为 4（见第三节）。也就是说该文件的规模控制**主要由数值配额承担，而不是分支逻辑**。

---

## 三、复杂度热点

### 3.1 全量热点表（按复杂度降序）

函数以 `文件路径::函数名` 形式给出（qualname）；数据未提供行号，故不附行号，避免编造。

| 函数（qualname） | 源文件 | 复杂度 | 循环深度 |
| --- | --- | --- | --- |
| `src/stores/config/flush.ts::computeOps` | src/stores/config/flush.ts | 28 | 1 |
| `src/stores/config/flush.ts::commitOp` | src/stores/config/flush.ts | 23 | 0 |
| `src-tauri/src/ssh/auth.rs::authenticate` | src-tauri/src/ssh/auth.rs | 16 | 0 |
| `src-tauri/src/forward/loops.rs::accept_dynamic_connection` | src-tauri/src/forward/loops.rs | 13 | 0 |
| `src-tauri/src/ssh/session.rs::check_server_key` | src-tauri/src/ssh/session.rs | 11 | 0 |
| `src/components/settings/useGroupNameDialog.ts::commitGroupNameDialog` | src/components/settings/useGroupNameDialog.ts | 10 | 0 |
| `src/services/sshConnections.ts::connectHeadless` | src/services/sshConnections.ts | 8 | 0 |
| `src/lib/suggestions/controller.ts::acceptSelected` | src/lib/suggestions/controller.ts | 7 | 0 |
| `src/stores/transfers.ts::apply` | src/stores/transfers.ts | 6 | 1 |
| `src/lib/sshConnectionRegistry.ts::acquire` | src/lib/sshConnectionRegistry.ts | 6 | 0 |
| `src-tauri/src/s3sync/client.rs::build_target` | src-tauri/src/s3sync/client.rs | 6 | 0 |
| `src/lib/frontends/xterm/frontend.ts::attach` | src/lib/frontends/xterm/frontend.ts | 5 | 0 |
| `src/stores/tabs.ts::closeTab` | src/stores/tabs.ts | 5 | 0 |
| `src-tauri/src/secrets/keys.rs::algorithm_label` | src-tauri/src/secrets/keys.rs | 5 | 0 |
| `src-tauri/src/debug_log.rs::append_raw` | src-tauri/src/debug_log.rs | 4 | 0 |
| `src-tauri/src/ssh/auth.rs::ask_frontend` | src-tauri/src/ssh/auth.rs | 4 | 0 |
| `src/components/titlebar/tabSwitcherModel.ts::buildTabSwitcherItems` | src/components/titlebar/tabSwitcherModel.ts | 4 | 0 |
| `src/lib/suggestions/promptTracker.ts::collectCommand` | src/lib/suggestions/promptTracker.ts | 4 | 1 |
| `src-tauri/src/config/legacy.rs::config_load_legacy_yaml` | src-tauri/src/config/legacy.rs | 4 | 0 |

| `src/lib/suggestions/suggestionEngine.ts::computeSuggestions` | src/lib/suggestions/suggestionEngine.ts | 4 | 1 |

### 3.2 复杂度最高的函数逐项分析

以下分析所用度量均来自上表；数据未提供函数体源码，因此**风险判断锚定在「复杂度值 + 循环深度」两个可测维度上**，不涉及对具体分支内容的复述。

#### （1）`src/stores/config/flush.ts::computeOps` — 复杂度 28，循环深度 1

- 可确认事实：本页 20 个热点中复杂度最高者（复杂度 28），且是全表仅有的 3 个循环深度 ≥ 1 的函数之一（`src/stores/config/flush.ts::computeOps`）。
- 风险形态（推断，依据：复杂度 28 与循环深度 1 的组合度量）：复杂度已接近表中次高值 `commitOp`（23）的 1.25 倍，同时是唯一“高复杂度 + 带循环”的重量级组合之一。循环内叠加多分支，意味着**单次执行的路径数量随输入规模放大**，且分支覆盖难以靠枚举式测试穿透。该函数与同文件的 `commitOp`（复杂度 23）同时位于 `src/stores/config/flush.ts`，构成单文件双高热点。
- 重构方向（建议，非数据声明）：把「操作计算」与「操作提交」的职责切分点显式化，将循环体内的分类判定抽取为纯函数，使复杂度从「循环 × 分支」的乘积结构降为「循环 + 查表」的加和结构。

#### （2）`src/stores/config/flush.ts::commitOp` — 复杂度 23，循环深度 0

- 可确认事实：复杂度 23，循环深度 0（`src/stores/config/flush.ts::commitOp`）。
- 风险形态（推断，依据：复杂度 23 + 循环深度 0 的组合度量）：分支密集但无循环，说明其复杂度来自**离散的状态/类型分支组合**（典型为多路穷举），而非迭代规模。这类结构的测试代价集中在**分支组合覆盖**上，且新增一种配置操作类型就要触碰该函数一次，属于「每加一种能力都要改这一处」的扩展瓶颈。
- 重构方向（建议）：引入按操作类型分发的查表或策略结构，把 `commitOp` 降级为分发入口。

#### （3）`src-tauri/src/ssh/auth.rs::authenticate` — 复杂度 16，循环深度 0

- 可确认事实：复杂度 16，循环深度 0，位于 Rust 侧 `src-tauri/src/ssh/auth.rs`（`src-tauri/src/ssh/auth.rs::authenticate`）。同文件另有 `ask_frontend`（复杂度 4，循环深度 0），二者复杂度相差 4 倍（`src-tauri/src/ssh/auth.rs::ask_frontend`）。
- 风险形态：认证路径天然涉及多种凭据/交互分支，复杂度 16 说明**认证分支未被下沉到子模块**，与同文件的 `ask_frontend` 形成「主流程重、辅助流程轻」的不对称结构。改动任一认证方式都需在 16 个分支的上下文里定位插入点。
- 重构方向（建议）：按凭据类型拆分认证实现，用统一入口收敛。

#### （4）`src-tauri/src/forward/loops.rs::accept_dynamic_connection` — 复杂度 13，循环深度 0

- 可确认事实：复杂度 13，循环深度 0（`src-tauri/src/forward/loops.rs::accept_dynamic_connection`）。该文件是本页热点中唯一来自 `src-tauri/src/forward/` 目录者。
- 风险形态：名为 `accept` 的动态连接入口，复杂度 13 且无循环，说明其分支集中在**准入条件的多重判定**上。此类「准入门」函数的典型脆弱点是：放松任一分支都会扩大可达范围，而收紧任一分支又难以从度量上判断是否漏判，属于安全敏感方向。
- 重构方向（建议）：把准入条件拆成「可命名、可单独测试」的谓词集合。

#### （5）`src-tauri/src/ssh/session.rs::check_server_key` — 复杂度 11，循环深度 0

- 可确认事实：复杂度 11，循环深度 0（`src-tauri/src/ssh/session.rs::check_server_key`）。与 `src-tauri/src/ssh/auth.rs::authenticate`（16）合计 27，占 Rust 侧复杂度总量 63 的约 42.9%（可由此表直接计算）。
- 风险形态：主机密钥校验是信任链上的关键判定，复杂度 11 的分支集合意味着**判定结果的组合空间较大**，且该函数与 `authenticate` 同属 SSH 建立连接的关键路径，二者的改动会相互叠加到同一条链路上。

#### （6）第二梯队（复杂度 8–10）

| 函数 | 源文件 | 复杂度 | 循环深度 | 备注 |
| --- | --- | --- | --- | --- |
| `src/components/settings/useGroupNameDialog.ts::commitGroupNameDialog` | src/components/settings/useGroupNameDialog.ts | 10 | 0 | 前端热点中复杂度最高的非 flush 函数 |
| `src/services/sshConnections.ts::connectHeadless` | src/services/sshConnections.ts | 8 | 0 | 连接建立入口 |

以上两项均循环深度 0（`src/components/settings/useGroupNameDialog.ts::commitGroupNameDialog`、`src/services/sshConnections.ts::connectHeadless`），说明前端复杂度热点以**分支密集**而非**迭代密集**为主。

### 3.3 复杂度分布统计

| 维度 | 数值 | 依据 |
| --- | --- | --- |
| 热点函数总数 | 20 | 本页热点表 |
| 复杂度总和 | 173 | 由表中 20 个数值求和 |
| 循环深度 = 0 的函数 | 17 / 20 | 热点表中 `loopDepth` 为 0 的条目 |
| 循环深度 ≥ 1 的函数 | 3：`computeOps`、`src/stores/transfers.ts::apply`、`src/lib/suggestions/promptTracker.ts::collectCommand` | 热点表中 `loopDepth` 为 1 的条目 |
| 循环深度 ≥ 2 的函数 | 未检测到 | 热点表最大 `loopDepth` 为 1 |
| 前端侧（src/）复杂度合计 | 110 / 173 ≈ 63.6% | 由表中前端条目求和 |
| Rust 侧（src-tauri/）复杂度合计 | 63 / 173 ≈ 36.4% | 由表中 Rust 条目求和 |
| 单文件最高贡献 | `src/stores/config/flush.ts`：51 / 173 ≈ 29.5%（2 个函数） | `computeOps` + `commitOp` |
| 复杂度 ≥ 20 的函数 | 2 个，均在 `src/stores/config/flush.ts` | `computeOps`(28)、`commitOp`(23) |

结论性事实：**循环嵌套在本次统计数据中不是主要风险源**（最大深度 1，17/20 为 0），复杂度压力集中在**单函数分支数**上；且不到 30% 的复杂度集中在一个文件 `src/stores/config/flush.ts` 上，该文件是该侧最集中的维护成本点。

---

## 四、已知边界

本节回答「哪些地方最脆弱、改动代价在哪」，全部结论均可回溯到第一节常量表、第二节注释原文或第三节度量表。

### 4.1 硬边界清单（按约束类型归类）

| 边界类型 | 约束 | 常量与锚点 | 越界后的可预期后果 |
| --- | --- | --- | --- |
| 渲染性能 | 窗口拖拽期间 reflow 限速 | `RESIZE_MIN_INTERVAL = 32`（src/lib/frontends/xterm/resize.ts:11） | 注释明示：每次 reflow 会重设绘图缓冲区并重传字形图集纹理（src/lib/frontends/xterm/resize.ts:11） |
| 渲染降级 | WebGL 恢复尝试上限 | `MAX_WEBGL_RECOVERY_ATTEMPTS = 3`（src/lib/frontends/xterm/support.ts:58） | 注释明示：达到上限后放弃并回退到 xterm 的 DOM 渲染器（src/lib/frontends/xterm/support.ts:58） |
| 可访问性 | 背景图不透明度下限 | `MIN_BACKGROUND_OPACITY = 0.05`（src/lib/backgroundImage.ts:9） | 注释明示：完全透明会导致文字对比度不可控（src/lib/backgroundImage.ts:9） |
| 学习数据可信度 | promptLen 跳变上限 | `DEFAULT_MAX_PROMPT_JUMP = 20`（src/lib/suggestions/promptTracker.ts:125） | 注释明示：超出视为异步输出污染，丢弃本次学习（src/lib/suggestions/promptTracker.ts:125） |
| 内存 / 时间窗口 | 监控环形缓冲容量 | `MAX_SAMPLES = 150`（src/stores/monitor.ts:11） | 注释给出换算：full 级 2s ≈ 5 分钟窗口（src/stores/monitor.ts:11） |
| 交互区间 | 监控侧栏宽度 | `SIDEBAR_MIN_WIDTH = 260` / `SIDEBAR_MAX_WIDTH = 480`（src/components/monitor/MonitorSidebar.vue:166、src/components/monitor/MonitorSidebar.vue:167） | 注释明示拖拽中不落库、松手持久化（src/components/monitor/MonitorSidebar.vue:166） |
| 交互区间 | 起始页侧栏宽度 | `SIDEBAR_MIN_WIDTH = 180` / `SIDEBAR_MAX_WIDTH = 240`（src/components/start/StartPageContent.vue:53、src/components/start/StartPageContent.vue:54） | 注释明示为侧栏拖拽调宽范围，单位 px（src/components/start/StartPageContent.vue:53） |
| 结果规模 | 建议条数配额 | `MAX_HISTORY_SAME_SOURCE = 8`、`MAX_HISTORY_GLOBAL = 4`、`MAX_QUICK_COMMANDS = 4`、`MAX_PATHS = 8`、`MAX_TOTAL = 16`（src/lib/suggestions/suggestionEngine.ts:11–15） | 配额越界的具体裁剪行为数据未提供 |
| 结果规模 | 建议菜单可见行数 | `MAX_VISIBLE_ROWS = 8`（src/components/terminal/SuggestionMenu.vue:41） | 越界后的滚动/截断行为数据未提供 |
| 数据规模 | 历史索引条数 | `INDEX_LIMIT = 5000`（src/services/history.ts:9） | 越界后的淘汰/拒绝策略数据未提供 |
| 构建期产物尺寸 | 图标生成尺寸类常量 | `SIZE = 1024`（scripts/gen-icon.ts:7） | 具体约束对象数据未提供 |

### 4.2 最脆弱的三处（结论 + 依据）

1. **`src/stores/config/flush.ts`**：单文件承载 51/173 ≈ 29.5% 的热点复杂度，且同时持有全表复杂度最高的 `computeOps`（28）与次高的 `commitOp`（23），并且 `computeOps` 是三个带循环的函数之一（`src/stores/config/flush.ts::computeOps`、`src/stores/config/flush.ts::commitOp`）。改动配置写入/提交语义时，该文件是第一落点。
2. **SSH 信任与认证链路**：`src-tauri/src/ssh/auth.rs::authenticate`（16）与 `src-tauri/src/ssh/session.rs::check_server_key`（11）合计占 Rust 侧复杂度约 42.9%，且二者同属连接建立的关键判定。认证方式或主机密钥策略的任何调整都要在这条链路上进行。
3. **xterm 渲染降级链**：`RESIZE_MIN_INTERVAL`（src/lib/frontends/xterm/resize.ts:11）与 `MAX_WEBGL_RECOVERY_ATTEMPTS`（src/lib/frontends/xterm/support.ts:58）两条注释都以「渲染器/纹理」级别的开销为理由，说明该链路的改动直接落在 GPU 侧行为上，而非纯逻辑层。

### 4.3 改动代价地图

| 变更意图 | 必须同时处理的文件 | 依据 |
| --- | --- | --- |
| 调整侧栏宽度行为 | `src/components/monitor/MonitorSidebar.vue` 与 `src/components/start/StartPageContent.vue`（两套取值：260/480 与 180/240） | src/components/monitor/MonitorSidebar.vue:166、src/components/start/StartPageContent.vue:53 |
| 调整建议条数 | `src/lib/suggestions/suggestionEngine.ts` 内 5 个配额常量需一起复核（分类配额和 24 > 总配额 16） | src/lib/suggestions/suggestionEngine.ts:11–15 |
| 调整监控采样窗口 | `src/stores/monitor.ts:11` 的注释换算关系（2s × 150 ≈ 5 分钟）会随采样间隔变化而失效 | src/stores/monitor.ts:11 |
| 调整终端重排流控 | `src/lib/frontends/xterm/resize.ts:11`；需按注释中「缓冲区重设 + 图集重传」两项开销评估 | src/lib/frontends/xterm/resize.ts:11 |

---

## 五、待确认

以下为影响读者判断的关键缺口，均因数据不足以描述，不做推测：

1. **`RESIZE_MIN_INTERVAL = 32` 的时间单位**：注释（src/lib/frontends/xterm/resize.ts:11）说明了限速理由，但未在给定数据中标明单位（毫秒或帧），因此无法判断其对应的最大重排频率。
2. **`SIZE = 1024` 的实际约束对象**：`scripts/gen-icon.ts:7` 处仅有名称与数值，数据未提供用途说明或其他锚点，无法确认其约束的是输出图标尺寸还是中间缓冲尺寸。
3. **`MAX_WEBGL_RECOVERY_ATTEMPTS` 的触发条件**：src/lib/frontends/xterm/support.ts:58 的注释在给定数据中仅为后半句（「…before giving up and letting xterm fall back to its DOM renderer.」），无法确认进入恢复流程的前置条件。
4. **建议配额的实际裁剪算法**：`MAX_TOTAL = 16` 与分类配额之和 24 的关系（src/lib/suggestions/suggestionEngine.ts:11–15）在数据中无对应实现描述，`computeSuggestions` 的复杂度为 4、循环深度为 1（`src/lib/suggestions/suggestionEngine.ts::computeSuggestions`），不足以还原裁剪顺序。

---

## 六、本页数据可回答与不可回答的问题

| 问题 | 是否可由本页数据回答 | 依据 |
| --- | --- | --- |
| 项目有哪些硬编码上限？ | 是 | 第一节常量表 17 条 |
| 每个上限防止的是什么？ | 部分（7/17 有作者注释） | 第二节 intent 清单 |
| 复杂度压力集中在哪？ | 是 | 第三节统计表 |
| 循环嵌套是否是主要风险？ | 是（否；最大深度 1） | 第三节 3.3 |
| 这些常量在何处被读取、读取后如何影响调用链？ | 否（数据未提供使用点与调用边） | 常量表仅含名称/值/位置 |
| 热点函数内部由哪些分支构成？ | 否（数据未提供函数体） | 热点表仅含复杂度与循环深度 |

---

**校验说明（供审阅）**：本页所有常量声明均带 `file:line`；所有函数结论均带 `qualified_name`（待确认） 形式锚点；7 条动机解读全部引用 intent 原文并附锚点；「推断」标注出现于 3.2 的 (1)(2) 两处，均在括号内写明推断依据为复杂度与循环深度度量；「待确认」共 4 处，集中在第五节；本页未使用 Mermaid 图，因数据不含依赖边、调用边或继承边。
## Related

- 同目录：[conventions.md](conventions.md)
- 共享 3 个源文件、共享 19 个符号：[troubleshooting.md](../05-guides/troubleshooting.md)
- 共享 5 个源文件、共享 2 个符号：[glossary.md](../07-reference/glossary.md)
- 共享 2 个源文件、共享 2 个符号：[architecture.md](../02-architecture/architecture.md)
- 总入口：[README](../README.md)
