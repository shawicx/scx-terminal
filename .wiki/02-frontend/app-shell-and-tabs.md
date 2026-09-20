# 应用外壳与标签系统

## 路径与职责

| 文件 | 职责 |
| --- | --- |
| `src/App.vue` | 应用骨架：TitleBar + 标签内容区（terminal/sftp/forwarding/settings 四类标签）+ CommandPalette；启动时创建首个标签；注册命令与全局键盘监听；语言跟随；`tabBarPosition=bottom` 时在内容区下方渲染独立标签条 |
| `src/main.ts` | bootstrap：Pinia → **先加载配置再初始化主题** → Vue errorHandler / window error / unhandledrejection 全部转发到 Rust `dev_log`（`tauri dev` 控制台可见） |
| `src/components/titlebar/TitleBar.vue` | 自定义标题栏（macOS Overlay 标题栏）：交通灯占位、传输/隧道指示器、设置齿轮；`tabBarPosition=top`（默认）时内嵌 TabStrip。⚠️ 拖拽/双击缩放全靠元素上的 `data-tauri-drag-region`（Tauri 原生：mousedown 拖动、macOS 双击在 mouseup 调 `internal_toggle_maximize`）——**不要再自绑 `@dblclick` 缩放**，双重 toggle 会竞态，表现为「最大化双击还原时大概率又弹回最大化」 |
| `src/components/titlebar/TabStrip.vue` | 标签条：标签列表（右键菜单/行内重命名/颜色标记/拖拽排序）+ 标签分组 chip（折叠/拖入归组，见下文「标签分组」）+ `+` 新建下拉。top 模式内嵌 TitleBar（`display:contents` 不引入额外盒子）；bottom 模式独立成条（圆角/描边/激活下探方向翻转），由 App.vue 挂载 |
| `src/stores/tabs.ts` | 标签状态（`tabs` / `activeId` / `activeTab`）与动作（含 `renameTab` / `setTabColor` / `closeOtherTabs` / 归属动作 `assignTabToGroup` / `moveTabToGroup` / `clearGroupMembership` / `restoreSession`） |
| `src/components/titlebar/tabGroupLayout.ts` | 标签分组纯函数：展示序 `displaySequence`（全部组 chip 按定义序在前 + 未分组在后）、可见邻居 `visibleNeighborId`（先右后左、跳过折叠组成员）、折叠激活切换 `activeAfterCollapse`、拖拽落点翻译 `resolveDrop` |
| `src/services/tabSession.ts` | 标签恢复快照：形状守卫 `normalizeTabSession` + 启动加载 `loadTabSession` + 写侧 `computeSnapshot`/`initTabSessionSync`（500ms 防抖，仅 persistTabs 组的终端标签进快照） |
| `src/components/palette/CommandPalette.vue` | 命令面板：模糊搜索命令并执行；打开期间 `hotkeys.disable()` 暂停全局热键 |
| `src/components/ui/ContextMenu.vue` | 通用右键菜单（reka-ui ContextMenu 封装）：`items` 传入菜单项（含 `swatch` 色块、`danger`、分隔线），`select(key)` 回传 |
| `src/services/terminalTabsApi.ts` | `terminalTabApi.current`：当前激活终端标签的动作句柄（split/copy/paste/clear/find…），供命令与热键调用 |

## 标签模型

`Tab = { id: nanoid(), type: 'terminal' | 'settings', title, manualTitle?, color?, profileId?, cwd?, groupId? }`（`src/stores/tabs.ts`）。要点：

- **groupId（可选）= 标签分组归属**（`config.store.tabGroups` 定义，见 [标签分组](#标签分组)）；悬空引用按未分组容错。
- `closeTab` 的激活接替用 `visibleNeighborId`（展示序可见邻居、先右后左、跳过折叠组成员），不再取数组下标邻居。

- `openTerminalTab(profileId?, cwd?)`：绑定所用配置档案（缺省 = 默认档案），初始标题为档案名（OSC 上报后覆盖）；`cwd` 为继承的初始目录（新标签入口先经 `terminalTabApi.current?.getActivePaneCwd()` 取活动窗格目录再开标签——`commands.ts` 的 `openNewTerminalTabWithCwd` 与 TitleBar「+」菜单同此；档案显式配置 `cwd` 时继承值被丢弃，同 Tabby `getNewTabParameters` 语义），由 `TerminalTabContent` 初始 `makeLeaf(tab.cwd)` 消费。
- `openSettingsTab()` 是单例（已有设置标签则激活）。
- `closeTab()` 关闭最后一个标签时自动开一个新终端标签；`closeOtherTabs(id)` 只保留指定标签。
- 所有标签的 DOM 常驻（`App.vue` 用 `v-show`），后台会话不中断——对标 Tabby 行为。`App.vue` 以 `:profile-id` 传给 `TerminalTabContent`，其内部解析档案对象（精确匹配 → 默认档案 → `fallbackProfile()` 兜底）。
- 标签标题来源：shell OSC 0/2 → `frontend.title$` → `TerminalTabContent.setPaneTitle` → `tabs.setTitle`；显示优先级为 `manualTitle`（右键"重命名"，行内输入，Enter/失焦提交、Esc 取消、空串清除）> `title`（OSC 上报）> 回退文案。`setTitle` 不会覆盖 `manualTitle`。
- 标签右键菜单（TabStrip 内 `ContextMenu`）：重命名 / 关闭标签页 / 关闭其他标签页 / 颜色标记（7 色预设色板小圆点，同色再点清除；`Tab.color` 在标签上渲染为色点）。
- 标签条「+」按钮为档案下拉菜单（`ui/DropdownMenu.vue`）：本地档案在前（`defaultFirstProfiles` 置顶排序，默认档案带标记），分隔线后按分组排列 SSH 档案，点击按该档案开新标签。

## 标签分组

分组为**管理型实体**（Warp 风格收敛）：`TabGroup { id, name, color?, persistTabs, collapsed? }` 存 `config.store.tabGroups`（SQLite `tab_groups` 表，实体级 CRUD diff-flush 同 sshGroups），在设置页「标签分组」页维护（新建/行内改名/7 色配色/持久化开关/两步删除）；标签侧不提供建组入口。

- **展示序**（`tabGroupLayout.displaySequence`）：全部组 chip 按定义序在前（空组 chip 常驻，作为投放槽位），成员标签紧随其 chip，未分组标签按数组序在后；chip 点击折叠/展开（`collapsed` 随组定义持久化），折叠含活动标签的组时激活切到组外最近标签（先右后左），折叠组聚合未读铃点、显示 ×N 计数。
- **归属交互**：拖标签到 chip（入组尾）/ 组内标签间（排序）/ 空白区（移出）；标签右键「移入分组」平铺段（无子菜单）；「+」新建标签继承活动标签所在分组；成员标签左缘 2px 组色线（绝对定位不占布局宽，定宽约束不受影响）。组色与标签个人色点**独立不联动**。
- **持久化**：每组 `persistTabs` 开关。开启组的**终端标签**进快照（`{ version:1, entries:[{ groupId, tabs:[{ profileId?, manualTitle?, color? }] }] }`，存 settings 表 `tabSession` 键），500ms 防抖整存整取；重启后 App.vue `onMounted` 先 `loadTabSession` + `restoreSession`（按定义序逐组 `openTerminalTab` 回填 manualTitle/color；档案已删落默认档案），无恢复内容才开首个标签。sftp/settings/forwarding 标签、cwd、分屏、activeId 不恢复。spec：`docs/superpowers/specs/2026-09-20-tab-groups-design.md`。

## 布局层级（曾出过 0 宽度坍塌 bug，改动前先读）

```text
.app-shell (flex column, 100vh)
├── TitleBar
│    └── TabStrip（tabBarPosition=top 时内嵌；bottom 时不渲染）
└── .tab-content (flex:1, position:relative)
    └── .tab-pane (position:absolute inset:0, v-show 切换)
        └── .terminal-tab-content (height:100%, display:flex)
            └── SplitContainer.split-root (flex:1 1 0, min-width/height:0)   ← 必须有 flex 尺寸
└── TabStrip position="bottom"（仅 tabBarPosition=bottom 时）
```

`.split-root` 缺失时根分栏容器按内容计算宽度，而其内容（`.terminal-pane`）是绝对定位不占流内尺寸 → 根容器宽度为 0、终端不可见。该类定义在 `src/components/terminal/TerminalTabContent.vue`。

## TerminalTabContent（`src/components/terminal/TerminalTabContent.vue`）

每个终端标签一棵分屏树（`tree = makeLeaf()` 起步）+ `activeLeafId` + 各窗格标题表 `paneTitles`：

- 激活标签时把 `tabApi` 注册进 `terminalTabApi.current` 并聚焦活动叶；失活/卸载时注销。
- `split/closePane/navigatePane` 操作树（见 [split-panes](split-panes.md)）；活动叶的标题同步为标签标题。
- 暴露给命令面板的动作：`split / closePane / navigatePane / copy / paste / clear / find / getActivePaneCwd`；`split` 为 async——先经 `SplitContainer.getLeafCwd`（递归下钻）取源叶会话 cwd，作为新叶 `SplitLeaf.cwd` 传给 `TerminalPane.initialCwd`（新窗格继承目录）。

## 命令与热键入口

全局键盘事件有两条投递路径汇入同一个热键状态机（`src/services/hotkeysSingleton.ts` 单例）：`App.vue` 的 document 监听（跳过 INPUT/TEXTAREA/SELECT 目标）与 xterm 的 `attachCustomKeyEventHandler`（终端聚焦时）。热键命中后由 `useCommands().dispatchHotkey` 分发。详见 [hotkeys-and-commands](hotkeys-and-commands.md)。

## Related

- [split-panes](split-panes.md)
- [hotkeys-and-commands](hotkeys-and-commands.md)
- [02-frontend/terminal-rendering](terminal-rendering.md)
- [03-backend/capabilities-and-window](../03-backend/capabilities-and-window.md)
