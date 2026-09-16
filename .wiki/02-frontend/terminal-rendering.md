# 终端渲染前端（xterm）

## 文件

| 文件 | 职责 |
| --- | --- |
| `src/lib/frontends/frontend.ts` | `Frontend` 抽象基类：定义 attach/write/搜索/滚动/配置等接口与全部 Rx 事件流（`input$`/`resize$`/`title$`/`bell$`/`destroyed$`…），移植自 tabby-terminal |
| `src/lib/frontends/xtermFrontend.ts` | `XTermWebGLFrontend extends Frontend`：xterm.js 具体实现（WebGL 优先、Canvas 兜底） |
| `src/lib/frontendContext.ts` | `createFrontendContext()`：替代 Tabby 的 Angular DI，向前端注入 config / 配色解析 / 剪贴板 / 热键桥 |
| `src/lib/frontends/xterm.css` | 终端滚动条样式（颜色取 CSS 变量 `--term-scrollbar-*`，跟随配色） |
| `src/components/terminal/TerminalPane.vue` | 每个分屏叶的容器：组装 session + frontend，处理搜索条、右键菜单与挂载错误 |

## Frontend 契约（`frontend.ts`）

- `input$`：终端产生的用户输入（Uint8Array，已 UTF-8 编码）。
- `resize$`：`ReplaySubject(1)`——订阅时回放最近一次网格尺寸（列/行）。这个"回放"特性是 `LocalSession.pendingResize` 存在的原因（尺寸可能在会话启动前到达）。
- `title$`：shell 上报的标题；`alternateScreenActive$`：vim/less 等备用屏状态。
- `BaseTerminalProfile.terminalColorScheme`：配色传入通道（传 `null` 表示用 context 解析当前配色）。

## attach 流程（`xtermFrontend.ts` `attach()`）

1. `xterm.open(host)` → 先 `configureColors(null)` 防止白闪。
2. 加载 WebGL addon（失败/上下文丢失时降级 Canvas，窗口 focus 时 `recoverRenderer()` 重试）。
3. 固定等待 100ms（等首帧）→ 加载搜索 addon → 绑定 window resize 与 host 事件（wheel/mousedown/contextmenu）。
4. 安装 `ResizeObserver` 观察宿主元素；`resizeHandler` 做 32ms 节流的 `fitAddon.fit()`，保持滚动位置并强制重绘。

## 键盘处理（`attachCustomKeyEventHandler`）

- ⌘V / Shift+Insert 交给应用级粘贴处理（preventDefault + 返回 false）。
- 带 Meta 的方向键放行给 xterm（窗格导航热键由文档层处理）。
- 其余事件以**真实事件类型**（keydown/keyup）喂给热键状态机——此处曾因把 keyup 硬编码成 keydown 导致一次 ⌘T 开两个标签，修复见 `xtermFrontend.ts` 中 `keyboardEventHandler(event.type === 'keyup' ? 'keyup' : 'keydown', event)`。
- 热键（含前缀部分匹配）命中时 `stopPropagation + preventDefault` 并返回 false，阻止按键进入 shell。
- Ctrl+`/` 与 Ctrl+`@` 被显式转换为 `\u001f` / `\u0000` 注入输入流。
- 备用屏（vim 等）中仅带修饰键的方向键放行给应用。

## 写入与流控（`write`）

xterm 的 `write` 是异步分批渲染的；前端维护发送/确认计数做流量控制，避免一次性灌入巨量输出卡死渲染（`xtermFrontend.ts` 中 FlowControl 相关逻辑）。

## 配色应用（`configureColors`）

- 输入 `TerminalColorScheme` → 映射为 xterm `ITheme`：`foreground/background/cursor/cursorAccent/selectionBackground` + 16 ANSI 色（`COLOR_NAMES` 顺序映射 `scheme.colors[0..15]`）。
- `deepEqual` 守卫避免重复设置；`terminal.paletteGenerate` 开启时用 `generatePalette()`（`src/lib/generatePalette.ts`，LAB 插值，移植自 tabby-terminal）生成 256 色扩展 `extendedAnsi`。
- 触发时机：attach 时一次；`TerminalPane` 深度 watch config store；`theme store` 的 `epoch` 变化（配色切换/系统亮暗变化）。

## TerminalPane 组装（`src/components/terminal/TerminalPane.vue`）

`onMounted`（整体 try/catch，失败在面板上显示错误信息而不是静默空白）：

1. `new LocalSession({...全局中间件配置})` + `new XTermWebGLFrontend(createFrontendContext())` + `configure({ terminalColorScheme: 档案配色 })`（档案 `colorScheme` 非空时 `resolveColorScheme` 后下发，null 跟随全局）。
2. `await frontend.attach(host)`（host 经 `resolveHostElement()` 从窗格根元素查询——不能用模板 ref，reka-ui `as-child` 触发器会删除插槽根元素的 ref）→ 依次接线：`input$ → session.feedFromTerminal`、`session.output$ → frontend.write`、`resize$ → session.resize`、`title$ → emit('title')`、`bell$ → visualBell`、`destroyed$ → emit('closed')`。
3. `session.start({ command/args/env/cwd 全部来自 props.profile（TerminalTabContent 解析：profileId → 默认档案 → fallbackProfile），loginShell 时追加 -l })`。
4. `session.releaseInitialDataBuffer()` 放行首屏 → **spawn 完成后立即用 `frontend.getSize()`（xterm 实际渲染列/行）补一次 `session.resize`**（防御性对齐：attach 期间 fit 的时序异常可能让 spawn 用上过时尺寸——实测同一窗口出现 pty=104 列 vs 渲染 88 列的错位，COLUMNS 与实际不符会破坏 zsh PROMPT_SP 补行等行宽敏感行为，表现为「提示符与上一条输出挤在同一行」） → 活动叶 `focus()`。

`props.active` 变化（标签切换回来）时 `reactivate() + focus()`；卸载时销毁 session 与 frontend。搜索条（⌘F）是覆盖在终端上的浮层，输入不进 shell。

**终端右键菜单**：`.terminal-host` 由 `ui/ContextMenu.vue`（reka-ui）包裹，菜单项为 复制（无选区时禁用，打开时经 `frontend.getSelection()` 判定）/ 粘贴 / 全选 / 清屏 / 搜索 / 向右分屏 / 向下分屏 / 关闭窗格；分屏项经 `requestSplit` 事件沿 `SplitContainer → TerminalTabContent` 上行（带叶 id），关窗格复用既有 `closed` 事件。`xtermFrontend` 对宿主 `contextmenu` 只 `preventDefault`（屏蔽 WKWebView 原生菜单）不 `stopPropagation`，事件冒泡到包裹层触发菜单。

**可点击链接**：attach 时加载 `@xterm/addon-web-links`，URL 点击经 `@tauri-apps/plugin-opener` 的 `openUrl` 用系统默认浏览器打开（capabilities 已含 `opener:default`）；OSC 8 超链接由 xterm 核心原生支持。

## Related

- [sessions-and-middleware](sessions-and-middleware.md)
- [config-and-theming](config-and-theming.md)
- [04-guides/key-flows](../04-guides/key-flows.md)
