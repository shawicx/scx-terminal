/**
 * @description 工作流 YAML 导入导出工具（纯函数，无副作用）：对齐 Warp Workflow 的
 *              自包含文件语义——导出时把快捷命令引用步骤解引用为内联命令文本
 *              （附 name 注释），导入时步骤一律为内联命令，不携带快捷命令表。
 */
import { nanoid } from 'nanoid'
import { parseAllDocuments, stringify } from 'yaml'
import type { QuickCommand, StepCapture, StepWait, Workflow } from '@/stores/config'

/** 导出文件格式标识 */
export const WORKFLOW_YAML_FORMAT = 'scx-terminal-workflow'
/** 导出文件格式版本（不识别即拒绝导入） */
export const WORKFLOW_YAML_VERSION = 1

/** YAML 中的步骤形状（内联命令 + 可选等待/捕获；name 为注释性标注） */
export interface YamlStep {
    name?: string
    command: string
    paramValues?: Record<string, string>
    wait?: StepWait
    capture?: StepCapture
}

/** YAML 中的工作流形状（不含本机 id） */
export interface YamlWorkflow {
    name: string
    description?: string
    execution: 'joined' | 'sequential'
    stepIntervalMs: number
    stopOnError: boolean
    steps: YamlStep[]
}

/** 解析/校验错误码（UI 层据此翻译） */
export type WorkflowYamlErrorCode = 'badFormat' | 'badVersion' | 'badShape'

/** 带错误码的解析异常 */
export class WorkflowYamlError extends Error {
    constructor (readonly code: WorkflowYamlErrorCode, message: string) {
        super(message)
    }
}

/** 单条导出结果（droppedSteps = 解引用失败的悬空引用步骤数） */
export interface WorkflowYamlExport {
    yaml: string
    droppedSteps: number
}

/**
 * @description 序列化一条工作流为自包含 YAML：quickCommand 步骤解引用为内联命令
 *              文本（保留原快捷命令名为 name 注释），引用悬空的步骤丢弃并计数
 * @param workflow 目标工作流
 * @param quickCommands 快捷命令列表（引用解析用）
 * @returns WorkflowYamlExport YAML 文本与丢弃计数
 *
 * @example serializeWorkflowYaml(workflow, quickCommands).yaml
 *
 */
export function serializeWorkflowYaml (workflow: Workflow, quickCommands: QuickCommand[]): WorkflowYamlExport {
    let droppedSteps = 0
    const steps: YamlStep[] = []
    for (const step of workflow.steps) {
        if (step.kind === 'quickCommand') {
            const referenced = quickCommands.find(command => command.id === step.quickCommandId)
            if (!referenced) {
                droppedSteps++
                continue
            }
            steps.push({
                name: referenced.name || undefined,
                command: referenced.command,
                ...(step.paramValues ? { paramValues: step.paramValues } : {}),
                ...(step.wait ? { wait: step.wait } : {}),
                ...(step.capture ? { capture: step.capture } : {}),
            })
            continue
        }
        steps.push({
            command: step.command ?? '',
            ...(step.paramValues ? { paramValues: step.paramValues } : {}),
            ...(step.wait ? { wait: step.wait } : {}),
            ...(step.capture ? { capture: step.capture } : {}),
        })
    }
    const doc = {
        format: WORKFLOW_YAML_FORMAT,
        version: WORKFLOW_YAML_VERSION,
        workflow: {
            name: workflow.name,
            ...(workflow.description ? { description: workflow.description } : {}),
            execution: workflow.execution,
            stepIntervalMs: workflow.stepIntervalMs,
            stopOnError: workflow.stopOnError,
            steps,
        },
    }
    return { yaml: stringify(doc), droppedSteps }
}

/**
 * @description 序列化全部工作流为多文档 YAML（`---` 分隔；丢弃计数累计）
 * @param workflows 工作流列表
 * @param quickCommands 快捷命令列表（引用解析用）
 * @returns WorkflowYamlExport 多文档 YAML 与累计丢弃计数
 *
 * @example serializeWorkflowsYaml(workflows, quickCommands).yaml
 *
 */
export function serializeWorkflowsYaml (workflows: Workflow[], quickCommands: QuickCommand[]): WorkflowYamlExport {
    const parts: string[] = []
    let droppedSteps = 0
    for (const workflow of workflows) {
        const exported = serializeWorkflowYaml(workflow, quickCommands)
        parts.push(exported.yaml.trimEnd())
        droppedSteps += exported.droppedSteps
    }
    return { yaml: parts.join('\n---\n') + '\n', droppedSteps }
}

/**
 * @description 解析 YAML 文本（支持多文档）为工作流形状列表：校验格式/版本/步骤
 *              结构（command 非空、wait/capture 形状、paramValues 字符串表），
 *              非法抛 WorkflowYamlError
 * @param text YAML 文本
 * @returns YamlWorkflow[] 解析出的工作流形状列表
 *
 * @example parseWorkflowYaml(text)[0].name // '部署'
 *
 */
export function parseWorkflowYaml (text: string): YamlWorkflow[] {
    const trimmed = text.trim()
    if (!trimmed) {
        throw new WorkflowYamlError('badShape', 'empty file')
    }
    let docs: unknown[]
    try {
        docs = parseAllDocuments(trimmed).map(document => document.toJS())
    } catch (error) {
        throw new WorkflowYamlError('badShape', `invalid yaml: ${String(error)}`)
    }
    return docs.map(doc => parseOneDocument(doc))
}

/** 校验并归一化单个文档 */
function parseOneDocument (doc: unknown): YamlWorkflow {
    if (!isPlainObject(doc) || doc.format !== WORKFLOW_YAML_FORMAT) {
        throw new WorkflowYamlError('badFormat', 'missing or unknown format')
    }
    if (doc.version !== WORKFLOW_YAML_VERSION) {
        throw new WorkflowYamlError('badVersion', `unsupported version: ${String(doc.version)}`)
    }
    const workflow = doc.workflow
    if (!isPlainObject(workflow) || typeof workflow.name !== 'string' || !Array.isArray(workflow.steps)) {
        throw new WorkflowYamlError('badShape', 'workflow.name/steps missing')
    }
    const execution = workflow.execution === 'sequential' ? 'sequential' : 'joined'
    const stepIntervalMs = typeof workflow.stepIntervalMs === 'number' && workflow.stepIntervalMs >= 0
        ? workflow.stepIntervalMs
        : 500
    const stopOnError = typeof workflow.stopOnError === 'boolean' ? workflow.stopOnError : true
    const steps: YamlStep[] = workflow.steps.map((step: unknown, index: number) => parseStep(step, index))
    if (workflow.description !== undefined && typeof workflow.description !== 'string') {
        throw new WorkflowYamlError('badShape', 'workflow.description must be a string')
    }
    return {
        name: workflow.name,
        ...(typeof workflow.description === 'string' && workflow.description ? { description: workflow.description } : {}),
        execution,
        stepIntervalMs,
        stopOnError,
        steps,
    }
}

/** 校验并归一化单个步骤 */
function parseStep (step: unknown, index: number): YamlStep {
    if (!isPlainObject(step) || typeof step.command !== 'string' || step.command.trim() === '') {
        throw new WorkflowYamlError('badShape', `step ${index + 1}: command missing`)
    }
    const result: YamlStep = { command: step.command }
    if (step.name !== undefined) {
        if (typeof step.name !== 'string') {
            throw new WorkflowYamlError('badShape', `step ${index + 1}: name must be a string`)
        }
        if (step.name) {
            result.name = step.name
        }
    }
    if (step.paramValues !== undefined) {
        if (!isPlainObject(step.paramValues) || !Object.values(step.paramValues).every(value => typeof value === 'string')) {
            throw new WorkflowYamlError('badShape', `step ${index + 1}: paramValues must be a string map`)
        }
        result.paramValues = step.paramValues as Record<string, string>
    }
    if (step.wait !== undefined) {
        result.wait = parseWait(step.wait, index)
    }
    if (step.capture !== undefined) {
        result.capture = parseCapture(step.capture, index)
    }
    return result
}

/** 校验等待策略 */
function parseWait (wait: unknown, index: number): StepWait {
    if (!isPlainObject(wait)) {
        throw new WorkflowYamlError('badShape', `step ${index + 1}: wait must be an object`)
    }
    if (wait.kind === 'fixed') {
        if (typeof wait.ms !== 'number' || wait.ms < 0) {
            throw new WorkflowYamlError('badShape', `step ${index + 1}: wait.ms must be a non-negative number`)
        }
        return { kind: 'fixed', ms: wait.ms }
    }
    if (wait.kind === 'expect') {
        if (wait.pattern !== undefined && typeof wait.pattern !== 'string') {
            throw new WorkflowYamlError('badShape', `step ${index + 1}: wait.pattern must be a string`)
        }
        if (typeof wait.timeoutMs !== 'number' || wait.timeoutMs <= 0) {
            throw new WorkflowYamlError('badShape', `step ${index + 1}: wait.timeoutMs must be positive`)
        }
        if (wait.onTimeout !== 'abort' && wait.onTimeout !== 'continue') {
            throw new WorkflowYamlError('badShape', `step ${index + 1}: wait.onTimeout must be abort|continue`)
        }
        return {
            kind: 'expect',
            ...(typeof wait.pattern === 'string' && wait.pattern ? { pattern: wait.pattern } : {}),
            timeoutMs: wait.timeoutMs,
            onTimeout: wait.onTimeout,
        }
    }
    throw new WorkflowYamlError('badShape', `step ${index + 1}: wait.kind must be fixed|expect`)
}

/** 校验捕获定义 */
function parseCapture (capture: unknown, index: number): StepCapture {
    if (!isPlainObject(capture) || typeof capture.var !== 'string' || !/^[\w-]+$/.test(capture.var)) {
        throw new WorkflowYamlError('badShape', `step ${index + 1}: capture.var is invalid`)
    }
    if (capture.pattern !== undefined && typeof capture.pattern !== 'string') {
        throw new WorkflowYamlError('badShape', `step ${index + 1}: capture.pattern must be a string`)
    }
    return {
        var: capture.var,
        ...(typeof capture.pattern === 'string' && capture.pattern ? { pattern: capture.pattern } : {}),
    }
}

/**
 * @description 把解析出的工作流形状构建为本机 Workflow：新 id、步骤全部内联
 *              （kind=raw、新 step id），绝不与现有工作流冲突
 * @param parsed YAML 解析出的工作流形状
 * @returns Workflow 可直接入 store 的新工作流
 *
 * @example buildImportedWorkflow(parsed).steps[0].kind // 'raw'
 *
 */
export function buildImportedWorkflow (parsed: YamlWorkflow): Workflow {
    return {
        id: `wf-${nanoid(8)}`,
        name: parsed.name,
        ...(parsed.description ? { description: parsed.description } : {}),
        execution: parsed.execution,
        stepIntervalMs: parsed.stepIntervalMs,
        stopOnError: parsed.stopOnError,
        steps: parsed.steps.map(step => ({
            id: `step-${nanoid(6)}`,
            kind: 'raw' as const,
            command: step.command,
            ...(step.paramValues ? { paramValues: step.paramValues } : {}),
            ...(step.wait ? { wait: step.wait } : {}),
            ...(step.capture ? { capture: step.capture } : {}),
        })),
    }
}

/** 纯对象判定（数组/null 排除） */
function isPlainObject (value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
