import { ref } from 'vue'

/**
 * @description 标签页切换器的全局开闭状态（App.vue 挂载组件，命令面板与标签栏入口
 *              经此唤起，避免组件间直接引用）。
 */

/** 标签页切换器是否打开 */
export const tabSwitcherOpen = ref(false)

/**
 * @description 打开标签页切换器
 * @returns void
 *
 * @example openTabSwitcher()
 *
 */
export function openTabSwitcher (): void {
    tabSwitcherOpen.value = true
}

/**
 * @description 关闭标签页切换器
 * @returns void
 *
 * @example closeTabSwitcher()
 *
 */
export function closeTabSwitcher (): void {
    tabSwitcherOpen.value = false
}
