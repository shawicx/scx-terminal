# 上手指南

<details>
<summary>Relevant source files</summary>

- src-tauri/Cargo.toml
- src-tauri/build.rs
- src-tauri/capabilities/default.json
- src-tauri/src/background.rs
- src-tauri/src/config/groups.rs
- src-tauri/src/config/legacy.rs
- src-tauri/src/config/load.rs
- src-tauri/src/config/mod.rs
- src/components/split/splitTree.test.ts
- src/components/terminal/searchFocus.test.ts
- src/components/titlebar/tabGroupLayout.test.ts
- src/components/titlebar/tabStripLayout.test.ts
- src/i18n/index.ts
- src/lib/backgroundImage.test.ts
- src/lib/frontendContext.ts
</details>

本页面向新加入的开发者，基于仓库实际数据说明该 Tauri + Vue 3 桌面项目的环境准备、安装流程、可用脚本命令、目录职责与开发工作流。

项目类型为 **frontend**（含 TypeScript），包管理器为 **bun**，源码目录为 `src`（Vue 3 前端）与 `src-tauri`（Rust 侧构建与能力配置）。

---

## 1. 技术栈与依赖证据

技术栈来自项目依赖清单，下表列出各依赖在源码中的实际导入点（`depUsage.importFiles` 为数据中提供的证据路径）。

| 领域 | 依赖 | 使用证据（导入文件锚点） |
| --- | --- | --- |
| 前端框架 | `vue` | `src/App.vue`、`src/main.ts`（共 60 处导入） |
| 状态管理 | `pinia` | `src/main.ts`、`src/stores/config/store.ts`、`src/stores/forwarding.ts`、`src/stores/monitor.ts`、`src/stores/tabs.ts` |
| 国际化 | `vue-i18n` | `src/App.vue`、`src/components/forwarding/ForwardRuleFormDialog.vue`、`src/components/monitor/MonitorSidebar.vue`、`src/components/palette/CommandPalette.vue` |
| 终端内核 | `@xterm/xterm` | `src/lib/frontends/xterm/frontend.ts`、`lines.ts`、`options.ts`、`renderer.ts`、`resize.ts` |
| 终端插件 | `@xterm/addon-fit` | `src/lib/frontends/xterm/frontend.ts`、`src/lib/frontends/xterm/resize.ts` |
| 终端插件 | `@xterm/addon-canvas`、`@xterm/addon-webgl` | `src/lib/frontends/xterm/renderer.ts` |
| 终端插件 | `@xterm/addon-search` | `src/lib/frontends/xterm/search.ts` |
| 终端插件 | `@xterm/addon-unicode11`、`@xterm/addon-web-links` | `src/lib/frontends/xterm/frontend.ts` |
| 流式处理 | `rxjs` | `src/lib/frontends/frontend.ts`、`src/lib/frontends/xterm/frontend.ts`、`src/lib/frontends/xterm/support.ts`、`src/lib/middleware/middleware.ts`、`src/lib/middleware/oscProcessing.ts` |
| Tauri 桥接 | `@tauri-apps/api` | `src/main.ts`、`src/components/settings/pages/AboutPage.vue`、`src/components/settings/pages/AppearancePage.vue`、`src/components/settings/pages/KeysPage.vue`、`src/components/sftp/SftpTabContent.vue` |
| Tauri 插件 | `@tauri-apps/plugin-dialog` | `src/components/settings/pages/AppearancePage.vue`、`src/components/settings/pages/BackupPage.vue`、`src/components/sftp/SftpBrowserPane.vue` |
| Tauri 插件 | `@tauri-apps/plugin-opener` | `src/components/settings/pages/AboutPage.vue`、`src/components/sftp/SftpBrowserPane.vue`、`src/components/sftp/TransferPopover.vue`、`src/lib/frontends/xterm/support.ts` |
| Tauri 插件 | `@tauri-apps/plugin-updater` | `src/components/settings/pages/AboutPage.vue`、`src/services/updater.ts` |
| Tauri 插件 | `@tauri-apps/plugin-process` | `src/services/updater.ts` |
| Tauri 插件 | `@tauri-apps/plugin-notification` | `src/services/notifications.ts` |
| Tauri 插件 | `@tauri-apps/plugin-clipboard-manager` | `src/lib/frontendContext.ts` |
| UI 基础组件 | `reka-ui` | `src/components/ui/Label.vue`、`src/components/ui/Separator.vue`、`src/components/ui/Slider.vue`、`src/components/ui/Switch.vue` |
| 图标 | `lucide-vue-next` | `src/components/forwarding/ForwardRuleFormDialog.vue`、`src/components/forwarding/ForwardingTabContent.vue`、`src/components/monitor/MonitorSidebar.vue`、`src/components/settings/ColorSchemePicker.vue`、`src/components/settings/GroupAccordion.vue`（共 28 处） |
| 样式原子化 | `tailwindcss` | `src/assets/styles/main.css` |
| 动画 | `gsap` | `src/lib/motion/index.ts` |
| ID 生成 | `nanoid` | `src/components/settings/pages/KeysPage.vue`、`LocalProfilesPage.vue`、`QuickCommandsPage.vue`、`SshPage.vue`、`TabGroupsPage.vue`（共 12 处） |
| 序列化 | `yaml` | `src/stores/config/store.ts` |
| 样式工具 | `clsx`、`tailwind-merge` | `src/lib/utils.ts` |
| 变体工具 | `class-variance-authority` | `src/components/ui/Button.vue` |
| 深比较 | `deep-equal` | `src/lib/frontends/xterm/frontend.ts` |
| 过渡样式 | `tw-animate-css` | `src/main.ts` |
| 构建 | `vite`、`@vitejs/plugin-vue`、`@tailwindcss/vite` | `vite.config.ts` |
| 测试 | `vitest` | `src/lib/backgroundImage.test.ts` 等测试文件（共 33 处，usageKind=test） |

---

## 2. 环境准备

| 环境项 | 要求 | 依据 / 说明 |
| --- | --- | --- |
| 包管理器 | **bun** | 项目 `packageManager` 字段为 `bun`，安装与脚本执行统一使用 bun，不使用 npm/yarn/pnpm |
| Node.js | **待确认**：数据中 `nodeVersion` 字段为空，未声明最低/推荐版本 | Vite、Vitest 基于 Node 运行，安装前请按团队约定确认版本；这是本页唯一影响安装决策的缺口 |
| Rust / Cargo 工具链 | 需要 | `src-tauri/Cargo.toml`、`src-tauri/build.rs` 存在，`app:dev` / `app:build`（tauri dev/build）会编译 Rust 侧代码 |
| 前端运行时依赖 | 由 `bun install` 安装 | 见上文依赖表 |
| 环境变量 | `TAURI_ENV_HOST`、`TAURI_ENV_DEBUG` | 见「环境变量」章节 |

各依赖的作用以其在源码中的导入点为准，例如 `src/lib/utils.ts` 导入 `clsx` 与 `tailwind-merge`（用于类名合并），`src/stores/config/store.ts` 导入 `yaml`（配置序列化/解析），`src/services/updater.ts` 导入 `@tauri-apps/plugin-updater` 与 `@tauri-apps/plugin-process`（更新流程）。

---

## 3. 安装步骤

1. **确认 bun 可用**

   ```bash
   bun --version
   ```

   预期输出：bun 的版本号字符串。若命令不存在，需先按 bun 官方方式安装包管理器。

2. **安装前端依赖**

   ```bash
   bun install
   ```

   预期输出：解析依赖并生成/更新 `node_modules` 与锁文件，末尾打印安装包数量与耗时。

   **验证方法**：确认仓库根目录出现 `node_modules`，且无 error 级别日志。

3. **（首次运行桌面端时）安装 Rust 侧依赖**

   ```bash
   bun run app:dev
   ```

   Tauri 在首次执行 `tauri dev` 时根据 `src-tauri/Cargo.toml` 拉取并编译 Rust 依赖（由 `src-tauri/build.rs` 参与构建）。预期输出：Cargo 编译进度 + 应用窗口启动。此步耗时较长，属正常现象。

4. **验证安装结果**

   ```bash
   bun run dev
   ```

   预期输出：Vite 开发服务器启动，并打印本地访问地址（Vite 默认端口为 5173）。

---

## 4. 项目初始化

数据中 `cliCommands` 为**空数组**，即本项目未提供自定义 CLI 命令（无自研脚手架/生成器命令）。初始化流程即为上述 `bun install` 加项目脚本，脚本定义如下（来源：项目 `scripts` 配置）：

| 脚本 | 实际命令 | 作用 | 使用场景 |
| --- | --- | --- | --- |
| `dev` | `vite` | 启动前端开发服务器 | 纯前端页面调试 |
| `build` | `vue-tsc --noEmit && vite build` | 先做 TypeScript 类型检查，再产物构建 | 出包前自检、CI 构建 |
| `preview` | `vite preview` | 本地预览构建产物 | 验证 `build` 结果 |
| `app:dev` | `tauri dev` |

启动 Tauri 桌面应用（开发模式） | 调试前后端交互、终端、SFTP 等需要 Rust 侧能力的功能 |
| `app:build` | `tauri build` | 构建桌面应用安装包 | 发布/打包 |
| `lint` | `oxlint src` | 静态检查 `src` 目录 | 提交前代码检查 |
| `test` | `vitest run` | 单次运行单元测试 | 本地验证、CI 测试 |

调用方式统一为 `bun run <脚本名>`，例如 `bun run app:dev`。

---

## 5. 基本使用

### 5.1 核心命令

```bash
# 安装依赖
bun install

# 前端开发服务器（浏览器可访问）
bun run dev

# 桌面应用开发模式（含 Rust 侧编译）
bun run app:dev

# 类型检查 + 生产构建
bun run build

# 预览构建产物
bun run preview

# 桌面应用打包
bun run app:build

# 代码检查
bun run lint

# 运行测试
bun run test
```

以上命令均直接来自项目 `scripts` 配置，无待确认项。

### 5.2 典型工作流

| 阶段 | 命令 | 说明 |
| --- | --- | --- |
| 1. 拉取代码后安装 | `bun install` | 安装前端依赖 |
| 2. 类型自检 + 构建 | `bun run build` | `vue-tsc --noEmit` 先行，类型不通过则中断，随后执行 `vite build` |
| 3. 检查 | `bun run lint` | 对 `src` 目录执行 oxlint |
| 4. 测试 | `bun run test` | vitest 单次运行，测试文件示例见 `src/lib/backgroundImage.test.ts`、`src/components/split/splitTree.test.ts` |
| 5. 本地验证产物 | `bun run preview` | 预览 `vite build` 输出 |
| 6. 调试整机功能 | `bun run app:dev` | 需要 Tauri 插件能力（如 `src/services/notifications.ts`、`src/services/updater.ts`）时使用 |
| 7. 打包发布 | `bun run app:build` | 产出桌面安装包 |

### 5.3 命令选择建议

- 只改 Vue 组件/样式时：`bun run dev` 足以覆盖，例如 `src/components/monitor/MonitorSidebar.vue`、`src/components/forwarding/ForwardingTabContent.vue` 等纯前端组件。
- 涉及 Tauri API 调用时：使用 `bun run app:dev`。这类调用分布在 `src/main.ts`（`@tauri-apps/api`）、`src/services/notifications.ts`（`@tauri-apps/plugin-notification`）、`src/services/updater.ts`（`@tauri-apps/plugin-updater`、`@tauri-apps/plugin-process`）、`src/lib/frontendContext.ts`（`@tauri-apps/plugin-clipboard-manager`）等位置，仅靠浏览器运行无法完整验证。

---

## 6. 环境变量

| 变量名 | 敏感 | 说明 |
| --- | --- | --- |
| `TAURI_ENV_HOST` | 否 | Tauri 环境标识变量 |
| `TAURI_ENV_DEBUG` | 否 | Tauri 调试模式标识变量 |

数据仅提供变量名与敏感标记，未提供取值示例或默认值，具体取值按 Tauri CLI 运行环境传入。

---

## 7. 项目结构概览

源码目录为 `src`（前端）与 `src-tauri`（Rust 侧）。以下按数据中 `sourceDirFiles` 给出的真实文件样本说明各目录职责，锚点均为仓库内完整相对路径。

### 7.1 `src`（Vue 3 前端主目录）

数据提供该目录下真实文件样本如下：

| 文件锚点 | 含义 |
| --- | --- |
| `src/App.vue` | 应用根组件，导入 `vue` 与 `vue-i18n` |
| `src/main.ts` | 前端入口文件（同时出现在 `entryFiles` 中），导入 `@tauri-apps/api`、`pinia`、`tw-animate-css` |
| `src/assets/styles/main.css` | 全局样式入口，导入 `tailwindcss` |
| `src/assets/styles/palette.css` | 调色板样式文件 |
| `src/components/forwarding/ForwardRuleFormDialog.vue` | 端口转发规则表单对话框组件 |
| `src/components/forwarding/ForwardingTabContent.vue` | 端口转发标签页内容组件 |
| `src/components/forwarding/ForwardingTabContent.css` | 上述转发标签页的配套样式文件 |
| `src/components/monitor/MetricChart.vue` | 监控指标图表组件 |
| `src/components/monitor/MonitorSidebar.vue` | 监控侧边栏组件 |

### 7.2 `src-tauri`（Tauri / Rust 侧目录）

数据提供该目录下真实文件样本如下：

| 文件锚点 | 含义 |
| --- | --- |
| `src-tauri/Cargo.toml` | Rust 包清单，声明 crate 元数据与依赖 |
| `src-tauri/build.rs` | Cargo 构建脚本，参与 Rust 侧编译流程 |
| `src-tauri/capabilities/default.json` | Tauri 能力（权限）配置 |
| `src-tauri/src/background.rs` | Rust 侧源码模块 |
| `src-tauri/src/config/groups.rs` | 配置模块：分组相关 |
| `src-tauri/src/config/legacy.rs` | 配置模块：旧版配置兼容 |
| `src-tauri/src/config/load.rs` | 配置模块：加载逻辑 |
| `src-tauri/src/config/mod.rs` | 配置模块入口 |

### 7.3 前端入口文件（`entryFiles`）

数据给出的前端入口/聚合入口文件：

| 入口文件 | 说明 |
| --- | --- |
| `src/main.ts` | 应用主入口 |
| `src/i18n/index.ts` | 国际化模块入口 |
| `src/lib/motion/index.ts` | 动画模块入口（导入 `gsap`） |
| `src/lib/sessions/index.ts` | 会话模块入口 |
| `src/stores/config/index.ts` | 配置 store 模块入口 |

从这些入口可看出前端由若干聚合模块组成：国际化（`src/i18n/`）、动画（`src/lib/motion/`）、会话（`src/lib/sessions/`）、配置状态（`src/stores/config/`）。终端渲染相关代码位于 `src/lib/frontends/xterm/`（样本中可见 `frontend.ts`、`renderer.ts`、`resize.ts`、`lines.ts`、`options.ts`、`search.ts`、`support.ts`），中间件与 OSC 处理位于 `src/lib/middleware/`。

---

## 8. 开发指南

### 8.1 构建

```bash
bun run build
```

流程为两段串联：先 `vue-tsc --noEmit` 做全量类型检查（该步骤失败会直接终止，不会产出构建物），再执行 `vite build` 生成生产产物。因此**类型错误必须在构建阶段修完**，无法绕过。前端构建配置集中在 `vite.config.ts`，其中使用了 `@vitejs/plugin-vue`、`@tailwindcss/vite`（Tailwind CSS 的 Vite 集成）与 `vite` 自身。

桌面端打包使用：

```bash
bun run app:build
```

### 8.2 运行测试

```bash
bun run test
```

即 `vitest run`，单次执行全部测试后退出（非 watch 模式）。现有测试文件样本包括：

| 测试文件锚点 |
| --- |
| `src/lib/backgroundImage.test.ts` |
| `src/components/split/splitTree.test.ts` |
| `src/components/terminal/searchFocus.test.ts` |
| `src/components/titlebar/tabGroupLayout.test.ts` |
| `src/components/titlebar/tabStripLayout.test.ts` |

从命名可见测试集中在纯逻辑/布局算法一侧（分割树、标签组与标签条布局、搜索焦点、背景图处理），这些逻辑不依赖 Tauri 运行时，因此可在普通 Node 环境下由 vitest 直接跑通。

### 8.3 代码检查

```bash
bun run lint
```

对 `src` 目录执行 oxlint。建议在提交前与 CI 中执行。

### 8.4 开发调试

| 调试对象 | 方式 | 依据 |
| --- | --- | --- |
| 纯前端界面 | `bun run dev`，浏览器 DevTools | Vite 开发服务器 |
| 需要 Tauri 能力的功能 | `bun run app:dev` | Rust 侧由 `src-tauri/build.rs`、`src-tauri/Cargo.toml` 参与构建；权限由 `src-tauri/capabilities/default.json` 约束 |
| 通知功能 | 在 `app:dev` 模式下验证 | 调用点 `src/services/notifications.ts` 导入 `@tauri-apps/plugin-notification` |
| 更新流程 | 在 `app:dev` 模式下验证 | 调用点 `src/services/updater.ts` 导入 `@tauri-apps/plugin-updater`、`@tauri-apps/plugin-process`；`src/components/settings/pages/AboutPage.vue` 亦导入更新插件 |
| 终端渲染 | `bun run dev` 或 `app:dev` | 渲染器代码 `src/lib/frontends/xterm/renderer.ts` 导入 `@xterm/addon-canvas`、`@xterm/addon-webgl`；`@xterm/addon-fit` 用于尺寸适配（`src/lib/frontends/xterm/resize.ts`） |
| 剪贴板交互 | `app:dev` 模式 | 调用点 `src/lib/frontendContext.ts` 导入 `@tauri-apps/plugin-clipboard-manager` |
| 文件选择/打开 | `app:dev` 模式 | `@tauri-apps/plugin-dialog` 调用点 `src/components/settings/pages/AppearancePage.vue`、`src/components/settings/pages/BackupPage.vue`、`src/components/sftp/SftpBrowserPane.vue`；`@tauri-apps/plugin-opener` 调用点 `src/components/settings/pages/AboutPage.vue`、`src/components/sftp/SftpBrowserPane.vue`、`src/components/sftp/TransferPopover.vue`、`src/lib/frontends/xterm/support.ts` |

### 8.5 状态与数据流开发注意点

- 全局状态由 pinia 管理，store 分布在 `src/stores/config/store.ts`、`src/stores/forwarding.ts`、`src/stores/monitor.ts`、`src/stores/tabs.ts`，并在 `src/main.ts` 中注册。新增 store 建议遵循同一目录约定。
- 配置的序列化/反序列化由 `src/stores/config/store.ts` 导入的 `yaml` 承担；配置模块入口为 `src/stores/config/index.ts`。
- Rust 侧配置相关逻辑集中在 `src-tauri/src/config/`（`mod.rs`、`load.rs`、`groups.rs`、`legacy.rs`），其中 `legacy.rs` 表明存在旧版本配置兼容处理，改动配置结构时需一并核对。
- 终端数据流涉及 rxjs 流式处理：调用点包括 `src/lib/frontends/frontend.ts`、`src/lib/frontends/xterm/frontend.ts`、`src/lib/frontends/xterm/support.ts`、`src/lib/middleware/middleware.ts`、`src/lib/middleware/oscProcessing.ts`。

---

## 9. 待确认事项

| # | 事项 | 缺失证据 |
| --- | --- | --- |
| 1 | Node.js 最低/推荐版本 | 项目数据 `nodeVersion` 为空，未声明版本要求；仅能确定为 bun 包管理器 |
| 2 | 自定义 CLI 命令 | `cliCommands` 为空数组，项目未提供自研命令行工具；初始化仅依赖 bun 脚本 |
| 3 | Rust 工具链版本要求 | `src-tauri/Cargo.toml` 仅作为文件存在被列出，未提供 edition / toolchain 具体值 |

除以上三点外，本页所述命令、目录职责、依赖调用点均有数据锚点支撑。
## Related

- 同目录：[testing.md](testing.md) · [troubleshooting.md](troubleshooting.md)
- 总入口：[README](../README.md)
