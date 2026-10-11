# 上手指南

<details>
<summary>Relevant source files</summary>

- package.json
- src-tauri/build.rs
- src-tauri/capabilities/default.json
- src-tauri/Cargo.toml
- src-tauri/src/background.rs
- src-tauri/src/config/groups.rs
- src-tauri/src/config/legacy.rs
- src-tauri/src/config/load.rs
- src-tauri/src/config/mod.rs
- src-tauri/src/lib.rs
- src-tauri/src/main.rs
- src/i18n/index.ts
- src/lib/frontendContext.ts
- src/lib/frontends/frontend.ts
- src/lib/frontends/xterm/frontend.ts
</details>

本页面向新加入的开发者，覆盖从环境准备、依赖安装、脚本使用到代码结构与开发流程的完整上手路径。所有事实均来自项目现有源码、配置与依赖引用数据。

---

## 1. 项目概览

- 项目类型：**前端项目**（`projectType: frontend`），且包含 Rust 侧源码目录与 Cargo 清单（`src-tauri/Cargo.toml`），属于 Tauri 桌面应用形态。
- 类型系统：启用 TypeScript（`hasTypeScript: true`）。
- 包管理器：**bun**（`packageManager: bun`）。
- 源码根目录：`src`（前端）与 `src-tauri`（Rust 侧）。

### 1.1 入口文件

以下文件被数据标记为入口文件（entryFiles）：

| 入口文件 | 说明与可锚定的引用证据 |
| --- | --- |
| `src/main.ts` | 前端启动入口；该文件中引用了 `pinia`、`tw-animate-css`、`@tauri-apps/api`（见 `src/main.ts`） |
| `src/App.vue` | 根组件；该文件中引用了 `vue`、`vue-i18n`（见 `src/App.vue`） |
| `src/i18n/index.ts` | 国际化模块入口 |
| `src/lib/motion/index.ts` | 动效模块入口；该文件中引用了 `gsap`（见 `src/lib/motion/index.ts`） |
| `src/lib/sessions/index.ts` | 会话模块入口 |
| `src/stores/config/index.ts` | 配置状态模块入口（同目录 `src/stores/config/store.ts` 引用了 `pinia`、`yaml`） |

---

## 2. 环境准备

### 2.1 必装项

| 组件 | 版本要求 | 作用 | 依据 |
| --- | --- | --- | --- |
| bun | 未在数据中约束版本 | 安装依赖、执行 `scripts` 中的全部脚本 | `packageManager: bun` |
| Rust 工具链 | 未在数据中约束版本 | 编译 `src-tauri` 下的 Rust 代码（Tauri 侧） | `src-tauri/Cargo.toml`、`src-tauri/build.rs` 存在 |
| Node.js | 待确认 | 提供 Vite / vue-tsc / vitest 等 JS 工具链运行时；数据中 `nodeVersion` 字段为空，未提供 engines 或版本文件约束 | `nodeVersion: ""` |

> 关于 Node.js 版本：数据未给出具体版本要求，请以本机已能运行 `bun run dev` 为准；如需锁定版本，需另行补充 `engines` 或版本管理文件（当前数据中不存在）。

### 2.2 依赖分组说明

依赖清单分为运行时依赖与开发期工具链两类：

| 类别 | 代表依赖 | 作用（均有引用点佐证） |
| --- | --- | --- |
| UI 框架 | `vue`、`reka-ui`、`lucide-vue-next`、`class-variance-authority` | `vue` 在 62 个文件中被引用（如 `src/App.vue`）；`reka-ui` 用于基础控件（如 `src/components/ui/Label.vue`、`src/components/ui/Slider.vue`）；`lucide-vue-next` 在 28 个文件中被引用（如 `src/components/monitor/MonitorSidebar.vue`）；`class-variance-authority` 用于按钮变体（`src/components/ui/Button.vue`） |
| 状态与配置 | `pinia`、`yaml`、`nanoid` | `pinia` 注册于 `src/main.ts`，并在 `src/stores/config/store.ts`、`src/stores/forwarding.ts`、`src/stores/monitor.ts`、`src/stores/tabs.ts` 中使用；`yaml` 用于配置文件解析（`src/stores/config/store.ts`）；`nanoid` 用于生成 ID（如 `src/components/settings/pages/KeysPage.vue`，共 12 个引用文件） |
| 国际化 | `vue-i18n` | 在 40 个文件中被引用（如 `src/App.vue`、`src/components/palette/CommandPalette.vue`） |
| 终端仿真 | `@xterm/xterm` 及 `@xterm/addon-*` | 核心在 `src/lib/frontends/xterm/` 下：`frontend.ts`、`renderer.ts`、`resize.ts`、`search.ts`、`lines.ts`、`options.ts`、`support.ts` |
| 响应式流 | `rxjs` | 在 `src/lib/frontends/frontend.ts`、`src/lib/frontends/xterm/frontend.ts`、`src/lib/middleware/middleware.ts`、`src/lib/middleware/oscProcessing.ts` 等 7 个文件中使用 |
| 桌面能力 | `@tauri-apps/api` 与各 `@tauri-apps/plugin-*` | API 在 25 个文件中被引用；插件分别为 clipboard-manager（`src/lib/frontendContext.ts`）、dialog（`src/components/settings/pages/BackupPage.vue` 等）、notification（`src/services/notifications.ts`）、opener（`src/components/sftp/TransferPopover.vue` 等）、process 与 updater（`src/services/updater.ts`） |
| 动效 | `gsap`、`tw-animate-css` | `gsap` 见 `src/lib/motion/index.ts`；`tw-animate-css` 见 `src/main.ts` |
| 样式工具 | `clsx`、`tailwind-merge`、`tailwindcss` | `clsx` 与 `tailwind-merge` 共同用于类名合并（`src/lib/utils.ts`）；`tailwindcss` 由 `src/assets/styles/main.css` 引入 |
| 构建工具链 | `vite`、`@vitejs/plugin-vue`、`@tailwindcss/vite` | 三者均在 `vite.config.ts` 中被引用 |
| 校验与测试 | `vue-tsc`、`oxlint`、`vitest` | `vue-tsc` 用于 `scripts.build` 的类型检查；`oxlint` 用于 `scripts.lint`；`vitest` 被 35 处测试文件引用（如 `src/components/split/splitTree.test.ts`） |

> `deep-equal` 在 `src/lib/frontends/xterm/frontend.ts` 中被引用；`@types/deep-equal`、`@types/node`、`typescript` 未出现在源码 import 中，属于类型/工具链支撑。

---

## 3. 安装步骤

项目使用 **bun** 作为包管理器，所有依赖安装与脚本执行均通过 bun 完成。

### 步骤 1：安装前端依赖

```bash
bun install
```

- 作用：读取 `package.json`（数据来源为依赖清单）并安装 `dependencies` / `devDependencies`，同时生成或更新 bun 锁文件。
- 预期输出：安装进度与安装包数量汇总，最终生成 `node_modules/`。
- 验证方法：确认 `node_modules/` 目录存在；随后执行 `bun run dev`，Vite 开发服务器应能启动（`scripts.dev` 为 `vite`）。

### 步骤 2：准备 Rust 侧依赖

Rust 依赖由 Cargo 在构建时自动拉取，无需手动 `cargo add`：

```bash
bun run app:dev
```

- 作用：执行 `tauri dev`，首次运行会依据 `src-tauri/Cargo.toml` 下载并编译 Rust 依赖，`src-tauri/build.rs` 作为构建脚本参与编译。
- 预期输出：Cargo 编译日志 + Tauri 应用窗口启动。
- 验证方法：应用窗口成功打开即表示 Rust 侧环境配置正确。

### 步骤 3：验证工具链完整性

```bash
bun run lint
bun run test
```

- `bun run lint` 对应 `oxlint src`，仅扫描 `src` 目录。
- `bun run test` 对应 `vitest run`，执行单次测试（非 watch 模式）。

---

## 4. 项目初始化

数据中的 `cliCommands` 为空数组，即**项目未提供自定义 CLI 命令**。因此初始化流程完全依赖 `scripts` 中定义的脚本，不存在需要额外调用的初始化子命令。

| 场景 | 命令 | 说明 |
| --- | --- | --- |
| 仅启动前端 | `bun run dev` | 等价于 `vite`，拉起 Vite 开发服务器 |
| 启动完整桌面应用 | `bun run app:dev` | 等价于 `tauri dev`，包含 Rust 编译与窗口启动，是日常开发的推荐入口 |
| 前端产物预览 | `bun run preview` | 等价于 `vite preview`，用于预览已构建的产物 |

---

## 5. 基本使用

### 5.1 脚本清单

以下命令全部直接来自项目 `scripts` 定义：

```bash
# 开发：仅前端（Vite Dev Server）
bun run dev

# 开发：完整桌面应用（Tauri + Rust 编译）
bun run app:dev

# 构建：先做类型检查，再打包前端
bun run build

# 构建：打包桌面应用安装包
bun run app:build

# 预览构建产物
bun run preview

# 静态检查（仅 src 目录）
bun run lint

# 运行测试（单次执行）
bun run test
```

对应的脚本定义：

| 脚本名 | 实际命令 |
| --- | --- |
| `dev` | `vite` |
| `build` | `vue-tsc --noEmit && vite build` |
| `preview` | `vite preview` |
| `app:dev` | `tauri dev` |
| `app:build` | `tauri build` |
| `lint` | `oxlint src` |
| `test` | `vitest run` |

### 5.2 典型工作流

**日常开发（推荐）**

1. `bun run app:dev` —— 启动桌面应用，前端热更新 + Rust 侧编译。
2. 修改 `src/` 下代码 —— Vite 自动热更新。
3. 修改 `src-tauri/` 下代码 —— 由 `tauri dev` 触发重新编译。

**提交前校验**

1. `bun run lint` —— 静态检查 `src` 目录（注意：不覆盖 `src-tauri`）。
2. `bun run test` —— 执行 `src/components/**` 下的 Vitest 用例（如 `src/components/settings/groupDragSort.test.ts`、`src/components/split/splitTree.test.ts`、`src/components/terminal/searchFocus.test.ts`、`src/components/titlebar/tabGroupLayout.test.ts`、`src/components/titlebar/tabStripLayout.test.ts`）。
3. `bun run build` —— `vue-tsc --noEmit` 先做全量类型检查，通过后才执行 `vite build`；类型错误会直接中断流程。

**发布**

1. `bun run build` —— 确认前端类型与打包均无问题。
2. `bun run app:build` —— 由 `tauri build` 产出桌面应用安装包。

---

## 6. 环境变量

数据中提供的环境变量均为构建期变量，且集中在 `vite.config.ts` 中被引用：

| 变量名 | 是否敏感 | 生产引用文件 |
| --- | --- | --- |
| `TAURI_ENV_HOST` | 否 | `vite.config.ts` |
| `TAURI_ENV_DEBUG` | 否 | `vite.config.ts` |

说明：

- 两个变量均非敏感信息，无需通过密钥管理注入。
- 二者仅在构建配置 `vite.config.ts` 中被引用，未出现在 `src/` 或 `src-tauri/` 源码中，因此属于构建/打包阶段的开关类变量。

---

## 7. 项目结构概览

### 7.1 `src/` —— 前端（Vue 3 + TypeScript）

| 子路径 | 作用 | 数据中可见的真实文件样本 |
| --- | --- | --- |
| `src/`（根） | 应用入口与根组件 | `src/App.vue`、`src/main.ts` |
| `src/assets/styles/` | 全局样式与调色板样式 | `src/assets/styles/main.css`、`src/assets/styles/palette.css` |
| `src/components/forwarding/` | 端口转发相关界面 | `src/components/forwarding/ForwardRuleFormDialog.vue`、`src/components/forwarding/ForwardingTabContent.vue`、`src/components/forwarding/ForwardingTabContent.css` |
| `src/components/monitor/` | 指标监控界面 | `src/components/monitor/MetricChart.vue`、`src/components/monitor/MonitorSidebar.vue` |
| `src/components/settings/` | 设置页，按功能分页 | `src/components/settings/pages/AboutPage.vue`、`AppearancePage.vue`、`KeysPage.vue`、`BackupPage.vue`、`LocalProfilesPage.vue`、`QuickCommandsPage.vue`、`SshPage.vue`、`TabGroupsPage.vue`；另有 `src/components/settings/ColorSchemePicker.vue`、`src/components/settings/GroupAccordion.vue` |
| `src/components/sftp/` | SFTP 浏览与传输 | `src/components/sftp/SftpTabContent.vue`、`src/components/sftp/SftpBrowserPane.vue`、`src/components/sftp/TransferPopover.vue` |
| `src/components/ui/` | 通用基础控件 | `src/components/ui/Button.vue`、`Label.vue`、`Separator.vue`、`Slider.vue`、`Switch.vue` |
| `src/components/palette/` | 命令面板 | `src/components/palette/CommandPalette.vue` |
| `src/components/split/` | 分屏相关逻辑与测试 | `src/components/split/splitTree.test.ts` |
| `src/components/terminal/` | 终端界面逻辑与测试 | `src/components/terminal/searchFocus.test.ts` |
| `src/components/titlebar/` | 标题栏/标签页布局与测试 | `src/components/titlebar/tabGroupLayout.test.ts`、`src/components/titlebar/tabStripLayout.test.ts` |
| `src/lib/` | 与 UI 无关的核心逻辑层 | `src/lib/utils.ts`、`src/lib/frontendContext.ts` |
| `src/lib/frontends/` | 终端前端抽象层 | `src/lib/frontends/frontend.ts` |
| `src/lib/frontends/xterm/` | xterm 具体实现（渲染、尺寸、搜索、行处理等） | `src/lib/frontends/xterm/frontend.ts`、`renderer.ts`、`resize.ts`、`search.ts`、`lines.ts`、`options.ts`、`support.ts` |
| `src/lib/middleware/` | 终端数据中间件与 OSC 处理 | `src/lib/middleware/middleware.ts`、`src/lib/middleware/oscProcessing.ts` |
| `src/lib/motion/` | 动效封装（基于 gsap） | `src/lib/motion/index.ts` |
| `src/lib/sessions/` | 会话模块 | `src/lib/sessions/index.ts` |
| `src/services/` | 系统级服务封装 | `src/services/notifications.ts`（通知）、`src/services/updater.ts`（进程与更新） |
| `src/stores/` | Pinia 状态仓库 | `src/stores/config/index.ts`、`src/stores/config/store.ts`、`src/stores/forwarding.ts`、`src/stores/monitor.ts`、`src/stores/tabs.ts` |
| `src/i18n/` | 国际化资源与实例 | `src/i18n/index.ts` |

### 7.2 `src-tauri/` —— Rust 侧（Tauri 后端）

| 子路径 | 作用 | 数据中可见的真实文件样本 |
| --- | --- | --- |
| `src-tauri/`（根） | Cargo 清单与构建脚本 | `src-tauri/Cargo.toml`、`src-tauri/build.rs` |
| `src-tauri/capabilities/` | Tauri 权限能力配置 | `src-tauri/capabilities/default.json` |
| `src-tauri/src/` | Rust 源码根 | `src-tauri/src/background.rs`（后台任务） |
| `src-tauri/src/config/` | 配置加载、迁移与分组 | `src-tauri/src/config/mod.rs`、`src-tauri/src/config/load.rs`、`src-tauri/src/config/legacy.rs`（历史配置兼容）、`src-tauri/src/config/groups.rs` |

> `src-tauri/src/main.rs`、`src-tauri/src/lib.rs` 未出现在给出的文件样本中，其具体入口组织方式见文末「待确认」。

---

## 8. 开发指南

### 8.1 构建

```bash
# 前端构建（含类型检查）
bun run build      # vue-tsc --noEmit && vite build

# 桌面应用打包
bun run app:build  # tauri build
```

- `bun run build` 会先执行 `vue-tsc --noEmit` 做全量类型检查，类型错误会阻止后续 `vite build`。
- 构建产物可用 `bun run preview`（`vite preview`）进行本地预览。

### 8.2 运行测试

```bash
bun run test   # vitest run，单次执行后退出
```

现有测试用例集中在组件层，文件命名均为 `*.test.ts`：

- `src/components/settings/groupDragSort.test.ts`
- `src/components/split/splitTree.test.ts`
- `src/components/terminal/searchFocus.test.ts`
- `src/components/titlebar/tabGroupLayout.test.ts`
- `src/components/titlebar/tabStripLayout.test.ts`

### 8.3 静态检查

```bash
bun run lint   # oxlint src
```

作用范围为 `src` 目录；`src-tauri` 下的 Rust 代码不在该检查范围内。

### 8.4 开发调试

- 只调试前端渲染逻辑时使用 `bun run dev`（Vite Dev Server），启动更快。
- 涉及 Tauri API（`@tauri-apps/api`）、插件能力（dialog / updater / notification / opener 等）或 `src-tauri/` 逻辑时，必须使用 `bun run app:dev`，因为 `bun run dev` 不会编译 Rust 侧。
- `vite.config.ts` 中引用了 `TAURI_ENV_DEBUG` 与 `TAURI_ENV_HOST`，说明构建配置会区分 Tauri 调试模式与运行主机环境。

---

## 9. 待确认

| 项 | 缺失的证据 |
| --- | --- |
| Node.js 版本要求 | 数据中 `nodeVersion` 为空，未提供 `engines`、`.nvmrc` 等版本约束信息 |
| Rust 侧入口组织方式 | `src-tauri/src/main.rs` / `lib.rs` 未出现在 `sourceDirFiles` 样本中，Tauri 命令注册与插件初始化的具体位置无法确定 |
| 自定义 CLI 命令 | `cliCommands` 为空数组，若项目存在自建 CLI 入口，数据中未体现 |
| Tauri 权限范围 | `src-tauri/capabilities/default.json` 的具体能力项未在数据中展开，无法列出启用的插件权限清单 |
## Related

- 同目录：[testing.md](testing.md) · [troubleshooting.md](troubleshooting.md)
- 共享 9 个源文件、共享 73 个符号：[overview.md](../01-overview/overview.md)
- 共享 4 个源文件、共享 63 个符号：[tech-stack.md](../01-overview/tech-stack.md)
- 共享 1 个源文件、共享 32 个符号：[environment.md](../01-overview/environment.md)
- 总入口：[README](../README.md)
