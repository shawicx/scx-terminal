<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { ArrowRightLeft, ArrowUpDown, Plus, Settings, X } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { platform } from '@/lib/platform'
import { useTabsStore, type Tab } from '@/stores/tabs'
import { useConfigStore, defaultFirstProfiles, type LocalProfile, type SshProfile } from '@/stores/config'
import { useTransfersStore } from '@/stores/transfers'
import { useForwardingStore } from '@/stores/forwarding'
import { terminalTabApi } from '@/services/terminalTabsApi'
import { toggleTransferCenter } from '@/services/transferCenter'
import { groupQuickCommandSections } from '@/lib/quickCommands'
import ContextMenu, { type ContextMenuItemSpec } from '@/components/ui/ContextMenu.vue'
import DropdownMenu from '@/components/ui/DropdownMenu.vue'

const { t } = useI18n()
const store = useTabsStore()
const config = useConfigStore()
const transfersStore = useTransfersStore()
const forwardingStore = useForwardingStore()

const dragOverIndex = ref<number | null>(null)
const dragFromIndex = ref<number | null>(null)

const needsTrafficLightSpace = computed(() => platform === 'macos')

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
 * @returns ContextMenuItemSpec[] 菜单项列表
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
    <div class="title-bar">
        <!-- 双击缩放统一交给 Tauri 原生 drag-region 处理（macOS 在 mouseup 调
             internal_toggle_maximize）；自绑 @dblclick 会造成二次 toggle，窗口
             从最大化双击还原时被竞态弹回最大化 -->
        <div
            v-if="needsTrafficLightSpace"
            class="traffic-light-space"
            data-tauri-drag-region
        ></div>

        <div class="tabs-region" data-tauri-drag-region>
            <ContextMenu
                v-for="(tab, index) in store.tabs"
                :key="tab.id"
                :items="tabMenuItems()"
                @select="key => onTabMenuSelect(tab, key)"
            >
                <div
                    class="tab-header"
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

            <DropdownMenu :items="newTabMenuItems" @select="onNewTabMenuSelect">
                <button class="new-tab-button" :title="t('commands.newTab')">
                    <Plus :size="14" />
                </button>
            </DropdownMenu>
        </div>

        <div class="drag-area" data-tauri-drag-region></div>

        <!-- 传输中心指示器：运行数徽标 + 失败红点，点击唤起传输面板 -->
        <button
            class="titlebar-indicator"
            :class="{ visible: transfersStore.transfers.length > 0 }"
            :title="t('transfer.title')"
            @click="toggleTransferCenter()"
        >
            <ArrowUpDown :size="14" />
            <span v-if="transfersStore.activeTransfers.length > 0" class="indicator-badge">
                {{ transfersStore.activeTransfers.length > 99 ? '99+' : transfersStore.activeTransfers.length }}
            </span>
            <span v-else-if="transfersStore.hasFailure" class="indicator-dot"></span>
        </button>

        <!-- 隧道管理器常驻入口（兼运行指示器）：运行数徽标 + 失败红点 -->
        <button
            class="titlebar-indicator"
            :class="{ visible: forwardingStore.states.length > 0 }"
            :title="t('forward.tabTitle')"
            @click="store.openForwardingTab()"
        >
            <ArrowRightLeft :size="14" />
            <span v-if="forwardingStore.activeStates.length > 0" class="indicator-badge">
                {{ forwardingStore.activeStates.length > 99 ? '99+' : forwardingStore.activeStates.length }}
            </span>
            <span v-else-if="forwardingStore.failedStates.length > 0" class="indicator-dot"></span>
        </button>

        <button class="new-tab-button settings-button" :title="t('commands.openSettings')" @click="store.openSettingsTab()">
            <Settings :size="14" />
        </button>
    </div>
</template>

<style scoped>
.title-bar {
    display: flex;
    align-items: stretch;
    height: 38px;
    flex-shrink: 0;
    background: var(--color-card);
    border-bottom: 1px solid var(--color-border);
    user-select: none;
}

.traffic-light-space {
    width: 76px;
    flex-shrink: 0;
}

.tabs-region {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    padding: 0 4px;
    max-width: 70%;
    overflow: hidden;
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
    transition: opacity 0.25s ease, background 0.25s ease;
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
    border: none;
    border-radius: 6px;
    background: transparent;
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

.settings-button {
    align-self: center;
    margin-right: 8px;
}

/* 标题栏指示器（传输/隧道）：无任务时仍可见但弱化，有任务徽标/红点时高亮 */
.titlebar-indicator {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    align-self: center;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--color-muted-foreground);
    opacity: 0.5;
    cursor: default;
    transition: background-color 0.25s ease, color 0.25s ease, opacity 0.25s ease;
}

.titlebar-indicator.visible {
    opacity: 1;
}

.titlebar-indicator:hover {
    background: var(--color-accent);
    color: var(--color-accent-foreground);
}

.indicator-badge {
    position: absolute;
    top: -2px;
    right: -2px;
    min-width: 14px;
    height: 14px;
    padding: 0 3px;
    border-radius: 7px;
    background: var(--color-primary);
    color: var(--color-primary-foreground);
    font-size: 9px;
    line-height: 14px;
    text-align: center;
    font-variant-numeric: tabular-nums;
}

.indicator-dot {
    position: absolute;
    top: 1px;
    right: 1px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-destructive);
}
</style>
