# 项目概述

## 是什么

scx-terminal 是一个 macOS 桌面终端应用（Tauri v2 + Vue 3 + @xterm/xterm 5.5），界面与功能对标 Tabby，核心模块移植自 Tabby 源码树（`tabby-terminal` / `tabby-local` / `tabby-electron` / `tabby-core`，文件头注释中均有标注）。它不是 Web 应用：所有 shell 会话由 Rust 后端通过 `portable-pty` 在真实 PTY 中运行，前端与后端仅通过 Tauri IPC 通信。

## 当前功能清单

| 功能 | 状态 | 关键代码 |
| --- | --- | --- |
| 本地终端（zsh/bash 等，取自 `/etc/shells`），默认以登录 shell（`-l`）启动 | 可用 | `src/lib/sessions/localSession.ts`、`src-tauri/src/pty.rs` |
| 多标签（后台标签保持会话运行，`v-show` 不卸载；中键关闭、拖拽排序） | 可用 | `src/stores/tabs.ts`、`src/App.vue` |
| 标签右键菜单：重命名（手动标题优先于 OSC 上报）、关闭其他、颜色标记 | 可用 | `src/components/titlebar/TitleBar.vue`、`src/components/ui/ContextMenu.vue` |
| 分屏（水平/垂直、拖拽调整比例、键盘导航） | 可用 | `src/components/split/` |
| 终端内右键菜单（复制/粘贴/全选/清屏/搜索/分屏/关窗格） | 可用 | `src/components/terminal/TerminalPane.vue` |
| 标签标题跟随 shell OSC 0/2 上报 | 可用 | `TerminalPane.vue` → `frontend.title$` |
| 终端内搜索 | 可用 | `@xterm/addon-search` + `TerminalPane.vue` 搜索条 |
| 复制/粘贴（Tauri 剪贴板插件，降级 `navigator.clipboard`） | 可用 | `src/lib/frontendContext.ts` |
| OSC 52 剪贴板写入（base64 解码 + 100KB 上限，只写不读） | 可用 | `src/lib/middleware/oscProcessing.ts` |
| 可点击 URL（WebLinks addon + opener 插件；OSC 8 由 xterm 核心支持） | 可用 | `src/lib/frontends/xtermFrontend.ts` |
| 命令面板（模糊搜索）+ 可配置热键（加载时对旧键名做归一化） | 可用 | `src/components/palette/CommandPalette.vue`、`src/services/` |
| 配色主题：16 套内置配色 + 界面跟随配色 + 亮暗跟随系统 | 可用 | `src/lib/colorSchemes.ts`、`src/lib/schemeColors.ts`、`src/stores/theme.ts` |
| 设置页（终端/外观/快捷键/关于），YAML 持久化；含退格行为、输入/输出换行转换、wordSeparator、粗体亮色、登录 shell 开关 | 可用 | `src/components/settings/SettingsView.vue`、`src/stores/config.ts` |
| 退格重映射与换行转换中间件（会话构造期按配置挂载，对新标签生效） | 可用 | `src/lib/sessions/baseSession.ts`、`src/lib/middleware/{inputProcessing,streamProcessing}.ts` |
| 中英双语（跟随系统） | 可用 | `src/i18n/index.ts` |
| 工作目录跟踪（OSC 1337 CurrentDir 解析） | 管道就绪，无消费方 | `src/lib/middleware/oscProcessing.ts` |

## 技术栈

**前端**（`package.json`）：Vue 3.5、Pinia 4、rxjs 7（会话/前端事件流全部基于 Subject）、@xterm/xterm 5.5（addon-canvas / webgl / fit / search / unicode11）、Tailwind CSS 4（`@theme inline` token 体系）、reka-ui + class-variance-authority（UI 组件）、vue-i18n 11、yaml、nanoid。构建 Vite 8（端口 1420，`strictPort`，别名 `@` → `src/`），类型检查 `vue-tsc`，Lint `oxlint`，测试 `vitest`（node 环境）。

**后端**（`src-tauri/Cargo.toml`）：tauri 2（feature `macos-private-api`）、portable-pty 0.9、tauri-plugin-opener、tauri-plugin-clipboard-manager、serde/serde_json、uuid。Release profile：`lto`、`opt-level = "s"`、`strip`。

**语言分布**（来自 codebase-memory 索引）：TypeScript 37 文件、Vue 15、Rust 6。

## 已知限制与未接线功能

- 配置键 `appearance.theme`、`appearance.tabBarPosition`、`terminal.lineHeightAdjustment` 无任何读取方（死键，保留以稳定配置结构）。
- `terminal.paletteGenerate` / `paletteHarmonious`（256 色扩展调色板生成，`src/lib/generatePalette.ts`）有效但未暴露到设置 UI。
- `terminal.fontWeight` / `fontWeightBold` / `wordSeparator` / `drawBoldTextInBrightColors` 由 xterm 消费；后两者已上设置 UI，字重两项仍无 UI。
- cwd 跟踪管道（`BaseSession.reportedCWD` → `getWorkingDirectory()`）无调用方；新标签不会继承工作目录（需要 shell 集成脚本上报才有数据源）。
- 自定义配色编辑器、iTerm2 配色导入、字体列表选择器未实现（当前仅内置配色 + 下拉选择、字体为自由文本输入）。
- Profiles 多配置档案（多 shell/命令档案、按档案新建标签）未实现——`LocalSession.start` 已支持 command/args/env/cwd，缺存储与 UI；为 SSH 预留 `type` 判别字段扩展点。
- 窗口 vibrancy/透明已写代码但被 `#[cfg(any())]` 编译关闭（`src-tauri/src/lib.rs`，WKWebView 下渲染空白，待主题阶段重试）。
- 终端粘贴仍固定做 `\r\n → \n` 归一化（`TerminalPane.vue`），叠加在 `inputNewlines` 转换之前，防多行粘贴被 shell 逐行执行。

## 起源与设计文档

初始版本为一次性交付（git 历史仅一个初始化提交 + 后续修复提交），设计文档见 `docs/superpowers/specs/2026-09-12-scx-terminal-tauri-design.md`（Phase 0–7 MVP）。

## Related

- [architecture](architecture.md)
- [04-guides/development](../04-guides/development.md)
- `AGENTS.md`（仓库根）
