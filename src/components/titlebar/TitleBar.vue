<script setup lang="ts">
import { computed, ref } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Plus, Settings, X } from 'lucide-vue-next'
import { platform } from '@/lib/platform'
import { useTabsStore } from '@/stores/tabs'

const store = useTabsStore()
const appWindow = getCurrentWindow()

const dragOverIndex = ref<number | null>(null)
const dragFromIndex = ref<number | null>(null)

const needsTrafficLightSpace = computed(() => platform === 'macos')

function toggleMaximize () {
    void appWindow.toggleMaximize()
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
            <div
                v-for="(tab, index) in store.tabs"
                :key="tab.id"
                class="tab-header"
                :class="{
                    active: tab.id === store.activeId,
                    'drag-over': dragOverIndex === index && dragFromIndex !== null && dragFromIndex !== index,
                }"
                draggable="true"
                :title="tab.title || 'Terminal'"
                @dragstart="onDragStart(index, $event)"
                @dragover="onDragOver(index, $event)"
                @drop="onDrop(index, $event)"
                @dragend="onDragEnd"
                @click="store.activate(tab.id)"
                @auxclick="onAuxClick(tab.id, $event)"
            >
                <span class="tab-title">{{ tab.title || 'Terminal' }}</span>
                <button
                    class="tab-close"
                    :title="'Close'"
                    @click.stop="store.closeTab(tab.id)"
                >
                    <X :size="12" />
                </button>
            </div>

            <button class="new-tab-button" title="New Tab" @click="store.openTerminalTab()">
                <Plus :size="14" />
            </button>
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
