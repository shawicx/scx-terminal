<script setup lang="ts">
/**
 * @description 工作流选择器（overlay）：搜索/选中/执行工作流。有占位参数时进入填参态
 *              （默认值取步骤级 paramValues 预设），确认后经 workflowRunService 执行；
 *              二期增加进度态——sequential 运行期间展示当前步骤/耗时/取消，终态短暂
 *              展示后自动关闭。交互骨架克隆自 QuickCommandPalette（扁平列表）。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useConfigStore, type Workflow } from '@/stores/config'
import { useTabsStore } from '@/stores/tabs'
import { closeWorkflowPalette, pendingWorkflowId, workflowPaletteOpen } from '@/services/workflowPalette'
import {
    cancelWorkflowRun, isWorkflowRunning, runWorkflowV2,
    type WorkflowRun,
} from '@/services/workflowRunService'
import { hotkeys } from '@/services/hotkeysSingleton'
import { fuzzyMatch } from '@/lib/utils/fuzzy'
import { collectWorkflowParams, previewWorkflow } from '@/lib/workflows'
import { overlayEnter, overlayExit, moveHighlight } from '@/lib/motion'

const { t } = useI18n()
const config = useConfigStore()
const tabs = useTabsStore()

const query = ref('')
const selectedIndex = ref(0)
const inputEl = ref<HTMLInputElement>()
const listEl = ref<HTMLDivElement>()
const backdropEl = ref<HTMLDivElement>()
const panelEl = ref<HTMLDivElement>()
const highlightEl = ref<HTMLDivElement>()
let exitTween: ReturnType<typeof overlayExit> | null = null
/** 填参态下正在编辑的工作流；null = 选择态 */
const editing = ref<Workflow | null>(null)
const paramValues = ref<Record<string, string>>({})
const firstParamInputEl = ref<HTMLInputElement>()
/** 进度态跟踪的运行记录（registry 内对象的响应式引用）；null = 非进度态 */
const progressRun = ref<WorkflowRun | null>(null)
/** 进度态已结束（短暂展示终态，Esc/点击关闭前为 true） */
const progressSettled = ref(false)
let progressDismissTimer: ReturnType<typeof setTimeout> | null = null

/** 耗时滚动时钟（运行中每秒跳动，驱动 progressElapsed 重算） */
const nowTick = ref(Date.now())
watch(() => progressRun.value?.status === 'running', running => {
    if (running) {
        const timer = setInterval(() => {
            nowTick.value = Date.now()
            if (progressRun.value?.status !== 'running') {
                clearInterval(timer)
            }
        }, 1000)
    }
})

/** 进度态耗时（秒） */
const progressElapsed = computed(() => {
    const run = progressRun.value
    if (!run) {
        return 0
    }
    void nowTick.value
    return Math.round(((run.endedAt ?? nowTick.value) - run.startedAt) / 100) / 10
})

interface VisibleItem {
    workflow: Workflow
    label: string
    preview: string
    /** 描述（可选备注，空串 = 未填写） */
    description: string
}

/** 按搜索词过滤工作流列表（名称/预览/描述模糊匹配；仅保留有可执行步骤的） */
const visibleItems = computed<VisibleItem[]>(() =>
    config.store.workflows
        .filter(workflow => workflow.steps.length > 0)
        .filter(workflow =>
            fuzzyMatch(query.value, workflow.name) !== null ||
            fuzzyMatch(query.value, previewWorkflow(workflow, config.store.quickCommands)) !== null ||
            (workflow.description ? fuzzyMatch(query.value, workflow.description) !== null : false))
        .map(workflow => ({
            workflow,
            label: workflow.name || previewWorkflow(workflow, config.store.quickCommands),
            preview: previewWorkflow(workflow, config.store.quickCommands),
            description: workflow.description ?? '',
        })))

watch(visibleItems, () => {
    selectedIndex.value = 0
    scrollToSelected()
})

/**
 * @description 滚动列表使选中项可见（键盘切换、过滤重置或填参返回后选中项可能在视口外）
 * @returns void
 *
 */
function scrollToSelected (): void {
    requestAnimationFrame(() => {
        listEl.value?.querySelector('.palette-item.selected')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
}

/** 填参态的参数名列表（跨步骤占位符并集） */
const editingParams = computed(() =>
    editing.value ? collectWorkflowParams(editing.value.steps, config.store.quickCommands) : [])

function open (): void {
    hotkeys.disable()
    exitTween?.kill()
    exitTween = null
    const pending = config.store.workflows.find(workflow => workflow.id === pendingWorkflowId.value)
    pendingWorkflowId.value = null
    if (pending) {
        enterFillParams(pending)
    } else {
        void nextTick(() => inputEl.value?.focus())
    }
    void nextTick(() => {
        const backdrop = backdropEl.value
        const panel = panelEl.value
        if (!backdrop || !panel) {
            return
        }
        const items = [...listEl.value?.querySelectorAll('.palette-item') ?? []] as HTMLElement[]
        overlayEnter(backdrop, panel, items)
        positionHighlight(false)
    })
}

function close (): void {
    // 热键恢复统一由 watch(workflowPaletteOpen → false) 负责（双 enable 会使计数器失衡）
    if (exitTween) {
        return
    }
    const backdrop = backdropEl.value
    const panel = panelEl.value
    if (!backdrop || !panel) {
        finishClose()
        return
    }
    exitTween = overlayExit(backdrop, panel)
    void exitTween.then(() => {
        exitTween = null
        finishClose()
    })
}

function finishClose (): void {
    closeWorkflowPalette()
    query.value = ''
    editing.value = null
    paramValues.value = {}
    progressRun.value = null
    progressSettled.value = false
    if (progressDismissTimer) {
        clearTimeout(progressDismissTimer)
        progressDismissTimer = null
    }
}

/**
 * @description 液态高亮滑块就位：移动到当前选中条目（无选中/空列表/填参态隐藏）
 * @param animate false 时瞬时就位（首帧定位用）
 * @returns void
 *
 */
function positionHighlight (animate = true): void {
    const pill = highlightEl.value
    const target = listEl.value?.querySelector('.palette-item.selected') as HTMLElement | null
    if (!pill) {
        return
    }
    pill.style.visibility = target ? 'visible' : 'hidden'
    if (target) {
        moveHighlight(pill, target, animate)
    }
}

watch([selectedIndex, visibleItems], () => {
    positionHighlight()
}, { flush: 'post' })

/**
 * @description 进入填参态：记录工作流并以步骤级 paramValues 预设为默认值初始化，
 *              聚焦第一个输入框
 * @param workflow 目标工作流
 * @returns void
 *
 * @example enterFillParams(workflow)
 *
 */
function enterFillParams (workflow: Workflow): void {
    editing.value = workflow
    const presets: Record<string, string> = {}
    for (const step of workflow.steps) {
        Object.assign(presets, step.paramValues)
    }
    paramValues.value = Object.fromEntries(
        collectWorkflowParams(workflow.steps, config.store.quickCommands).map(name => [name, presets[name] ?? '']))
    void nextTick(() => firstParamInputEl.value?.focus())
}

/**
 * @description 执行工作流并进入进度态：joined（瞬时完成）直接关闭；sequential 跟踪
 *              运行记录展示当前步骤/耗时/取消，终态展示 1.5s 后自动关闭
 * @param workflow 目标工作流
 * @returns Promise<void>
 *
 * @example void send(workflow)
 *
 */
async function send (workflow: Workflow): Promise<void> {
    const params = { ...paramValues.value }
    if (workflow.execution === 'joined') {
        close()
        await runWorkflowV2(workflow, config.store.quickCommands, params)
        return
    }
    editing.value = null
    paramValues.value = {}
    progressSettled.value = false
    progressRun.value = null
    // 启动运行（不 await 完成）；注册表条目可能晚于本帧（无终端标签时先开终端，
    // ensureTerminalTab 有秒级等待），轮询最多 3.5s 取运行记录进入进度态
    const running = runWorkflowV2(workflow, config.store.quickCommands, params)
    const run = await waitForRunEntry(workflow.id, 3500)
    if (!run) {
        // 未能启动（无终端/窗格被占）：等执行结果兜底后回到选择态
        await running
        finishClose()
        return
    }
    progressRun.value = run
    void running.then(() => {
        progressSettled.value = true
        progressDismissTimer = setTimeout(() => {
            progressDismissTimer = null
            if (progressRun.value?.status !== 'running') {
                close()
            }
        }, 1500)
    })
}

/**
 * @description 轮询等待工作流的运行记录出现在注册表（运行启动含开终端的秒级等待）
 * @param workflowId 工作流 id
 * @param timeoutMs 最长等待
 * @returns Promise<WorkflowRun | null> 运行记录；超时返回 null
 *
 * @example await waitForRunEntry('wf-1', 3500)
 *
 */
async function waitForRunEntry (workflowId: string, timeoutMs: number): Promise<WorkflowRun | null> {
    const started = Date.now()
    for (;;) {
        const run = isWorkflowRunning(workflowId)
        if (run) {
            return run
        }
        if (Date.now() - started >= timeoutMs) {
            return null
        }
        await new Promise(resolve => setTimeout(resolve, 100))
    }
}

/**
 * @description 取消进度态跟踪的运行
 * @returns void
 *
 * @example cancelProgressRun()
 *
 */
function cancelProgressRun (): void {
    const run = progressRun.value
    if (run && run.status === 'running') {
        cancelWorkflowRun(run.id)
    }
}

/**
 * @description 终态状态文案映射
 * @param run 运行记录
 * @returns string 文案
 *
 */
function runStatusText (run: WorkflowRun): string {
    switch (run.status) {
        case 'completed': return t('palette.workflowRunCompleted')
        case 'cancelled': return t('palette.workflowRunCancelled')
        case 'failed': return t('palette.workflowRunFailed', { step: run.note.split(':')[1] ?? '' })
        case 'aborted': return t('palette.workflowRunAborted')
        default: return t('palette.workflowRunRunning')
    }
}

/**
 * @description 选中一条工作流：有占位参数则进填参态，否则关闭选择器并直接执行
 * @param index 过滤后列表中的索引
 * @returns void
 *
 */
function pick (index: number): void {
    const item = visibleItems.value[index]
    if (!item || isWorkflowRunning(item.workflow.id)) {
        return
    }
    if (collectWorkflowParams(item.workflow.steps, config.store.quickCommands).length) {
        enterFillParams(item.workflow)
    } else {
        void send(item.workflow)
    }
}

function onInputKeydown (event: KeyboardEvent): void {
    if (event.key === 'Escape') {
        event.preventDefault()
        close()
    } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        selectedIndex.value = Math.min(selectedIndex.value + 1, visibleItems.value.length - 1)
        scrollToSelected()
    } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
        scrollToSelected()
    } else if (event.key === 'Enter') {
        event.preventDefault()
        pick(selectedIndex.value)
    } else if (event.key.toLowerCase() === 'w' && (event.metaKey || event.ctrlKey) && event.shiftKey) {
        // toggle closed with the same combo that opened it
        event.preventDefault()
        close()
    }
}

function onParamKeydown (event: KeyboardEvent): void {
    if (event.key === 'Escape') {
        event.preventDefault()
        const target = editing.value
        editing.value = null
        paramValues.value = {}
        void nextTick(() => inputEl.value?.focus())
        if (target) {
            // 回到选择态时保持该项选中，便于重新选择
            const index = visibleItems.value.findIndex(item => item.workflow.id === target.id)
            if (index >= 0) {
                selectedIndex.value = index
                scrollToSelected()
            }
        }
    } else if (event.key === 'Enter') {
        event.preventDefault()
        if (editing.value) {
            void send(editing.value)
        }
    }
}

watch(workflowPaletteOpen, value => {
    if (value) {
        open()
    } else {
        hotkeys.enable()
    }
})
</script>

<template>
    <Teleport to="body">
        <div v-if="workflowPaletteOpen" ref="backdropEl" class="palette-backdrop" @mousedown.self="close">
            <div ref="panelEl" class="palette">
                <template v-if="progressRun">
                    <div class="palette-fill-header">
                        <div class="palette-fill-title">{{ progressRun.workflowName }}</div>
                        <div class="wf-progress-status">{{ runStatusText(progressRun) }}</div>
                    </div>
                    <div class="palette-fill-body">
                        <div class="wf-progress-step">
                            <span class="wf-progress-label">{{ t('palette.workflowRunStep') }}</span>
                            <span class="wf-progress-value">{{ progressRun.currentStepIndex + 1 }} / {{ progressRun.totalSteps }}</span>
                        </div>
                        <div class="wf-progress-step">
                            <span class="wf-progress-label">{{ t('palette.workflowRunElapsed') }}</span>
                            <span class="wf-progress-value">{{ progressElapsed }}s</span>
                        </div>
                    </div>
                    <div class="palette-fill-footer wf-progress-footer">
                        <span v-if="!progressSettled">{{ t('palette.workflowRunEscHint') }}</span>
                        <button
                            v-if="progressRun.status === 'running'"
                            class="palette-empty-action wf-progress-cancel"
                            @click="cancelProgressRun"
                        >
                            {{ t('palette.workflowRunCancel') }}
                        </button>
                    </div>
                </template>
                <template v-else-if="!editing">
                    <input
                        ref="inputEl"
                        v-model="query"
                        class="palette-input"
                        :placeholder="t('settings.workflowSearchPlaceholder')"
                        @keydown="onInputKeydown"
                    />
                    <div ref="listEl" class="palette-list">
                        <div ref="highlightEl" class="palette-highlight" aria-hidden="true"></div>
                        <button
                            v-for="(item, index) in visibleItems"
                            :key="item.workflow.id"
                            class="palette-item"
                            :class="{ selected: index === selectedIndex }"
                            @click="pick(index)"
                            @mousemove="selectedIndex = index"
                        >
                            <span class="palette-item-main">
                                <span class="palette-item-label">{{ item.label }}</span>
                                <span v-if="item.description" class="palette-item-description">{{ item.description }}</span>
                                <span class="palette-item-preview">{{ item.preview }}</span>
                            </span>
                            <span v-if="isWorkflowRunning(item.workflow.id)" class="palette-item-hotkey wf-running-badge">▶</span>
                            <span v-else class="palette-item-hotkey">{{ item.workflow.execution === 'joined' ? '&&' : '⇥' }}</span>
                        </button>
                        <div v-if="visibleItems.length === 0" class="palette-empty">
                            <span>{{ config.store.workflows.length ? t('palette.noResults') : t('settings.workflowEmptyHint') }}</span>
                            <button
                                v-if="!config.store.workflows.length"
                                class="palette-empty-action"
                                @click="close(); tabs.openSettingsTab()"
                            >
                                {{ t('commands.openSettings') }}
                            </button>
                        </div>
                    </div>
                </template>
                <template v-else>
                    <div class="palette-fill-header">
                        <div class="palette-fill-title">{{ editing.name || t('settings.workflowUntitled') }}</div>
                        <div class="palette-fill-preview">{{ previewWorkflow(editing, config.store.quickCommands, 80) }}</div>
                    </div>
                    <div class="palette-fill-body">
                        <label v-for="(name, index) in editingParams" :key="name" class="palette-fill-field">
                            <span class="palette-fill-name">{{ name }}</span>
                            <input
                                :ref="index === 0 ? (el: unknown) => (firstParamInputEl = el as HTMLInputElement | undefined) : undefined"
                                v-model="paramValues[name]"
                                class="palette-fill-input"
                                @keydown="onParamKeydown"
                            />
                        </label>
                    </div>
                    <div class="palette-fill-footer">{{ t('settings.workflowFillHint') }}</div>
                </template>
            </div>
        </div>
    </Teleport>
</template>

<style scoped>
/* 共用样式（遮罩/面板/输入框/条目/动画）见 src/assets/styles/palette.css */
.palette-item-main {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
}

.palette-item-label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.palette-item-description {
    color: var(--color-muted-foreground);
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.palette-item-preview {
    color: var(--color-muted-foreground);
    font-size: 11px;
    font-family: var(--font-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.palette-empty {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
}

.palette-empty-action {
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 4px 12px;
    background: var(--color-accent);
    color: var(--color-accent-foreground);
    font-size: 12px;
    cursor: pointer;
    transition: border-color 0.15s ease, color 0.15s ease;
}

.palette-empty-action:hover {
    border-color: var(--color-ring);
    color: var(--color-foreground);
}

.palette-fill-header {
    padding: 12px 14px;
    border-bottom: 1px solid var(--color-border);
}

.palette-fill-title {
    font-size: 14px;
    font-weight: 600;
}

.palette-fill-preview {
    margin-top: 2px;
    color: var(--color-muted-foreground);
    font-size: 11px;
    font-family: var(--font-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.palette-fill-body {
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-height: 260px;
    overflow-y: auto;
}

.palette-fill-field {
    display: flex;
    align-items: center;
    gap: 10px;
}

.palette-fill-name {
    flex-shrink: 0;
    width: 130px;
    color: var(--color-muted-foreground);
    font-size: 12px;
    font-family: var(--font-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.palette-fill-input {
    flex: 1;
    min-width: 0;
    padding: 6px 8px;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: transparent;
    color: var(--color-foreground);
    font-size: 13px;
    font-family: var(--font-mono);
    outline: none;
}

.palette-fill-input:focus {
    border-color: var(--color-primary);
}

.palette-fill-footer {
    padding: 8px 14px;
    border-top: 1px solid var(--color-border);
    color: var(--color-muted-foreground);
    font-size: 11px;
}

.wf-progress-status {
    margin-top: 2px;
    font-size: 12px;
    color: var(--color-muted-foreground);
}

.wf-progress-step {
    display: flex;
    align-items: center;
    gap: 10px;
}

.wf-progress-label {
    flex-shrink: 0;
    width: 130px;
    color: var(--color-muted-foreground);
    font-size: 12px;
}

.wf-progress-value {
    font-family: var(--font-mono);
    font-size: 13px;
}

.wf-progress-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
}

.wf-running-badge {
    color: var(--color-primary);
}
</style>
