<!--
  @description 工作流完整表单弹窗（新建/派生/编辑共用）：名称、描述、执行模式、步间
                延时、步骤编辑器（引用快捷命令/内联命令、排序、等待策略、输出捕获）、
                出错中止开关。表单编辑弹窗内草稿副本（store 不实时写入）；取消时若有
                修改经确认弹窗放行；保存前经 validateWorkflowV2 校验（错误内联展示），
                通过后经 submit 事件回传草稿，由调用方写回 store。
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Select from '@/components/ui/Select.vue'
import Switch from '@/components/ui/Switch.vue'
import type { QuickCommand, Workflow, WorkflowStep } from '@/stores/config'
import { previewQuickCommand } from '@/lib/quickCommands'
import {
    buildWorkflowStep, collectWorkflowParams, stepCommandTemplate, validateWorkflowV2,
} from '@/lib/workflows'
import { confirmAction } from '@/components/settings/useConfirmAction'

const props = defineProps<{
    /** 弹窗开合（v-model:open） */
    open: boolean
    /** 弹窗标题（新建/派生/编辑按调用方传入） */
    title: string
    /** 打开时的初始工作流（弹窗内编辑其副本；调用方保证 id 唯一） */
    initial: Workflow
    /** 是否为新工作流（影响调用方入库方式，弹窗内仅透传回传） */
    isNew?: boolean
    /** 现有快捷命令（步骤引用下拉与预览解析） */
    quickCommands: QuickCommand[]
}>()

const emit = defineEmits<{
    (e: 'update:open', open: boolean): void
    (e: 'submit', draft: Workflow): void
}>()

const { t } = useI18n()

/**
 * @description 深拷贝工作流（JSON 往返）：store/ref 中的对象是 reactive 代理，
 *              structuredClone 会抛 DataCloneError，故用 JSON 克隆（工作流为纯数据）
 * @param workflow 目标工作流
 * @returns Workflow 独立副本
 *
 * @example deepCloneWorkflow(props.initial)
 *
 */
function deepCloneWorkflow (workflow: Workflow): Workflow {
    return JSON.parse(JSON.stringify(workflow)) as Workflow
}

/** 弹窗内草稿：打开时深拷贝 initial，保存时整体回传 */
const draft = ref<Workflow>(deepCloneWorkflow(props.initial))

/** 快捷命令引用（页面传入，供步骤下拉与预览解析） */
const quickCommands = computed(() => props.quickCommands)

/** 新增步骤的引用选择值 */
const newStepQuickCommandId = ref('')

/** 新增 raw 步骤的命令文本 */
const newStepCommand = ref('')

/** 展开高级配置的步骤 id 集合 */
const expandedStepIds = ref(new Set<string>())

/** 打开时重置弹内状态（草稿副本、步骤展开态、新增输入） */
watch(() => props.open, open => {
    if (!open) {
        return
    }
    draft.value = deepCloneWorkflow(props.initial)
    expandedStepIds.value = new Set()
    newStepQuickCommandId.value = ''
    newStepCommand.value = ''
})

/** 执行模式下拉选项 */
const executionOptions = [
    { value: 'joined', label: t('settings.workflowExecutionJoined') },
    { value: 'sequential', label: t('settings.workflowExecutionSequential') },
]

/** 执行模式读写 model */
const executionModel = computed({
    get: () => draft.value.execution,
    set: (value: string) => {
        draft.value.execution = value === 'sequential' ? 'sequential' : 'joined'
    },
})

/** 步骤引用下拉：现有快捷命令 */
const quickCommandOptions = computed(() =>
    quickCommands.value.map(command => ({
        value: command.id,
        label: command.name || previewQuickCommand(command.command),
    })))

/** 步骤编辑器实时提示：当前步骤集检测到的占位参数 */
const draftParams = computed(() => collectWorkflowParams(draft.value.steps, quickCommands.value))

/** 保存前校验错误（翻译后的文案列表；空 = 通过） */
const draftValidationErrors = computed(() =>
    validateWorkflowV2(draft.value).map(error =>
        t(`settings.workflowValidation.${error.code}`, { step: error.stepIndex + 1 })))

/** 脏状态：与 initial 的 JSON 副本比较（弹内克隆，键序一致，直接比较即可） */
const isDirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(props.initial))

/**
 * @description 步骤单行预览（引用解析为快捷命令文本后截断；悬空引用显示占位提示）
 * @param step 目标步骤
 * @returns string 预览文本
 *
 * @example stepPreview(step)
 *
 */
function stepPreview (step: WorkflowStep): string {
    const template = stepCommandTemplate(step, quickCommands.value)
    return template === null ? t('settings.workflowStepDangling') : previewQuickCommand(template)
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
    if (!id || !quickCommands.value.some(command => command.id === id)) {
        return
    }
    draft.value.steps.push(buildWorkflowStep('quickCommand', id))
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
    const command = newStepCommand.value.trim()
    if (!command) {
        return
    }
    draft.value.steps.push(buildWorkflowStep('raw', command))
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
    const target = index + offset
    if (target < 0 || target >= draft.value.steps.length) {
        return
    }
    const [step] = draft.value.steps.splice(index, 1)
    draft.value.steps.splice(target, 0, step)
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
    const step = draft.value.steps[index]
    if (step) {
        expandedStepIds.value.delete(step.id)
    }
    draft.value.steps.splice(index, 1)
}

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

function cancel (): void {
    const close = (): void => emit('update:open', false)
    if (!isDirty.value) {
        close()
        return
    }
    confirmAction(t('settings.unsavedChangesBody'), close, t('settings.unsavedChangesDiscard'), t('settings.unsavedChangesTitle'))
}

/**
 * @description 提交表单：校验通过才回传草稿副本并关闭
 * @returns void
 *
 */
function commit (): void {
    if (draftValidationErrors.value.length) {
        return
    }
    emit('update:open', false)
    emit('submit', deepCloneWorkflow(draft.value))
}
</script>

<template>
    <Dialog v-if="props.open" :title="props.title" :width="640" @cancel="cancel">
        <div class="workflow-form">
            <div class="form-row">
                <Label>{{ t('settings.workflowName') }}</Label>
                <Input v-model="draft.name" class="flex-1" :placeholder="t('settings.workflowUntitled')" />
            </div>
            <div class="form-row">
                <Label>{{ t('settings.workflowDescription') }}</Label>
                <Input
                    v-model="draft.description"
                    class="flex-1"
                    :placeholder="t('settings.workflowDescriptionPlaceholder')"
                />
            </div>
            <div class="form-row">
                <Label>
                    {{ t('settings.workflowExecution') }}
                    <span class="value-hint">{{ t('settings.workflowExecutionHint') }}</span>
                </Label>
                <Select v-model="executionModel" :options="executionOptions" class="flex-1" />
            </div>
            <div v-if="draft.execution === 'sequential'" class="form-row">
                <Label>
                    {{ t('settings.workflowStepInterval') }}
                    <span class="value-hint">{{ t('settings.workflowStepIntervalHint') }}</span>
                </Label>
                <Input v-model.number="draft.stepIntervalMs" type="number" min="0" step="100" class="flex-1" />
            </div>
            <div class="form-row stacked">
                <Label>
                    {{ t('settings.workflowSteps') }}
                    <span class="value-hint">{{ t('settings.workflowStepsHint') }}</span>
                </Label>
                <div v-for="(step, index) in draft.steps" :key="step.id" class="wf-step">
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
                            <button class="wf-step-button" :title="t('settings.groupMoveDown')" :disabled="index === draft.steps.length - 1" @click="moveStep(index, 1)">
                                <ArrowDown :size="13" />
                            </button>
                            <button class="wf-step-button wf-step-remove" :title="t('settings.workflowStepRemove')" @click="removeStep(index)">
                                <Trash2 :size="13" />
                            </button>
                        </span>
                    </div>
                    <div v-if="expandedStepIds.has(step.id)" class="wf-step-advanced">
                        <div class="wf-step-advanced-row" v-if="draft.execution === 'sequential'">
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
            <div class="form-row">
                <Label>
                    {{ t('settings.workflowStopOnError') }}
                    <span class="value-hint">{{ t('settings.workflowStopOnErrorHint') }}</span>
                </Label>
                <Switch v-model="draft.stopOnError" />
            </div>
        </div>
        <template #footer>
            <Button variant="outline" size="sm" @click="cancel">{{ t('settings.cancel') }}</Button>
            <Button size="sm" :disabled="draftValidationErrors.length > 0" @click="commit">
                {{ t('settings.confirm') }}
            </Button>
        </template>
    </Dialog>
</template>

<style scoped>
.workflow-form {
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-height: min(70vh, 640px);
    overflow-y: auto;
    padding-right: 4px;
}

.form-row {
    display: flex;
    align-items: center;
    gap: 12px;
}

.form-row.stacked {
    flex-direction: column;
    align-items: stretch;
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
