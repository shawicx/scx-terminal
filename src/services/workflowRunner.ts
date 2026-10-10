/**
 * @description 工作流执行入口（薄代理）：转发到二期 workflowRunService 的 runWorkflowV2
 *              （运行注册/窗格绑定/expect 等待/输出捕获均在彼处）；保留原签名与模块
 *              路径避免破坏 WorkflowPalette / commands.ts 既有调用点。
 */
import type { QuickCommand, Workflow } from '@/stores/config'
import { runWorkflowV2 } from './workflowRunService'

/**
 * @description 执行一条工作流（代理 runWorkflowV2）
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
    await runWorkflowV2(workflow, quickCommands, paramValues)
}
