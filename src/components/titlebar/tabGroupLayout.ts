/**
 * @description 标签分组展示序与拖拽换算的纯函数集：展示序 = 全部分组（定义序，含空组
 *              chip）在前 + 未分组标签（数组序）在后；数组相对顺序只影响「同组内」与
 *              「未分组区」的先后。
 */
import type { Tab } from '@/stores/tabs'
import type { TabGroup } from '@/stores/config'

/** 展示序列元素：分组头 chip 或标签 */
export type DisplayItem = { kind: 'chip', group: TabGroup } | { kind: 'tab', tab: Tab }

/** 拖拽落点：chip（入组）/ 标签（插到其前、继承归属）/ 空白区（移出组到末尾） */
export type DropTarget = { kind: 'chip', groupId: string } | { kind: 'tab', tabId: string } | { kind: 'blank' }

/**
 * @description 取标签所属分组（悬空 groupId 容错为未分组）
 * @param groups 全部分组定义
 * @param tab 目标标签
 * @returns TabGroup | null 未归属或组已删时返回 null
 */
export function groupOf (groups: TabGroup[], tab: Tab): TabGroup | null {
    return tab.groupId ? groups.find(group => group.id === tab.groupId) ?? null : null
}

/**
 * @description 计算标签条展示序列：全部组 chip 按定义序在前（空组也常驻，作为投放槽位），
 *              组成员按数组相对顺序紧随其 chip；未分组（含悬空引用）按数组序排在最后
 * @param tabs 标签数组（权威顺序源）
 * @param groups 分组定义（权威分组顺序源）
 * @returns DisplayItem[] 渲染直接遍历该序列
 */
export function displaySequence (tabs: Tab[], groups: TabGroup[]): DisplayItem[] {
    const items: DisplayItem[] = []
    for (const group of groups) {
        items.push({ kind: 'chip', group })
        for (const tab of tabs) {
            if (tab.groupId === group.id) {
                items.push({ kind: 'tab', tab })
            }
        }
    }
    for (const tab of tabs) {
        if (!groupOf(groups, tab)) {
            items.push({ kind: 'tab', tab })
        }
    }
    return items
}

/**
 * @description 找 tabId 在「可见标签」中的展示序邻居（折叠组成员不可见）：先右后左、
 *              不回绕，对齐现 closeTab 的邻居语义；唯一可见标签的邻居为 null；
 *              目标自身在折叠组内时回退首个可见标签
 * @param tabs 标签数组
 * @param groups 分组定义（读 collapsed 态）
 * @param tabId 目标标签 id
 * @returns string | null 无可见标签时返回 null
 */
export function visibleNeighborId (tabs: Tab[], groups: TabGroup[], tabId: string): string | null {
    const collapsedIds = new Set(
        groups.filter(group => group.collapsed)
            .flatMap(group => tabs.filter(tab => tab.groupId === group.id).map(tab => tab.id)),
    )
    const visible = displaySequence(tabs, groups)
        .filter((item): item is { kind: 'tab', tab: Tab } => item.kind === 'tab')
        .filter(item => !collapsedIds.has(item.tab.id) || item.tab.id === tabId)
    const index = visible.findIndex(item => item.tab.id === tabId)
    if (index === -1) {
        return visible[0]?.tab.id ?? null
    }
    return visible[index + 1]?.tab.id ?? visible.slice(0, index).reverse()[0]?.tab.id ?? null
}

/**
 * @description 折叠某组后的激活标签：活动标签在该组内时切到组外最近可见标签（先右后左），
 *              全无候选则保持原激活；活动标签不在该组时原样返回
 * @param tabs 标签数组
 * @param groups 分组定义
 * @param activeId 当前活动标签 id
 * @param collapsingGroupId 被折叠的组 id
 * @returns string | null 新活动标签 id
 */
export function activeAfterCollapse (tabs: Tab[], groups: TabGroup[], activeId: string | null, collapsingGroupId: string): string | null {
    const active = tabs.find(tab => tab.id === activeId)
    if (!active || active.groupId !== collapsingGroupId) {
        return activeId
    }
    const seq = displaySequence(tabs, groups)
    const chipIndex = seq.findIndex(item => item.kind === 'chip' && item.group.id === collapsingGroupId)
    const isVisible = (item: DisplayItem): item is { kind: 'tab', tab: Tab } =>
        item.kind === 'tab' && item.tab.groupId !== collapsingGroupId
    const beforeCount = chipIndex <= 0 ? 0 : seq.slice(0, chipIndex).filter(isVisible).length
    const visible = seq.filter(isVisible)
    return visible[beforeCount]?.tab.id ?? visible[beforeCount - 1]?.tab.id ?? activeId
}

/**
 * @description 翻译拖拽落点为 moveTabToGroup 参数：chip → 该组末尾；标签 → 其归属与位置；
 *              空白区 → 未分组、数组末尾
 * @param tabs 标签数组（查目标标签归属用）
 * @param target 落点描述
 * @returns 恰好是一对 moveTabToGroup(tabId, groupId, beforeTabId) 实参
 */
export function resolveDrop (tabs: Tab[], target: DropTarget): { groupId: string | null, beforeTabId: string | null } {
    if (target.kind === 'chip') {
        return { groupId: target.groupId, beforeTabId: null }
    }
    if (target.kind === 'tab') {
        const targetTab = tabs.find(tab => tab.id === target.tabId)
        return { groupId: targetTab?.groupId ?? null, beforeTabId: targetTab?.id ?? null }
    }
    return { groupId: null, beforeTabId: null }
}
