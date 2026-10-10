/**
 * @description 工作流 YAML 文件 IO 编排：导出（保存对话框 → 序列化 → 写文件）与
 *              导入（打开对话框 → 读文件 → 解析）。对话框交互克隆 BackupPage 先例。
 */
import { invoke } from '@tauri-apps/api/core'
import type { QuickCommand, Workflow } from '@/stores/config'
import {
    parseWorkflowYaml, serializeWorkflowYaml, serializeWorkflowsYaml,
    type YamlWorkflow,
} from '@/lib/workflowYaml'

/** 导出结果（droppedSteps = 解引用失败的悬空引用步骤数） */
export interface WorkflowExportResult {
    path: string
    droppedSteps: number
}

/**
 * @description 导入结果：解析出的工作流形状列表（待确认后经 buildImportedWorkflow 构建）
 */
export interface WorkflowImportResult {
    path: string
    workflows: YamlWorkflow[]
}

/**
 * @description 导出一条工作流到 YAML 文件（保存对话框选路径；取消返回 null）
 * @param workflow 目标工作流
 * @param quickCommands 快捷命令列表（引用解引用用）
 * @returns Promise<WorkflowExportResult | null> 导出结果；用户取消返回 null
 *
 * @example const result = await exportWorkflowToFile(workflow, quickCommands)
 *
 */
export async function exportWorkflowToFile (
    workflow: Workflow,
    quickCommands: QuickCommand[],
): Promise<WorkflowExportResult | null> {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const defaultName = `${(workflow.name || 'workflow').replace(/[/:*?"<>|\\]/g, '_').trim() || 'workflow'}.yml`
    const path = await save({
        defaultPath: defaultName,
        filters: [{ name: 'scx-terminal workflow', extensions: ['yml', 'yaml'] }],
    })
    if (typeof path !== 'string') {
        return null
    }
    const { yaml, droppedSteps } = serializeWorkflowYaml(workflow, quickCommands)
    await invoke('fs_write_text_file', { path, contents: yaml })
    return { path, droppedSteps }
}

/**
 * @description 导出全部工作流到多文档 YAML 文件（保存对话框选路径；取消返回 null）
 * @param workflows 工作流列表
 * @param quickCommands 快捷命令列表（引用解引用用）
 * @returns Promise<WorkflowExportResult | null> 导出结果；用户取消返回 null
 *
 * @example const result = await exportAllWorkflowsToFile(workflows, quickCommands)
 *
 */
export async function exportAllWorkflowsToFile (
    workflows: Workflow[],
    quickCommands: QuickCommand[],
): Promise<WorkflowExportResult | null> {
    if (!workflows.length) {
        return null
    }
    const { save } = await import('@tauri-apps/plugin-dialog')
    const path = await save({
        defaultPath: 'workflows.yml',
        filters: [{ name: 'scx-terminal workflow', extensions: ['yml', 'yaml'] }],
    })
    if (typeof path !== 'string') {
        return null
    }
    const { yaml, droppedSteps } = serializeWorkflowsYaml(workflows, quickCommands)
    await invoke('fs_write_text_file', { path, contents: yaml })
    return { path, droppedSteps }
}

/**
 * @description 从 YAML 文件读取并解析工作流（打开对话框选文件；取消/空文件返回 null；
 *              格式非法向上抛 WorkflowYamlError 由调用方翻译提示）
 * @returns Promise<WorkflowImportResult | null> 解析结果
 *
 * @example const result = await importWorkflowsFromFile()
 *
 */
export async function importWorkflowsFromFile (): Promise<WorkflowImportResult | null> {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const picked = await open({
        multiple: false,
        filters: [{ name: 'scx-terminal workflow', extensions: ['yml', 'yaml'] }],
    })
    if (typeof picked !== 'string') {
        return null
    }
    const content = await invoke<string | null>('fs_read_text_file', { path: picked })
    if (content === null || !content.trim()) {
        return null
    }
    return { path: picked, workflows: parseWorkflowYaml(content) }
}
