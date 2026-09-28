# 约束与复杂度边界

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
- src/lib/backgroundImage.ts
- src/lib/frontends/xterm/frontend.ts
- src/lib/frontends/xterm/resize.ts
- src/lib/frontends/xterm/support.ts
- src/lib/sshConnectionRegistry.ts
- src/lib/suggestions/controller.ts
</details>

本页汇总项目中**硬编码限制常量**与**高复杂度函数**两类数据，用于回答「哪些规模被显式封顶」「改动代价集中在哪些文件」这两个问题。所有条目均来自静态扫描结果。

> **数据来源与口径说明**
> 本页数据仅含两项：常量清单（17 条）与高复杂度函数清单（19 条）。数据集中**未提供行号**，因此锚点使用完整相对路径（如 `src-tauri/src/ssh/auth.rs`）；数据集中**未提供依赖使用记录（depUsage）、import 关系或调用边**，因此本页不含调用关系表与依赖图。
> 逐条常量解读依据的是**标识符语义与所在文件路径**，数据集中没有调用点可佐证，故一律使用「表明/指向」而非「用于」。

---

## 一、限制常量

### 1.1 全量清单（17 条）

| 常量 | 值 | 源文件 |
|---|---|---|
| `SIZE` | `1024` | `scripts/gen-icon.ts` |
| `SIDEBAR_MIN_WIDTH` | `260` | `src/components/monitor/MonitorSidebar.vue` |
| `SIDEBAR_MAX_WIDTH` | `480` | `src/components/monitor/MonitorSidebar.vue` |
| `SIDEBAR_MIN_WIDTH` | `180` | `src/components/start/StartPageContent.vue` |
| `SIDEBAR_MAX_WIDTH` | `240` | `src/components/start/StartPageContent.vue` |
| `MAX_VISIBLE_ROWS` | `8` | `src/components/terminal/SuggestionMenu.vue` |
| `MIN_BACKGROUND_OPACITY` | `0.05` | `src/lib/backgroundImage.ts` |
| `RESIZE_MIN_INTERVAL` | `32` | `src/lib/frontends/xterm/resize.ts` |
| `MAX_WEBGL_RECOVERY_ATTEMPTS` | `3` | `src/lib/frontends/xterm/support.ts` |
| `DEFAULT_MAX_PROMPT_JUMP` | `20` | `src/lib/suggestions/promptTracker.ts` |
| `MAX_HISTORY_SAME_SOURCE` | `8` | `src/lib/suggestions/suggestionEngine.ts` |
| `MAX_HISTORY_GLOBAL` | `4` | `src/lib/suggestions/suggestionEngine.ts` |
| `MAX_QUICK_COMMANDS` | `4` | `src/lib/suggestions/suggestionEngine.ts` |
| `MAX_PATHS` | `8` | `src/lib/suggestions/suggestionEngine.ts` |
| `MAX_TOTAL` | `16` | `src/lib/suggestions/suggestionEngine.ts` |
| `INDEX_LIMIT` | `5000` | `src/services/history.ts` |
| `MAX_SAMPLES` | `150` | `src/stores/monitor.ts` |

### 1.2 按文件聚合

| 文件 | 常量数 | 常量 |
|---|---|---|
| `src/lib/suggestions/suggestionEngine.ts` | 5 | `MAX_HISTORY_SAME_SOURCE` / `MAX_HISTORY_GLOBAL` / `MAX_QUICK_COMMANDS` / `MAX_PATHS` / `MAX_TOTAL` |
| `src/components/monitor/MonitorSidebar.vue` | 2 | `SIDEBAR_MIN_WIDTH` / `SIDEBAR_MAX_WIDTH` |
| `src/components/start/StartPageContent.vue` | 2 | `SIDEBAR_MIN_WIDTH` / `SIDEBAR_MAX_WIDTH` |
| `scripts/gen-icon.ts` | 1 | `SIZE` |
| `src/components/terminal/SuggestionMenu.vue` | 1 | `MAX_VISIBLE_ROWS` |
| `src/lib/backgroundImage.ts` | 1 | `MIN_BACKGROUND_OPACITY` |
| `src/lib/frontends/xterm/resize.ts` | 1 | `RESIZE_MIN_INTERVAL` |
| `src/lib/frontends/xterm/support.ts` | 1 | `MAX_WEBGL_RECOVERY_ATTEMPTS` |
| `src/lib/suggestions/promptTracker.ts` | 1 | `DEFAULT_MAX_PROMPT_JUMP` |
| `src/services/history.ts` | 1 | `INDEX_LIMIT` |
| `src/stores/monitor.ts` | 1 | `MAX_SAMPLES` |

**分布结论**：17 条常量集中在 11 个文件，其中 `src/lib/suggestions/suggestionEngine.ts` 单文件承载 5 条（占比约 29%），是建议功能的**唯一调参入口**；UI 侧宽度约束在 `MonitorSidebar.vue` 与 `StartPageContent.vue` 中**各定义一份同名常量**。

### 1.3 逐条解读：这些上限各自防的是什么

#### （1）UI 尺寸类

| 常量 | 值 | 源文件 | 约束的失控场景 |
|---|---|---|---|
| `SIDEBAR_MIN_WIDTH` | `260` | `src/components/monitor/MonitorSidebar.vue` | 监控侧栏下限被压缩到无法阅读内容（信息被挤没）。命名与取值表明侧栏宽度不允许低于 260px |
| `SIDEBAR_MAX_WIDTH` | `480` | `src/components/monitor/MonitorSidebar.vue` | 监控侧栏拖拽时无限变宽、吞掉主内容区。上限 480px |
| `SIDEBAR_MIN_WIDTH` | `180` | `src/components/start/StartPageContent.vue` | 起始页内容侧栏下限；**与监控侧栏同名但取值不同（180 vs 260）** |
| `SIDEBAR_MAX_WIDTH` | `240` | `src/components/start/StartPageContent.vue` | 起始页内容侧栏上限；**与监控侧栏同名但取值不同（240 vs 480）** |

这组数据揭示的第一个边界问题：**同名常量在项目中存在两套互不相等的取值区间**——监控侧栏区间为 `[260, 480]`，起始页侧栏区间为 `[180, 240]`，两区间不相交。若未来做统一侧栏布局或共享拖拽逻辑，这两组数值是必须先对齐的分叉点。

#### （2）终端与渲染类

| 常量 | 值 | 源文件 | 约束的失控场景 |
|---|---|---|---|
| `RESIZE_MIN_INTERVAL` | `32` | `src/lib/frontends/xterm/resize.ts` | 终端容器尺寸变化事件的高频触发：若无最小时间间隔节流，拖拽窗口会引发连续重排/重绘。32（结合文件名为 resize 节流间隔）表明此处对尺寸重算做了时间节流 |
| `MAX_WEBGL_RECOVERY_ATTEMPTS` | `3` | `src/lib/frontends/xterm/support.ts` | WebGL 渲染上下文丢失后的无限重试：取值 3 表明恢复次数被硬性封顶，避免上下文反复丢失时陷入恢复死循环 |
| `MIN_BACKGROUND_OPACITY` | `0.05` | `src/lib/backgroundImage.ts` | 背景图透明度被调到 0，导致背景与文字对比度失效、界面不可读。下限 0.05 保证背景始终保留一层可见度 |

**边界结论**：这三条都属于「防止高频事件转为无限循环或不可恢复状态」的保护性阈值，且都不与业务数据规模相关，而是与**渲染时序/设备能力**相关。

#### （3）终端建议引擎配额类（`src/lib/suggestions/suggestionEngine.ts` + `SuggestionMenu.vue`）

| 常量 | 值 | 源文件 | 约束的失控场景 |
|---|---|---|---|
| `MAX_HISTORY_SAME_SOURCE` | `8` | `src/lib/suggestions/suggestionEngine.ts` | 同一来源的历史项无上限堆积，压占候选池 |
| `MAX_HISTORY_GLOBAL` | `4` | `src/lib/suggestions/suggestionEngine.ts` | 全局历史项无上限堆积；**取值 4 小于同来源上限 8**，说明全局来源被更严格地限流 |
| `MAX_QUICK_COMMANDS` | `4` | `src/lib/suggestions/suggestionEngine.ts` | 快捷命令无上限堆积 |
| `MAX_PATHS` | `8` | `src/lib/suggestions/suggestionEngine.ts` | 路径候选无上限堆积 |
| `MAX_TOTAL` | `16` | `src/lib/suggestions/suggestionEngine.ts` | 候选总数失控导致的补全列表膨胀与计算成本上升 |
| `MAX_VISIBLE_ROWS` | `8` | `src/components/terminal/SuggestionMenu.vue` | 下拉菜单一次性铺满屏幕 |

**配额恒等式（由数值直接推导）**：`MAX_PATHS`(8) + `MAX_QUICK_COMMANDS`(4) + `MAX_HISTORY_GLOBAL`(4) = **16**，恰好等于 `MAX_TOTAL`(16)。这组数值自洽，指向一种「三类候选先各自封顶、再受总量封顶」的双层限流结构。

**两处可见的不对称**：
1. `MAX_VISIBLE_ROWS`(8) < `MAX_TOTAL`(16)：候选池可达 16 条而菜单一次只显示 8 行，意味着候选列表必然存在**未一次性展示的部分**。
2. `MAX_HISTORY_GLOBAL`(4) < `MAX_HISTORY_SAME_SOURCE`(8)：同一个建议引擎内，单来源配额是全局配额的 2 倍。

#### （4）数据存储与采样类

| 常量 | 值 | 源文件 | 约束的失控场景 |
|---|---|---|---|
| `INDEX_LIMIT` | `5000` | `src/services/history.ts` | 历史索引条目无限增长，导致索引体积与查询成本持续膨胀。上限 5000 条 |
| `MAX_SAMPLES` | `150` | `src/stores/monitor.ts` | 监控采样数据在内存中无限累积。上限 150 个采样点，属于**内存驻留上限** |

**边界结论**：全项目仅这两条与「数据量级」相关，且量级差异巨大（5000 vs 150）：历史侧偏向持久化容量，监控侧偏向内存窗口。除此之外，数据集中**未检测到**超时（timeout）类、并发上限类或请求重试类常量。

---

## 二、复杂度热点

### 2.1 全量清单（19 条，按复杂度）

| 函数 | 源文件 | 复杂度 | 循环深度 |
|---|---|---|---|
| `computeOps` | `src/stores/config/flush.ts` | **28** | 1 |
| `commitOp` | `src/stores/config/flush.ts` | **23** | 0 |
| `authenticate` | `src-tauri/src/ssh/auth.rs` | **16** | 0 |
| `accept_dynamic_connection` | `src-tauri/src/forward/loops.rs` | **13** | 0 |
| `check_server_key` | `src-tauri/src/ssh/session.rs` | **11** | 0 |
| `commitGroupNameDialog` | `src/components/settings/useGroupNameDialog.ts` | **10** | 0 |
| `connectHeadless` | `src/services/sshConnections.ts` | **8** | 0 |
| `acceptSelected` | `src/lib/suggestions/controller.ts` | **7** | 0 |
| `acquire` | `src/lib/sshConnectionRegistry.ts` | `6` | 0 |
| `apply` | `src/stores/transfers.ts` | `6` | 1 |
| `build_target` | `src-tauri/src/s3sync/client.rs` | `6` | 0 |
| `algorithm_label` | `src-tauri/src/secrets/keys.rs` | `5` | 0 |
| `attach` | `src/lib/frontends/xterm/frontend.ts` | `5` | 0 |
| `closeTab` | `src/stores/tabs.ts` | `5` | 0 |
| `append_raw` | `src-tauri/src/debug_log.rs` | `4` | 0 |
| `ask_frontend` | `src-tauri/src/ssh/auth.rs` | `4` | 0 |
| `collectCommand` | `src/lib/suggestions/promptTracker.ts` | `4` | 1 |
| `computeSuggestions` | `src/lib/suggestions/suggestionEngine.ts` | `4` | 1 |
| `config_load_legacy_yaml` | `src-tauri/src/config/legacy.rs` | `4` | 0 |
| `constructor` | `src/lib/frontends/xterm/frontend.ts` | `4` | 1 |

### 2.2 复杂度分层

| 区间 | 函数数 | 函数 |
|---|---|---|
| ≥ 20（极高） | 2 | `computeOps`(28)、`commitOp`(23) — 同属 `src/stores/config/flush.ts` |
| 10–19（高） | 4 | `authenticate`(16)、`accept_dynamic_connection`(13)、`check_server_key`(11)、`commitGroupNameDialog`(10) |
| 6–9（中） | 5 | `connectHeadless`(8)、`acceptSelected`(7)、`acquire`(6)、`apply`(6)、`build_target`(6) |
| 4–5（低） | 8 | `algorithm_label`、`attach`、`closeTab`、`append_raw`、`ask_frontend`、`collectCommand`、`computeSuggestions`、`config_load_legacy_yaml`、`constructor` |

**关键观察**：19 个热点函数中，`loopDepth` 最大值为 **1**，其余全为 **0**。也就是说，这批函数的复杂度**不是来自深层嵌套循环**，而是来自**分支数量本身**。这直接影响重构方向——削减嵌套层级无效，需要削减的是分支组合数。

### 2.3 重点函数分析

#### `computeOps` — 复杂度 28，循环深度 1（`src/stores/config/flush.ts`）

- 全数据集**复杂度最高**的函数。
- 循环深度仅 1 却达到 28，说明复杂度几乎全部由条件分支贡献，而不是由迭代结构贡献；其复杂度增长方式更接近「分支笛卡尔积」而非「逐层嵌套」。
- 与同文件 `commitOp`(23) 并存：**单个文件包含全项目复杂度第 1 与第 2 的两个函数**。
- 潜在风险（由指标直接推出）：分支数越高，可覆盖的路径组合越多，单元测试难以穷举；任何一处分支条件的修改都可能影响大量未被显式覆盖的路径组合。
- 重构方向（不依赖具体实现，仅由指标驱动）：把 28 条分支按「配置项类别」拆成多个小函数，使每个函数的条件数降到可枚举量级；由于循环深度只有 1，优先做**分支抽取**而非循环扁平化。

#### `commitOp` — 复杂度 23，循环深度 0（`src/stores/config/flush.ts`）

- 与 `computeOps` 同文件、同属 `src/stores/config/flush.ts` 的配置刷写路径。
- 循环深度为 0 表示函数体内**没有嵌套循环**，全部复杂度来自顺序分支判断。
- 潜在风险：`computeOps` 负责计算、`commitOp` 负责提交，两者合计复杂度 51 且共享同一文件——**配置落盘是全前端改动代价最高的单点**。

#### `authenticate` — 复杂度 16，循环深度 0（`src-tauri/src/ssh/auth.rs`）

- Rust 侧复杂度最高的函数。
- 同文件还存在 `ask_frontend`（复杂度 4，`src-tauri/src/ssh/auth.rs`），说明该文件同时承担「认证流程」与「向前端询问」两类职责。
- 潜在风险：认证分支（多分支且无循环）通常对应多种认证方式/凭证类型的组合判定，属安全相关路径，分支遗漏的后果比其他模块更敏感。

#### `accept_dynamic_connection` — 复杂度 13，循环深度 0（`src-tauri/src/forward/loops.rs`）

- 文件路径 `src-tauri/src/forward/loops.rs` 与函数名共同指向**端口转发的连接接受循环**。
- 潜在风险：连接接受路径上的分支越多，异常连接（拒绝、超限、目标不可达等）的处理分支越多，是长时运行进程中最容易累积状态分支的位置。

#### `check_server_key` — 复杂度 11，循环深度 0（`src-tauri/src/ssh/session.rs`）

- 与 `authenticate` 分属 `session.rs` / `auth.rs` 两个文件，构成 SSH 建连的两道独立高复杂度关卡。
- 潜在风险：主机密钥校验分支多（匹配 / 不匹配 / 首次未知等判定组合），改动时需完整的路径覆盖验证。

#### `commitGroupNameDialog` — 复杂度 10，循环深度 0（`src/components/settings/useGroupNameDialog.ts`）

- 前端 UI 层复杂度最高的函数，位于设置页组合式函数文件。
- 其复杂度主要来自「提交前的多重校验/状态判断」，与其他高复杂度函数（配置落盘、SSH 认证）不属同一类别，属**表单校验型复杂度**。

### 2.4 中低复杂度函数补充说明

| 函数 | 源文件 | 复杂度 | 值得注意的一点 |
|---|---|---|---|
| `connectHeadless` | `src/services/sshConnections.ts` | 8 | 与 `src/lib/sshConnectionRegistry.ts` 的 `acquire`(6) 同属连接建立相关，跨两个文件 |
| `acceptSelected` | `src/lib/suggestions/controller.ts` | 7 | 建议功能的「接受」动作入口，与 `suggestionEngine.ts` 的 5 条配额常量分属两文件 |
| `apply` | `src/stores/transfers.ts` | 6 | 循环深度 1，是热点清单中少数含循环的函数之一 |
| `computeSuggestions` | `src/lib/suggestions/suggestionEngine.ts` | 4 | **同时是 5 条配额常量的宿主文件中的函数**，复杂度本身不高，说明配额控制靠常量而非复杂逻辑实现 |
| `attach` / `constructor` | `src/lib/frontends/xterm/frontend.ts` | 5 / 4 | 同一文件两个热点，涉及终端前端挂载与构造 |

---

## 三、已知边界

以下结论全部由上述两组数据直接推出。

### 3.1 最脆弱的三个位置

| 位置 | 数据依据 | 为什么脆弱 |
|---|---|---|
| `src/stores/config/flush.ts` | 复杂度第 1（`computeOps` 28）与第 2（`commitOp` 23）同在此文件 | 单文件承担全项目最高复杂度双函数，合计 51；配置刷写逻辑的任意改动都落在分支最多的代码上 |
| `src-tauri/src/ssh/auth.rs` + `src-tauri/src/ssh/session.rs` | `authenticate`(16) 与 `check_server_key`(11) 分属两文件 | SSH 建连被拆成两道高复杂度关卡，跨文件修改需同时验证两处；且属安全相关路径 |
| `src/lib/suggestions/suggestionEngine.ts` | 单文件 5 条配额常量（`MAX_HISTORY_SAME_SOURCE`/`MAX_HISTORY_GLOBAL`/`MAX_QUICK_COMMANDS`/`MAX_PATHS`/`MAX_TOTAL`） | 所有候选规模上限的唯一来源，任一数值调整都会改变候选构成；且三类配额之和恰等于总量上限，改动其一会破坏现有自洽关系 |

### 3.2 改动代价的分布特征

1. **复杂度与循环无关**：19 个热点中 `loopDepth` 全部 ≤ 1，最高复杂度函数 `computeOps`(28) 的循环深度也只有 1。这意味着性能优化方向（减少迭代）与可维护性优化方向（减少分支）在本项目中**是两个完全不同的方向**。
2. **同名常量跨文件分叉**：`SIDEBAR_MIN_WIDTH` / `SIDEBAR_MAX_WIDTH` 在 `MonitorSidebar.vue`（260/480）与 `StartPageContent.vue`（180/240）各定义一份且取值不同，两个取值区间不相交。任何试图统一侧栏逻辑的改动都要先处理这组分叉。
3. **前后端复杂度重心不同**：复杂度 ≥ 10 的 6 个函数中，2 个在前端 store（`src/stores/config/flush.ts`）、3 个在 Rust 侧（`src-tauri/src/ssh/auth.rs`、`src-tauri/src/forward/loops.rs`、`src-tauri/src/ssh/session.rs`）、1 个在前端 UI（`src/components/settings/useGroupNameDialog.ts`）。Rust 侧的高复杂度集中在**连接与认证**，前端侧集中在**配置持久化**。
4. **上限的粒度差异大**：数值型上限从 `MIN_BACKGROUND_OPACITY`(0.05) 到 `INDEX_LIMIT`(5000)，跨度四个数量级，分属渲染保护、UI 布局、内存窗口、持久化容量四类互不相关的约束，不存在统一的「限制配置中心」。

### 3.3 未检测到的约束类别

以下类别在数据集中**未检测到**任何常量，属当前约束体系的空白区：

- **超时类**：无任何 timeout / deadline 常量。
- **并发与连接数上限类**：无任何并发、连接池大小上限常量（尽管存在 `accept_dynamic_connection` 与 `acquire` 等连接相关高复杂度函数）。
- **重试次数类**：仅 `MAX_WEBGL_RECOVERY_ATTEMPTS`(3) 与渲染相关，未检测到网络/传输层的重试上限。
- **缓存与队列容量类**：除 `INDEX_LIMIT`(5000) 与 `MAX_SAMPLES`(150) 外未检测到其他容量上限。

---

## 四、待确认

| 项 | 缺失的证据 |
|---|---|
| 常量的实际生效位置 | 数据集仅给出常量名、值与文件，**未提供引用点/调用点**，无法确认每个常量在何处被读取、是否被传参覆盖，也无法确认是否存在同名的运行时可变配置覆盖这些硬编码值 |
| 行号级锚点 | 数据集未提供行号，本页锚点只能精确到文件；无法定位常量与函数在文件内的具体位置 |
| 函数间的调用关系 | 数据集未提供任何调用边，因此无法判断 `computeOps` 与 `commitOp` 的执行先后、`authenticate` 与 `ask_frontend` 的交互方式；本页不提供调用关系表 |
| 复杂度阈值口径 | 数据集未说明复杂度是圈复杂度还是其他度量口径，也未给出「高复杂度」的判定阈值，本页所有排序仅基于给定数值的相对大小 |
## Related

- 同目录：[conventions.md](conventions.md)
- 总入口：[README](../README.md)
