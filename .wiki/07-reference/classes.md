# Classes

<details>
<summary>Relevant source files</summary>

- src/lib/frontends/frontend.ts
- src/lib/frontends/xterm/frontend.ts
- src/lib/frontends/xterm/renderer.ts
- src/lib/frontends/xterm/support.ts
- src/lib/monitorOrchestrator.ts
- src/lib/sessions/sshSession.ts
- src/services/hotkeys.ts
- src/services/ssh.ts
</details>

> ⚠️ **待确认**：MCP 知识图谱未提供继承关系（INHERITS 边），本页只列出类清单与成员方法，不含继承树；多态方法的子类实现（证据不足，禁止猜测；请人工补充后移除本标记）

## Frontend

源文件：`src/lib/frontends/frontend.ts:49`  限定名：`Users-scx-Documents-code-scx-terminal.src.lib.frontends.frontend.Frontend`

| 方法 | 可见性 | 签名 | 说明 | 源文件:行号 |
| --- | --- | --- | --- | --- |
| ready$ |  | `()` |  | src/lib/frontends/frontend.ts:60 |
| title$ |  | `()` |  | src/lib/frontends/frontend.ts:61 |
| alternateScreenActive$ |  | `()` |  | src/lib/frontends/frontend.ts:62 |
| mouseEvent$ |  | `()` |  | src/lib/frontends/frontend.ts:63 |
| bell$ |  | `()` |  | src/lib/frontends/frontend.ts:64 |
| input$ |  | `()` |  | src/lib/frontends/frontend.ts:65 |
| resize$ |  | `()` |  | src/lib/frontends/frontend.ts:66 |
| destroyed$ |  | `()` |  | src/lib/frontends/frontend.ts:67 |
| constructor |  | `(protected context: FrontendContext)` |  | src/lib/frontends/frontend.ts:69 |
| destroy |  | `()` |  | src/lib/frontends/frontend.ts:71 |
| detach |  | `(_host: HTMLElement)` | // eslint-disable-next-line @typescript-eslint/no-unused-vars | src/lib/frontends/frontend.ts:80 |
| resetTerminalModes |  | `()` |  | src/lib/frontends/frontend.ts:106 |

## HotkeysService

源文件：`src/services/hotkeys.ts:14`  限定名：`Users-scx-Documents-code-scx-terminal.src.services.hotkeys.HotkeysService`

| 方法 | 可见性 | 签名 | 说明 | 源文件:行号 |
| --- | --- | --- | --- | --- |
| constructor |  | `(\n        private getHotkeysConfig: () => Record<string, string[][]>,\n    )` |  | src/services/hotkeys.ts:27 |
| disable |  | `()` |  | src/services/hotkeys.ts:31 |
| enable |  | `()` | /** 计数恢复，向下钳制到 0：防止不对称的 enable 调用把计数打成负数、热键永久禁用 */ | src/services/hotkeys.ts:36 |
| isEnabled |  | `()` |  | src/services/hotkeys.ts:40 |
| pushKeyEvent |  | `(eventName: string, nativeEvent: KeyboardEvent | WheelEvent | MouseEvent)` | /** Feed a DOM event into the machine ('keydown' | 'keyup' | 'wheel' | 'mouseup' | 'auxclick'). */ | src/services/hotkeys.ts:45 |
| getCurrentKeystrokes |  | `()` |  | src/services/hotkeys.ts:139 |
| matchActiveHotkey |  | `(partial = false)` | /**\n     * Returns the id of the hotkey matching the current key sequence.\n     * With `partial=true`, matches a prefix of a longer sequence (used to let\n     * xterm know a keydown belongs to a hotkey and must not reach the shell).\n     */ | src/services/hotkeys.ts:151 |
| clearCurrentKeystrokes |  | `()` |  | src/services/hotkeys.ts:198 |
| emitHotkeyOn |  | `(id: string)` |  | src/services/hotkeys.ts:206 |
| emitHotkeyOff |  | `(id: string)` |  | src/services/hotkeys.ts:211 |
| addPressedKey |  | `(keyName: string, event: KeyEventData)` |  | src/services/hotkeys.ts:216 |
| removePressedKey |  | `(keyName: string)` |  | src/services/hotkeys.ts:225 |
| updateModifiers |  | `(event: KeyEventData)` |  | src/services/hotkeys.ts:230 |

## SshProxy

源文件：`src/services/ssh.ts:57`  限定名：`Users-scx-Documents-code-scx-terminal.src.services.ssh.SshProxy`

| 方法 | 可见性 | 签名 | 说明 | 源文件:行号 |
| --- | --- | --- | --- | --- |
| start |  | `(options: SSHConnectOptions)` | /**\n     * @description 建立 SSH 连接并打开远端 shell（连接/认证/PTY 由 Rust 完成）；\n     *              hostkey 事件由调用方经 subscribe('hostkey') 处理并调 confirmHostKey 应答\n     * @param options 连接选项（host/port/user/auth/初始尺寸）\n     * @returns Promise<void> 连接失败抛出错误文本\n     *\n     * @example await proxy.start({ host: 'example.com', port: 22, user: 'root', auth: 'auto', privateKeyPath: null, password: null, cols: 80, rows: | src/services/ssh.ts:72 |
| confirmHostKey |  | `(accepted: boolean)` | /**\n     * @description 应答主机指纹确认（对应 `ssh:{id}:hostkey` 事件；仅 connect 阶段有效）\n     * @param accepted 是否接受该主机密钥\n     * @returns Promise<void>\n     *\n     * @example await proxy.confirmHostKey(true)\n     *\n     */ | src/services/ssh.ts:103 |
| respondKbd |  | `(responses: string[] | null)` | /**\n     * @description 应答 kbd-interactive 凭据挑战（对应 `ssh:${id}:kbdchallenge` 事件；仅认证阶段有效）\n     * @param responses 对位每个 prompt 的应答；null = 用户取消\n     * @returns Promise<void>\n     *\n     * @example await proxy.respondKbd(['hunter2'])\n     *\n     */ | src/services/ssh.ts:117 |
| deliverData |  | `(data: Uint8Array)` | /**\n     * @description 分发一条来自 Rust 的 SSH 输出；'data' 订阅者注册前的块先缓冲回放\n     * @param data 输出字节\n     */ | src/services/ssh.ts:127 |
| flushPendingChunks |  | `()` | /**\n     * @description 回放缓冲的输出块（与 pty 代理同语义：订阅者晚到不丢首屏）\n     */ | src/services/ssh.ts:141 |
| getID |  | `()` |  | src/services/ssh.ts:152 |
| resize |  | `(columns: number, rows: number)` |  | src/services/ssh.ts:156 |
| write |  | `(data: Uint8Array)` |  | src/services/ssh.ts:162 |
| kill |  | `()` |  | src/services/ssh.ts:169 |
| ackData |  | `(length: number)` |  | src/services/ssh.ts:175 |
| subscribe |  | `(event: string, handler: SshEventHandler)` |  | src/services/ssh.ts:181 |
| unsubscribeAll |  | `()` |  | src/services/ssh.ts:189 |

## SshSession

源文件：`src/lib/sessions/sshSession.ts:34`  限定名：`Users-scx-Documents-code-scx-terminal.src.lib.sessions.sshSession.SshSession`

| 方法 | 可见性 | 签名 | 说明 | 源文件:行号 |
| --- | --- | --- | --- | --- |
| constructor |  | `(private readonly setup: SshSessionSetup = {})` |  | src/lib/sessions/sshSession.ts:38 |
| start |  | `(options: SshSessionOptions)` |  | src/lib/sessions/sshSession.ts:42 |
| resize |  | `(columns: number, rows: number)` |  | src/lib/sessions/sshSession.ts:121 |
| write |  | `(data: Uint8Array)` |  | src/lib/sessions/sshSession.ts:129 |
| kill |  | `()` |  | src/lib/sessions/sshSession.ts:135 |
| gracefullyKillProcess |  | `()` |  | src/lib/sessions/sshSession.ts:139 |
| sshSessionId |  | `()` | /**\n     * @description 本会话的 SSH 连接 id（SFTP 面板等按 id 定位 Rust 侧连接）\n     * @returns string | null 会话 id；未启动为 null\n     *\n     * @example const sshId = session.sshSessionId\n     *\n     */ | src/lib/sessions/sshSession.ts:150 |
| supportsWorkingDirectory |  | `()` |  | src/lib/sessions/sshSession.ts:154 |
| getWorkingDirectory |  | `()` | /**\n     * @description 远端当前工作目录：仅 OSC 7/1337 上报（远端 shell 配置了 hook 时可用），无探测兜底\n     * @returns Promise<string | null> 上报的目录或 null\n     *\n     * @example const cwd = await session.getWorkingDirectory()\n     *\n     */ | src/lib/sessions/sshSession.ts:165 |

## FlowControl

源文件：`src/lib/frontends/xterm/support.ts:61`  限定名：`Users-scx-Documents-code-scx-terminal.src.lib.frontends.xterm.support.FlowControl`

| 方法 | 可见性 | 签名 | 说明 | 源文件:行号 |
| --- | --- | --- | --- | --- |
| constructor |  | `(private xterm: Terminal)` |  | src/lib/frontends/xterm/support.ts:70 |
| write |  | `(data: string)` |  | src/lib/frontends/xterm/support.ts:72 |

## XtermRendererManager

源文件：`src/lib/frontends/xterm/renderer.ts:26`  限定名：`Users-scx-Documents-code-scx-terminal.src.lib.frontends.xterm.renderer.XtermRendererManager`

| 方法 | 可见性 | 签名 | 说明 | 源文件:行号 |
| --- | --- | --- | --- | --- |
| constructor |  | `(private readonly deps: RendererDeps)` |  | src/lib/frontends/xterm/renderer.ts:34 |
| attach |  | `(enableWebGL: boolean)` | /** 按前端配置挂载初始渲染器（WebGL 优先，Canvas 兜底）并记录字体指纹 */ | src/lib/frontends/xterm/renderer.ts:37 |
| outOfDate |  | `()` | /** 影响字形渲染的设置指纹比较 */ | src/lib/frontends/xterm/renderer.ts:48 |
| remeasure |  | `()` | /**\n     * @description 强制重测字符尺寸；窗格变为可见且字体设置与渲染器构建时不一致时整体\n     *              重建渲染器——WKWebView 下字号在窗格隐藏期间变更时，单元格尺寸会更新\n     *              （列数/布局随之变化）但 WebGL 渲染器不按新尺寸重建字形图集（字形停留\n     *              旧尺寸），复用上下文丢失恢复的重建路径全量重算\n     * @returns void\n     *\n     * @example rende | src/lib/frontends/xterm/renderer.ts:62 |
| rebuild |  | `()` | /** 重建渲染器（WebGL/Canvas 附加器 dispose 后重挂，图集与尺寸全量重算）并重绘 */ | src/lib/frontends/xterm/renderer.ts:74 |
| reactivate |  | `(enableWebGL: boolean)` | /**\n     * Redraw the terminal and recover the renderer when its tab is shown again.\n     */ | src/lib/frontends/xterm/renderer.ts:93 |
| recover |  | `()` | /** 尝试恢复（上下文丢失后窗口重新聚焦时；受挂载可见与重试上限约束） */ | src/lib/frontends/xterm/renderer.ts:104 |
| attachWebGL |  | `()` |  | src/lib/frontends/xterm/renderer.ts:116 |
| canRecover |  | `()` |  | src/lib/frontends/xterm/renderer.ts:128 |
| redraw |  | `()` |  | src/lib/frontends/xterm/renderer.ts:133 |
| dispose |  | `()` |  | src/lib/frontends/xterm/renderer.ts:140 |

## XTermFrontend

源文件：`src/lib/frontends/xterm/frontend.ts:27`  限定名：`Users-scx-Documents-code-scx-terminal.src.lib.frontends.xterm.frontend.XTermFrontend`

| 方法 | 可见性 | 签名 | 说明 | 源文件:行号 |
| --- | --- | --- | --- | --- |
| isAttachActive |  | `()` |  | src/lib/frontends/xterm/frontend.ts:51 |
| constructor |  | `(context: FrontendContext)` |  | src/lib/frontends/xterm/frontend.ts:55 |
| isAtBottom |  | `()` |  | src/lib/frontends/xterm/frontend.ts:149 |
| updatePinnedState |  | `()` |  | src/lib/frontends/xterm/frontend.ts:154 |
| resizeHandler |  | `()` |  | src/lib/frontends/xterm/frontend.ts:158 |
| attach |  | `(host: HTMLElement, _profile: BaseTerminalProfile)` |  | src/lib/frontends/xterm/frontend.ts:162 |
| detach |  | `(_host: HTMLElement)` |  | src/lib/frontends/xterm/frontend.ts:241 |
| destroy |  | `()` |  | src/lib/frontends/xterm/frontend.ts:258 |
| getSelection |  | `()` |  | src/lib/frontends/xterm/frontend.ts:271 |
| copySelection |  | `()` |  | src/lib/frontends/xterm/frontend.ts:275 |
| selectAll |  | `()` |  | src/lib/frontends/xterm/frontend.ts:283 |
| clearSelection |  | `()` |  | src/lib/frontends/xterm/frontend.ts:287 |
| focus |  | `()` |  | src/lib/frontends/xterm/frontend.ts:291 |
| write |  | `(data: string)` |  | src/lib/frontends/xterm/frontend.ts:295 |
| clear |  | `()` |  | src/lib/frontends/xterm/frontend.ts:313 |
| getSize |  | `()` | /**\n     * @description 当前 xterm 实际渲染尺寸（spawn 后与 pty 对齐用）\n     * @returns { columns, rows } 列数与行数\n     *\n     * @example frontend.getSize().columns // => 88\n     *\n     */ | src/lib/frontends/xterm/frontend.ts:324 |
| readLogicalLineNow |  | `()` | /**\n     * @description 当前光标逻辑行（soft-wrap 拼接后，未剥提示符）——建议输入行模型用\n     * @returns LogicalLine | null buffer 不可读时 null\n     *\n     * @example frontend.readLogicalLineNow()?.text // 'user@mac ~ % git che'\n     *\n     */ | src/lib/frontends/xterm/frontend.ts:335 |
| readLogicalLineAbove |  | `(up: number)` | /**\n     * @description 向上第 up 个逻辑行的完整文本（续行合并采集用；up=0 等价 readLogicalLineNow 但光标在行尾）\n     * @param up 向上偏移的逻辑行数\n     * @returns LogicalLine | null 越界时 null\n     */ | src/lib/frontends/xterm/frontend.ts:344 |
| readCursorPrefix |  | `()` | /**\n     * @description 光标行 [0, cursorX) 文本（提示符学习锚点；RPROMPT 天然被排除在光标右侧）\n     * @returns string | null\n     */ | src/lib/frontends/xterm/frontend.ts:352 |
| getSuggestionAnchorRect |  | `()` | /**\n     * @description 建议菜单锚点：光标格左下角的像素坐标（相对宿主元素，不触 xterm 私有 API，\n     *              单元格尺寸 = 宿主尺寸 ÷ 网格数；viewportRow 钳制在视口内防滚动越界）\n     * @returns object left/top 与宿主高宽；未 attach 时 null\n     */ | src/lib/frontends/xterm/frontend.ts:361 |
| resetTerminalModes |  | `()` |  | src/lib/frontends/xterm/frontend.ts:369 |
| visualBell |  | `()` |  | src/lib/frontends/xterm/frontend.ts:376 |
| scrollToTop |  | `()` |  | src/lib/frontends/xterm/frontend.ts:386 |
| scrollPages |  | `(pages: number)` |  | src/lib/frontends/xterm/frontend.ts:391 |
| scrollLines |  | `(amount: number)` |  | src/lib/frontends/xterm/frontend.ts:396 |
| scrollToBottom |  | `()` |  | src/lib/frontends/xterm/frontend.ts:401 |
| configureColors |  | `(scheme: TerminalColorScheme | null)` |  | src/lib/frontends/xterm/frontend.ts:406 |
| configure |  | `(_profile: BaseTerminalProfile)` |  | src/lib/frontends/xterm/frontend.ts:414 |
| setZoom |  | `(zoom: number)` |  | src/lib/frontends/xterm/frontend.ts:430 |
| findNext |  | `(term: string, searchOptions?: SearchOptions)` |  | src/lib/frontends/xterm/frontend.ts:436 |
| findPrevious |  | `(term: string, searchOptions?: SearchOptions)` |  | src/lib/frontends/xterm/frontend.ts:444 |
| cancelSearch |  | `()` |  | src/lib/frontends/xterm/frontend.ts:452 |
| supportsBracketedPaste |  | `()` |  | src/lib/frontends/xterm/frontend.ts:457 |
| isAlternateScreenActive |  | `()` |  | src/lib/frontends/xterm/frontend.ts:461 |
| setFontSize |  | `()` |  | src/lib/frontends/xterm/frontend.ts:465 |
| currentFontKey |  | `()` | /** 影响字形渲染的设置指纹（字号/行距/字体族），用于判断渲染器是否需要重建 */ | src/lib/frontends/xterm/frontend.ts:473 |
| remeasureFont |  | `()` | /**\n     * @description 强制重测字符尺寸；字体设置与渲染器构建时不一致时整体重建（见 renderer 模块）\n     * @returns void\n     *\n     * @example frontend.remeasureFont()\n     *\n     */ | src/lib/frontends/xterm/frontend.ts:484 |
| reactivate |  | `()` | /**\n     * Redraw the terminal and recover the renderer when its tab is shown again.\n     */ | src/lib/frontends/xterm/frontend.ts:491 |

## MonitorOrchestrator

源文件：`src/lib/monitorOrchestrator.ts:38`  限定名：`Users-scx-Documents-code-scx-terminal.src.lib.monitorOrchestrator.MonitorOrchestrator`

| 方法 | 可见性 | 签名 | 说明 | 源文件:行号 |
| --- | --- | --- | --- | --- |
| constructor |  | `(private readonly deps: MonitorDeps)` |  | src/lib/monitorOrchestrator.ts:45 |
| startCard |  | `(profileIds: string[])` | /**\n     * @description 启动卡片级监控：逐台串行 acquire + start（500ms 错峰），\n     *              单台失败记入错误不阻塞后续；epoch 失效（stopCard 已发生）\n     *              时不再建连，ensure 期间失效则补偿停释防孤儿采样任务\n     * @param profileIds SSH 档案 id 列表\n     * @returns Promise<void>\n     *\n     * @example await orchestrator.startCard(['p1', 'p2'])\n     *\n     */ | src/lib/monitorOrchestrator.ts:57 |
| stopCard |  | `()` | /**\n     * @description 停止卡片级监控；仍有详情绑定的档案跳过（连接与任务归详情）；\n     *              递增 startEpoch 使在跑的 startCard 错峰循环失效\n     * @returns Promise<void>\n     *\n     * @example await orchestrator.stopCard()\n     *\n     */ | src/lib/monitorOrchestrator.ts:96 |
## Related

- 同目录：[calls.md](calls.md) · [glossary.md](glossary.md)
- 总入口：[README](../README.md)
