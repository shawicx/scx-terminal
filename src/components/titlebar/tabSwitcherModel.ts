/**
 * @description 标签页切换器的纯计算模型：统一处理 MRU 排序、分组过滤、模糊搜索
 *              与左侧分组过滤栏数据，避免组件内散落交互规则。
 */
import { fuzzyMatch } from '@/lib/utils/fuzzy'
import type { Tab, TabType } from '@/stores/tabs'
import type { TabGroup } from '@/stores/config'
import { displaySequence, groupOf } from './tabGroupLayout'

/** 分组过滤值：全部、某个已定义分组、未分组 */
export type TabGroupFilter =
    | { kind: 'all' }
    | { kind: 'group', groupId: string }
    | { kind: 'ungrouped' }

/** 标签类型本地化文案（搜索与展示共用） */
export type TabTypeLabels = Record<TabType, string>

/** 切换器右侧列表条目 */
export interface TabSwitcherItem {
    tab: Tab
    /** 显示标题：手动重命名 > shell 上报 > 类型文案 */
    title: string
    /** 所属分组；悬空引用按未分组处理 */
    group: TabGroup | null
    /** 本地化标签类型 */
    typeLabel: string
    /** 所在分组当前是否折叠 */
    collapsed: boolean
    /** 搜索匹配分；空搜索为 0 */
    score: number
}

/** 左侧分组过滤条目 */
export interface TabSwitcherGroupFilter {
    kind: TabGroupFilter['kind']
    groupId?: string
    label: string
    count: number
    hasAlert: boolean
    color?: string
    collapsed?: boolean
}

/** 构造右侧列表的输入 */
export interface TabSwitcherItemsInput {
    tabs: Tab[]
    groups: TabGroup[]
    recentIds: string[]
    query: string
    groupFilter: TabGroupFilter
    typeLabels: TabTypeLabels
}

/** 构造左侧过滤栏的输入 */
export interface TabSwitcherGroupFiltersInput {
    tabs: Tab[]
    groups: TabGroup[]
    alerts: Record<string, true>
    labels: { allLabel: string, ungroupedLabel: string }
}

/**
 * @description 取标签显示标题：手动重命名优先于 shell 上报标题，最后回退类型文案
 * @param tab 标签对象
 * @param typeLabels 标签类型本地化文案
 * @returns string 显示标题
 *
 * @example tabDisplayName(tab, typeLabels) // 'build'
 *
 */
export function tabDisplayName (tab: Tab, typeLabels: TabTypeLabels): string {
    return tab.manualTitle || tab.title || typeLabels[tab.type]
}

/**
 * @description 构造切换器右侧列表：先按分组过滤，再按标题/分组/类型模糊搜索；
 *              空搜索按 MRU，未知 recent id 自动丢弃，未见标签按标签条展示序兜底
 * @param input 标签、分组、MRU、搜索词、过滤值与类型文案
 * @returns TabSwitcherItem[] 可直接渲染的列表
 *
 * @example buildTabSwitcherItems({ tabs, groups, recentIds, query: 'build', groupFilter: { kind: 'all' }, typeLabels })
 *
 */
export function buildTabSwitcherItems (input: TabSwitcherItemsInput): TabSwitcherItem[] {
    const { tabs, groups, recentIds, query, groupFilter, typeLabels } = input
    const validTabs = new Map(tabs.map(tab => [tab.id, tab]))
    const seenRecentIds = new Set<string>()
    const recentRank = new Map(recentIds
        .map((id, index) => validTabs.get(id) ? [id, index] as const : null)
        .filter((entry): entry is readonly [string, number] => entry !== null))
    const displayOrder = displaySequence(tabs, groups)
        .filter((item): item is { kind: 'tab', tab: Tab } => item.kind === 'tab')
        .map(item => item.tab)
    const orderedTabs = [
        ...recentIds
            .filter(id => {
                if (seenRecentIds.has(id) || !validTabs.has(id)) {
                    return false
                }
                seenRecentIds.add(id)
                return true
            })
            .map(id => validTabs.get(id)!),
        ...displayOrder.filter(tab => !recentRank.has(tab.id)),
    ]

    const normalizedQuery = query.trim()
    const items = orderedTabs
        .filter(tab => {
            if (groupFilter.kind === 'group') {
                return tab.groupId === groupFilter.groupId && !!groupOf(groups, tab)
            }
            if (groupFilter.kind === 'ungrouped') {
                return !groupOf(groups, tab)
            }
            return true
        })
        .map(tab => {
            const group = groupOf(groups, tab)
            const title = tabDisplayName(tab, typeLabels)
            const typeLabel = typeLabels[tab.type]
            const titleScore = fuzzyMatch(normalizedQuery, title)
            const groupScore = group ? fuzzyMatch(normalizedQuery, group.name) : null
            const typeScore = fuzzyMatch(normalizedQuery, typeLabel)
            const scores = [
                titleScore === null ? null : titleScore * 1.5,
                groupScore,
                typeScore === null ? null : typeScore * 0.75,
            ].filter((score): score is number => score !== null)
            const score = scores.length ? Math.max(...scores) : null
            return {
                tab,
                title,
                group,
                typeLabel,
                collapsed: group?.collapsed ?? false,
                score: score ?? -Infinity,
            }
        })

    if (!normalizedQuery) {
        return items
    }
    return items
        .filter(item => Number.isFinite(item.score))
        .sort((a, b) => b.score - a.score ||
            (recentRank.get(a.tab.id) ?? Number.MAX_SAFE_INTEGER) -
            (recentRank.get(b.tab.id) ?? Number.MAX_SAFE_INTEGER))
}

/**
 * @description 构造左侧分组过滤栏：全部、各定义分组、未分组；含成员数与聚合未读状态
 * @param input 标签、分组、未读表与本地化基础文案
 * @returns TabSwitcherGroupFilter[] 过滤按钮数据
 *
 * @example buildTabSwitcherGroupFilters({ tabs, groups, alerts, labels })
 *
 */
export function buildTabSwitcherGroupFilters (input: TabSwitcherGroupFiltersInput): TabSwitcherGroupFilter[] {
    const { tabs, groups, alerts, labels } = input
    const hasAlert = (predicate: (tab: Tab) => boolean): boolean =>
        tabs.some(tab => predicate(tab) && !!alerts[tab.id])
    const filters: TabSwitcherGroupFilter[] = [{
        kind: 'all',
        label: labels.allLabel,
        count: tabs.length,
        hasAlert: hasAlert(() => true),
    }]
    for (const group of groups) {
        filters.push({
            kind: 'group',
            groupId: group.id,
            label: group.name,
            count: tabs.filter(tab => tab.groupId === group.id).length,
            hasAlert: hasAlert(tab => tab.groupId === group.id),
            ...(group.color ? { color: group.color } : {}),
            collapsed: group.collapsed ?? false,
        })
    }
    const groupIds = new Set(groups.map(group => group.id))
    filters.push({
        kind: 'ungrouped',
        label: labels.ungroupedLabel,
        count: tabs.filter(tab => !tab.groupId || !groupIds.has(tab.groupId)).length,
        hasAlert: hasAlert(tab => !tab.groupId || !groupIds.has(tab.groupId)),
    })
    return filters
}

/**
 * @description 计算切换器打开/过滤后的默认选中项：优先最近使用的非当前标签
 * @param items 当前可见切换器条目
 * @param activeId 当前活动标签 id
 * @returns number 选中索引；空列表返回 0
 *
 * @example defaultSelectedIndex(items, activeId)
 *
 */
export function defaultSelectedIndex (items: TabSwitcherItem[], activeId: string | null): number {
    if (items.length === 0) {
        return 0
    }
    return Math.max(0, items.findIndex(item => item.tab.id !== activeId))
}
