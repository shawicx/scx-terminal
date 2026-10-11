# 故障排除指南

<details>
<summary>Relevant source files</summary>

- package.json
- scripts/gen-icon.ts
- src-tauri/src/fsutil.rs
- src/i18n/index.ts
- src/lib/backgroundImage.ts
- src/lib/colorSchemes.ts
- src/lib/frontendContext.ts
- src/lib/frontends/xterm/frontend.ts
- src/lib/frontends/xterm/renderer.ts
- src/lib/frontends/xterm/resize.ts
- src/lib/frontends/xterm/search.ts
- src/lib/frontends/xterm/support.ts
- src/lib/jumpChain.ts
- src/lib/motion/index.ts
- src/lib/sessions/index.ts
</details>

本页汇总该桌面终端项目的环境、构建、运行时三类故障的排查路径与具体处置命令，所有结论均以源码锚点为准，便于快速定位到文件与行号。

## 一、排查起点：先看入口文件

排障时优先从以下入口文件切入，它们是各子系统的装配点：

| 入口文件 | 排障用途 |
| --- | --- |
| `src/main.ts` | 应用装配起点：注册 Pinia、引入全局样式（`tw-animate-css`）、调用 Tauri API |
| `src/stores/config/index.ts` | 配置仓库入口，配置读写异常先看这里 |
| `src/lib/sessions/index.ts` | 会话层入口，连接类问题先看这里 |
| `src/lib/motion/index.ts` | 动效层入口（gsap），界面无动画/卡顿先看这里 |
| `src/i18n/index.ts` | 国际化入口（vue-i18n），文案显示为 key 或语言不切换先看这里 |

技术栈落点速查：

- 桌面壳：`@tauri-apps/api` 在生产源码中有 27 处引用，如 `src/main.ts`、`src/components/settings/pages/AboutPage.vue`、`src/components/sftp/SftpTabContent.vue`
- 终端渲染：`@xterm/xterm` 在 `src/lib/frontends/xterm/frontend.ts`、`lines.ts`、`options.ts`、`renderer.ts`、`resize.ts` 中被引用
- 样式：`tailwindcss` 从 `src/assets/styles/main.css` 引入，`@tailwindcss/vite` 在 `vite.config.ts` 中接入
- 状态：`pinia` 在 `src/main.ts`、`src/stores/config/store.ts`、`src/stores/forwarding.ts`、`src/stores/monitor.ts`、`src/stores/tabs.ts` 中被引用

## 二、环境问题

### 2.1 包管理器不一致导致依赖安装异常

**问题描述**：执行 `npm install` / `pnpm install` / `yarn`（待确认） 安装依赖后，出现依赖解析结果不一致、命令找不到、二次安装后依赖树变化等问题。

**原因分析**：本项目声明使用 **bun** 作为包管理器。不同包管理器在依赖提升、可选依赖处理和锁文件格式上策略不同，混用会产生不同的 `node_modules` 结构；而项目所有脚本（`dev` / `build` / `preview` / `app:dev` / `app:build` / `lint` / `test`）均按 bun 环境设计。

**解决方案**：统一使用 bun 执行安装与脚本：

```bash
bun install
bun run dev          # 仅前端（Vite）
bun run app:dev      # 桌面应用（tauri dev）
bun run build
bun run app:build
bun run lint
bun run test
```

若已用其它包管理器安装过，建议删除既有依赖目录后用 `bun install` 重装，避免残留的异构依赖树。

### 2.2 Node 运行时版本要求不明

**问题描述**：在不同 Node 版本机器上构建结果不一致，但缺少明确的版本约束提示。

**原因分析**：当前数据未提供 Node 版本约束信息（项目数据中该字段为空），无法给出确切的 Node 版本区间。

**解决方案**：先以 `bun install` 与 `bun run build` 实际跑通为准；如需团队协作锁定版本，应补齐版本约束配置。此为「待确认」项，见第六节。

### 2.3 Tauri 注入的环境变量缺失

**问题描述**：只运行 `bun run dev`（Vite）时，与桌面环境相关的分支行为异常，或在构建产物中发现桌面相关逻辑未按预期生效。

**原因分析**：`TAURI_ENV_HOST` 与 `TAURI_ENV_DEBUG` 两个环境变量仅在 `vite.config.ts` 中被读取，它们由 Tauri CLI 在启动/构建流程中注入。直接以纯 Vite 方式启动时，这两个变量不在进程环境中。

**解决方案**：

- 需要桌面环境语义（调试标记、宿主信息）时，改用 `bun run app:dev`（`tauri dev`）或 `bun run app:build`（`tauri build`）。
- 仅调试纯 UI 逻辑时用 `bun run dev`，但不要依赖这两个变量参与的分支行为。

> 推断：这两个变量由 Tauri CLI 注入，依据是其读取点位于 `vite.config.ts`，而项目脚本中桌面启动入口是 `app:dev` / `app:build`。若需要在纯 Vite 下复现桌面行为，请显式在命令前导出同名变量。

### 2.4 Tauri 插件未启用或缺权限

**问题描述**：桌面环境下调用剪贴板、文件对话框、通知、外部打开、进程重启、更新检查等功能时报插件不存在或命令不被允许。

**原因分析**：前端多处直接引入 Tauri 插件，插件需要在桌面侧可用且获得授权：

| 插件 | 前端引用位置 |
| --- | --- |
| `@tauri-apps/plugin-clipboard-manager` | `src/lib/frontendContext.ts` |
| `@tauri-apps/plugin-dialog` | `src/components/settings/pages/AppearancePage.vue`、`src/components/settings/pages/BackupPage.vue`、`src/components/sftp/SftpBrowserPane.vue`、`src/services/workflowYamlIo.ts` |
| `@tauri-apps/plugin-notification` | `src/services/notifications.ts` |
| `@tauri-apps/plugin-opener` | `src/components/settings/pages/AboutPage.vue`、`src/components/sftp/SftpBrowserPane.vue`、`src/components/sftp/TransferPopover.vue`、`src/lib/frontends/xterm/support.ts` |
| `@tauri-apps/plugin-process` | `src/services/updater.ts` |
| `@tauri-apps/plugin-updater` | `src/components/settings/pages/AboutPage.vue`、`src/services/updater.ts` |

**解决方案**：

- 先确认失败调用对应的插件在该引用文件中的具体调用点，再检查桌面侧是否已注册同名插件与放开对应权限。
- 通知类故障（`src/services/notifications.ts`）还需确认操作系统层面的通知授权状态。
- 更新检查失败（`src/services/updater.ts`、`src/components/settings/pages/AboutPage.vue`）需确认更新源与签名配置可用；桌面侧的具体注册与权限清单在当前数据中未覆盖，见第六节。

### 2.5 Rust 工具链缺失导致桌面构建不可用

**问题描述**：执行 `bun run app:build` 或 `bun run app:dev` 时在编译阶段失败。

**原因分析**：项目包含 Rust 侧内容（模块清单中存在 `Cargo` 相关模块与 `src-tauri/src/fsutil.rs`），`tauri build` / `tauri dev` 会触发 Rust 侧编译，需要本机具备可用的 Rust 工具链。

**解决方案**：先确认 Rust 工具链可用，再执行 `bun run app:dev`；若前端部分正常而桌面部分失败，优先排查 Rust 侧编译输出。

## 三、构建问题

### 3.1 类型检查失败导致构建中断

**问题描述**：`bun run build` 在编译前就退出，未产出产物。

**原因分析**：构建脚本为 `vue-tsc --noEmit && vite build`，先做全量类型检查再打包（`vue-tsc` 在脚本中使用）。任何类型错误都会让 `&&` 右侧的 `vite build` 不再执行。

**解决方案**：单独运行类型检查以获取完整错误列表：

```bash
bunx vue-tsc --noEmit
bun run build
```

```bash
# 先只跑类型检查，拿到完整错误清单后再执行打包
bunx vue-tsc --noEmit
```

类型错误修复后再次执行 `bun run build`。若只想快速验证打包本身（排除类型检查干扰），可单独执行：

```bash
bunx vite build
bun run preview     # 本地预览产物
```

### 3.2 ESM/CJS 互操作导致的打包报错

**问题描述**：`vite build` 阶段报模块无默认导出、`require is not defined` 或具名导出缺失。

**原因分析**：以下依赖在生产源码中存在明确的引用点，且均以 ESM 方式引入，其中部分为历史较久、需互操作转换的包：

| 依赖 | 生产引用位置 |
| --- | --- |
| `deep-equal` | `src/lib/frontends/xterm/frontend.ts` |
| `yaml` | `src/lib/workflowYaml.ts`、`src/stores/config/store.ts` |
| `clsx` / `tailwind-merge` | `src/lib/utils.ts` |
| `class-variance-authority` | `src/components/ui/Button.vue` |

**解决方案**：

- 对确实缺少默认导出的包，按具名导入改写，例如 `import equal from 'deep-equal'` 改为与其导出形态匹配的写法。
- 类型声明缺失的报错（`@types/deep-equal`、`@types/node` 已在开发依赖中声明）通常是类型解析路径问题，优先检查类型声明是否被正确加载，而不是在业务代码里加断言兜底。
- 若怀疑是转换阶段的告警而非错误，先执行 `bunx vite build` 观察是否为阻断性错误。

### 3.3 xterm 附加组件与渲染模式打包问题

**问题描述**：打包成功但终端区空白、字符渲染错乱，或构建期报附加组件解析失败。

**原因分析**：终端渲染由多个附加组件组合而成，均在生产源码中显式引入：

| 附加组件 | 引入位置 |
| --- | --- |
| `@xterm/addon-canvas` | `src/lib/frontends/xterm/renderer.ts` |
| `@xterm/addon-webgl` | `src/lib/frontends/xterm/renderer.ts` |
| `@xterm/addon-fit` | `src/lib/frontends/xterm/frontend.ts`、`src/lib/frontends/xterm/resize.ts` |
| `@xterm/addon-search` | `src/lib/frontends/xterm/search.ts` |
| `@xterm/addon-unicode11` | `src/lib/frontends/xterm/frontend.ts` |
| `@xterm/addon-web-links` | `src/lib/frontends/xterm/frontend.ts` |

**解决方案**：

- 渲染器选择集中在 `src/lib/frontends/xterm/renderer.ts`，Canvas 与 WebGL 两条路径的资源打包方式不同，出现渲染异常时先确认实际走的渲染路径。
- 尺寸自适应逻辑在 `src/lib/frontends/xterm/resize.ts`，字体/容器尺寸相关报错优先看这里。

### 3.4 Tailwind v4 样式管线配置错误

**问题描述**：构建通过但界面无样式，或样式类不生效。

**原因分析**：样式链路为 `@tailwindcss/vite`（在 `vite.config.ts` 中接入）→ `tailwindcss`（在 `src/assets/styles/main.css` 中引入）→ `tw-animate-css`（在 `src/main.ts` 中引入）。任一环节缺失都会导致样式失效。

**解决方案**：按上述链路逐点核对：确认 `vite.config.ts` 中插件已注册、`src/assets/styles/main.css` 中的引入未被改写、`src/main.ts` 中动画样式仍被加载。

### 3.5 图标资源生成失败

**问题描述**：`app:build` 阶段报图标缺失或尺寸不符。

**原因分析**：图标生成脚本 `scripts/gen-icon.ts:7` 定义了尺寸常量 `SIZE = 1024`，即生成入口图标为 1024×1024。该常量被改动或源图缺失时，产物图标不符合打包要求。

**解决方案**：确认源图存在且 `SIZE` 保持为 1024；图标相关脚本变化后需重新生成图标资源再进行 `bun run app:build`。

### 3.6 代码规范检查与构建的关系

**问题描述**：本地构建通过但协作环境失败，怀疑规范检查与构建钩子不一致。

**原因分析**：规范检查使用 `oxlint`，命令为 `oxlint src`（脚本 `lint`），检查范围为 `src` 目录。它是独立脚本，不在 `build` 脚本链中。

**解决方案**：提交前单独执行：

```bash
bun run lint
```

注意其作用范围仅为 `src`，`vite.config.ts`、`scripts/` 下的文件不在该范围内，不要据此认为配置文件无问题。

### 3.7 测试与构建配置相互干扰

**问题描述**：`bun run test` 与 `bun run build` 之间出现配置冲突，或测试代码被纳入生产构建。

**原因分析**：测试使用 `vitest`，测试文件与组件同目录共置，例如 `src/components/settings/groupDragSort.test.ts`、`src/components/split/splitTree.test.ts`、`src/components/terminal/searchFocus.test.ts`、`src/components/titlebar/tabGroupLayout.test.ts`、`src/components/titlebar/tabStripLayout.test.ts`。

**解决方案**：执行 `bun run test` 跑全量测试；单文件调试见第五节。若生产构建纳入测试文件，检查 Vite 的排除规则配置。

## 四、运行时问题

本章列出每次运行都会生效的边界常量。触界时的典型症状如下，出现对应现象时优先核对相关上限。

### 4.1 WebGL 渲染回退次数上限

**问题描述**：终端渲染偶尔变为软件渲染、画面发暗或出现 WebGL 相关警告，反复出现但每次都能自恢复。

**原因分析**：`src/lib/frontends/xterm/support.ts:58` 定义 `MAX_WEBGL_RECOVERY_ATTEMPTS = 3`，即 WebGL 上下文丢失后的恢复尝试上限为 3 次。超过该次数后不会继续尝试恢复，会回退到非 WebGL 渲染路径。

**解决方案**：

- 出现反复闪烁/回退时，先排查显卡驱动与硬件加速状态，因为恢复次数被限制后不会无限重试。
- 需要确认当前渲染路径时，从 `src/lib/frontends/xterm/renderer.ts`（Canvas 与 WebGL 引入点）与 `src/lib/frontends/xterm/support.ts` 的恢复逻辑入手。

### 4.2 尺寸调整被节流导致显示错位

**问题描述**：窗口缩放后终端行列数与实际容器尺寸不匹配，出现空白边或文字截断，拖拽结束后才恢复正常。

**原因分析**：`src/lib/frontends/xterm/resize.ts:11` 定义 `RESIZE_MIN_INTERVAL = 32`，两次尺寸重算之间的最小间隔为 32 毫秒。快速连续缩放时中间的调整会被合并或丢弃，极端情况下最后一次尺寸变化未被重算。

**解决方案**：确认在拖拽结束后是否触发最终一次尺寸校正；若错位持续存在，检查 `@xterm/addon-fit`（在 `src/lib/frontends/xterm/frontend.ts`、`src/lib/frontends/xterm/resize.ts` 中引入）的适配调用是否被节流逻辑挡住。

### 4.3 滚动行为与预期不一致

**问题描述**：程序化滚动、追加输出时滚动位置与预期不符，回滚缓冲区行为异常。

**原因分析**：`src/lib/frontends/xterm/frontend.ts:120` 处的源码注释明确写明：`NOTE: xterm.onScroll only fires for content-driven scroll (new lines),`——即滚动事件仅在内容驱动（新增行）时触发，程序化滚动不会触发该事件。依赖该事件做状态同步的逻辑，在仅做程序化滚动时不会更新。

**解决方案**：不要以该滚动事件作为"用户已滚动"的唯一判定；涉及滚动位置同步的逻辑，需同时考虑显式滚动调用路径。这是作者自认的语义风险点，改动滚动相关代码时按此注释校验行为。

### 4.4 跳转链深度触界

**问题描述**：在会话中跳转到更深层目标时停止响应或跳转被忽略。

**原因分析**：`src/lib/jumpChain.ts:28` 定义 `MAX_JUMP_DEPTH = 8`，跳转链最大深度为 8。达到上限后不再继续下钻。

**解决方案**：出现"跳不进去"时先确认当前跳转链深度是否已达 8 层；如需更深链路，需要调整该上限并评估链路循环检测逻辑。

### 4.5 命令建议列表缺项或提示跳数不足

**问题描述**：终端建议菜单中历史命令、快捷命令或路径建议数量比预期少，或快速跳转提示数量不足。

**原因分析**：建议引擎存在一组硬上限常量，超出部分会被裁剪：

| 常量 | 值 | 位置 |
| --- | --- | --- |
| `MAX_HISTORY_SAME_SOURCE` | 8 | `src/lib/suggestions/suggestionEngine.ts:11` |
| `MAX_HISTORY_GLOBAL` | 4 | `src/lib/suggestions/suggestionEngine.ts:12` |
| `MAX_QUICK_COMMANDS` | 4 | `src/lib/suggestions/suggestionEngine.ts:13` |
| `MAX_WORKFLOWS` | 3 | `src/lib/suggestions/suggestionEngine.ts:14` |
| `MAX_PATHS` | 8 | `src/lib/suggestions/suggestionEngine.ts:15` |
| `MAX_TOTAL` | 16 | `src/lib/suggestions/suggestionEngine.ts:16` |
| `MAX_VISIBLE_ROWS` | 8 | `src/components/terminal/SuggestionMenu.vue:41` |
| `DEFAULT_MAX_PROMPT_JUMP` | 20 | `src/lib/suggestions/promptTracker.ts:125` |

同类来源历史最多 8 条、全局历史最多 4 条、快捷命令最多 4 条、工作流最多 3 条、路径最多 8 条、合计最多 16 条；建议菜单一次最多显示 8 行；提示跳转默认上限 20。

**解决方案**：

- "建议比预期少"通常是 `MAX_TOTAL = 16` 或各分类上限生效，而非数据丢失，先按上限表核对。
- 菜单出现滚动/截断，是 `MAX_VISIBLE_ROWS = 8` 的显示上限，属预期行为。
- 建议内容为空时，检查来源数据：历史索引见 4.6。

### 4.6 历史记录检索不全

**问题描述**：搜索历史命令时找不到较早的记录。

**原因分析**：`src/services/history.ts:9` 定义 `INDEX_LIMIT = 5000`，历史索引上限为 5000 条。超出后旧记录不参与索引。

**解决方案**：核对历史记录总量是否已接近 5000；该值为索引边界而非界面显示边界，界面上看到条数受 4.5 的裁剪上限影响，两者不要混淆。

### 4.7 监控图表数据点不足或曲线跳变

**问题描述**：监控面板曲线出现断点、跳变，或刷新后历史数据变少。

**原因分析**：`src/stores/monitor.ts:11` 定义 `MAX_SAMPLES = 150`，单个指标最多保留 150 个采样点。采样频率高或采样间隔大时，图上表现为时间跨度与预期不符。

**解决方案**：断点通常是采样缺口而非渲染问题，先确认采样是否中断；若曲线时间跨度短，则是 150 点上限导致的滚动窗口效果。

### 4.8 侧边栏宽度异常

**问题描述**：拖拽侧栏时宽度无法到预期值，或重启后宽度被钳制。

**原因分析**：不同页面各自定义了宽度区间，上限下限不同：

| 页面 | 常量 | 值 | 位置 |
| --- | --- | --- | --- |
| 监控侧栏 | `SIDEBAR_MIN_WIDTH` / `SIDEBAR_MAX_WIDTH` | 260 / 480 | `src/components/monitor/MonitorSidebar.vue:166`、`src/components/monitor/MonitorSidebar.vue:167` |
| 起始页内容 | `SIDEBAR_MIN_WIDTH` / `SIDEBAR_MAX_WIDTH` | 180 / 240 | `src/components/start/StartPageContent.vue:53`、`src/components/start/StartPageContent.vue:54` |

**解决方案**：宽度被钳制到 260/480 与 180/240 属预期；两处同名常量取值不同，修改时不要按一处推导另一处。

### 4.9 自定义背景图不显示

**问题描述**：设置了背景图但界面几乎看不到，或设置极低透明度后背景消失。

**原因分析**：`src/lib/backgroundImage.ts:9` 定义 `MIN_BACKGROUND_OPACITY = 0.05`，背景透明度存在 0.05 的下限。

**解决方案**：背景几乎不可见时先确认透明度是否已到下限；设置为 0 不会生效，会被钳制到 0.05。

### 4.10 会话与命令模块的高频故障面

**问题描述**：会话连接、标签页管理与命令执行相关的问题复现率较高。

**原因分析**：以下文件是提交最密集的区域，改动集中，属于真实维护热点：

| 文件 | 变更频度 | 最近相关提交 |
| --- | --- | --- |
| `src/services/commands.ts` | 18 次提交 | commit:48e74553 (2026-10-10) |
| `src/stores/tabs.ts` | 14 次提交 | commit:48e74553 (2026-10-10) |
| `src/lib/sessions/sshSession.ts` | 5 次提交 | commit:9c37721f (2026-10-11) |
| `src-tauri/src/fsutil.rs` | 5 次提交 | commit:2177899c (2026-10-10) |
| `src/lib/colorSchemes.ts` | 4 次提交 | commit:e8315896 (2026-09-16) |

其中最近提交引入了 SSH-Mosh 远程会话支持（commit:48e74553）、SSH 跳板机多级链式连接（commit:9c37721f）、工作流 YAML 导入导出与失败系统通知（commit:2177899c）、配色方案独立设置页（commit:e8315896）。

**解决方案**：

- 会话连接异常优先看 `src/lib/sessions/sshSession.ts`，多级跳转连接失败先确认跳板链配置。
- 标签组/标签失序问题优先看 `src/stores/tabs.ts` 与 `src/components/titlebar/` 下已有测试覆盖的布局逻辑（`src/components/titlebar/tabGroupLayout.test.ts`、`src/components/titlebar/tabStripLayout.test.ts`）。
- 工作流 YAML 导入导出失败优先看 `src/services/workflowYamlIo.ts`（引入 `@tauri-apps/plugin-dialog`）；工作流运行失败的通知走 `src/services/notifications.ts`（引入 `@tauri-apps/plugin-notification`）。
- 配色方案预览异常优先看 `src/lib/colorSchemes.ts`。

> 推断：Mosh 远程会话（commit:48e74553）通常依赖本机存在对应的外部可执行程序，若连接阶段失败而 SSH 正常，建议先确认本机外部命令可用性。此推断依据为该提交信息中的 Mosh 会话支持与 `src/lib/sessions/sshSession.ts` 的变更记录，当前数据未包含外部二进制探测逻辑，故仅作排查方向。

## 五、调试技巧

### 5.1 构建与开发模式

| 目的 | 命令 |
| --- | --- |
| 前端热更新开发 | `bun run dev` |
| 桌面应用开发（含 Tauri 环境变量注入） | `bun run app:dev` |
| 仅类型检查 | `bunx vue-tsc --noEmit` |
| 产物本地预览 | `bun run preview` |
| 规范检查 | `bun run lint` |

桌面相关行为（读取 `TAURI_ENV_HOST`、`TAURI_ENV_DEBUG` 的分支）必须在 `bun run app:dev` 下验证，纯 `bun run dev` 无法复现。

### 5.2 单文件测试调试

测试与源码同目录共置，vitest 可直接按文件定位：

```bash
bun run test                                   # 全量
bunx vitest run src/components/split/splitTree.test.ts
bunx vitest run src/components/titlebar/tabGroupLayout.test.ts
```

布局类回归优先跑 `src/components/split/splitTree.test.ts`、`src/components/titlebar/tabGroupLayout.test.ts`、`src/components/titlebar/tabStripLayout.test.ts`；终端搜索焦点问题跑 `src/components/terminal/searchFocus.test.ts`；设置页拖拽排序跑 `src/components/settings/groupDragSort.test.ts`。

### 5.3 按子系统定位入口

排查时从第二节的入口文件表切入，按现象对照：

| 现象 | 首先查看 |
| --- | --- |
| 页面整体不渲染、全局样式丢失 | `src/main.ts` |
| 配置读写异常、工作流 YAML 解析 | `src/stores/config/index.ts`、`src/stores/config/store.ts`、`src/lib/workflowYaml.ts` |
| 会话建立/断开异常 | `src/lib/sessions/index.ts`、`src/lib/sessions/sshSession.ts` |
| 文案显示为 key、语言不切换 | `src/i18n/index.ts` |
| 界面无动画或动画卡死 | `src/lib/motion/index.ts` |
| 终端渲染/尺寸/搜索 | `src/lib/frontends/xterm/frontend.ts`、`renderer.ts`、`resize.ts`、`search.ts` |

### 5.4 日志与调试断点

- 桌面侧运行日志：通过 `bun run app:dev` 启动后，前端控制台与桌面进程输出分开查看，涉及文件系统操作的报错会同时出现在 Rust 侧输出（相关文件如 `src-tauri/src/fsutil.rs`，该文件为高频变更区）。
- 调试标记：`TAURI_ENV_DEBUG` 在 `vite.config.ts` 中被读取，可据此判断当前是否为调试构建。
- 前端调用链追溯：涉及桌面能力的调用集中在 `src/lib/frontendContext.ts`（剪贴板）、`src/services/updater.ts`（更新与进程）、`src/services/notifications.ts`（通知），从这些文件下断点可覆盖多数桌面交互故障。

## 六、待确认

| 缺口 | 缺失证据 |
| --- | --- |
| Node 运行时版本约束 | 项目数据未提供版本下限/上限，无法给出确切的 Node 版本要求 |
| Tauri 插件注册与权限清单 | 当前数据仅覆盖前端引用点，桌面侧插件注册与授权配置未包含 |
| 外部可执行程序依赖检测 | 会话（含 Mosh）所需外部程序的探测与提示逻辑未在数据中体现 |

已由数据覆盖、无需再疑的方面：环境变量读取点（`vite.config.ts`）、构建与测试命令（`package.json` 中的 `dev` / `build` / `preview` / `app:dev` / `app:build` / `lint` / `test`）、包管理器（bun）以及本文引用的全部边界常量，均可直接按上述锚点核对。
## Related

- 同目录：[onboarding.md](onboarding.md) · [testing.md](testing.md)
- 共享 4 个源文件、共享 42 个符号：[overview.md](../01-overview/overview.md)
- 共享 6 个源文件、共享 34 个符号：[constraints.md](../06-constraints/constraints.md)
- 共享 1 个源文件、共享 24 个符号：[environment.md](../01-overview/environment.md)
- 总入口：[README](../README.md)

<!-- wiki:source: llm -->
