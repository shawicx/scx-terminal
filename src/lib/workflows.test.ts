/**
 * @description 工作流模板工具单测：步骤构建/参数收集/渲染/joined 合并/引用查询/预览
 */
import { describe, expect, it } from 'vitest'
import type { QuickCommand, Workflow, WorkflowStep } from '@/stores/config'
import {
    buildWorkflowCommand, collectWorkflowParams, extractCapture, findQuickCommandRefs,
    matchExpect, previewWorkflow, renderWorkflowSteps, resolveStepValues, stepCommandTemplate,
    stripAnsi, validateWorkflowV2,
} from './workflows'

const quickCommands: QuickCommand[] = [
    { id: 'qc-1', name: 'checkout', command: 'git checkout {{branch}}', autoRun: true },
    { id: 'qc-2', name: 'push', command: 'git push origin {{branch}}', autoRun: false },
    { id: 'qc-3', name: 'status', command: 'git status', autoRun: false },
]

function workflow (steps: WorkflowStep[], execution: 'joined' | 'sequential' = 'joined'): Workflow {
    return { id: 'wf-1', name: 'git flow', execution, stepIntervalMs: 500, steps, stopOnError: true }
}

describe('stepCommandTemplate', () => {
    it('解析 quickCommand 步为被引用命令模板', () => {
        const step: WorkflowStep = { id: 's1', kind: 'quickCommand', quickCommandId: 'qc-1' }
        expect(stepCommandTemplate(step, quickCommands)).toBe('git checkout {{branch}}')
    })

    it('引用悬空返回 null', () => {
        const step: WorkflowStep = { id: 's1', kind: 'quickCommand', quickCommandId: 'qc-x' }
        expect(stepCommandTemplate(step, quickCommands)).toBeNull()
    })

    it('raw 步返回内联命令', () => {
        const step: WorkflowStep = { id: 's1', kind: 'raw', command: 'ls -la' }
        expect(stepCommandTemplate(step, quickCommands)).toBe('ls -la')
    })
})

describe('collectWorkflowParams', () => {
    it('跨步骤收集占位符并集（去重保序）', () => {
        const steps: WorkflowStep[] = [
            { id: 's1', kind: 'quickCommand', quickCommandId: 'qc-1' },
            { id: 's2', kind: 'quickCommand', quickCommandId: 'qc-2' },
            { id: 's3', kind: 'raw', command: 'echo {{msg}} {{branch}}' },
        ]
        expect(collectWorkflowParams(steps, quickCommands)).toEqual(['branch', 'msg'])
    })

    it('悬空引用步骤跳过', () => {
        const steps: WorkflowStep[] = [
            { id: 's1', kind: 'quickCommand', quickCommandId: 'qc-x' },
            { id: 's2', kind: 'raw', command: 'git status' },
        ]
        expect(collectWorkflowParams(steps, quickCommands)).toEqual([])
    })
})

describe('renderWorkflowSteps', () => {
    it('按步骤顺序渲染并替换占位符', () => {
        const steps: WorkflowStep[] = [
            { id: 's1', kind: 'quickCommand', quickCommandId: 'qc-1' },
            { id: 's2', kind: 'raw', command: 'echo done' },
        ]
        expect(renderWorkflowSteps(workflow(steps), quickCommands, { branch: 'main' }))
            .toEqual(['git checkout main', 'echo done'])
    })

    it('步骤级预设被运行时值覆盖、未覆盖的预设生效', () => {
        const steps: WorkflowStep[] = [
            { id: 's1', kind: 'quickCommand', quickCommandId: 'qc-1', paramValues: { branch: 'dev' } },
            { id: 's2', kind: 'quickCommand', quickCommandId: 'qc-2', paramValues: { branch: 'dev' } },
        ]
        expect(renderWorkflowSteps(workflow(steps), quickCommands, { branch: 'main' }))
            .toEqual(['git checkout main', 'git push origin main'])
        expect(renderWorkflowSteps(workflow(steps), quickCommands, {}))
            .toEqual(['git checkout dev', 'git push origin dev'])
    })

    it('悬空引用步骤被剔除', () => {
        const steps: WorkflowStep[] = [
            { id: 's1', kind: 'quickCommand', quickCommandId: 'qc-x' },
            { id: 's2', kind: 'raw', command: 'git status' },
        ]
        expect(renderWorkflowSteps(workflow(steps), quickCommands, {})).toEqual(['git status'])
    })
})

describe('buildWorkflowCommand', () => {
    it('joined 模式合并为单条 && 命令', () => {
        const steps: WorkflowStep[] = [
            { id: 's1', kind: 'quickCommand', quickCommandId: 'qc-1' },
            { id: 's2', kind: 'quickCommand', quickCommandId: 'qc-3' },
        ]
        const { text } = buildWorkflowCommand(workflow(steps), quickCommands, { branch: 'main' })
        expect(text).toBe('git checkout main && git status')
    })

    it('sequential 模式返回逐步数组（保留步内多行）', () => {
        const steps: WorkflowStep[] = [
            { id: 's1', kind: 'raw', command: 'git add -A\ngit commit -m x\n' },
            { id: 's2', kind: 'raw', command: 'git status' },
        ]
        const { sequential } = buildWorkflowCommand(workflow(steps, 'sequential'), [], {})
        expect(sequential).toEqual(['git add -A\ngit commit -m x', 'git status'])
    })

    it('全部悬空/渲染为空时返回空载荷', () => {
        const steps: WorkflowStep[] = [{ id: 's1', kind: 'raw', command: '' }]
        const payload = buildWorkflowCommand(workflow(steps), [], {})
        expect(payload.text).toBe('')
        expect(payload.sequential).toEqual([])
    })
})

describe('findQuickCommandRefs', () => {
    it('返回引用该快捷命令的工作流', () => {
        const wf1 = workflow([{ id: 's1', kind: 'quickCommand', quickCommandId: 'qc-1' }])
        const wf2 = workflow([{ id: 's1', kind: 'quickCommand', quickCommandId: 'qc-2' }])
        expect(findQuickCommandRefs([wf1, wf2], 'qc-1')).toEqual([wf1])
        expect(findQuickCommandRefs([wf1, wf2], 'qc-3')).toEqual([])
    })
})

describe('previewWorkflow', () => {
    it('各步预览以 && 连接并截断', () => {
        const steps: WorkflowStep[] = [
            { id: 's1', kind: 'quickCommand', quickCommandId: 'qc-1' },
            { id: 's2', kind: 'quickCommand', quickCommandId: 'qc-3' },
        ]
        expect(previewWorkflow(workflow(steps), quickCommands)).toBe('git checkout {{branch}} && git status')
        expect(previewWorkflow(workflow(steps), quickCommands, 10)).toBe('git check…')
    })
})

describe('stripAnsi', () => {
    it('剥离 CSI 与 OSC 序列', () => {
        expect(stripAnsi('\x1b[32mok\x1b[0m')).toBe('ok')
        expect(stripAnsi('\x1b]0;title\x07plain')).toBe('plain')
        expect(stripAnsi('\x1b[?25ldone')).toBe('done')
        expect(stripAnsi('no escapes')).toBe('no escapes')
    })
})

describe('resolveStepValues', () => {
    it('优先级：运行参数 > 捕获变量 > 步骤预设', () => {
        const step: WorkflowStep = { id: 's1', kind: 'raw', command: 'x', paramValues: { v: 'preset', only: 'p' } }
        expect(resolveStepValues(step, { v: 'captured', c: 'cap' }, { v: 'run' }))
            .toEqual({ v: 'run', only: 'p', c: 'cap' })
    })
})

describe('matchExpect', () => {
    it('显式 pattern 命中', () => {
        expect(matchExpect('build done\n$ ', 'done', null)).toBe(true)
        expect(matchExpect('building...', 'done', null)).toBe(false)
    })

    it('pattern 缺省回退提示符正则；两者皆无返回 false', () => {
        expect(matchExpect('out\nuser@host:~$ ', null, '[#$] $')).toBe(true)
        expect(matchExpect('out\nuser@host:~$ ', null, null)).toBe(false)
    })

    it('非法正则按不命中处理', () => {
        expect(matchExpect('x', '([', null)).toBe(false)
    })
})

describe('extractCapture', () => {
    it('有 pattern 取首个捕获组', () => {
        expect(extractCapture('version 1.2.3 (stable)', { var: 'v', pattern: 'version (\\S+)' })).toBe('1.2.3')
    })

    it('无捕获组取整段匹配；无 pattern 取整段 trim；无匹配返回空串', () => {
        expect(extractCapture('abc', { var: 'v', pattern: 'b' })).toBe('b')
        expect(extractCapture('  raw \n', { var: 'v' })).toBe('raw')
        expect(extractCapture('x', { var: 'v', pattern: 'zzz' })).toBe('')
    })
})

describe('validateWorkflowV2', () => {
    it('joined 模式下 wait/capture 报错', () => {
        const wf = { ...workflow([{ id: 's1', kind: 'raw', command: 'x', wait: { kind: 'fixed', ms: 100 } }]), stopOnError: true }
        expect(validateWorkflowV2(wf)).toEqual([{ code: 'joinedNoWait', stepIndex: 0 }])
    })

    it('非法正则 / 非法变量名 / 非法超时分类报错', () => {
        const wf = {
            ...workflow([
                { id: 's1', kind: 'raw', command: 'x', wait: { kind: 'expect', pattern: '([', timeoutMs: 100, onTimeout: 'abort' } },
                { id: 's2', kind: 'raw', command: 'x', capture: { var: 'bad name' } },
                { id: 's3', kind: 'raw', command: 'x', wait: { kind: 'expect', timeoutMs: 0, onTimeout: 'abort' } },
            ], 'sequential'),
            stopOnError: true,
        }
        const codes = validateWorkflowV2(wf).map(error => error.code)
        expect(codes).toEqual(['badExpectPattern', 'badCaptureVar', 'badExpectTimeout'])
    })

    it('合法配置通过', () => {
        const wf = {
            ...workflow([
                { id: 's1', kind: 'raw', command: 'x', wait: { kind: 'expect', timeoutMs: 5000, onTimeout: 'abort' }, capture: { var: 'v', pattern: '(\\d+)' } },
            ], 'sequential'),
            stopOnError: false,
        }
        expect(validateWorkflowV2(wf)).toEqual([])
    })
})
