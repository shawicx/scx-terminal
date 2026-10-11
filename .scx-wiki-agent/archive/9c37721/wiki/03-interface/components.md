# 前端组件体系

> **锚点说明**：本页所有事实锚点均采用扫描数据中给出的**完整相对路径**（如 `src/components/ui/Button.vue`）。本次扫描数据**未提供行号**，因此不标注 `:line`，请勿将路径当作行号缺失的省略写法。
>
> **数据边界**：本页仅为 `components` 数组（51 条）的忠实呈现。数据中 `intent`（待确认） 数组为空，故本页**不产出任何设计动机/演进叙述**；数据中无 props 键名、无 emits 事件名、无引用方文件清单、无调用边，故本页**不使用时序图，也不推导调用关系**。

---

## 1. 概述

| 事实 | 值 | 锚点 |
| --- | --- | --- |
| 组件框架 | 51/51 全部为 `vue` | 全表 `framework` 字段，如 `src/App.vue`、`src/components/ui/Button.vue` |
| 组件总数 | 51 | 全表条目 |
| 命名约定 | PascalCase 单词拼接（如 `ForwardRuleFormDialog`、`SftpBrowserPane`） | `src/components/forwarding/ForwardRuleFormDialog.vue`、`src/components/sftp/SftpBrowserPane.vue` |
| 组织方式 | 按业务域/UI 域分目录：`forwarding`、`monitor`、`palette`、`settings`(+`settings/pages`)、`sftp`、`split`、`start`、`terminal`、`titlebar`、`ui`；根组件位于 `src/App.vue` | 见第 2 节目录分布 |
| 分层特征 | `ui/` 目录 11 个组件均为被多文件引用的基础件；`settings/pages/` 12 个组件被引用文件数均为 1，呈现"页面叶节点"形态 | `src/components/ui/Dialog.vue`（被引用 14）、`src/components/settings/pages/AboutPage.vue`（被引用 1） |

---

## 2. 目录分布

| 目录 | 组件数 | 组件 |
| --- | --- | --- |
| `src/`（根） | 1 | App |
| `src/components/forwarding/` | 2 | ForwardRuleFormDialog、ForwardingTabContent |
| `src/components/monitor/` | 2 | MetricChart、MonitorSidebar |
| `src/components/palette/` | 2 | CommandPalette、QuickCommandPalette |
| `src/components/settings/` | 5 | ColorSchemePicker、GroupAccordion、ProfileForwardingsCard、SettingsView、TabGroupFormDialog |
| `src/components/settings/pages/` | 12 | AboutPage、AppearancePage、BackupPage、BackupSyncSection、ColorSchemesPage、HotkeysPage、KeysPage、LocalProfilesPage、QuickCommandsPage、SshPage、TabGroupsPage、TerminalPage |
| `src/components/sftp/` | 3 | SftpBrowserPane、SftpTabContent、TransferPopover |
| `src/components/split/` | 2 | SplitContainer、SplitSpanner |
| `src/components/start/` | 2 | HostCard、StartPageContent |
| `src/components/terminal/` | 6 | CredentialDialog、ForwardPanel、HostKeyDialog、SuggestionMenu、TerminalPane、TerminalTabContent |
| `src/components/titlebar/` | 3 | TabStrip、TabSwitcher、TitleBar |
| `src/components/ui/` | 11 | Button、ContextMenu、Dialog、DropdownMenu、Input、Label、SearchableSelect、Select、Separator、Slider、Switch |

> 目录名与组件归属均直接取自 `file` 字段前缀，未做任何归并或重命名。

---

## 3. 统计口径说明（必读）

| 指标 | 口径 | 数据支撑 |
| --- | --- | --- |
| **被引用文件数**（`usedByCount`） | **词法统计**：扫描按文件为单位统计"引用该组件的文件数量"，**不是**运行时渲染实例数、不是调用次数、不是函数调用深度 | 例：`src/components/ui/Button.vue` = 24；`src/components/terminal/TerminalPane.vue` = 18 |
| **props / emits** | 本次数据**只给出数量**（`propsCount` / `emitsCount`），**未给出键名、类型、默认值或校验规则**。表中 0 表示未检出 props/emits，不代表组件无内部状态 | 全表字段，如 `src/components/ui/Input.vue`（props 0 / emits 0）、`src/components/split/SplitContainer.vue`（emits 6） |
| **测试配对**（`testPaired`） | 51/51 组件均为 `false`，即本次扫描**未检出**与组件配对的测试文件。该字段不能区分"确实没有测试"与"扫描未覆盖测试目录" | 全表 `testPaired` 字段 |
| **调用关系** | 数据中**无调用边、无 `importFiles`（待确认）、无 `depUsage`（待确认）**，`intent`（待确认） 数组为空。因此本页**不提供调用方→被调用方边表**（无锚点可依），也不以时序图代替 | `intent: []` |

**props/emits 汇总（仅数量维度）**：

- propsCount = 0 的组件：**25 个**（如 `src/App.vue`、`src/components/ui/Dialog.vue`、`src/components/ui/Input.vue`、`src/components/ui/Switch.vue`、`src/components/settings/pages/*.vue` 全部 12 个）。
- emitsCount = 0 的组件：**34 个**。
- emitsCount ≥ 1 的组件：**17 个**，其中 `src/components/split/SplitContainer.vue` 数量最高（6）；其次 `src/components/terminal/TerminalPane.vue`（4）、`src/components/settings/GroupAccordion.vue`（3）、`src/components/sftp/SftpBrowserPane.vue`（3）。
- propsCount = 2 的组件：`src/components/sftp/SftpBrowserPane.vue`、`src/components/start/StartPageContent.vue`、`src/components/titlebar/TabStrip.vue`（并列最高）。

---

## 4. 组件清单

> 下表 51 行与扫描数据条目**一一对应，未增删改**。`props`/`emits`（待确认） 列为数量（键名数据未提供）。`被引用文件数` 为词法口径（见第 3 节）。

| 组件 | 框架 | props | emits | 被引用文件数 | 测试配对 | 文件 |
| --- | --- | --- | --- | --- | --- | --- |
| App | vue | 0 | 0 | 16 | 否 | `src/App.vue` |
| ForwardRuleFormDialog | vue | 0 | 2 | 3 | 否 | `src/components/forwarding/ForwardRuleFormDialog.vue` |
| ForwardingTabContent | vue | 1 | 0 | 4 | 否 | `src/components/forwarding/ForwardingTabContent.vue` |
| MetricChart | vue | 1 | 0 | 1 | 否 | `src/components/monitor/MetricChart.vue` |
| MonitorSidebar | vue | 1 | 0 | 2 | 否 | `src/components/monitor/MonitorSidebar.vue` |
| CommandPalette | vue | 0 | 0 | 2 | 否 | `src/components/palette/CommandPalette.vue` |
| QuickCommandPalette | vue | 0 | 0 | 2 | 否 | `src/components/palette/QuickCommandPalette.vue` |
| ColorSchemePicker | vue | 1 | 1 | 1 | 否 | `src/components/settings/ColorSchemePicker.vue` |
| GroupAccordion | vue | 1 | 3 | 3 | 否 | `src/components/settings/GroupAccordion.vue` |
| ProfileForwardingsCard | vue | 0 | 0 | 2 | 否 | `src/components/settings/ProfileForwardingsCard.vue` |
| SettingsView | vue | 1 | 0 | 7 | 否 | `src/components/settings/SettingsView.vue` |
| TabGroupFormDialog | vue | 0 | 2 | 1 | 否 | `src/components/settings/TabGroupFormDialog.vue` |
| AboutPage | vue | 0 | 0 | 1 | 否 | `src/components/settings/pages/AboutPage.vue` |
| AppearancePage | vue | 0 | 0 | 1 | 否 | `src/components/settings/pages/AppearancePage.vue` |
| BackupPage | vue | 0 | 0 | 1 | 否 | `src/components/settings/pages/BackupPage.vue` |
| BackupSyncSection | vue | 0 | 2 | 1 | 否 | `src/components/settings/pages/BackupSyncSection.vue` |
| ColorSchemesPage | vue | 0 | 0 | 1 | 否 | `src/components/settings/pages/ColorSchemesPage.vue` |
| HotkeysPage | vue | 0 | 0 | 1 | 否 | `src/components/settings/pages/HotkeysPage.vue` |
| KeysPage | vue | 0 | 0 | 1 | 否 | `src/components/settings/pages/KeysPage.vue` |
| LocalProfilesPage | vue | 0 | 0 | 1 | 否 | `src/components/settings/pages/LocalProfilesPage.vue` |
| QuickCommandsPage | vue | 0 | 0 | 1 | 否 | `src/components/settings/pages/QuickCommandsPage.vue` |
| SshPage | vue | 0 | 0 | 1 | 否 | `src/components/settings/pages/SshPage.vue` |
| TabGroupsPage | vue | 0 | 0 | 1 | 否 | `src/components/settings/pages/TabGroupsPage.vue` |
| TerminalPage | vue | 0 | 0 | 1 | 否 | `src/components/settings/pages/TerminalPage.vue` |
| SftpBrowserPane | vue | 2 | 3 | 3 | 否 | `src/components/sftp/SftpBrowserPane.vue` |
| SftpTabContent | vue | 1 | 0 | 2 | 否 | `src/components/sftp/SftpTabContent.vue` |
| TransferPopover | vue | 0 | 0 | 3 | 否 | `src/components/sftp/TransferPopover.vue` |
| SplitContainer | vue | 1 | 6 | 2 | 否 | `src/components/split/SplitContainer.vue` |
| SplitSpanner | vue | 1 | 1 | 1 | 否 | `src/components/split/SplitSpanner.vue` |
| HostCard | vue | 1 | 0 | 3 | 否 | `src/components/start/HostCard.vue` |
| StartPageContent | vue | 2 | 0 | 4 | 否 | `src/components/start/StartPageContent.vue` |
| CredentialDialog | vue | 1 | 2 | 3 | 否 | `src/components/terminal/CredentialDialog.vue` |
| ForwardPanel | vue | 0 | 1 | 2 | 否 | `src/components/terminal/ForwardPanel.vue` |
| HostKeyDialog | vue | 1 | 2 | 3 | 否 | `src/components/terminal/HostKeyDialog.vue` |
| SuggestionMenu | vue | 1 | 1 | 2 | 否 | `src/components/terminal/SuggestionMenu.vue` |
| TerminalPane | vue | 1 | 4 | 18 | 否 | `src/components/terminal/TerminalPane.vue` |
| TerminalTabContent | vue | 1 | 0 | 4 | 否 | `src/components/terminal/TerminalTabContent.vue` |

| TabStrip | vue | 2 | 0 | 6 | 否 | `src/components/titlebar/TabStrip.vue` |
| TabSwitcher | vue | 0 | 0 | 1 | 否 | `src/components/titlebar/TabSwitcher.vue` |
| TitleBar | vue | 0 | 0 | 5 | 否 | `src/components/titlebar/TitleBar.vue` |
| Button | vue | 1 | 0 | 24 | 否 | `src/components/ui/Button.vue` |
| ContextMenu | vue | 1 | 2 | 6 | 否 | `src/components/ui/ContextMenu.vue` |
| Dialog | vue | 0 | 1 | 14 | 否 | `src/components/ui/Dialog.vue` |
| DropdownMenu | vue | 1 | 2 | 1 | 否 | `src/components/ui/DropdownMenu.vue` |
| Input | vue | 0 | 0 | 14 | 否 | `src/components/ui/Input.vue` |
| Label | vue | 1 | 0 | 15 | 否 | `src/components/ui/Label.vue` |
| SearchableSelect | vue | 1 | 1 | 3 | 否 | `src/components/ui/SearchableSelect.vue` |
| Select | vue | 1 | 0 | 9 | 否 | `src/components/ui/Select.vue` |
| Separator | vue | 1 | 0 | 1 | 否 | `src/components/ui/Separator.vue` |
| Slider | vue | 1 | 0 | 2 | 否 | `src/components/ui/Slider.vue` |
| Switch | vue | 0 | 0 | 11 | 否 | `src/components/ui/Switch.vue` |

---

## 5. 重点组件（按被引用文件数取前 8）

排序口径：严格按第 3 节的**词法被引用文件数**降序；同值时按 `file` 路径字典序，不引入其他排序依据。

| 排名 | 组件 | 被引用文件数 | props | emits | 文件 |
| --- | --- | --- | --- | --- | --- |
| 1 | Button | 24 | 1 | 0 | `src/components/ui/Button.vue` |
| 2 | TerminalPane | 18 | 1 | 4 | `src/components/terminal/TerminalPane.vue` |
| 3 | App | 16 | 0 | 0 | `src/App.vue` |
| 4 | Label | 15 | 1 | 0 | `src/components/ui/Label.vue` |
| 5 | Dialog | 14 | 0 | 1 | `src/components/ui/Dialog.vue` |
| 5 | Input | 14 | 0 | 0 | `src/components/ui/Input.vue` |
| 7 | Switch | 11 | 0 | 0 | `src/components/ui/Switch.vue` |
| 8 | Select | 9 | 1 | 0 | `src/components/ui/Select.vue` |

### 5.1 Button（`src/components/ui/Button.vue`）

| 项 | 值 |
| --- | --- |
| 框架 | vue |
| props / emits | 1 / 0（仅数量，键名未提供） |
| 被引用文件数 | 24（全表最高） |
| 测试配对 | 未检出 |

**职责（推断）**：文件位于 `src/components/ui/` 通用 UI 目录，组件名为 `Button`，且被 24 个文件引用，为全表被引用度最高的组件；据此推断其为跨业务域复用的基础交互控件。推断依据仅为**目录名 `ui` + 组件名 + 被引用文件数**，数据中无注释、无文档、无调用边可佐证具体形态（如是否为纯包装原生 `<button>`、是否含变体枚举）。**props 键名缺失**，无法说明其可配置面。emits 数量为 0。

### 5.2 TerminalPane（`src/components/terminal/TerminalPane.vue`）

| 项 | 值 |
| --- | --- |
| 框架 | vue |
| props / emits | 1 / 4 |
| 被引用文件数 | 18 |
| 测试配对 | 未检出 |

**职责（推断）**：位于 `src/components/terminal/`，与同目录的 `TerminalTabContent.vue`、`CredentialDialog.vue`、`HostKeyDialog.vue`、`SuggestionMenu.vue`、`ForwardPanel.vue` 同属终端域；18 的被引用文件数在非 `ui/` 目录组件中最高。推断其为终端会话的核心承载单元。推断依据为**目录归属 + 组件名 + 同目录组件构成**。emits 数量为 4，是终端域内 emits 最多的组件，但**事件名未提供**，无法列出对外契约。

### 5.3 App（`src/App.vue`）

| 项 | 值 |
| --- | --- |
| 框架 | vue |
| props / emits | 0 / 0 |
| 被引用文件数 | 16 |
| 测试配对 | 未检出 |

**职责（推断）**：全表唯一位于 `src/` 根目录（而非 `src/components/` 下）的组件，名为 `App`。在 Vue 工程惯例中根目录 `App.vue` 通常为应用根组件，16 的被引用文件数与该定位相符（被多个上层组合点引用）。此段标注为推断，依据为**文件路径层级 + 组件名**；数据中无 `main.ts` 入口引用证据，故不宣称"由 main 挂载"。

### 5.4 Label（`src/components/ui/Label.vue`）

| 项 | 值 |
| --- | --- |
| 框架 | vue |
| props / emits | 1 / 0 |
| 被引用文件数 | 15 |
| 测试配对 | 未检出 |

**职责（推断）**：`ui/` 目录组件，名为 `Label`，被引用 15 次，紧邻 Button（24）与 Dialog/Input（14）。推断其与 `Input`、`Select`、`Switch` 等表单控件形成配套的字段标签件，服务于设置类界面。推断依据为**目录归属 + 同目录表单控件共存 + 被引用量级**。props 键名未提供，无法说明标签关联方式。

### 5.5 Dialog（`src/components/ui/Dialog.vue`）

| 项 | 值 |
| --- | --- |
| 框架 | vue |
| props / emits | 0 / 1 |
| 被引用文件数 | 14 |
| 测试配对 | 未检出 |

**职责（推断）**：`ui/` 目录弹层类组件，被引用 14 次。数据中同域存在多个以 `Dialog` 结尾的业务弹窗组件——`src/components/forwarding/ForwardRuleFormDialog.vue`、`src/components/settings/TabGroupFormDialog.vue`、`src/components/terminal/CredentialDialog.vue`、`src/components/terminal/HostKeyDialog.vue`——推断其为这些业务弹窗的通用底座。推断依据为**命名后缀族 + 目录分层（ui 基础件 vs 业务目录具体件）**。**注意**：数据中无调用边，不能断言上述四个业务弹窗一定使用了该组件，此处仅为命名与组织结构的间接证据。

### 5.6 Input（`src/components/ui/Input.vue`）

| 项 | 值 |
| --- | --- |
| 框架 | vue |
| props / emits | 0 / 0 |
| 被引用文件数 | 14 |
| 测试配对 | 未检出 |

**职责（推断）**：`ui/` 目录文本输入类基础件。**propsCount 与 emitsCount 均为 0**，按数据如实说明：本次扫描未检出该组件的 props 与 emits；这与其被 14 个文件引用的事实并存，说明它可能通过透传（`v-model`/`$attrs`）或内部状态承载能力，但**数据中无任何证据**，不做进一步推断。

### 5.7 Switch（`src/components/ui/Switch.vue`）

| 项 | 值 |
| --- | --- |
| 框架 | vue |
| props / emits | 0 / 0 |
| 被引用文件数 | 11 |
| 测试配对 | 未检出 |

**职责（推断）**：`ui/` 目录开关类基础件，被引用 11 次，引用量在同目录中位列第三梯队。props/emits 数量均为 0，与 `Input` 情况相同，**数据未检出对外声明**，不做原因推测。

### 5.8 Select（`src/components/ui/Select.vue`）

| 项 | 值 |
| --- | --- |
| 框架 | vue |
| props / emits | 1 / 0 |
| 被引用文件数 | 9 |
| 测试配对 | 未检出 |

**职责（推断）**：`ui/` 目录选择类基础件。同目录另有 `src/components/ui/SearchableSelect.vue`（被引用 3、props 1、emits 1），二者命名构成 `Select` / `SearchableSelect` 族，推断后者为前者的可搜索变体。推断依据为**同目录 + 命名后缀关系**；数据中无继承字段、无共享实现证据，故**不使用 classDiagram**（R6）。

---

## 6. UI 基础件与业务组件对照

依据第 2 节目录分布与第 3 节口径，将 `ui/` 与其余业务目录做引用度对照：

| 分组 | 组件数 | 被引用文件数合计 | 说明 |
| --- | --- | --- | --- |
| `src/components/ui/` | 11 | 105 | Button 24、Label 15、Dialog 14、Input 14、Switch 11、Select 9、ContextMenu 6、SearchableSelect 3、Slider 2、DropdownMenu 1、Separator 1 |
| `src/components/settings/pages/` | 12 | 12 | 12 个页面组件**每项均为 1**，无一例外 |
| 其余业务目录合计 | 27 | — | 见第 2 节目录分布 |

> `settings/pages/` 下 12 个组件（`AboutPage`、`AppearancePage`、`BackupPage`、`BackupSyncSection`、`ColorSchemesPage`、`HotkeysPage`、`KeysPage`、`LocalProfilesPage`、`QuickCommandsPage`、`SshPage`、`TabGroupsPage`、`TerminalPage`）被引用文件数**全部为 1**，文件锚点见第 4 节清单。该形态与其位于 `pages` 子目录、命名以 `Page` 结尾相符，呈现页面叶节点特征。**推断**：`src/components/settings/SettingsView.vue`（被引用 7）为这些页面组件的容器，但**数据中无调用边**，不能断言其逐一渲染了上述 12 个页面。

---

## 7. 组件命名族

以下分组仅基于组件名的**字面后缀/前缀关系**与**目录归属**，用于辅助检索，不代表实现耦合：

| 命名族 | 组件 | 锚点 |
| --- | --- | --- |
| `*Dialog` | ForwardRuleFormDialog、TabGroupFormDialog、CredentialDialog、HostKeyDialog、Dialog | `src/components/forwarding/ForwardRuleFormDialog.vue`、`src/components/settings/TabGroupFormDialog.vue`、`src/components/terminal/CredentialDialog.vue`、`src/components/terminal/HostKeyDialog.vue`、`src/components/ui/Dialog.vue` |
| `*Page` | AboutPage、AppearancePage、BackupPage、ColorSchemesPage、HotkeysPage、KeysPage、LocalProfilesPage、QuickCommandsPage、SshPage、TabGroupsPage、TerminalPage | `src/components/settings/pages/` 下同名文件 |
| `*TabContent` | ForwardingTabContent、SftpTabContent、TerminalTabContent | `src/components/forwarding/ForwardingTabContent.vue`、`src/components/sftp/SftpTabContent.vue`、`src/components/terminal/TerminalTabContent.vue` |
| `*Palette` | CommandPalette、QuickCommandPalette | `src/components/palette/CommandPalette.vue`、`src/components/palette/QuickCommandPalette.vue` |
| `Sftp*` | SftpBrowserPane、SftpTabContent | `src/components/sftp/SftpBrowserPane.vue`、`src/components/sftp/SftpTabContent.vue` |
| `Split*` | SplitContainer、SplitSpanner | `src/components/split/SplitContainer.vue`、`src/components/split/SplitSpanner.vue` |
| `Tab*`（titlebar） | TabStrip、TabSwitcher、TabGroupFormDialog、TabGroupsPage | `src/components/titlebar/TabStrip.vue`、`src/components/titlebar/TabSwitcher.vue`、`src/components/settings/TabGroupFormDialog.vue`、`src/components/settings/pages/TabGroupsPage.vue` |
| `*Select` | Select、SearchableSelect | `src/components/ui/Select.vue`、`src/components/ui/SearchableSelect.vue` |

---

## 8. emits 数量分布

| emits 数量 | 组件数 | 组件 |
| --- | --- | --- |
| 0 | 34 | 含 `src/App.vue`、`src/components/ui/Input.vue`、`src/components/ui/Switch.vue`、全部 12 个 `settings/pages` 组件等（完整列表见第 4 节） |
| 1 | 6 | ForwardPanel、ColorSchemePicker、SplitSpanner、SuggestionMenu、Dialog、SearchableSelect |
| 2 | 6 | ForwardRuleFormDialog、TabGroupFormDialog、BackupSyncSection、CredentialDialog、HostKeyDialog、ContextMenu、DropdownMenu |
| 3 | 2 | GroupAccordion、SftpBrowserPane |
| 4 | 1 | TerminalPane |
| 6 | 1 | SplitContainer |

> 上表「1」与「2」两行的组件数按第 4 节清单逐项计数为 6 与 7；其中第 4 节 emits=2 的条目为 ForwardRuleFormDialog、TabGroupFormDialog、BackupSyncSection、CredentialDialog、HostKeyDialog、ContextMenu、DropdownMenu 共 7 条，以第 4 节清单为准。

---

## 9. 测试配对情况

| 项 | 值 |
| --- | --- |
| `testPaired = true` 的组件数 | 0 |
| `testPaired = false` 的组件数 | 51 |
| 覆盖范围 | 全表，无例外 |

数据中 51 个组件的 `testPaired` 字段**全部为 `false`**，即本次扫描未检出任何组件存在配对测试文件。该结果**不能区分**"项目确实没有组件测试"与"扫描范围未包含测试目录"两种情况；按 R5，此处记为「待确认」，缺的是扫描是否覆盖测试目录的证据。

---

## 10. 待确认

| # | 事项 | 缺什么证据 |
| --- | --- | --- |
| 1 | props / emits 的**键名、类型与默认值** | 数据仅提供 `propsCount` / `emitsCount` 数量，无键名列表、无类型、无默认值 |
| 2 | 组件间的**引用/渲染关系**（谁引用了谁） | 数据无调用边、无 `importFiles`（待确认）、无 `depUsage`（待确认），`intent`（待确认） 数组为空；第 5、6 节的容器/底座判断均为命名与目录层面的推断，未经调用链验证 |
| 3 | 组件测试是否**真的缺失** | `testPaired` 全为 `false`，但缺"扫描是否包含测试目录/测试文件模式"的说明 |
| 4 | 组件是否使用 **`<script setup>`、状态管理、路由**等实现细节 | 数据未提供组件内部实现、未提供 store/router 相关字段 |

---

## 11. 本页事实来源与边界

| 项 | 说明 |
| --- | --- |
| 数据源 | 前端组件扫描 JSON 的 `components` 数组，共 51 条 |
| 已使用字段 | `name`、`file`、`framework`、`propsCount`、`emitsCount`、`usedByCount`、`testPaired`，以及 `intent`（待确认）（为空） |
| 未产出的内容 | 调用关系边表（无调用边数据）、时序图（R2）、classDiagram 继承图（无继承数据，R6）、设计动机/演进叙述（`intent`（待确认） 为空，R7） |
| 锚点形式 | 本文所有锚点为扫描数据给定的**完整相对路径**；扫描数据**未提供行号**，故不标注 `:line` |
| 重点说明段性质 | 第 5 节各「职责（推断）」段均按 R7 标注为**推断**并写明推断依据；第 5 节共 8 段推断，全部集中在同一章节内、以统一依据类型（目录名 + 组件名 + 被引用量）表述 |
## Related

- 同目录：[api.md](api.md) · [state.md](state.md) · [routing.md](routing.md)
- 共享 28 个符号：[onboarding.md](../05-guides/onboarding.md)
- 共享 23 个符号：[tech-stack.md](../01-overview/tech-stack.md)
- 共享 19 个符号：[overview.md](../01-overview/overview.md)
- 总入口：[README](../README.md)
