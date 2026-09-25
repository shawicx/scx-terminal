/**
 * @description xterm 前端支撑件：写流控（FlowControl 背压）、Linux IME 按键判定、
 *              系统浏览器开链、配色槽位名与 WebGL 恢复上限（原 xtermFrontend.ts 顶部工具）。
 */
import { BehaviorSubject, filter, firstValueFrom } from 'rxjs'
import type { Terminal } from '@xterm/xterm'
import { openUrl } from '@tauri-apps/plugin-opener'

export const COLOR_NAMES = [
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

/**
 * @description Linux 下拦截会经 IME 转中文标点的按键（放行给浏览器文本输入层）
 * @param event 键盘事件
 * @returns boolean true = 交给 IME（不进 xterm keydown）
 *
 */
export function isIMETextKey (event: KeyboardEvent): boolean {
    if (event.ctrlKey || event.altKey || event.metaKey) {
        return false
    }
    return LINUX_IME_TEXT_KEY_CODES.has(event.code) || event.code === 'Space' && event.shiftKey
}

/**
 * @description 经系统默认浏览器打开终端内点击的链接（WebLinksAddon 回调）
 * @param event 触发的鼠标事件
 * @param uri 链接地址
 * @returns void
 *
 * @example openLinkInSystemBrowser(event, 'https://example.com')
 *
 */
export function openLinkInSystemBrowser (event: MouseEvent, uri: string): void {
    event.preventDefault()
    void openUrl(uri)
}

// How many times to recreate the WebGL renderer after a lost GPU context
// before giving up and letting xterm fall back to its DOM renderer.
export const MAX_WEBGL_RECOVERY_ATTEMPTS = 3

/** xterm 写流控：未完成回调堆积过高时阻塞写入方，回落水位后放行（Tabby 同款）。 */
export class FlowControl {
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
