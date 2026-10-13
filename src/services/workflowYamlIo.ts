/**
 * @description 工作流 YAML 文件 IO 编排：导出（保存对话框 → 序列化 → 写文件）与
 *              导入（打开对话框 → 读文件 → bundle 解析含 scope 元信息）。对话框交互
 *              克隆 BackupPage 先例；内置目录导出附 scope/id/hidden 元数据。
 */
import { invoke } from '@tauri-apps/api/core'
import type { QuickCommand, Workflow } from '@/stores/config'
import {
    parseWorkflowBundle, serializeWorkflowYaml, serializeWorkflowsYaml,
    type WorkflowYamlSerializeOptions, type YamlWorkflow,
} from '@/lib/workflowYaml'

/** 导出结果（droppedSteps = 解引用失败的悬空引用步骤数） */
export interface WorkflowExportResult {
    path: string
    droppedSteps: number
}

/** 解析出的单条文档：工作流形状 + scope/hidden 元信息 */
export interface ImportedWorkflowDoc {
    workflow: YamlWorkflow
    scope: 'user' | 'builtin'
    hidden: boolean
}

/**
 * @description 导入结果：按文档顺序的形状 + 元信息列表（调用方按 scope 分流处理）
 */
export interface WorkflowImportResult {
    path: string
    docs: ImportedWorkflowDoc[]
}

/**
 * @description 导出一条工作流到 YAML 文件（保存对话框选路径；取消返回 null）
 * @param workflow 目标工作流
 * @param quickCommands 快捷命令列表（引用解引用用）
 * @param groups 展示分组合集（groupId 解析分组名用；缺省 = 不写分组）
 * @returns Promise<WorkflowExportResult | null> 导出结果；用户取消返回 null
 *
 * @example const result = await exportWorkflowToFile(workflow, quickCommands, groups)
 *
 */
export async function exportWorkflowToFile (
    workflow: Workflow,
    quickCommands: QuickCommand[],
    groups: Array<{ id: string, name: string }> = [],
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
    const { yaml, droppedSteps } = serializeWorkflowYaml(workflow, quickCommands, {}, groups)
    await invoke('fs_write_text_file', { path, contents: yaml })
    return { path, droppedSteps }
}

/**
 * @description 导出全部工作流到多文档 YAML 文件（保存对话框选路径；取消返回 null）
 * @param workflows 工作流列表
 * @param quickCommands 快捷命令列表（引用解引用用）
 * @param groups 展示分组合集（groupId 解析分组名用；缺省 = 不写分组）
 * @returns Promise<WorkflowExportResult | null> 导出结果；用户取消返回 null
 *
 * @example const result = await exportAllWorkflowsToFile(workflows, quickCommands, groups)
 *
 */
export async function exportAllWorkflowsToFile (
    workflows: Workflow[],
    quickCommands: QuickCommand[],
    groups: Array<{ id: string, name: string }> = [],
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
    const { yaml, droppedSteps } = serializeWorkflowsYaml(workflows, quickCommands, groups)
    await invoke('fs_write_text_file', { path, contents: yaml })
    return { path, droppedSteps }
}

/**
 * @description 导出内置目录到多文档 YAML：每条附 scope=builtin + 稳定 id + 隐藏标记，
 *              可再经导入恢复/同步到其他设备（保存对话框选路径；取消返回 null）
 * @param catalog 内置目录全集（随包 + 扩展包；id 统一 builtin- 前缀）
 * @param removed 用户隐藏的内置 id 集合
 * @param groups 展示分组合集（groupId 解析分组名用；缺省 = 不写分组）
 * @returns Promise<WorkflowExportResult | null> 导出结果；用户取消返回 null
 *
 * @example const result = await exportBuiltinsToFile(catalog, store.workflowCtl.removed, groups)
 *
 */
export async function exportBuiltinsToFile (
    catalog: Workflow[],
    removed: string[],
    groups: Array<{ id: string, name: string }> = [],
): Promise<WorkflowExportResult | null> {
    if (!catalog.length) {
        return null
    }
    const { save } = await import('@tauri-apps/plugin-dialog')
    const path = await save({
        defaultPath: 'builtin-workflows.yml',
        filters: [{ name: 'scx-terminal workflow', extensions: ['yml', 'yaml'] }],
    })
    if (typeof path !== 'string') {
        return null
    }
    const optionsFor = (workflow: Workflow): WorkflowYamlSerializeOptions => ({
        scope: 'builtin',
        id: workflow.id.replace(/^builtin-/, ''),
        hidden: removed.includes(workflow.id),
    })
    const parts = catalog.map(workflow => serializeWorkflowYaml(workflow, [], optionsFor(workflow), groups).yaml.trimEnd())
    await invoke('fs_write_text_file', { path, contents: parts.join('\n---\n') + '\n' })
    return { path, droppedSteps: 0 }
}

/**
 * @description 从 YAML 文件读取并解析工作流 bundle（打开对话框选文件；取消/空文件
 *              返回 null；格式非法向上抛 WorkflowYamlError 由调用方翻译提示）；
 *              文档按 scope 携带元信息，调用方分流（user → 用户列表，builtin → 内置扩展包）
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
    return { path: picked, docs: parseWorkflowBundle(content).docs }
}
