/**
 * @description 工作流模板工具：步骤解析/渲染/引用查询（纯函数，无副作用）。
 *              复用快捷命令的 {{参数}} 占位符体系（parseQuickCommandParams/renderQuickCommand）。
 */
import { nanoid } from 'nanoid'
import type { QuickCommand, Workflow, WorkflowStep } from '@/stores/config'
import { parseQuickCommandParams, previewQuickCommand, renderQuickCommand } from '@/lib/quickCommands'

/**
 * @description 构造一条空工作流草稿（新建设置页编辑器用）
 * @returns Workflow 未保存的新工作流对象
 *
 * @example buildWorkflow().steps // []
 *
 */
export function buildWorkflow (): Workflow {
    return {
        id: `wf-${nanoid(8)}`,
        name: '',
        execution: 'joined',
        stepIntervalMs: 500,
        steps: [],
    }
}

/**
 * @description 构造一个工作流步骤（kind=quickCommand 引用快捷命令；kind=raw 内联命令）
 * @param kind 步骤类型
 * @param payload quickCommandId（quickCommand 步）或 command 文本（raw 步）
 * @returns WorkflowStep 新步骤对象
 *
 * @example buildWorkflowStep('raw', 'ls -la').command // 'ls -la'
 *
 */
export function buildWorkflowStep (kind: WorkflowStep['kind'], payload: string): WorkflowStep {
    return kind === 'quickCommand'
        ? { id: `step-${nanoid(6)}`, kind, quickCommandId: payload }
        : { id: `step-${nanoid(6)}`, kind, command: payload }
}

/**
 * @description 取步骤渲染前的命令模板文本：quickCommand 步取被引用快捷命令的 command
 *              （引用悬空返回 null）；raw 步取内联 command（缺失返回 null）
 * @param step 工作流步骤
 * @param quickCommands 快捷命令列表（引用解析用）
 * @returns string | null 命令模板；无法解析时 null
 *
 * @example stepCommandTemplate({ kind: 'raw', command: 'ls' }, []) // 'ls'
 *
 */
export function stepCommandTemplate (step: WorkflowStep, quickCommands: QuickCommand[]): string | null {
    if (step.kind === 'quickCommand') {
        return quickCommands.find(command => command.id === step.quickCommandId)?.command ?? null
    }
    return step.command ?? null
}

/**
 * @description 收集工作流全部步骤的 {{参数}} 占位符并集（按出现顺序去重）；
 *              引用悬空的步骤跳过
 * @param steps 工作流步骤列表
 * @param quickCommands 快捷命令列表（引用解析用）
 * @returns string[] 参数名列表（去重、保序）
 *
 * @example collectWorkflowParams([{ kind: 'raw', command: 'git checkout {{b}}' }], []) // ['b']
 *
 */
export function collectWorkflowParams (steps: WorkflowStep[], quickCommands: QuickCommand[]): string[] {
    const names: string[] = []
    for (const step of steps) {
        const template = stepCommandTemplate(step, quickCommands)
        if (template === null) {
            continue
        }
        for (const name of parseQuickCommandParams(template)) {
            if (!names.includes(name)) {
                names.push(name)
            }
        }
    }
    return names
}

/**
 * @description 渲染工作流全部步骤为命令文本列表：每步按模板替换 {{参数}}（步骤级
 *              paramValues 预设先套用，再被运行时 values 覆盖）；引用悬空的步骤跳过
 * @param workflow 工作流
 * @param quickCommands 快捷命令列表（引用解析用）
 * @param values 运行时参数填写值
 * @returns string[] 渲染后的命令文本列表（与步骤顺序一致，悬空步骤被剔除）
 *
 * @example renderWorkflowSteps(workflow, quickCommands, { b: 'main' }) // ['git checkout main']
 *
 */
export function renderWorkflowSteps (
    workflow: Workflow,
    quickCommands: QuickCommand[],
    values: Record<string, string>,
): string[] {
    const rendered: string[] = []
    for (const step of workflow.steps) {
        const template = stepCommandTemplate(step, quickCommands)
        if (template === null) {
            continue
        }
        rendered.push(renderQuickCommand(template, { ...step.paramValues, ...values }))
    }
    return rendered
}

/**
 * @description 构建工作流的发送载荷：joined 模式各步 trim 尾换行后以 ` && ` 合并为
 *              单条；sequential 模式返回逐步数组（由执行器按 stepIntervalMs 间隔发送）
 * @param workflow 工作流
 * @param quickCommands 快捷命令列表（引用解析用）
 * @param values 运行时参数填写值
 * @returns { text: string, sequential: string[] } joined 文本与 sequential 步骤数组
 *
 * @example buildWorkflowCommand(workflow, quickCommands, {})[0].text // 'a && b'
 *
 */
export function buildWorkflowCommand (
    workflow: Workflow,
    quickCommands: QuickCommand[],
    values: Record<string, string>,
): { text: string, sequential: string[] } {
    const steps = renderWorkflowSteps(workflow, quickCommands, values)
        .map(step => step.replace(/\n+$/, ''))
        .filter(step => step.trim() !== '')
    return { text: steps.join(' && '), sequential: steps }
}

/**
 * @description 查询引用某条快捷命令的工作流列表（删除快捷命令前的引用保护）
 * @param workflows 工作流列表
 * @param quickCommandId 快捷命令 id
 * @returns Workflow[] 引用该快捷命令的工作流列表
 *
 * @example findQuickCommandRefs(workflows, 'qc-1').length // 1
 *
 */
export function findQuickCommandRefs (workflows: Workflow[], quickCommandId: string): Workflow[] {
    return workflows.filter(workflow =>
        workflow.steps.some(step => step.kind === 'quickCommand' && step.quickCommandId === quickCommandId))
}

/**
 * @description 工作流步骤预览（列表/选择器展示用）：各步单行预览以 ` && ` 连接后截断
 * @param workflow 工作流
 * @param quickCommands 快捷命令列表（引用解析用）
 * @param maxLength 最大长度（默认 80）
 * @returns string 单行截断文本
 *
 * @example previewWorkflow(workflow, [], 10) // 'git add -…'
 *
 */
export function previewWorkflow (workflow: Workflow, quickCommands: QuickCommand[], maxLength = 80): string {
    const parts: string[] = []
    for (const step of workflow.steps) {
        const template = stepCommandTemplate(step, quickCommands)
        parts.push(previewQuickCommand(template ?? '', 40))
    }
    const flat = parts.filter(part => part !== '').join(' && ')
    return flat.length > maxLength ? flat.slice(0, maxLength - 1) + '…' : flat
}
