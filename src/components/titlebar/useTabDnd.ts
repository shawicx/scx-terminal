/**
 * @description 标签条拖拽交互：标签互拖（继承归属并插前）、拖入分组 chip（入组末尾）、
 *              空白落点（移出分组）与悬停高亮状态（原 TabStrip.vue 的拖拽段）。
 */
import { ref, type Ref } from 'vue'
import type { Tab } from '@/stores/tabs'
import { resolveDrop } from './tabGroupLayout'

/** useTabDnd 的依赖集 */
export interface TabDndDeps {
    /** tabs store（moveTabToGroup / tabs 读取；结构子集即可） */
    store: {
        tabs: Tab[]
        moveTabToGroup: (tabId: string, groupId: string | null, beforeTabId: string | null) => void
    }
    /** 标签区域元素（空白落点判定） */
    regionEl: Ref<HTMLElement | undefined>
    /** 一次成功落点后的回调（TabStrip 用它把活动标签滚回可见区） */
    onDropComplete: () => void
}

/**
 * @description 标签拖拽交互状态与事件处理器集合
 * @param deps store/区域元素/落点回调
 * @returns 拖拽状态 refs 与七个模板事件处理器
 *
 * @example const dnd = useTabDnd({ store, regionEl, onDropComplete: () => scroll() })
 *
 */
export function useTabDnd (deps: TabDndDeps) {
    const { store, regionEl, onDropComplete } = deps
    /** 被拖拽标签 id（null = 无拖拽进行中） */
    const dragTabId = ref<string | null>(null)
    /** 拖拽悬停高亮的标签 id */
    const tabDragOverId = ref<string | null>(null)
    /** 拖拽悬停高亮的分组 chip 组 id */
    const chipDragOverId = ref<string | null>(null)

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
        if (event.target !== regionEl.value) {
            return
        }
        event.preventDefault()
        if (dragTabId.value) {
            store.moveTabToGroup(dragTabId.value, null, null)
        }
        resetDrag()
    }

    /**
     * @description 清空全部拖拽状态并通知落点完成（拖拽重排后位置可能变化）
     * @returns void
     *
     */
    function resetDrag (): void {
        dragTabId.value = null
        tabDragOverId.value = null
        chipDragOverId.value = null
        onDropComplete()
    }

    return {
        dragTabId,
        tabDragOverId,
        chipDragOverId,
        onTabDragStart,
        onTabDragOver,
        onTabDrop,
        onChipDragOver,
        onChipDrop,
        onRegionDrop,
        resetDrag,
    }
}
