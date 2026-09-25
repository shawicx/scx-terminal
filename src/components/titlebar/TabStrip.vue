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
import { activeAfterCollapse, displaySequence, groupOf } from './tabGroupLayout'
import { useTabDnd } from './useTabDnd'
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

const {
    dragTabId, tabDragOverId, chipDragOverId, resetDrag,
    onTabDragStart, onTabDragOver, onTabDrop, onChipDragOver, onChipDrop, onRegionDrop,
} = useTabDnd({ store, regionEl: tabsRegionEl, onDropComplete: () => void nextTick(scrollActiveTabIntoView) })

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
                            'color-marked': !!item.tab.color,
                        }"
                        :style="item.tab.color ? { '--tab-mark': item.tab.color } : undefined"
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
                            <X :size="13" />
                        </button>
                    </div>
                </ContextMenu>
            </template>

            <!-- 「+」随标签排布：未溢出时紧跟最后一个标签，溢出后 sticky 吸附标签区右缘 -->
            <DropdownMenu :items="newTabMenuItems" @select="onNewTabMenuSelect">
                <button class="new-tab-button" :title="t('commands.newTab')">
                    <Plus :size="16" />
                </button>
            </DropdownMenu>
        </div>

        <!-- 条尾余白拖拽区（双击缩放交给 Tauri 原生 drag-region） -->
        <div class="drag-area" data-tauri-drag-region></div>
    </div>
</template>

<style scoped src="./TabStrip.css"></style>
