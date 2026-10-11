# 设计决策与演进

<details>
<summary>Relevant source files</summary>

- README.md
- src-tauri/src/fsutil.rs
- src/lib/colorSchemes.ts
- src/lib/hotkeys/hotkeys.ts
- src/lib/middleware/oscProcessing.ts
- src/lib/monitorOrchestrator.ts
- src/lib/sessions/sshSession.ts
- src/lib/suggestions/promptTracker.ts
- src/services/commands.ts
- src/stores/monitor.ts
- src/stores/tabs.ts
</details>

本页基于 git 提交历史与仓库文档证据，还原 scx-terminal 的演进脉络、关键决策与其证据来源。页面内每条决策均携带 `commit:短哈希 (日期)` 或 `文档路径#小节` 锚点；证据不足处显式标注「待确认」，不做推测性补全。

---

## 一、演进时间线

数据来自 gitTimeline，时间窗为 `commit:b5fb9da6 (2026-09-13)「feat: 初始化」` 至 `commit:7f2d739b (2026-10-02)「feat: 为快捷命令及分组添加描述字段」`。

| 模块 | 提交数 | 首次提交 | 最近提交 | 高频主题（数据原文） |
| --- | --- | --- | --- | --- |
| lib | 31 | `commit:b5fb9da6 (2026-09-13)「feat: 初始化」` | `commit:0d3a6bff (2026-09-29)「feat: 快捷命令、本地终端、SSH分组支持排序」` | 新增终端输入建议自动补全并统一全局 ui 样式规范（×5）；修复输入建议与 ssh 认证（×3）；sftp 重构为双栏标签页并新增全局传输中心与隧道管理器（×2） |
| services | 17 | `commit:b5fb9da6 (2026-09-13)「feat: 初始化」` | `commit:be02b631 (2026-09-29)「feat: 新增分组感知的标签页切换器」` | 无主题数据（待确认） |
| stores | 14 | `commit:b5fb9da6 (2026-09-13)「feat: 初始化」` | `commit:be02b631 (2026-09-29)「feat: 新增分组感知的标签页切换器」` | 新增 ssh 实时服务器监控（×2） |
| src | 12 | `commit:8def4437 (2026-09-14)「feat: 新增 SSH 窗格内 SFTP 文件面板，支持目录浏览、上传下载与文件管理」` | `commit:7f2d739b (2026-10-02)「feat: 为快捷命令及分组添加描述字段」` | 大文件拆分为模块目录并修复监控并发（×4）；sftp 重构为双栏标签页并新增全局传输中心与隧道管理器（×2）；新增终端输入建议自动补全并统一全局 ui 样式规范（×2） |
| components | 6 | `commit:b5fb9da6 (2026-09-13)「feat: 初始化」` | `commit:3eee04e7 (2026-10-01)「fix: Tauri 的原生文件拖放会拦截 dataTransfer 的问题」` | 无主题数据（待确认） |

**脉络分析一：四个模块同源于一次初始化。** lib、services、stores、components 的首次提交主题同为 `commit:b5fb9da6 (2026-09-13)「feat: 初始化」`，这是它们「诞生动机」的最直接证据——这些模块是随项目初始化一次性建立的骨架，而非先有功能再有目录。src 是唯一例外，其首次提交为 `commit:8def4437 (2026-09-14)「feat: 新增 SSH 窗格内 SFTP 文件面板，支持目录浏览、上传下载与文件管理」`，说明 src 目录的提交起点对应 SFTP 文件面板这一具体功能落地，比初始化晚一天。

**脉络分析二：lib 是演进重心，交互链路先增强后修缺陷、再做重构。** lib 以 31 次提交位居五个模块之首，主题按「新增终端输入建议自动补全并统一全局 ui 样式规范（×5）」→「修复输入建议与 ssh 认证（×3）」→「sftp 重构为双栏标签页并新增全局传输中心与隧道管理器（×2）」排列，呈现「功能新增 → 缺陷修复 → 结构重构」的三段节奏，其最近提交为 `commit:0d3a6bff (2026-09-29)「feat: 快捷命令、本地终端、SSH分组支持排序」`。src 模块的主题中出现「大文件拆分为模块目录并修复监控并发（×4）」，与 hotFileChurn 中 `monitor.ts`、`monitorOrchestrator.ts` 的最近提交 `commit:0f06722c (2026-09-25)「refactor: 大文件拆分为模块目录并修复监控并发」` 相互印证，表明监控相关代码经历过一次拆分式重构并伴随并发问题修复。

**脉络分析三：services 与 stores 在同一次提交中协同变更，components 以修复收尾。** services 与 stores 的最近提交完全相同，均为 `commit:be02b631 (2026-09-29)「feat: 新增分组感知的标签页切换器」`，说明这两层在同一次功能提交中被一起改动；stores 的另外主题为「新增 ssh 实时服务器监控（×2）」。components 提交数最少（6），最近提交为 `commit:3eee04e7 (2026-10-01)「fix: Tauri 的原生文件拖放会拦截 dataTransfer 的问题」`，是一条缺陷修复提交，且未提供主题数据。

---

## 二、文档记录的决策

数据中提供的文档证据仅来自 `README.md` 的三个小节，逐条引用如下（摘录保持原文）。

| 决策域 | 文档锚点 | 摘录（原文） | 说明 |
| --- | --- | --- | --- |
| 技术栈选型 | `README.md#scx-terminal` | “scx-terminal：一个基于 **Tauri V2 + Rust + Vue 3 + shadcn-vue** 的跨平台终端应用。” | 文档明确记录项目为跨平台终端应用，并以 Tauri V2 + Rust + Vue 3 + shadcn-vue 作为技术栈组合。 |
| 分发渠道 | `README.md#下载与安装` | “下载与安装：从 [GitHub Releases](https://github.com/shawicx/scx-terminal/releases) 下载最新版本：” | 文档记录的发布/获取渠道为 GitHub Releases。 |
| Windows 安装形态 | `README.md#Windows` | “Windows：1. 双击运行 `*-setup.exe`；若 SmartScreen 弹出「Windows 已保护你的电脑」，点「更多信息」→「仍要运行」 2. 安装模式按需选择：**仅为当前用户**（无需管理员）或**为所有用户安装**（需要管理员权限） 3. 确认安装目录后完成安装” | 文档记录 Windows 侧提供两种安装模式：仅当前用户（无需管理员）与所有用户（需管理员），并说明 SmartScreen 提示的处理路径与安装目录确认步骤。 |

这三节是数据中全部可锚定的文档决策证据；更细的架构取舍动机未在文档数据中出现（见「待确认」）。

---

## 三、依赖引入决策

数据中仅提供一条依赖引入提交记录。

| 依赖 | 引入提交锚点 | 提交主题（原文） | 说明 |
| --- | --- | --- | --- |
| gsap | `commit:5039d5de (2026-09-27)` | “feat: 引入GSAP优化部分动画过渡” | 引入动机由提交主题直接记录：用于优化部分动画过渡；主题未限定具体动画场景。 |

---

## 四、高频变更热点

按 hotFileChurn 的变更次数降序排列。

| 文件 | 变更次数 | 最近提交（含主题） |
| --- | --- | --- |
| `src/services/commands.ts` | 14 | `commit:be02b631 (2026-09-29)「feat: 新增分组感知的标签页切换器」` |
| `src/stores/tabs.ts` | 12 | `commit:be02b631 (2026-09-29)「feat: 新增分组感知的标签页切换器」` |
| `src/lib/colorSchemes.ts` | 4 | `commit:e8315896 (2026-09-16)「feat: 新增配色方案独立设置页，按首字母分组折叠展示并支持方案预览」` |
| `src/lib/sessions/sshSession.ts` | 4 | `commit:432d9996 (2026-09-18)「feat: 新增 SSH keyboard-interactive 认证与动态凭据弹窗（记住密码回存）」` |
| `src-tauri/src/fsutil.rs` | 4 | `commit:c81c17e5 (2026-09-19)「feat: 接入自动更新链路」` |
| `src/lib/suggestions/promptTracker.ts` | 3 | `commit:afde6ab9 (2026-09-20)「fix: 修复 xterm 光标行坐标系误用导致建议菜单钉顶与输入行错读」` |
| `src/lib/hotkeys/hotkeys.ts` | 3 | `commit:6a21e22e (2026-09-17)「feat: 新增终端输入建议自动补全并统一全局 UI 样式规范」` |
| `src/lib/middleware/oscProcessing.ts` | 3 | `commit:fc39c954 (2026-09-13)「feat: 新增工作目录跟踪与新标签/分屏继承当前目录、复制当前路径命令」` |
| `src/stores/monitor.ts` | 2 | `commit:0f06722c (2026-09-25)「refactor: 大文件拆分为模块目录并修复监控并发」` |
| `src/lib/monitorOrchestrator.ts` | 2 | `commit:0f06722c (2026-09-25)「refactor: 大文件拆分为模块目录并修复监控并发」` |

**热点一：命令与标签页两个文件是变更最密集处，且共变。** `src/services/commands.ts`（14 次）与 `src/stores/tabs.ts`（12 次）分列前两位，两者最近提交为同一个 `commit:be02b631 (2026-09-29)「feat: 新增分组感知的标签页切换器」`，表明这两个文件在同一次功能提交中被同时改动；对这一区域的任何改动都需要同时回归命令与标签页两侧行为。

**热点二：4 次变更层的三个文件分属三个互不重叠的领域。** `src/lib/colorSchemes.ts` 的最新主题为新增配色方案独立设置页（`commit:e8315896`，2026-09-16）、`src/lib/sessions/sshSession.ts` 为 SSH keyboard-interactive 认证与动态凭据弹窗（`commit:432d9996`，2026-09-18）、`src-tauri/src/fsutil.rs` 为接入自动更新链路（`commit:c81c17e5`，2026-09-19）——三次最新变更分别落在界面配置、认证、更新链路上，属于功能驱动型变更。

**热点三：终端交互链路（建议/快捷键/OSC）变更 3 次，且最近一次是缺陷修复。** `src/lib/suggestions/promptTracker.ts` 最新提交为 `commit:afde6ab9 (2026-09-20)「fix: 修复 xterm 光标行坐标系误用导致建议菜单钉顶与输入行错读」`，`src/lib/hotkeys/hotkeys.ts` 最新提交为 `commit:6a21e22e (2026-09-17)「feat: 新增终端输入建议自动补全并统一全局 UI 样式规范」`，`src/lib/middleware/oscProcessing.ts` 最新提交为 `commit:fc39c954 (2026-09-13)「feat: 新增工作目录跟踪与新标签/分屏继承当前目录、复制当前路径命令」`。三者与 lib 模块主题「新增终端输入建议自动补全并统一全局 ui 样式规范」及「修复输入建议与 ssh 认证」对应，说明该链路的维护成本集中在光标/行坐标读取这类底层行为上。

**热点四：监控相关两个文件共享同一笔重构提交。** `src/stores/monitor.ts` 与 `src/lib/monitorOrchestrator.ts` 变更次数同为 2，最近提交同为 `commit:0f06722c (2026-09-25)「refactor: 大文件拆分为模块目录并修复监控并发」`，与 src 模块主题「大文件拆分为模块目录并修复监控并发（×4）」一致。

---

## 五、待确认

1. **缺架构级决策文档锚点**：数据中可锚定的文档证据仅有 `README.md#scx-terminal`、`README.md#下载与安装`、`README.md#Windows` 三节，涉及目录分层、状态管理选型、Tauri 命令边界等决策的原始动机缺证据。
2. **services 与 components 无主题证据**：两个模块的 gitTimeline `themes` 为空，其演进重心无法从主题维度判断。
3. **gsap 的源码使用位置缺锚点**：数据只给出引入提交 `commit:5039d5de (2026-09-27)`，未提供其在源码中的调用点或 import 点，无法锚定“哪些动画过渡”使用了该依赖。
4. **源码级行号锚点缺失**：本页对代码文件的引用以 commit 锚点为主，未提供 `file:line` 级证据；涉及具体实现行号的问题需另取数据。
## Related

- 共享 3 个源文件、共享 7 个符号：[troubleshooting.md](../05-guides/troubleshooting.md)
- 共享 1 个源文件、共享 8 个符号：[overview.md](../01-overview/overview.md)
- 共享 1 个源文件、共享 7 个符号：[architecture.md](../02-architecture/architecture.md)
- 总入口：[README](../README.md)
