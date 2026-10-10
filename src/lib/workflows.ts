/**
 * @description 工作流模板工具：步骤解析/渲染/引用查询（纯函数，无副作用）。
 *              复用快捷命令的 {{参数}} 占位符体系（parseQuickCommandParams/renderQuickCommand）。
 */
import { nanoid } from 'nanoid'
import type { QuickCommand, StepCapture, Workflow, WorkflowStep } from '@/stores/config'
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
        stopOnError: true,
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

/** ANSI 转义序列剥离：CSI（ESC[...终字节）与 OSC（ESC]...BEL/ST）两段式 */
// eslint-disable-next-line no-control-regex -- ESC/BEL 本身即控制字符，匹配转义序列必须使用
const ANSI_PATTERN = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g

/**
 * @description 剥离 PTY 输出中的 ANSI 转义序列（CSI/OSC），得到可匹配的纯文本
 * @param text 原始输出 chunk
 * @returns string 纯文本
 *
 * @example stripAnsi('\x1b[32mok\x1b[0m') // 'ok'
 *
 */
export function stripAnsi (text: string): string {
    return text.replace(ANSI_PATTERN, '')
}

/**
 * @description 解析步骤占位符取值：优先级 运行参数 > 已捕获变量 > 步骤预设
 *              （捕获变量优先于预设，使后续步骤能覆盖同名默认值）
 * @param step 工作流步骤
 * @param captured 运行中已捕获的变量上下文
 * @param runParams 运行时填参值
 * @returns Record<string, string> 该步骤的取值表
 *
 * @example resolveStepValues(step, { v: '1' }, { v: '2' }).v // '2'
 *
 */
export function resolveStepValues (
    step: WorkflowStep,
    captured: Record<string, string>,
    runParams: Record<string, string>,
): Record<string, string> {
    return { ...step.paramValues, ...captured, ...runParams }
}

/**
 * @description expect 等待匹配：pattern 缺省时用学习到的提示符正则；两者皆无返回 false
 *              （由调用方降级为固定超时）
 * @param accumulated 本步发送后累计的纯文本输出
 * @param pattern 用户填写的匹配正则源文本；null = 未填
 * @param promptRegex 学习到的提示符正则源文本；null = 不可用
 * @returns boolean 是否命中
 *
 * @example matchExpect('done\n$ ', null, '^\\$ ') // true
 *
 */
export function matchExpect (accumulated: string, pattern: string | null, promptRegex: string | null): boolean {
    const source = pattern ?? promptRegex
    if (source === null || source === '') {
        return false
    }
    try {
        return new RegExp(source, 'm').test(accumulated)
    } catch {
        // 非法正则按不命中处理（编辑器保存前有 validateWorkflowV2 拦截，此处兜底）
        return false
    }
}

/**
 * @description 从本步输出窗口提取捕获变量：有 pattern 取首个捕获组（无捕获组取整段
 *              匹配），无 pattern 取整段 trim
 * @param accumulated 本步发送后累计的纯文本输出
 * @param capture 捕获定义
 * @returns string 提取值（无匹配返回空串）
 *
 * @example extractCapture('version 1.2.3', { var: 'v', pattern: 'version (\\S+)' }) // '1.2.3'
 *
 */
export function extractCapture (accumulated: string, capture: StepCapture): string {
    if (!capture.pattern) {
        return accumulated.trim()
    }
    try {
        const match = new RegExp(capture.pattern, 'm').exec(accumulated)
        if (!match) {
            return ''
        }
        return match[1] ?? match[0]
    } catch {
        return ''
    }
}

/** 二期校验错误码（编辑器据此翻译展示） */
export type WorkflowValidationError =
    | { code: 'joinedNoWait'; stepIndex: number }
    | { code: 'badExpectPattern'; stepIndex: number }
    | { code: 'badExpectTimeout'; stepIndex: number }
    | { code: 'badFixedDelay'; stepIndex: number }
    | { code: 'badCaptureVar'; stepIndex: number }
    | { code: 'badCapturePattern'; stepIndex: number }

/**
 * @description 校验工作流二期配置（编辑器保存前调用）：expect/capture 正则合法性、
 *              捕获变量名合法性（须匹配 \w-，防注入占位符命名空间）、joined 模式下
 *              不允许 wait/capture（与合并语义冲突）；返回错误码由调用方翻译
 * @param workflow 工作流
 * @returns WorkflowValidationError[] 错误列表（空 = 通过）
 *
 * @example validateWorkflowV2(workflow) // []
 *
 */
export function validateWorkflowV2 (workflow: Workflow): WorkflowValidationError[] {
    const errors: WorkflowValidationError[] = []
    for (const [index, step] of workflow.steps.entries()) {
        if (workflow.execution === 'joined' && (step.wait || step.capture)) {
            errors.push({ code: 'joinedNoWait', stepIndex: index })
        }
        if (step.wait?.kind === 'expect') {
            if (step.wait.pattern) {
                try {
                    new RegExp(step.wait.pattern)
                } catch {
                    errors.push({ code: 'badExpectPattern', stepIndex: index })
                }
            }
            if (step.wait.timeoutMs <= 0) {
                errors.push({ code: 'badExpectTimeout', stepIndex: index })
            }
        }
        if (step.wait?.kind === 'fixed' && step.wait.ms < 0) {
            errors.push({ code: 'badFixedDelay', stepIndex: index })
        }
        if (step.capture) {
            if (!/^[\w-]+$/.test(step.capture.var)) {
                errors.push({ code: 'badCaptureVar', stepIndex: index })
            }
            if (step.capture.pattern) {
                try {
                    new RegExp(step.capture.pattern)
                } catch {
                    errors.push({ code: 'badCapturePattern', stepIndex: index })
                }
            }
        }
    }
    return errors
}
