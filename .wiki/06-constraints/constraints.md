# 限制常量与复杂度热点

<details>
<summary>Relevant source files</summary>

- scripts/gen-icon.ts
- src-tauri/src/debug_log.rs
- src-tauri/src/forward/loops.rs
- src-tauri/src/secrets/keys.rs
- src-tauri/src/ssh/auth.rs
- src/lib/backgroundImage.ts
- src/lib/frontends/xterm/frontend.ts
- src/lib/frontends/xterm/resize.ts
- src/lib/frontends/xterm/support.ts
- src/lib/jumpChain.ts
- src/lib/sshConnectionRegistry.ts
- src/lib/suggestions/controller.ts
- src/lib/suggestions/promptTracker.ts
- src/lib/suggestions/suggestionEngine.ts
- src/services/history.ts
</details>

本页汇总项目中的硬编码限制常量与高复杂度函数，回答两个问题：**哪些数值是写死的硬边界**、**哪些函数的维护成本最高**。

> 数据说明：热点函数数据未提供行号，函数级定位以「源文件路径 + 函数名」为准；常量均带 `file:line`。

## 一、限制常量总表

共 19 处，按所属子系统归并列出。

| 常量 | 值 | 源文件:行号 | 防护目标（依据源码注释） |
| --- | --- | --- | --- |
| `SIZE` | 1024 | `scripts/gen-icon.ts:7` | 信息不足（无注释） |
| `SIDEBAR_MIN_WIDTH` | 260 | `src/components/monitor/MonitorSidebar.vue:166` | 拖拽调宽下界 + 落库时机 |
| `SIDEBAR_MAX_WIDTH` | 480 | `src/components/monitor/MonitorSidebar.vue:167` | 拖拽调宽上界 |
| `SIDEBAR_MIN_WIDTH` | 180 | `src/components/start/StartPageContent.vue:53` | 侧栏拖拽调宽范围（px） |
| `SIDEBAR_MAX_WIDTH` | 240 | `src/components/start/StartPageContent.vue:54` | 侧栏拖拽调宽范围（px） |
| `MAX_VISIBLE_ROWS` | 8 | `src/components/terminal/SuggestionMenu.vue:41` | 信息不足（无注释） |
| `MIN_BACKGROUND_OPACITY` | 0.05 | `src/lib/backgroundImage.ts:9` | 文字对比度下限 |
| `RESIZE_MIN_INTERVAL` | 32 | `src/lib/frontends/xterm/resize.ts:11` | 窗口拖拽期间的重排/重传限流 |
| `MAX_WEBGL_RECOVERY_ATTEMPTS` | 3 | `src/lib/frontends/xterm/support.ts:58` | WebGL 恢复重试上限 |
| `MAX_JUMP_DEPTH` | 8 | `src/lib/jumpChain.ts:28` | 跳板链深度上限 |
| `DEFAULT_MAX_PROMPT_JUMP` | 20 | `src/lib/suggestions/promptTracker.ts:125` | promptLen 学习跳变上限 |
| `MAX_HISTORY_SAME_SOURCE` | 8 | `src/lib/suggestions/suggestionEngine.ts:11` | 信息不足（无注释） |
| `MAX_HISTORY_GLOBAL` | 4 | `src/lib/suggestions/suggestionEngine.ts:12` | 信息不足（无注释） |
| `MAX_QUICK_COMMANDS` | 4 | `src/lib/suggestions/suggestionEngine.ts:13` | 信息不足（无注释） |
| `MAX_WORKFLOWS` | 3 | `src/lib/suggestions/suggestionEngine.ts:14` | 信息不足（无注释） |
| `MAX_PATHS` | 8 | `src/lib/suggestions/suggestionEngine.ts:15` | 信息不足（无注释） |
| `MAX_TOTAL` | 16 | `src/lib/suggestions/suggestionEngine.ts:16` | 信息不足（无注释） |
| `INDEX_LIMIT` | 5000 | `src/services/history.ts:9` | 信息不足（无注释） |
| `MAX_SAMPLES` | 150 | `src/stores/monitor.ts:11` | 环形缓冲上限 |

## 二、常量逐个解读

### 2.1 侧栏宽度（两套互不相同的区间）

**`SIDEBAR_MIN_WIDTH` = 260 / `SIDEBAR_MAX_WIDTH` = 480**（`src/components/monitor/MonitorSidebar.vue:166`、`src/components/monitor/MonitorSidebar.vue:167`）

注释原文：

> 拖拽调宽：左缘手柄向左拖增宽；拖动中仅更新本地 ref（不触发落库），松手持久化
> —— `src/components/monitor/MonitorSidebar.vue:166`

这条注释限制的不只是宽度数值，还有**写入时机**：拖拽过程中不落库，松手才持久化。也就是说 260/480 这两个值防的是"拖拽期间高频写入"，宽度区间只是副产物。

**`SIDEBAR_MIN_WIDTH` = 180 / `SIDEBAR_MAX_WIDTH` = 240**（`src/components/start/StartPageContent.vue:53`、`src/components/start/StartPageContent.vue:54`）

注释原文：

> 侧栏拖拽调宽范围（px）
> —— `src/components/start/StartPageContent.vue:53`

同名常量在两处组件中取到完全不同的区间（260–480 与 180–240），说明这两个侧栏各自维护尺寸约束，不共享同一份配置。改动"统一侧栏宽度"需要同时改两处，且注意两处的落库语义不同（`StartPageContent.vue:53` 的注释只声明了范围，未提及持久化时机）。

### 2.2 视觉与可读性

**`MIN_BACKGROUND_OPACITY` = 0.05**（`src/lib/backgroundImage.ts:9`）

注释原文：

> 不透明度下限（完全透明会导致文字对比度不可控）
> —— `src/lib/backgroundImage.ts:9`

防的是**可读性失控**而非性能：允许用户把背景图调淡，但不允许调到完全透明，避免前景文字与底层内容叠加后对比度不可保证。

### 2.3 终端渲染（xterm 前端）

**`RESIZE_MIN_INTERVAL` = 32**（`src/lib/frontends/xterm/resize.ts:11`）

注释原文：

> Rate-limit reflows during a window drag — each reflow resizes the renderer's drawing buffer and re-uploads the glyph atlas texture.
> —— `src/lib/frontends/xterm/resize.ts:11`

作者明确写出了"为什么有这个限制"：每次 reflow 都会重建渲染器绘制缓冲并重新上传字形图集纹理，窗口拖拽期间不做限流会按拖拽事件频率重复这套开销。32 ms 即两次 reflow 之间的最小间隔。

**`MAX_WEBGL_RECOVERY_ATTEMPTS` = 3**（`src/lib/frontends/xterm/support.ts:58`）

注释原文（片段）：

> before giving up and letting xterm fall back to its DOM renderer.
> —— `src/lib/frontends/xterm/support.ts:58`

限制的是 WebGL 上下文丢失后的恢复重试次数；达到 3 次后不再重试，转为降级到 xterm 自带的 DOM 渲染器。这是"避免无限重试"的硬闸门。

**`MAX_VISIBLE_ROWS` = 8**（`src/components/terminal/SuggestionMenu.vue:41`）

该常量在 `SuggestionMenu.vue`（建议菜单组件）中，源码注释未提供，防护动机信息不足。

### 2.4 建议系统（配额 + 学习上限）

**`DEFAULT_MAX_PROMPT_JUMP` = 20**（`src/lib/suggestions/promptTracker.ts:125`）

注释原文：

> promptLen 学习跳变上限：超出视为异步输出污染，丢弃本次学习
> —— `src/lib/suggestions/promptTracker.ts:125`

注意其行为是**丢弃本次学习**而非截断到上限：超过 20 的跳变被判定为异步输出污染，整次学习作废。这是防"污染样本进入学习模型导致提示长度基准持续漂移"。

**六个配额常量**（`src/lib/suggestions/suggestionEngine.ts:11` – `src/lib/suggestions/suggestionEngine.ts:16`）：

| 常量 | 值 | 锚点 |
| --- | --- | --- |
| `MAX_HISTORY_SAME_SOURCE` | 8 | `src/lib/suggestions/suggestionEngine.ts:11` |
| `MAX_HISTORY_GLOBAL` | 4 | `src/lib/suggestions/suggestionEngine.ts:12` |
| `MAX_QUICK_COMMANDS` | 4 | `src/lib/suggestions/suggestionEngine.ts:13` |
| `MAX_WORKFLOWS` | 3 | `src/lib/suggestions/suggestionEngine.ts:14` |
| `MAX_PATHS` | 8 | `src/lib/suggestions/suggestionEngine.ts:15` |
| `MAX_TOTAL` | 16 | `src/lib/suggestions/suggestionEngine.ts:16` |

这六个常量在同一文件的相邻行（11–16）连续排布，构成一组"分类配额 + 总量上限"。单从数值看：各分项之和为 8+4+4+3+8=27，大于 `MAX_TOTAL`=16；若它们作用于同一份候选预算，则总量上限是更紧的约束，单独调高某一分项可能被总量上限吸收（推断，依据为常量命名与同文件相邻排布，无函数体或注释佐证）。

这些常量均无源码注释，防护动机信息不足。

### 2.5 跳板链与会话

**`MAX_JUMP_DEPTH` = 8**（`src/lib/jumpChain.ts:28`）

注释原文：

> 跳板链最大深度（对齐 OpenSSH 常见限制量级，防误配置递归）
> —— `src/lib/jumpChain.ts:28`

两种失控场景被一并堵住：跳板链配置成环导致的递归展开，以及链路过长带来的连接放大。注释同时说明了 8 这个取值的来源——对齐 OpenSSH 常见限制量级，而非本地实测结果。

### 2.6 容量型常量

**`MAX_SAMPLES` = 150**（`src/stores/monitor.ts:11`）

注释原文：

> 环形缓冲上限（full 级 2s ≈ 5 分钟窗口）
> —— `src/stores/monitor.ts:11`

注释自证了换算关系：150 个样本 × 2s 采样间隔 ≈ 300s，即约 5 分钟监控窗口。这是"用固定内存换固定时间窗"的设计，窗口时长与内存占用被同一个常量绑定。

**`INDEX_LIMIT` = 5000**（`src/services/history.ts:9`）

该常量在历史服务中，源码注释未提供；其计量单位（条数 / 字节 / 索引项）与超限后的处理方式（截断 / 淘汰）信息不足。

### 2.7 构建脚本

**`SIZE` = 1024**（`scripts/gen-icon.ts:7`）

所在文件为图标生成脚本，但源码注释未提供，该值的单位（像素边长 / 输出尺寸 / 缓冲大小）与约束对象信息不足。

## 三、复杂度热点

数据给出的热点函数共 9 个，覆盖 Rust 侧 5 个、TypeScript/Vue 侧 4 个。

| 函数 | 源文件 | 复杂度 | 循环深度 |
| --- | --- | --- | --- |
| `authenticate` | `src-tauri/src/ssh/auth.rs` | 16 | 0 |
| `accept_dynamic_connection` | `src-tauri/src/forward/loops.rs` | 13 | 0 |
| `acceptSelected` | `src/lib/suggestions/controller.ts` | 10 | 0 |
| `acquire` | `src/lib/sshConnectionRegistry.ts` | 6 | 0 |
| `apply` | `src/stores/transfers.ts` | 6 | 1 |
| `algorithm_label` | `src-tauri/src/secrets/keys.rs` | 5 | 0 |
| `attach` | `src/lib/frontends/xterm/frontend.ts` | 5 | 0 |
| `append_raw` | `src-tauri/src/debug_log.rs` | 4 | 0 |
| `ask_frontend` | `src-tauri/src/ssh/auth.rs` | 4 | 0 |

### 3.1 `authenticate`（`src-tauri/src/ssh/auth.rs`，复杂度 16，循环深度 0）

- **复杂度最高**的一处，是 `acceptSelected`（10）的 1.6 倍、`apply`（6）的 2.7 倍。
- 循环深度为 0，说明复杂度**不来自嵌套循环**，而来自分支判定数量；改动代价不在迭代逻辑，而在于分支路径的组合覆盖。
- 同一文件中还有一个低复杂度函数 `ask_frontend`（复杂度 4，`src-tauri/src/ssh/auth.rs`）。热点集中度上，改动风险全部压在 `authenticate` 单个函数上。
- 建议方向（非数据事实）：将分支按失败模式归并到独立的守卫子函数，以降低单函数分支数——具体适用性需先看函数体，函数体未提供，分支语义信息不足。

### 3.2 `accept_dynamic_connection`（`src-tauri/src/forward/loops.rs`，复杂度 13，循环深度 0）

- 全表第二高，同样是无嵌套循环的分支密集型函数。
- 位于 `src-tauri/src/forward/` 路径下，与 `authenticate` 分属不同模块，说明高复杂度并非集中在单一模块，而是分散在转发与认证两条链路上。

### 3.3 `acceptSelected`（`src/lib/suggestions/controller.ts`，复杂度 10，循环深度 0）

- 前端侧复杂度最高的函数。
- 路径 `src/lib/suggestions/` 与本文第二节的六组配额常量（`src/lib/suggestions/suggestionEngine.ts:11`–`src/lib/suggestions/suggestionEngine.ts:16`）以及学习上限（`src/lib/suggestions/promptTracker.ts:125`）同属建议子系统。这意味着该子系统同时承担"上限数值集中"与"高复杂度逻辑集中"两重负担，是前端侧改动面最广的区域。

### 3.4 `acquire`（`src/lib/sshConnectionRegistry.ts`，复杂度 6）与 `apply`（`src/stores/transfers.ts`，复杂度 6，循环深度 1）

- `acquire`（`src/lib/sshConnectionRegistry.ts`，复杂度 6）与 `apply`（`src/stores/transfers.ts`，复杂度 6，循环深度 1）：
  - 二者复杂度相同但形态不同。`apply` 是全表**唯一循环深度非 0** 的函数（`src/stores/transfers.ts`），意味着迭代逻辑参与了复杂度构成；其余 8 个函数的复杂度全部来自分支判定。
  - `acquire` 位于 SSH 连接注册表（`src/lib/sshConnectionRegistry.ts`），与同为连接语义的 `authenticate`（`src-tauri/src/ssh/auth.rs`，复杂度 16）分处前后端两侧。连接建立链路上前后端各有一个复杂度 6 以上的函数，是该链路改动时的两处需要同步审视的点。

### 3.5 中低复杂度函数

| 函数 | 源文件 | 复杂度 | 循环深度 | 与高复杂度函数的关系 |
| --- | --- | --- | --- | --- |
| `algorithm_label` | `src-tauri/src/secrets/keys.rs` | 5 | 0 | 独立模块（密钥） |
| `attach` | `src/lib/frontends/xterm/frontend.ts` | 5 | 0 | 与 `src/lib/frontends/xterm/resize.ts`、`src/lib/frontends/xterm/support.ts` 同属终端前端目录 |
| `append_raw` | `src-tauri/src/debug_log.rs` | 4 | 0 | 独立模块（调试日志） |
| `ask_frontend` | `src-tauri/src/ssh/auth.rs` | 4 | 0 | 与 `authenticate` **同文件** |

`attach` 值得单独标注：终端前端目录中，限制常量与热点函数同时出现——`RESIZE_MIN_INTERVAL`（`src/lib/frontends/xterm/resize.ts:11`）、`MAX_WEBGL_RECOVERY_ATTEMPTS`（`src/lib/frontends/xterm/support.ts:58`）与 `attach`（`src/lib/frontends/xterm/frontend.ts`）分别落在三个文件，但都服务于同一个渲染前端。该目录是本页中唯一"常量 + 热点"同时出现的目录。

`ask_frontend`（复杂度 4）与 `authenticate`（复杂度 16）同处 `src-tauri/src/ssh/auth.rs`：同一文件内复杂度落差达 4 倍，说明认证模块的复杂度并未均匀分布，而是集中在 `authenticate` 一处。

### 3.6 热点分布小结

| 观察维度 | 事实 | 锚点依据 |
| --- | --- | --- |
| 最高复杂度 | 16，`authenticate` | `src-tauri/src/ssh/auth.rs` |
| 复杂度≥10 的函数数 | 3 个（`authenticate`、`accept_dynamic_connection`、`acceptSelected`） | `src-tauri/src/ssh/auth.rs`；`src-tauri/src/forward/loops.rs`；`src/lib/suggestions/controller.ts` |
| 唯一非零循环深度 | `apply`（深度 1） | `src/stores/transfers.ts` |
| 前后端峰值位置 | Rust 侧峰值 16，TS 侧峰值 10 | `src-tauri/src/ssh/auth.rs`；`src/lib/suggestions/controller.ts` |
| 热点与常量同目录 | `src/lib/frontends/xterm/`、`src/lib/suggestions/` | 见上表 |
| 同文件复杂度落差 | `src-tauri/src/ssh/auth.rs` 内 16 与 4 | `src-tauri/src/ssh/auth.rs` |

## 四、已知边界

### 4.1 数值的取值一致性边界

同一语义的常量在不同组件中取了**不同区间**：

| 语义 | 位置 A | 位置 B | 差异 |
| --- | --- | --- | --- |
| 侧栏最小宽度 | 260（`src/components/monitor/MonitorSidebar.vue:166`） | 180（`src/components/start/StartPageContent.vue:53`） | 相差 80 |
| 侧栏最大宽度 | 480（`src/components/monitor/MonitorSidebar.vue:167`） | 240（`src/components/start/StartPageContent.vue:54`） | 相差 240 |

两处的最小值、最大值均不相同，且范围宽度也不同（220 vs 60）。这些值分散定义在各自组件文件中，没有共同的配置来源，任何"统一侧栏手感"的改动都必须逐文件修改，且容易漏改一处。

### 4.2 常量定义的物理分散边界

19 个常量分布在 6 个顶层路径下的 10 个文件：

| 顶层路径 | 常量数 | 文件 |
| --- | --- | --- |
| `scripts/` | 1 | `scripts/gen-icon.ts:7` |
| `src/components/` | 5 | `src/components/monitor/MonitorSidebar.vue:166`、`:167`；`src/components/start/StartPageContent.vue:53`、`:54`；`src/components/terminal/SuggestionMenu.vue:41` |
| `src/lib/` | 9 | `src/lib/backgroundImage.ts:9`；`src/lib/frontends/xterm/resize.ts:11`；`src/lib/frontends/xterm/support.ts:58`；`src/lib/jumpChain.ts:28`；`src/lib/suggestions/promptTracker.ts:125`；`src/lib/suggestions/suggestionEngine.ts:11`–`:16` |
| `src/services/` | 1 | `src/services/history.ts:9` |
| `src/stores/` | 1 | `src/stores/monitor.ts:11` |

改动面横跨构建脚本、UI 组件、库代码、服务层与状态层。**改动代价集中在"找齐"而非"改对"**：单个常量的修改本身成本低，但判断"是否还有同类限制没改"需要全仓库检索。

### 4.3 注释覆盖边界

19 个常量中，携带源码注释的有 8 处：

| 有注释的常量 | 锚点 |
| --- | --- |
| `SIDEBAR_MIN_WIDTH` | `src/components/monitor/MonitorSidebar.vue:166` |
| `SIDEBAR_MIN_WIDTH` | `src/components/start/StartPageContent.vue:53` |
| `MIN_BACKGROUND_OPACITY` | `src/lib/backgroundImage.ts:9` |
| `RESIZE_MIN_INTERVAL` | `src/lib/frontends/xterm/resize.ts:11` |
| `MAX_WEBGL_RECOVERY_ATTEMPTS` | `src/lib/frontends/xterm/support.ts:58` |
| `MAX_JUMP_DEPTH` | `src/lib/jumpChain.ts:28` |
| `DEFAULT_MAX_PROMPT_JUMP` | `src/lib/suggestions/promptTracker.ts:125` |
| `MAX_SAMPLES` | `src/stores/monitor.ts:11` |

其余 11 处（`scripts/gen-icon.ts:7`；`src/components/monitor/MonitorSidebar.vue:167`；`src/components/start/StartPageContent.vue:54`；`src/components/terminal/SuggestionMenu.vue:41`；`src/lib/suggestions/suggestionEngine.ts:11`–`:16`；`src/services/history.ts:9`）无源码注释可引用，其"为什么是这个值"无法从数据中还原。

其中最需注意的是 `src/lib/suggestions/suggestionEngine.ts:11`–`:16` 六连排的配额常量：它们数量最多（占无注释常量的过半），且相互之间存在总量与分项的潜在耦合（见第 2.4 节），注释缺失使调整时的安全性判断缺少依据。

### 4.4 复杂度形态边界

- **分支密集型为主**：9 个热点函数中 8 个循环深度为 0，说明风险主要来自条件分支的组合，而非迭代次数或数据规模。
- **热点不集中**：3 个复杂度≥10 的函数分处 Rust 转发、Rust 认证、TS 建议三条互不相干的链路，不存在单一"高风险模块"可以集中加固。
- **建议子系统双高**：`src/lib/suggestions/` 目录同时容纳前端最高复杂度函数（`acceptSelected`，10）与最大的一组配额常量（`src/lib/suggestions/suggestionEngine.ts:11`–`:16`），是本页数据中前端改动面最广的区域。

### 4.5 数据中未出现的约束类别

以下类别在本页数据中**未检测到**，不代表项目一定没有，仅表示本次提供的数据中没有对应条目：

- 未检测到超时类常量（如连接超时、请求超时）。
- 未检测到内存字节数上限类常量。
- 未检测到重试类常量，唯一与重试相关的是 WebGL 恢复次数（`src/lib/frontends/xterm/support.ts:58`）。
- 未检测到并发数 / 连接数上限类常量。

如需确认这些边界是否存在，需补充相应文件或检索结果。

## 五、待确认

| 缺口 | 缺什么证据 |
| --- | --- |
| `INDEX_LIMIT`（`src/services/history.ts:9`）的计量单位与超限行为 | 无源码注释；需该常量所在函数的截断/淘汰逻辑 |
| `SIZE`（`scripts/gen-icon.ts:7`）的单位与约束对象 | 无源码注释；需图标生成脚本中该值的消费点 |
| `MAX_VISIBLE_ROWS`（`src/components/terminal/SuggestionMenu.vue:41`）对应的展示约束意图 | 无源码注释；需 `src/components/terminal/SuggestionMenu.vue` 中该值的使用位置 |
| `src/lib/suggestions/suggestionEngine.ts:11`–`:16` 六个配额是否作用于同一份候选预算、`MAX_TOTAL` 与各分项的实际关系 | 无源码注释；需 `src/lib/suggestions/suggestionEngine.ts` 中六者的取值/裁剪代码 |

## 六、一句话结论

本项目的硬边界由两类东西构成：**分散在 10 个文件、19 个常量里的固定数值**（其中 11 处无注释，两处侧栏宽度区间互不相同），以及**3 个复杂度≥10 的分支密集型函数**（分处认证、转发、建议三条独立链路）。改动代价不在单个数值或单个函数有多难改，而在于**同类约束没有统一来源、热点没有集中位置**——修一处必须全仓库确认同类项，改一条链路不会顺带降低另一条链路的复杂度。
## Related

- 同目录：[conventions.md](conventions.md)
- 共享 6 个源文件、共享 34 个符号：[troubleshooting.md](../05-guides/troubleshooting.md)
- 共享 2 个源文件、共享 7 个符号：[onboarding.md](../05-guides/onboarding.md)
- 共享 4 个源文件、共享 5 个符号：[glossary.md](../07-reference/glossary.md)
- 总入口：[README](../README.md)

<!-- wiki:source: llm -->
