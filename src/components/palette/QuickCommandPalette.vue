<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useConfigStore, type QuickCommand } from '@/stores/config'
import { useTabsStore } from '@/stores/tabs'
import { terminalTabApi } from '@/services/terminalTabsApi'
import { closeQuickCommandPalette, pendingQuickCommandId, quickCommandPaletteOpen } from '@/services/quickCommandPalette'
import { hotkeys } from '@/services/hotkeysSingleton'
import { fuzzyMatch } from '@/lib/utils/fuzzy'
import { groupQuickCommandSections, parseQuickCommandParams, previewQuickCommand, renderQuickCommand } from '@/lib/quickCommands'

const { t } = useI18n()
const config = useConfigStore()
const tabs = useTabsStore()

const query = ref('')
const selectedIndex = ref(0)
const inputEl = ref<HTMLInputElement>()
/** 填参态下正在编辑的命令；null = 选择态 */
const editing = ref<QuickCommand | null>(null)
const paramValues = ref<Record<string, string>>({})
const firstParamInputEl = ref<HTMLInputElement>()

interface VisibleItem {
    quickCommand: QuickCommand
    label: string
    preview: string
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
                    fuzzyMatch(query.value, quickCommand.command) !== null)
                .map(quickCommand => ({
                    quickCommand,
                    label: quickCommand.name || previewQuickCommand(quickCommand.command),
                    preview: previewQuickCommand(quickCommand.command),
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
})

const editingParams = computed(() =>
    editing.value ? parseQuickCommandParams(editing.value.command) : [])

function open (): void {
    hotkeys.disable()
    const pending = config.store.quickCommands.find(qc => qc.id === pendingQuickCommandId.value)
    pendingQuickCommandId.value = null
    if (pending) {
        enterFillParams(pending)
    } else {
        void nextTick(() => inputEl.value?.focus())
    }
}

function close (): void {
    // 热键恢复统一由 watch(quickCommandPaletteOpen → false) 负责（双 enable 会使计数器失衡）
    closeQuickCommandPalette()
    query.value = ''
    editing.value = null
    paramValues.value = {}
}

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
 * @description 渲染模板并向当前活动窗格发送（无活动窗格时静默跳过），随后关闭选择器
 * @param quickCommand 目标命令
 * @returns void
 *
 * @example send(quickCommand)
 *
 */
function send (quickCommand: QuickCommand): void {
    const rendered = renderQuickCommand(quickCommand.command, paramValues.value)
    terminalTabApi.current?.sendTextToActivePane(rendered, quickCommand.autoRun)
    close()
}

/**
 * @description 选中一条命令：有占位参数则进填参态，否则直接发送
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
        send(item.quickCommand)
    }
}

function onInputKeydown (event: KeyboardEvent): void {
    if (event.key === 'Escape') {
        event.preventDefault()
        close()
    } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        selectedIndex.value = Math.min(selectedIndex.value + 1, visibleItems.value.length - 1)
    } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
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
            }
        }
    } else if (event.key === 'Enter') {
        event.preventDefault()
        if (editing.value) {
            send(editing.value)
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

onMounted(() => window.addEventListener('resize', close))
onBeforeUnmount(() => window.removeEventListener('resize', close))
</script>

<template>
    <Teleport to="body">
        <div v-if="quickCommandPaletteOpen" class="palette-backdrop" @mousedown.self="close">
            <div class="palette">
                <template v-if="!editing">
                    <input
                        ref="inputEl"
                        v-model="query"
                        class="palette-input"
                        :placeholder="t('settings.quickCommandSearchPlaceholder')"
                        @keydown="onInputKeydown"
                    />
                    <div class="palette-list">
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
.palette-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(0, 0, 0, 0.35);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 12vh;
    animation: 0.125s ease-out paletteFadeIn;
}

.palette {
    width: 520px;
    max-width: 90vw;
    background: var(--color-popover);
    color: var(--color-popover-foreground);
    border: 1px solid var(--color-border);
    border-radius: 10px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
    overflow: hidden;
    animation: 0.125s cubic-bezier(0, 0, 0.2, 1) paletteZoomIn;
}

.palette-input {
    width: 100%;
    box-sizing: border-box;
    padding: 12px 14px;
    border: none;
    border-bottom: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-foreground);
    font-size: 14px;
    outline: none;
}

.palette-input::placeholder {
    color: var(--color-muted-foreground);
}

.palette-list {
    max-height: 320px;
    overflow-y: auto;
    padding: 6px;
}

.palette-section-title {
    padding: 8px 10px 4px;
    font-size: 11px;
    color: var(--color-muted-foreground);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    user-select: none;
}

.palette-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    padding: 7px 10px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--color-foreground);
    font-size: 13px;
    text-align: left;
    cursor: default;
    transition: background 0.1s ease;
}

.palette-item.selected {
    background: var(--color-accent);
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

.palette-item-preview {
    color: var(--color-muted-foreground);
    font-size: 11px;
    font-family: monospace;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.palette-item-hotkey {
    color: var(--color-muted-foreground);
    font-size: 11px;
    flex-shrink: 0;
}

.palette-empty {
    padding: 16px;
    text-align: center;
    color: var(--color-muted-foreground);
    font-size: 13px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
}

.palette-empty-action {
    border: none;
    border-radius: 6px;
    padding: 4px 12px;
    background: var(--color-accent);
    color: var(--color-accent-foreground);
    font-size: 12px;
    cursor: default;
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
    font-family: monospace;
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
    font-family: monospace;
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
    font-family: monospace;
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

@keyframes paletteFadeIn {
    from {
        opacity: 0;
    }
    to {
        opacity: 1;
    }
}

@keyframes paletteZoomIn {
    from {
        transform: scale(0.96);
        opacity: 0.4;
    }
    to {
        transform: scale(1);
        opacity: 1;
    }
}
</style>
