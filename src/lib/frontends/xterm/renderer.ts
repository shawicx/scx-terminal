/**
 * @description xterm 渲染器管理：WebGL（上下文丢失恢复上限）/Canvas 附加器挂载与重建、
 *              字体指纹比对（字号/行距/字体族变更触发图集全量重算）与强制重绘。
 *              原 XTermFrontend 的渲染器相关字段与方法原样迁移。
 */
import type { Terminal } from '@xterm/xterm'
import { WebglAddon } from '@xterm/addon-webgl'
import { CanvasAddon } from '@xterm/addon-canvas'
import { MAX_WEBGL_RECOVERY_ATTEMPTS } from './support'

export interface RendererDeps {
    readonly xterm: Terminal
    // xterm 内部核心（private API，同 Tabby；viewport/_renderService/_charSizeService）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly xtermCore: any
    /** 宿主元素（可见性/焦点判定用）；未挂载为 undefined */
    getElement (): HTMLElement | undefined
    /** 前端是否处于已挂载存活态 */
    isAttached (): boolean
    /** 影响字形渲染的设置指纹（字号/行距/字体族） */
    fontKey (): string
    /** 触发重排（前端 resizeHandler） */
    requestResize (): void
}

export class XtermRendererManager {
    webGLAddon?: WebglAddon
    canvasAddon?: CanvasAddon
    private pendingRecovery = false
    private attempts = 0
    /** 渲染器最近一次构建时的字体指纹；不一致 = 图集与当前设置脱节 */
    private renderedFontKey = ''

    constructor (private readonly deps: RendererDeps) { }

    /** 按前端配置挂载初始渲染器（WebGL 优先，Canvas 兜底）并记录字体指纹 */
    attach (enableWebGL: boolean): void {
        if (enableWebGL) {
            this.attachWebGL()
        } else {
            this.canvasAddon = new CanvasAddon()
            this.deps.xterm.loadAddon(this.canvasAddon)
        }
        this.renderedFontKey = this.deps.fontKey()
    }

    /** 影响字形渲染的设置指纹比较 */
    private outOfDate (): boolean {
        return this.renderedFontKey !== this.deps.fontKey()
    }

    /**
     * @description 强制重测字符尺寸；窗格变为可见且字体设置与渲染器构建时不一致时整体
     *              重建渲染器——WKWebView 下字号在窗格隐藏期间变更时，单元格尺寸会更新
     *              （列数/布局随之变化）但 WebGL 渲染器不按新尺寸重建字形图集（字形停留
     *              旧尺寸），复用上下文丢失恢复的重建路径全量重算
     * @returns void
     *
     * @example renderer.remeasure()
     *
     */
    remeasure (): void {
        this.deps.xtermCore?._charSizeService?.measure()
        const element = this.deps.getElement()
        const visible = !!element && element.getBoundingClientRect().height > 0
        if (this.deps.isAttached() && visible && this.outOfDate()) {
            this.renderedFontKey = this.deps.fontKey()
            this.rebuild()
        }
        this.deps.requestResize()
    }

    /** 重建渲染器（WebGL/Canvas 附加器 dispose 后重挂，图集与尺寸全量重算）并重绘 */
    rebuild (): void {
        // 清除挂起的上下文丢失恢复标记，防止后续 reactivate 再叠加挂载一个渲染器
        this.pendingRecovery = false
        if (this.webGLAddon) {
            this.webGLAddon.dispose()
            this.webGLAddon = undefined
            this.attachWebGL()
        } else if (this.canvasAddon) {
            this.canvasAddon.dispose()
            this.canvasAddon = undefined
            this.canvasAddon = new CanvasAddon()
            this.deps.xterm.loadAddon(this.canvasAddon)
        }
        this.redraw()
    }

    /**
     * Redraw the terminal and recover the renderer when its tab is shown again.
     */
    reactivate (enableWebGL: boolean): void {
        if (this.pendingRecovery || enableWebGL && !this.webGLAddon) {
            this.pendingRecovery = true
            this.recover()
        } else {
            this.attempts = 0
            this.redraw()
        }
    }

    /** 尝试恢复（上下文丢失后窗口重新聚焦时；受挂载可见与重试上限约束） */
    recover (): void {
        if (!this.pendingRecovery || !this.canRecover()) {
            return
        }
        this.pendingRecovery = false
        if (this.attempts < MAX_WEBGL_RECOVERY_ATTEMPTS) {
            this.attempts++
            this.attachWebGL()
        }
        this.redraw()
    }

    private attachWebGL (): void {
        const addon = new WebglAddon()
        addon.onContextLoss(() => {
            this.webGLAddon?.dispose()
            this.webGLAddon = undefined
            this.pendingRecovery = true
            this.recover()
        })
        this.deps.xterm.loadAddon(addon)
        this.webGLAddon = addon
    }

    private canRecover (): boolean {
        const element = this.deps.getElement()
        return !!element && element.offsetParent !== null && document.hasFocus()
    }

    private redraw (): void {
        const renderService = this.deps.xtermCore._renderService
        renderService?.clear()
        this.deps.requestResize()
        renderService?.handleResize(this.deps.xterm.cols, this.deps.xterm.rows)
    }

    dispose (): void {
        this.webGLAddon?.dispose()
        this.canvasAddon?.dispose()
    }
}
