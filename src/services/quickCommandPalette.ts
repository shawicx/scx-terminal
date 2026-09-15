import { ref } from 'vue'

/**
 * @description 快捷命令选择器的全局开闭状态与预选请求（模块级单例，照 commands.ts 的 paletteOpen 模式；
 *              App.vue 挂载 QuickCommandPalette 组件，命令面板/热键经此唤起）
 */

/** 选择器是否打开 */
export const quickCommandPaletteOpen = ref(false)

/** 打开后直接进入填参态的命令 id（命令面板里有参数的快捷命令跳转用）；null = 普通打开 */
export const pendingQuickCommandId = ref<string | null>(null)

/**
 * @description 打开快捷命令选择器
 * @param quickCommandId 可选：预选中的命令 id（有参数时直接进入填参态）
 * @returns void
 *
 * @example openQuickCommandPalette('qc-abc123')
 *
 */
export function openQuickCommandPalette (quickCommandId?: string): void {
    pendingQuickCommandId.value = quickCommandId ?? null
    quickCommandPaletteOpen.value = true
}

/**
 * @description 关闭快捷命令选择器并清理预选请求
 * @returns void
 *
 * @example closeQuickCommandPalette()
 *
 */
export function closeQuickCommandPalette (): void {
    quickCommandPaletteOpen.value = false
    pendingQuickCommandId.value = null
}
