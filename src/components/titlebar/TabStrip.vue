<script setup lang="ts">
/**
 * @description 标签条：分组头 chip（折叠/拖拽入组/右键菜单）+ 标签列表（右键菜单/行内
 *              重命名/颜色标记/拖拽归组排序）+「+」档案下拉（继承活动标签分组）。
 *              top 模式内嵌 TitleBar（display:contents 不引入额外盒子），bottom 模式
 *              独立成条（圆角/描边/激活下探方向全部翻转），由 App.vue 挂在内容区下方。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronDown, Plus, X } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useTabsStore, type Tab } from '@/stores/tabs'
import { useConfigStore, defaultFirstProfiles, type LocalProfile, type SshProfile, type TabGroup } from '@/stores/config'
import { terminalTabApi } from '@/services/terminalTabsApi'
import { groupQuickCommandSections } from '@/lib/quickCommands'
import ContextMenu, { type ContextMenuItemSpec } from '@/components/ui/ContextMenu.vue'
import DropdownMenu from '@/components/ui/DropdownMenu.vue'
import { getTabStripWheelDelta, resolveActiveTabScrollLeft } from './tabStripLayout'
import { activeAfterCollapse, displaySequence, groupOf, resolveDrop } from './tabGroupLayout'
import { TAB_COLORS } from '@/lib/tabColors'

/** 「+」按钮占用的横向空间（宽 26 + 左右边距各 2 + flex 间隙 2），滚动活动标签到可见区时右侧需让开 */
const NEW_TAB_BUTTON_RESERVE = 32

/** 「+」菜单「连接中心」首项的哨兵 key（与档案 id 区分） */
const START_TAB_MENU_KEY = '__open_start__'

withDefaults(defineProps<{
    /** 标签条位置：top = 内嵌标题栏（默认），bottom = 独立成条置于内容区下方 */
    position?: 'top' | 'bottom'
}>(), { position: 'top' })

const { t } = useI18n()
const store = useTabsStore()
const config = useConfigStore()

/** 被拖拽标签 id（null = 无拖拽进行中） */
const dragTabId = ref<string | null>(null)
/** 拖拽悬停高亮的标签 id */
const tabDragOverId = ref<string | null>(null)
/** 拖拽悬停高亮的分组 chip 组 id */
const chipDragOverId = ref<string | null>(null)
const tabsRegionEl = ref<HTMLElement>()

/** 展示序列（模板唯一渲染源）：组 chip 按定义序在前，未分组标签在后；折叠组成员隐藏（spec：折叠行为 = 成员隐藏） */
const displayItems = computed(() =>
    displaySequence(store.tabs, config.store.tabGroups)
        .filter(item => item.kind === 'chip' || !groupOf(config.store.tabGroups, item.tab)?.collapsed))

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

/**
 * @description 「+」按钮的档案菜单项：固定首项为连接中心，随后本地档案在前（默认档案
 *              置顶、带标记），分隔线后按分组排列 SSH 档案（默认分组在前，其余按组名排序，
 *              组内保持配置顺序）
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
    const startItem: ContextMenuItemSpec = { key: START_TAB_MENU_KEY, label: t('start.tabTitle') }
    const localItems = locals.map((item, index) => index === 0 ? { ...item, separatorBefore: true } : item)
    const separatedSshItems = sshItems.map((item, index) => index === 0 ? { ...item, separatorBefore: true } : item)
    return [startItem, ...localItems, ...separatedSshItems]
})

/**
 * @description 处理「+」档案菜单选择：取活动窗格 cwd 后按档案开新标签（继承当前目录与
 *              活动标签的分组归属）
 * @param key 档案 id
 * @returns void
 *
 */
function onNewTabMenuSelect (key: string): void {
    if (key === START_TAB_MENU_KEY) {
        store.openStartTab()
        return
    }
    void (async () => {
        const cwd = await terminalTabApi.current?.getActivePaneCwd() ?? null
        store.openTerminalTab(key, cwd, store.activeTab?.groupId)
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
 * @description 构造标签右键菜单项：基础操作 + 分组段（各分组平铺 + 已归属时「移出分组」）
 *              + 颜色段
 * @param tab 目标标签（判断是否已归属分组）
 * @returns ContextMenuItemSpec[] 菜单项列表
 *
 */
function tabMenuItems (tab: Tab): ContextMenuItemSpec[] {
    const groupItems = config.store.tabGroups.map(group => ({
        key: `group:${group.id}`,
        label: group.name,
        swatch: group.color,
    }))
    return [
        { key: 'rename', label: t('tab.rename') },
        { key: 'close', label: t('tab.close') },
        {
            key: 'close-others',
            label: t('tab.closeOthers'),
            disabled: store.tabs.length <= 1,
            separatorBefore: true,
        },
        ...groupItems.map((item, index) => index === 0 ? { ...item, separatorBefore: true } : item),
        ...(groupOf(config.store.tabGroups, tab) ? [{ key: 'ungroup', label: t('tab.ungroup'), separatorBefore: groupItems.length === 0 }] : []),
        ...TAB_COLORS.map(item => ({
            key: `color:${item.color}`,
            label: t(`tab.colorNames.${item.name}`),
            swatch: item.color,
            separatorBefore: item.name === 'red',
        })),
    ]
}

/**
 * @description 构造分组头 chip 右键菜单项
 * @returns ContextMenuItemSpec[] 菜单项列表
 *
 */
function chipMenuItems (): ContextMenuItemSpec[] {
    return [
        { key: 'ungroup-all', label: t('tab.groupUngroupAll') },
    ]
}

/**
 * @description 处理分组头 chip 右键菜单选择
 * @param group 目标分组
 * @param key 菜单项 key
 * @returns void
 *
 */
function onChipMenuSelect (group: TabGroup, key: string): void {
    if (key === 'ungroup-all') {
        store.clearGroupMembership(group.id)
    }
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
    } else if (key === 'ungroup') {
        store.assignTabToGroup(tab.id, null)
    } else if (key.startsWith('group:')) {
        store.assignTabToGroup(tab.id, key.slice('group:'.length))
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

/**
 * @description 标签拖拽开始：记录被拖标签 id，声明 move 语义
 * @param tabId 被拖标签 id
 * @param event 拖拽事件
 * @returns void
 *
 */
function onTabDragStart (tabId: string, event: DragEvent): void {
    dragTabId.value = tabId
    event.dataTransfer!.effectAllowed = 'move'
}

/**
 * @description 标签拖拽悬停在另一标签上：放行落点并记录高亮
 * @param tabId 悬停目标标签 id
 * @param event 拖拽事件
 * @returns void
 *
 */
function onTabDragOver (tabId: string, event: DragEvent): void {
    if (!dragTabId.value) {
        return
    }
    event.preventDefault()
    event.dataTransfer!.dropEffect = 'move'
    tabDragOverId.value = tabId
}

/**
 * @description 标签拖拽释放在另一标签上：继承其归属并插到其前（resolveDrop 换算）
 * @param tabId 落点目标标签 id
 * @param event 拖拽事件
 * @returns void
 *
 */
function onTabDrop (tabId: string, event: DragEvent): void {
    event.preventDefault()
    if (dragTabId.value) {
        const drop = resolveDrop(store.tabs, { kind: 'tab', tabId })
        store.moveTabToGroup(dragTabId.value, drop.groupId, drop.beforeTabId)
    }
    resetDrag()
}

/**
 * @description 标签拖拽悬停在分组 chip 上：放行落点并记录高亮
 * @param groupId 悬停目标组 id
 * @param event 拖拽事件
 * @returns void
 *
 */
function onChipDragOver (groupId: string, event: DragEvent): void {
    if (!dragTabId.value) {
        return
    }
    event.preventDefault()
    event.dataTransfer!.dropEffect = 'move'
    chipDragOverId.value = groupId
}

/**
 * @description 标签拖拽释放在分组 chip 上：入该组末尾
 * @param groupId 落点目标组 id
 * @param event 拖拽事件
 * @returns void
 *
 */
function onChipDrop (groupId: string, event: DragEvent): void {
    event.preventDefault()
    if (dragTabId.value) {
        store.moveTabToGroup(dragTabId.value, groupId, null)
    }
    resetDrag()
}

/**
 * @description 标签区空白落点：移出分组、落到未分组末尾；子元素上的 drop 冒泡到此
 *              时 target 非区域自身，直接忽略
 * @param event 拖拽事件
 * @returns void
 *
 */
function onRegionDrop (event: DragEvent): void {
    if (event.target !== tabsRegionEl.value) {
        return
    }
    event.preventDefault()
    if (dragTabId.value) {
        store.moveTabToGroup(dragTabId.value, null, null)
    }
    resetDrag()
}

/**
 * @description 清空全部拖拽状态并把活动标签滚回可见区（拖拽重排后位置可能变化）
 * @returns void
 *
 */
function resetDrag (): void {
    dragTabId.value = null
    tabDragOverId.value = null
    chipDragOverId.value = null
    void nextTick(scrollActiveTabIntoView)
}

/**
 * @description 切换分组折叠：直改 config（走 500ms 防抖 flush，重启保留）；折叠含
 *              活动标签的组时按 activeAfterCollapse 切换激活
 * @param group 目标分组
 * @returns void
 *
 */
function toggleGroupCollapse (group: TabGroup): void {
    const collapsing = !group.collapsed
    group.collapsed = collapsing
    if (collapsing) {
        const next = activeAfterCollapse(store.tabs, config.store.tabGroups, store.activeId, group.id)
        // 走 activate 而非直改 activeId：接替标签的响铃未读标记随切换清除
        if (next && next !== store.activeId) {
            store.activate(next)
        }
    }
}

/**
 * @description 取分组的全部成员标签（含折叠隐藏的）
 * @param groupId 组 id
 * @returns Tab[] 成员标签列表
 *
 */
function groupMembers (groupId: string): Tab[] {
    return store.tabs.filter(tab => tab.groupId === groupId)
}

/**
 * @description 分组内是否有响铃未读的后台标签（折叠时 chip 上的未读提示）
 * @param groupId 组 id
 * @returns boolean 有未读返回 true
 *
 */
function groupHasAlert (groupId: string): boolean {
    return groupMembers(groupId).some(tab => store.alerts[tab.id])
}

function onAuxClick (id: string, event: MouseEvent) {
    if (event.button === 1) {
        store.closeTab(id)
    }
}
</script>

<template>
    <div class="tab-strip" :class="position === 'bottom' ? 'tab-strip--bottom' : 'tab-strip--inline'">
        <div
            ref="tabsRegionEl"
            class="tabs-region"
            data-tauri-drag-region
            @dragover.prevent
            @drop="onRegionDrop"
        >
            <template v-for="item in displayItems" :key="item.kind === 'chip' ? `chip-${item.group.id}` : item.tab.id">
                <!-- 分组头 chip：非标签元素，不受标签定宽约束；点击折叠/展开，拖入即归组 -->
                <ContextMenu
                    v-if="item.kind === 'chip'"
                    :items="chipMenuItems()"
                    @select="key => onChipMenuSelect(item.group, key)"
                >
                    <div
                        class="group-chip"
                        :class="{ collapsed: item.group.collapsed, 'drag-over': chipDragOverId === item.group.id }"
                        :title="item.group.name"
                        role="button"
                        tabindex="0"
                        @click="toggleGroupCollapse(item.group)"
                        @keydown.enter.self.prevent="toggleGroupCollapse(item.group)"
                        @dragover="onChipDragOver(item.group.id, $event)"
                        @dragleave="chipDragOverId = null"
                        @drop="onChipDrop(item.group.id, $event)"
                        @dragend="resetDrag"
                    >
                        <ChevronDown :size="12" class="chip-chevron" :class="{ collapsed: item.group.collapsed }" />
                        <span v-if="item.group.color" class="tab-color-dot" :style="{ background: item.group.color }"></span>
                        <span class="chip-name">{{ item.group.name }}</span>
                        <span v-if="item.group.collapsed" class="chip-count">×{{ groupMembers(item.group.id).length }}</span>
                        <span v-if="groupHasAlert(item.group.id)" class="tab-alert-dot"></span>
                    </div>
                </ContextMenu>

                <!-- 标签：displayItems 已过滤折叠组成员，此处渲染的均为可见标签 -->
                <ContextMenu
                    v-else
                    :items="tabMenuItems(item.tab)"
                    @select="key => onTabMenuSelect(item.tab, key)"
                >
                    <div
                        class="tab-header"
                        :data-tab-id="item.tab.id"
                        :class="{
                            active: item.tab.id === store.activeId,
                            'drag-over': tabDragOverId === item.tab.id && dragTabId !== null && dragTabId !== item.tab.id,
                        }"
                        :draggable="renamingId !== item.tab.id"
                        :title="displayTitle(item.tab)"
                        role="tab"
                        :aria-selected="item.tab.id === store.activeId"
                        tabindex="0"
                        @dragstart="onTabDragStart(item.tab.id, $event)"
                        @dragover="onTabDragOver(item.tab.id, $event)"
                        @drop="onTabDrop(item.tab.id, $event)"
                        @dragend="resetDrag"
                        @click="store.activate(item.tab.id)"
                        @auxclick="onAuxClick(item.tab.id, $event)"
                        @keydown.enter.self.prevent="store.activate(item.tab.id)"
                        @keydown.space.self.prevent="store.activate(item.tab.id)"
                    >
                        <span v-if="groupOf(config.store.tabGroups, item.tab)?.color" class="tab-group-bar" :style="{ background: groupOf(config.store.tabGroups, item.tab)?.color }"></span>
                        <span v-if="item.tab.color" class="tab-color-dot" :style="{ background: item.tab.color }"></span>
                        <!-- 后台标签响铃未读标记：激活标签在 store 层已同步清除，无需此处再判 -->
                        <span v-if="store.alerts[item.tab.id]" class="tab-alert-dot"></span>
                        <input
                            v-if="renamingId === item.tab.id"
                            :ref="setRenameInput"
                            v-model="renameValue"
                            class="tab-rename"
                            @click.stop
                            @keydown.enter.prevent="commitRename"
                            @keydown.esc.prevent="cancelRename"
                            @blur="commitRename"
                        />
                        <span v-else class="tab-title">{{ displayTitle(item.tab) }}</span>
                        <button
                            v-if="renamingId !== item.tab.id"
                            class="tab-close"
                            :title="t('commands.closeTab')"
                            @click.stop="store.closeTab(item.tab.id)"
                        >
                            <X :size="12" />
                        </button>
                    </div>
                </ContextMenu>
            </template>

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
    cursor: pointer;
    position: relative;
    /* 定宽（默认即最小宽度），标题超长省略：标题随 shell/目录上报变化时不引起标签宽度抖动；激活态 200px 见 .tab-header.active */
    width: 160px;
    min-width: 160px;
    transition: background-color 0.25s ease, color 0.25s ease, border-color 0.25s ease, width 0.25s ease;
}

/* 激活标签与内容区连通：背景取内容区底色，侧/顶描边 + 下探 1px 盖住标题栏底边线；加宽至 200px 突出当前标签 */
.tab-header.active {
    height: 31px;
    margin-bottom: -1px;
    width: 200px;
    min-width: 200px;
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

/* 响铃未读标记：右上角小圆点，绝对定位不占 flex 布局宽度（标签定宽硬约束） */
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
    cursor: pointer;
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
    cursor: pointer;
    transition: background-color 0.25s ease, color 0.25s ease;
}

.new-tab-button:hover {
    background: var(--color-accent);
    color: var(--color-accent-foreground);
}

.drag-area {
    flex: 1;
}

/* 分组头 chip：胶囊形、内容自适应宽（非标签元素，不适用 160px 定宽约束） */
.group-chip {
    display: inline-flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 4px;
    padding: 0 8px;
    height: 26px;
    align-self: center;
    margin-left: 8px;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    background: var(--color-card);
    font-size: 12px;
    color: var(--color-muted-foreground);
    cursor: pointer;
    position: relative;
    flex-shrink: 0;
    user-select: none;
    transition: background-color 0.25s ease, color 0.25s ease;
}

.group-chip:hover {
    background: color-mix(in oklch, var(--color-accent) 60%, transparent);
}

.group-chip.drag-over {
    border-color: var(--color-primary);
    color: var(--color-foreground);
}

.chip-chevron {
    flex-shrink: 0;
    transition: transform 0.25s ease;
}

.chip-chevron.collapsed {
    transform: rotate(-90deg);
}

.chip-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 120px;
}

.chip-count {
    color: var(--color-muted-foreground);
    font-variant-numeric: tabular-nums;
}

/* 成员标签的组色归属线：绝对定位不占布局宽（定宽硬约束），与 drag-over 的 inset 阴影互不冲突 */
.tab-group-bar {
    position: absolute;
    left: 0;
    top: 6px;
    bottom: 6px;
    width: 2px;
    border-radius: 1px;
    pointer-events: none;
}
</style>
