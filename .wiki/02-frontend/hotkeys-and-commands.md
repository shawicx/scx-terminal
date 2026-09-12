# 热键与命令系统

## 文件

| 文件 | 职责 |
| --- | --- |
| `src/services/hotkeys.ts` | `HotkeysService` 按键状态机（移植 tabby-core hotkeys.service） |
| `src/services/hotkeysSingleton.ts` | 懒加载单例 + `hotkeys` 门面（每次查表都读最新配置） |
| `src/lib/hotkeys/hotkeys.ts` | 纯函数：`getKeyName` / `getKeystrokeName` / `parseKeystroke`、`⌘/⌥` 符号常量（单测 `hotkeys.test.ts`） |
| `src/services/commands.ts` | `useCommands()`：命令注册表 + 默认命令 + 热键分发 |

## 事件来源（两路汇入同一状态机）

1. **document 监听**（`src/App.vue` `onKeydown/onKeyup`）：普通 UI 上下文；目标是 INPUT/TEXTAREA/SELECT/可编辑元素时跳过。
2. **xterm `attachCustomKeyEventHandler`**（见 [terminal-rendering](terminal-rendering.md)）：终端聚焦时的按键，以真实事件类型喂入。

## 状态机要点（`HotkeysService.pushKeyEvent`）

- `pressedKeys` + 按下时间戳（2s 过期清理）；keydown 时 `recognitionPhase = true`；keyup 产出 `keystroke$`（设置页录制热键用）并清空按压集合。
- macOS 特性：按住 ⌘ 时系统吞掉非修饰键 keyup，状态机在 metaKey keydown 后**自行合成 keyup**（`pushKeyEvent('keyup', …)` 递归一次）。
- `matchActiveHotkey(partial)`：`getCurrentKeystrokes()`（历史 + 当前）与配置序列匹配；`partial=true` 用于前缀匹配（让 xterm 知道该 keydown 属于热键、不得发给 shell）。多序列命中取最长者。
- `disable()/enable()` 计数（`disabledLevel`）：命令面板打开时暂停全局热键。
- `wheel/mouseup/auxclick` 也入机（修饰键状态保持）。

## 命令注册表（`src/services/commands.ts`）

命令对象 `{ id, group, label(): string, hotkeyId?, enabled?, handler() }`；`useCommands()` 提供 `register/registerDefaults/bindHotkeys/dispatchHotkey/sortedCommands`。

默认命令（`registerDefaults`）：`new-tab`、`close-tab`、`next-tab`、`prev-tab`、`split-right`、`split-down`、`close-pane`、`pane-forward`、`pane-back`、`copy`、`paste`、`clear`、`find`、`command-palette`、`open-settings`、`toggle-color-scheme`。标签/窗格类命令经 `terminalTabApi.current`（见 [app-shell-and-tabs](app-shell-and-tabs.md)）驱动当前激活的终端标签；`toggle-color-scheme` 在两套默认配色间切换。

`bindHotkeys()` 订阅 `hotkeys.hotkey$` → `dispatchHotkey(id)`。

## 默认热键（`src/stores/config.ts` `defaultHotkeys()`）

| 动作 | macOS | 其它平台 |
| --- | --- | --- |
| 命令面板 | ⌘⇧P | Ctrl+Shift+P |
| 新建/关闭标签 | ⌘T / ⌘W | Ctrl+Shift+T / W |
| 切换标签 | ⌘⇧] / ⌘⇧[ | Ctrl+Shift+] / [ |
| 右/下分屏 | ⌘D / ⌘⇧D | Ctrl+Shift+D / E |
| 关窗格、窗格导航 | ⌘⌥W、⌘⌥←→ | Ctrl+Shift+X、Ctrl+Alt+←→ |
| 复制/粘贴 | ⌘C / ⌘V | Ctrl+Shift+C / V |
| 清屏/搜索 | ⌘K / ⌘F | Ctrl+Shift+K / F |

注意：`⌘V` 实际由 xterm 前端拦截转应用级粘贴（不进热键机）；macOS 去掉应用菜单后 ⌘W 不再直接关窗口（见 [03-backend/capabilities-and-window](../03-backend/capabilities-and-window.md)）。

## 命令面板（`src/components/palette/CommandPalette.vue`）

模糊搜索（`src/lib/utils/fuzzy.ts`）`sortedCommands`，回车执行；打开时 `hotkeys.disable()`，关闭 `enable()`。

## 已知坑（历史）

- 早期默认序列写作 `'⌘-⌥-ArrowRight'` / `'⌘-Alt-W'`，与 `getKeyName` 的实际产出（macOS 方向键剥 `Arrow` 前缀、Alt 映射为 `⌥`）不一致，窗格导航/关窗格热键永不匹配。已修复：默认值改为解析器产出，且 `config.ts` 加载配置时经 `normalizeHotkeysConfig`（`src/lib/hotkeys/hotkeys.ts`）对旧值做归一化兼容；回归测试锁定默认值与 `getKeyName` 产出一致（`config.test.ts`）。

## Related

- [app-shell-and-tabs](app-shell-and-tabs.md)
- [config-and-theming](config-and-theming.md)
