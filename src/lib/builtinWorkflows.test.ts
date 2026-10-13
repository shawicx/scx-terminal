/**
 * @description 内置工作流目录单测：asset YAML 全量解析（格式回归夹具）、稳定 id、
 *              可见性过滤（hide/unhide/reset）与合并视图
 */
import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@/stores/config/defaults'
import type { ConfigStore } from '@/stores/config/types'
import {
    builtinCatalog, BUILTIN_WORKFLOW_ID_PREFIX, builtinSlugFromName, builtinVirtualGroups,
    bundledBuiltinWorkflows, ensureWorkflowGroupIdByName, hideBuiltinWorkflow, isBuiltinId,
    isBuiltinWorkflowGroupId, resetBuiltinWorkflows, unhideBuiltinWorkflow,
    visibleBuiltinWorkflows, visibleWorkflows, workflowDisplayGroups,
} from './builtinWorkflows'

function store (): ConfigStore {
    return defaultConfig() as ConfigStore
}

describe('bundledBuiltinWorkflows', () => {
    it('asset YAML 经统一 parser 全量实例化（格式回归）', () => {
        const bundled = bundledBuiltinWorkflows()
        expect(bundled.length).toBeGreaterThan(20)
        expect(bundled.every(workflow => isBuiltinId(workflow.id))).toBe(true)
        expect(bundled.every(workflow => workflow.steps.length > 0)).toBe(true)
        expect(bundled.every(workflow => workflow.steps.every(step => step.kind === 'raw'))).toBe(true)
        // 稳定 id：id 唯一且来自文档 id
        expect(new Set(bundled.map(workflow => workflow.id)).size).toBe(bundled.length)
        expect(bundled.some(workflow => workflow.id === `${BUILTIN_WORKFLOW_ID_PREFIX}git-undo-last-commit`)).toBe(true)
        // 参数占位符原样保留（运行时填参）
        expect(bundledBuiltinWorkflows()[0]!.steps[0]!.command).toContain('{{')
    })

    it('条目分组指向确定性虚拟分组 id（builtin-wfg- 前缀）', () => {
        const bundled = bundledBuiltinWorkflows()
        const grouped = bundled.filter(workflow => workflow.groupId !== undefined)
        expect(grouped.length).toBe(bundled.length)
        expect(grouped.every(workflow => isBuiltinWorkflowGroupId(workflow.groupId!))).toBe(true)
    })
})

describe('工作流分组体系', () => {
    it('内置虚拟分组：名称来自随包 YAML 且去重，展示分组合集 = 用户分组 + 虚拟分组', () => {
        const s = store()
        const virtual = builtinVirtualGroups()
        expect(virtual.length).toBeGreaterThan(0)
        expect(virtual.every(group => isBuiltinWorkflowGroupId(group.id))).toBe(true)
        expect(new Set(virtual.map(group => group.name)).size).toBe(virtual.length)
        s.workflowGroups.push({ id: 'wfgroup-1', name: '自定义', sortOrder: 0 })
        const display = workflowDisplayGroups(s)
        expect(display.map(group => group.id)).toEqual(['wfgroup-1', ...virtual.map(group => group.id)])
    })

    it('ensureWorkflowGroupIdByName：同名内置 → 虚拟 id；同名用户组 → 复用；否则新建', () => {
        const s = store()
        expect(ensureWorkflowGroupIdByName(s, 'Git')).toBe(builtinVirtualGroups().find(group => group.name === 'Git')!.id)
        expect(ensureWorkflowGroupIdByName(s, '')).toBeUndefined()
        s.workflowGroups.push({ id: 'wfgroup-ops', name: '运维', sortOrder: 0 })
        expect(ensureWorkflowGroupIdByName(s, '运维')).toBe('wfgroup-ops')
        const created = ensureWorkflowGroupIdByName(s, '发布')
        expect(created).toMatch(/^wfgroup-/)
        expect(s.workflowGroups.map(group => group.name)).toContain('发布')
        expect(ensureWorkflowGroupIdByName(s, '发布')).toBe(created)
    })
})

describe('可见性与合并视图', () => {
    it('hide/unhide/reset 语义：隐藏过滤、重置恢复、扩展包保留', () => {
        const s = store()
        const first = bundledBuiltinWorkflows()[0]!
        expect(visibleBuiltinWorkflows(s)).toHaveLength(bundledBuiltinWorkflows().length)
        hideBuiltinWorkflow(s, first.id)
        hideBuiltinWorkflow(s, first.id) // 幂等
        expect(visibleBuiltinWorkflows(s).some(workflow => workflow.id === first.id)).toBe(false)
        expect(s.workflowCtl.removed).toEqual([first.id])
        unhideBuiltinWorkflow(s, first.id)
        expect(visibleBuiltinWorkflows(s)).toHaveLength(bundledBuiltinWorkflows().length)
        hideBuiltinWorkflow(s, first.id)
        resetBuiltinWorkflows(s)
        expect(s.workflowCtl.removed).toEqual([])
    })

    it('visibleWorkflows = 可见内置 + 用户工作流；目录 = 随包 + 扩展包', () => {
        const s = store()
        s.workflows.push({
            id: 'wf-user-1', name: '我的', execution: 'joined', stepIntervalMs: 500, stopOnError: true,
            steps: [{ id: 's1', kind: 'raw', command: 'echo hi' }],
        })
        s.workflowCtl.packs.push({
            id: 'builtin-pack-entry', name: '扩展包', execution: 'joined', stepIntervalMs: 500, stopOnError: true,
            steps: [{ id: 's1', kind: 'raw', command: 'ls' }],
        })
        expect(builtinCatalog(s)).toHaveLength(bundledBuiltinWorkflows().length + 1)
        const merged = visibleWorkflows(s)
        expect(merged).toHaveLength(bundledBuiltinWorkflows().length + 1 + 1)
        expect(merged.at(-1)!.id).toBe('wf-user-1')
        hideBuiltinWorkflow(s, 'builtin-pack-entry')
        expect(visibleWorkflows(s)).toHaveLength(bundledBuiltinWorkflows().length + 1)
    })
})

describe('builtinSlugFromName', () => {
    it('非安全字符折叠为 -，空串兜底 entry', () => {
        expect(builtinSlugFromName('Git 撤销 提交!')).toBe('Git-撤销-提交')
        expect(builtinSlugFromName('  ')).toBe('entry')
    })
})
