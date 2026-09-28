/**
 * @description 标签栏溢出布局的纯计算工具：把滚轮输入转换成横向滚动量，
 *              并计算能让活动标签完整可见的最小滚动位置。
 */

export interface TabWheelDeltaInput {
    deltaX: number
    deltaY: number
    deltaMode: number
    viewportWidth: number
}

export interface TabOverflowStateInput {
    scrollLeft: number
    viewportWidth: number
    scrollWidth: number
}

export interface ArrowScrollInput {
    /** 滚动方向：1 = 向右（看后续标签），-1 = 向左（看之前的标签） */
    direction: 1 | -1
    scrollLeft: number
    /** 单次箭头点击的滚动步长（像素） */
    step: number
    /** 最大可滚动位置（scrollWidth - viewportWidth） */
    maxScrollLeft: number
}

/**
 * @description 判定标签栏溢出方向（左/右箭头与边缘渐隐的显隐依据）；亚像素误差容差 1px
 * @param input 滚动位置、视口宽度与内容总宽
 * @returns { canScrollLeft, canScrollRight } 两个方向是否还可滚动
 *
 * @example resolveTabOverflowState({ scrollLeft: 0, viewportWidth: 800, scrollWidth: 1200 }) // => { canScrollLeft: false, canScrollRight: true }
 *
 */
export function resolveTabOverflowState (input: TabOverflowStateInput): { canScrollLeft: boolean, canScrollRight: boolean } {
    const overflowed = input.scrollWidth > input.viewportWidth + 1
    return {
        canScrollLeft: overflowed && input.scrollLeft > 1,
        canScrollRight: overflowed && input.scrollLeft < input.scrollWidth - input.viewportWidth - 1,
    }
}

/**
 * @description 计算箭头按钮点击后的目标滚动位置（按步长推进并钳制到 [0, max]）
 * @param input 方向、当前滚动位置、步长与最大可滚动位置
 * @returns number 应滚动到的 scrollLeft
 *
 * @example resolveArrowScrollTarget({ direction: 1, scrollLeft: 0, step: 600, maxScrollLeft: 400 }) // => 400
 *
 */
export function resolveArrowScrollTarget (input: ArrowScrollInput): number {
    const raw = input.scrollLeft + input.direction * input.step
    return Math.min(Math.max(raw, 0), Math.max(input.maxScrollLeft, 0))
}

export interface ActiveTabScrollInput {
    scrollLeft: number
    viewportWidth: number
    tabStart: number
    tabEnd: number
    padding?: number
    /** 视口右缘额外预留宽度（标签溢出时被 sticky「+」按钮遮挡的区域） */
    rightReserve?: number
}

/**
 * @description 计算标签栏横向滚轮增量；优先使用占主导的滚轮轴，
 *              并按浏览器 deltaMode 归一化行/页单位。
 * @param input 滚轮事件数据与视口宽度
 * @returns number 横向滚动像素增量
 *
 * @example getTabStripWheelDelta({ deltaX: 0, deltaY: 120, deltaMode: 0, viewportWidth: 800 }) // => 120
 *
 */
export function getTabStripWheelDelta (input: TabWheelDeltaInput): number {
    const dominantDelta = Math.abs(input.deltaX) >= Math.abs(input.deltaY)
        ? input.deltaX
        : input.deltaY
    const multiplier = input.deltaMode === 1
        ? 32
        : input.deltaMode === 2
            ? Math.max(input.viewportWidth, 1)
            : 1
    return dominantDelta * multiplier
}

/**
 * @description 计算让活动标签完整进入视口的最小 scrollLeft 调整；
 *              标签已可见时保持原位置，避免切换标签时多余滚动。
 * @param input 当前滚动状态、视口宽度、活动标签边界与右缘预留宽度
 * @returns number 应写入滚动容器的 scrollLeft
 *
 * @example resolveActiveTabScrollLeft({ scrollLeft: 300, viewportWidth: 800, tabStart: 1000, tabEnd: 1140, padding: 8 }) // => 348
 *
 */
export function resolveActiveTabScrollLeft (input: ActiveTabScrollInput): number {
    const padding = input.padding ?? 0
    const rightReserve = input.rightReserve ?? 0
    const leftEdge = input.tabStart - padding
    const rightEdge = input.tabEnd + padding + rightReserve

    if (leftEdge < input.scrollLeft) {
        return Math.max(0, leftEdge)
    }
    if (rightEdge > input.scrollLeft + input.viewportWidth) {
        return Math.max(0, rightEdge - input.viewportWidth)
    }
    return input.scrollLeft
}
