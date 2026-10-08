# 故障排除（Troubleshooting）

<details>
<summary>Relevant source files</summary>

- scripts/gen-icon.ts
- src/components/split/splitTree.test.ts
- src/components/terminal/searchFocus.test.ts
- src/components/titlebar/tabGroupLayout.test.ts
- src/components/titlebar/tabStripLayout.test.ts
- src/i18n/index.ts
- src/lib/backgroundImage.test.ts
- src/lib/backgroundImage.ts
- src/lib/frontendContext.ts
- src/lib/frontends/frontend.ts
- src/lib/frontends/xterm/frontend.ts
- src/lib/frontends/xterm/lines.ts
- src/lib/frontends/xterm/options.ts
- src/lib/frontends/xterm/renderer.ts
- src/lib/frontends/xterm/resize.ts
</details>

本页汇总 `frontend`（Vue 3 + Vite + Tauri）项目在环境、构建、运行时三个层面可复现的问题与处置方式，所有条目均锚定到数据集提供的文件路径与符号。

> 锚点说明：本页锚点使用数据集中的**完整相对路径**（如 `src/components/monitor/MonitorSidebar.vue`）。数据集未提供行号，故不标注 `:line`，也不推测行号；凡是数据集未覆盖的内容一律显式标注「待确认」。

---

## 一、环境问题

### 1.1 包管理器必须使用 bun

**问题描述**
依赖安装/脚本执行若混用 npm、pnpm、yarn，可能出现依赖提升结果不一致、脚本行为差异。

**原因分析**
数据集 `packageManager` 明确为 `bun`；`scripts` 中所有命令均为裸命令（`dev`、`build`、`preview`、`app:dev`、`app:build`、`lint`、`test`），没有前缀声明，项目约定用 bun 驱动。

**解决方案**

```bash
bun install          # 安装依赖
bun run dev          # 等价于 vite
bun run build        # vue-tsc --noEmit && vite build
bun run app:dev      # tauri dev
```

若怀疑本地依赖树被污染，删除 `node_modules` 后用 bun 重装，再复现问题。

---

### 1.2 Node 版本要求未在数据中声明

**问题描述**
无法从数据判断项目要求的最低 Node 版本，遇到 `vue-tsc` 或 `vite` 报语法/API 不支持时无法直接对照版本要求。

**原因分析**
`nodeVersion` 字段为空字符串。

**解决方案**
以 bun 自带运行时为准执行脚本（见 1.1）；如需确认 Node 侧要求，**待确认**：数据未提供 `.nvmrc`、`engines` 或 CI 配置，无法给出具体版本号。

---

### 1.3 Tauri 环境变量缺失（纯 Vite 模式）

**问题描述**
用 `bun run dev`（即 `vite`）在浏览器里打开页面时，Tauri 注入的运行时上下文不存在，涉及宿主相关分支的逻辑表现与 `bun run app:dev` 不一致。

**原因分析**
数据集登记的环境变量为：

| 变量名 | 敏感 | 说明 |
| --- | --- | --- |
| `TAURI_ENV_HOST` | 否 | Tauri CLI 注入，标识宿主/目标平台信息 |
| `TAURI_ENV_DEBUG` | 否 | Tauri CLI 注入，标识调试构建 |

这两个变量由 Tauri CLI 在启动时注入，独立运行 `vite` 时不会存在。数据未提供这两个变量的读取位置（无 `filePath`），因此无法给出精确读取点锚点。

**解决方案**

```bash
bun run app:dev      # 走 Tauri CLI，注入 TAURI_ENV_* 后再复现问题
```

排障原则：**凡是涉及宿主能力的现象，一律用 `bun run app:dev` 复现，不要在纯 `vite` 下判断。**

---

### 1.4 Tauri 插件包与宿主侧不匹配

**问题描述**
调用剪贴板、文件对话框、通知、打开外部链接、进程退出、更新检查时抛错或静默失败。

**原因分析**
前端已通过 import 接入以下插件包（均有引用证据）：

| 依赖 | 引用方（示例） | usageKind |
| --- | --- | --- |
| `@tauri-apps/plugin-clipboard-manager` | `src/lib/frontendContext.ts` | import |
| `@tauri-apps/plugin-dialog` | `src/components/settings/pages/AppearancePage.vue`、`src/components/settings/pages/BackupPage.vue`、`src/components/sftp/SftpBrowserPane.vue` | import |
| `@tauri-apps/plugin-notification` | `src/services/notifications.ts` | import |
| `@tauri-apps/plugin-opener` | `src/components/settings/pages/AboutPage.vue`、`src/components/sftp/SftpBrowserPane.vue`、`src/components/sftp/TransferPopover.vue`、`src/lib/frontends/xterm/support.ts` | import |
| `@tauri-apps/plugin-process` | `src/services/updater.ts` | import |
| `@tauri-apps/plugin-updater` | `src/components/settings/pages/AboutPage.vue`、`src/services/updater.ts` | import |
| `@tauri-apps/api` | `src/main.ts` 等 5 处文件、共 25 次引用 | import |

前端插件包与宿主侧注册必须成对存在；只装了前端包而宿主未注册，会在调用点报错。

**解决方案**
按「报错文件 → 插件包」定位：`src/services/notifications.ts` 报错查 `@tauri-apps/plugin-notification`；`src/services/updater.ts` 报错查 `@tauri-apps/plugin-process` / `@tauri-apps/plugin-updater`；`src/lib/frontendContext.ts` 报错查 `@tauri-apps/plugin-clipboard-manager`。改完依赖后重跑 `bun run app:dev`。

---

### 1.5 xterm 主包与 addon 版本必须成对

**问题描述**
终端无法渲染，或报 addon 加载失败。

**原因分析**
终端能力由 `@xterm/xterm`（`src/lib/frontends/xterm/frontend.ts`、`lines.ts`、`options.ts`、`renderer.ts`、`resize.ts`，共 7 次引用）配合 6 个 addon 构成：

| addon | 引用方 |
| --- | --- |
| `@xterm/addon-fit` | `src/lib/frontends/xterm/frontend.ts`、`src/lib/frontends/xterm/resize.ts` |
| `@xterm/addon-webgl` | `src/lib/frontends/xterm/renderer.ts` |
| `@xterm/addon-canvas` | `src/lib/frontends/xterm/renderer.ts` |
| `@xterm/addon-search` | `src/lib/frontends/xterm/search.ts` |
| `@xterm/addon-unicode11` | `src/lib/frontends/xterm/frontend.ts` |
| `@xterm/addon-web-links` | `src/lib/frontends/xterm/frontend.ts` |

`@xterm/addon-*` 与 `@xterm/xterm` 是同一版本线下的 scope 包，错配会表现为渲染器初始化失败。

**解决方案**
统一升级/降级 `@xterm/xterm` 与全部 `@xterm/addon-*` 后 `bun install`，再运行 `bun run app:dev` 验证。

---

### 1.6 Tailwind v4 工具链配置

**问题描述**
样式全部失效（无 Tailwind 类效果），或动画类无效。

**原因分析**
数据集显示 Tailwind 采用 **v4 + Vite 插件** 形式，不存在 v3 的 `tailwind.config.js` + PostCSS 数据：

| 包 | 引用方 |
| --- | --- |
| `tailwindcss` | `src/assets/styles/main.css` |
| `@tailwindcss/vite` | `vite.config.ts` |
| `tw-animate-css` | `src/main.ts` |

**解决方案**
确认 `vite.config.ts` 中 `@tailwindcss/vite` 插件仍被注册，且 `src/main.ts` 引入了 `tw-animate-css`、`src/assets/styles/main.css` 被入口链引用。若自行添加了 v3 风格的 PostCSS 配置，需移除后再构建。

---

## 二、构建问题

### 2.1 类型检查先于打包：`vue-tsc` 失败即中止

**问题描述**
执行构建时先报 TypeScript 错误，`vite build` 根本没有执行，没有任何产物。

**原因分析**
`scripts.build` 的完整命令是：

```bash
vue-tsc --noEmit && vite build
```

`&&` 决定了两阶段串行，第一阶段失败则第二阶段不运行。

**解决方案**

```bash
bunx vue-tsc --noEmit            # 单独复现类型错误
bun run build                    # 修好后完整构建
```

注意：`bun run dev`（`vite`）**不做类型检查**，因此存在「dev 正常、build 失败」的常见现象，属于预期。

---

### 2.2 ESM / CJS 互操作

**问题描述**
构建或运行时报 `does not provide an export named 'default'`、`require is not defined` 之类的模块系统错误。

**原因分析**
以下依赖以 import 形式接入，且来源模块系统各异，是互操作问题的高发点：

| 依赖 | 引用方 |
| --- | --- |
| `yaml` | `src/stores/config/store.ts` |
| `deep-equal` | `src/lib/frontends/xterm/frontend.ts` |
| `nanoid` | 12 处，含 `src/components/settings/pages/KeysPage.vue`、`LocalProfilesPage.vue`、`QuickCommandsPage.vue`、`SshPage.vue`、`TabGroupsPage.vue` |
| `rxjs` | 7 处，含 `src/lib/frontends/frontend.ts`、`src/lib/frontends/xterm/frontend.ts`、`src/lib/frontends/xterm/support.ts`、`src/lib/middleware/middleware.ts`、`src/lib/middleware/oscProcessing.ts` |
| `clsx` / `tailwind-merge` | `src/lib/utils.ts` |

**解决方案**
按「报错模块 → 引用方文件」定位后，调整导入形式（默认导入 / 命名导入 / 命名空间导入）以匹配包的实际导出；不要为了绕过而改 `src/lib/utils.ts` 这类公共工具文件。

---

### 2.3 Tauri 打包与前端构建不同步

**问题描述**
`bun run app:build` 产出的应用内界面与 `bun run build` 的结果不一致（例如界面是旧版本）。

**原因分析**
前端构建命令 `vue-tsc --noEmit && vite build` 与 Tauri 打包命令 `tauri build` 是两条独立链路（`scripts.build` / `scripts.app:build`），Tauri 侧是否调用前端构建由其自身配置决定。

**解决方案**
出现界面不一致时，先手动执行 `bun run build` 确认前端产物是最新的，再执行 `bun run app:build`。**待确认**：数据集未提供 Tauri 配置内容，无法给出其中 `beforeBuildCommand` 的确切取值。

---

### 2.4 图标生成脚本的尺寸常量

**问题描述**
重新生成图标后发现尺寸不符合下游预期。

**原因分析**
`scripts/gen-icon.ts` 中定义常量 `SIZE = 1024`，即脚本产出 1024 尺寸的图标。

**解决方案**
脚本未登记在 `scripts` 中，需直接执行（bun 可直接运行 TS）：

```bash
bun scripts/gen-icon.ts
```

调整 `SIZE` 前，先确认图标消费方接受的尺寸；数据未提供消费方配置，**待确认**。

---

### 2.5 CSS 入口链断裂导致样式丢失

**问题描述**
构建成功但界面无样式。

**原因分析**
样式链路是 `src/main.ts`（引入 `tw-animate-css`）→ `src/assets/styles/main.css`（引入 `tailwindcss`）→ `vite.config.ts`（注册 `@tailwindcss/vite`）。任一环缺失都会导致样式丢失。

**解决方案**
按上述链路逐环检查，重点确认 `src/main.ts` 的样式/动画导入语句未被删除。

---

## 三、运行时问题

### 3.1 依赖引用关系（排障定位表）

| 依赖 | 引用方锚点 | 次数 | usageKind |
| --- | --- | --- | --- |
| `vue` | `src/App.vue`、`src/components/forwarding/ForwardRuleFormDialog.vue`、`ForwardingTabContent.vue`、`src/components/monitor/MetricChart.vue`、`MonitorSidebar.vue` 等 | 60 | import |
| `vue-i18n` | `src/App.vue`、`src/components/forwarding/ForwardRuleFormDialog.vue`、`ForwardingTabContent.vue`、`src/components/monitor/MonitorSidebar.vue`、`src/components/palette/CommandPalette.vue` 等 | 39 | import |

| `lucide-vue-next` | `src/components/forwarding/ForwardRuleFormDialog.vue`、`ForwardingTabContent.vue`、`src/components/monitor/MonitorSidebar.vue`、`src/components/settings/ColorSchemePicker.vue`、`GroupAccordion.vue` 等 | 28 | import |
| `@tauri-apps/api` | `src/components/settings/pages/AboutPage.vue`、`AppearancePage.vue`、`KeysPage.vue`、`src/components/sftp/SftpTabContent.vue`、`src/main.ts` | 25 | import |
| `nanoid` | `src/components/settings/pages/KeysPage.vue`、`LocalProfilesPage.vue`、`QuickCommandsPage.vue`、`SshPage.vue`、`TabGroupsPage.vue` 等 | 12 | import |
| `pinia` | `src/main.ts`、`src/stores/config/store.ts`、`src/stores/forwarding.ts`、`src/stores/monitor.ts`、`src/stores/tabs.ts` | 7 | import |
| `rxjs` | `src/lib/frontends/frontend.ts`、`src/lib/frontends/xterm/frontend.ts`、`support.ts`、`src/lib/middleware/middleware.ts`、`oscProcessing.ts` | 7 | import |
| `@xterm/xterm` | `src/lib/frontends/xterm/frontend.ts`、`lines.ts`、`options.ts`、`renderer.ts`、`resize.ts` | 7 | import |
| `@tauri-apps/plugin-opener` | `src/components/settings/pages/AboutPage.vue`、`src/components/sftp/SftpBrowserPane.vue`、`TransferPopover.vue`、`src/lib/frontends/xterm/support.ts` | 4 | import |
| `reka-ui` | `src/components/ui/Label.vue`、`Separator.vue`、`Slider.vue`、`Switch.vue` | 4 | import |
| `@tauri-apps/plugin-dialog` | `src/components/settings/pages/AppearancePage.vue`、`BackupPage.vue`、`src/components/sftp/SftpBrowserPane.vue` | 3 | import |
| `@tauri-apps/plugin-updater` | `src/components/settings/pages/AboutPage.vue`、`src/services/updater.ts` | 2 | import |
| `@xterm/addon-fit` | `src/lib/frontends/xterm/frontend.ts`、`resize.ts` | 2 | import |
| `@tauri-apps/plugin-clipboard-manager` / `plugin-notification` / `plugin-process` | `src/lib/frontendContext.ts` / `src/services/notifications.ts` / `src/services/updater.ts` | 1 各 | import |
| `@xterm/addon-canvas` / `addon-search` / `addon-unicode11` / `addon-web-links` / `addon-webgl` | `renderer.ts` / `search.ts` / `frontend.ts` / `frontend.ts` / `renderer.ts` | 1 各 | import |
| `class-variance-authority` | `src/components/ui/Button.vue` | 1 | import |
| `clsx` / `tailwind-merge` | `src/lib/utils.ts` | 1 各 | import |
| `deep-equal` | `src/lib/frontends/xterm/frontend.ts` | 1 | import |
| `gsap` | `src/lib/motion/index.ts` | 1 | import |
| `tw-animate-css` | `src/main.ts` | 1 | import |
| `yaml` | `src/stores/config/store.ts` | 1 | import |
| `vitest` | `src/components/split/splitTree.test.ts`、`src/components/terminal/searchFocus.test.ts`、`src/components/titlebar/tabGroupLayout.test.ts`、`src/components/titlebar/tabStripLayout.test.ts`、`src/lib/backgroundImage.test.ts` 等 | 33 | test |

以上依赖均有实际引用证据（`usageKind = import` 或 `test`），**不存在「声明未用」项**。运行时若某功能不生效，应到上表「引用方」中按模块定位，而不是怀疑依赖未安装。

---

### 3.2 外部依赖未安装（终端后端 / MCP 类能力）

**问题描述**
终端相关的异步数据流在中途断流或长时间无输出，但前端本身没有抛错。

**原因分析**
`src/lib/frontends/frontend.ts`、`src/lib/frontends/xterm/frontend.ts`、`src/lib/frontends/xterm/support.ts`、`src/lib/middleware/middleware.ts`、`src/lib/middleware/oscProcessing.ts` 均基于 `rxjs` 构建（7 处引用）。前端侧只负责订阅数据流，实际数据由宿主侧进程提供；宿主侧能力缺失时，前端表现为流无产出。

**解决方案**
这类问题的排障顺序是「先确认宿主进程是否存在 → 再确认前端订阅是否正确」：使用 `bun run app:dev` 启动，观察宿主侧输出。**待确认**：数据集未提供外部进程/服务的清单与安装方式，无法给出具体安装命令。

---

### 3.3 常量越界引发的运行时异常（逐项说明）

以下常量是各模块的硬边界。触界时症状明确，排障时优先核对这些值。

#### 3.3.1 `SIDEBAR_MIN_WIDTH = 260` / `SIDEBAR_MAX_WIDTH = 480`
- 文件：`src/components/monitor/MonitorSidebar.vue`
- **触界症状**：监控侧边栏拖拽到边界后停止响应，宽度不再变化。
- **处置**：确认拖拽宽度被约束在 260–480 之间；预期外的钳制即为该常量生效，非 bug。

#### 3.3.2 `SIDEBAR_MIN_WIDTH = 180` / `SIDEBAR_MAX_WIDTH = 240`
- 文件：`src/components/start/StartPageContent.vue`
- **触界症状**：启动页内容区侧栏拖拽范围被限制在 180–240。
- **注意**：与 3.3.1 同名但**不同文件、不同取值**，排查时务必先确认是哪个组件。这是本项目中同名常量最容易被误判的一处。

#### 3.3.3 `MAX_VISIBLE_ROWS = 8`
- 文件：`src/components/terminal/SuggestionMenu.vue`
- **触界症状**：终端建议菜单最多显示 8 行，第 9 条及之后不再展示（候选本身可能仍存在，只是不可见）。
- **处置**：若怀疑候选缺失，需区分「候选被过滤掉」与「候选超出可见行数被折叠」。

#### 3.3.4 `MIN_BACKGROUND_OPACITY = 0.05`
- 文件：`src/lib/backgroundImage.ts`
- **触界症状**：背景图透明度调到最低仍能隐约可见，无法完全透明。
- **处置**：0.05 为下限，不要把「无法设为 0」当作渲染 bug。

#### 3.3.5 `RESIZE_MIN_INTERVAL = 32`
- 文件：`src/lib/frontends/xterm/resize.ts`
- **触界症状**：快速拖拽窗口时终端重排有约 32ms 的节流感，尺寸在停止拖拽后才最终对齐。
- **处置**：这是防抖/节流阈值，非渲染卡顿。

#### 3.3.6 `MAX_WEBGL_RECOVERY_ATTEMPTS = 3`
- 文件：`src/lib/frontends/xterm/support.ts`
- **触界症状**：WebGL 渲染上下文丢失（例如 GPU 驱动重置、切换显卡）后最多尝试恢复 3 次；超过 3 次后终端不再自动恢复，可能显示异常或回退渲染。
- **处置**：连续看到恢复失败时，检查 GPU/驱动是否反复重置；达到上限后需重启应用或重建终端实例。渲染器相关代码见 `src/lib/frontends/xterm/renderer.ts`（引用 `@xterm/addon-webgl`、`@xterm/addon-canvas`）。

#### 3.3.7 `DEFAULT_MAX_PROMPT_JUMP = 20`
- 文件：`src/lib/suggestions/promptTracker.ts`
- **触界症状**：提示符跳转只能回溯 20 步，更早的提示符无法定位。
- **处置**：属设计上限，不作为缺陷处理。

#### 3.3.8 建议引擎配额常量
- 文件：`src/lib/suggestions/suggestionEngine.ts`
- 常量：`MAX_HISTORY_SAME_SOURCE = 8`、`MAX_HISTORY_GLOBAL = 4`、`MAX_QUICK_COMMANDS = 4`、`MAX_PATHS = 8`、`MAX_TOTAL = 16`
- **触界症状**：建议列表被裁剪——同一来源最多 8 条、历史全局最多 4 条、快捷命令最多 4 条、路径最多 8 条，总量不超过 16 条。表现为「某些历史命令不再出现在建议里」。
- **处置**：排查「建议不全」类问题时，先对照这五个配额，确认是配额裁剪而非数据丢失。

#### 3.3.9 `INDEX_LIMIT = 5000`
- 文件：`src/services/history.ts`
- **触界症状**：历史索引规模达到 5000 后不再增长，超出的历史项不会被索引。
- **处置**：定位「历史搜索搜不到早期记录」类问题时，先确认是否触达该上限。

#### 3.3.10 `MAX_SAMPLES = 150`
- 文件：`src/stores/monitor.ts`
- **触界症状**：监控图表最多保留 150 个采样点，更早的点被滚动丢弃。
- **处置**：图表「开头数据消失」属预期行为（环形/滑动窗口）。

---

### 3.4 配置存储与 YAML 解析

**问题描述**
配置读写异常、启动时配置结构不符合预期。

**原因分析**
配置相关入口与实现为 `src/stores/config/index.ts`（entryFiles）与 `src/stores/config/store.ts`，其中 `src/stores/config/store.ts` 引入 `yaml` 与 `pinia`，说明配置以 YAML 形式处理并挂在 Pinia 上。

**解决方案**
优先检查 `src/stores/config/index.ts` 的加载顺序与 `src/stores/config/store.ts` 中 YAML 的解析结果。**待确认**：数据集未提供配置文件的磁盘路径与格式示例，无法给出具体文件位置。

---

### 3.5 国际化文案缺失

**问题描述**
界面出现 key 原文（如 `xxx.yyy`（待确认））而非译文。

**原因分析**
i18n 入口为 `src/i18n/index.ts`（entryFiles），而 `vue-i18n` 在 39 处文件被引用（含 `src/App.vue`、`src/components/palette/CommandPalette.vue` 等）。

**解决方案**
以 `src/i18n/index.ts` 为起点核对语言包注册与 key 命名空间；报 key 原文的组件必然在上述 39 处引用文件中，可直接反查。

---

### 3.6 通知与更新流程

**问题描述**
通知不弹出、更新检查失败。

**原因分析**

| 能力 | 引用方锚点 |
| --- | --- |
| 通知 | `src/services/notifications.ts`（`@tauri-apps/plugin-notification`） |
| 更新 | `src/services/updater.ts`（`@tauri-apps/plugin-updater`、`@tauri-apps/plugin-process`）、`src/components/settings/pages/AboutPage.vue` |

**解决方案**
通知问题定位 `src/services/notifications.ts` + 宿主侧通知权限；更新问题定位 `src/services/updater.ts` 与 `src/components/settings/pages/AboutPage.vue` 的触发点。两者都依赖宿主侧插件已注册（见 1.4）。

---

### 3.7 文件对话框与外部打开

**问题描述**
打开文件/目录选择框失败，或点击链接无反应。

**原因分析**

| 能力 | 引用方锚点 |
| --- | --- |
| 对话框 | `src/components/settings/pages/AppearancePage.vue`、`src/components/settings/pages/BackupPage.vue`、`src/components/sftp/SftpBrowserPane.vue` |
| 打开外部 | `src/components/settings/pages/AboutPage.vue`、`src/components/sftp/SftpBrowserPane.vue`、`src/components/sftp/TransferPopover.vue`、`src/lib/frontends/xterm/support.ts` |

**解决方案**
注意 `src/lib/frontends/xterm/support.ts` 也引用了 `@tauri-apps/plugin-opener`——即终端内点击链接同样走外部打开能力，排障时不要漏掉这一处。

---

## 四、调试技巧

### 4.1 排障起点：入口文件

| 入口文件 | 作用域 |
| --- | --- |
| `src/main.ts` | 应用启动入口（引入 `pinia`、`tw-animate-css`、`@tauri-apps/api`） |
| `src/i18n/index.ts` | 国际化初始化 |
| `src/stores/config/index.ts` | 配置状态入口 |
| `src/lib/motion/index.ts` | 动效入口（引入 `gsap`） |
| `src/lib/sessions/index.ts` | 会话入口 |

问题定位顺序建议：从 `src/main.ts` 确认应用是否完成启动装配 → 再按现象跳到对应入口（文案 → i18n；配置 → config；动效 → motion；会话 → sessions）。

---

### 4.2 用完整命令复现

| 目的 | 命令 |
| --- | --- |
| 前端单独起服（无 Tauri 上下文） | `bun run dev` |
| 类型检查单独执行 | `bunx vue-tsc --noEmit` |
| 完整构建（类型 + 打包） | `bun run build` |
| 预览构建产物 | `bun run preview` |
| 宿主内运行（注入 `TAURI_ENV_*`） | `bun run app:dev` |
| 宿主内打包 | `bun run app:build` |
| 静态检查 | `bun run lint`（即 `oxlint src`） |
| 全量单测 | `bun run test`（即 `vitest run`） |


### 4.3 单文件测试调试

测试由 `vitest` 驱动（`usageKind = test`，33 处引用），已登记的测试文件包括：

| 测试文件 | 覆盖目标 |
| --- | --- |
| `src/components/split/splitTree.test.ts` | 分屏树 |
| `src/components/terminal/searchFocus.test.ts` | 终端搜索聚焦 |
| `src/components/titlebar/tabGroupLayout.test.ts` | 标签组布局 |
| `src/components/titlebar/tabStripLayout.test.ts` | 标签条布局 |
| `src/lib/backgroundImage.test.ts` | 背景图（含 `MIN_BACKGROUND_OPACITY` 所在模块） |

单文件调试命令（vitest 直接接受文件路径参数）：

```bash
bunx vitest run src/lib/backgroundImage.test.ts
bunx vitest run src/components/titlebar/tabStripLayout.test.ts
```

需要交互式重跑时用 watch 模式：

```bash
bunx vitest src/lib/backgroundImage.test.ts
```

**注意**：`scripts.test` 为 `vitest run`（一次性执行、不进入 watch），本地调试用上面的 `bunx vitest <file>` 更高效。

---

### 4.4 使用调试环境变量

`TAURI_ENV_DEBUG` 由 Tauri CLI 注入，用于区分调试构建；`TAURI_ENV_HOST` 标识宿主。调试时：

```bash
bun run app:dev      # 观察注入的 TAURI_ENV_* 实际取值
```

**待确认**：数据集未提供这两个变量的读取位置，无法给出「在哪个文件打印/分支」的具体锚点。

---

### 4.5 终端相关问题的分层排查

终端是本项目代码量最集中的子系统，建议按层定位：

| 层 | 文件锚点 | 常见症状 |
| --- | --- | --- |
| 渲染器 | `src/lib/frontends/xterm/renderer.ts`（webgl / canvas） | 花屏、恢复失败（对照 `MAX_WEBGL_RECOVERY_ATTEMPTS = 3`） |
| 尺寸 | `src/lib/frontends/xterm/resize.ts`（fit；`RESIZE_MIN_INTERVAL = 32`） | 尺寸不跟手、重排延迟 |
| 行数据 | `src/lib/frontends/xterm/lines.ts` | 行内容异常 |
| 配置 | `src/lib/frontends/xterm/options.ts` | 选项不生效 |
| 搜索 | `src/lib/frontends/xterm/search.ts`（`@xterm/addon-search`） | 搜索无结果、不定位 |
| 宿主能力 | `src/lib/frontends/xterm/support.ts`（opener + webgl 恢复上限） | 点击链接无效、重复恢复尝试 |
| 主前端 | `src/lib/frontends/xterm/frontend.ts`（fit / unicode11 / web-links / deep-equal） | 宽字符错位、链接不可点、选项比对失效 |
| 中间件 | `src/lib/middleware/middleware.ts`、`src/lib/middleware/oscProcessing.ts`（rxjs） | OSC 序列未生效、数据流断流 |

建议的排查顺序：**渲染器 → 尺寸 → 主前端 → 中间件 → 宿主能力**，因为前三层的问题最容易表现为「界面看起来坏了」。

---

### 4.6 依赖问题的通用定位法

遇到某个能力异常时，按「能力 → 依赖 → 引用方文件」三步定位，全部依据来自 3.1 的引用表：

- 按钮/变体样式异常 → `class-variance-authority`（`src/components/ui/Button.vue`）+ `clsx`/`tailwind-merge`（`src/lib/utils.ts`）
- 基础交互组件（开关、滑块、标签、分隔线）异常 → `reka-ui`（`src/components/ui/Switch.vue`、`Slider.vue`、`Label.vue`、`Separator.vue`）
- 图标不显示 → `lucide-vue-next`（28 处引用）
- ID 生成冲突 → `nanoid`（12 处引用）
- 动效异常 → `gsap`（`src/lib/motion/index.ts`）
- 终端选项比对异常 → `deep-equal`（`src/lib/frontends/xterm/frontend.ts`）

`src/lib/utils.ts` 是 `clsx` 与 `tailwind-merge` 的唯一引用点，改动该文件影响面为全项目，排障时优先怀疑调用方而非该文件本身。

---

## 五、待确认事项汇总

| # | 缺口 | 影响 |
| --- | --- | --- |
| 1 | `nodeVersion` 为空，且无 `.nvmrc` / `engines` / CI 配置证据 | 无法给出最低 Node 版本要求 |
| 2 | `TAURI_ENV_HOST` / `TAURI_ENV_DEBUG` 无 `filePath`，读取点未知 | 无法定位这两个变量的分支逻辑 |
| 3 | Tauri 配置内容未提供 | 无法确认 `app:build` 是否自动调用前端构建 |
| 4 | 外部进程/服务（终端后端等）清单与安装方式未提供 | 无法给出 3.2 中外部依赖缺失的具体安装命令 |
| 5 | 配置文件磁盘路径与格式示例未提供 | 无法给出 3.4 中配置的落盘位置 |

以上为本页保留的关键缺口；数据集已覆盖的 `scripts`、`envVars`、`constants`、`depUsage`、`entryFiles` 均已在上文逐项引用，未作「待确认」处理。
## Related

- 同目录：[onboarding.md](onboarding.md) · [testing.md](testing.md)
- 总入口：[README](../README.md)
