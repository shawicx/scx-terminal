/**
 * @description 设置域共享的删除确认弹窗状态（模块级单例）：各设置页调用
 *              confirmAction()，SettingsView 外壳统一渲染 Dialog，跨页共用一份。
 */
import { ref } from 'vue'

interface ConfirmState { message: string, action: () => void }

const confirmState = ref<ConfirmState | null>(null)

/**
 * @description 打开删除确认弹窗：记录提示文案与确认后执行的动作
 * @param message 确认提示文案（含目标名称）
 * @param action 确认后执行的动作
 * @returns void
 *
 * @example confirmAction(t('settings.deleteConfirmBody', { name }), () => remove())
 *
 */
export function confirmAction (message: string, action: () => void): void {
    confirmState.value = { message, action }
}

/**
 * @description 关闭确认弹窗（取消路径；供外壳 Dialog @cancel 直接绑定）
 * @returns void
 *
 */
export function dismissConfirm (): void {
    confirmState.value = null
}

/**
 * @description 执行已确认的动作并关闭弹窗
 * @returns void
 *
 */
export function runConfirmed (): void {
    const current = confirmState.value
    confirmState.value = null
    current?.action()
}

/** 弹窗状态（外壳渲染与取消按钮绑定用） */
export function useConfirmState () {
    return confirmState
}
