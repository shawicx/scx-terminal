<script setup lang="ts">
/**
 * @description 标签页切换器：MRU + 模糊搜索 + 分组过滤的全局浮层。右侧列表提交后才
 *              激活标签；选中折叠组成员时先展开所属组，避免活动标签落在隐藏区域。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTabsStore } from '@/stores/tabs'
import { useConfigStore } from '@/stores/config'
import { closeTabSwitcher, tabSwitcherOpen } from '@/services/tabSwitcher'
import { hotkeys } from '@/services/hotkeysSingleton'
import { overlayEnter, overlayExit, moveHighlight } from '@/lib/motion'
import {
    buildTabSwitcherGroupFilters,
    buildTabSwitcherItems,
    defaultSelectedIndex,
    type TabGroupFilter,
    type TabSwitcherGroupFilter,
    type TabSwitcherItem,
    type TabTypeLabels,
} from './tabSwitcherModel'

const { t } = useI18n()
const tabs = useTabsStore()
const config = useConfigStore()

const query = ref('')
const selectedGroupFilter = ref<TabGroupFilter>({ kind: 'all' })
const selectedIndex = ref(0)
const inputEl = ref<HTMLInputElement>()
const listEl = ref<HTMLDivElement>()
const backdropEl = ref<HTMLDivElement>()
const panelEl = ref<HTMLDivElement>()
const highlightEl = ref<HTMLDivElement>()
let exitTween: ReturnType<typeof overlayExit> | null = null

const typeLabels = computed<TabTypeLabels>(() => ({
    terminal: t('tab.terminal'),
    settings: t('tab.settings'),
    sftp: t('tab.sftp'),
    forwarding: t('tab.forwarding'),
    start: t('tab.start'),
}))

const items = computed(() => buildTabSwitcherItems({
    tabs: tabs.tabs,
    groups: config.store.tabGroups,
    recentIds: tabs.recentIds,
    query: query.value,
    groupFilter: selectedGroupFilter.value,
    typeLabels: typeLabels.value,
}))

const groupFilters = computed(() => buildTabSwitcherGroupFilters({
    tabs: tabs.tabs,
    groups: config.store.tabGroups,
    alerts: tabs.alerts,
    labels: {
        allLabel: t('tabSwitcher.allGroups'),
        ungroupedLabel: t('tabSwitcher.ungrouped'),
    },
}))

/**
 * @description 判断左侧过滤项是否处于激活状态
 * @param filter 过滤项
 * @returns boolean 激活返回 true
 *
 * @example isGroupFilterActive({ kind: 'all' })
 *
 */
function isGroupFilterActive (filter: TabSwitcherGroupFilter): boolean {
    if (selectedGroupFilter.value.kind === 'group' && filter.kind === 'group') {
        return selectedGroupFilter.value.groupId === filter.groupId
    }
    return selectedGroupFilter.value.kind === filter.kind
}

/**
 * @description 选择左侧分组过滤并回到默认 MRU 选中项
 * @param filter 过滤项
 * @returns void
 *
 * @example selectGroupFilter({ kind: 'ungrouped' })
 *
 */
function selectGroupFilter (filter: TabSwitcherGroupFilter): void {
    selectedGroupFilter.value = filter.kind === 'group'
        ? { kind: 'group', groupId: filter.groupId! }
        : { kind: filter.kind }
    selectedIndex.value = defaultSelectedIndex(items.value, tabs.activeId)
    scrollToSelected()
    positionHighlight(false)
}

watch([query, selectedGroupFilter], () => {
    selectedIndex.value = defaultSelectedIndex(items.value, tabs.activeId)
    scrollToSelected()
})

/**
 * @description 滚动右侧列表，使键盘选中项保持可见
 * @returns void
 *
 * @example scrollToSelected()
 *
 */
function scrollToSelected (): void {
    requestAnimationFrame(() => {
        listEl.value?.querySelector('.tab-switcher-item.selected')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
}

/**
 * @description 重置搜索、过滤与默认选中项（打开切换器时使用）
 * @returns void
 *
 * @example resetSwitcherState()
 *
 */
function resetSwitcherState (): void {
    query.value = ''
    selectedGroupFilter.value = { kind: 'all' }
    selectedIndex.value = defaultSelectedIndex(items.value, tabs.activeId)
}

/**
 * @description 打开浮层：禁用全局热键、聚焦搜索框并播放现有 palette 入场动效
 * @returns void
 *
 * @example open()
 *
 */
function open (): void {
    hotkeys.disable()
    exitTween?.kill()
    exitTween = null
    resetSwitcherState()
    void nextTick(() => {
        inputEl.value?.focus()
        const backdrop = backdropEl.value
        const panel = panelEl.value
        if (!backdrop || !panel) {
            return
        }
        const renderedItems = [...listEl.value?.querySelectorAll('.tab-switcher-item') ?? []] as HTMLElement[]
        overlayEnter(backdrop, panel, renderedItems)
        positionHighlight(false)
        scrollToSelected()
    })
}

/**
 * @description 关闭浮层；动效期间重复调用会被忽略，避免提前卸载动画节点
 * @returns void
 *
 * @example close()
 *
 */
function close (): void {
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

/**
 * @description 完成关闭：更新全局开闭状态并清空临时输入
 * @returns void
 *
 * @example finishClose()
 *
 */
function finishClose (): void {
    closeTabSwitcher()
    query.value = ''
    selectedGroupFilter.value = { kind: 'all' }
    selectedIndex.value = 0
}

/**
 * @description 移动液态高亮滑块到当前选中条目
 * @param animate false 表示瞬时就位（首帧定位）
 * @returns void
 *
 * @example positionHighlight(false)
 *
 */
function positionHighlight (animate = true): void {
    const pill = highlightEl.value
    const target = listEl.value?.querySelector('.tab-switcher-item.selected') as HTMLElement | null
    if (!pill) {
        return
    }
    pill.style.visibility = target ? 'visible' : 'hidden'
    if (target) {
        moveHighlight(pill, target, animate)
    }
}

watch([selectedIndex, items], () => {
    positionHighlight()
}, { flush: 'post' })

/**
 * @description 提交选中标签：折叠组先展开，随后激活标签并记录 MRU/清理未读
 * @param item 切换器条目
 * @returns void
 *
 * @example selectItem(items[0]!)
 *
 */
function selectItem (item: TabSwitcherItem): void {
    if (item.group?.collapsed) {
        item.group.collapsed = false
    }
    close()
    tabs.activate(item.tab.id)
}

/**
 * @description 按索引提交当前选中标签
 * @param index 列表索引
 * @returns void
 *
 * @example pick(1)
 *
 */
function pick (index: number): void {
    const item = items.value[index]
    if (item) {
        selectItem(item)
    }
}

/**
 * @description 处理搜索框键盘导航：Escape 关闭、上下移动、Enter 提交
 * @param event 键盘事件
 * @returns void
 *
 * @example onInputKeydown(event)
 *
 */
function onInputKeydown (event: KeyboardEvent): void {
    if (event.key === 'Escape') {
        event.preventDefault()
        close()
    } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        selectedIndex.value = Math.min(selectedIndex.value + 1, items.value.length - 1)
        scrollToSelected()
    } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
        scrollToSelected()
    } else if (event.key === 'Enter') {
        event.preventDefault()
        pick(selectedIndex.value)
    }
}

watch(tabSwitcherOpen, value => {
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
        <div v-if="tabSwitcherOpen" ref="backdropEl" class="palette-backdrop" @mousedown.self="close">
            <div
                ref="panelEl"
                class="palette tab-switcher"
                role="dialog"
                aria-modal="true"
                aria-labelledby="tab-switcher-input"
            >
                <input
                    id="tab-switcher-input"
                    ref="inputEl"
                    v-model="query"
                    class="palette-input"
                    :placeholder="t('tabSwitcher.placeholder')"
                    :aria-label="t('tabSwitcher.title')"
                    role="combobox"
                    aria-expanded="true"
                    aria-haspopup="listbox"
                    aria-controls="tab-switcher-list"
                    :aria-activedescendant="items[selectedIndex] ? `tab-switcher-item-${items[selectedIndex]!.tab.id}` : undefined"
                    autocomplete="off"
                    spellcheck="false"
                    @keydown="onInputKeydown"
                />
                <div class="tab-switcher-body">
                    <nav class="tab-switcher-filters" :aria-label="t('tabSwitcher.title')">
                        <button
                            v-for="filter in groupFilters"
                            :key="filter.kind === 'group' ? `group-${filter.groupId}` : filter.kind"
                            class="tab-switcher-filter"
                            :class="{ active: isGroupFilterActive(filter) }"
                            :aria-pressed="isGroupFilterActive(filter)"
                            @click="selectGroupFilter(filter)"
                        >
                            <span
                                v-if="filter.color"
                                class="tab-switcher-filter-dot"
                                :style="{ background: filter.color }"
                            ></span>
                            <span class="tab-switcher-filter-name">
                                {{ filter.label }}
                            </span>
                            <span class="tab-switcher-filter-count">{{ filter.count }}</span>
                            <span v-if="filter.hasAlert" class="tab-switcher-filter-alert"></span>
                        </button>
                    </nav>
                    <div
                        ref="listEl"
                        id="tab-switcher-list"
                        class="tab-switcher-list"
                        role="listbox"
                    >
                        <div ref="highlightEl" class="tab-switcher-highlight" aria-hidden="true"></div>
                        <div
                            v-for="(item, index) in items"
                            :id="`tab-switcher-item-${item.tab.id}`"
                            :key="item.tab.id"
                            class="tab-switcher-item"
                            :class="{ selected: index === selectedIndex }"
                            role="option"
                            :aria-selected="index === selectedIndex"
                            tabindex="-1"
                            @click="selectItem(item)"
                            @mousemove="selectedIndex = index"
                        >
                            <span
                                class="tab-switcher-group-bar"
                                :style="{ background: item.group?.color ?? 'transparent' }"
                            ></span>
                            <span class="tab-switcher-item-title" :title="item.title">{{ item.title }}</span>
                            <span class="tab-switcher-item-meta">
                                {{ item.group?.name ?? t('tabSwitcher.ungrouped') }} · {{ item.typeLabel }}
                            </span>
                            <span v-if="item.collapsed" class="tab-switcher-badge">{{ t('tabSwitcher.collapsed') }}</span>
                            <span v-if="item.tab.id === tabs.activeId" class="tab-switcher-badge current">
                                {{ t('tabSwitcher.current') }}
                            </span>
                            <span v-if="tabs.alerts[item.tab.id]" class="tab-switcher-item-alert"></span>
                        </div>
                        <div v-if="items.length === 0" class="tab-switcher-empty">
                            {{ t('tabSwitcher.noResults') }}
                        </div>
                    </div>
                </div>
                <footer class="tab-switcher-footer">{{ t('tabSwitcher.keyboardHint') }}</footer>
            </div>
        </div>
    </Teleport>
</template>

<style scoped>
/* 共用遮罩/面板/输入框语言见 palette.css；这里只保留终端高密度切换器的专属布局。 */
.tab-switcher {
    /* 随设置页终端字号缩放：App.vue 把 fontSize / 13 写入全局 --ui-zoom，
       面板即便 Teleport 到 body 也能继承；宽高同步缩放，避免只放大文字导致挤压 */
    --tab-switcher-zoom: var(--ui-zoom, 1);
    width: min(92vw, calc(640px * var(--tab-switcher-zoom)));
}

.tab-switcher .palette-input {
    font-size: calc(14px * var(--tab-switcher-zoom));
}

.tab-switcher-body {
    display: grid;
    grid-template-columns: calc(148px * var(--tab-switcher-zoom)) minmax(0, 1fr);
    height: min(70vh, calc(420px * var(--tab-switcher-zoom)));
    border-top: 1px solid var(--color-border);
}

.tab-switcher-filters {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px;
    border-right: 1px solid var(--color-border);
    background: color-mix(in oklch, var(--color-muted-foreground) 7%, transparent);
    overflow-y: auto;
}

.tab-switcher-filter {
    position: relative;
    display: flex;
    align-items: center;
    gap: 5px;
    width: 100%;
    height: calc(26px * var(--tab-switcher-zoom));
    padding: 0 7px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--color-muted-foreground);
    font-size: calc(12px * var(--tab-switcher-zoom));
    text-align: left;
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease;
}

.tab-switcher-filter:hover,
.tab-switcher-filter.active {
    background: var(--color-accent);
    color: var(--color-foreground);
}

.tab-switcher-filter-dot,
.tab-switcher-filter-alert,
.tab-switcher-item-alert {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
}

.tab-switcher-filter-dot {
    background: var(--color-muted-foreground);
}

.tab-switcher-filter-alert,
.tab-switcher-item-alert {
    position: absolute;
    top: 5px;
    right: 5px;
    background: var(--color-primary);
}

.tab-switcher-filter-name,
.tab-switcher-item-title,
.tab-switcher-item-meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.tab-switcher-filter-name {
    flex: 1 1 auto;
    min-width: 0;
}

.tab-switcher-filter-count {
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: calc(10px * var(--tab-switcher-zoom));
    font-variant-numeric: tabular-nums;
}

.tab-switcher-list {
    position: relative;
    padding: 5px;
    overflow-y: auto;
    overscroll-behavior: contain;
}

.tab-switcher-highlight {
    position: absolute;
    left: 5px;
    top: 0;
    border-radius: 6px;
    background: var(--color-accent);
    pointer-events: none;
    visibility: hidden;
}

.tab-switcher-item {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    height: calc(28px * var(--tab-switcher-zoom));
    padding: 0 11px 0 14px;
    border-radius: 6px;
    color: var(--color-foreground);
    font-size: calc(13px * var(--tab-switcher-zoom));
    cursor: pointer;
}

.tab-switcher-group-bar {
    position: absolute;
    left: 5px;
    top: 6px;
    bottom: 6px;
    width: 2px;
    border-radius: 1px;
}

.tab-switcher-item-title {
    flex: 1 1 auto;
    min-width: 80px;
}

.tab-switcher-item-meta {
    flex: 0 1 auto;
    max-width: 42%;
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: calc(10px * var(--tab-switcher-zoom));
}

.tab-switcher-badge {
    flex-shrink: 0;
    padding: 1px 4px;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: calc(10px * var(--tab-switcher-zoom));
    line-height: 1.2;
}

.tab-switcher-badge.current {
    border-color: color-mix(in oklch, var(--color-primary) 55%, transparent);
    color: var(--color-primary);
}

.tab-switcher-item-alert {
    position: static;
    flex-shrink: 0;
}

.tab-switcher-empty {
    padding: 24px 16px;
    color: var(--color-muted-foreground);
    font-size: calc(13px * var(--tab-switcher-zoom));
    text-align: center;
}

.tab-switcher-footer {
    padding: 7px 12px;
    border-top: 1px solid var(--color-border);
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: calc(10px * var(--tab-switcher-zoom));
    user-select: none;
}

@media (max-width: 720px) {
    .tab-switcher-body {
        grid-template-columns: calc(122px * var(--tab-switcher-zoom)) minmax(0, 1fr);
        height: min(66vh, calc(380px * var(--tab-switcher-zoom)));
    }
}
</style>
