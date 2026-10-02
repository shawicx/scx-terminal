<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useConfigStore, type QuickCommand } from '@/stores/config'
import { useTabsStore } from '@/stores/tabs'
import { terminalTabApi } from '@/services/terminalTabsApi'
import { closeQuickCommandPalette, pendingQuickCommandId, quickCommandPaletteOpen } from '@/services/quickCommandPalette'
import { hotkeys } from '@/services/hotkeysSingleton'
import { fuzzyMatch } from '@/lib/utils/fuzzy'
import { groupQuickCommandSections, parseQuickCommandParams, previewQuickCommand, renderQuickCommand } from '@/lib/quickCommands'
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
/** 填参态下正在编辑的命令；null = 选择态 */
const editing = ref<QuickCommand | null>(null)
const paramValues = ref<Record<string, string>>({})
const firstParamInputEl = ref<HTMLInputElement>()

interface VisibleItem {
    quickCommand: QuickCommand
    label: string
    preview: string
    /** 描述（可选备注，空串 = 未填写） */
    description: string
    /** 过滤后扁平列表中的索引（键盘导航用） */
    flatIndex: number
}

interface VisibleSection {
    /** 分组标题；null = 未分组（置顶、无标题） */
    title: string | null
    items: VisibleItem[]
}

/** 全部命令按「未分组（无标题，置顶）→ 各分组（组名排序，带小节头）」分段，并按搜索词过滤 */
const visibleSections = computed<VisibleSection[]>(() => {
    let flatIndex = 0
    return groupQuickCommandSections(config.store.quickCommands, config.store.quickCommandGroups)
        .map(section => {
            const items = section.items
                .filter(quickCommand =>
                    fuzzyMatch(query.value, quickCommand.name) !== null ||
                    fuzzyMatch(query.value, quickCommand.command) !== null ||
                    (quickCommand.description ? fuzzyMatch(query.value, quickCommand.description) !== null : false))
                .map(quickCommand => ({
                    quickCommand,
                    label: quickCommand.name || previewQuickCommand(quickCommand.command),
                    preview: previewQuickCommand(quickCommand.command),
                    description: quickCommand.description ?? '',
                    flatIndex: flatIndex++,
                }))
            return { title: section.title, items }
        })
        .filter(section => section.items.length)
})

/** 过滤后的扁平命令列表（键盘导航/序号收敛用） */
const visibleItems = computed(() => visibleSections.value.flatMap(section => section.items))

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

const editingParams = computed(() =>
    editing.value ? parseQuickCommandParams(editing.value.command) : [])

function open (): void {
    hotkeys.disable()
    exitTween?.kill()
    exitTween = null
    const pending = config.store.quickCommands.find(qc => qc.id === pendingQuickCommandId.value)
    pendingQuickCommandId.value = null
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
    // 热键恢复统一由 watch(quickCommandPaletteOpen → false) 负责（双 enable 会使计数器失衡）
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
    closeQuickCommandPalette()
    query.value = ''
    editing.value = null
    paramValues.value = {}
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
 * @description 进入填参态：记录命令并初始化参数值（全部置空），聚焦第一个输入框
 * @param quickCommand 目标命令
 * @returns void
 *
 * @example enterFillParams(quickCommand)
 *
 */
function enterFillParams (quickCommand: QuickCommand): void {
    editing.value = quickCommand
    paramValues.value = Object.fromEntries(
        parseQuickCommandParams(quickCommand.command).map(name => [name, '']))
    void nextTick(() => firstParamInputEl.value?.focus())
}

/**
 * @description 渲染模板并向活动窗格发送（无活动终端标签时先打开默认终端再发送），随后关闭选择器
 * @param quickCommand 目标命令
 * @returns Promise<void>
 *
 * @example void send(quickCommand)
 *
 */
async function send (quickCommand: QuickCommand): Promise<void> {
    const rendered = renderQuickCommand(quickCommand.command, paramValues.value)
    close()
    if (!await ensureTerminalTab()) {
        return
    }
    terminalTabApi.current?.sendTextToActivePane(rendered, quickCommand.autoRun)
}

/**
 * @description 确保有活动终端标签可接收命令：无则打开默认终端并等待注册
 *              （连接中心/设置页等非终端标签场景直接可用），注册后再等
 *              新窗格会话启动完成，避免写入丢失
 * @returns Promise<boolean> 是否就绪
 *
 */
async function ensureTerminalTab (): Promise<boolean> {
    if (terminalTabApi.current) {
        return true
    }
    tabs.openTerminalTab()
    for (let i = 0; i < 80 && !terminalTabApi.current; i++) {
        await new Promise(resolve => setTimeout(resolve, 25))
    }
    if (!terminalTabApi.current) {
        return false
    }
    await new Promise(resolve => setTimeout(resolve, 400))
    return true
}

/**
 * @description 选中一条命令：有占位参数则进填参态，否则关闭选择器并直接发送
 * @param index 过滤后扁平列表中的索引
 * @returns void
 *
 */
function pick (index: number): void {
    const item = visibleItems.value[index]
    if (!item) {
        return
    }
    if (parseQuickCommandParams(item.quickCommand.command).length) {
        enterFillParams(item.quickCommand)
    } else {
        void send(item.quickCommand)
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
    } else if (event.key.toLowerCase() === 'r' && (event.metaKey || event.ctrlKey) && event.shiftKey) {
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
            const index = visibleItems.value.findIndex(item => item.quickCommand.id === target.id)
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
    } else if (event.key.toLowerCase() === 'r' && (event.metaKey || event.ctrlKey) && event.shiftKey) {
        // toggle closed with the same combo that opened it
        event.preventDefault()
        close()
    }
}

watch(quickCommandPaletteOpen, value => {
    if (value) {
        open()
    } else {
        hotkeys.enable()
    }
})
</script>

<template>
    <Teleport to="body">
        <div v-if="quickCommandPaletteOpen" ref="backdropEl" class="palette-backdrop" @mousedown.self="close">
            <div ref="panelEl" class="palette">
                <template v-if="!editing">
                    <input
                        ref="inputEl"
                        v-model="query"
                        class="palette-input"
                        :placeholder="t('settings.quickCommandSearchPlaceholder')"
                        @keydown="onInputKeydown"
                    />
                    <div ref="listEl" class="palette-list">
                        <div ref="highlightEl" class="palette-highlight" aria-hidden="true"></div>
                        <template v-for="section in visibleSections" :key="section.title ?? '__ungrouped'">
                            <div v-if="section.title" class="palette-section-title">{{ section.title }}</div>
                            <button
                                v-for="item in section.items"
                                :key="item.quickCommand.id"
                                class="palette-item"
                                :class="{ selected: item.flatIndex === selectedIndex }"
                                @click="pick(item.flatIndex)"
                                @mousemove="selectedIndex = item.flatIndex"
                            >
                                <span class="palette-item-main">
                                    <span class="palette-item-label">{{ item.label }}</span>
                                    <span v-if="item.description" class="palette-item-description">{{ item.description }}</span>
                                    <span class="palette-item-preview">{{ item.preview }}</span>
                                </span>
                                <span v-if="item.quickCommand.autoRun" class="palette-item-hotkey">↵</span>
                            </button>
                        </template>
                        <div v-if="visibleItems.length === 0" class="palette-empty">
                            <span>{{ config.store.quickCommands.length ? t('palette.noResults') : t('settings.quickCommandEmptyHint') }}</span>
                            <button
                                v-if="!config.store.quickCommands.length"
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
                        <div class="palette-fill-title">{{ editing.name || previewQuickCommand(editing.command) }}</div>
                        <div class="palette-fill-preview">{{ previewQuickCommand(editing.command, 80) }}</div>
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
                    <div class="palette-fill-footer">{{ t('settings.quickCommandFillHint') }}</div>
                </template>
            </div>
        </div>
    </Teleport>
</template>

<style scoped>
/* 共用样式（遮罩/面板/输入框/条目/动画）见 src/assets/styles/palette.css */
.palette-section-title {
    padding: 8px 10px 4px;
    font-size: 11px;
    color: var(--color-muted-foreground);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    user-select: none;
}

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
</style>
