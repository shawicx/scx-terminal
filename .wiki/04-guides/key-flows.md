# 核心调用链

以函数/文件为锚点（行号会漂移，函数名稳定）。改这些链路前先读对应 Wiki 页。

## 1. 键盘输入（击键 → shell）

```text
xterm 隐藏 textarea（focus 由 TerminalPane 挂载/激活时调用 frontend.focus()）
→ xterm _keyDown → attachCustomKeyEventHandler（xtermFrontend.ts）
    ├─ 命中热键（matchActiveHotkey partial）→ 拦截，不发 shell
    └─ 放行 → xterm onData → frontend.input.next(encodeUTF8(data))
→ TerminalPane.vue：frontend.input$.subscribe(data => session.feedFromTerminal(data))
→ BaseSession.feedFromTerminal → SessionMiddlewareStack.feedFromTerminal（栈顶进）
→ OSCProcessor 透传 → 栈底 outputToSession$
→ BaseSession 构造中的订阅 → LocalSession.write（ptyClosed 时触发 destroy）
→ TauriPTYProxy.write → invoke('pty_write', { id, data: number[] })
→ Rust pty_write（async）→ Pty::write → master fd write_all
```

## 2. 输出（shell → 屏幕）

```text
Rust 读线程（pty.rs）read(64KB)
→ PtyDataQueue.push → maybe_emit（≤100KB、UTF-8 安全、delta≤500KB）
→ Channel<InvokeResponseBody::Raw>（二进制 IPC）
→ TauriPTYProxy channel.onmessage → deliverData
    ├─ 尚无 'data' 订阅者 → pendingChunks 缓冲（首个订阅者到达时回放）
    └─ LocalSession 'data' 处理器：pty.ackData(len) → session.emitOutput
→ 中间件栈 feedFromSession → OSCProcessor
    ├─ OSC 1337 CurrentDir → cwdReported$（吞掉，不上屏）
    ├─ OSC 52 → 剪贴板写入（未实现，透传给…目前丢弃内容）
    └─ 其余透传 → BaseSession.initialDataBuffer（releaseInitialDataBuffer 之前）
→ TerminalPane：session.output$.subscribe(data => frontend.write(data))
→ Frontend 流控 → xterm.write → 渲染（WebGL/Canvas）
```

## 3. 新建终端标签（⌘T / `+` / 命令）

```text
tabs.openTerminalTab()（stores/tabs.ts：{ id, type:'terminal', title:'' } 并激活）
→ App.vue 渲染 TerminalTabContent（v-show 常驻）
→ tree = makeLeaf() → SplitContainer(.split-root) → TerminalPane.onMounted：
  1. session + XTermWebGLFrontend + configure({ terminalColorScheme: null })
  2. await frontend.attach(host)：open → configureColors → WebGL/Canvas → 100ms → resizeHandler（fit → resize$.next(尺寸)）→ ResizeObserver
  3. 接线 input$/output$/resize$/title$/bell$/destroyed$
     ※ resize$ 是 ReplaySubject：订阅时回放 fit 尺寸 → session.resize → pty 为 null → LocalSession.pendingResize 暂存
  4. await defaultShell()（services/shells.ts → list_shells）
  5. await session.start({...})：pendingResize 作为 spawn 尺寸 → invoke('pty_spawn')
  6. session.releaseInitialDataBuffer()（放行首屏）
  7. 活动叶 frontend.focus()（提示符后光标立即可见）
→ shell 输出提示符 → 链路 2 上屏；标题经 OSC 0/2 → tabs.setTitle
```

## 4. 主题切换（设置页下拉 / 命令面板）

```text
store.appearance.colorScheme = 'Dracula'
→ config store 防抖 500ms 持久化（computeOps 差异 flush → SQLite config.db，settings 分片 settings_set_section）
→ theme store watch 触发 apply()：
    resolveColorScheme(pref, 系统亮暗) → scheme
    isDark = isColorSchemeDark(scheme) → <html>.dark 类 + style.colorScheme
    deriveChromeTokens(scheme) → 逐键注入 <html> 内联 CSS 变量（--background/--foreground/--card/…/--term-scrollbar-*）
    epoch++
→ 界面：@theme inline 的 --color-* 随之变化 → TitleBar/设置页/滚动条立即换色（CSS 变量，无 JS 参与）
→ 终端：TerminalPane watch(themeStore.epoch) → frontend.configure({ terminalColorScheme: null })
    → configureColors(context.colorScheme()) → xterm.options.theme（deepEqual 守卫）
```

## 5. 关闭标签 / 退出会话

```text
UI 关闭 → TerminalPane.onBeforeUnmount → session.destroy()
→ BaseSession.destroy：closed/destroyed next → gracefullyKillProcess()
→ LocalSession.kill → invoke('pty_kill')
→ Rust Pty::kill：writer = None（EOF/SIGHUP）→ killer.kill()（独立句柄，不碰 child 锁）
→ 清理线程 wait() 返回 → emit pty:{id}:exit → pty_kill 收尾 → map 移除
※ 若 shell 有前台任务，killer 直接发信号——修复前这里会死锁冻结整个窗口
```

## Related

- [01-overview/architecture](../01-overview/architecture.md)
- [03-backend/pty-lifecycle](../03-backend/pty-lifecycle.md)
- [02-frontend/config-and-theming](../02-frontend/config-and-theming.md)
