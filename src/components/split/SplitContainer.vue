<script setup lang="ts">
import { ref } from 'vue'
import TerminalPane from '@/components/terminal/TerminalPane.vue'
import SplitSpanner from './SplitSpanner.vue'
import { resizeChildren, type SplitNode } from './splitTree'
import type { TerminalProfile } from '@/stores/config'

const props = defineProps<{
    node: SplitNode
    activeLeafId: string
    tabActive: boolean
    profile: TerminalProfile
}>()

const emit = defineEmits<{
    (e: 'leafActivated', id: string): void
    (e: 'leafTitle', id: string, title: string): void
    (e: 'paneClosed', id: string): void
    (e: 'leafSplit', id: string, direction: 'right' | 'down'): void
    (e: 'treeUpdated', tree: SplitNode): void
}>()

const branchEl = ref<HTMLElement>()
type PaneHandle = { focus (): void, copy (): void, paste (): void, clear (): void, find (): void, getWorkingDirectory (): Promise<string | null> }
const paneRefs = new Map<string, PaneHandle>()
type ContainerHandle = { focusLeaf (id: string): void, invokeOnLeaf (id: string, method: 'copy' | 'paste' | 'clear' | 'find'): void, getLeafCwd (id: string): Promise<string | null | undefined> }
const containerRefs = new Map<string, ContainerHandle>()

function registerPane (id: string, comp: unknown) {
    if (comp) {
        paneRefs.set(id, comp as PaneHandle)
    } else {
        paneRefs.delete(id)
    }
}

function registerContainer (id: string, comp: unknown) {
    if (comp) {
        containerRefs.set(id, comp as ContainerHandle)
    } else {
        containerRefs.delete(id)
    }
}

function focusLeaf (id: string) {
    paneRefs.get(id)?.focus()
    for (const container of containerRefs.values()) {
        container?.focusLeaf(id)
    }
}

/** Runs a pane method (copy/paste/clear/find/focus) on the given leaf. */
function invokeOnLeaf (id: string, method: 'copy' | 'paste' | 'clear' | 'find'): void {
    paneRefs.get(id)?.[method]()
    for (const container of containerRefs.values()) {
        container?.invokeOnLeaf(id, method)
    }
}

/**
 * @description 查询叶窗格会话的当前工作目录（递归下钻子容器）
 * @param id 叶节点 id
 * @returns Promise<string | null | undefined> 目录路径；null = 叶存在但无 cwd；undefined = 叶不在本子树
 *
 * @example const cwd = await getLeafCwd(activeLeafId)
 *
 */
async function getLeafCwd (id: string): Promise<string | null | undefined> {
    const pane = paneRefs.get(id)
    if (pane) {
        return pane.getWorkingDirectory()
    }
    for (const container of containerRefs.values()) {
        const cwd = await container.getLeafCwd(id)
        if (cwd !== undefined) {
            return cwd
        }
    }
    return undefined
}

defineExpose({ focusLeaf, invokeOnLeaf, getLeafCwd })

function onSpannerResize (index: number, delta: number) {
    const node = props.node.type === 'branch' ? props.node : null
    if (!branchEl.value || !node) {
        return
    }
    const total = node.orientation === 'h' ? branchEl.value.clientWidth : branchEl.value.clientHeight
    if (total <= 0) {
        return
    }
    const first = node.ratios[index] ?? 1
    const second = node.ratios[index + 1] ?? 1
    const sum = first + second
    const deltaShare = (delta / total) * sum
    emit('treeUpdated', resizeChildren(props.node, node.id, index, first + deltaShare, second - deltaShare))
}
</script>

<template>
    <div
        v-if="node.type === 'leaf'"
        class="split-leaf"
        :class="{ active: tabActive && node.id === activeLeafId }"
        @mousedown="emit('leafActivated', node.id)"
    >
        <TerminalPane
            :ref="el => registerPane(node.id, el)"
            :active="tabActive && node.id === activeLeafId"
            :profile="profile"
            :initial-cwd="node.cwd ?? null"
            @title="title => emit('leafTitle', node.id, title)"
            @closed="emit('paneClosed', node.id)"
            @request-split="direction => emit('leafSplit', node.id, direction)"
        />
    </div>
    <div
        v-else-if="node.type === 'branch'"
        ref="branchEl"
        class="split-branch"
        :class="node.orientation"
    >
        <template v-for="(child, index) in node.children" :key="child.id">
            <SplitContainer
                :ref="el => registerContainer(child.id, el)"
                :node="child"
                :active-leaf-id="activeLeafId"
                :tab-active="tabActive"
                :profile="profile"
                class="split-child"
                :style="{ flexGrow: node.ratios[index] ?? 1, flexBasis: 0 }"
                @leaf-activated="id => emit('leafActivated', id)"
                @leaf-title="(id, title) => emit('leafTitle', id, title)"
                @pane-closed="id => emit('paneClosed', id)"
                @leaf-split="(id, direction) => emit('leafSplit', id, direction)"
                @tree-updated="tree => emit('treeUpdated', tree)"
            />
            <SplitSpanner
                v-if="index < node.children.length - 1"
                :orientation="node.orientation"
                @resize="delta => onSpannerResize(index, delta)"
            />
        </template>
    </div>
</template>

<script lang="ts">
export default { name: 'SplitContainer' }
</script>

<style scoped>
.split-leaf {
    position: relative;
    min-width: 0;
    min-height: 0;
}

.split-leaf.active::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    box-shadow: inset 0 0 0 1px var(--color-primary);
    opacity: 0.35;
}

.split-leaf :deep(.terminal-pane) {
    position: absolute;
    inset: 0;
}

.split-branch {
    display: flex;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
}

.split-branch.h {
    flex-direction: row;
}

.split-branch.v {
    flex-direction: column;
}

.split-child {
    min-width: 0;
    min-height: 0;
    position: relative;
}
</style>
