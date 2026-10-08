# 故障排除指南

<details>
<summary>Relevant source files</summary>

- scripts/gen-icon.ts
- src-tauri/src/fsutil.rs
- src/i18n/index.ts
- src/lib/backgroundImage.ts
- src/lib/colorSchemes.ts
- src/lib/frontendContext.ts
- src/lib/frontends/frontend.ts
- src/lib/frontends/xterm/frontend.ts
- src/lib/frontends/xterm/renderer.ts
- src/lib/frontends/xterm/resize.ts
- src/lib/frontends/xterm/search.ts
- src/lib/frontends/xterm/support.ts
- src/lib/middleware/middleware.ts
- src/lib/middleware/oscProcessing.ts
- src/lib/motion/index.ts
</details>

本页汇总该项目（Vue 3 + Vite + TypeScript + Tauri 前端工程）在环境配置、构建、运行时三个阶段最可能遇到的问题，全部条目均以源码锚点或配置字段为依据。

---

## 0. 症状速查表

| 症状 | 先去哪一节 |
| --- | --- |
| `bun install` / 依赖树不一致、锁文件冲突 | 环境问题 §1 |
| `tauri dev` / `tauri build` 报找不到 Rust 工具链或命令不存在 | 环境问题 §2 |
| `vite` 启动后行为与 Tauri 内运行不一致 | 环境问题 §3 |
| `vue-tsc` 报错导致 `bun run build` 直接失败 | 构建问题 §1 |
| Tailwind 类名不生效、动画类缺失 | 构建问题 §2 |
| `deep-equal` 相关 ESLint/打包报错 | 构建问题 §3 |
| 图标资源生成失败或尺寸不符 | 构建问题 §4 |
| 终端画面黑屏/花屏、显卡切换后不恢复 | 运行时问题 §1 |
| 终端尺寸错位、拖拽窗口后列数不对 | 运行时问题 §2 |
| 自动滚动/回滚行为异常 | 运行时问题 §3 |
| 命令建议菜单项数不对、看不到历史 | 运行时问题 §4 |
| 历史搜索找不到较早条目 | 运行时问题 §5 |
| 监控图表曲线异常/内存增长 | 运行时问题 §6 |
| 侧边栏拖拽到某个宽度后不再变化 | 运行时问题 §7 |
| 背景图透明度拖到最低后看不见 | 运行时问题 §8 |

---

## 1. 环境问题

### 1.1 包管理器不是 npm/yarn —— 必须使用 Bun

**问题描述**：按 `npm install` / `yarn`（待确认） 安装后出现依赖版本不一致，或脚手架脚本无法执行。

**原因分析**：项目声明的包管理器为 `packageManager` = `bun`。混用包管理器会生成多份锁文件，导致 `@tauri-apps/*`、`@xterm/*` 等包解析到不同版本。

**解决方案**：

```bash
bun install          # 统一使用 bun 安装
bun run dev          # 开发服务器
bun run app:dev      # Tauri 桌面开发（见 §1.2）
```

如果仓库中已存在 `package-lock.json` / `yarn.lock`，删除后再执行 `bun install`。

---

### 1.2 Tauri CLI 与 Rust（Cargo）工具链缺失

**问题描述**：执行 `bun run app:dev` 或 `bun run app:build` 时报 “command not found: tauri” 或 Rust 编译工具链相关错误。

**原因分析**：

- `@tauri-apps/cli` 在依赖使用证据中 `usageKind = none`、`importFiles` 为空，它不通过源码 `import` 使用，而是由 npm scripts 调起的命令行程序：
  - `app:dev` → `tauri dev`
  - `app:build` → `tauri build`
- 该项目包含 Rust 侧代码，模块清单中存在 `Cargo` 模块，且 Rust 源码文件 `src-tauri/src/fsutil.rs` 在变更统计中被追踪（锚点：`commit:c81c17e5 (2026-09-19)`，target `src-tauri/src/fsutil.rs`）。因此构建链路依赖本机安装 Rust 工具链。

**解决方案**：

```bash
bun install                 # 确保 @tauri-apps/cli 已安装到 node_modules
bunx tauri --version        # 验证 CLI 可用
rustc --version && cargo --version   # 验证 Rust 工具链
bun run app:dev
```

若 `bunx tauri` 可用但 `bun run app:dev` 失败，检查 `PATH` 是否包含 `node_modules/.bin`（Bun 运行时脚本应自动注入）。

> 说明：`src-tauri/` 下的 Rust 依赖版本与 Tauri 配置内容未在本次数据中提供，不在此展开（见 §6 待确认）。

---

### 1.3 Vite 侧 Tauri 环境变量

**问题描述**：把应用跑在浏览器里（`bun run dev` 直接打开 `localhost`）时，行为与 `tauri dev` 窗口内不一致（例如资源路径、调试开关不同）。

**原因分析**：`vite.config.ts` 中读取了两个环境变量：

| 变量 | 敏感 | 引用位置（生产源码锚点） |
| --- | --- | --- |
| `TAURI_ENV_HOST` | 否 | `vite.config.ts` |
| `TAURI_ENV_DEBUG` | 否 | `vite.config.ts` |

**解决方案**：

- 需要完整桌面环境时始终使用 `bun run app:dev`，而不是 `bun run dev`。
- 若必须在纯浏览器下调试，手动导出后再启动：

```bash
TAURI_ENV_DEBUG=true bun run dev
```

> 推断：这两个变量名以 `TAURI_ENV_` 前缀命名，且 `vite.config.ts` 是唯一引用点，结合脚本 `app:dev: tauri dev`，可判断它们由 Tauri CLI 在启动时注入；直接执行 `vite` 时不会被注入。推断依据：变量命名前缀 + `vite.config.ts` 单一引用点 + `scripts.app:dev/app:build`。

---

### 1.4 前端插件依赖与原生能力的对应关系

**问题描述**：某个功能在开发时正常，打包后调用（如系统弹窗、通知、打开外部链接、检查更新）静默失败或直接抛错。

**原因分析**：以下 `@tauri-apps/plugin-*` 包均为前端 `import` 使用，若原生侧未启用对应插件，运行时会失败。使用证据如下（均为 `usageKind = import`）：

| 依赖 | 前端 import 锚点 |
| --- | --- |
| `@tauri-apps/plugin-clipboard-manager` | `src/lib/frontendContext.ts` |
| `@tauri-apps/plugin-dialog` | `src/components/settings/pages/AppearancePage.vue`、`src/components/settings/pages/BackupPage.vue`、`src/components/sftp/SftpBrowserPane.vue` |
| `@tauri-apps/plugin-notification` | `src/services/notifications.ts` |
| `@tauri-apps/plugin-opener` | `src/components/settings/pages/AboutPage.vue`、`src/components/sftp/SftpBrowserPane.vue`、`src/components/sftp/TransferPopover.vue`、`src/lib/frontends/xterm/support.ts` |
| `@tauri-apps/plugin-process` | `src/services/updater.ts` |
| `@tauri-apps/plugin-updater` | `src/components/settings/pages/AboutPage.vue`、`src/services/updater.ts` |

其中 `@tauri-apps/plugin-opener` 的一个关键使用点是终端超链接处理：`src/lib/frontends/xterm/support.ts` —— 终端里点击链接打不开，优先检查此处链路。

**解决方案**：

1. 确认 `bun install` 完整（`node_modules/@tauri-apps/` 下六个 plugin 目录都存在）。
2. 确认运行的是 `bun run app:dev` / `bun run app:build`（原生插件仅在 Tauri 容器内提供实现）。
3. 只影响单条链路时，按上表定位到对应 `import` 文件，在调用处加日志确认是在前端 `invoke` 阶段失败还是原生侧返回错误。

---

## 2. 构建问题

### 2.1 `vue-tsc --noEmit` 类型检查失败导致构建中断

**问题描述**：`bun run build` 直接失败，报出大量 `TSxxxx`（待确认） 错误，`vite build` 根本没开始。

**原因分析**：构建脚本是串行两步：

```json
"build": "vue-tsc --noEmit && vite build"
```

`&&` 意味着类型检查不通过就不会打包。`typescript` 与 `vue-tsc` 在依赖使用证据中均为 `usageKind = none` / `usageKind = script`（`vue-tsc` 由 `scripts.build` 调用），说明它们是构建期工具，不在运行时代码中被 `import`。

**解决方案**：

```bash
bun run build                       # 完整校验（先类型后打包）
bunx vue-tsc --noEmit               # 只跑类型检查，快速定位
bunx vue-tsc --noEmit --pretty false | head -50   # 错误过多时截断
```

定位到具体 `.vue` / `.ts` 文件后逐个修复，不要通过改脚本绕过类型检查（会掩盖 `.vue` 模板层的类型错误）。

---

### 2.2 Tailwind 相关样式不生效 / 动画类缺失

**问题描述**：构建成功但页面完全没有样式，或 `animate-*` 动画类无效。

**原因分析**：样式链路由三处构成，缺任一环都会失效：

| 依赖 | 使用证据 | 锚点 |
| --- | --- | --- |
| `tailwindcss` | `usageKind = import` | `src/assets/styles/main.css` |
| `@tailwindcss/vite` | `usageKind = import` | `vite.config.ts` |
| `tw-animate-css` | `usageKind = import` | `src/main.ts` |

**解决方案**：

1. 确认 `vite.config.ts` 中 `@tailwindcss/vite` 插件已注册（它是本项目 Tailwind 的 Vite 集成点）。
2. 确认 `src/main.ts` 中的 `tw-animate-css` 引入未被删除——它负责动画工具类。
3. 确认 `src/assets/styles/main.css` 引入了 `tailwindcss`。
4. 清缓存重跑：

```bash
rm -rf node_modules/.vite && bun run dev
```

---

### 2.3 CJS/ESM 互操作类报错

**问题描述**：构建或运行时报模块格式相关错误，涉及 `deep-equal`。

**原因分析**：`deep-equal` 是纯 CommonJS 包，在本项目中被 ESM 源码引用：

- `usageKind = import`，`importFiles`: `src/lib/frontends/xterm/frontend.ts`
- 对应类型包 `@types/deep-equal` 已声明（`usageKind = none`，类型包不产生 `import` 属正常）。

**解决方案**：

1. 若报 `default` 导入不是函数/对象，检查 `src/lib/frontends/xterm/frontend.ts` 中的导入形态是否与 `esModuleInterop`（待确认） 设置匹配。
2. 清掉 Vite 预构建缓存后重试：

```bash
rm -rf node_modules/.vite && bun run dev
```

3. 若仅在打包产物中出现而开发模式正常，用 `bun run preview` 复现生产行为进行对比。

---

### 2.4 图标资源生成问题

**问题描述**：`tauri build` 前需要应用图标，生成出的图标模糊或尺寸不对。

**原因分析**：图标生成脚本中定义了源图尺寸常量：

| 常量 | 值 | 锚点 |
| --- | --- | --- |
| `SIZE` | `1024` | `scripts/gen-icon.ts:7` |

**解决方案**：

1. 源图必须是正方形，且不小于 `SIZE`（`scripts/gen-icon.ts:7` 定义为 1024），否则缩小后边缘模糊。
2. 重新生成后确认输出目录中的图标文件已被替换，再执行：

```bash
bun run app:build
```

---

## 3. 运行时问题

### 3.1 终端渲染异常与 WebGL 恢复次数上限

**问题描述**：终端出现黑屏、花屏、字符渲染错乱，切换显卡/休眠唤醒后不恢复。

**原因分析**：`src/lib/frontends/xterm/renderer.ts` 同时引入了两套渲染后端：

- `@xterm/addon-webgl`（`usageKind = import`，锚点 `src/lib/frontends/xterm/renderer.ts`）
- `@xterm/addon-canvas`（`usageKind = import`，锚点 `src/lib/frontends/xterm/renderer.ts`）

WebGL 上下文丢失后允许的最大恢复尝试次数被硬编码为常量：

| 常量 | 值 | 锚点 |
| --- | --- | --- |
| `MAX_WEBGL_RECOVERY_ATTEMPTS` | `3` | `src/lib/frontends/xterm/support.ts:58` |

**触界症状**：WebGL 上下文在短时间内连续丢失超过 3 次后，`src/lib/frontends/xterm/support.ts:58` 的上限被耗尽，表现为终端**彻底不再尝试恢复渲染**，界面停留在一片空白/黑色区域，但底层会话仍在运行（输入仍有回显到日志/其他窗口）。

**解决方案**：

1. 触发一次完整重建（关闭该标签页后重开），以重置恢复计数。
2. 若在虚拟机、远程桌面、多显卡切换场景下频繁触发，优先排查 GPU 驱动；必要时临时禁用 WebGL 走 Canvas 路径（渲染后端选择逻辑位于 `src/lib/frontends/xterm/renderer.ts`）。
3. 排查显卡相关诱因时，可用 `bun run app:dev` 打开 devtools 查看控制台中的 WebGL 上下文丢失日志。

---

### 3.2 终端尺寸同步与 resize 节流

**问题描述**：拖拽窗口或调整分屏后，终端列数/行数与实际显示区域不匹配，出现换行错位或右侧留白。

**原因分析**：尺寸计算依赖 `@xterm/addon-fit`（`usageKind = import`，锚点 `src/lib/frontends/xterm/resize.ts`、`src/lib/frontends/xterm/frontend.ts`），同时有最小重算间隔限制：

| 常量 | 值 | 锚点 |
| --- | --- | --- |
| `RESIZE_MIN_INTERVAL` | `32` | `src/lib/frontends/xterm/resize.ts:11` |

**触界症状**：连续快速拖拽窗口时，若两次 resize 间隔小于 `32`（毫秒级节流窗口，见 `src/lib/frontends/xterm/resize.ts:11`），中间的尺寸变更会被丢弃，只在停顿后应用最后一次。表现为**拖拽过程中终端内容短暂错位、松手后才对齐**——这是节流生效的正常表现，不是 bug。

真正需要排查的是：松手后仍不对齐 → 说明最后一次 fit 计算未能拿到正确的容器尺寸（容器尺寸变化早于布局完成）。

**解决方案**：

1. 松手后仍错位时，先触发一次容器重排（如切换标签页再切回），确认是否能自愈。
2. 若稳定复现，检查承载终端的容器是否在 `RESIZE_MIN_INTERVAL`（`src/lib/frontends/xterm/resize.ts:11`）窗口内被多次改动尺寸，可以在 `src/lib/frontends/xterm/resize.ts` 的节流逻辑处临时降低间隔进行验证。
3. 关闭窗口动画（`src/lib/motion/index.ts` 中的 GSAP 动效链路）以排除动画过渡期间测量容器尺寸导致的偏差。

---

### 3.3 终端滚动行为异常（已知语义坑）

**问题描述**：期望“用户滚动”触发的逻辑（如自动跟随、回滚到提示符）没有触发。

**原因分析**：源码中有一条明确的作者注记：

> `NOTE: xterm.onScroll only fires for content-driven scroll (new lines),`
> —— 锚点 `src/lib/frontends/xterm/frontend.ts:120`

也就是说 `xterm.onScroll`（待确认） **只在内容驱动滚动（新行输出）时触发**，用户手动拖拽滚动条不一定会走到该回调。

**解决方案**：

1. 需要响应“用户滚轮/拖拽”时，不要依赖 `src/lib/frontends/xterm/frontend.ts:120` 附近这条 `onScroll`（待确认） 语义，改为在承载元素的 DOM 滚动事件上处理。
2. 排查“自动跟随失效”类问题时，先确认输出是否在持续产生新行——若没有新行，`onScroll`（待确认） 本就不会触发。
3. 定位入口：`src/lib/frontends/xterm/frontend.ts:120`。

---

### 3.4 命令建议菜单的容量上限

**问题描述**：命令建议（补全）菜单里的候选项比预期少，或历史命令一直重复同几条。

**原因分析**：建议引擎有一组硬上限常量，全部集中定义：

| 常量 | 值 | 锚点 |
| --- | --- | --- |
| `MAX_HISTORY_SAME_SOURCE` | `8` | `src/lib/suggestions/suggestionEngine.ts:11` |
| `MAX_HISTORY_GLOBAL` | `4` | `src/lib/suggestions/suggestionEngine.ts:12` |
| `MAX_QUICK_COMMANDS` | `4` | `src/lib/suggestions/suggestionEngine.ts:13` |
| `MAX_PATHS` | `8` | `src/lib/suggestions/suggestionEngine.ts:14` |
| `MAX_TOTAL` | `16` | `src/lib/suggestions/suggestionEngine.ts:15` |
| `MAX_VISIBLE_ROWS` | `8` | `src/components/terminal/SuggestionMenu.vue:41` |
| `DEFAULT_MAX_PROMPT_JUMP` | `20` | `src/lib/suggestions/promptTracker.ts:125` |

**触界症状与解决方案**：

- **候选总数被封顶在 16**（`src/lib/suggestions/suggestionEngine.ts:15`）：即使匹配到更多，最终列表也不会超过 16 项。若某条想要的命令没出现，先用 `bun run app:dev` 的 devtools 检查它在哪一类配额里被截断（同类 8 / 全局 4 / 快捷 4 / 路径 8）。
- **菜单一次只显示 8 行**（`src/components/terminal/SuggestionMenu.vue:41`）：超过 8 项需滚动，鼠标滚轮不生效时先确认该常量对应的滚动容器。
- **提示符跳转最多记录 20 个**（`src/lib/suggestions/promptTracker.ts:125`）：长时间会话中往回跳超过 20 个提示符会跳不到——此时用终端搜索（§3.5）而不是提示符跳转。

---

### 3.5 历史记录搜索上限

**问题描述**：搜索历史命令时，较早的记录搜不到。

**原因分析**：

| 常量 | 值 | 锚点 |
| --- | --- | --- |
| `INDEX_LIMIT` | `5000` | `src/services/history.ts:9` |

**触界症状**：历史条目数超过 `5000`（`src/services/history.ts:9`）后，超出的部分不进入索引，表现为**搜索无结果但翻页/终端内回滚能看到该命令**。

**解决方案**：

1. 确认历史数据的来源与落盘位置（`src/services/history.ts` 为读写入口）。
2. 若确实超出规模，清理历史文件或提高 `src/services/history.ts:9` 的上限后重启应用。
3. 紧急查找时改用终端内搜索：`@xterm/addon-search` 的接入点在 `src/lib/frontends/xterm/search.ts`。

---

### 3.6 监控数据采样与图表

**问题描述**：监控图表长时间运行后内存上涨，或曲线只保留很短一段。

**原因分析**：

| 常量 | 值 | 锚点 |
| --- | --- | --- |
| `MAX_SAMPLES` | `150` | `src/stores/monitor.ts:11` |

**触界症状**：采样点达到 `150`（`src/stores/monitor.ts:11`）后按环形缓冲淘汰最旧数据。表现为**图表只能看到最近 150 个采样点对应的时段**，更早的数据不可回溯——这是设计行为。

**解决方案**：

1. 采样上限是设计行为，不需要修复；若需要更长窗口，调整 `src/stores/monitor.ts:11` 的 `MAX_SAMPLES` 并观察内存。
2. 若内存持续上涨而非稳定在 150 点规模，先排除图表组件侧的问题：`src/components/monitor/MetricChart.vue` 是图表渲染点，`src/components/monitor/MonitorSidebar.vue` 是侧栏宿主。
3. 采样数据由 `src/stores/monitor.ts` 统一持有，排查时以该 store 为单一事实来源。

---

### 3.7 侧边栏拖拽宽度的双组边界

**问题描述**：侧边栏拖到某个宽度后拖不动了，或拖到极窄时内容溢出。

**原因分析**：项目中有**两套独立**的侧边栏宽度边界，作用于不同界面：

| 常量 | 值 | 锚点 | 适用界面 |
| --- | --- | --- | --- |
| `SIDEBAR_MIN_WIDTH` | `260` | `src/components/monitor/MonitorSidebar.vue:166` | 监控侧栏 |
| `SIDEBAR_MAX_WIDTH` | `480` | `src/components/monitor/MonitorSidebar.vue:167` | 监控侧栏 |
| `SIDEBAR_MIN_WIDTH` | `180` | `src/components/start/StartPageContent.vue:53` | 起始页内容区 |
| `SIDEBAR_MAX_WIDTH` | `240` | `src/components/start/StartPageContent.vue:54` | 起始页内容区 |

**触界症状**：

- 监控页拖拽被硬卡在 `260`（`src/components/monitor/MonitorSidebar.vue:166`）与 `480`（`src/components/monitor/MonitorSidebar.vue:167`）之间。
- 起始页拖拽被硬卡在 `180`（`src/components/start/StartPageContent.vue:53`）与 `240`（`src/components/start/StartPageContent.vue:54`）之间。
- **若两个界面看起来“手感不一样”，这不是 bug**——这是两组不同常量导致的预期差异。排查时务必先确认当前界面属于哪一组，避免在错误的文件里改数值。

**解决方案**：

1. 拖不动时先确认当前页面，再定位到上表对应锚点。
2. 宽度不对时只改对应文件中的那一组常量，不要跨文件统一（两组边界各自独立）。

---

### 3.8 背景图透明度下限

**问题描述**：拖动背景图透明度滑块到底后，背景图“消失”了。

**原因分析**：

| 常量 | 值 | 锚点 |
| --- | --- | --- |
| `MIN_BACKGROUND_OPACITY` | `0.05` | `src/lib/backgroundImage.ts:9` |

**触界症状**：滑块拖到最左端时停在 `0.05`（`src/lib/backgroundImage.ts:9`），背景图几乎不可见但**并未被移除**。视觉上像是“关了背景”，实际是下限保护生效。

**解决方案**：

1. 先确认背景图仍被设置（设置入口在设置页，背景图处理逻辑集中在 `src/lib/backgroundImage.ts`）。
2. 若确实需要完全隐藏，应通过关闭背景图开关而不是继续往下拖。
3. 排查“背景图不显示”时，先排除是否只是透明度接近下限。

---

### 3.9 入口与模块解析

**问题描述**：应用启动即白屏，或某个 store / i18n / 动效模块未初始化导致运行时报错。

**原因分析**：应用由以下入口文件驱动，任一环节初始化顺序错误都会在启动阶段暴露：

| 入口文件 | 职责定位（依据命名与路径） |
| --- | --- |
| `src/main.ts` | 应用主入口（引入 `@tauri-apps/api`、`pinia`、`tw-animate-css`） |
| `src/i18n/index.ts` | 国际化初始化入口 |
| `src/lib/motion/index.ts` | 动效库入口（引入 `gsap`） |
| `src/lib/sessions/index.ts` | 会话层入口 |
| `src/stores/config/index.ts` | 配置 store 入口 |

其中 `src/main.ts` 同时是 `pinia`、`@tauri-apps/api`、`tw-animate-css` 的 import 点，是最关键的启动结点。

**解决方案**：

1. 白屏时先打开 devtools 看第一条报错，再按上表从 `src/main.ts` 开始逐个确认入口是否被执行。
2. 配置相关问题优先查 `src/stores/config/index.ts` 与 `src/stores/config/store.ts`（后者是 `pinia` 与 `yaml` 的 import 点，见 §5 表）。
3. 启动期命令相关行为异常时，注意 `src/services/commands.ts` 是变更最频繁的文件（见 §3.10）。

---

### 3.10 高频变更热点带来的回归风险

以下文件是变更统计中提交次数较多的区域（`intent` 中的 `git-churn` 证据）。排障时若问题落在这些区域，应优先怀疑最近一次改动引入的回归。

| 文件 | 提交次数 | 最近一次变更锚点 |
| --- | --- | --- |
| `src/services/commands.ts` | 14 | `commit:be02b631 (2026-09-29)`「feat: 新增分组感知的标签页切换器」 |
| `src/stores/tabs.ts` | 12 | `commit:be02b631 (2026-09-29)`「feat: 新增分组感知的标签页切换器」 |
| `src/lib/colorSchemes.ts` | 4 | `commit:e8315896 (2026-09-16)`「feat: 新增配色方案独立设置页，按首字母分组折叠展示并支持方案预览」 |
| `src/lib/sessions/sshSession.ts` | 4 | `commit:432d9996 (2026-09-18)`「feat: 新增 SSH keyboard-interactive 认证与动态凭据弹窗（记住密码回存）」 |
| `src-tauri/src/fsutil.rs` | 4 | `commit:c81c17e5 (2026-09-19)`「feat: 接入自动更新链路」 |

**问题描述**：标签页切换/分组、配色方案展示、SSH 交互式认证与凭据弹窗、文件读写与自动更新链路这几类功能出现异常。

**原因分析**：

- 标签页相关：`src/services/commands.ts`（14 次提交）与 `src/stores/tabs.ts`（12 次提交）是同一功能演进（分组感知标签页切换器）的两个协同变更点，改动其一容易漏改另一个。
- 配色方案：`src/lib/colorSchemes.ts` 在引入独立设置页后经历多轮调整，展示逻辑与数据定义耦合度较高。
- SSH 认证：`src/lib/sessions/sshSession.ts` 在引入 keyboard-interactive 认证与动态凭据弹窗后，凭据回存路径成为新风险面。
- 文件读写与更新：`src-tauri/src/fsutil.rs` 因接入自动更新链路被修改，属于跨前后端的接口边界。

**解决方案**：

1. 先确认问题是否出现在上述最近一次变更（锚点见上表）之后，用版本回退验证。
2. 标签页类问题同时检查 `src/services/commands.ts` 与 `src/stores/tabs.ts`，避免只改一侧。
3. 配色方案类问题以 `src/lib/colorSchemes.ts` 为单一入口排查。
4. 认证类问题从 `src/lib/sessions/sshSession.ts` 入手，先确认凭据弹窗是否正常唤起。
5. 更新/文件类问题注意横跨 `src/services/updater.ts`（前端，import `@tauri-apps/plugin-updater`、`@tauri-apps/plugin-process`）与 `src-tauri/src/fsutil.rs`（Rust 侧），两侧需同时排查。

---

## 4. 调试技巧

### 4.1 按入口文件分层定位

启动、配置、国际化、动效、会话五类问题分别从对应的入口文件切入，避免在无关目录里搜索：

```bash
# 主入口相关
bun run dev            # 浏览器内快速验证非 Tauri 依赖的逻辑
bun run app:dev        # 完整桌面环境（推荐，含原生插件）

# 排查入口链路时直接打开对应文件
# src/main.ts / src/i18n/index.ts / src/lib/motion/index.ts
# src/lib/sessions/index.ts / src/stores/config/index.ts
```

### 4.2 类型层快速反馈

```bash
bunx vue-tsc --noEmit          # 不打包，只做类型检查，秒级反馈
bun run build                  # 完整校验：vue-tsc --noEmit && vite build
```

修改 `.vue` 模板或 props 类型后，先跑 `bunx vue-tsc --noEmit` 再跑完整构建。

### 4.3 单文件测试调试

测试运行器为 `vitest`（`usageKind = test`，覆盖 35 处引用，典型锚点如下）：

| 测试文件 | 锚点 |
| --- | --- |
| `src/components/settings/groupDragSort.test.ts` | 分组拖拽排序逻辑 |
| `src/components/split/splitTree.test.ts` | 分屏树结构 |
| `src/components/terminal/searchFocus.test.ts` | 终端搜索焦点 |
| `src/components/titlebar/tabGroupLayout.test.ts` | 标签组布局 |
| `src/components/titlebar/tabStripLayout.test.ts` | 标签条布局 |

命令：

```bash
bun run test                                   # 全量：vitest run
bunx vitest run src/components/split/splitTree.test.ts   # 只跑单个文件
bunx vitest src/components/titlebar/tabGroupLayout.test.ts  # watch 模式
```

布局类问题（分屏、标签条/标签组、侧栏分组拖拽）优先在对应 `*.test.ts` 中写最小复现用例，比在界面上手拖更快定位。

### 4.4 Lint 与静态检查

```bash
bun run lint          # oxlint src
```

`oxlint` 为 `usageKind = script`（由 `scripts.lint` 调用），只扫描 `src` 目录。提交前跑一次可提前发现未使用 import 与可疑写法。

### 4.5 运行时日志的查看位置

- 前端日志：`bun run app:dev` 启动的窗口内右键 → 打开开发者工具 → Console。
- 生产行为对比：`bun run preview` 预览 `vite build` 的产物，确认问题是否只在开发模式出现。
- 终端渲染问题：从 `src/lib/frontends/xterm/renderer.ts`（WebGL/Canvas 后端选择）与 `src/lib/frontends/xterm/support.ts`（含 `MAX_WEBGL_RECOVERY_ATTEMPTS`，见 §3.1）两处着手查看渲染后端切换日志。
- 更新链路：`src/services/updater.ts` 是前端更新流程的唯一入口。

### 4.6 用常量作为排障边界

遇到“数量不对/拖不动/看不到”的问题时，先对照下表确认是否撞上了设计上限，避免把预期行为误判为 bug：

| 常量 | 值 | 锚点 | 触界语义 |
| --- | --- | --- | --- |
| `SIZE` | `1024` | `scripts/gen-icon.ts:7` | 图标源图基准尺寸 |
| `SIDEBAR_MIN_WIDTH` | `260` | `src/components/monitor/MonitorSidebar.vue:166` | 监控侧栏下限 |
| `SIDEBAR_MAX_WIDTH` | `480` | `src/components/monitor/MonitorSidebar.vue:167` | 监控侧栏上限 |
| `SIDEBAR_MIN_WIDTH` | `180` | `src/components/start/StartPageContent.vue:53` | 起始页下限 |
| `SIDEBAR_MAX_WIDTH` | `240` | `src/components/start/StartPageContent.vue:54` | 起始页上限 |
| `MAX_VISIBLE_ROWS` | `8` | `src/components/terminal/SuggestionMenu.vue:41` | 建议菜单可见行数 |
| `MIN_BACKGROUND_OPACITY` | `0.05` | `src/lib/backgroundImage.ts:9` | 背景图透明度下限 |
| `RESIZE_MIN_INTERVAL` | `32` | `src/lib/frontends/xterm/resize.ts:11` | resize 节流窗口 |
| `MAX_WEBGL_RECOVERY_ATTEMPTS` | `3` | `src/lib/frontends/xterm/support.ts:58` | WebGL 恢复次数上限 |
| `DEFAULT_MAX_PROMPT_JUMP` | `20` | `src/lib/suggestions/promptTracker.ts:125` | 提示符跳转深度 |
| `MAX_HISTORY_SAME_SOURCE` | `8` | `src/lib/suggestions/suggestionEngine.ts:11` | 同类历史候选上限 |
| `MAX_HISTORY_GLOBAL` | `4` | `src/lib/suggestions/suggestionEngine.ts:12` | 全局历史候选上限 |
| `MAX_QUICK_COMMANDS` | `4` | `src/lib/suggestions/suggestionEngine.ts:13` | 快捷命令上限 |
| `MAX_PATHS` | `8` | `src/lib/suggestions/suggestionEngine.ts:14` | 路径候选上限 |
| `MAX_TOTAL` | `16` | `src/lib/suggestions/suggestionEngine.ts:15` | 建议候选总数上限 |
| `INDEX_LIMIT` | `5000` | `src/services/history.ts:9` | 历史索引条目上限 |
| `MAX_SAMPLES` | `150` | `src/stores/monitor.ts:11` | 监控采样点数上限 |

---

## 5. 依赖使用锚点速查

排查“某个依赖到底用在哪”时按下表定位（全部来自 `depUsage` 使用证据）。

### 5.1 前端框架与状态（`usageKind = import`）

| 依赖 | 关键 import 锚点 | 引用数 |
| --- | --- | --- |
| `vue` | `src/App.vue`、`src/components/monitor/MetricChart.vue` 等 | 62 |
| `vue-i18n` | `src/App.vue`、`src/components/palette/CommandPalette.vue` 等 | 40 |
| `pinia` | `src/main.ts`、`src/stores/config/store.ts`、`src/stores/tabs.ts` 等 | 7 |
| `rxjs` | `src/lib/frontends/frontend.ts`、`src/lib/middleware/middleware.ts`、`src/lib/middleware/oscProcessing.ts` 等 | 7 |
| `yaml` | `src/stores/config/store.ts` | 1 |

### 5.2 UI 与工具库（`usageKind = import`）

| 依赖 | import 锚点 | 引用数 |
| --- | --- | --- |
| `lucide-vue-next` | `src/components/forwarding/ForwardRuleFormDialog.vue`、`src/components/monitor/MonitorSidebar.vue` 等 | 28 |
| `nanoid` | `src/components/settings/pages/KeysPage.vue`、`src/components/settings/pages/SshPage.vue` 等 | 12 |
| `reka-ui` | `src/components/ui/Label.vue`、`src/components/ui/Slider.vue` 等 | 4 |
| `class-variance-authority` | `src/components/ui/Button.vue` | 1 |
| `clsx` | `src/lib/utils.ts` | 1 |
| `tailwind-merge` | `src/lib/utils.ts` | 1 |
| `gsap` | `src/lib/motion/index.ts` | 1 |
| `deep-equal` | `src/lib/frontends/xterm/frontend.ts` | 1 |

### 5.3 终端与原生桥接（`usageKind = import`）

| 依赖 | import 锚点 |
| --- | --- |
| `@xterm/xterm` | `src/lib/frontends/xterm/frontend.ts`、`lines.ts`、`options.ts`、`renderer.ts`、`resize.ts` |
| `@xterm/addon-fit` | `src/lib/frontends/xterm/frontend.ts`、`src/lib/frontends/xterm/resize.ts` |
| `@xterm/addon-webgl` / `@xterm/addon-canvas` | `src/lib/frontends/xterm/renderer.ts` |
| `@xterm/addon-search` | `src/lib/frontends/xterm/search.ts` |
| `@xterm/addon-unicode11` / `@xterm/addon-web-links` | `src/lib/frontends/xterm/frontend.ts` |
| `@tauri-apps/api` | `src/main.ts`、`src/components/settings/pages/AboutPage.vue` 等（25 处） |

### 5.4 构建与工具链（非运行时代码）

| 依赖 | 使用方式 | 锚点 |
| --- | --- | --- |
| `vite` | `import` | `vite.config.ts` |
| `@vitejs/plugin-vue` | `import` | `vite.config.ts` |
| `@tailwindcss/vite` | `import` | `vite.config.ts` |
| `vue-tsc` | `script` | `scripts.build` |
| `oxlint` | `script` | `scripts.lint` |
| `vitest` | `test` | `src/components/split/splitTree.test.ts` 等 35 处 |
| `tailwindcss` | `import` | `src/assets/styles/main.css` |
| `@tauri-apps/cli` | `script` | `scripts.app:dev`（`tauri dev`）、`scripts.app:build`（`tauri build`） |
| `typescript` / `@types/node` / `@types/deep-equal` | 无源码 import 点（类型与工具链依赖，属正常） | — |

---

## 6. 待确认

以下方面在本次数据中未被覆盖，无法给出基于锚点的结论。遇到这些问题时需自行补充证据：

1. **Rust / Tauri 原生侧配置**：`src-tauri/` 下的依赖版本、`tauri.conf.json` 内容、以及原生插件的启用清单未提供。§1.2 与 §1.4 中关于“原生侧是否已启用对应插件”的判断无法在此确认，需要直接查看 `src-tauri/` 目录。
2. **Node 版本要求**：`nodeVersion` 字段为空，无法给出建议的 Node 运行时版本区间。本项目的包管理器为 `bun`（见 §1.1），但 Bun 版本要求同样未提供，需查看仓库中的版本声明文件。
3. **自动更新的服务端点与签名配置**：`src/services/updater.ts` 与 `src/components/settings/pages/AboutPage.vue` 是前端链路锚点，但更新源地址、公钥等配置未在数据中给出（相关变更锚点为 `commit:c81c17e5 (2026-09-19)`）。
## Related

- 同目录：[onboarding.md](onboarding.md) · [testing.md](testing.md)
- 共享 10 个源文件、共享 73 个符号：[tech-stack.md](../01-overview/tech-stack.md)
- 共享 9 个源文件、共享 51 个符号：[overview.md](../01-overview/overview.md)
- 共享 23 个符号：[environment.md](../01-overview/environment.md)
- 总入口：[README](../README.md)
