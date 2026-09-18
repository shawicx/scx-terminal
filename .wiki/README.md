# scx-terminal 项目 Wiki

基于仓库真实代码生成的项目知识库，供 AI 与开发人员共用。修改代码前请先阅读本 Wiki。

## 项目一句话

scx-terminal 是一个用 **Tauri v2 + Vue 3 + xterm.js** 构建的 macOS 桌面终端应用，架构与交互对标 Tabby（大量模块移植自 tabby-* 源码树）：本地 shell 通过 Rust 侧 portable-pty 运行，前端负责渲染、分屏、主题、热键与配置。

## 阅读路径

- 新人/AI onboarding：[01-overview/project-overview](01-overview/project-overview.md) → [01-overview/architecture](01-overview/architecture.md) → [04-guides/key-flows](04-guides/key-flows.md)
- 改终端渲染 / 输入：[02-frontend/terminal-rendering](02-frontend/terminal-rendering.md) + [02-frontend/sessions-and-middleware](02-frontend/sessions-and-middleware.md)
- 改 PTY / Rust 侧：[03-backend/pty-lifecycle](03-backend/pty-lifecycle.md)
- 改主题 / 配置：[02-frontend/config-and-theming](02-frontend/config-and-theming.md)
- 查 IPC 契约：[05-reference/ipc-reference](05-reference/ipc-reference.md)

## 目录

```text
.wiki/
├── README.md                        本文件：入口与导航
├── 01-overview/
│   ├── project-overview.md          项目定位、功能清单、技术栈、已知限制
│   └── architecture.md              三层架构、模块边界、数据流总览
├── 02-frontend/
│   ├── app-shell-and-tabs.md        应用外壳：App/TitleBar/TabStrip/标签 store/命令面板
│   ├── terminal-rendering.md        xterm 前端：attach、配色应用、resize、搜索
│   ├── sessions-and-middleware.md   会话层：Base/Local/SSH Session、中间件、PTY 代理
│   ├── split-panes.md               分屏：不可变树模型与容器渲染
│   ├── config-and-theming.md        配置持久化（SQLite config.db 差异 flush）与主题
│   └── hotkeys-and-commands.md      热键状态机与命令注册表
├── 03-backend/
│   ├── pty-lifecycle.md             Rust PTY：spawn、读线程、背压、kill/清理
│   ├── commands-and-config.md       命令注册、SQLite 配置库、shell 探测
│   └── capabilities-and-window.md   tauri.conf、capabilities、窗口与安全
├── 04-guides/
│   ├── development.md               环境要求、命令、测试、常见坑
│   └── key-flows.md                 核心调用链：键盘输入、输出、新建标签、主题切换
└── 05-reference/
    └── ipc-reference.md             Tauri IPC 命令与事件总表
```

## 相关文档

- 仓库根 `AGENTS.md` — AI 修改代码必须遵守的项目规则（依赖管理、注释规范、Tauri 约束）
- 仓库根 `README.md`
- `docs/superpowers/specs/2026-09-12-scx-terminal-tauri-design.md` — 初始设计文档（Phase 0–7 交付记录）
