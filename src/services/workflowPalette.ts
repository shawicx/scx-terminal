import { ref } from 'vue'

/**
 * @description 工作流选择器的全局开闭状态与预选请求（模块级单例，照 quickCommandPalette.ts 的模式；
 *              App.vue 挂载 WorkflowPalette 组件，命令面板经此唤起）
 */

/** 选择器是否打开 */
export const workflowPaletteOpen = ref(false)

/** 打开后直接进入填参态的工作流 id（命令面板里有参数的工作流跳转用）；null = 普通打开 */
export const pendingWorkflowId = ref<string | null>(null)

/**
 * @description 打开工作流选择器
 * @param workflowId 可选：预选中的工作流 id（有参数时直接进入填参态）
 * @returns void
 *
 * @example openWorkflowPalette('wf-abc123')
 *
 */
export function openWorkflowPalette (workflowId?: string): void {
    pendingWorkflowId.value = workflowId ?? null
    workflowPaletteOpen.value = true
}

/**
 * @description 关闭工作流选择器并清理预选请求
 * @returns void
 *
 * @example closeWorkflowPalette()
 *
 */
export function closeWorkflowPalette (): void {
    workflowPaletteOpen.value = false
    pendingWorkflowId.value = null
}
