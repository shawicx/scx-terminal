/**
 * @description 终端搜索框焦点调度工具；延迟两个宏任务以避开
 *              reka-ui 菜单关闭时恢复触发器焦点的 setTimeout。
 */

export interface SearchFocusTarget {
    focus (options?: FocusOptions): void
}

export type ScheduleTimeout = (callback: () => void) => unknown

/**
 * @description 在浮层焦点恢复完成后再聚焦搜索输入框，防止右键菜单
 *              关闭逻辑抢回焦点导致搜索输入落入终端。
 * @param target 搜索输入框或等价 focus 目标
 * @param schedule 宏任务调度函数，默认使用 window.setTimeout
 * @returns void
 *
 * @example scheduleSearchFocus(searchInputEl.value)
 *
 */
export function scheduleSearchFocus (
    target: SearchFocusTarget | null | undefined,
    schedule: ScheduleTimeout = callback => window.setTimeout(callback, 0),
): void {
    schedule(() => {
        schedule(() => {
            target?.focus({ preventScroll: true })
        })
    })
}
