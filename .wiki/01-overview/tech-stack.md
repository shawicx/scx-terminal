# 技术栈

<details>
<summary>Relevant source files</summary>

- src/components/settings/useConfirmAction.ts
- src/components/settings/useGroupNameDialog.ts
- src/components/sftp/usePaneNavigation.ts
- src/components/split/splitTree.ts
- src/components/terminal/usePaneMenu.ts
- src/components/terminal/usePaneSuggestions.ts
- src/components/terminal/usePaneTheme.ts
- src/components/terminal/useSshChallenges.ts
- src/components/terminal/useTerminalSearch.ts
- src/components/titlebar/useTabDnd.ts
- src/i18n/index.ts
- src/lib/frontendContext.ts
- src/lib/frontends/frontend.ts
- src/lib/frontends/xterm/frontend.ts
- src/lib/frontends/xterm/lines.ts
</details>

本页描述项目的前端技术栈全貌：运行时为 ESM，构建工具为 Vite（`vite.config.ts`），包管理器为 Bun。依赖清单由 `@tauri-apps/*` 宿主能力包、`@xterm/*` 终端渲染栈、Vue 3 应用框架族（Vue + Pinia + vue-i18n）、UI 基础库（reka-ui + CVA/clsx/tailwind-merge + Tailwind CSS 4）与少量通用工具库（rxjs、nanoid、deep-equal、yaml、gsap）五条主线构成。

从 import 分布看，技术栈呈现清晰的"分层落地"特征：`@tauri-apps/api` 以 25 个引用点覆盖 `src/services/` 与 `src/stores/` 的服务层，说明桌面能力被封装在服务层而非直接散落在组件中；终端能力集中在 `src/lib/frontends/xterm/` 一个目录内（7 个文件引用 `@xterm/xterm`）；UI 图标库 `lucide-vue-next` 则以 28 个引用点铺满组件层。以下各节按职责分组给出依赖、版本与可核验的 import 锚点。

## 技术栈速览

| 维度 | 选型 | 证据锚点 |
| --- | --- | --- |
| 模块运行时 | ESM | 数据字段 `runtime: "ESM"` |
| 构建工具 | Vite `^8.3.0` | `vite.config.ts` |
| 包管理器 | Bun | 数据字段 `packageManager: "bun"` |
| 桌面宿主 | Tauri 2（`@tauri-apps/api` `^2.11.1` + 7 个官方插件） | `src/main.ts`、`src/services/pty.ts` |
| 前端框架 | Vue `^3.5.42`（60 个引用点） | `src/App.vue`、`src/main.ts` |
| 状态管理 | Pinia `^4.0.3` | `src/stores/tabs.ts`、`src/main.ts` |
| 国际化 | vue-i18n `^11.4.10` | `src/i18n/index.ts` |
| 终端渲染 | `@xterm/xterm` `5.5.0` + 6 个 addon | `src/lib/frontends/xterm/frontend.ts` |
| 样式体系 | Tailwind CSS `^4.3.3` + `@tailwindcss/vite` + `tw-animate-css` | `src/assets/styles/main.css`、`src/main.ts` |
| 通用工具 | rxjs、nanoid、deep-equal、yaml、gsap | `src/lib/middleware/middleware.ts`、`src/stores/config/store.ts` 等 |

---

## 核心依赖

### 一、Tauri 宿主集成层（`@tauri-apps/*`）

| 依赖 | 版本 | 首个 import 点 | 引用文件数 |
| --- | --- | --- | --- |
| @tauri-apps/api | ^2.11.1 | `src/components/settings/pages/AboutPage.vue` | 25 |
| @tauri-apps/plugin-clipboard-manager | ^2.3.3 | `src/lib/frontendContext.ts` | 1 |
| @tauri-apps/plugin-dialog | ^2.7.3 | `src/components/settings/pages/AppearancePage.vue` | 3 |
| @tauri-apps/plugin-notification | ^2.4.0 | `src/services/notifications.ts` | 1 |
| @tauri-apps/plugin-opener | ^2.5.5 | `src/components/settings/pages/AboutPage.vue` | 4 |
| @tauri-apps/plugin-process | ^2.3.1 | `src/services/updater.ts` | 1 |
| @tauri-apps/plugin-updater | ^2.11.0 | `src/components/settings/pages/AboutPage.vue` | 2 |

这一层是本项目"桌面应用"属性的来源。`@tauri-apps/api` 的 25 个引用点几乎全部落在服务层与状态层（`src/services/backgroundImage.ts`、`src/services/configBackup.ts`、`src/services/configSync.ts`、`src/services/fonts.ts`、`src/services/forward.ts`、`src/services/history.ts`、`src/services/localFs.ts`、`src/services/monitor.ts`、`src/services/pathCompletion.ts`、`src/services/pty.ts`、`src/services/secrets.ts`、`src/services/sftp.ts`、`src/services/shells.ts`、`src/services/ssh.ts`、`src/services/tabSession.ts`、`src/stores/config/flush.ts`、`src/stores/config/store.ts`、`src/stores/forwarding.ts`、`src/stores/monitor.ts`、`src/stores/transfers.ts`，以及入口 `src/main.ts` 和三个设置页 `src/components/settings/pages/AboutPage.vue`、`src/components/settings/pages/AppearancePage.vue`、`src/components/settings/pages/KeysPage.vue`，另有 `src/components/sftp/SftpTabContent.vue`）。PTY、SSH、SFTP、端口转发、系统监控、历史记录、密钥等能力各有一个服务文件与之对应，组件层不直接引用 `@tauri-apps/api`，而是经由 `src/services/*` 与 `src/stores/*` 间接使用。

插件层按"能力单一"拆分，引用面很窄：`@tauri-apps/plugin-clipboard-manager` 只在 `src/lib/frontendContext.ts` 出现；`@tauri-apps/plugin-notification` 只在 `src/services/notifications.ts` 出现；`@tauri-apps/plugin-dialog` 出现在 `src/components/settings/pages/AppearancePage.vue`、`src/components/settings/pages/BackupPage.vue`、`src/components/sftp/SftpBrowserPane.vue`；`@tauri-apps/plugin-opener` 分布在 `src/components/settings/pages/AboutPage.vue`、`src/components/sftp/SftpBrowserPane.vue`、`src/components/sftp/TransferPopover.vue` 与 `src/lib/frontends/xterm/support.ts`。升级图景上值得注意的是更新链路：`@tauri-apps/plugin-updater` 与 `@tauri-apps/plugin-process` 同时出现在 `src/services/updater.ts`（此外 updater 插件还在 `src/components/settings/pages/AboutPage.vue` 被引用），说明更新功能涉及"检查 + 进程操作"两类宿主能力，两者版本需协同升级。

### 二、终端渲染层（`@xterm/*`）

| 依赖 | 版本 | 首个 import 点 | 引用文件数 |
| --- | --- | --- | --- |
| @xterm/xterm | 5.5.0 | `src/lib/frontends/xterm/frontend.ts` | 7 |
| @xterm/addon-canvas | 0.6.0 | `src/lib/frontends/xterm/renderer.ts` | 1 |
| @xterm/addon-fit | 0.10.0 | `src/lib/frontends/xterm/frontend.ts` | 2 |
| @xterm/addon-search | 0.15.0 | `src/lib/frontends/xterm/search.ts` | 1 |
| @xterm/addon-unicode11 | 0.8.0 | `src/lib/frontends/xterm/frontend.ts` | 1 |
| @xterm/addon-web-links | ^0.12.0 | `src/lib/frontends/xterm/frontend.ts` | 1 |
| @xterm/addon-webgl | 0.18.0 | `src/lib/frontends/xterm/renderer.ts` | 1 |

终端是本项目的核心界面，整个 xterm 依赖族被收敛在 `src/lib/frontends/xterm/` 目录下，没有任何一个 xterm 包泄漏到该目录之外。核心包 `@xterm/xterm` 被该目录的 7 个文件引用：`src/lib/frontends/xterm/frontend.ts`、`src/lib/frontends/xterm/lines.ts`、`src/lib/frontends/xterm/options.ts`、`src/lib/frontends/xterm/renderer.ts`、`src/lib/frontends/xterm/resize.ts`、`src/lib/frontends/xterm/search.ts`、`src/lib/frontends/xterm/support.ts`。

addon 的分布体现了"能力按文件切分"的组织方式：`frontend.ts` 同时引入 `@xterm/addon-fit`、`@xterm/addon-unicode11`、`@xterm/addon-web-links`；`resize.ts` 也引入 `@xterm/addon-fit`；`search.ts` 引入 `@xterm/addon-search`；渲染相关则集中在 `renderer.ts`，其中同时出现 `@xterm/addon-canvas` 与 `@xterm/addon-webgl` 两个渲染后端 addon（两者在同一文件被引入）。升级注意：除 `@xterm/addon-web-links`（`^0.12.0`）外，xterm 相关版本均为精确锁定（`5.5.0`、`0.6.0`、`0.10.0`、`0.15.0`、`0.8.0`、`0.18.0`），addon 与主包 API 强耦合，升级时需整族同步验证。

### 三、应用框架与状态层

| 依赖 | 版本 | 首个 import 点 | 引用文件数 |
| --- | --- | --- | --- |
| vue | ^3.5.42 | `src/App.vue` | 60 |
| pinia | ^4.0.3 | `src/main.ts` | 7 |
| vue-i18n | ^11.4.10 | `src/App.vue` | 39 |

Vue 是覆盖面最广的依赖，60 个引用点横跨 `src/App.vue`、全部 `src/components/**` 组件与组合式函数（如 `src/components/terminal/usePaneMenu.ts`、`src/components/terminal/useTerminalSearch.ts`、`src/components/split/SplitContainer.vue`）、`src/services/*`（`src/services/backgroundImage.ts`、`src/services/commands.ts`、`src/services/quickCommandPalette.ts`、`src/services/sshConnections.ts`、`src/services/tabSession.ts`、`src/services/transferCenter.ts`）、`src/stores/*` 与入口 `src/main.ts`，类型声明 `src/vite-env.d.ts` 亦在其中。

Pinia 的 7 个引用点全部落在 store 与入口：`src/main.ts`、`src/stores/config/store.ts`、`src/stores/forwarding.ts`、`src/stores/monitor.ts`、`src/stores/tabs.ts`、`src/stores/theme.ts`、`src/stores/transfers.ts` —— 即应用状态按领域切分为配置、转发、监控、标签页、主题、传输等 store。vue-i18n 在 39 个文件中被引用（含 `src/i18n/index.ts` 实例入口，以及从 `src/App.vue` 到 `src/components/settings/pages/*`、`src/components/terminal/*`、`src/components/sftp/*` 的众多视图与 `src/services/commands.ts`），说明界面文案已全面走 i18n 通道而非硬编码；新增文案或新增语言时，改动面覆盖这一批文件。

### 四、UI 组件与样式工具链

| 依赖 | 版本 | 首个 import 点 | 引用文件数 |
| --- | --- | --- | --- |
| lucide-vue-next | ^1.0.0 | `src/components/forwarding/ForwardRuleFormDialog.vue` | 28 |
| reka-ui | ^2.10.4 | `src/components/ui/Label.vue` | 4 |
| class-variance-authority | ^0.7.1 | `src/components/ui/Button.vue` | 1 |
| clsx | ^2.1.1 | `src/lib/utils.ts` | 1 |
| tailwind-merge | ^3.6.0 | `src/lib/utils.ts` | 1 |
| tw-animate-css | ^1.4.0 | `src/main.ts` | 1 |

这是一套典型的"无头组件 + 原子化样式"组合。`reka-ui` 作为无头原语被限制在 `src/components/ui/` 下的基础控件中使用：`src/components/ui/Label.vue`、`src/components/ui/Separator.vue`、`src/components/ui/Slider.vue`、`src/components/ui/Switch.vue`。样式工具三件套在同一处汇聚：`clsx` 与 `tailwind-merge` 均只被 `src/lib/utils.ts` 引用，说明类名合并逻辑有统一出口；`class-variance-authority` 则被 `src/components/ui/Button.vue` 引用，用于按钮变体定义。`tw-animate-css` 在入口 `src/main.ts` 引入，属于全局生效的样式层依赖。图标库 `lucide-vue-next` 以 28 个引用点覆盖设置、SFTP、终端、标题栏、启动页等各类视图（如 `src/components/titlebar/TitleBar.vue`、`src/components/sftp/SftpBrowserPane.vue`、`src/components/ui/Select.vue`），是全项目使用最分散的 UI 依赖。

### 五、通用能力库

| 依赖 | 版本 | 首个 import 点 | 引用文件数 |
| --- | --- | --- | --- |
| rxjs | ^7.8.2 | `src/lib/frontends/frontend.ts` | 7 |
| nanoid | ^6.0.1 | `src/components/settings/pages/KeysPage.vue` | 12 |
| yaml | ^2.9.1 | `src/stores/config/store.ts` | 1 |
| deep-equal | ^2.2.3 | `src/lib/frontends/xterm/frontend.ts` | 1 |
| gsap | ^3.15.0 | `src/lib/motion/index.ts` | 1 |

rxjs 的引用点集中在抽象层与流式服务：`src/lib/frontends/frontend.ts`、`src/lib/frontends/xterm/frontend.ts`、`src/lib/frontends/xterm/support.ts`、`src/lib/middleware/middleware.ts`、`src/lib/middleware/oscProcessing.ts`、`src/lib/sessions/baseSession.ts`、`src/services/hotkeys.ts` —— 说明终端数据流与热键等场景采用 Observable 模型组织。nanoid 用于标识生成，引用点横跨设置页（`src/components/settings/pages/KeysPage.vue`、`src/components/settings/pages/LocalProfilesPage.vue`、`src/components/settings/pages/QuickCommandsPage.vue`、`src/components/settings/pages/SshPage.vue`、`src/components/settings/pages/TabGroupsPage.vue`）、组合式函数 `src/components/settings/useGroupNameDialog.ts`、分屏逻辑 `src/components/split/splitTree.ts`、`src/lib/portForwarding.ts`、`src/lib/sessions/sshSession.ts`、`src/services/sshConnections.ts`、`src/stores/config/defaults.ts`、`src/stores/tabs.ts`。`yaml` 只在 `src/stores/config/store.ts` 出现，说明 YAML 序列化/解析被限定在配置 store 一个入口。`gsap` 只在动效模块 `src/lib/motion/index.ts` 出现，动效实现有单一封装点。`deep-equal` 只在 `src/lib/frontends/xterm/frontend.ts` 出现，用于终端前端的值比较场景（其类型包 `@types/deep-equal` 见下方"声明未用依赖"一节）。

---

## 开发依赖

| 依赖 | 版本 | 首个 import 点 | 开发场景用途 |
| --- | --- | --- | --- |
| vite | ^8.3.0 | `vite.config.ts` | 构建/开发服务器（数据字段 `buildTool: "vite"`，配置入口为 `vite.config.ts`） |
| @vitejs/plugin-vue | ^6.0.8 | `vite.config.ts` | 在 Vite 构建管线中处理 `.vue` 单文件组件 |
| @tailwindcss/vite | ^4.3.3 | `vite.config.ts` | Tailwind CSS 4 的 Vite 集成插件 |
| tailwindcss | ^4.3.3 | `src/assets/styles/main.css` | 原子化样式引擎，由样式入口 `src/assets/styles/main.css` 引入 |
| vitest | ^5.0.0 | （无 import 点） | 测试运行器；本次扫描未发现 import 点，测试配置与运行入口未体现在数据中 |

构建侧的两个插件（`@vitejs/plugin-vue`、`@tailwindcss/vite`）与 `vite` 同现于 `vite.config.ts`，是构建配置的固定组合；`tailwindcss` 本体则通过 CSS 入口 `src/assets/styles/main.css` 引入，与运行期的 `tw-animate-css`（`src/main.ts`）分属样式体系的不同层次。`vitest` 版本为 `^5.0.0`，但在源码 import 扫描中没有任何引用点，其接入方式（配置文件、脚本）需另行确认。

---

## 声明未用依赖

> 下表由源码 import 扫描推导（覆盖 .ts/.js/.vue/.css），存在动态加载、字符串引用等扫描盲区，清理前请人工复核。

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| @tauri-apps/cli | ^2.11.4 | 本次扫描无 import 点 |
| @types/deep-equal | ^1.0.4 | 本次扫描无 import 点（对应运行期依赖 `deep-equal` 在 `src/lib/frontends/xterm/frontend.ts` 有引用） |
| @types/node | ^22.20.2 | 本次扫描无 import 点 |
| oxlint | ^1.82.0 | 本次扫描无 import 点 |
| typescript | ~5.9.0 | 本次扫描无 import 点 |
| vue-tsc | ^3.3.11 | 本次扫描无 import 点 |

上述条目仅表示"在本次 import 扫描覆盖范围内未出现引用点"，不代表这些依赖在项目中无用——CLI、类型声明、Lint 与类型检查工具通常通过命令行或配置而非 `import` 语句参与工程流程，须结合脚本与配置文件人工确认后再决定是否清理。

---

## 升级影响面小结

| 升级对象 | 影响面（按 import 点） | 需联动核对 |
| --- | --- | --- |
| `@tauri-apps/api` | 25 个文件，覆盖全部服务层与多个 store | Tauri 插件（clipboard/dialog/notification/opener/process/updater）版本一致性 |
| `vue` | 60 个文件，覆盖组件/服务/store/入口 | Pinia、vue-i18n、reka-ui、xterm 前端封装 |
| `@xterm/xterm` | `src/lib/frontends/xterm/` 下 7 个文件 | 6 个 addon（版本精确锁定，需整族同步） |
| `vue-i18n` | 39 个文件 | `src/i18n/index.ts` 与各语言资源 |
| `lucide-vue-next` | 28 个文件 | 图标名称与导出 API |
| `pinia` | 7 个 store 与 `src/main.ts` | store 定义风格与持久化相关代码 |

## 待确认

1. **依赖锁定与传递依赖**：数据仅提供声明版本范围，未包含 lockfile 或依赖树，无法评估版本冲突与升级兼容性风险。
2. **测试链路**：`vitest`（^5.0.0）在数据中无 import 点，测试配置、运行脚本与用例组织方式缺证据。
3. **清单覆盖范围**：本数据集为前端依赖清单，未包含其他运行时/语言生态（如 Tauri 宿主侧）的依赖清单。
4. **CLI 与工具链调用方式**：`@tauri-apps/cli`、`oxlint`、`vue-tsc`、`typescript` 等被扫描标记为无 import 点，但其脚本/配置调用入口未在数据集中，无法确认实际启用方式。
## Related

- 同目录：[overview.md](overview.md) · [environment.md](environment.md)
- 总入口：[README](../README.md)
