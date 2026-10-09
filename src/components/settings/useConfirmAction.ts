/**
 * @description 设置域共享的确认弹窗状态（模块级单例）：各设置页调用
 *              confirmAction()，SettingsView 外壳统一渲染 Dialog，跨页共用一份。
 *              默认承接删除确认场景；title/confirmLabel 可选参数允许复用到
 *              「放弃未保存修改」等非删除场景。
 */
import { ref } from 'vue'

interface ConfirmState { message: string, action: () => void, title?: string, confirmLabel?: string }

const confirmState = ref<ConfirmState | null>(null)

/**
 * @description 打开确认弹窗：记录提示文案与确认后执行的动作（可选标题与确认按钮文案）
 * @param message 确认提示文案（含目标名称）
 * @param action 确认后执行的动作
 * @param confirmLabel 确认按钮文案（缺省为外壳的删除确认文案）
 * @param title 弹窗标题（缺省为外壳的删除确认标题）
 * @returns void
 *
 * @example confirmAction(t('settings.deleteConfirmBody', { name }), () => remove())
 *
 */
export function confirmAction (message: string, action: () => void, confirmLabel?: string, title?: string): void {
    confirmState.value = { message, action, ...(confirmLabel ? { confirmLabel } : {}), ...(title ? { title } : {}) }
}

/**
 * @description 关闭确认弹窗（取消路径；供外壳 Dialog @cancel 直接绑定）
 * @returns void
 */
export function dismissConfirm (): void {
    confirmState.value = null
}

/**
 * @description 执行已确认的动作并关闭弹窗
 * @returns void
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
