<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Plus, Settings, X } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { platform } from '@/lib/platform'
import { useTabsStore, type Tab } from '@/stores/tabs'
import { useConfigStore } from '@/stores/config'
import ContextMenu, { type ContextMenuItemSpec } from '@/components/ui/ContextMenu.vue'
import DropdownMenu from '@/components/ui/DropdownMenu.vue'

const { t } = useI18n()
const store = useTabsStore()
const config = useConfigStore()
const appWindow = getCurrentWindow()

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
 * @description 「+」按钮的档案菜单项：列出全部 local 档案，默认档案带标记
 * @returns ContextMenuItemSpec[] 菜单项列表
 *
 */
const newTabMenuItems = computed<ContextMenuItemSpec[]>(() => config.store.profiles
    .filter(profile => profile.type === 'local')
    .map(profile => ({
        key: profile.id,
        label: profile.isDefault ? `${profile.name} · ${t('tab.defaultProfile')}` : profile.name,
    })))

/**
 * @description 处理「+」档案菜单选择：按档案开新标签
 * @param key 档案 id
 * @returns void
 *
 */
function onNewTabMenuSelect (key: string): void {
    store.openTerminalTab(key)
}

function toggleMaximize () {
    void appWindow.toggleMaximize()
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
    <div class="title-bar" @dblclick.self="toggleMaximize">
        <div
            v-if="needsTrafficLightSpace"
            class="traffic-light-space"
            data-tauri-drag-region
            @dblclick.stop="toggleMaximize"
        ></div>

        <div class="tabs-region">
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
                    @dragstart="onDragStart(index, $event)"
                    @dragover="onDragOver(index, $event)"
                    @drop="onDrop(index, $event)"
                    @dragend="onDragEnd"
                    @click="store.activate(tab.id)"
                    @auxclick="onAuxClick(tab.id, $event)"
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
                        :title="'Close'"
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

        <div class="drag-area" data-tauri-drag-region @dblclick.stop="toggleMaximize"></div>

        <button class="new-tab-button settings-button" title="Settings" @click="store.openSettingsTab()">
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
    align-items: center;
    gap: 6px;
    padding: 0 10px;
    height: 30px;
    border-radius: 6px 6px 0 0;
    font-size: 12px;
    color: var(--color-muted-foreground);
    cursor: default;
    position: relative;
    max-width: 200px;
    transition: all 0.25s ease;
}

.tab-header.active {
    background: var(--color-accent);
    color: var(--color-accent-foreground);
}

.tab-header:not(.active):hover {
    background: color-mix(in oklch, var(--color-accent) 60%, transparent);
}

.tab-header.drag-over {
    box-shadow: inset 2px 0 0 var(--color-primary);
}

.tab-title {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
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
    cursor: pointer;
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
    cursor: pointer;
    transition: all 0.25s ease;
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
</style>
