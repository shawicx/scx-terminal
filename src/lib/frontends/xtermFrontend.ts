import deepEqual from 'deep-equal'
import { BehaviorSubject, filter, firstValueFrom, fromEvent, takeUntil } from 'rxjs'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon, type ISearchOptions } from '@xterm/addon-search'
import { WebglAddon } from '@xterm/addon-webgl'
import { CanvasAddon } from '@xterm/addon-canvas'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { encodeUTF8 } from '@/lib/utils/bytes'
import { generatePalette } from '@/lib/generatePalette'
import type { TerminalColorScheme } from '@/lib/colorSchemes'
import { BaseTerminalProfile, Frontend, FrontendContext, SearchOptions, SearchState } from './frontend'
import './xterm.css'
import '@xterm/xterm/css/xterm.css'

const COLOR_NAMES = [
    'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
    'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
] as const

// Fcitx5 applies Chinese punctuation during the browser's default text-input
// processing. If xterm handles these keys on keydown, it calls preventDefault()
// before Fcitx5 can emit the converted keypress/input event.
const LINUX_IME_TEXT_KEY_CODES = new Set([
    'Backquote',
    'Backslash',
    'BracketLeft',
    'BracketRight',
    'Comma',
    'Period',
    'Quote',
    'Semicolon',
    'Slash',
])

function isIMETextKey (event: KeyboardEvent): boolean {
    if (event.ctrlKey || event.altKey || event.metaKey) {
        return false
    }
    return LINUX_IME_TEXT_KEY_CODES.has(event.code) || event.code === 'Space' && event.shiftKey
}

// How many times to recreate the WebGL renderer after a lost GPU context
// before giving up and letting xterm fall back to its DOM renderer.
const MAX_WEBGL_RECOVERY_ATTEMPTS = 3

class FlowControl {
    private blocked = false
    private blocked$ = new BehaviorSubject<boolean>(false)
    private pendingCallbacks = 0
    private lowWatermark = 5
    private highWatermark = 10
    private bytesWritten = 0
    private bytesThreshold = 1024 * 128

    constructor (private xterm: Terminal) { }

    async write (data: string): Promise<void> {
        if (this.blocked) {
            await firstValueFrom(this.blocked$.pipe(filter(x => !x)))
        }
        this.bytesWritten += data.length
        if (this.bytesWritten > this.bytesThreshold) {
            this.pendingCallbacks++
            this.bytesWritten = 0
            if (!this.blocked && this.pendingCallbacks > this.highWatermark) {
                this.blocked = true
                this.blocked$.next(true)
            }
            this.xterm.write(data, () => {
                this.pendingCallbacks--
                if (this.blocked && this.pendingCallbacks < this.lowWatermark) {
                    this.blocked = false
                    this.blocked$.next(false)
                }
            })
        } else {
            this.xterm.write(data)
        }
    }
}

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
    private resizeHandler: () => void
    private configuredTheme: Partial<ITheme> = {}
    private copyOnSelect = false
    private preventNextOnSelectionChangeEvent = false
    private search = new SearchAddon()
    private searchState: SearchState = { resultCount: 0 }
    private fitAddon = new FitAddon()
    private webGLAddon?: WebglAddon
    private canvasAddon?: CanvasAddon
    private opened = false
    private resizeObserver?: ResizeObserver
    private resizeTimeout?: ReturnType<typeof setTimeout>
    private resizeAnimationFrame?: number
    private resizePending = false
    private disposed = false
    private flowControl: FlowControl
    private pinnedToBottom = true
    private pendingRendererRecovery = false
    private rendererRecoveryAttempts = 0

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
        this.xterm.unicode.activeVersion = '11'

        const keyboardEventHandler = (name: string, event: KeyboardEvent) => {
            if (this.isAlternateScreenActive()) {
                let modifiers = 0
                modifiers += event.ctrlKey ? 1 : 0
                modifiers += event.altKey ? 1 : 0
                modifiers += event.shiftKey ? 1 : 0
                modifiers += event.metaKey ? 1 : 0
                if (event.key.startsWith('Arrow') && modifiers === 1) {
                    return true
                }
            }

            // Ctrl-/
            if (event.type === 'keydown' && event.key === '/' && event.ctrlKey) {
                this.input.next(encodeUTF8('\u001f'))
                return false
            }

            // Ctrl-@
            if (event.type === 'keydown' && event.key === '@' && event.ctrlKey) {
                this.input.next(encodeUTF8('\u0000'))
                return false
            }

            const hotkeys = this.context.hotkeys
            if (hotkeys) {
                hotkeys.pushKeyEvent(name as 'keydown' | 'keyup', event)
                let ret = true
                if (hotkeys.matchActiveHotkey(true) !== null) {
                    event.stopPropagation()
                    event.preventDefault()
                    ret = false
                }
                return ret
            }
            return true
        }

        this.xterm.attachCustomKeyEventHandler((event: KeyboardEvent) => {
            // let the app-level paste handling own Cmd/Ctrl+V
            if (
                event.getModifierState('Meta') && event.key.toLowerCase() === 'v' ||
                event.key === 'Insert' && event.shiftKey
            ) {
                event.preventDefault()
                return false
            }
            if (event.getModifierState('Meta') && event.key.startsWith('Arrow')) {
                return false
            }

            const handled = keyboardEventHandler('keydown', event)
            if (!handled) {
                return false
            }

            if (this.context.platform === 'linux' && isIMETextKey(event)) {
                return false
            }

            return handled
        })

        this.xtermCore._scrollToBottom = this.xtermCore.scrollToBottom.bind(this.xtermCore)
        this.xtermCore.scrollToBottom = () => null

        // NOTE: xterm.onScroll only fires for content-driven scroll (new lines),
        // NOT for user wheel/keyboard scroll. During fast output, viewportY
        // transiently equals baseY during xterm's internal processing, so
        // onScroll would falsely re-pin. Pin state changes only via wheel/keyboard
        // listeners and explicit scrollToBottom() calls.

        const doResize = () => {
            try {
                if (this.xterm.element && getComputedStyle(this.xterm.element).getPropertyValue('height') !== 'auto') {
                    const savedPinned = this.pinnedToBottom
                    const savedViewportY = this.xterm.buffer.active.viewportY

                    this.fitAddon.fit()
                    this.xtermCore.viewport._refresh()

                    if (savedPinned) {
                        this.xtermCore._scrollToBottom()
                    } else {
                        const maxScroll = this.xterm.buffer.active.baseY
                        const targetY = Math.min(savedViewportY, maxScroll)
                        this.xterm.scrollToLine(targetY)
                    }

                    // Force the repaint now to avoid a blank frame during a window drag.
                    this.xtermCore._renderService?._renderRows(0, this.xterm.rows - 1)
                }
            } catch (e) {
                // tends to throw when element wasn't shown yet
                console.warn('Could not resize xterm', e)
            }
        }

        // Rate-limit reflows during a window drag — each reflow resizes the
        // renderer's drawing buffer and re-uploads the glyph atlas texture.
        const RESIZE_MIN_INTERVAL = 32
        let lastResize = 0
        const runResize = () => {
            this.resizeAnimationFrame = undefined
            this.resizePending = false
            if (!this.isAttachActive()) {
                return
            }
            lastResize = Date.now()
            doResize()
        }
        this.resizeHandler = () => {
            if (this.resizePending) {
                return
            }
            this.resizePending = true
            const wait = Math.max(0, RESIZE_MIN_INTERVAL - (Date.now() - lastResize))
            if (wait > 0) {
                this.resizeTimeout = setTimeout(() => {
                    this.resizeTimeout = undefined
                    this.resizeAnimationFrame = requestAnimationFrame(runResize)
                }, wait)
            } else {
                this.resizeAnimationFrame = requestAnimationFrame(runResize)
            }
        }

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

        if (this.enableWebGL) {
            this.attachWebGLAddon()
        } else {
            this.canvasAddon = new CanvasAddon()
            this.xterm.loadAddon(this.canvasAddon)
        }

        // Allow an animation frame
        await new Promise(r => setTimeout(r, 100))
        if (!this.isAttachActive()) {
            return
        }

        this.ready.next()
        this.ready.complete()

        this.xterm.loadAddon(this.search)

        this.search.onDidChangeResults(state => {
            this.searchState = state
        })

        window.addEventListener('resize', this.resizeHandler)

        // The GPU context is often dropped while the app is in the background;
        // retry recovery once the window is focused again and WebGL is usable.
        fromEvent(window, 'focus')
            .pipe(takeUntil(this.destroyed$))
            .subscribe(() => this.recoverRenderer())

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
                event.preventDefault()
                event.stopPropagation()
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
        if (this.resizeTimeout !== undefined) {
            clearTimeout(this.resizeTimeout)
            this.resizeTimeout = undefined
        }
        if (this.resizeAnimationFrame !== undefined) {
            cancelAnimationFrame(this.resizeAnimationFrame)
            this.resizeAnimationFrame = undefined
        }
        this.resizePending = false
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
        this.webGLAddon?.dispose()
        this.canvasAddon?.dispose()
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
        scheme = scheme ?? this.context.colorScheme()

        const theme: Partial<ITheme> = {
            foreground: scheme.foreground,
            selectionBackground: scheme.selection ?? '#88888888',
            selectionForeground: scheme.selectionForeground ?? undefined,
            background: scheme.background,
            cursor: scheme.cursor,
            cursorAccent: scheme.cursorAccent,
        }

        for (let i = 0; i < COLOR_NAMES.length; i++) {
            theme[COLOR_NAMES[i]] = scheme.colors[i]
        }

        if (this.context.config.terminal.paletteGenerate) {
            theme.extendedAnsi = generatePalette(
                scheme.colors,
                scheme.background,
                scheme.foreground,
                this.context.config.terminal.paletteHarmonious,
            )
        }

        if (!deepEqual(this.configuredTheme, theme)) {
            this.xterm.options.theme = theme as ITheme
            this.configuredTheme = theme
        }
    }

    configure (_profile: BaseTerminalProfile): void {
        const config = this.context.config

        setTimeout(() => {
            if (this.xterm.cols && this.xterm.rows && this.xtermCore.charMeasure) {
                this.xtermCore.charMeasure.measure(this.xtermCore.options)
                if (this.xtermCore.renderer) {
                    this.xtermCore.renderer._updateDimensions()
                }
                this.resizeHandler()
            }
        }, 0)

        this.xtermCore.browser.isWindows = this.context.platform === 'windows'
        this.xtermCore.browser.isLinux = this.context.platform === 'linux'
        this.xtermCore.browser.isMac = this.context.platform === 'macos'

        this.xterm.options.fontFamily = this.context.getCSSFontFamily()
        this.xterm.options.cursorStyle = this.context.config.terminal.cursor
        this.xterm.options.cursorBlink = config.terminal.cursorBlink
        this.xterm.options.macOptionIsMeta = config.terminal.altIsMeta
        this.xterm.options.scrollback = config.terminal.scrollbackLines
        this.xterm.options.wordSeparator = config.terminal.wordSeparator
        this.xterm.options.drawBoldTextInBrightColors = config.terminal.drawBoldTextInBrightColors
        this.xterm.options.fontWeight = config.terminal.fontWeight
        this.xterm.options.fontWeightBold = config.terminal.fontWeightBold
        this.xterm.options.minimumContrastRatio = config.terminal.minimumContrastRatio
        this.configuredFontSize = config.terminal.fontSize
        this.configuredLinePadding = config.terminal.linePadding
        this.setFontSize()

        this.copyOnSelect = config.terminal.copyOnSelect

        this.configureColors(null)
    }

    setZoom (zoom: number): void {
        this.zoom = zoom
        this.setFontSize()
        this.resizeHandler()
    }

    private getSearchOptions (searchOptions?: SearchOptions): ISearchOptions {
        return {
            ...searchOptions,
            decorations: {
                matchOverviewRuler: '#888888',
                activeMatchColorOverviewRuler: '#ffff00',
                matchBackground: '#888888',
                activeMatchBackground: '#ffff00',
            },
        }
    }

    private wrapSearchResult (result: boolean): SearchState {
        if (!result) {
            return { resultCount: 0 }
        }
        return this.searchState
    }

    findNext (term: string, searchOptions?: SearchOptions): SearchState {
        if (this.copyOnSelect) {
            this.preventNextOnSelectionChangeEvent = true
        }
        return this.wrapSearchResult(
            this.search.findNext(term, this.getSearchOptions(searchOptions)),
        )
    }

    findPrevious (term: string, searchOptions?: SearchOptions): SearchState {
        if (this.copyOnSelect) {
            this.preventNextOnSelectionChangeEvent = true
        }
        return this.wrapSearchResult(
            this.search.findPrevious(term, this.getSearchOptions(searchOptions)),
        )
    }

    cancelSearch (): void {
        this.search.clearDecorations()
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

    /**
     * Redraw the terminal and recover the renderer when its tab is shown again.
     */
    reactivate (): void {
        if (this.pendingRendererRecovery || this.enableWebGL && !this.webGLAddon) {
            this.pendingRendererRecovery = true
            this.recoverRenderer()
        } else {
            this.rendererRecoveryAttempts = 0
            this.redraw()
        }
    }

    private attachWebGLAddon (): void {
        const addon = new WebglAddon()
        addon.onContextLoss(() => this.onWebGLContextLoss())
        this.xterm.loadAddon(addon)
        this.webGLAddon = addon
    }

    private onWebGLContextLoss (): void {
        this.webGLAddon?.dispose()
        this.webGLAddon = undefined
        this.pendingRendererRecovery = true
        this.recoverRenderer()
    }

    private recoverRenderer (): void {
        if (!this.pendingRendererRecovery || !this.canRecoverRenderer()) {
            return
        }
        this.pendingRendererRecovery = false
        if (this.rendererRecoveryAttempts < MAX_WEBGL_RECOVERY_ATTEMPTS) {
            this.rendererRecoveryAttempts++
            this.attachWebGLAddon()
        }
        this.redraw()
    }

    private canRecoverRenderer (): boolean {
        return !!this.element && this.element.offsetParent !== null && document.hasFocus()
    }

    private redraw (): void {
        const renderService = this.xtermCore._renderService
        renderService?.clear()
        this.resizeHandler()
        renderService?.handleResize(this.xterm.cols, this.xterm.rows)
    }
}

/** XTerm frontend with the WebGL renderer enabled (canvas fallback). */
export class XTermWebGLFrontend extends XTermFrontend {
    protected enableWebGL = true
}
