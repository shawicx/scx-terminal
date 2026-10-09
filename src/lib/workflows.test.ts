/**
 * @description 工作流模板工具单测：步骤构建/参数收集/渲染/joined 合并/引用查询/预览
 */
import { describe, expect, it } from 'vitest'
import type { QuickCommand, Workflow, WorkflowStep } from '@/stores/config'
import {
    buildWorkflowCommand, collectWorkflowParams, findQuickCommandRefs,
    previewWorkflow, renderWorkflowSteps, stepCommandTemplate,
} from './workflows'

const quickCommands: QuickCommand[] = [
    { id: 'qc-1', name: 'checkout', command: 'git checkout {{branch}}', autoRun: true },
    { id: 'qc-2', name: 'push', command: 'git push origin {{branch}}', autoRun: false },
    { id: 'qc-3', name: 'status', command: 'git status', autoRun: false },
]

function workflow (steps: WorkflowStep[], execution: 'joined' | 'sequential' = 'joined'): Workflow {
    return { id: 'wf-1', name: 'git flow', execution, stepIntervalMs: 500, steps }
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
