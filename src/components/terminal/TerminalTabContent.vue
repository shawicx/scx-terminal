<script setup lang="ts">
import { onBeforeUnmount, reactive, ref, watch } from 'vue'
import SplitContainer from '@/components/split/SplitContainer.vue'
import {
    listLeaves,
    makeLeaf,
    neighborLeaf,
    removeLeaf,
    splitLeaf,
    type SplitNode,
} from '@/components/split/splitTree'
import { useTabsStore } from '@/stores/tabs'
import { terminalTabApi } from '@/services/terminalTabsApi'

const props = defineProps<{
    tabId: string
    tabActive: boolean
}>()

const tabs = useTabsStore()
const tree = ref<SplitNode>(makeLeaf())
const activeLeafId = ref(tree.value.id)
const rootContainer = ref<InstanceType<typeof SplitContainer>>()
const paneTitles = reactive(new Map<string, string>())

function applyActiveTitle () {
    const title = paneTitles.get(activeLeafId.value)
    if (title) {
        tabs.setTitle(props.tabId, title)
    }
}

function setPaneTitle (leafId: string, title: string) {
    if (!title) {
        return
    }
    paneTitles.set(leafId, title)
    if (leafId === activeLeafId.value) {
        tabs.setTitle(props.tabId, title)
    }
}

function split (direction: 'right' | 'down') {
    const result = splitLeaf(tree.value, activeLeafId.value, direction)
    if (result) {
        tree.value = result.tree
        activeLeafId.value = result.newLeafId
    }
}

function closePane (id: string) {
    if (tree.value.type === 'leaf') {
        tabs.closeTab(props.tabId)
        return
    }
    const neighbor = neighborLeaf(tree.value, id, -1) ?? neighborLeaf(tree.value, id, 1)
    const updated = removeLeaf(tree.value, id)
    paneTitles.delete(id)
    if (updated) {
        tree.value = updated
        activeLeafId.value = neighbor && neighbor.id !== id ? neighbor.id : listLeaves(updated)[0]!.id
        applyActiveTitle()
    } else {
        tabs.closeTab(props.tabId)
    }
}

function navigatePane (delta: 1 | -1) {
    const neighbor = neighborLeaf(tree.value, activeLeafId.value, delta)
    if (neighbor) {
        activeLeafId.value = neighbor.id
        applyActiveTitle()
        rootContainer.value?.focusLeaf(neighbor.id)
    }
}

// expose the active tab's actions to app-level commands (palette / hotkeys)
const tabApi = {
    split,
    closePane: () => closePane(activeLeafId.value),
    navigatePane,
    copy: () => rootContainer.value?.invokeOnLeaf(activeLeafId.value, 'copy'),
    paste: () => rootContainer.value?.invokeOnLeaf(activeLeafId.value, 'paste'),
    clear: () => rootContainer.value?.invokeOnLeaf(activeLeafId.value, 'clear'),
    find: () => rootContainer.value?.invokeOnLeaf(activeLeafId.value, 'find'),
}

watch(() => props.tabActive, active => {
    if (active) {
        terminalTabApi.current = tabApi
        rootContainer.value?.focusLeaf(activeLeafId.value)
    } else if (terminalTabApi.current === tabApi) {
        terminalTabApi.current = null
    }
}, { immediate: true })

onBeforeUnmount(() => {
    if (terminalTabApi.current === tabApi) {
        terminalTabApi.current = null
    }
})
</script>

<template>
    <div class="terminal-tab-content">
        <SplitContainer
            ref="rootContainer"
            :node="tree"
            :active-leaf-id="activeLeafId"
            :tab-active="tabActive"
            @leaf-activated="id => (activeLeafId = id)"
            @leaf-title="setPaneTitle"
            @pane-closed="closePane"
            @tree-updated="updated => (tree = updated)"
        />
    </div>
</template>

<style scoped>
.terminal-tab-content {
    height: 100%;
    display: flex;
    transition: all 0.125s ease;
}
</style>
