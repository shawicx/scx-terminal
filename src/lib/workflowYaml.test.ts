/**
 * @description 工作流 YAML 工具单测：序列化解引用/round-trip/多文档/错误码/导入构建
 */
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import type { QuickCommand, Workflow, WorkflowStep } from '@/stores/config'
import {
    buildImportedWorkflow, parseWorkflowYaml, serializeWorkflowYaml, serializeWorkflowsYaml,
    WorkflowYamlError, WORKFLOW_YAML_FORMAT,
} from './workflowYaml'

const quickCommands: QuickCommand[] = [
    { id: 'qc-1', name: 'checkout', command: 'git checkout {{branch}}', autoRun: true },
    { id: 'qc-2', name: '', command: 'git status', autoRun: false },
]

function workflow (steps: WorkflowStep[], execution: 'joined' | 'sequential' = 'sequential'): Workflow {
    return {
        id: 'wf-1', name: '部署', description: '发布流程', execution,
        stepIntervalMs: 800, stopOnError: false, steps,
    }
}

describe('serializeWorkflowYaml', () => {
    it('quickCommand 步解引用为内联命令 + name 注释，raw 步原样', () => {
        const steps: WorkflowStep[] = [
            { id: 's1', kind: 'quickCommand', quickCommandId: 'qc-1', paramValues: { branch: 'main' } },
            { id: 's2', kind: 'raw', command: 'git pull' },
        ]
        const { yaml, droppedSteps } = serializeWorkflowYaml(workflow(steps), quickCommands)
        expect(droppedSteps).toBe(0)
        const doc = parseYaml(yaml)
        expect(doc.format).toBe(WORKFLOW_YAML_FORMAT)
        expect(doc.version).toBe(1)
        expect(doc.workflow.name).toBe('部署')
        expect(doc.workflow.execution).toBe('sequential')
        expect(doc.workflow.stepIntervalMs).toBe(800)
        expect(doc.workflow.stopOnError).toBe(false)
        expect(doc.workflow.steps[0]).toEqual({
            name: 'checkout',
            command: 'git checkout {{branch}}',
            paramValues: { branch: 'main' },
        })
        expect(doc.workflow.steps[1]).toEqual({ command: 'git pull' })
        // 无名快捷命令不携带 name 键
        const { yaml: yaml2 } = serializeWorkflowYaml(workflow([{ id: 's1', kind: 'quickCommand', quickCommandId: 'qc-2' }]), quickCommands)
        expect(parseYaml(yaml2).workflow.steps[0]).toEqual({ command: 'git status' })
    })

    it('wait/capture 全字段随步骤导出', () => {
        const steps: WorkflowStep[] = [{
            id: 's1', kind: 'raw', command: 'build',
            wait: { kind: 'expect', pattern: 'done$', timeoutMs: 5000, onTimeout: 'abort' },
            capture: { var: 'ver', pattern: 'version (\\S+)' },
        }]
        const { yaml } = serializeWorkflowYaml(workflow(steps), quickCommands)
        expect(parseYaml(yaml).workflow.steps[0].wait).toEqual({
            kind: 'expect', pattern: 'done$', timeoutMs: 5000, onTimeout: 'abort',
        })
        expect(parseYaml(yaml).workflow.steps[0].capture).toEqual({ var: 'ver', pattern: 'version (\\S+)' })
    })

    it('悬空引用步骤丢弃并计数', () => {
        const steps: WorkflowStep[] = [
            { id: 's1', kind: 'quickCommand', quickCommandId: 'qc-x' },
            { id: 's2', kind: 'raw', command: 'ls' },
        ]
        const { yaml, droppedSteps } = serializeWorkflowYaml(workflow(steps), quickCommands)
        expect(droppedSteps).toBe(1)
        expect(parseYaml(yaml).workflow.steps).toHaveLength(1)
    })

    it('round-trip：导出 → 解析 → 导入构建，语义字段完整还原', () => {
        const steps: WorkflowStep[] = [
            { id: 's1', kind: 'quickCommand', quickCommandId: 'qc-1', paramValues: { branch: 'dev' } },
            { id: 's2', kind: 'raw', command: 'git pull', wait: { kind: 'fixed', ms: 200 } },
        ]
        const { yaml } = serializeWorkflowYaml(workflow(steps), quickCommands)
        const [parsed] = parseWorkflowYaml(yaml)
        const imported = buildImportedWorkflow(parsed)
        expect(imported.name).toBe('部署')
        expect(imported.description).toBe('发布流程')
        expect(imported.execution).toBe('sequential')
        expect(imported.stepIntervalMs).toBe(800)
        expect(imported.stopOnError).toBe(false)
        expect(imported.id).not.toBe('wf-1')
        expect(imported.steps).toHaveLength(2)
        expect(imported.steps.every(step => step.kind === 'raw')).toBe(true)
        expect(imported.steps[0]!.command).toBe('git checkout {{branch}}')
        expect(imported.steps[0]!.paramValues).toEqual({ branch: 'dev' })
        expect(imported.steps[1]!.wait).toEqual({ kind: 'fixed', ms: 200 })
    })
})

describe('serializeWorkflowsYaml / parseWorkflowYaml 多文档', () => {
    it('多条工作流以 --- 分隔往返', () => {
        const wf1 = workflow([{ id: 's1', kind: 'raw', command: 'a' }])
        const wf2 = { ...workflow([{ id: 's1', kind: 'raw', command: 'b' }]), id: 'wf-2', name: '回滚' }
        const { yaml, droppedSteps } = serializeWorkflowsYaml([wf1, wf2], quickCommands)
        expect(droppedSteps).toBe(0)
        const parsed = parseWorkflowYaml(yaml)
        expect(parsed.map(item => item.name)).toEqual(['部署', '回滚'])
        expect(parsed[1]!.steps[0]!.command).toBe('b')
    })
})

describe('parseWorkflowYaml 错误', () => {
    it('坏 YAML / 缺 format / 版本不识别 / 步骤缺 command 分类报错', () => {
        expect(() => parseWorkflowYaml('a: [unclosed')).toThrow(WorkflowYamlError)
        try {
            parseWorkflowYaml('format: other\nversion: 1\nworkflow: { name: x, steps: [] }')
            expect.unreachable()
        } catch (error) {
            expect((error as WorkflowYamlError).code).toBe('badFormat')
        }
        try {
            parseWorkflowYaml(`format: ${WORKFLOW_YAML_FORMAT}\nversion: 99\nworkflow: { name: x, steps: [] }`)
            expect.unreachable()
        } catch (error) {
            expect((error as WorkflowYamlError).code).toBe('badVersion')
        }
        try {
            parseWorkflowYaml(`format: ${WORKFLOW_YAML_FORMAT}\nversion: 1\nworkflow: { name: x, steps: [{ command: '' }] }`)
            expect.unreachable()
        } catch (error) {
            expect((error as WorkflowYamlError).code).toBe('badShape')
        }
    })

    it('wait/capture 形状非法报 badShape', () => {
        const base = `format: ${WORKFLOW_YAML_FORMAT}\nversion: 1\nworkflow:\n  name: x\n  steps:\n    - command: ls\n`
        expect(() => parseWorkflowYaml(base + '      wait: { kind: expect, timeoutMs: 0, onTimeout: abort }\n')).toThrow(WorkflowYamlError)
        expect(() => parseWorkflowYaml(base + '      capture: { var: bad name }\n')).toThrow(WorkflowYamlError)
    })

    it('缺省字段取默认值（execution/stepIntervalMs/stopOnError）', () => {
        const parsed = parseWorkflowYaml(`format: ${WORKFLOW_YAML_FORMAT}\nversion: 1\nworkflow:\n  name: x\n  steps:\n    - command: ls\n`)[0]!
        expect(parsed.execution).toBe('joined')
        expect(parsed.stepIntervalMs).toBe(500)
        expect(parsed.stopOnError).toBe(true)
    })
})

describe('buildImportedWorkflow', () => {
    it('新 id 且不携带 YAML 专属 name 注释', () => {
        const imported = buildImportedWorkflow({
            name: 'x', execution: 'joined', stepIntervalMs: 500, stopOnError: true,
            steps: [{ name: 'note', command: 'ls' }],
        })
        expect(imported.id).toMatch(/^wf-/)
        expect(imported.steps[0]!.id).toMatch(/^step-/)
        expect(imported.steps[0]!.command).toBe('ls')
        expect('name' in imported.steps[0]!).toBe(false)
    })
})
