# 类

<details>
<summary>Relevant source files</summary>

- src/lib/frontends/xterm/frontend.ts
- src/lib/frontends/xterm/renderer.ts
- src/lib/frontends/xterm/search.ts
- src/lib/frontends/xterm/support.ts
- src/lib/sessions/baseSession.ts
- src/lib/sessions/localSession.ts
- src/lib/sshConnectionRegistry.ts
- src/services/pty.ts
- src/services/ssh.ts
</details>

> ⚠️ **待确认**：MCP 知识图谱未提供继承关系（INHERITS 边），本页只列出类清单与成员方法，不含继承树；多态方法的子类实现（证据不足，禁止猜测；请人工补充后移除本标记）

## SshProxy

源文件：`src/services/ssh.ts:57`  限定名：`Users-scx-Documents-code-scx-terminal.src.services.ssh.SshProxy`

| 方法 | 可见性 | 签名 | 说明 | 源文件:行号 |
| --- | --- | --- | --- | --- |
| start |  | `(options: SSHConnectOptions): : Promise<void>` | @description 建立 SSH 连接并打开远端 shell（连接/认证/PTY 由 Rust 完成）； hostkey 事件由调用方经 subscribe('hostkey') 处理并调 confirmHostKey 应答 @par… | src/services/ssh.ts:72 |
| confirmHostKey |  | `(accepted: boolean): : Promise<void>` | @description 应答主机指纹确认（对应 `ssh:{id}:hostkey` 事件；仅 connect 阶段有效） @param accepted 是否接受该主机密钥 @returns Promise<void> | src/services/ssh.ts:103 |
| respondKbd |  | `(responses: string[] | null): : Promise<void>` | @description 应答 kbd-interactive 凭据挑战（对应 `ssh:${id}:kbdchallenge` 事件；仅认证阶段有效） @param responses 对位每个 prompt 的应答；null = 用户取… | src/services/ssh.ts:117 |
| deliverData |  | `(data: Uint8Array): : void` | @description 分发一条来自 Rust 的 SSH 输出；'data' 订阅者注册前的块先缓冲回放 @param data 输出字节 | src/services/ssh.ts:127 |
| flushPendingChunks |  | `(): : void` | @description 回放缓冲的输出块（与 pty 代理同语义：订阅者晚到不丢首屏） | src/services/ssh.ts:141 |
| getID |  | `(): : string` | — | src/services/ssh.ts:152 |
| resize |  | `(columns: number, rows: number): : Promise<void>` | — | src/services/ssh.ts:156 |
| write |  | `(data: Uint8Array): : Promise<void>` | — | src/services/ssh.ts:162 |
| kill |  | `(): : Promise<void>` | — | src/services/ssh.ts:169 |
| ackData |  | `(length: number): : void` | — | src/services/ssh.ts:175 |
| subscribe |  | `(event: string, handler: SshEventHandler): : void` | — | src/services/ssh.ts:181 |
| unsubscribeAll |  | `(): : void` | — | src/services/ssh.ts:189 |

## XtermSearchController

源文件：`src/lib/frontends/xterm/search.ts:9`  限定名：`Users-scx-Documents-code-scx-terminal.src.lib.frontends.xterm.search.XtermSearchController`

| 方法 | 可见性 | 签名 | 说明 | 源文件:行号 |
| --- | --- | --- | --- | --- |
| attach |  | `(xterm: Terminal): : void` | 挂载搜索附加器并订阅结果计数（attach 阶段调用一次） | src/lib/frontends/xterm/search.ts:14 |
| getSearchOptions |  | `(searchOptions?: SearchOptions): : ISearchOptions` | — | src/lib/frontends/xterm/search.ts:21 |
| wrapSearchResult |  | `(result: boolean): : SearchState` | — | src/lib/frontends/xterm/search.ts:33 |
| findNext |  | `(term: string, searchOptions?: SearchOptions, onBeforeSearch?: () => void): : SearchState` | 向下查找（onBeforeSearch 供 copyOnSelect 前端抑制一次选中复制） | src/lib/frontends/xterm/search.ts:41 |
| findPrevious |  | `(term: string, searchOptions?: SearchOptions, onBeforeSearch?: () => void): : SearchState` | 向上查找 | src/lib/frontends/xterm/search.ts:47 |
| clearDecorations |  | `(): : void` | 清除高亮装饰 | src/lib/frontends/xterm/search.ts:53 |

## LocalSession

源文件：`src/lib/sessions/localSession.ts:19`  限定名：`Users-scx-Documents-code-scx-terminal.src.lib.sessions.localSession.LocalSession`

| 方法 | 可见性 | 签名 | 说明 | 源文件:行号 |
| --- | --- | --- | --- | --- |
| constructor |  | `(options?: BaseSessionOptions)` | — | src/lib/sessions/localSession.ts:25 |
| start |  | `(options: LocalSessionOptions): : Promise<void>` | — | src/lib/sessions/localSession.ts:29 |
| getID |  | `(): : string | null` | — | src/lib/sessions/localSession.ts:93 |
| resize |  | `(columns: number, rows: number): : void` | — | src/lib/sessions/localSession.ts:97 |
| write |  | `(data: Uint8Array): : void` | — | src/lib/sessions/localSession.ts:106 |
| kill |  | `(signal?: string): : void` | — | src/lib/sessions/localSession.ts:115 |
| gracefullyKillProcess |  | `(): : Promise<void>` | — | src/lib/sessions/localSession.ts:119 |
| supportsWorkingDirectory |  | `(): : boolean` | — | src/lib/sessions/localSession.ts:125 |
| getWorkingDirectory |  | `(): : Promise<string | null>` | @description 当前工作目录（三级回退）：OSC 7/1337 上报优先，其次 Rust 进程 探测（读 shell 子进程 cwd，零配置兜底），都不可用时 null @returns Promise<string \| nul… | src/lib/sessions/localSession.ts:137 |

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

## BaseSession

源文件：`src/lib/sessions/baseSession.ts:21`  限定名：`Users-scx-Documents-code-scx-terminal.src.lib.sessions.baseSession.BaseSession`

| 方法 | 可见性 | 签名 | 说明 | 源文件:行号 |
| --- | --- | --- | --- | --- |
| output$ |  | `(): : Observable<string>` | — | src/lib/sessions/baseSession.ts:34 |
| binaryOutput$ |  | `(): : Observable<Uint8Array>` | — | src/lib/sessions/baseSession.ts:35 |
| closed$ |  | `(): : Observable<void>` | — | src/lib/sessions/baseSession.ts:36 |
| destroyed$ |  | `(): : Observable<void>` | — | src/lib/sessions/baseSession.ts:37 |
| constructor |  | `(options: BaseSessionOptions = {})` | — | src/lib/sessions/baseSession.ts:39 |
| feedFromTerminal |  | `(data: Uint8Array): : void` | — | src/lib/sessions/baseSession.ts:68 |
| emitOutput |  | `(data: Uint8Array): : void` | — | src/lib/sessions/baseSession.ts:72 |
| releaseInitialDataBuffer |  | `(): : void` | Holds output back until the frontend is attached so the first screen of a session (prompt, motd) is never lost. | src/lib/sessions/baseSession.ts:80 |
| destroy |  | `(): : Promise<void>` | — | src/lib/sessions/baseSession.ts:87 |

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

## TauriPTYProxy

源文件：`src/services/pty.ts:25`  限定名：`Users-scx-Documents-code-scx-terminal.src.services.pty.TauriPTYProxy`

| 方法 | 可见性 | 签名 | 说明 | 源文件:行号 |
| --- | --- | --- | --- | --- |
| start |  | `(options: PTYSpawnOptions): : Promise<void>` | — | src/services/pty.ts:32 |
| deliverData |  | `(data: Uint8Array): : void` | @description 分发一条来自 Rust 的 PTY 输出。channel 回调在 spawn 前就已安装， 而 'data' 订阅者要等 spawn 与事件监听往返之后才注册；这段窗口内到达的 输出（通常是提示符行的开头字节）先缓… | src/services/pty.ts:61 |
| flushPendingChunks |  | `(): : void` | @description 回放缓冲的输出块；订阅者在 flush 过程中接收数据与正常路径完全一致 | src/services/pty.ts:75 |
| getID |  | `(): : string` | — | src/services/pty.ts:86 |
| exists |  | `(): : Promise<boolean>` | — | src/services/pty.ts:90 |
| getWorkingDirectory |  | `(): : Promise<string | null>` | @description 经 Rust 进程探测读取会话 shell 子进程的当前工作目录 @returns Promise<string \| null> 目录绝对路径；未启动/已退出/探测失败为 null | src/services/pty.ts:104 |
| resize |  | `(columns: number, rows: number): : Promise<void>` | — | src/services/pty.ts:115 |
| write |  | `(data: Uint8Array): : Promise<void>` | — | src/services/pty.ts:121 |
| kill |  | `(_signal?: string): : Promise<void>` | — | src/services/pty.ts:128 |
| ackData |  | `(length: number): : void` | — | src/services/pty.ts:134 |
| subscribe |  | `(event: string, handler: PTYEventHandler): : void` | — | src/services/pty.ts:140 |
| unsubscribeAll |  | `(): : void` | — | src/services/pty.ts:148 |

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

## 本页确定知道的事实

- 检出类 9 个，成员方法共 100 个
- 带 docstring 说明的方法 34 个

## 未知项

- 图谱无 INHERITS 边：继承树与多态实现未检出
- 66 个方法无 docstring，说明列为确定性摘要缺失（以签名与锚点为准）
## Related

- 同目录：[calls.md](calls.md) · [glossary.md](glossary.md)
- 共享 4 个源文件：[overview.md](../01-overview/overview.md)
- 共享 4 个源文件：[tech-stack.md](../01-overview/tech-stack.md)
- 共享 4 个源文件：[troubleshooting.md](../05-guides/troubleshooting.md)
- 总入口：[README](../README.md)
