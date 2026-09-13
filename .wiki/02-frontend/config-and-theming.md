# 配置与主题系统

## 配置持久化（`src/stores/config.ts`）

`ConfigStore` 四段结构（默认值见 `defaultConfig()`）：

- `terminal`：font/fontSize/linePadding/cursor/cursorBlink/altIsMeta/scrollbackLines/wordSeparator/drawBoldTextInBrightColors/fontWeight(Bold)/minimumContrastRatio/copyOnSelect/paletteGenerate/paletteHarmonious/backspace/inputNewlines/outputNewlines/loginShell（仅作档案生成种子，运行期看档案字段）。
- `appearance`：`colorScheme: string`（`'auto'` | 旧值 `'dark'`/`'light'` | 内置配色名，默认 `'auto'`）、`tabBarPosition`（死键）、`theme`（死键）、`language`。
- `profiles`：`TerminalProfile[]`——`{ id, type: 'local', name, command, args, env, cwd, colorScheme(null=跟随全局), loginShell, isDefault }`；`type` 判别字段为 SSH 等远程档案预留。
- `hotkeys`：`Record<hotkeyId, string[][]>`（每个热键多组按键序列；macOS 默认含 ⌘ 前缀，见 `defaultHotkeys()`，平台判断来自 `src/lib/platform.ts`）。

机制：启动时 `config_load` 读 YAML → `deepMerge(默认值, 用户值)`（未知键丢弃，数组整体替换）→ **`normalizeHotkeysConfig` 归一化热键键名**（`Arrow*`/`Alt`/`Meta` 等旧别名 → `getKeyName` 产出）→ **用户配置无 `profiles` 键时由 `list_shells` 生成默认档案**（`profilesFromShells`，系统默认 shell 标 `isDefault`，生成后自动持久化；键存在即使空数组也不再生成的）。测试见 `config.test.ts` / `hotkeys.test.ts`；store 深度 watch 后 500ms 防抖全量快照 `config_save`。文件位置由 Rust 侧决定（`~/Library/Application Support/scx-terminal/config.yaml`，原子写 + `.backup`，见 [03-backend/commands-and-config](../03-backend/commands-and-config.md)）。store 另提供 `defaultProfile()`（isDefault 优先兜底第一个）与 `setDefaultProfile(id)`。

## 配色库（`src/lib/colorSchemes.ts`）

- `TerminalColorScheme = { name, foreground, background, cursor, cursorAccent?, selection?, selectionForeground?, colors[16] }`。
- `builtinColorSchemes`：**16 套**——scx-terminal Dark/Light（默认两套）+ Dracula、Nord、Solarized Dark/Light、One Dark/Light、Gruvbox Dark、Monokai、Tokyo Night、Catppuccin Mocha、Campbell、Ubuntu、Snazzy、Base16 Default Dark。
- `resolveColorScheme(preference, systemPrefersLight)`：`'dark'`/`'light'`（旧值）→ 默认深/浅配色；`'auto'` → 按系统；其余按配色名 `findColorScheme`，找不到回退系统深浅对应默认配色。**前端唯一配色解析入口**（`frontendContext.colorScheme()` 与 theme store 都走它）。
- 单测：`src/lib/colorSchemes.test.ts`（含唯一名、16 色、旧值兼容、派生 token 键集合恒定）。

## 界面跟随配色（Tabby 式）

**`src/lib/schemeColors.ts`**（纯函数，可测）：

- `parseHexColor`（#rgb/#rrggbb/#rrggbbaa）、`rgbaToCss`、`relativeLuminance`（WCAG）、`mixColors`。
- `isColorSchemeDark(scheme)`：背景相对亮度 < 0.2 判深色。
- `deriveChromeTokens(scheme)`：从配色派生**固定键集**的 CSS 变量——背景/前景直取配色；`--card/--popover/--secondary/--muted`（背景向前景混 5–8%）、`--accent`（12%）、`--border`（16%）、`--input`（10%）；`--primary` 取蓝色槽位（深色配色取亮蓝 `colors[12]`、浅色取标准蓝 `colors[4]`）；`--ring` 为主色 60% 透明；另有 `--term-scrollbar-thumb/track`。

**`src/stores/theme.ts`**：`apply()` = `resolveColorScheme` → `isDark` 按配色背景亮度 → 切换 `<html>.dark` 类（决定未覆盖 token 的静态深/浅基底，定义在 `src/assets/styles/main.css`）→ `deriveChromeTokens` 逐键 `setProperty` 注入 `<html>` 内联样式（覆盖 `:root/.dark` 的同名 token）→ `epoch++`。触发时机：初始化、`appearance.colorScheme` 变化、系统亮暗变化。

**生效路径**：`main.css` 的 `@theme inline` 把 `--background/--foreground/...` 映射为 Tailwind 的 `--color-*` 工具变量，组件（TitleBar/SettingsView/CommandPalette 等）全部消费这些变量 → 切配色即整个界面变色；终端区由 `epoch` 触发 `configureColors`（见 [terminal-rendering](terminal-rendering.md)）；终端滚动条经 `xterm.css` 的 `var(--term-scrollbar-*)`。

## 设置 UI（`src/components/settings/SettingsView.vue`）

五个页面：**档案**（导航第一位，对齐 Tabby 的 Profiles & connections）/ 终端 / 外观 / 快捷键 / 关于。

**档案页**：左侧档案列表（名称 + 命令 + 默认徽标 + "新建档案"）+ 右侧编辑器（名称/命令/参数（空格分隔）/初始工作目录/环境变量（每行 KEY=VALUE）/配色（跟随全局/自动/内置）/登录 shell 开关/设为默认/删除）。编辑直接写响应式 store 对象并经深度 watch 持久化；删除默认档案时自动提升第一个剩余档案为默认。

终端页控件：字号/字体/行距/光标样式/闪烁/回滚行数/选中即复制/Alt 作 Meta/最小对比度、退格键行为、输入/输出换行转换（`null` 在 UI 以"不转换"占位）、双击选词分隔符、粗体亮色。外观页的"配色方案"下拉 = `自动` + 全部内置配色名，绑定 `store.appearance.colorScheme`，改动即时生效（config 深度 watch + theme epoch）。快捷键页通过 `hotkeys.keystroke$` 录制按键序列。命令面板的"切换配色方案"命令在两套默认配色间切换（保持与下拉值域一致）。

注意：退格/换行/OSC 52 等中间件配置在会话构造期读取，**对新开标签生效**（设置页有提示文案）；档案编辑对已运行会话无影响，新窗格取新值。

## Related

- [terminal-rendering](terminal-rendering.md)
- [04-guides/key-flows](../04-guides/key-flows.md)
- [03-backend/commands-and-config](../03-backend/commands-and-config.md)
