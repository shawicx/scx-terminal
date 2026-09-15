<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
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
import { fallbackProfile, useConfigStore, type TerminalProfile } from '@/stores/config'
import { terminalTabApi } from '@/services/terminalTabsApi'

const props = defineProps<{
    tabId: string
    tabActive: boolean
    profileId?: string
}>()

const tabs = useTabsStore()
const config = useConfigStore()
// 初始叶子继承标签创建时的 cwd（新标签来自上一个活动标签的活动窗格，见 commands.ts）
const tree = ref<SplitNode>(makeLeaf(tabs.tabs.find(t => t.id === props.tabId)?.cwd ?? undefined))
const activeLeafId = ref(tree.value.id)
const rootContainer = ref<InstanceType<typeof SplitContainer>>()
const paneTitles = reactive(new Map<string, string>())

// 本标签使用的配置档案：profileId 精确匹配 → 默认档案 → 兜底档案；
// 档案被编辑后此处响应式更新，新分屏窗格取新值（已运行会话不受影响）
const profile = computed<TerminalProfile>(() => {
    return config.store.profiles.find(p => p.id === props.profileId)
        ?? config.defaultProfile()
        ?? fallbackProfile()
})

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

/**
 * @description 分屏：新窗格继承源窗格会话的当前工作目录（档案显式 cwd 仍优先，见 TerminalPane）
 * @param direction 分屏方向
 * @param leafId 源叶 id（缺省为活动叶）
 * @returns Promise<void>
 *
 * @example await split('right')
 *
 */
async function split (direction: 'right' | 'down', leafId?: string): Promise<void> {
    const sourceLeafId = leafId ?? activeLeafId.value
    const cwd = await rootContainer.value?.getLeafCwd(sourceLeafId)
    const result = splitLeaf(tree.value, sourceLeafId, direction, cwd ?? undefined)
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
    sendTextToActivePane: (text: string, execute?: boolean) =>
        rootContainer.value?.sendTextToLeaf(activeLeafId.value, text, execute),
    getActivePaneCwd: async (): Promise<string | null> =>
        (await rootContainer.value?.getLeafCwd(activeLeafId.value)) ?? null,
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
            class="split-root"
            :node="tree"
            :active-leaf-id="activeLeafId"
            :tab-active="tabActive"
            :profile="profile"
            @leaf-activated="id => (activeLeafId = id)"
            @leaf-title="setPaneTitle"
            @pane-closed="closePane"
            @leaf-split="(id, direction) => split(direction, id)"
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

/* 根分栏容器必须占满可用空间：其内容（terminal-pane）为绝对定位，
   不占流内尺寸，若缺少 flex 尺寸根容器会坍塌为 0 宽度 */
.split-root {
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
}
</style>
