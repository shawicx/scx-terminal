/**
 * @description xterm.js 前端本体（移植自 tabby-terminal xtermFrontend）：
 *              终端实例装配、键盘/事件接线、挂载与销毁、配置与搜索 API。
 *              支撑件（流控/键盘链/重排调度/渲染器/行读取）在 xterm/ 子模块。
 */
import deepEqual from 'deep-equal'
import { fromEvent, takeUntil } from 'rxjs'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { encodeUTF8 } from '@/lib/utils/bytes'
import type { TerminalColorScheme } from '@/lib/colorSchemes'
import { readLogicalLine, type LogicalLine } from '@/lib/suggestions/promptTracker'
import { BaseTerminalProfile, Frontend, FrontendContext, SearchOptions, SearchState } from '../frontend'
import { FlowControl, openLinkInSystemBrowser } from './support'
import { applyXtermOptions, buildXtermTheme } from './options'
import { XtermSearchController } from './search'
import { createKeyGate, createKeyboardEventHandler } from './keyboard'
import { ResizeScheduler, fitPreservingScroll } from './resize'
import { XtermRendererManager } from './renderer'
import { bufferAccessOf, cursorPrefix, logicalLineAbove, suggestionAnchorRect } from './lines'
import '../xterm.css'
import '@xterm/xterm/css/xterm.css'

/** xterm.js-based terminal frontend. Ported from tabby-terminal/src/frontends/xtermFrontend.ts. */
export class XTermFrontend extends Frontend {
    enableResizing = true
    xterm: Terminal
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected xtermCore: any
    protected enableWebGL = false
    private element?: HTMLElement
    private configuredFontSize = 0
    private configuredLinePadding = 0
    private zoom = 0
    private resizeScheduler: ResizeScheduler
    private configuredTheme: Partial<ITheme> = {}
    private copyOnSelect = false
    private preventNextOnSelectionChangeEvent = false
    private searchController = new XtermSearchController()
    private fitAddon = new FitAddon()
    private webLinksAddon = new WebLinksAddon((event, uri) => openLinkInSystemBrowser(event, uri))
    private opened = false
    private resizeObserver?: ResizeObserver
    private disposed = false
    private flowControl: FlowControl
    private renderer: XtermRendererManager
    private pinnedToBottom = true

    private isAttachActive (): boolean {
        return !this.disposed && this.opened
    }

    constructor (context: FrontendContext) {
        super(context)

        this.xterm = new Terminal({
            allowTransparency: true,
            allowProposedApi: true,
            overviewRulerWidth: 8,
            windowsPty: context.platform === 'windows'
                ? { backend: 'conpty', buildNumber: 0 }
                : undefined,
        })
        this.flowControl = new FlowControl(this.xterm)
        // xterm internals access (viewport/render service patching) — private API, same as Tabby
        this.xtermCore = (this.xterm as unknown as { _core: any })._core // eslint-disable-line @typescript-eslint/no-explicit-any

        this.xterm.onBinary(data => {
            // latin1-style encode of xterm's binary strings
            const bytes = new Uint8Array(data.length)
            for (let i = 0; i < data.length; i++) {
                bytes[i] = data.charCodeAt(i) & 0xff
            }
            this.input.next(bytes)
        })
        this.xterm.onData(data => {
            this.input.next(encodeUTF8(data))
        })
        this.xterm.onResize(({ cols, rows }) => {
            this.resize.next({ rows, columns: cols })
        })
        this.xterm.onTitleChange(title => {
            this.title.next(title)
        })
        this.xterm.onSelectionChange(() => {
            if (this.getSelection()) {
                if (this.copyOnSelect && !this.preventNextOnSelectionChangeEvent) {
                    this.copySelection()
                }
                this.preventNextOnSelectionChangeEvent = false
            }
        })
        this.xterm.onBell(() => {
            this.bell.next()
        })

        this.xterm.loadAddon(this.fitAddon)
        this.xterm.loadAddon(new Unicode11Addon())
        this.xterm.loadAddon(this.webLinksAddon)
        this.xterm.unicode.activeVersion = '11'

        const keyboardEventHandler = createKeyboardEventHandler({
            isAlternateScreenActive: () => this.isAlternateScreenActive(),
            input: this.input,
            hotkeys: this.context.hotkeys,
        })

        this.xterm.attachCustomKeyEventHandler(createKeyGate({
            platform: this.context.platform,
            handle: keyboardEventHandler,
        }))

        this.xtermCore._scrollToBottom = this.xtermCore.scrollToBottom.bind(this.xtermCore)
        this.xtermCore.scrollToBottom = () => null

        // NOTE: xterm.onScroll only fires for content-driven scroll (new lines),
        // NOT for user wheel/keyboard scroll. During fast output, viewportY
        // transiently equals baseY during xterm's internal processing, so
        // onScroll would falsely re-pin. Pin state changes only via wheel/keyboard
        // listeners and explicit scrollToBottom() calls.

        const doResize = () => fitPreservingScroll(this.xterm, this.xtermCore, this.fitAddon, () => this.pinnedToBottom)
        this.resizeScheduler = new ResizeScheduler(doResize, () => this.isAttachActive())
        this.renderer = new XtermRendererManager({
            xterm: this.xterm,
            xtermCore: this.xtermCore,
            getElement: () => this.element,
            isAttached: () => this.isAttachActive(),
            fontKey: () => this.currentFontKey(),
            requestResize: () => this.resizeHandler(),
        })

        const oldKeyUp = this.xtermCore._keyUp.bind(this.xtermCore)
        this.xtermCore._keyUp = (e: KeyboardEvent) => {
            this.xtermCore.updateCursorStyle(e)
            if (keyboardEventHandler('keyup', e)) {
                oldKeyUp(e)
            }
        }

        this.xterm.buffer.onBufferChange(() => {
            const altBufferActive = this.xterm.buffer.active.type === 'alternate'
            this.alternateScreenActive.next(altBufferActive)
        })
    }

    private isAtBottom (): boolean {
        const buffer = this.xterm.buffer.active
        return buffer.viewportY >= buffer.baseY - 1
    }

    private updatePinnedState (): void {
        this.pinnedToBottom = this.isAtBottom()
    }

    private resizeHandler (): void {
        this.resizeScheduler.schedule()
    }

    async attach (host: HTMLElement, _profile: BaseTerminalProfile): Promise<void> {
        if (this.disposed) {
            return
        }
        this.element = host

        this.xterm.open(host)
        this.opened = true

        if (!this.isAttachActive()) {
            return
        }

        // Just configure the colors to avoid a flash
        this.configureColors(null)
        this.renderer.attach(this.enableWebGL)

        // Allow an animation frame
        await new Promise(r => setTimeout(r, 100))
        if (!this.isAttachActive()) {
            return
        }

        this.ready.next()
        this.ready.complete()

        this.searchController.attach(this.xterm)

        window.addEventListener('resize', this.resizeHandler)

        // The GPU context is often dropped while the app is in the background;
        // retry recovery once the window is focused again and WebGL is usable.
        fromEvent(window, 'focus')
            .pipe(takeUntil(this.destroyed$))
            .subscribe(() => this.renderer.recover())

        this.resizeHandler()

        await new Promise(r => setTimeout(r, 0))
        if (!this.isAttachActive()) {
            return
        }

        // User-initiated scroll detection: only wheel and keyboard events
        // should unpin. Capture phase — xterm may stop propagation.
        const wheelHandler = (event: WheelEvent) => {
            if (event.deltaY < 0) {
                this.pinnedToBottom = false
            }
            requestAnimationFrame(() => this.updatePinnedState())
        }

        this.hostEventHandlers = {
            wheel: wheelHandler,
            mousedown: event => this.mouseEvent.next(event),
            mouseup: event => this.mouseEvent.next(event),
            contextmenu: event => {
                // 只屏蔽 WKWebView 原生菜单；不 stopPropagation，
                // 让右键事件冒泡到窗格层触发应用内右键菜单
                event.preventDefault()
            },
        }

        host.addEventListener('wheel', this.hostEventHandlers.wheel, { capture: true, passive: true })
        host.addEventListener('mousedown', this.hostEventHandlers.mousedown)
        host.addEventListener('mouseup', this.hostEventHandlers.mouseup)
        host.addEventListener('contextmenu', this.hostEventHandlers.contextmenu)

        this.resizeObserver = new ResizeObserver(() => this.resizeHandler())
        this.resizeObserver.observe(host)
    }

    private hostEventHandlers?: {
        wheel: (event: WheelEvent) => void
        mousedown: (event: MouseEvent) => void
        mouseup: (event: MouseEvent) => void
        contextmenu: (event: MouseEvent) => void
    }

    detach (_host: HTMLElement): void {
        const host = this.element
        window.removeEventListener('resize', this.resizeHandler)
        this.resizeScheduler.dispose()
        if (host && this.hostEventHandlers) {
            host.removeEventListener('wheel', this.hostEventHandlers.wheel, { capture: true } as EventListenerOptions)
            host.removeEventListener('mousedown', this.hostEventHandlers.mousedown)
            host.removeEventListener('mouseup', this.hostEventHandlers.mouseup)
            host.removeEventListener('contextmenu', this.hostEventHandlers.contextmenu)
            this.hostEventHandlers = undefined
        }
        this.resizeObserver?.disconnect()
        this.resizeObserver = undefined
        this.opened = false
        this.element = undefined
    }

    destroy (): void {
        if (this.disposed) {
            return
        }
        this.disposed = true
        if (this.element) {
            this.detach(this.element)
        }
        super.destroy()
        this.renderer.dispose()
        this.xterm.dispose()
    }

    getSelection (): string {
        return this.xterm.getSelection()
    }

    copySelection (): void {
        const text = this.getSelection()
        if (!text.trim().length) {
            return
        }
        void this.context.setClipboard(text)
    }

    selectAll (): void {
        this.xterm.selectAll()
    }

    clearSelection (): void {
        this.xterm.clearSelection()
    }

    focus (): void {
        setTimeout(() => this.xterm.focus())
    }

    async write (data: string): Promise<void> {
        // Capture pinned state before the write — the async write yields
        // to the event loop, and RAF callbacks (e.g. from wheel events)
        // could change pinnedToBottom mid-write.
        const wasPinned = this.pinnedToBottom
        const savedViewportY = this.xterm.buffer.active.viewportY
        await this.flowControl.write(data)
        if (wasPinned) {
            this.xtermCore._scrollToBottom()
        } else {
            const maxScroll = this.xterm.buffer.active.baseY
            const targetY = Math.min(savedViewportY, maxScroll)
            if (this.xterm.buffer.active.viewportY !== targetY) {
                this.xterm.scrollToLine(targetY)
            }
        }
    }

    clear (): void {
        this.xterm.clear()
    }

    /**
     * @description 当前 xterm 实际渲染尺寸（spawn 后与 pty 对齐用）
     * @returns { columns, rows } 列数与行数
     *
     * @example frontend.getSize().columns // => 88
     *
     */
    getSize (): { columns: number, rows: number } {
        return { columns: this.xterm.cols, rows: this.xterm.rows }
    }

    /**
     * @description 当前光标逻辑行（soft-wrap 拼接后，未剥提示符）——建议输入行模型用
     * @returns LogicalLine | null buffer 不可读时 null
     *
     * @example frontend.readLogicalLineNow()?.text // 'user@mac ~ % git che'
     *
     */
    readLogicalLineNow (): LogicalLine | null {
        return readLogicalLine(bufferAccessOf(this.xterm))
    }

    /**
     * @description 向上第 up 个逻辑行的完整文本（续行合并采集用；up=0 等价 readLogicalLineNow 但光标在行尾）
     * @param up 向上偏移的逻辑行数
     * @returns LogicalLine | null 越界时 null
     */
    readLogicalLineAbove (up: number): LogicalLine | null {
        return logicalLineAbove(this.xterm, up)
    }

    /**
     * @description 光标行 [0, cursorX) 文本（提示符学习锚点；RPROMPT 天然被排除在光标右侧）
     * @returns string | null
     */
    readCursorPrefix (): string | null {
        return cursorPrefix(this.xterm)
    }

    /**
     * @description 建议菜单锚点：光标格左下角的像素坐标（相对宿主元素，不触 xterm 私有 API，
     *              单元格尺寸 = 宿主尺寸 ÷ 网格数；viewportRow 钳制在视口内防滚动越界）
     * @returns object left/top 与宿主高宽；未 attach 时 null
     */
    getSuggestionAnchorRect (): { left: number, top: number, hostHeight: number, hostWidth: number } | null {
        const host = this.element
        if (!host) {
            return null
        }
        return suggestionAnchorRect(this.xterm, host)
    }

    resetTerminalModes (): void {
        // Disable mouse tracking modes and SGR extended mouse mode to prevent
        // stale mouse tracking from leaking escape sequences as text.
        this.xterm.write('\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l')
        this.xterm.write('\x1b[?2004l')
    }

    visualBell (): void {
        if (this.element) {
            this.element.style.animation = 'none'
            // Force a synchronous reflow so the browser registers the cleared
            // animation before it is reassigned (repeated bells coalesce otherwise).
            void this.element.offsetWidth
            this.element.style.animation = 'terminalShakeFrames 0.3s ease'
        }
    }

    scrollToTop (): void {
        this.pinnedToBottom = false
        this.xterm.scrollToTop()
    }

    scrollPages (pages: number): void {
        this.xterm.scrollPages(pages)
        this.updatePinnedState()
    }

    scrollLines (amount: number): void {
        this.xterm.scrollLines(amount)
        this.updatePinnedState()
    }

    scrollToBottom (): void {
        this.pinnedToBottom = true
        this.xtermCore._scrollToBottom()
    }

    private configureColors (scheme: TerminalColorScheme | null): void {
        const theme = buildXtermTheme(scheme ?? this.context.colorScheme(), this.context.config)
        if (!deepEqual(this.configuredTheme, theme)) {
            this.xterm.options.theme = theme as ITheme
            this.configuredTheme = theme
        }
    }

    configure (_profile: BaseTerminalProfile): void {
        setTimeout(() => {
            if (this.xterm.cols && this.xterm.rows) {
                this.remeasureFont()
            }
        }, 0)

        const applied = applyXtermOptions(this.xterm, this.xtermCore, this.context)
        this.configuredFontSize = applied.fontSize
        this.configuredLinePadding = applied.linePadding
        this.copyOnSelect = applied.copyOnSelect
        this.setFontSize()

        this.configureColors(null)
    }

    setZoom (zoom: number): void {
        this.zoom = zoom
        this.setFontSize()
        this.resizeHandler()
    }

    findNext (term: string, searchOptions?: SearchOptions): SearchState {
        return this.searchController.findNext(term, searchOptions, () => {
            if (this.copyOnSelect) {
                this.preventNextOnSelectionChangeEvent = true
            }
        })
    }

    findPrevious (term: string, searchOptions?: SearchOptions): SearchState {
        return this.searchController.findPrevious(term, searchOptions, () => {
            if (this.copyOnSelect) {
                this.preventNextOnSelectionChangeEvent = true
            }
        })
    }

    cancelSearch (): void {
        this.searchController.clearDecorations()
        this.focus()
    }

    supportsBracketedPaste (): boolean {
        return this.xterm.modes.bracketedPasteMode
    }

    isAlternateScreenActive (): boolean {
        return this.xterm.buffer.active.type === 'alternate'
    }

    private setFontSize (): void {
        const scale = Math.pow(1.1, this.zoom)
        this.xterm.options.fontSize = this.configuredFontSize * scale
        this.xterm.options.lineHeight = Math.max(1, (this.configuredFontSize + this.configuredLinePadding * 2) / this.configuredFontSize)
        this.resizeHandler()
    }

    /** 影响字形渲染的设置指纹（字号/行距/字体族），用于判断渲染器是否需要重建 */
    private currentFontKey (): string {
        return `${this.xterm.options.fontSize}|${this.configuredLinePadding}|${this.context.getCSSFontFamily()}`
    }

    /**
     * @description 强制重测字符尺寸；字体设置与渲染器构建时不一致时整体重建（见 renderer 模块）
     * @returns void
     *
     * @example frontend.remeasureFont()
     *
     */
    remeasureFont (): void {
        this.renderer.remeasure()
    }

    /**
     * Redraw the terminal and recover the renderer when its tab is shown again.
     */
    reactivate (): void {
        this.renderer.reactivate(this.enableWebGL)
    }
}

/** XTerm frontend with the WebGL renderer enabled (canvas fallback). */
export class XTermWebGLFrontend extends XTermFrontend {
    protected enableWebGL = true
}
