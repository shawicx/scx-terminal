import { Observable, Subject, AsyncSubject, ReplaySubject, BehaviorSubject } from 'rxjs'
import type { TerminalColorScheme } from '@/lib/colorSchemes'
import type { HostPlatform } from '@/lib/platform'
import type { ConfigStore } from '@/stores/config'

export interface SearchOptions {
    regex?: boolean
    wholeWord?: boolean
    caseSensitive?: boolean
    incremental?: true
}

export interface SearchState {
    resultIndex?: number
    resultCount: number
}

export interface BaseTerminalProfile {
    terminalColorScheme: TerminalColorScheme | null
}

/**
 * Bridge to app-level services, replacing Tabby's Angular DI injector.
 * `config` is the reactive Pinia state — reads inside the frontend stay live.
 */
export interface HotkeysBridge {
    pushKeyEvent (name: 'keydown' | 'keyup', event: KeyboardEvent): void
    matchActiveHotkey (keydown: boolean): string | null
}

export interface FrontendContext {
    config: ConfigStore
    getCSSFontFamily (): string
    platform: HostPlatform
    colorScheme (): TerminalColorScheme
    setClipboard (text: string): Promise<void>
    hotkeys?: HotkeysBridge
}

/** Resize event emitted by a frontend when its grid dimensions change. */
export interface ResizeEvent {
    rows: number
    columns: number
}

/**
 * A VT/terminal renderer frontend. Ported from tabby-terminal/src/frontends/frontend.ts.
 */
export abstract class Frontend {
    enableResizing = true
    protected ready = new AsyncSubject<void>()
    protected title = new ReplaySubject<string>(1)
    protected alternateScreenActive = new BehaviorSubject<boolean>(false)
    protected mouseEvent = new Subject<MouseEvent>()
    protected bell = new Subject<void>()
    protected input = new Subject<Uint8Array>()
    protected resize = new ReplaySubject<ResizeEvent>(1)
    protected destroyed = new Subject<void>()

    get ready$ (): Observable<void> { return this.ready }
    get title$ (): Observable<string> { return this.title }
    get alternateScreenActive$ (): Observable<boolean> { return this.alternateScreenActive }
    get mouseEvent$ (): Observable<MouseEvent> { return this.mouseEvent }
    get bell$ (): Observable<void> { return this.bell }
    get input$ (): Observable<Uint8Array> { return this.input }
    get resize$ (): Observable<ResizeEvent> { return this.resize }
    get destroyed$ (): Observable<void> { return this.destroyed }

    constructor (protected context: FrontendContext) { }

    destroy (): void {
        this.destroyed.next()
        for (const o of [this.ready, this.title, this.alternateScreenActive, this.mouseEvent, this.bell, this.input, this.resize, this.destroyed]) {
            o.complete()
        }
    }

    abstract attach (host: HTMLElement, profile: BaseTerminalProfile): Promise<void>
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    detach (_host: HTMLElement): void {}

    abstract getSelection (): string
    abstract copySelection (): void
    abstract selectAll (): void
    abstract clearSelection (): void
    abstract focus (): void
    abstract write (data: string): Promise<void>
    abstract clear (): void
    abstract visualBell (): void

    abstract scrollToTop (): void
    abstract scrollLines (amount: number): void
    abstract scrollPages (pages: number): void
    abstract scrollToBottom (): void

    abstract configure (profile: BaseTerminalProfile): void
    abstract setZoom (zoom: number): void

    abstract findNext (term: string, searchOptions?: SearchOptions): SearchState
    abstract findPrevious (term: string, searchOptions?: SearchOptions): SearchState
    abstract cancelSearch (): void

    abstract supportsBracketedPaste (): boolean
    abstract isAlternateScreenActive (): boolean

    resetTerminalModes (): void {}
}
