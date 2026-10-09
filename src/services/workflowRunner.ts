/**
 * @description 工作流执行器：渲染步骤（joined 合并 / sequential 逐步）后发送到活动终端
 *              窗格；无活动终端标签时先打开默认终端再发送。
 */
import type { QuickCommand, Workflow } from '@/stores/config'
import { useTabsStore } from '@/stores/tabs'
import { terminalTabApi } from '@/services/terminalTabsApi'
import { buildWorkflowCommand } from '@/lib/workflows'

/**
 * @description 确保有活动终端标签可接收命令：无则打开默认终端并等待注册
 *              （与 QuickCommandPalette.send 的 ensureTerminalTab 同款逻辑）
 * @returns Promise<boolean> 是否就绪
 *
 * @example if (await ensureTerminalTab()) { ... }
 *
 */
async function ensureTerminalTab (): Promise<boolean> {
    const tabs = useTabsStore()
    if (terminalTabApi.current) {
        return true
    }
    tabs.openTerminalTab()
    for (let i = 0; i < 80 && !terminalTabApi.current; i++) {
        await new Promise(resolve => setTimeout(resolve, 25))
    }
    if (!terminalTabApi.current) {
        return false
    }
    await new Promise(resolve => setTimeout(resolve, 400))
    return true
}

/**
 * @description 执行一条工作流：渲染全部步骤后按执行模式发送——joined 合并为单条
 *              ` && ` 命令一次发送；sequential 逐步发送、步间延时 stepIntervalMs；
 *              空步骤/全部悬空引用时 no-op
 * @param workflow 目标工作流
 * @param quickCommands 快捷命令列表（引用解析用）
 * @param paramValues 运行时参数填写值
 * @returns Promise<void>
 *
 * @example void runWorkflow(workflow, quickCommands, { branch: 'main' })
 *
 */
export async function runWorkflow (
    workflow: Workflow,
    quickCommands: QuickCommand[],
    paramValues: Record<string, string>,
): Promise<void> {
    const { text, sequential } = buildWorkflowCommand(workflow, quickCommands, paramValues)
    if (!sequential.length) {
        return
    }
    if (!await ensureTerminalTab()) {
        return
    }
    if (workflow.execution === 'joined') {
        terminalTabApi.current?.sendTextToActivePane(text, true)
        return
    }
    for (const [index, step] of sequential.entries()) {
        terminalTabApi.current?.sendTextToActivePane(step, true)
        if (index < sequential.length - 1 && workflow.stepIntervalMs > 0) {
            await new Promise(resolve => setTimeout(resolve, workflow.stepIntervalMs))
        }
    }
}
