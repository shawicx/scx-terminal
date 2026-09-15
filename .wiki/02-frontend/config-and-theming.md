# 配置与主题系统

## 配置持久化（`src/stores/config.ts`）

`ConfigStore` 四段结构（默认值见 `defaultConfig()`）：

- `terminal`：font/fontSize/linePadding/cursor/cursorBlink/altIsMeta/scrollbackLines/wordSeparator/drawBoldTextInBrightColors/fontWeight(Bold)/minimumContrastRatio/copyOnSelect/paletteGenerate/paletteHarmonious/backspace/inputNewlines/outputNewlines/loginShell（仅作档案生成种子，运行期看档案字段）。
- `appearance`：`colorScheme: string`（`'auto'` | 旧值 `'dark'`/`'light'` | 内置配色名，默认 `'auto'`）、`tabBarPosition`（死键）、`theme`（死键）、`language`。
- `profiles`：`TerminalProfile = LocalProfile | SshProfile`（type 判别联合）。`LocalProfile = { id, type: 'local', name, command, args, env, cwd, colorScheme(null=跟随全局), loginShell, isDefault }`；`SshProfile = { id, type: 'ssh', name, host, port(默认22), user, auth('auto'|'agent'|'publicKey'|'password'), keyId(密钥链条目引用，私钥/口令加密存 SQLite 见 sessions-and-middleware), colorScheme, isDefault }`（不含明文凭据字段；load 时 sanitize 清理旧版 password/privateKeyPath 残留）。profiles 数组在 deepMerge 中整体替换——SSH 字段原样存活（回归测试覆盖）。
- `colorSchemes`：`TerminalColorScheme[]`——用户自定义配色（详见下文配色库）。
- `hotkeys`：`Record<hotkeyId, string[][]>`（每个热键多组按键序列；macOS 默认含 ⌘ 前缀，见 `defaultHotkeys()`，平台判断来自 `src/lib/platform.ts`）。

机制：启动时 `config_load` 读 SQLite 聚合快照（`app_data_dir/config.db`，Rust 侧实体表见 [03-backend/commands-and-config](../03-backend/commands-and-config.md)）→ `deepMerge(默认值, 用户值)`（未知键丢弃，数组整体替换）→ **`normalizeHotkeysConfig` 归一化热键键名**（`Arrow*`/`Alt`/`Meta` 等旧别名 → `getKeyName` 产出）→ **用户配置无 `profiles` 键时由 `list_shells` 生成默认档案**（`profilesFromShells`，系统默认 shell 标 `isDefault` 且置顶，生成后自动持久化；键存在即使空数组也不再生成的）。快照为 null（全新库）时走**一次性 legacy 迁移**：`config_load_legacy_yaml` 读旧 `config.yaml` → 前端解析合并 → 空基线强制全量落库 → `config_archive_legacy_yaml` 改名归档。
**写路径为差异 flush**：组件照旧直接改 store；**持久化 watch 在 store setup 同步流创建**（⚠️ 在 load() 的 await 之后创建的 watch 在 WKWebView 实测不触发回调；getter 数组 + deep 逐分片建依赖，theme store 同款模式），回调经 500ms 防抖后，`computeOps(store, lastSaved)`（纯函数，`stableStringify` 键排序串比对）把变更 diff 成实体级 CRUD 命令（`diffById` 按造 id 增改删、配色按 name、热键逐 action、terminal/appearance 分片级 set），逐条 invoke 并按条提交基线——部分失败仅重试剩余差异。flush 进行中到达的变更记 pending，结束后重排。集成测试 `config.flush.test.ts`（mock invoke 内存 DB）覆盖全链路。store 另提供 `defaultProfile()`（isDefault 优先兜底第一个）、`setDefaultProfile(id)` 与 `defaultFirstProfiles(profiles)`（展示排序：默认档案置顶；设置页档案列表与「+」下拉共用，兼容已持久化的任意顺序数据）。

## 配色库（`src/lib/colorSchemes.ts` + `src/lib/communityColorSchemes.ts`）

- `TerminalColorScheme = { name, foreground, background, cursor, cursorAccent?, selection?, selectionForeground?, colors[16] }`。
- **严格复刻 Tabby 候选列表（共 193 套）**：`Tabby Default` / `Tabby Default Light` 两套核心默认（数据即原 scx-terminal Dark/Light，改名对齐 Tabby）+ Tabby 官方社区配色全集 191 套（`communityColorSchemes.ts`，由一次性脚本从 `Eugeny/tabby` 仓库 `tabby-community-color-schemes/schemes/` 拉取 Xresources 文件解析生成，勿手工编辑；base16 `#define` 宏与缺冒号写法均已兼容）。
- `resolveColorScheme(preference, systemPrefersLight, custom?)`：`'dark'`/`'light'`（旧值）→ 默认深/浅配色；`'auto'` → 按系统；其余按配色名查找（**自定义优先于内置**），找不到回退系统深浅对应默认配色。**前端唯一配色解析入口**（`frontendContext.colorScheme()`、theme store、TerminalPane 按档案配色都走它，均传 `config.store.colorSchemes`）。
- **自定义配色**存于 `config.colorSchemes: TerminalColorScheme[]`（SQLite 持久化，按 name upsert；重命名按删旧建新处理），可与内置同名（自定义优先生效）。
- **iTerm2 导入**：`src/lib/itermColors.ts` 的 `parseItermColorsFile(text, name)`——纯字符串解析 XML plist（`Red/Green/Blue Component` 0-1 浮点 → `#rrggbb`），映射 Ansi 0..15 / Background / Foreground / Cursor / Cursor Text / Selection / Selected Text，缺失字段回退默认深色值。
- 单测：`src/lib/colorSchemes.test.ts`（193 套唯一名/16 色/自定义优先级/旧值兼容）、`src/lib/itermColors.test.ts`。

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

终端页控件：字号/**字体（`list_fonts` 系统字体可搜索下拉，`monospace` 默认项；命令失败回退自由文本）**/行距/光标样式/闪烁/回滚行数/选中即复制/Alt 作 Meta/最小对比度、退格键行为、输入/输出换行转换（`null` 在 UI 以"不转换"占位）、双击选词分隔符、粗体亮色。

外观页：仅保留语言下拉（绑定 `appearance.language`）。配色方案页：独立设置分组（导航「外观」之后，图标 Palette；外观页改 Globe），主体 `settings/ColorSchemePicker.vue`——搜索框 + 置顶「跟随系统」条目 + **193 套按名称首字母分组**（数字归 `#` 组，`mergeColorSchemes` 自定义同名优先混排、`groupColorSchemesByInitial` 分组排序，纯函数单测覆盖）、**分组头可展开/收起**（内存态，搜索时命中组强制展开）、**每条 Tabby 式预览卡**（名称 + 「自定义」标记 + 右侧 16 色点 + 终端输出预览 `user@scx:~$ ls` 按槽位着色）；点击条目即写全局 `appearance.colorScheme`，当前值高亮描边。下方**自定义配色**区——新建（克隆 Tabby Default）/ 导入 iTerm2（纯 `label > span 触发器 + hidden input[type=file]` 结构——label 内不能嵌交互按钮，否则点击不会激活文件选择；解析失败有错误提示）/ chips 列表切换 / 编辑器（名称、预览条 + 16 色块、22 个颜色槽位逐色编辑（取色器 + hex 文本，选区等字段保留 alpha 后缀）、删除）。编辑直接写响应式 store 即时生效并持久化（theme store 对 `colorSchemes` 深度 watch 重派生界面 token）。快捷键页通过 `hotkeys.keystroke$` 录制按键序列。命令面板的"切换配色方案"命令在两套默认配色间切换（保持与选择器值域一致）。

注意：退格/换行/OSC 52 等中间件配置在会话构造期读取，**对新开标签生效**（设置页有提示文案）；档案编辑对已运行会话无影响，新窗格取新值。

## Related

- [terminal-rendering](terminal-rendering.md)
- [04-guides/key-flows](../04-guides/key-flows.md)
- [03-backend/commands-and-config](../03-backend/commands-and-config.md)
