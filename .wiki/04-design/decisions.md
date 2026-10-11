# 设计决策与演进

<details>
<summary>Relevant source files</summary>

- src-tauri/src/fsutil.rs
- src/lib/colorSchemes.ts
- src/lib/hotkeys/hotkeys.ts
- src/lib/sessions/sshSession.ts
- src/lib/startPage.ts
- src/services/commands.ts
- src/stores/tabs.ts
- README.md
- src/lib/suggestions/controller.ts
- src/lib/suggestions/promptTracker.ts
- src/lib/suggestions/suggestionEngine.ts
</details>

本页基于提交历史与仓库文档，还原 scx-terminal 各模块的演进脉络、关键决策及其证据来源；所有结论均以提交锚点或文档小节锚点为准，证据不足处标注「信息不足」或「待确认」。

---

## 一、演进时间线

下表按模块汇总提交规模与生命周期（模块名采用仓库中的模块标识）：

| 模块 | 提交数 | 首次提交 | 最近提交 | 高频主题 |
| --- | --- | --- | --- | --- |
| lib | 37 | commit:b5fb9da6 (2026-09-13)「feat: 初始化」 | commit:9c37721f (2026-10-11)「feat: 新增 SSH 跳板机（ProxyJump）多级链式连接支持」 | 新增终端输入建议自动补全并统一全局 ui 样式规范（×4）；修复输入建议与 ssh 认证（×3）；工作流支持输出感知执行，新增等待输出、变量捕获、运行进度与取消及终端建议源（×3） |
| services | 21 | commit:b5fb9da6 (2026-09-13)「feat: 初始化」 | commit:48e74553 (2026-10-10)「feat: 新增 SSH-Mosh 远程会话支持」 | 信息不足（未提供主题分布） |
| stores | 16 | commit:b5fb9da6 (2026-09-13)「feat: 初始化」 | commit:48e74553 (2026-10-10)「feat: 新增 SSH-Mosh 远程会话支持」 | 新增 ssh 实时服务器监控（×2） |
| src | 12 | commit:8def4437 (2026-09-14)「feat: 新增 SSH 窗格内 SFTP 文件面板，支持目录浏览、上传下载与文件管理」 | commit:c2238d67 (2026-10-10)「feat: 新增SFTP传输队列与断点续传支持」 | 大文件拆分为模块目录并修复监控并发（×3）；sftp 重构为双栏标签页并新增全局传输中心与隧道管理器（×2）；新增终端输入建议自动补全并统一全局 ui 样式规范（×2） |
| components | 6 | commit:b5fb9da6 (2026-09-13)「feat: 初始化」 | commit:533c46e4 (2026-10-09)「feat: 本地档案、SSH 与快捷命令编辑改为保存按钮提交」 | 信息不足（未提供主题分布） |

### 演进重心与节奏分析

**lib 是投入最重、跨度最长的模块。** 它以 commit:b5fb9da6 (2026-09-13)「feat: 初始化」为诞生起点，一直到 commit:9c37721f (2026-10-11)「feat: 新增 SSH 跳板机（ProxyJump）多级链式连接支持」仍在演进，累计 37 次提交，占表中五个模块之首。其主题分布显示两条主线："新增终端输入建议自动补全并统一全局 ui 样式规范"（×4）是最高频主题，对应一次成体系的能力引入加样式规范统一；紧随其后的"修复输入建议与 ssh 认证"（×3）说明该特性上线后进入了缺陷收敛阶段；"工作流支持输出感知执行，新增等待输出、变量捕获、运行进度与取消及终端建议源"（×3）则表明工作流能力在此期间被反复扩展。三条主线共同指向一个判断：lib 承担了终端交互层（输入建议、工作流、连接参数解析）的主要复杂度。

**services 与 stores 是"同期起步、同期收尾"的一对。** 二者首次提交均为 commit:b5fb9da6 (2026-09-13)「feat: 初始化」，最近一次提交又是同一个 commit:48e74553 (2026-10-10)「feat: 新增 SSH-Mosh 远程会话支持」。这说明远程会话能力是这两个模块共同的演进方向，且改动往往是成对推进的——新增一种远程会话协议需要同时改动服务层与状态层。stores 的另一条可见主题是"新增 ssh 实时服务器监控"（×2），说明状态层除了会话管理，还承载了运行时监控数据的组织。

**src 与 components 的起点晚于初始化，且更具"功能驱动"色彩。** src 的首次提交是 commit:8def4437 (2026-09-14)「feat: 新增 SSH 窗格内 SFTP 文件面板，支持目录浏览、上传下载与文件管理」——这是该模块"诞生动机"的最直接证据：它并非随初始化脚手架出现，而是伴随 SFTP 文件面板这一具体功能被建立起来；其后续主题"大文件拆分为模块目录并修复监控并发"（×3）显示该模块很快经历了结构重组，"sftp 重构为双栏标签页并新增全局传输中心与隧道管理器"（×2）则是第二次形态调整，最近提交 commit:c2238d67 (2026-10-10)「feat: 新增SFTP传输队列与断点续传支持」延续了 SFTP 这条主线，呈现"功能引入 → 结构拆分 → 交互重构 → 能力补全"的连续节奏。components 规模最小（6 次），从初始化到 commit:533c46e4 (2026-10-09)「feat: 本地档案、SSH 与快捷命令编辑改为保存按钮提交」，末次提交反映的是一处交互口径统一（编辑改为保存按钮提交），属于界面层的一致性调整。

---

## 二、文档记录的决策

仓库文档证据集中在 README.md 的三个小节，逐条如下：

| 文档小节 | 原文摘录 | 记录的决策 / 口径 |
| --- | --- | --- |
| README.md#scx-terminal | "scx-terminal：一个基于 **Tauri V2 + Rust + Vue 3 + shadcn-vue** 的跨平台终端应用。" | 技术栈选型：桌面外壳 Tauri V2，后端 Rust，前端 Vue 3，UI 组件体系 shadcn-vue；产品定位为跨平台终端应用 |
| README.md#下载与安装 | "下载与安装：从 [GitHub Releases](https://github.com/shawicx/scx-terminal/releases) 下载最新版本：" | 发布渠道口径：以 GitHub Releases 作为唯一对外分发入口 |
| README.md#Windows | "Windows：1. 双击运行 `*-setup.exe`；若 SmartScreen 弹出「Windows 已保护你的电脑」，点「更多信息」→「仍要运行」 2. 安装模式按需选择：**仅为当前用户**（无需管理员）或**为所有用户安装**（需要管理员权限） 3. 确认安装目录后完成安装" | 安装形态口径：提供单文件 `*-setup.exe` 安装包，支持"仅当前用户 / 所有用户"两种安装模式，并给出了 SmartScreen 拦截的处置路径 |

需要如实说明的是：#scx-terminal 一条属于技术选型层面的决策记录；#下载与安装 与 #Windows 两条记录的是分发与安装口径，并非设计动机层面的决策。**关于上述选型（尤其是为何选择 Tauri V2 而非其他桌面外壳、为何采用 shadcn-vue）的动机，文档与提交证据中均未记录——待确认：缺少架构决策记录（ADR）类文档或说明选型取舍的提交信息。** 同样，installer 采用 `*-setup.exe` 单包且区分两种安装模式的实现依据，在当前证据中也没有对应说明。

---

## 三、依赖引入决策

| 依赖 | 引入提交 | 提交主题（原文） | 说明 |
| --- | --- | --- | --- |
| gsap | commit:5039d5de (2026-09-27) | "feat: 引入GSAP优化部分动画过渡" | 该提交是数据中唯一可追溯到依赖引入的锚点：引入 GSAP 的目的是优化部分动画过渡效果；提交措辞为"部分"，对应范围是局部而非全局动画体系 |

**待确认：** 除 gsap 外，其余依赖（包括 README.md#scx-terminal 中出现的 Tauri V2、Vue 3、shadcn-vue）没有给出引入提交，无法说明其引入时点与当时的动机；gsap 之后也没有出现替换或移除记录。

---

## 四、高频变更热点

下表按变更次数排序，列出最频繁被改动的生产文件及其最近一次提交：

| 文件 | 变更次数 | 最近提交 |
| --- | --- | --- |
| src/services/commands.ts | 18 | commit:48e74553 (2026-10-10)「feat: 新增 SSH-Mosh 远程会话支持」 |
| src/stores/tabs.ts | 14 | commit:48e74553 (2026-10-10)「feat: 新增 SSH-Mosh 远程会话支持」 |
| src/lib/sessions/sshSession.ts | 5 | commit:9c37721f (2026-10-11)「feat: 新增 SSH 跳板机（ProxyJump）多级链式连接支持」 |
| src-tauri/src/fsutil.rs | 5 | commit:2177899c (2026-10-10)「feat: 工作流支持 YAML 导入导出并解引用快捷命令为内联命令，运行失败时发送系统通知」 |
| src/lib/colorSchemes.ts | 4 | commit:e8315896 (2026-09-16)「feat: 新增配色方案独立设置页，按首字母分组折叠展示并支持方案预览」 |
| src/lib/suggestions/promptTracker.ts | 3 | commit:afde6ab9 (2026-09-20)「fix: 修复 xterm 光标行坐标系误用导致建议菜单钉顶与输入行错读」 |
| src/lib/suggestions/controller.ts | 3 | commit:f9998061 (2026-10-10)「feat: 工作流支持输出感知执行，新增等待输出、变量捕获、运行进度与取消及终端建议源」 |
| src/lib/hotkeys/hotkeys.ts | 3 | commit:6a21e22e (2026-09-17)「feat: 新增终端输入建议自动补全并统一全局 UI 样式规范」 |
| src/lib/startPage.ts | 3 | commit:48e74553 (2026-10-10)「feat: 新增 SSH-Mosh 远程会话支持」 |
| src/lib/suggestions/suggestionEngine.ts | 3 | commit:f9998061 (2026-10-10)「feat: 工作流支持输出感知执行，新增等待输出、变量捕获、运行进度与取消及终端建议源」 |

### 维护风险与稳定性判断

**热点高度集中在两个"聚合型"文件上。** `src/services/commands.ts`（18 次）与 `src/stores/tabs.ts`（14 次）的变更次数远高于其余文件，且二者的最近一次改动是同一个 commit:48e74553 (2026-10-10)「feat: 新增 SSH-Mosh 远程会话支持」。这两点结合起来看：命令服务与标签页状态是整个应用的能力汇聚点，每新增一种远程会话协议都会同时穿透这两处。**风险在于回归面**——一次会话协议扩展就要在一个 18 次变更的文件上再次改动，其分支路径与已有协议（SSH、SFTP、Mosh、跳板机）的兼容性需要重点验证。`src/lib/startPage.ts` 同样由该提交触及，说明"新增会话类型"这一变更会波及入口层面的会话枚举。

**连接与文件工具层处于持续活跃状态。** `src/lib/sessions/sshSession.ts`（5 次）最近被 commit:9c37721f (2026-10-11)「feat: 新增 SSH 跳板机（ProxyJump）多级链式连接支持」改动，是数据中时间最晚的一次提交，表明连接层仍在扩张；`src-tauri/src/fsutil.rs`（5 次）最近由 commit:2177899c (2026-10-10)「feat: 工作流支持 YAML 导入导出并解引用快捷命令为内联命令，运行失败时发送系统通知」改动，说明 Rust 侧的文件工具同时服务于文件操作与工作流序列化两类需求。

**输入建议子系统呈现"集中修复后统一扩展"的轨迹。** `promptTracker.ts`、`controller.ts`、`suggestionEngine.ts` 三者的变更次数均为 3。其中 promptTracker 的最近提交是一次修复：commit:afde6ab9 (2026-09-20)「fix: 修复 xterm 光标行坐标系误用导致建议菜单钉顶与输入行错读」——主题直接点明该文件风险来源是 xterm 光标行坐标系的误用，属于易错点；controller 与 suggestionEngine 则由 commit:f9998061 (2026-10-10)「feat: 工作流支持输出感知执行，新增等待输出、变量捕获、运行进度与取消及终端建议源」统一推进，说明建议子系统已经与工作流能力产生耦合。

**已趋于稳定的部分。** `src/lib/colorSchemes.ts`（4 次）自 commit:e8315896 (2026-09-16)「feat: 新增配色方案独立设置页，按首字母分组折叠展示并支持方案预览」之后再无变更；`src/lib/hotkeys/hotkeys.ts`（3 次）自 commit:6a21e22e (2026-09-17)「feat: 新增终端输入建议自动补全并统一全局 UI 样式规范」后亦无变更。两者都属于"一次成型"的低风险区域，与仍在高频变动的会话/传输链路形成对比。

---

## 五、待确认

1. **services 与 components 两个模块的高频主题数据缺失**，无法还原其演进重心，仅能确定其生命周期区间与首末提交。
2. **首次提交「feat: 初始化」的具体内容未提供**，因此除时间点（commit:b5fb9da6，2026-09-13）外，无法说明初始化阶段实际建立的范围与结构。
3. **模块标识与仓库目录/文件的对应关系未在证据中给出**，本页模块名沿用仓库中的模块标识，未做路径级映射。
4. **技术选型动机无记录**：README.md#scx-terminal 记下了 Tauri V2 + Rust + Vue 3 + shadcn-vue 的事实口径，但缺少解释取舍的文档或提交。
5. **依赖引入证据仅覆盖 gsap 一项**，其余依赖的引入时点与动机无法追溯。
## Related

- 共享 2 个源文件、共享 5 个符号：[troubleshooting.md](../05-guides/troubleshooting.md)
- 共享 3 个符号：[modules.md](../02-architecture/modules.md)
- 共享 3 个源文件：[constraints.md](../06-constraints/constraints.md)
- 总入口：[README](../README.md)

<!-- wiki:source: llm -->
