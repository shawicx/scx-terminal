/**
 * @description 内置工作流目录中枢：随包分发的 builtin-workflows.yaml（与导入/导出同一
 *              YAML 格式）经统一 parser 实例化为只读 Workflow（稳定 id，前缀 builtin-）；
 *              提供可见性计算（隐藏清单过滤）与「内置 + 用户」合并视图，供设置页、
 *              工作流选择器、输入建议与命令面板共用。用户导入的内置扩展包存于
 *              config.workflowCtl.packs，与本目录合并展示。
 */
import bundledYaml from '@/assets/builtin-workflows.yaml?raw'
import { nanoid } from 'nanoid'
import type { ConfigStore, Workflow, WorkflowGroup } from '@/stores/config'
import { nextGroupSortOrder } from '@/stores/config/defaults'
import { buildImportedWorkflow, parseWorkflowBundle } from '@/lib/workflowYaml'

/** 内置工作流 id 前缀（稳定 id 判定与隐藏清单引用均依赖它） */
export const BUILTIN_WORKFLOW_ID_PREFIX = 'builtin-'

/** 内置虚拟分组 id 前缀（分组名 slug 派生；不入库、不可编辑，展示时合并进分组列表） */
export const BUILTIN_WORKFLOW_GROUP_ID_PREFIX = 'builtin-wfg-'

/**
 * @description 由内置分组名生成确定性虚拟分组 id（同一分组名跨会话/跨设备稳定，
 *              供内置条目 groupId 引用与展示分组去重）
 * @param name 分组名
 * @returns string 虚拟分组 id
 *
 * @example builtinWorkflowGroupId('Git') // 'builtin-wfg-Git'
 *
 */
export function builtinWorkflowGroupId (name: string): string {
    return `${BUILTIN_WORKFLOW_GROUP_ID_PREFIX}${builtinSlugFromName(name)}`
}

/** 随包内置目录缓存（模块级单例：YAML 只解析一次） */
let bundledCache: Workflow[] | null = null

/** 随包内置分组名缓存（模块级单例；与目录同源，首次解析后固定） */
let bundledGroupNamesCache: string[] | null = null

/**
 * @description 判定工作流 id 是否为内置（随包目录或导入扩展包，均带固定前缀）
 * @param id 工作流 id
 * @returns boolean 是否内置
 *
 * @example isBuiltinId('builtin-git-undo-add') // true
 *
 */
export function isBuiltinId (id: string): boolean {
    return id.startsWith(BUILTIN_WORKFLOW_ID_PREFIX)
}

/**
 * @description 由工作流名称生成稳定 slug（内置包条目缺 id 时的 id 兜底）
 * @param name 工作流名称
 * @returns string slug（非 [\w-] 字符折叠为 -）
 *
 * @example builtinSlugFromName('Git 撤销提交') // 'Git-撤销提交'
 *
 */
export function builtinSlugFromName (name: string): string {
    return name.trim().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'entry'
}

/**
 * @description 实例化随包内置目录：解析 asset YAML（与导入文件同一 parser，天然做
 *              格式回归校验）并构建为只读 Workflow（稳定 id、步骤全内联、分组指向
 *              确定性虚拟分组 id）
 * @returns Workflow[] 随包内置工作流列表（模块级缓存）
 *
 * @example bundledBuiltinWorkflows()[0].id // 'builtin-git-delete-local-branch'
 *
 */
export function bundledBuiltinWorkflows (): Workflow[] {
    if (bundledCache === null) {
        const { docs } = parseWorkflowBundle(bundledYaml)
        const groupNames: string[] = []
        bundledCache = docs.map(doc => {
            if (doc.workflow.group && !groupNames.includes(doc.workflow.group)) {
                groupNames.push(doc.workflow.group)
            }
            const workflow = buildImportedWorkflow(
                doc.workflow,
                doc.workflow.id ? `${BUILTIN_WORKFLOW_ID_PREFIX}${doc.workflow.id}` : `${BUILTIN_WORKFLOW_ID_PREFIX}${builtinSlugFromName(doc.workflow.name)}`,
            )
            return doc.workflow.group ? { ...workflow, groupId: builtinWorkflowGroupId(doc.workflow.group) } : workflow
        })
        bundledGroupNamesCache = groupNames
    }
    return bundledCache
}

/**
 * @description 内置目录全集：随包内置 + 用户导入的内置扩展包（按 packs 顺序）
 * @param store 配置 store（读 workflowCtl.packs）
 * @returns Workflow[] 内置目录全集
 *
 * @example builtinCatalog(store).length // 22
 *
 */
export function builtinCatalog (store: ConfigStore): Workflow[] {
    return [...bundledBuiltinWorkflows(), ...store.workflowCtl.packs]
}

/**
 * @description 可见的内置工作流：全集过滤掉用户隐藏（removed）的条目
 * @param store 配置 store（读 workflowCtl）
 * @returns Workflow[] 可见内置工作流
 *
 * @example visibleBuiltinWorkflows(store).some(w => w.id === id) // false（被隐藏时）
 *
 */
export function visibleBuiltinWorkflows (store: ConfigStore): Workflow[] {
    const removed = new Set(store.workflowCtl.removed)
    return builtinCatalog(store).filter(workflow => !removed.has(workflow.id))
}

/**
 * @description 内置 + 用户的合并视图（消费方统一入口）：可见内置在前，用户工作流在后。
 *              命令面板/输入建议/引用保护均应使用此列表而非裸 store.workflows
 * @param store 配置 store
 * @returns Workflow[] 合并后的工作流列表
 *
 * @example visibleWorkflows(store).length // 可见内置数 + store.workflows.length
 *
 */
export function visibleWorkflows (store: ConfigStore): Workflow[] {
    return [...visibleBuiltinWorkflows(store), ...store.workflows]
}

/**
 * @description 按内置 id 隐藏（内置「删除」= 记入 removed，重置可恢复）
 * @param store 配置 store（原地修改 workflowCtl.removed，走防抖落库）
 * @param id 内置工作流 id
 * @returns void
 *
 * @example hideBuiltinWorkflow(store, 'builtin-git-undo-add')
 *
 */
export function hideBuiltinWorkflow (store: ConfigStore, id: string): void {
    if (!store.workflowCtl.removed.includes(id)) {
        store.workflowCtl.removed.push(id)
    }
}

/**
 * @description 取消隐藏（removed 中移除该 id）
 * @param store 配置 store
 * @param id 内置工作流 id
 * @returns void
 *
 * @example unhideBuiltinWorkflow(store, 'builtin-git-undo-add')
 *
 */
export function unhideBuiltinWorkflow (store: ConfigStore, id: string): void {
    const index = store.workflowCtl.removed.indexOf(id)
    if (index !== -1) {
        store.workflowCtl.removed.splice(index, 1)
    }
}

/**
 * @description 重置内置目录：清空隐藏清单（随包内置全部恢复展示）；扩展包保留
 * @param store 配置 store
 * @returns void
 *
 * @example resetBuiltinWorkflows(store)
 *
 */
export function resetBuiltinWorkflows (store: ConfigStore): void {
    store.workflowCtl.removed = []
}

/**
 * @description 判定分组 id 是否为内置虚拟分组（设置页据此锁定重命名/删除/排序）
 * @param id 分组 id
 * @returns boolean 是否内置虚拟分组
 *
 * @example isBuiltinWorkflowGroupId('builtin-wfg-Git') // true
 *
 */
export function isBuiltinWorkflowGroupId (id: string): boolean {
    return id.startsWith(BUILTIN_WORKFLOW_GROUP_ID_PREFIX)
}

/**
 * @description 内置虚拟分组列表（随包 YAML 分组名派生，展示顺序与目录首次出现顺序一致）
 * @returns WorkflowGroup[] 虚拟分组列表（sortOrder 排在用户分组之后）
 *
 * @example builtinVirtualGroups()[0].name // 'Git'
 *
 */
export function builtinVirtualGroups (): WorkflowGroup[] {
    bundledBuiltinWorkflows()
    return (bundledGroupNamesCache ?? []).map((name, index) => ({
        id: builtinWorkflowGroupId(name),
        name,
        sortOrder: 10_000 + index,
    }))
}

/**
 * @description 展示分组合集：用户自建分组在前（sortOrder 升序），内置虚拟分组在后；
 *              设置页手风琴、选择器面板与表单下拉共用
 * @param store 配置 store
 * @returns WorkflowGroup[] 展示分组列表
 *
 * @example workflowDisplayGroups(store)[0].id // 'wfgroup-…'
 *
 */
export function workflowDisplayGroups (store: ConfigStore): WorkflowGroup[] {
    return [...store.workflowGroups, ...builtinVirtualGroups()]
}

/**
 * @description 按分组名解析/落组：与随包内置分组同名 → 虚拟分组 id；否则找同名用户
 *              分组，找不到则新建（YAML 导入与内置扩展包 upsert 时把文档分组名
 *              落到本机分组体系）
 * @param store 配置 store（命中新建时原地 push workflowGroups）
 * @param name 分组名（trim 后为空返回 undefined = 不落组）
 * @returns string | undefined 分组 id；无分组返回 undefined
 *
 * @example ensureWorkflowGroupIdByName(store, 'Git').startsWith('builtin-wfg-') // true
 *
 */
export function ensureWorkflowGroupIdByName (store: ConfigStore, name: string): string | undefined {
    bundledBuiltinWorkflows()
    const trimmed = name.trim()
    if (!trimmed) {
        return undefined
    }
    if ((bundledGroupNamesCache ?? []).includes(trimmed)) {
        return builtinWorkflowGroupId(trimmed)
    }
    const existing = store.workflowGroups.find(group => group.name === trimmed)
    if (existing) {
        return existing.id
    }
    const created: WorkflowGroup = {
        id: `wfgroup-${nanoid(6)}`,
        name: trimmed,
        sortOrder: nextGroupSortOrder(store.workflowGroups),
    }
    store.workflowGroups.push(created)
    return created.id
}
