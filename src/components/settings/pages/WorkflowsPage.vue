<!--
  @description 设置·工作流页：工作流主从管理（扁平列表 + 名称/描述/执行模式/步骤
              编辑器）。步骤可引用快捷命令或内联 raw 命令；二期步骤支持等待策略
              （固定延时/等待输出）与输出捕获（变量注入后续步骤）；编辑器走草稿模式
              （改动经「保存」按钮提交，保存前经 validateWorkflowV2 校验）。
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Select from '@/components/ui/Select.vue'
import Switch from '@/components/ui/Switch.vue'
import { useConfigStore, type Workflow, type WorkflowStep } from '@/stores/config'
import { previewQuickCommand } from '@/lib/quickCommands'
import {
    buildWorkflow, buildWorkflowStep, collectWorkflowParams, previewWorkflow,
    stepCommandTemplate, validateWorkflowV2,
} from '@/lib/workflows'
import { confirmAction } from '@/components/settings/useConfirmAction'
import { useDraftEditor } from '@/components/settings/useDraftEditor'

const { t } = useI18n()
const config = useConfigStore()
const store = config.store

const selectedWorkflowId = ref<string | null>(null)
const selectedWorkflow = computed(() =>
    store.workflows.find(workflow => workflow.id === selectedWorkflowId.value)
    ?? store.workflows[0]
    ?? null)

/** 草稿编辑器：表单只改草稿副本，「保存」时统一提交 store（store 防抖落库不变） */
const workflowEditor = useDraftEditor<Workflow>({
    create: () => buildWorkflow(),
    persist: (draft, isNew) => {
        if (isNew) {
            draft.name = draft.name || `${t('settings.workflows')} ${store.workflows.length + 1}`
            store.workflows.push(draft)
            selectedWorkflowId.value = draft.id
            return
        }
        const target = store.workflows.find(workflow => workflow.id === draft.id)
        if (target) {
            Object.assign(target, draft)
        }
    },
})
const { draft: wfDraft, isNew: isNewWfDraft, dirty: isWfDraftDirty } = workflowEditor

/**
 * @description 把编辑器同步到当前选中项（选中变化/删除后的兜底收敛均走这里）
 * @returns void
 *
 * @example syncEditorToSelection()
 *
 */
function syncEditorToSelection (): void {
    if (selectedWorkflow.value) {
        workflowEditor.edit(selectedWorkflow.value)
    } else {
        workflowEditor.clear()
    }
}

watch(selectedWorkflow, syncEditorToSelection, { immediate: true })

/**
 * @description 选中左侧列表工作流（有未保存修改时经确认弹窗放行）
 * @param workflow 目标工作流
 * @returns void
 *
 * @example selectWorkflow(workflow)
 *
 */
function selectWorkflow (workflow: Workflow): void {
    workflowEditor.guard(t('settings.unsavedChangesBody'), () => {
        if (workflow.id !== selectedWorkflowId.value) {
            selectedWorkflowId.value = workflow.id
        } else {
            // 新建草稿打开时点回当前选中项：直接回到该工作流
            workflowEditor.edit(workflow)
        }
    }, t('settings.unsavedChangesDiscard'), t('settings.unsavedChangesTitle'))
}

/** 步骤引用下拉：现有快捷命令 */
const quickCommandOptions = computed(() =>
    store.quickCommands.map(command => ({
        value: command.id,
        label: command.name || previewQuickCommand(command.command),
    })))

/** 新增步骤的引用选择值 */
const newStepQuickCommandId = ref('')

/** 新增 raw 步骤的命令文本 */
const newStepCommand = ref('')

/** 执行模式下拉选项 */
const executionOptions = computed(() => [
    { value: 'joined', label: t('settings.workflowExecutionJoined') },
    { value: 'sequential', label: t('settings.workflowExecutionSequential') },
])

const executionModel = computed({
    get: () => wfDraft.value?.execution ?? 'joined',
    set: (value: string) => {
        const workflow = wfDraft.value
        if (workflow) {
            workflow.execution = value === 'sequential' ? 'sequential' : 'joined'
        }
    },
})

/** 编辑器底部实时提示：当前步骤集检测到的占位参数 */
const draftParams = computed(() =>
    wfDraft.value ? collectWorkflowParams(wfDraft.value.steps, store.quickCommands) : [])

/**
 * @description 步骤单行预览（引用解析为快捷命令文本后截断；悬空引用显示占位提示）
 * @param step 目标步骤
 * @returns string 预览文本
 *
 * @example stepPreview(step)
 *
 */
function stepPreview (step: WorkflowStep): string {
    const template = stepCommandTemplate(step, store.quickCommands)
    return template === null ? t('settings.workflowStepDangling') : previewQuickCommand(template)
}

/**
 * @description 新建工作流：打开全新草稿编辑器（有未保存修改时经确认放行），
 *              点「保存」后才进入列表并持久化
 * @returns void
 *
 * @example createWorkflow() // 编辑器切换为未保存的新工作流草稿
 *
 */
function createWorkflow (): void {
    workflowEditor.guard(t('settings.unsavedChangesBody'), workflowEditor.createNew, t('settings.unsavedChangesDiscard'), t('settings.unsavedChangesTitle'))
}

/**
 * @description 添加一个引用快捷命令的步骤
 * @returns void
 *
 * @example addQuickCommandStep()
 *
 */
function addQuickCommandStep (): void {
    const id = newStepQuickCommandId.value
    const workflow = wfDraft.value
    if (!workflow || !id || !store.quickCommands.some(command => command.id === id)) {
        return
    }
    workflow.steps.push(buildWorkflowStep('quickCommand', id))
    newStepQuickCommandId.value = ''
}

/**
 * @description 添加一个内联命令步骤
 * @returns void
 *
 * @example addRawStep()
 *
 */
function addRawStep (): void {
    const workflow = wfDraft.value
    const command = newStepCommand.value.trim()
    if (!workflow || !command) {
        return
    }
    workflow.steps.push(buildWorkflowStep('raw', command))
    newStepCommand.value = ''
}

/**
 * @description 上移/下移步骤（越界 no-op）
 * @param index 步骤下标
 * @param offset 移动量（-1 上移 / 1 下移）
 * @returns void
 *
 * @example moveStep(0, 1)
 *
 */
function moveStep (index: number, offset: number): void {
    const workflow = wfDraft.value
    if (!workflow) {
        return
    }
    const target = index + offset
    if (target < 0 || target >= workflow.steps.length) {
        return
    }
    const [step] = workflow.steps.splice(index, 1)
    workflow.steps.splice(target, 0, step)
}

/**
 * @description 删除步骤
 * @param index 步骤下标
 * @returns void
 *
 * @example removeStep(0)
 *
 */
function removeStep (index: number): void {
    const step = wfDraft.value?.steps[index]
    if (step) {
        expandedStepIds.value.delete(step.id)
    }
    wfDraft.value?.steps.splice(index, 1)
}

// ---- 步骤高级配置（二期：等待策略 / 输出捕获） ----

/** 展开高级配置的步骤 id 集合 */
const expandedStepIds = ref(new Set<string>())

/**
 * @description 切换步骤高级配置折叠态
 * @param step 目标步骤
 * @returns void
 *
 * @example toggleStepAdvanced(step)
 *
 */
function toggleStepAdvanced (step: WorkflowStep): void {
    if (expandedStepIds.value.has(step.id)) {
        expandedStepIds.value.delete(step.id)
    } else {
        expandedStepIds.value.add(step.id)
    }
}

/** 等待策略下拉选项（'' = 默认延时） */
const waitKindOptions = computed(() => [
    { value: '', label: t('settings.workflowWaitDefault') },
    { value: 'fixed', label: t('settings.workflowWaitFixed') },
    { value: 'expect', label: t('settings.workflowWaitExpect') },
])

/** 超时策略下拉选项 */
const onTimeoutOptions = computed(() => [
    { value: 'abort', label: t('settings.workflowOnTimeoutAbort') },
    { value: 'continue', label: t('settings.workflowOnTimeoutContinue') },
])

/**
 * @description 步骤等待策略下拉的 model 工厂（每步一个 model）
 * @param step 目标步骤
 * @returns { get, set } 等待 kind 的读写 model（'' = 未配置）
 *
 * @example :model="stepWaitModel(step)"
 *
 */
function stepWaitModel (step: WorkflowStep) {
    return {
        get: () => step.wait?.kind ?? '',
        set: (value: string) => {
            if (value === '') {
                delete step.wait
                return
            }
            if (value === 'fixed') {
                step.wait = { kind: 'fixed', ms: 500 }
            } else {
                step.wait = { timeoutMs: 5000, onTimeout: 'abort', kind: 'expect' }
            }
        },
    }
}

/**
 * @description 启用/清除步骤输出捕获
 * @param step 目标步骤
 * @param enabled 是否启用
 * @returns void
 *
 * @example setStepCapture(step, true)
 *
 */
function setStepCapture (step: WorkflowStep, enabled: boolean): void {
    if (enabled) {
        step.capture = step.capture ?? { var: '' }
    } else {
        delete step.capture
    }
}

/** 保存前校验错误（翻译后的文案列表；空 = 通过） */
const draftValidationErrors = computed(() => {
    if (!wfDraft.value) {
        return []
    }
    return validateWorkflowV2(wfDraft.value).map(error =>
        t(`settings.workflowValidation.${error.code}`, { step: error.stepIndex + 1 }))
})

/**
 * @description 保存当前草稿：二期校验通过才提交（错误展示在编辑器底部）
 * @returns void
 *
 * @example saveWorkflowDraft()
 *
 */
function saveWorkflowDraft (): void {
    if (draftValidationErrors.value.length) {
        return
    }
    workflowEditor.save()
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
    syncEditorToSelection()
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
</script>

<template>
    <div class="settings-page">
    <h2>{{ t('settings.workflows') }}</h2>
    <div class="master-detail">
        <div class="detail-list">
            <div class="profile-new-group">
                <button class="profile-new-button" @click="createWorkflow">
                    <Plus :size="14" />
                    <span>{{ t('settings.workflowNew') }}</span>
                </button>
            </div>
            <button
                v-for="workflow in store.workflows"
                :key="workflow.id"
                class="profile-item"
                :class="{ active: workflow.id === wfDraft?.id }"
                @click="selectWorkflow(workflow)"
            >
                <span class="profile-item-head">
                    <span class="profile-item-name">{{ workflow.name || t('settings.workflowUntitled') }}</span>
                    <span class="wf-mode-badge">{{ workflow.execution === 'joined' ? '&&' : '⇥' }}</span>
                </span>
                <span class="profile-item-command">{{ previewWorkflow(workflow, store.quickCommands) }}</span>
            </button>
            <p v-if="store.workflows.length === 0" class="hint">
                {{ t('settings.workflowEmptyHint') }}
            </p>
        </div>
        <div v-if="wfDraft" class="detail-content">
            <div class="settings-section">
                <div class="settings-card">
                    <div class="settings-card-row">
                        <Label>{{ t('settings.workflowName') }}</Label>
                        <Input v-model="wfDraft.name" class="w-60" />
                    </div>
                    <div class="settings-card-row">
                        <Label>{{ t('settings.workflowDescription') }}</Label>
                        <Input
                            v-model="wfDraft.description"
                            class="w-60"
                            :placeholder="t('settings.workflowDescriptionPlaceholder')"
                        />
                    </div>
                    <div class="settings-card-row">
                        <Label>
                            {{ t('settings.workflowExecution') }}
                            <span class="value-hint">{{ t('settings.workflowExecutionHint') }}</span>
                        </Label>
                        <Select v-model="executionModel" :options="executionOptions" class="w-60" />
                    </div>
                    <div v-if="wfDraft.execution === 'sequential'" class="settings-card-row">
                        <Label>
                            {{ t('settings.workflowStepInterval') }}
                            <span class="value-hint">{{ t('settings.workflowStepIntervalHint') }}</span>
                        </Label>
                        <Input
                            v-model.number="wfDraft.stepIntervalMs"
                            type="number"
                            min="0"
                            step="100"
                            class="w-60"
                        />
                    </div>
                    <div class="settings-card-row stacked">
                        <Label>
                            {{ t('settings.workflowSteps') }}
                            <span class="value-hint">{{ t('settings.workflowStepsHint') }}</span>
                        </Label>
                        <div v-for="(step, index) in wfDraft.steps" :key="step.id" class="wf-step">
                            <div class="wf-step-head">
                                <span class="wf-step-index">{{ index + 1 }}</span>
                                <span class="wf-step-preview">{{ stepPreview(step) }}</span>
                                <span class="wf-step-actions">
                                    <button
                                        class="wf-step-button"
                                        :class="{ active: expandedStepIds.has(step.id) }"
                                        :title="t('settings.workflowStepAdvanced')"
                                        @click="toggleStepAdvanced(step)"
                                    >
                                        <component :is="expandedStepIds.has(step.id) ? ChevronDown : ChevronRight" :size="13" />
                                    </button>
                                    <button class="wf-step-button" :title="t('settings.groupMoveUp')" :disabled="index === 0" @click="moveStep(index, -1)">
                                        <ArrowUp :size="13" />
                                    </button>
                                    <button class="wf-step-button" :title="t('settings.groupMoveDown')" :disabled="index === wfDraft.steps.length - 1" @click="moveStep(index, 1)">
                                        <ArrowDown :size="13" />
                                    </button>
                                    <button class="wf-step-button wf-step-remove" :title="t('settings.workflowStepRemove')" @click="removeStep(index)">
                                        <Trash2 :size="13" />
                                    </button>
                                </span>
                            </div>
                            <div v-if="expandedStepIds.has(step.id)" class="wf-step-advanced">
                                <div class="wf-step-advanced-row" v-if="wfDraft.execution === 'sequential'">
                                    <Label>
                                        {{ t('settings.workflowWaitLabel') }}
                                        <span class="value-hint">{{ t('settings.workflowWaitHint') }}</span>
                                    </Label>
                                    <Select :model="stepWaitModel(step)" :options="waitKindOptions" class="wf-advanced-select" />
                                </div>
                                <p v-else class="hint">{{ t('settings.workflowWaitJoinedHint') }}</p>
                                <template v-if="step.wait?.kind === 'fixed'">
                                    <div class="wf-step-advanced-row">
                                        <Label>{{ t('settings.workflowWaitFixedMs') }}</Label>
                                        <Input v-model.number="step.wait.ms" type="number" min="0" step="100" class="wf-advanced-input" />
                                    </div>
                                </template>
                                <template v-if="step.wait?.kind === 'expect'">
                                    <div class="wf-step-advanced-row">
                                        <Label>
                                            {{ t('settings.workflowWaitPattern') }}
                                            <span class="value-hint">{{ t('settings.workflowWaitPatternHint') }}</span>
                                        </Label>
                                        <Input v-model="step.wait.pattern" class="wf-advanced-input" :placeholder="t('settings.workflowWaitPatternPlaceholder')" />
                                    </div>
                                    <div class="wf-step-advanced-row">
                                        <Label>{{ t('settings.workflowWaitTimeout') }}</Label>
                                        <Input v-model.number="step.wait.timeoutMs" type="number" min="100" step="500" class="wf-advanced-input" />
                                    </div>
                                    <div class="wf-step-advanced-row">
                                        <Label>{{ t('settings.workflowOnTimeout') }}</Label>
                                        <Select v-model="step.wait.onTimeout" :options="onTimeoutOptions" class="wf-advanced-select" />
                                    </div>
                                </template>
                                <div class="wf-step-advanced-row">
                                    <Label>
                                        {{ t('settings.workflowCaptureLabel') }}
                                        <span class="value-hint">{{ t('settings.workflowCaptureHint') }}</span>
                                    </Label>
                                    <Switch :model-value="!!step.capture" @update:model-value="(v: boolean) => setStepCapture(step, v)" />
                                </div>
                                <template v-if="step.capture">
                                    <div class="wf-step-advanced-row">
                                        <Label>{{ t('settings.workflowCaptureVar') }}</Label>
                                        <Input v-model="step.capture.var" class="wf-advanced-input" placeholder="version" />
                                    </div>
                                    <div class="wf-step-advanced-row">
                                        <Label>
                                            {{ t('settings.workflowCapturePattern') }}
                                            <span class="value-hint">{{ t('settings.workflowCapturePatternHint') }}</span>
                                        </Label>
                                        <Input v-model="step.capture.pattern" class="wf-advanced-input" placeholder="version (\S+)" />
                                    </div>
                                </template>
                            </div>
                        </div>
                        <div class="wf-step-add">
                            <Select
                                v-model="newStepQuickCommandId"
                                :options="[{ value: '', label: t('settings.workflowStepPickQuickCommand') }, ...quickCommandOptions]"
                                class="wf-step-add-select"
                            />
                            <Button size="sm" variant="outline" :disabled="!newStepQuickCommandId" @click="addQuickCommandStep">
                                <Plus :size="13" />
                                {{ t('settings.workflowStepAddQuickCommand') }}
                            </Button>
                        </div>
                        <div class="wf-step-add">
                            <textarea
                                v-model="newStepCommand"
                                class="wf-command-input"
                                rows="2"
                                spellcheck="false"
                                :placeholder="t('settings.workflowStepRawPlaceholder')"
                            ></textarea>
                            <Button size="sm" variant="outline" :disabled="!newStepCommand.trim()" @click="addRawStep">
                                <Plus :size="13" />
                                {{ t('settings.workflowStepAddRaw') }}
                            </Button>
                        </div>
                        <p v-if="draftParams.length" class="hint wf-params-hint">
                            {{ t('settings.quickCommandParams', { names: draftParams.join(', ') }) }}
                        </p>
                        <p v-for="error in draftValidationErrors" :key="error" class="hint wf-validation-error">
                            {{ error }}
                        </p>
                    </div>
                    <div class="settings-card-row">
                        <Label>
                            {{ t('settings.workflowStopOnError') }}
                            <span class="value-hint">{{ t('settings.workflowStopOnErrorHint') }}</span>
                        </Label>
                        <Switch v-model="wfDraft.stopOnError" />
                    </div>
                    <div class="settings-card-row actions">
                        <Button size="sm" :disabled="!isWfDraftDirty" @click="saveWorkflowDraft">
                            {{ t('settings.profileSave') }}
                        </Button>
                        <Button
                            v-if="isWfDraftDirty || isNewWfDraft"
                            variant="outline"
                            size="sm"
                            @click="isNewWfDraft ? syncEditorToSelection() : workflowEditor.discard()"
                        >
                            {{ t('settings.cancel') }}
                        </Button>
                        <Button v-if="!isNewWfDraft" variant="destructive-outline" size="sm" @click="confirmDeleteWorkflow(wfDraft)">
                            <Trash2 :size="14" />
                            {{ t('settings.workflowDelete') }}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    </div>
    </div>
</template>

<style scoped>
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

.wf-step-button.active {
    color: var(--color-primary);
}

.wf-step-advanced {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 4px 4px 26px;
    border-top: 1px dashed var(--color-border);
}

.wf-step-advanced-row {
    display: flex;
    align-items: center;
    gap: 10px;
}

.wf-step-advanced-row > :first-child {
    flex-shrink: 0;
    width: 200px;
}

.wf-advanced-select,
.wf-advanced-input {
    width: 240px;
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

.wf-step-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
}

.wf-step-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    color: var(--color-muted-foreground);
    cursor: pointer;
}

.wf-step-button:hover:not(:disabled) {
    border-color: var(--color-border);
    color: var(--color-foreground);
}

.wf-step-button:disabled {
    opacity: 0.4;
    cursor: default;
}

.wf-step-remove:hover:not(:disabled) {
    color: var(--color-destructive);
}

.wf-step-add {
    display: flex;
    align-items: flex-start;
    gap: 8px;
}

.wf-step-add-select {
    flex: 1;
    min-width: 0;
}

.wf-command-input {
    flex: 1;
    min-width: 0;
    padding: 6px 8px;
    border: 1px solid var(--color-input);
    border-radius: 6px;
    background: transparent;
    color: var(--color-foreground);
    font-family: var(--font-mono);
    font-size: 12px;
    resize: vertical;
    outline: none;
}

.wf-command-input:focus-visible {
    border-color: var(--color-ring);
    box-shadow: 0 0 0 1px var(--color-ring);
}

.wf-params-hint {
    margin: -4px 0 8px;
}

.wf-validation-error {
    margin: 0 0 4px;
    color: var(--color-destructive);
}
</style>
