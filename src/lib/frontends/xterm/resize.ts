import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'

/**
 * @description xterm 重排调度器：32ms 节流 + rAF 合并（窗口拖拽时降低 reflow 频率，
 *              每次重排都会重建渲染器画布并重传字形图集）。原 XTermFrontend 构造器内的
 *              resizeHandler/doResize 调度部分；doResize 实际逻辑由回调注入。
 */

/** Rate-limit reflows during a window drag — each reflow resizes the renderer's drawing buffer and re-uploads the glyph atlas texture. */
const RESIZE_MIN_INTERVAL = 32

export class ResizeScheduler {
    private timeout?: ReturnType<typeof setTimeout>
    private animationFrame?: number
    private pending = false
    private lastResize = 0

    constructor (
        private readonly doResize: () => void,
        private readonly isAttachActive: () => boolean,
    ) { }

    /** 触发一次重排（节流 + rAF 合并；未挂载时丢弃） */
    schedule (): void {
        if (this.pending) {
            return
        }
        this.pending = true
        const wait = Math.max(0, RESIZE_MIN_INTERVAL - (Date.now() - this.lastResize))
        if (wait > 0) {
            this.timeout = setTimeout(() => {
                this.timeout = undefined
                this.animationFrame = requestAnimationFrame(this.run)
            }, wait)
        } else {
            this.animationFrame = requestAnimationFrame(this.run)
        }
    }

    private readonly run = () => {
        this.animationFrame = undefined
        this.pending = false
        if (!this.isAttachActive()) {
            return
        }
        this.lastResize = Date.now()
        this.doResize()
    }

    /** 清空挂起的定时器/帧请求（detach 时调用） */
    dispose (): void {
        if (this.timeout !== undefined) {
            clearTimeout(this.timeout)
            this.timeout = undefined
        }
        if (this.animationFrame !== undefined) {
            cancelAnimationFrame(this.animationFrame)
            this.animationFrame = undefined
        }
        this.pending = false
    }
}

/**
 * @description fit 并保持滚动语义：贴底时 fit 后回贴底，否则恢复 fit 前的 viewportY
 *              （钳制到新的最大滚动位）；fit 后强制立即重绘避免窗口拖拽闪白帧
 * @param xterm 终端实例
 * @param xtermCore xterm 内部核心（viewport/_renderService/_scrollToBottom）
 * @param fitAddon 尺寸适配器
 * @param isPinned 是否贴底
 * @returns void
 *
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function fitPreservingScroll (xterm: Terminal, xtermCore: any, fitAddon: FitAddon, isPinned: () => boolean): void {
    try {
        if (xterm.element && getComputedStyle(xterm.element).getPropertyValue('height') !== 'auto') {
            const savedPinned = isPinned()
            const savedViewportY = xterm.buffer.active.viewportY

            fitAddon.fit()
            xtermCore.viewport._refresh()

            if (savedPinned) {
                xtermCore._scrollToBottom()
            } else {
                const maxScroll = xterm.buffer.active.baseY
                const targetY = Math.min(savedViewportY, maxScroll)
                xterm.scrollToLine(targetY)
            }

            // Force the repaint now to avoid a blank frame during a window drag.
            xtermCore._renderService?._renderRows(0, xterm.rows - 1)
        }
    } catch (e) {
        // tends to throw when element wasn't shown yet
        console.warn('Could not resize xterm', e)
    }
}
