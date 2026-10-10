/**
 * @description 工作流执行服务（二期）：运行态注册表 + 窗格绑定 + expect 等待 + 输出捕获。
 *              运行绑定捕获时刻的活动窗格（切 pane/切 tab 不影响后续步骤发送）；
 *              同一窗格同时只允许一个运行中的工作流，避免输出流交叉污染 expect。
 *              提示符等待的缺省语义 = 输出静默判定（PromptTracker 为长度学习模型，
 *              无正则可取；输出停止 PROMPT_SILENCE_MS 即视为提示符就绪）。
 */
import { ref } from 'vue'
import { nanoid } from 'nanoid'
import type { QuickCommand, StepCapture, StepWait, Workflow, WorkflowStep } from '@/stores/config'
import { useTabsStore } from '@/stores/tabs'
import { terminalTabApi, type PaneCapture } from '@/services/terminalTabsApi'
import { sendAppNotification } from '@/services/notifications'
import i18n from '@/i18n'
import {
    buildWorkflowCommand, extractCapture, matchExpect,
    resolveStepValues, stepCommandTemplate, stripAnsi,
} from '@/lib/workflows'
import { renderQuickCommand } from '@/lib/quickCommands'

/** 无 pattern 的 expect 等待：输出静默多少毫秒视为提示符就绪 */
const PROMPT_SILENCE_MS = 400

/** 运行终态 */
export type RunStatus = 'running' | 'completed' | 'aborted' | 'failed' | 'cancelled'

/** 一次工作流运行的状态（UI 进度展示用） */
export interface WorkflowRun {
    id: string
    workflowId: string
    workflowName: string
    paneKey: string
    currentStepIndex: number
    totalSteps: number
    startedAt: number
    endedAt: number | null
    status: RunStatus
    /** 终态附言（中止原因等；aborted=pane-lost、failed=expect-timeout:步骤号） */
    note: string
}

/** 运行内部控制块（cancelled 标志由 cancelWorkflowRun 置位） */
interface RunControl {
    cancelled: boolean
}

const activeControls = new Map<string, RunControl>()

/** 活动运行注册表（响应式；WorkflowPalette 进度态消费） */
export const workflowRuns = ref<WorkflowRun[]>([])

/**
 * @description 取指定窗格上运行中的工作流（并发限制查询用）
 * @param paneKey 窗格稳定标识
 * @returns WorkflowRun | undefined 该窗格的运行中运行
 *
 * @example runOnPane(pane.key)?.status // 'running'
 *
 */
export function runOnPane (paneKey: string): WorkflowRun | undefined {
    return workflowRuns.value.find(run => run.paneKey === paneKey && run.status === 'running')
}

/**
 * @description 取指定工作流运行中的运行（选择器列表「运行中」标记用）
 * @param workflowId 工作流 id
 * @returns WorkflowRun | undefined
 *
 * @example isWorkflowRunning('wf-1')?.status // 'running'
 *
 */
export function isWorkflowRunning (workflowId: string): WorkflowRun | undefined {
    return workflowRuns.value.find(run => run.workflowId === workflowId && run.status === 'running')
}

/**
 * @description 取消一次运行：置取消标志，主循环在下一个 await 点退出，剩余步骤不再发送
 * @param id 运行 id
 * @returns void
 *
 * @example cancelWorkflowRun(run.id)
 *
 */
export function cancelWorkflowRun (id: string): void {
    const control = activeControls.get(id)
    if (control) {
        control.cancelled = true
    }
}

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
 * @description 渲染单步命令文本（占位符取值 = 运行参数 > 捕获变量 > 步骤预设）；
 *              悬空引用/空渲染返回 null（跳过）
 * @param step 步骤
 * @param quickCommands 快捷命令列表
 * @param captured 已捕获变量上下文
 * @param runParams 运行时填参值
 * @returns string | null 渲染文本
 *
 */
function renderStep (
    step: WorkflowStep,
    quickCommands: QuickCommand[],
    captured: Record<string, string>,
    runParams: Record<string, string>,
): string | null {
    const template = stepCommandTemplate(step, quickCommands)
    if (template === null) {
        return null
    }
    const rendered = renderQuickCommand(template, resolveStepValues(step, captured, runParams))
    return rendered.trim() === '' ? null : rendered
}

/**
 * @description 运行失败/中止时发送系统通知（completed/cancelled 面板内可见，不打扰）
 * @param run 运行记录（status/note 已置终态）
 * @returns void
 *
 * @example notifyRunFailure(run)
 *
 */
function notifyRunFailure (run: WorkflowRun): void {
    const { t } = i18n.global
    if (run.status === 'failed') {
        const step = run.note.split(':')[1] ?? ''
        void sendAppNotification(
            t('palette.workflowNotifyFailedTitle'),
            t('palette.workflowNotifyFailedBody', { name: run.workflowName, step }),
        )
        return
    }
    if (run.status === 'aborted') {
        void sendAppNotification(
            t('palette.workflowNotifyAbortedTitle'),
            t('palette.workflowNotifyAbortedBody', { name: run.workflowName }),
        )
    }
}

/**
 * @description expect 等待 + 捕获窗口：订阅窗格输出累计纯文本；pattern 命中或（无
 *              pattern 时）输出静默 PROMPT_SILENCE_MS 即视为就绪；取消/超时各有终态。
 *              等待结束把累计文本经 sink 交付给捕获提取
 * @param pane 窗格运行句柄
 * @param wait 步骤等待定义
 * @param capture 步骤捕获定义（undefined = 不需要累计交付）
 * @param cancelled 取消标志读取函数
 * @param sink 累计文本回传（仅在定义了 capture 时调用）
 * @returns Promise<'matched' | 'timeout' | 'cancelled'> 等待结果
 *
 */
function waitExpectCapture (
    pane: PaneCapture,
    wait: Extract<StepWait, { kind: 'expect' }>,
    capture: StepCapture | undefined,
    cancelled: () => boolean,
    sink: (text: string) => void,
): Promise<'matched' | 'timeout' | 'cancelled'> {
    return new Promise(resolve => {
        let accumulated = ''
        let settled = false
        let silenceTimer: ReturnType<typeof setTimeout> | null = null
        const timers: Array<ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>> = []
        const stopTap = pane.tapOutput(chunk => {
            accumulated += stripAnsi(chunk)
            if (silenceTimer) {
                clearTimeout(silenceTimer)
            }
            if (!wait.pattern && !settled) {
                silenceTimer = setTimeout(() => finish('matched'), PROMPT_SILENCE_MS)
            }
        })
        const finish = (result: 'matched' | 'timeout' | 'cancelled'): void => {
            if (settled) {
                return
            }
            settled = true
            stopTap()
            if (silenceTimer) {
                clearTimeout(silenceTimer)
            }
            for (const timer of timers) {
                clearTimeout(timer)
                clearInterval(timer)
            }
            if (capture) {
                sink(accumulated)
            }
            resolve(result)
        }
        // 轮询：取消感知 + pattern 匹配（chunk 回调只追加文本，匹配集中在此简化清理）
        timers.push(setInterval(() => {
            if (cancelled()) {
                finish('cancelled')
            } else if (wait.pattern && matchExpect(accumulated, wait.pattern, null)) {
                finish('matched')
            }
        }, 50))
        timers.push(setTimeout(() => finish('timeout'), Math.max(wait.timeoutMs, PROMPT_SILENCE_MS + 100)))
    })
}

/**
 * @description 固定延时路径的输出采样：延时结束后再监听一段静默窗口，把期间输出
 *              累计给捕获提取（尽力而为，不含延时期间已滚过的输出）
 * @param pane 窗格句柄
 * @param cancelled 取消标志
 * @returns Promise<string> 采样窗口内的纯文本
 *
 */
async function sampleOutput (pane: PaneCapture, cancelled: () => boolean): Promise<string> {
    const windowMs = PROMPT_SILENCE_MS * 2
    return await new Promise(resolve => {
        let accumulated = ''
        let settled = false
        const stopTap = pane.tapOutput(chunk => {
            accumulated += stripAnsi(chunk)
        })
        const finish = (): void => {
            if (settled) {
                return
            }
            settled = true
            stopTap()
            clearTimeout(timer)
            clearInterval(cancelPoll)
            resolve(accumulated)
        }
        const timer = setTimeout(finish, windowMs)
        const cancelPoll = setInterval(() => {
            if (cancelled()) {
                finish()
            }
        }, 100)
    })
}

/**
 * @description 可中断 sleep（固定延时路径；取消时提前 resolve）
 * @param ms 时长
 * @param cancelled 取消标志
 * @returns Promise<void>
 *
 */
function sleepInterruptible (ms: number, cancelled: () => boolean): Promise<void> {
    return new Promise(resolve => {
        const started = Date.now()
        const poll = setInterval(() => {
            if (cancelled() || Date.now() - started >= ms) {
                clearInterval(poll)
                resolve()
            }
        }, 50)
    })
}

/**
 * @description 执行一条工作流（二期主入口）：joined 合并发送；sequential 逐步发送，
 *              按步骤 wait 策略等待（expect/固定延时/工作流默认延时），capture 提取
 *              变量注入后续步骤；运行注册进 workflowRuns 供 UI 展示与取消。
 *              终态：completed / aborted（窗格丢失）/ failed（expect 超时且 stopOnError）
 *              / cancelled
 * @param workflow 目标工作流
 * @param quickCommands 快捷命令列表（引用解析用）
 * @param paramValues 运行时参数填写值
 * @returns Promise<WorkflowRun | null> 运行记录；无法就绪（无终端/窗格被占用）返回 null
 *
 * @example void runWorkflowV2(workflow, quickCommands, { branch: 'main' })
 *
 */
export async function runWorkflowV2 (
    workflow: Workflow,
    quickCommands: QuickCommand[],
    paramValues: Record<string, string>,
): Promise<WorkflowRun | null> {
    if (!await ensureTerminalTab()) {
        return null
    }
    const pane = terminalTabApi.current?.captureActivePane()
    if (!pane || runOnPane(pane.key)) {
        return null
    }

    const run: WorkflowRun = {
        id: `run-${nanoid(8)}`,
        workflowId: workflow.id,
        workflowName: workflow.name || workflow.id,
        paneKey: pane.key,
        currentStepIndex: 0,
        totalSteps: workflow.steps.length,
        startedAt: Date.now(),
        endedAt: null,
        status: 'running',
        note: '',
    }
    const control: RunControl = { cancelled: false }
    activeControls.set(run.id, control)
    workflowRuns.value.push(run)
    // 注册表只保留运行中 + 最近 20 条终态（终态记录供 UI 短暂展示）
    if (workflowRuns.value.length > 20) {
        const running = workflowRuns.value.filter(item => item.status === 'running')
        const finished = workflowRuns.value.filter(item => item.status !== 'running').slice(-20)
        workflowRuns.value = [...running, ...finished]
    }

    try {
        if (workflow.execution === 'joined') {
            const { text } = buildWorkflowCommand(workflow, quickCommands, paramValues)
            if (text) {
                pane.sendText(text, true)
            }
            run.status = 'completed'
            return run
        }

        const captured: Record<string, string> = {}
        for (const [index, step] of workflow.steps.entries()) {
            if (control.cancelled) {
                run.status = 'cancelled'
                return run
            }
            if (!pane.isAlive()) {
                run.status = 'aborted'
                run.note = 'pane-lost'
                notifyRunFailure(run)
                return run
            }
            run.currentStepIndex = index

            const rendered = renderStep(step, quickCommands, captured, paramValues)
            if (rendered === null) {
                continue
            }
            pane.sendText(rendered, true)

            // 等待：步骤 wait 优先，缺省沿用工作流级固定延时（一期语义）
            let accumulated = ''
            if (step.wait?.kind === 'expect') {
                const result = await waitExpectCapture(pane, step.wait, step.capture, () => control.cancelled, text => {
                    accumulated = text
                })
                if (result === 'cancelled') {
                    run.status = 'cancelled'
                    return run
                }
                if (result === 'timeout') {
                    if (step.wait.onTimeout === 'abort' && workflow.stopOnError) {
                        run.status = 'failed'
                        run.note = `expect-timeout:${index + 1}`
                        notifyRunFailure(run)
                        return run
                    }
                    // onTimeout=continue 或 stopOnError=false：跳过该步继续
                    continue
                }
            } else {
                const delay = step.wait?.kind === 'fixed'
                    ? step.wait.ms
                    : (index < workflow.steps.length - 1 ? workflow.stepIntervalMs : 0)
                if (delay > 0) {
                    await sleepInterruptible(delay, () => control.cancelled)
                    if (control.cancelled) {
                        run.status = 'cancelled'
                        return run
                    }
                }
            }

            // 捕获：expect 路径已取等待窗口累计文本；固定延时路径补一段采样
            if (step.capture) {
                if (!accumulated) {
                    accumulated = await sampleOutput(pane, () => control.cancelled)
                }
                captured[step.capture.var] = extractCapture(accumulated, step.capture)
            }
        }
        run.status = 'completed'
        return run
    } finally {
        run.endedAt = Date.now()
        activeControls.delete(run.id)
    }
}
