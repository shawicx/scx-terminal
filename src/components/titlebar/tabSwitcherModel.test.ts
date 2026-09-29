import { describe, expect, it } from 'vitest'
import {
    buildTabSwitcherGroupFilters,
    buildTabSwitcherItems,
    defaultSelectedIndex,
} from './tabSwitcherModel'
import type { Tab } from '@/stores/tabs'
import type { TabGroup } from '@/stores/config'

const typeLabels = {
    terminal: '终端',
    settings: '设置',
    sftp: 'SFTP',
    forwarding: '转发',
    start: '连接中心',
}

function tab (id: string, overrides: Partial<Tab> = {}): Tab {
    return { id, type: 'terminal', title: id, ...overrides }
}

function group (id: string, overrides: Partial<TabGroup> = {}): TabGroup {
    return { id, name: id, persistTabs: false, ...overrides }
}

describe('buildTabSwitcherItems', () => {
    it('orders known MRU entries first and filters stale recent ids', () => {
        const tabs = [tab('one'), tab('two'), tab('three')]
        const items = buildTabSwitcherItems({
            tabs,
            groups: [],
            recentIds: ['ghost', 'three', 'one'],
            query: '',
            groupFilter: { kind: 'all' },
            typeLabels,
        })
        expect(items.map(item => item.tab.id)).toEqual(['three', 'one', 'two'])
    })

    it('keeps unseen tabs in display order after known MRU entries', () => {
        const groups = [group('work'), group('infra')]
        const tabs = [
            tab('loose'),
            tab('work-1', { groupId: 'work' }),
            tab('infra-1', { groupId: 'infra' }),
            tab('work-2', { groupId: 'work' }),
        ]
        const items = buildTabSwitcherItems({
            tabs,
            groups,
            recentIds: ['infra-1'],
            query: '',
            groupFilter: { kind: 'all' },
            typeLabels,
        })
        expect(items.map(item => item.tab.id)).toEqual(['infra-1', 'work-1', 'work-2', 'loose'])
    })

    it('filters by group and ungrouped membership while preserving MRU order', () => {
        const groups = [group('work')]
        const tabs = [
            tab('loose'),
            tab('work-1', { groupId: 'work' }),
            tab('work-2', { groupId: 'work' }),
        ]
        const base = {
            tabs,
            groups,
            recentIds: ['work-2', 'work-1', 'loose'],
            query: '',
            typeLabels,
        }
        expect(buildTabSwitcherItems({ ...base, groupFilter: { kind: 'group', groupId: 'work' } })
            .map(item => item.tab.id)).toEqual(['work-2', 'work-1'])
        expect(buildTabSwitcherItems({ ...base, groupFilter: { kind: 'ungrouped' } })
            .map(item => item.tab.id)).toEqual(['loose'])
    })

    it('matches title, group name, and type; relevance wins before MRU on search', () => {
        const groups = [group('deploy')]
        const tabs = [
            tab('editor', { type: 'settings', manualTitle: 'recent editor' }),
            tab('deploy-logs', { groupId: 'deploy' }),
            tab('sftp', { type: 'sftp', title: 'files' }),
        ]
        const items = buildTabSwitcherItems({
            tabs,
            groups,
            recentIds: ['editor', 'deploy-logs', 'sftp'],
            query: 'deploy',
            groupFilter: { kind: 'all' },
            typeLabels,
        })
        expect(items.map(item => item.tab.id)).toEqual(['deploy-logs'])

        const typeItems = buildTabSwitcherItems({
            tabs,
            groups,
            recentIds: ['editor', 'deploy-logs', 'sftp'],
            query: '设置',
            groupFilter: { kind: 'all' },
            typeLabels,
        })
        expect(typeItems.map(item => item.tab.id)).toEqual(['editor'])
    })

    it('still exposes collapsed members so the switcher can reveal them on commit', () => {
        const groups = [group('work', { collapsed: true })]
        const items = buildTabSwitcherItems({
            tabs: [tab('hidden', { groupId: 'work' })],
            groups,
            recentIds: ['hidden'],
            query: 'hidden',
            groupFilter: { kind: 'all' },
            typeLabels,
        })
        expect(items).toHaveLength(1)
        expect(items[0]!.collapsed).toBe(true)
    })
})

describe('buildTabSwitcherGroupFilters', () => {
    it('builds all, defined groups, and ungrouped filters with counts and alerts', () => {
        const filters = buildTabSwitcherGroupFilters({
            tabs: [
                tab('work-1', { groupId: 'work' }),
                tab('work-2', { groupId: 'work' }),
                tab('loose'),
            ],
            groups: [group('work'), group('empty')],
            alerts: { 'work-2': true },
            labels: { allLabel: '全部', ungroupedLabel: '未分组' },
        })
        expect(filters).toEqual([
            { kind: 'all', label: '全部', count: 3, hasAlert: true },
            { kind: 'group', groupId: 'work', label: 'work', count: 2, hasAlert: true, color: undefined, collapsed: false },
            { kind: 'group', groupId: 'empty', label: 'empty', count: 0, hasAlert: false, color: undefined, collapsed: false },
            { kind: 'ungrouped', label: '未分组', count: 1, hasAlert: false },
        ])
    })
})

describe('defaultSelectedIndex', () => {
    it('selects the most recent non-active tab', () => {
        const tabs = [tab('current'), tab('previous'), tab('older')]
        const items = buildTabSwitcherItems({
            tabs,
            groups: [],
            recentIds: ['current', 'previous', 'older'],
            query: '',
            groupFilter: { kind: 'all' },
            typeLabels,
        })
        expect(defaultSelectedIndex(items, 'current')).toBe(1)
    })

    it('falls back to the first item when only the active tab remains', () => {
        const items = buildTabSwitcherItems({
            tabs: [tab('current')],
            groups: [],
            recentIds: ['current'],
            query: '',
            groupFilter: { kind: 'all' },
            typeLabels,
        })
        expect(defaultSelectedIndex(items, 'current')).toBe(0)
    })
})
