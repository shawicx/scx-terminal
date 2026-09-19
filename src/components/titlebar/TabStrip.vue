<script setup lang="ts">
/**
 * @description 标签条：标签列表（右键菜单/行内重命名/颜色标记/拖拽排序）+「+」档案下拉。
 *              top 模式内嵌 TitleBar（display:contents 不引入额外盒子），bottom 模式
 *              独立成条（圆角/描边/激活下探方向全部翻转），由 App.vue 挂在内容区下方。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Plus, X } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useTabsStore, type Tab } from '@/stores/tabs'
import { useConfigStore, defaultFirstProfiles, type LocalProfile, type SshProfile } from '@/stores/config'
import { terminalTabApi } from '@/services/terminalTabsApi'
import { groupQuickCommandSections } from '@/lib/quickCommands'
import ContextMenu, { type ContextMenuItemSpec } from '@/components/ui/ContextMenu.vue'
import DropdownMenu from '@/components/ui/DropdownMenu.vue'
import { getTabStripWheelDelta, resolveActiveTabScrollLeft } from './tabStripLayout'

/** 「+」按钮占用的横向空间（宽 26 + 左右边距各 2 + flex 间隙 2），滚动活动标签到可见区时右侧需让开 */
const NEW_TAB_BUTTON_RESERVE = 32

withDefaults(defineProps<{
    /** 标签条位置：top = 内嵌标题栏（默认），bottom = 独立成条置于内容区下方 */
    position?: 'top' | 'bottom'
}>(), { position: 'top' })

const { t } = useI18n()
const store = useTabsStore()
const config = useConfigStore()

const dragOverIndex = ref<number | null>(null)
const dragFromIndex = ref<number | null>(null)
const tabsRegionEl = ref<HTMLElement>()

/**
 * @description 把纵向/横向滚轮转换成标签栏横向滚动，便于标签溢出后回到被裁切的标签
 * @param event 标签栏滚轮事件
 * @returns void
 *
 */
function onTabsWheel (event: WheelEvent): void {
    const region = tabsRegionEl.value
    if (!region || region.scrollWidth <= region.clientWidth) {
        return
    }

    const delta = getTabStripWheelDelta({
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        viewportWidth: region.clientWidth,
    })
    if (!delta) {
        return
    }

    event.preventDefault()
    region.scrollLeft += delta
}

/**
 * @description 将活动标签滚动到标签栏可视区内；已可见时保持当前位置不变
 * @returns void
 *
 */
function scrollActiveTabIntoView (): void {
    const region = tabsRegionEl.value
    const activeId = store.activeId
    if (!region || !activeId) {
        return
    }

    const tab = region.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeId)}"]`)
    if (!tab) {
        return
    }

    const regionRect = region.getBoundingClientRect()
    const tabRect = tab.getBoundingClientRect()
    region.scrollLeft = resolveActiveTabScrollLeft({
        scrollLeft: region.scrollLeft,
        viewportWidth: region.clientWidth,
        tabStart: tabRect.left - regionRect.left + region.scrollLeft,
        tabEnd: tabRect.right - regionRect.left + region.scrollLeft,
        padding: 4,
        rightReserve: region.scrollWidth > region.clientWidth ? NEW_TAB_BUTTON_RESERVE : 0,
    })
}

watch(() => [store.activeId, store.tabs.length] as const, () => {
    void nextTick(scrollActiveTabIntoView)
})

onMounted(() => {
    scrollActiveTabIntoView()
    window.addEventListener('resize', scrollActiveTabIntoView)
    tabsRegionEl.value?.addEventListener('wheel', onTabsWheel, { passive: false })
})

onBeforeUnmount(() => {
    window.removeEventListener('resize', scrollActiveTabIntoView)
    tabsRegionEl.value?.removeEventListener('wheel', onTabsWheel)
})

/** 标签颜色标记的预设色板 */
const TAB_COLORS = [
    { name: 'red', color: '#e06c75' },
    { name: 'orange', color: '#d19a66' },
    { name: 'yellow', color: '#e5c07b' },
    { name: 'green', color: '#98c379' },
    { name: 'blue', color: '#61afef' },
    { name: 'purple', color: '#c678dd' },
    { name: 'gray', color: '#7f848e' },
] as const

/**
 * @description 「+」按钮的档案菜单项：本地档案在前（默认档案置顶、带标记），分隔线后
 *              按分组排列 SSH 档案（默认分组在前，其余按组名排序，组内保持配置顺序）
 * @returns ContextMenuItemSpec[] 菜单项列表
 *
 */
const newTabMenuItems = computed<ContextMenuItemSpec[]>(() => {
    const locals: ContextMenuItemSpec[] = defaultFirstProfiles(config.store.profiles)
        .filter((profile): profile is LocalProfile => profile.type === 'local')
        .map(profile => ({
            key: profile.id,
            label: profile.isDefault ? `${profile.name} · ${t('tab.defaultProfile')}` : profile.name,
        }))
    const sshItems: ContextMenuItemSpec[] = groupQuickCommandSections(
        config.store.profiles.filter((profile): profile is SshProfile => profile.type === 'ssh'),
        config.store.sshGroups,
    ).flatMap(section => section.items.map(profile => ({ key: profile.id, label: profile.name })))
    return [
        ...locals,
        ...sshItems.map((item, index) => index === 0 && locals.length > 0 ? { ...item, separatorBefore: true } : item),
    ]
})

/**
 * @description 处理「+」档案菜单选择：取活动窗格 cwd 后按档案开新标签（继承当前目录）
 * @param key 档案 id
 * @returns void
 *
 */
function onNewTabMenuSelect (key: string): void {
    void (async () => {
        const cwd = await terminalTabApi.current?.getActivePaneCwd() ?? null
        store.openTerminalTab(key, cwd)
    })()
}

/**
 * @description 标签显示标题：手动重命名 > shell 上报标题 > 回退文案
 * @param tab 标签对象
 * @returns string 显示用标题
 *
 */
function displayTitle (tab: Tab): string {
    return tab.manualTitle || tab.title || 'Terminal'
}

/**
 * @description 构造标签右键菜单项
 * @returns ContextMenuItemSpec[] 菜单项
 *
 */
function tabMenuItems (): ContextMenuItemSpec[] {
    return [
        { key: 'rename', label: t('tab.rename') },
        { key: 'close', label: t('tab.close') },
        {
            key: 'close-others',
            label: t('tab.closeOthers'),
            disabled: store.tabs.length <= 1,
            separatorBefore: true,
        },
        ...TAB_COLORS.map(item => ({
            key: `color:${item.color}`,
            label: t(`tab.colorNames.${item.name}`),
            swatch: item.color,
            separatorBefore: item.name === 'red',
        })),
    ]
}

/**
 * @description 处理标签右键菜单选择
 * @param tab 目标标签
 * @param key 菜单项 key
 * @returns void
 *
 */
function onTabMenuSelect (tab: Tab, key: string): void {
    if (key === 'rename') {
        startRename(tab)
    } else if (key === 'close') {
        store.closeTab(tab.id)
    } else if (key === 'close-others') {
        store.closeOtherTabs(tab.id)
    } else if (key.startsWith('color:')) {
        store.setTabColor(tab.id, key.slice('color:'.length))
    }
}

// ---- inline rename ----
const renamingId = ref<string | null>(null)
const renameValue = ref('')
const renameInputEl = ref<HTMLInputElement | null>(null)

/**
 * @description 函数 ref：捕获当前渲染的重命名输入框（v-for 中字符串 ref 会退化为数组，故用函数形式）
 * @param el 挂载/卸载的元素
 * @returns void
 *
 */
function setRenameInput (el: unknown): void {
    renameInputEl.value = (el as HTMLInputElement | null) ?? null
}

/**
 * @description 进入标签行内重命名模式，预填当前显示标题
 * @param tab 目标标签
 * @returns void
 *
 */
function startRename (tab: Tab): void {
    renamingId.value = tab.id
    renameValue.value = displayTitle(tab)
    void nextTick(() => renameInputEl.value?.focus())
}

/**
 * @description 提交重命名（Enter / 失焦）
 * @returns void
 *
 */
function commitRename (): void {
    if (renamingId.value) {
        store.renameTab(renamingId.value, renameValue.value)
    }
    renamingId.value = null
}

/**
 * @description 取消重命名（Esc）
 * @returns void
 *
 */
function cancelRename (): void {
    renamingId.value = null
}

function onDragStart (index: number, event: DragEvent) {
    dragFromIndex.value = index
    event.dataTransfer!.effectAllowed = 'move'
}

function onDragOver (index: number, event: DragEvent) {
    if (dragFromIndex.value === null) {
        return
    }
    event.preventDefault()
    event.dataTransfer!.dropEffect = 'move'
    dragOverIndex.value = index
}

function onDrop (index: number, event: DragEvent) {
    event.preventDefault()
    if (dragFromIndex.value !== null) {
        store.moveTab(dragFromIndex.value, index)
    }
    dragFromIndex.value = null
    dragOverIndex.value = null
    void nextTick(scrollActiveTabIntoView)
}

function onAuxClick (id: string, event: MouseEvent) {
    if (event.button === 1) {
        store.closeTab(id)
    }
}

function onDragEnd () {
    dragFromIndex.value = null
    dragOverIndex.value = null
}
</script>

<template>
    <div class="tab-strip" :class="position === 'bottom' ? 'tab-strip--bottom' : 'tab-strip--inline'">
        <div
            ref="tabsRegionEl"
            class="tabs-region"
            data-tauri-drag-region
        >
            <ContextMenu
                v-for="(tab, index) in store.tabs"
                :key="tab.id"
                :items="tabMenuItems()"
                @select="key => onTabMenuSelect(tab, key)"
            >
                <div
                    class="tab-header"
                    :data-tab-id="tab.id"
                    :class="{
                        active: tab.id === store.activeId,
                        'drag-over': dragOverIndex === index && dragFromIndex !== null && dragFromIndex !== index,
                    }"
                    :draggable="renamingId !== tab.id"
                    :title="displayTitle(tab)"
                    role="tab"
                    :aria-selected="tab.id === store.activeId"
                    tabindex="0"
                    @dragstart="onDragStart(index, $event)"
                    @dragover="onDragOver(index, $event)"
                    @drop="onDrop(index, $event)"
                    @dragend="onDragEnd"
                    @click="store.activate(tab.id)"
                    @auxclick="onAuxClick(tab.id, $event)"
                    @keydown.enter.self.prevent="store.activate(tab.id)"
                    @keydown.space.self.prevent="store.activate(tab.id)"
                >
                    <span v-if="tab.color" class="tab-color-dot" :style="{ background: tab.color }"></span>
                    <!-- 后台标签响铃未读标记：激活标签在 store 层已同步清除，无需此处再判 -->
                    <span v-if="store.alerts[tab.id]" class="tab-alert-dot"></span>
                    <input
                        v-if="renamingId === tab.id"
                        :ref="setRenameInput"
                        v-model="renameValue"
                        class="tab-rename"
                        @click.stop
                        @keydown.enter.prevent="commitRename"
                        @keydown.esc.prevent="cancelRename"
                        @blur="commitRename"
                    />
                    <span v-else class="tab-title">{{ displayTitle(tab) }}</span>
                    <button
                        v-if="renamingId !== tab.id"
                        class="tab-close"
                        :title="t('commands.closeTab')"
                        @click.stop="store.closeTab(tab.id)"
                    >
                        <X :size="12" />
                    </button>
                </div>
            </ContextMenu>

            <!-- 「+」随标签排布：未溢出时紧跟最后一个标签，溢出后 sticky 吸附标签区右缘 -->
            <DropdownMenu :items="newTabMenuItems" @select="onNewTabMenuSelect">
                <button class="new-tab-button" :title="t('commands.newTab')">
                    <Plus :size="14" />
                </button>
            </DropdownMenu>
        </div>

        <!-- 条尾余白拖拽区（双击缩放交给 Tauri 原生 drag-region） -->
        <div class="drag-area" data-tauri-drag-region></div>
    </div>
</template>

<style scoped>
/* top 模式：不引入额外盒子，tabs-region 直接参与 title-bar 的 flex 布局 */
.tab-strip--inline {
    display: contents;
}

/* bottom 模式：独立标签条（含底色与上描边，方向翻转） */
.tab-strip--bottom {
    display: flex;
    align-items: flex-start;
    height: 38px;
    flex-shrink: 0;
    background: var(--color-card);
    border-top: 1px solid var(--color-border);
    user-select: none;
}

.tabs-region {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    padding: 0 4px;
    max-width: 70%;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
}

.tabs-region::-webkit-scrollbar {
    display: none;
}

.tab-strip--bottom .tabs-region {
    align-items: flex-start;
}

.tab-header {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 6px;
    padding: 0 10px;
    height: 30px;
    border: 1px solid transparent;
    border-bottom: none;
    border-radius: 6px 6px 0 0;
    font-size: 12px;
    color: var(--color-muted-foreground);
    cursor: default;
    position: relative;
    /* 定宽（默认即最小宽度），标题超长省略：标题随 shell/目录上报变化时不引起标签宽度抖动 */
    width: 140px;
    min-width: 140px;
    transition: background-color 0.25s ease, color 0.25s ease, border-color 0.25s ease;
}

/* 激活标签与内容区连通：背景取内容区底色，侧/顶描边 + 下探 1px 盖住标题栏底边线 */
.tab-header.active {
    height: 31px;
    margin-bottom: -1px;
    background: var(--color-background);
    color: var(--color-foreground);
    border-color: var(--color-border);
}

.tab-header:not(.active):hover {
    background: color-mix(in oklch, var(--color-accent) 60%, transparent);
}

.tab-header.drag-over {
    box-shadow: inset 2px 0 0 var(--color-primary);
}

/* bottom 模式：圆角/去边方向/激活上探全部翻转 */
.tab-strip--bottom .tab-header {
    border-bottom: 1px solid transparent;
    border-top: none;
    border-radius: 0 0 6px 6px;
}

.tab-strip--bottom .tab-header.active {
    margin-top: -1px;
    margin-bottom: 0;
}

/* 文本列 + 关闭列的两列布局：标题占满剩余宽度（超长省略），× 恒定右列对齐 */
.tab-title {
    flex: 1 1 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    text-align: left;
}

.tab-color-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
}

/* 响铃未读标记：右上角小圆点，绝对定位不占 flex 布局宽度（标签 140px 定宽硬约束） */
.tab-alert-dot {
    position: absolute;
    top: 3px;
    right: 4px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-primary);
    pointer-events: none;
}

.tab-rename {
    width: 110px;
    min-width: 0;
    padding: 0 4px;
    border: 1px solid var(--color-ring);
    border-radius: 4px;
    background: var(--color-background);
    color: var(--color-foreground);
    font-size: 12px;
    outline: none;
}

.tab-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: inherit;
    opacity: 0;
    cursor: default;
    transition: opacity 0.25s ease, background-color 0.25s ease;
    flex-shrink: 0;
}

.tab-header:hover .tab-close,
.tab-header.active .tab-close {
    opacity: 0.7;
}

.tab-close:hover {
    opacity: 1 !important;
    background: color-mix(in oklch, var(--color-foreground) 15%, transparent);
}

.new-tab-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    align-self: center;
    flex-shrink: 0;
    margin-left: 2px;
    margin-right: 2px;
    border: none;
    border-radius: 6px;
    /* 未溢出时随流排布（紧跟最后一个标签）；标签溢出后吸附标签区右缘，
       实底背景盖住从下方滚过的标签 */
    position: sticky;
    right: 0;
    background: var(--color-card);
    color: var(--color-muted-foreground);
    cursor: default;
    transition: background-color 0.25s ease, color 0.25s ease;
}

.new-tab-button:hover {
    background: var(--color-accent);
    color: var(--color-accent-foreground);
}

.drag-area {
    flex: 1;
}
</style>
