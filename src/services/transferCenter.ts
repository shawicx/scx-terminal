/**
 * @description 传输中心面板开关状态（TitleBar 指示器与 App 挂载的 TransferPopover 共享；
 *              同 quickCommandPalette 的模块级 ref 模式）。
 */
import { ref } from 'vue'

export const transferCenterOpen = ref(false)

/**
 * @description 打开传输中心面板
 * @returns void
 *
 * @example openTransferCenter()
 *
 */
export function openTransferCenter (): void {
    transferCenterOpen.value = true
}

/**
 * @description 切换传输中心面板开合
 * @returns void
 *
 * @example toggleTransferCenter()
 *
 */
export function toggleTransferCenter (): void {
    transferCenterOpen.value = !transferCenterOpen.value
}
