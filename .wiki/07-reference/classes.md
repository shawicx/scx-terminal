# 类

<details>
<summary>Relevant source files</summary>

- src/lib/frontends/xterm/frontend.ts
- src/lib/frontends/xterm/renderer.ts
- src/lib/frontends/xterm/support.ts
- src/lib/sessions/sshSession.ts
- src/lib/sshConnectionRegistry.ts
- src/lib/suggestions/promptTracker.ts
- src/services/hotkeys.ts
</details>

> ⚠️ **待确认**：MCP 知识图谱未提供继承关系（INHERITS 边），本页只列出类清单与成员方法，不含继承树；多态方法的子类实现（证据不足，禁止猜测；请人工补充后移除本标记）

## HotkeysService

源文件：`src/services/hotkeys.ts:14`  限定名：`Users-scx-Documents-code-scx-terminal.src.services.hotkeys.HotkeysService`

| 方法 | 可见性 | 签名 | 说明 | 源文件:行号 |
| --- | --- | --- | --- | --- |
| constructor |  | `( private getHotkeysConfig: () => Record<string, string[][]>, )` | — | src/services/hotkeys.ts:27 |
| disable |  | `(): : void` | — | src/services/hotkeys.ts:31 |
| enable |  | `(): : void` | 计数恢复，向下钳制到 0：防止不对称的 enable 调用把计数打成负数、热键永久禁用 | src/services/hotkeys.ts:36 |
| isEnabled |  | `(): : boolean` | — | src/services/hotkeys.ts:40 |
| pushKeyEvent |  | `(eventName: string, nativeEvent: KeyboardEvent | WheelEvent | MouseEvent): : void` | Feed a DOM event into the machine ('keydown' \| 'keyup' \| 'wheel' \| 'mouseup' \| 'auxclick'). | src/services/hotkeys.ts:45 |
| getCurrentKeystrokes |  | `(): : Keystroke[]` | — | src/services/hotkeys.ts:139 |
| matchActiveHotkey |  | `(partial = false): : string | null` | Returns the id of the hotkey matching the current key sequence. With `partial=true`, matches a prefix of a longer sequen… | src/services/hotkeys.ts:151 |
| clearCurrentKeystrokes |  | `(): : void` | — | src/services/hotkeys.ts:198 |
| emitHotkeyOn |  | `(id: string): : void` | — | src/services/hotkeys.ts:206 |
| emitHotkeyOff |  | `(id: string): : void` | — | src/services/hotkeys.ts:211 |
| addPressedKey |  | `(keyName: string, event: KeyEventData): : void` | — | src/services/hotkeys.ts:216 |
| removePressedKey |  | `(keyName: string): : void` | — | src/services/hotkeys.ts:225 |
| updateModifiers |  | `(event: KeyEventData): : void` | — | src/services/hotkeys.ts:230 |

## PromptTracker

源文件：`src/lib/suggestions/promptTracker.ts:138`  限定名：`Users-scx-Documents-code-scx-terminal.src.lib.suggestions.promptTracker.PromptTracker`

| 方法 | 可见性 | 签名 | 说明 | 源文件:行号 |
| --- | --- | --- | --- | --- |
| constructor |  | `( private host: PromptTrackerHost, private onSilence?: () => void, options?: { silenceMs?: number, maxPromptJump?: number }, )` | @param host buffer 读取接口（由 xterm 前端实现） @param onSilence 输出静默回调（建议评估触发点；可选） @param options silenceMs 静默窗口 / maxPromptJump … | src/lib/suggestions/promptTracker.ts:152 |
| promptLength |  | `(): : number` | — | src/lib/suggestions/promptTracker.ts:161 |
| notifyInput |  | `(data: Uint8Array): : void` | @description 用户输入通知（挂 frontend.input$）：含 \ 时采集命令并请求提示符学习； 其他输入取消挂起的学习（提示符行正在被编辑） @param data 输入字节（UTF-8） @returns void | src/lib/suggestions/promptTracker.ts:171 |
| notifyOutput |  | `(): : void` | @description shell 输出通知（挂 session.output$）：重置静默计时 @returns void | src/lib/suggestions/promptTracker.ts:188 |
| recordDirect |  | `(command: string): : void` | @description 直接记录一条命令文本（粘贴 / 快捷命令 autoRun 等绕过 input$ 的执行路径）： 此类命令无法靠静默回显采集（届时 buffer 已滚到新提示符），源文本即命令本身； 多行粘贴 = 多条命令顺序执行，… | src/lib/suggestions/promptTracker.ts:205 |
| getTypedLine |  | `(): : LogicalLine | null` | @description 当前输入行（buffer 现读 + 剥提示符） @returns LogicalLine \| null | src/lib/suggestions/promptTracker.ts:220 |
| takeRecordedCommand |  | `(): : string | null` | @description 取走回车采集到的命令（一次性；空命令为 null） @returns string \| null | src/lib/suggestions/promptTracker.ts:229 |
| destroy |  | `(): : void` | — | src/lib/suggestions/promptTracker.ts:235 |
| scheduleSilence |  | `(): : void` | — | src/lib/suggestions/promptTracker.ts:243 |
| onSilent |  | `(): : void` | — | src/lib/suggestions/promptTracker.ts:250 |
| collectCommand |  | `(): : string | null` | 回车时刻采集命令：光标行 + 向上合并以 \\ 结尾的续行，剥提示符后单行化 | src/lib/suggestions/promptTracker.ts:265 |

## FlowControl

源文件：`src/lib/frontends/xterm/support.ts:61`  限定名：`Users-scx-Documents-code-scx-terminal.src.lib.frontends.xterm.support.FlowControl`

| 方法 | 可见性 | 签名 | 说明 | 源文件:行号 |
| --- | --- | --- | --- | --- |
| constructor |  | `(private xterm: Terminal)` | — | src/lib/frontends/xterm/support.ts:70 |
| write |  | `(data: string): : Promise<void>` | — | src/lib/frontends/xterm/support.ts:72 |

## XTermFrontend

源文件：`src/lib/frontends/xterm/frontend.ts:27`  限定名：`Users-scx-Documents-code-scx-terminal.src.lib.frontends.xterm.frontend.XTermFrontend`

| 方法 | 可见性 | 签名 | 说明 | 源文件:行号 |
| --- | --- | --- | --- | --- |
| isAttachActive |  | `(): : boolean` | — | src/lib/frontends/xterm/frontend.ts:53 |
| constructor |  | `(context: FrontendContext)` | — | src/lib/frontends/xterm/frontend.ts:57 |
| isAtBottom |  | `(): : boolean` | — | src/lib/frontends/xterm/frontend.ts:151 |
| updatePinnedState |  | `(): : void` | — | src/lib/frontends/xterm/frontend.ts:156 |
| resizeHandler |  | `(): : void` | — | src/lib/frontends/xterm/frontend.ts:160 |
| attach |  | `(host: HTMLElement, profile: BaseTerminalProfile): : Promise<void>` | — | src/lib/frontends/xterm/frontend.ts:164 |
| detach |  | `(_host: HTMLElement): : void` | — | src/lib/frontends/xterm/frontend.ts:244 |
| destroy |  | `(): : void` | — | src/lib/frontends/xterm/frontend.ts:261 |
| getSelection |  | `(): : string` | — | src/lib/frontends/xterm/frontend.ts:274 |
| copySelection |  | `(): : void` | — | src/lib/frontends/xterm/frontend.ts:278 |
| selectAll |  | `(): : void` | — | src/lib/frontends/xterm/frontend.ts:286 |
| clearSelection |  | `(): : void` | — | src/lib/frontends/xterm/frontend.ts:290 |
| focus |  | `(): : void` | — | src/lib/frontends/xterm/frontend.ts:294 |
| write |  | `(data: string): : Promise<void>` | — | src/lib/frontends/xterm/frontend.ts:298 |
| clear |  | `(): : void` | — | src/lib/frontends/xterm/frontend.ts:316 |
| getSize |  | `(): : { columns: number, rows: number }` | @description 当前 xterm 实际渲染尺寸（spawn 后与 pty 对齐用） @returns { columns, rows } 列数与行数 | src/lib/frontends/xterm/frontend.ts:327 |
| readLogicalLineNow |  | `(): : LogicalLine | null` | @description 当前光标逻辑行（soft-wrap 拼接后，未剥提示符）——建议输入行模型用 @returns LogicalLine \| null buffer 不可读时 null | src/lib/frontends/xterm/frontend.ts:338 |
| readLogicalLineAbove |  | `(up: number): : LogicalLine | null` | @description 向上第 up 个逻辑行的完整文本（续行合并采集用；up=0 等价 readLogicalLineNow 但光标在行尾） @param up 向上偏移的逻辑行数 @returns LogicalLine \| nul… | src/lib/frontends/xterm/frontend.ts:347 |
| readCursorPrefix |  | `(): : string | null` | @description 光标行 [0, cursorX) 文本（提示符学习锚点；RPROMPT 天然被排除在光标右侧） @returns string \| null | src/lib/frontends/xterm/frontend.ts:355 |
| getSuggestionAnchorRect |  | `(): : { left: number, top: number, hostHeight: number, hostWidth: number } | null` | @description 建议菜单锚点：光标格左下角的像素坐标（相对宿主元素，不触 xterm 私有 API， 单元格尺寸 = 宿主尺寸 ÷ 网格数；viewportRow 钳制在视口内防滚动越界） @returns object left… | src/lib/frontends/xterm/frontend.ts:364 |
| resetTerminalModes |  | `(): : void` | — | src/lib/frontends/xterm/frontend.ts:372 |
| visualBell |  | `(): : void` | — | src/lib/frontends/xterm/frontend.ts:379 |
| scrollToTop |  | `(): : void` | — | src/lib/frontends/xterm/frontend.ts:389 |
| scrollPages |  | `(pages: number): : void` | — | src/lib/frontends/xterm/frontend.ts:394 |
| scrollLines |  | `(amount: number): : void` | — | src/lib/frontends/xterm/frontend.ts:399 |
| scrollToBottom |  | `(): : void` | — | src/lib/frontends/xterm/frontend.ts:404 |
| configureColors |  | `(scheme: TerminalColorScheme | null): : void` | — | src/lib/frontends/xterm/frontend.ts:409 |
| configure |  | `(profile: BaseTerminalProfile): : void` | — | src/lib/frontends/xterm/frontend.ts:417 |
| setZoom |  | `(zoom: number): : void` | — | src/lib/frontends/xterm/frontend.ts:434 |
| findNext |  | `(term: string, searchOptions?: SearchOptions): : SearchState` | — | src/lib/frontends/xterm/frontend.ts:440 |
| findPrevious |  | `(term: string, searchOptions?: SearchOptions): : SearchState` | — | src/lib/frontends/xterm/frontend.ts:448 |
| cancelSearch |  | `(): : void` | — | src/lib/frontends/xterm/frontend.ts:456 |
| supportsBracketedPaste |  | `(): : boolean` | — | src/lib/frontends/xterm/frontend.ts:461 |
| isAlternateScreenActive |  | `(): : boolean` | — | src/lib/frontends/xterm/frontend.ts:465 |
| setFontSize |  | `(): : void` | — | src/lib/frontends/xterm/frontend.ts:469 |
| currentFontKey |  | `(): : string` | 影响字形渲染的设置指纹（字号/行距/字体族），用于判断渲染器是否需要重建 | src/lib/frontends/xterm/frontend.ts:477 |
| remeasureFont |  | `(): : void` | @description 强制重测字符尺寸；字体设置与渲染器构建时不一致时整体重建（见 renderer 模块） @returns void | src/lib/frontends/xterm/frontend.ts:488 |
| reactivate |  | `(): : void` | Redraw the terminal and recover the renderer when its tab is shown again. | src/lib/frontends/xterm/frontend.ts:495 |

## SshConnectionRegistry

源文件：`src/lib/sshConnectionRegistry.ts:27`  限定名：`Users-scx-Documents-code-scx-terminal.src.lib.sshConnectionRegistry.SshConnectionRegistry`

| 方法 | 可见性 | 签名 | 说明 | 源文件:行号 |
| --- | --- | --- | --- | --- |
| constructor |  | `(private readonly options: RegistryOptions)` | — | src/lib/sshConnectionRegistry.ts:33 |
| registerPaneSession |  | `(profileId: string, sshId: string): : void` | @description 登记一条终端窗格会话（窗格连接建立后调用；生命周期归窗格，不做引用计数） @param profileId 档案 id @param sshId 会话 id @returns void | src/lib/sshConnectionRegistry.ts:46 |
| unregisterPaneSession |  | `(profileId: string, sshId: string): : void` | @description 注销一条终端窗格会话（窗格关闭/会话退出后调用） @param profileId 档案 id @param sshId 会话 id @returns void | src/lib/sshConnectionRegistry.ts:61 |
| paneSshIdFor |  | `(profileId: string): : string | null` | @description 该档案最近登记的窗格会话 id（复用优先取最新连接） @param profileId 档案 id @returns string \| null 会话 id；无窗格会话为 null | src/lib/sshConnectionRegistry.ts:80 |
| hasPaneSessions |  | `(profileId: string): : boolean` | — | src/lib/sshConnectionRegistry.ts:85 |
| acquire |  | `(profileId: string, consumerId: string): : Promise<string>` | @description 获取该档案的连接：窗格会话优先复用（不计数，生命周期归窗格）； 否则复用/建立 headless 连接并登记消费者 @param profileId 档案 id @param consumerId 消费者 id（S… | src/lib/sshConnectionRegistry.ts:97 |
| release |  | `(profileId: string, consumerId: string): : void` | @description 释放一个消费者；headless 连接归零后进入宽限期，期满无新消费者则断开 @param profileId 档案 id @param consumerId 消费者 id @returns void | src/lib/sshConnectionRegistry.ts:142 |
| noteHeadlessDead |  | `(sshId: string): : void` | @description headless 连接断开通知（exit 事件）：移除登记（宽限定时器一并清理） @param sshId 连接 id @returns void | src/lib/sshConnectionRegistry.ts:165 |
| isAlive |  | `(profileId: string, sshId: string): : boolean` | @description 指定连接是否仍存活（SFTP 标签判断是否需要重连） @param profileId 档案 id @param sshId 连接 id @returns boolean | src/lib/sshConnectionRegistry.ts:184 |
| profileIdForSshId |  | `(sshId: string): : string | null` | @description 连接 id → 归属档案 id（隧道管理器把运行态映射回档案/规则） @param sshId 连接 id @returns string \| null 档案 id；未知连接为 null | src/lib/sshConnectionRegistry.ts:197 |
| headlessSshIdFor |  | `(profileId: string): : string | null` | — | src/lib/sshConnectionRegistry.ts:211 |
| isConnecting |  | `(profileId: string): : boolean` | — | src/lib/sshConnectionRegistry.ts:215 |
| allSshIds |  | `(): : string[]` | @description 当前全部活跃连接 id（窗格 + headless；转发事件按连接订阅用） @returns string[] | src/lib/sshConnectionRegistry.ts:226 |

## SshSession

源文件：`src/lib/sessions/sshSession.ts:38`  限定名：`Users-scx-Documents-code-scx-terminal.src.lib.sessions.sshSession.SshSession`

| 方法 | 可见性 | 签名 | 说明 | 源文件:行号 |
| --- | --- | --- | --- | --- |
| constructor |  | `(private readonly setup: SshSessionSetup = {})` | — | src/lib/sessions/sshSession.ts:42 |
| start |  | `(options: SshSessionOptions): : Promise<void>` | — | src/lib/sessions/sshSession.ts:46 |
| resize |  | `(columns: number, rows: number): : void` | — | src/lib/sessions/sshSession.ts:132 |
| write |  | `(data: Uint8Array): : void` | — | src/lib/sessions/sshSession.ts:140 |
| kill |  | `(): : void` | — | src/lib/sessions/sshSession.ts:146 |
| gracefullyKillProcess |  | `(): : Promise<void>` | — | src/lib/sessions/sshSession.ts:150 |
| sshSessionId |  | `(): : string | null` | @description 本会话的 SSH 连接 id（SFTP 面板等按 id 定位 Rust 侧连接） @returns string \| null 会话 id；未启动为 null | src/lib/sessions/sshSession.ts:161 |
| supportsWorkingDirectory |  | `(): : boolean` | — | src/lib/sessions/sshSession.ts:165 |
| getWorkingDirectory |  | `(): : Promise<string | null>` | @description 远端当前工作目录：仅 OSC 7/1337 上报（远端 shell 配置了 hook 时可用），无探测兜底 @returns Promise<string \| null> 上报的目录或 null | src/lib/sessions/sshSession.ts:176 |

## XtermRendererManager

源文件：`src/lib/frontends/xterm/renderer.ts:26`  限定名：`Users-scx-Documents-code-scx-terminal.src.lib.frontends.xterm.renderer.XtermRendererManager`

| 方法 | 可见性 | 签名 | 说明 | 源文件:行号 |
| --- | --- | --- | --- | --- |
| constructor |  | `(private readonly deps: RendererDeps)` | — | src/lib/frontends/xterm/renderer.ts:34 |
| attach |  | `(enableWebGL: boolean): : void` | 按前端配置挂载初始渲染器（WebGL 优先，Canvas 兜底）并记录字体指纹 | src/lib/frontends/xterm/renderer.ts:37 |
| outOfDate |  | `(): : boolean` | 影响字形渲染的设置指纹比较 | src/lib/frontends/xterm/renderer.ts:48 |
| remeasure |  | `(): : void` | @description 强制重测字符尺寸；窗格变为可见且字体设置与渲染器构建时不一致时整体 重建渲染器——WKWebView 下字号在窗格隐藏期间变更时，单元格尺寸会更新 （列数/布局随之变化）但 WebGL 渲染器不按新尺寸重建字形图集… | src/lib/frontends/xterm/renderer.ts:62 |
| rebuild |  | `(): : void` | 重建渲染器（WebGL/Canvas 附加器 dispose 后重挂，图集与尺寸全量重算）并重绘 | src/lib/frontends/xterm/renderer.ts:74 |
| reactivate |  | `(enableWebGL: boolean): : void` | Redraw the terminal and recover the renderer when its tab is shown again. | src/lib/frontends/xterm/renderer.ts:93 |
| recover |  | `(): : void` | 尝试恢复（上下文丢失后窗口重新聚焦时；受挂载可见与重试上限约束） | src/lib/frontends/xterm/renderer.ts:104 |
| attachWebGL |  | `(): : void` | — | src/lib/frontends/xterm/renderer.ts:116 |
| canRecover |  | `(): : boolean` | — | src/lib/frontends/xterm/renderer.ts:128 |
| redraw |  | `(): : void` | — | src/lib/frontends/xterm/renderer.ts:133 |
| dispose |  | `(): : void` | — | src/lib/frontends/xterm/renderer.ts:140 |

## 本页确定知道的事实

- 检出类 7 个，成员方法共 97 个
- 带 docstring 说明的方法 35 个

## 未知项

- 图谱无 INHERITS 边：继承树与多态实现未检出
- 62 个方法无 docstring，说明列为确定性摘要缺失（以签名与锚点为准）
## Related

- 同目录：[calls.md](calls.md) · [glossary.md](glossary.md)
- 共享 5 个源文件、共享 1 个符号：[topic:frontends-middleware-services.md](../08-topics/frontends-middleware-services.md)
- 共享 4 个源文件：[constraints.md](../06-constraints/constraints.md)
- 共享 3 个源文件：[tech-stack.md](../01-overview/tech-stack.md)
- 总入口：[README](../README.md)

<!-- wiki:source: fallback -->
