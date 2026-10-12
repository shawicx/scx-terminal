<!--
  @description 设置·工作流页：主从管理（左列表 + 右只读详情）。所有写操作（新建/
              派生/编辑）统一经 WorkflowFormDialog 完整表单弹窗完成；点击列表仅
              展示详情（内置只读卡片 / 用户工作流详情卡片）。步骤可引用快捷命令或
              内联 raw 命令，支持等待策略与输出捕获（弹窗内编辑）；YAML 导入导出
              （导出解引用快捷命令为内联命令，导入一律新 id）。
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { nanoid } from 'nanoid'
import { useI18n } from 'vue-i18n'
import { Copy, Download, EyeOff, Pencil, Plus, RotateCcw, Trash2, Upload } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import Label from '@/components/ui/Label.vue'
import { useConfigStore, type Workflow, type WorkflowStep } from '@/stores/config'
import { previewWorkflow, stepCommandTemplate, collectWorkflowParams } from '@/lib/workflows'
import { previewQuickCommand } from '@/lib/quickCommands'
import {
    BUILTIN_WORKFLOW_ID_PREFIX, builtinCatalog, builtinSlugFromName, hideBuiltinWorkflow,
    isBuiltinId, resetBuiltinWorkflows, visibleBuiltinWorkflows, visibleWorkflows,
} from '@/lib/builtinWorkflows'
import { buildImportedWorkflow, WorkflowYamlError } from '@/lib/workflowYaml'
import { confirmAction } from '@/components/settings/useConfirmAction'
import { exportAllWorkflowsToFile, exportBuiltinsToFile, exportWorkflowToFile, importWorkflowsFromFile, type ImportedWorkflowDoc } from '@/services/workflowYamlIo'
import WorkflowFormDialog from '@/components/settings/pages/WorkflowFormDialog.vue'

const { t } = useI18n()
const config = useConfigStore()
const store = config.store

/**
 * @description 构造一条空白工作流（新建弹窗初始值）
 * @returns Workflow 空白工作流
 *
 * @example makeBlankWorkflow()
 *
 */
function makeBlankWorkflow (): Workflow {
    return {
        id: `wf-${nanoid(8)}`,
        name: '',
        description: '',
        execution: 'joined',
        stepIntervalMs: 500,
        steps: [],
        stopOnError: true,
    }
}

/**
 * @description 深拷贝工作流（JSON 往返）：store 列表中的对象是 reactive 代理，
 *              structuredClone 会抛 DataCloneError，故用 JSON 克隆（工作流为纯数据）
 * @param workflow 目标工作流
 * @returns Workflow 独立副本
 *
 * @example deepCloneWorkflow(selectedWorkflow)
 *
 */
function deepCloneWorkflow (workflow: Workflow): Workflow {
    return JSON.parse(JSON.stringify(workflow)) as Workflow
}

/**
 * @description 步骤单行预览（引用解析为快捷命令文本后截断；悬空引用显示占位提示）
 * @param step 目标步骤
 * @returns string 预览文本
 *
 * @example stepPreviewText(step)
 *
 */
function stepPreviewText (step: WorkflowStep): string {    const template = stepCommandTemplate(step, store.quickCommands)
    return template === null ? t('settings.workflowStepDangling') : previewQuickCommand(template)
}

/**
 * @description 选中工作流检测到的占位参数名列表（模板用）
 * @param workflow 目标工作流
 * @returns string[] 参数名列表
 *
 * @example selectedParamNames(workflow)
 *
 */
function selectedParamNames (workflow: Workflow): string[] {
    return collectWorkflowParams(workflow.steps, store.quickCommands)
}

/** 可见工作流全集（可见内置在前 + 用户工作流在后）：列表/选中统一数据源 */
const allWorkflows = computed(() => visibleWorkflows(store))

/** 可见内置目录（隐藏清单已过滤） */
const visibleBuiltins = computed(() => visibleBuiltinWorkflows(store))

/** 被隐藏的内置数量（> 0 时展示重置入口） */
const hiddenBuiltinCount = computed(() => builtinCatalog(store).length - visibleBuiltins.value.length)

const selectedWorkflowId = ref<string | null>(null)
const selectedWorkflow = computed(() =>
    allWorkflows.value.find(workflow => workflow.id === selectedWorkflowId.value)
    ?? allWorkflows.value[0]
    ?? null)

/** 当前选中是否为内置项 */
const isBuiltinSelected = computed(() => isBuiltinId(selectedWorkflow.value?.id ?? ''))

/**
 * @description 选中左侧列表工作流（只读详情，编辑经弹窗）
 * @param workflow 目标工作流（内置或用户）
 * @returns void
 *
 * @example selectWorkflow(workflow)
 *
 */
function selectWorkflow (workflow: Workflow): void {
    selectedWorkflowId.value = workflow.id
}

// ---- 完整表单弹窗（新建 / 派生 / 编辑共用） ----

/** 表单弹窗开合 */
const isFormOpen = ref(false)

/** 弹窗标题（新建/派生副本/编辑） */
const formTitle = ref('')

/** 弹窗初始工作流（弹窗内编辑其副本；仅在弹窗打开时读取） */
const formInitial = ref<Workflow>(makeBlankWorkflow())

/** 弹窗是否为新工作流模式（决定提交时入库方式） */
const formIsNew = ref(false)

/** 派生来源（内置项）；null = 非派生模式 */
const deriveSource = ref<Workflow | null>(null)

/**
 * @description 打开新建弹窗：以空白工作流为初始值
 * @returns void
 *
 * @example openCreateDialog()
 *
 */
function openCreateDialog (): void {
    deriveSource.value = null
    formInitial.value = makeBlankWorkflow()
    formIsNew.value = true
    formTitle.value = t('settings.workflowNew')
    isFormOpen.value = true
}

/**
 * @description 打开派生弹窗：克隆内置项（换新 id/step id）预填，确认后入库并把
 *              来源隐藏（避免两条同名）
 * @param workflow 目标内置工作流
 * @returns void
 *
 * @example openDeriveDialog(builtin)
 *
 */
function openDeriveDialog (workflow: Workflow): void {
    deriveSource.value = workflow
    const copy: Workflow = {
        ...deepCloneWorkflow(workflow),
        id: `wf-${nanoid(8)}`,
        name: workflow.name,
    }
    copy.steps = copy.steps.map(step => ({ ...step, id: `step-${nanoid(6)}` }))
    formInitial.value = copy
    formIsNew.value = true
    formTitle.value = t('settings.workflowBuiltinDerive')
    isFormOpen.value = true
}

/**
 * @description 打开编辑弹窗：以选中工作流副本为初始值
 * @param workflow 目标用户工作流
 * @returns void
 *
 * @example openEditDialog(workflow)
 *
 */
function openEditDialog (workflow: Workflow): void {
    deriveSource.value = null
    formInitial.value = deepCloneWorkflow(workflow)
    formIsNew.value = false
    formTitle.value = t('settings.workflowEdit')
    isFormOpen.value = true
}

/**
 * @description 表单弹窗提交：新工作流入库（派生时同步隐藏来源内置项），既有工作流
 *              原位覆盖；完成后选中目标项
 * @param draft 弹窗回传的草稿（已通过 validateWorkflowV2 校验）
 * @returns void
 *
 * @example onFormSubmit(draft)
 *
 */
function onFormSubmit (draft: Workflow): void {
    if (formIsNew.value) {
        const workflow: Workflow = { ...draft }
        workflow.name = workflow.name || `${t('settings.workflows')} ${store.workflows.length + 1}`
        store.workflows.push(workflow)
        if (deriveSource.value) {
            hideBuiltinWorkflow(store, deriveSource.value.id)
        }
        selectedWorkflowId.value = workflow.id
    } else {
        const target = store.workflows.find(workflow => workflow.id === draft.id)
        if (target) {
            Object.assign(target, draft)
        }
        selectedWorkflowId.value = draft.id
    }
    deriveSource.value = null
}

/**
 * @description 删除工作流；删除的是选中项时选中态收敛到剩余第一项
 * @param id 工作流 id
 * @returns void
 *
 * @example deleteWorkflow('wf-abc123')
 *
 */
function deleteWorkflow (id: string): void {
    const index = store.workflows.findIndex(workflow => workflow.id === id)
    if (index === -1) {
        return
    }
    store.workflows.splice(index, 1)
    if (selectedWorkflowId.value === id) {
        selectedWorkflowId.value = store.workflows[0]?.id ?? null
    }
}

/**
 * @description 删除工作流（经确认弹窗；未命名时以步骤预览为名）
 * @param workflow 目标工作流
 * @returns void
 *
 */
function confirmDeleteWorkflow (workflow: Workflow): void {
    const name = workflow.name || previewWorkflow(workflow, store.quickCommands)
    confirmAction(t('settings.deleteConfirmBody', { name }), () => deleteWorkflow(workflow.id))
}

// ---- 内置工作流控制（只读 + 派生弹窗 + 隐藏/重置） ----

/**
 * @description 隐藏（内置「删除」）内置工作流：记入隐藏清单，可随时重置恢复
 * @param workflow 目标内置工作流
 * @returns void
 *
 */
function confirmHideBuiltin (workflow: Workflow): void {
    confirmAction(t('settings.workflowBuiltinHideBody', { name: workflow.name }), () => {
        hideBuiltinWorkflow(store, workflow.id)
        if (selectedWorkflowId.value === workflow.id) {
            selectedWorkflowId.value = store.workflows[0]?.id ?? null
        }
    })
}

/**
 * @description 重置内置目录：清空隐藏清单，全部内置恢复展示（扩展包保留）
 * @returns void
 *
 */
function confirmResetBuiltins (): void {
    confirmAction(t('settings.workflowBuiltinResetBody', { count: hiddenBuiltinCount.value }), () => {
        resetBuiltinWorkflows(store)
    })
}

// ---- YAML 导入导出 ----

/** 页面内 notice：成功/警告（绿）/错误（红）；空串 = 无 */
const ioNotice = ref('')
const ioError = ref('')

function resetIoMessages (): void {
    ioNotice.value = ''
    ioError.value = ''
}

/**
 * @description 导出当前选中（已保存）的工作流为 YAML：保存对话框 → 写文件；
 *              悬空引用步骤被丢弃时附警告
 * @returns Promise<void>
 *
 * @example void exportSelectedWorkflow()
 *
 */
async function exportSelectedWorkflow (): Promise<void> {
    const workflow = selectedWorkflow.value
    if (!workflow) {
        return
    }
    resetIoMessages()
    try {
        const result = await exportWorkflowToFile(workflow, store.quickCommands)
        if (!result) {
            return
        }
        ioNotice.value = result.droppedSteps > 0
            ? t('settings.workflowExportDropped', { count: result.droppedSteps })
            : t('settings.workflowExportDone')
    } catch (error) {
        ioError.value = t('settings.workflowExportFailed', { message: String(error) })
    }
}

/**
 * @description 导出全部工作流为多文档 YAML（无工作流时 no-op）
 * @returns Promise<void>
 *
 * @example void exportAllWorkflows()
 *
 */
async function exportAllWorkflows (): Promise<void> {
    if (!store.workflows.length) {
        return
    }
    resetIoMessages()
    try {
        const result = await exportAllWorkflowsToFile(store.workflows, store.quickCommands)
        if (!result) {
            return
        }
        ioNotice.value = result.droppedSteps > 0
            ? t('settings.workflowExportDropped', { count: result.droppedSteps })
            : t('settings.workflowExportDone')
    } catch (error) {
        ioError.value = t('settings.workflowExportFailed', { message: String(error) })
    }
}

/**
 * @description 导出内置目录（随包 + 扩展包）为多文档 YAML：附 scope/id/hidden 元数据，
 *              可再导入恢复或同步到其他设备（无内置时 no-op）
 * @returns Promise<void>
 *
 * @example void exportBuiltins()
 *
 */
async function exportBuiltins (): Promise<void> {
    if (!builtinCatalog(store).length) {
        return
    }
    resetIoMessages()
    try {
        const result = await exportBuiltinsToFile(builtinCatalog(store), store.workflowCtl.removed)
        if (!result) {
            return
        }
        ioNotice.value = t('settings.workflowExportDone')
    } catch (error) {
        ioError.value = t('settings.workflowExportFailed', { message: String(error) })
    }
}

/**
 * @description 导入的内置文档 upsert 进扩展包：稳定 id（doc id 或名称 slug）+ builtin-
 *              前缀；文档带 hidden 标记时同步进隐藏清单
 * @param docs 内置文档列表
 * @returns void
 *
 */
function upsertBuiltinPackDocs (docs: ImportedWorkflowDoc[]): void {
    for (const doc of docs) {
        const id = `${BUILTIN_WORKFLOW_ID_PREFIX}${doc.workflow.id ?? builtinSlugFromName(doc.workflow.name)}`
        const built = buildImportedWorkflow(doc.workflow, id)
        const index = store.workflowCtl.packs.findIndex(pack => pack.id === id)
        if (index === -1) {
            store.workflowCtl.packs.push(built)
        } else {
            store.workflowCtl.packs.splice(index, 1, built)
        }
        if (doc.hidden) {
            hideBuiltinWorkflow(store, id)
        } else {
            const removedIndex = store.workflowCtl.removed.indexOf(id)
            if (removedIndex !== -1) {
                store.workflowCtl.removed.splice(removedIndex, 1)
            }
        }
    }
}

/**
 * @description 从 YAML 文件导入工作流（bundle 解析按 scope 分流）：user 文档走既有
 *              流程（预览确认 → 新 id 入用户列表）；builtin 文档 upsert 进内置扩展包
 *              并同步 hidden 标记
 * @returns Promise<void>
 *
 * @example void importWorkflows()
 *
 */
async function importWorkflows (): Promise<void> {
    resetIoMessages()
    let docs: ImportedWorkflowDoc[]
    try {
        const result = await importWorkflowsFromFile()
        if (!result) {
            return
        }
        docs = result.docs
    } catch (error) {
        ioError.value = error instanceof WorkflowYamlError
            ? t(`settings.workflowImport${error.code}`)
            : t('settings.workflowImportFailed', { message: String(error) })
        return
    }
    const builtinDocs = docs.filter(doc => doc.scope === 'builtin')
    const userDocs = docs.filter(doc => doc.scope !== 'builtin')
    const importUser = (): void => {
        for (const doc of userDocs) {
            store.workflows.push(buildImportedWorkflow(doc.workflow))
        }
        selectedWorkflowId.value = store.workflows[store.workflows.length - userDocs.length]?.id ?? null
    }
    if (builtinDocs.length) {
        confirmAction(
            t('settings.workflowImportBuiltinConfirmBody', {
                count: builtinDocs.length,
                names: builtinDocs.map(doc => `${doc.workflow.name}（${doc.workflow.steps.length}）`).join('、'),
            }),
            () => {
                upsertBuiltinPackDocs(builtinDocs)
                ioNotice.value = t('settings.workflowImportBuiltinDone', { count: builtinDocs.length })
                if (userDocs.length) {
                    importUser()
                    ioNotice.value = t('settings.workflowImportDone', { count: docs.length })
                }
            })
        return
    }
    const summary = userDocs
        .map(doc => `${doc.workflow.name}（${doc.workflow.steps.length}）`)
        .join('、')
    confirmAction(t('settings.workflowImportConfirmBody', { count: userDocs.length, names: summary }), () => {
        importUser()
        ioNotice.value = t('settings.workflowImportDone', { count: userDocs.length })
    })
}
</script>

<template>
    <div class="settings-page">
    <h2>{{ t('settings.workflows') }}</h2>
    <div class="master-detail">
        <div class="detail-list">
            <div class="profile-new-group">
                <button class="profile-new-button" @click="openCreateDialog">
                    <Plus :size="14" />
                    <span>{{ t('settings.workflowNew') }}</span>
                </button>
                <button class="profile-new-button" @click="void importWorkflows()">
                    <Upload :size="14" />
                    <span>{{ t('settings.workflowImport') }}</span>
                </button>
                <button
                    class="profile-new-button"
                    :disabled="!store.workflows.length"
                    @click="void exportAllWorkflows()"
                >
                    <Download :size="14" />
                    <span>{{ t('settings.workflowExportAll') }}</span>
                </button>
                <button
                    class="profile-new-button"
                    :disabled="!builtinCatalog(store).length"
                    @click="void exportBuiltins()"
                >
                    <Download :size="14" />
                    <span>{{ t('settings.workflowExportBuiltins') }}</span>
                </button>
                <button
                    v-if="hiddenBuiltinCount > 0"
                    class="profile-new-button"
                    @click="confirmResetBuiltins"
                >
                    <RotateCcw :size="14" />
                    <span>{{ t('settings.workflowBuiltinReset', { count: hiddenBuiltinCount }) }}</span>
                </button>
            </div>
            <p v-if="ioNotice" class="hint wf-io-notice">{{ ioNotice }}</p>
            <p v-if="ioError" class="hint wf-validation-error">{{ ioError }}</p>
            <button
                v-for="workflow in allWorkflows"
                :key="workflow.id"
                class="profile-item"
                :class="{ active: workflow.id === selectedWorkflow?.id }"
                @click="selectWorkflow(workflow)"
            >
                <span class="profile-item-head">
                    <span class="profile-item-name">{{ workflow.name || t('settings.workflowUntitled') }}</span>
                    <span v-if="isBuiltinId(workflow.id)" class="wf-builtin-badge">{{ t('settings.workflowBuiltinBadge') }}</span>
                    <span class="wf-mode-badge">{{ workflow.execution === 'joined' ? '&&' : '⇥' }}</span>
                </span>
                <span class="profile-item-command">{{ previewWorkflow(workflow, store.quickCommands) }}</span>
            </button>
            <p v-if="allWorkflows.length === 0" class="hint">
                {{ t('settings.workflowEmptyHint') }}
            </p>
        </div>
        <div v-if="selectedWorkflow" class="detail-content">
            <div class="settings-section">
                <div class="settings-card">
                    <div class="settings-card-row">
                        <Label>{{ t('settings.workflowName') }}</Label>
                        <span class="wf-builtin-name">
                            {{ selectedWorkflow.name || t('settings.workflowUntitled') }}
                            <span v-if="isBuiltinSelected" class="wf-builtin-badge">{{ t('settings.workflowBuiltinBadge') }}</span>
                        </span>
                    </div>
                    <div v-if="selectedWorkflow.description" class="settings-card-row">
                        <Label>{{ t('settings.workflowDescription') }}</Label>
                        <span class="wf-builtin-desc">{{ selectedWorkflow.description }}</span>
                    </div>
                    <div class="settings-card-row">
                        <Label>{{ t('settings.workflowExecution') }}</Label>
                        <span class="wf-builtin-desc">
                            {{ selectedWorkflow.execution === 'joined'
                                ? t('settings.workflowExecutionJoined')
                                : t('settings.workflowExecutionSequential') }}
                        </span>
                    </div>
                    <div class="settings-card-row stacked">
                        <Label>{{ t('settings.workflowSteps') }}</Label>
                        <div v-for="(step, index) in selectedWorkflow.steps" :key="step.id" class="wf-step">
                            <div class="wf-step-head">
                                <span class="wf-step-index">{{ index + 1 }}</span>
                                <span class="wf-step-preview">{{ stepPreviewText(step) }}</span>
                            </div>
                        </div>
                        <p v-if="selectedParamNames(selectedWorkflow).length" class="hint wf-params-hint">
                            {{ t('settings.quickCommandParams', { names: selectedParamNames(selectedWorkflow).join(', ') }) }}
                        </p>
                    </div>
                    <p v-if="isBuiltinSelected" class="hint">{{ t('settings.workflowBuiltinReadonlyHint') }}</p>
                    <div class="settings-card-row actions">
                        <template v-if="isBuiltinSelected">
                            <Button size="sm" @click="openDeriveDialog(selectedWorkflow)">
                                <Copy :size="14" />
                                {{ t('settings.workflowBuiltinDerive') }}
                            </Button>
                            <Button variant="outline" size="sm" @click="void exportSelectedWorkflow()">
                                <Download :size="14" />
                                {{ t('settings.workflowExport') }}
                            </Button>
                            <Button variant="destructive-outline" size="sm" @click="confirmHideBuiltin(selectedWorkflow)">
                                <EyeOff :size="14" />
                                {{ t('settings.workflowBuiltinHide') }}
                            </Button>
                        </template>
                        <template v-else>
                            <Button size="sm" @click="openEditDialog(selectedWorkflow)">
                                <Pencil :size="14" />
                                {{ t('settings.workflowEdit') }}
                            </Button>
                            <Button variant="outline" size="sm" @click="void exportSelectedWorkflow()">
                                <Download :size="14" />
                                {{ t('settings.workflowExport') }}
                            </Button>
                            <Button variant="destructive-outline" size="sm" @click="confirmDeleteWorkflow(selectedWorkflow)">
                                <Trash2 :size="14" />
                                {{ t('settings.workflowDelete') }}
                            </Button>
                        </template>
                    </div>
                </div>
            </div>
        </div>
    </div>
    <WorkflowFormDialog
        v-model:open="isFormOpen"
        :title="formTitle"
        :initial="formInitial"
        :is-new="formIsNew"
        :quick-commands="store.quickCommands"
        @submit="onFormSubmit"
    />
    </div>
</template>

<style scoped>
.wf-builtin-badge {
    flex-shrink: 0;
    padding: 0 4px;
    border-radius: 4px;
    border: 1px solid var(--color-border);
    color: var(--color-muted-foreground);
    font-size: 10px;
    line-height: 14px;
}

.wf-builtin-name {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
}

.wf-builtin-desc {
    font-size: 12px;
    color: var(--color-muted-foreground);
}

.wf-mode-badge {
    flex-shrink: 0;
    padding: 0 4px;
    border-radius: 4px;
    background: var(--color-accent);
    color: var(--color-accent-foreground);
    font-size: 11px;
    font-family: var(--font-mono);
    line-height: 16px;
}

.wf-step {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 5px 8px;
    border: 1px solid var(--color-border);
    border-radius: 6px;
}

.wf-step-head {
    display: flex;
    align-items: center;
    gap: 8px;
}

.wf-step-index {
    flex-shrink: 0;
    width: 18px;
    color: var(--color-muted-foreground);
    font-size: 11px;
    font-family: var(--font-mono);
    text-align: right;
}

.wf-step-preview {
    flex: 1;
    min-width: 0;
    color: var(--color-foreground);
    font-size: 12px;
    font-family: var(--font-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.wf-params-hint {
    margin: -4px 0 8px;
}

.wf-validation-error {
    margin: 0 0 4px;
    color: var(--color-destructive);
}

.wf-io-notice {
    margin: 0 0 4px;
    color: var(--color-primary);
}
</style>
