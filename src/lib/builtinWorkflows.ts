/**
 * @description 内置工作流目录中枢：随包分发的 builtin-workflows.yaml（与导入/导出同一
 *              YAML 格式）经统一 parser 实例化为只读 Workflow（稳定 id，前缀 builtin-）；
 *              提供可见性计算（隐藏清单过滤）与「内置 + 用户」合并视图，供设置页、
 *              工作流选择器、输入建议与命令面板共用。用户导入的内置扩展包存于
 *              config.workflowCtl.packs，与本目录合并展示。
 */
import bundledYaml from '@/assets/builtin-workflows.yaml?raw'
import type { ConfigStore, Workflow } from '@/stores/config'
import { buildImportedWorkflow, parseWorkflowBundle } from '@/lib/workflowYaml'

/** 内置工作流 id 前缀（稳定 id 判定与隐藏清单引用均依赖它） */
export const BUILTIN_WORKFLOW_ID_PREFIX = 'builtin-'

/** 随包内置目录缓存（模块级单例：YAML 只解析一次） */
let bundledCache: Workflow[] | null = null

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
 *              格式回归校验）并构建为只读 Workflow（稳定 id、步骤全内联）
 * @returns Workflow[] 随包内置工作流列表（模块级缓存）
 *
 * @example bundledBuiltinWorkflows()[0].id // 'builtin-git-delete-local-branch'
 *
 */
export function bundledBuiltinWorkflows (): Workflow[] {
    if (bundledCache === null) {
        const { docs } = parseWorkflowBundle(bundledYaml)
        bundledCache = docs.map(doc => buildImportedWorkflow(
            doc.workflow,
            doc.workflow.id ? `${BUILTIN_WORKFLOW_ID_PREFIX}${doc.workflow.id}` : `${BUILTIN_WORKFLOW_ID_PREFIX}${builtinSlugFromName(doc.workflow.name)}`,
        ))
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
