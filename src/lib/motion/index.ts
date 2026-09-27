/**
 * @description GSAP 动效中枢：统一缓动语言与预设时间线工厂（浮层进出场、
 *              列表条目浮现、液态高亮滑块、数值数组插值），供面板/弹窗/
 *              监控图表等场景复用。仅使用 gsap core。
 */
import { gsap } from 'gsap'

export { gsap }

/** 全局统一缓动：入场 power3.out、收尾 power2.in/out */
export const MOTION_EASE = {
    enter: 'power3.out',
    exit: 'power2.in',
    move: 'power2.out',
} as const

/**
 * @description 系统级减弱动效偏好（沿用原 CSS prefers-reduced-motion 语义）：命中时跳过动画
 * @returns boolean 是否减弱动效
 *
 */
export function prefersReducedMotion (): boolean {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * @description 浮层入场编排：遮罩淡入 + 面板 scale/blur 展开，可选列表条目依次浮现
 * @param overlay 遮罩元素（全屏背景）
 * @param panel 面板容器元素
 * @param items 参与浮现的条目元素列表（缺省不编排条目）
 * @returns gsap.core.Timeline 入场时间线（调用方可 kill）
 *
 * @example overlayEnter(backdropEl, panelEl, [...listEl.children])
 *
 */
export function overlayEnter (overlay: HTMLElement, panel: HTMLElement, items?: HTMLElement[]): gsap.core.Timeline {
    if (prefersReducedMotion()) {
        return gsap.timeline()
    }
    gsap.set(overlay, { opacity: 0 })
    gsap.set(panel, { scale: 0.96, filter: 'blur(8px)' })
    const tl = gsap.timeline()
    tl.to(overlay, { opacity: 1, duration: 0.2, ease: 'power1.out' }, 0)
    tl.to(panel, { scale: 1, filter: 'blur(0px)', duration: 0.25, ease: MOTION_EASE.enter, clearProps: 'filter,transform' }, 0)
    if (items?.length) {
        gsap.set(items, { opacity: 0, y: -6 })
        tl.to(items, { opacity: 1, y: 0, duration: 0.18, ease: MOTION_EASE.move, stagger: 0.02 }, 0.05)
    }
    return tl
}

/**
 * @description 浮层退场：反向快收（0.12s），完成后面板交由 v-if 卸载
 * @param overlay 遮罩元素
 * @param panel 面板容器元素
 * @returns gsap.core.Timeline 退场时间线（thenable，onComplete 后再置关闭态）
 *
 * @example overlayExit(backdropEl, panelEl).then(() => { paletteOpen.value = false })
 *
 */
export function overlayExit (overlay: HTMLElement, panel: HTMLElement): gsap.core.Timeline {
    return gsap.timeline()
        .to(overlay, { opacity: 0, duration: 0.12, ease: MOTION_EASE.exit }, 0)
        .to(panel, { scale: 0.97, duration: 0.12, ease: MOTION_EASE.exit }, 0)
}

/**
 * @description 无遮罩浮层入场：从指定方向滑入浮现（建议菜单/转发抽屉/传输浮窗等）
 * @param panel 浮层根元素
 * @param options from 入场方向（缺省 bottom）；overshoot 轻微弹性过冲
 * @returns void
 *
 * @example panelEnter(menuEl, { from: 'right', overshoot: true })
 *
 */
export function panelEnter (
    panel: HTMLElement,
    options: { from?: 'top' | 'bottom' | 'right'; overshoot?: boolean } = {},
): void {
    if (prefersReducedMotion()) {
        return
    }
    const offset = options.from === 'right' ? { x: 16 } : { y: options.from === 'top' ? -8 : 8 }
    gsap.from(panel, {
        ...offset,
        opacity: 0,
        duration: 0.25,
        ease: options.overshoot ? 'back.out(1.4)' : MOTION_EASE.enter,
        clearProps: 'transform,opacity',
    })
}

/**
 * @description 页面级切换进场（Vue Transition JS 钩子）：容器 fade+上浮，可选内部卡片 stagger 浮现
 * @param el 切换容器元素
 * @param done Vue Transition 完成回调
 * @param cards 卡片选择器（容器内参与 stagger 的元素；缺省仅容器过渡）
 * @returns void
 *
 * @example pageEnter(el, done, '.local-card, .host-card')
 *
 */
export function pageEnter (el: Element, done: () => void, cards?: string): void {
    const target = el as HTMLElement
    if (prefersReducedMotion()) {
        done()
        return
    }
    gsap.fromTo(target,
        { opacity: 0, y: 8 },
        { opacity: 1, y: 0, duration: 0.25, ease: MOTION_EASE.enter, clearProps: 'opacity,transform', onComplete: done })
    if (cards) {
        const items = [...target.querySelectorAll(cards)] as HTMLElement[]
        if (items.length) {
            gsap.from(items, { opacity: 0, y: 10, duration: 0.3, stagger: 0.03, ease: MOTION_EASE.move, clearProps: 'all' })
        }
    }
}

/**
 * @description 页面级切换退场（Vue Transition JS 钩子）：fade+轻上移快收
 * @param el 切换容器元素
 * @param done Vue Transition 完成回调
 * @returns void
 *
 */
export function pageLeave (el: Element, done: () => void): void {
    if (prefersReducedMotion()) {
        done()
        return
    }
    gsap.to(el, { opacity: 0, y: -6, duration: 0.15, ease: MOTION_EASE.exit, onComplete: done })
}

/**
 * @description 液态高亮滑块移动：把滑块补间到目标条目的位置与高度（条目间流动滑移）
 * @param pill 高亮滑块元素（absolute 定位于列表容器内）
 * @param target 目标条目元素（offsetParent 必须是列表容器）
 * @param animate false 时瞬时就位（首帧定位/过滤重排用）
 * @returns void
 *
 * @example moveHighlight(pillEl, selectedItemEl)
 *
 */
export function moveHighlight (pill: HTMLElement, target: HTMLElement, animate = true): void {
    const y = target.offsetTop
    const height = target.offsetHeight
    const width = target.offsetWidth
    if (animate) {
        gsap.to(pill, { y, height, width, duration: 0.2, ease: MOTION_EASE.move })
    } else {
        gsap.set(pill, { y, height, width })
    }
}

/**
 * @description 数值数组插值补间：from → to 逐点线性插值，onUpdate 拿中间值重绘
 *              （监控曲线流动用；新补间前由调用方 kill 旧补间，从当前展示值起跳不闪跳）
 * @param from 起始数值数组
 * @param to 目标数值数组（长度不足处按 to 末位/0 兜底）
 * @param onUpdate 每帧回调（values 为插值中的数组，可直接消费）
 * @param duration 补间时长秒（缺省 0.7）
 * @returns gsap.core.Tween 补间实例（调用方可 kill）
 *
 * @example tweenNumericArray(displayValues, props.values, v => { displayValues = v })
 *
 */
export function tweenNumericArray (
    from: number[],
    to: number[],
    onUpdate: (values: number[]) => void,
    duration = 0.7,
): gsap.core.Tween {
    const proxy = { t: 0 }
    const fromPadded = to.map((_, i) => from[i] ?? from[from.length - 1] ?? 0)
    return gsap.to(proxy, {
        t: 1,
        duration,
        ease: 'power1.out',
        onUpdate: () => {
            const values = to.map((v, i) => fromPadded[i] + (v - fromPadded[i]) * proxy.t)
            onUpdate(values)
        },
    })
}
