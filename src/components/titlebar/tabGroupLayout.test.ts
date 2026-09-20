import { describe, expect, it } from 'vitest'
import { activeAfterCollapse, displaySequence, resolveDrop, visibleNeighborId } from './tabGroupLayout'
import type { Tab } from '@/stores/tabs'
import type { TabGroup } from '@/stores/config'

function tab (id: string, groupId?: string): Tab {
    return { id, type: 'terminal', title: id, ...(groupId ? { groupId } : {}) }
}

function group (id: string, overrides: Partial<TabGroup> = {}): TabGroup {
    return { id, name: id, persistTabs: false, ...overrides }
}

describe('displaySequence', () => {
    it('renders every group chip first (definition order, empty groups included), then ungrouped tabs', () => {
        const groups = [group('a'), group('b', { collapsed: true })]
        const tabs = [tab('u1'), tab('a1', 'a'), tab('u2'), tab('a2', 'a'), tab('dangling', 'ghost')]
        const seq = displaySequence(tabs, groups)
        expect(seq.map(item => item.kind === 'chip' ? `chip:${item.group.id}` : item.tab.id)).toEqual([
            'chip:a', 'a1', 'a2', 'chip:b', 'u1', 'u2', 'dangling',
        ])
    })
})

describe('visibleNeighborId', () => {
    it('prefers the right neighbor and skips members of collapsed groups', () => {
        const groups = [group('a', { collapsed: true })]
        const tabs = [tab('1'), tab('a1', 'a'), tab('2'), tab('3')]
        expect(visibleNeighborId(tabs, groups, '1')).toBe('2')
        expect(visibleNeighborId(tabs, groups, '2')).toBe('3')
        expect(visibleNeighborId(tabs, groups, '3')).toBe('2')
    })

    it('falls back to the first visible tab when the closed tab was inside a collapsed group', () => {
        const groups = [group('a', { collapsed: true })]
        const tabs = [tab('1'), tab('a1', 'a'), tab('a2', 'a')]
        expect(visibleNeighborId(tabs, groups, 'a1')).toBe('1')
    })

    it('returns null when the target is the only visible tab (no self-neighbor)', () => {
        const groups = [group('a', { collapsed: true })]
        const tabs = [tab('a1', 'a'), tab('1'), tab('a2', 'a')]
        expect(visibleNeighborId(tabs, groups, '1')).toBeNull()
    })
})

describe('activeAfterCollapse', () => {
    it('moves active out of the collapsing group (right first, then left), keeps active otherwise', () => {
        const groups = [group('a'), group('b')]
        const tabs = [tab('1'), tab('a1', 'a'), tab('a2', 'a'), tab('b1', 'b'), tab('2')]
        expect(activeAfterCollapse(tabs, groups, 'a1', 'a')).toBe('b1')
        const rightOnly = [tab('1'), tab('a1', 'a'), tab('a2', 'a')]
        expect(activeAfterCollapse(rightOnly, groups, 'a2', 'a')).toBe('1')
        expect(activeAfterCollapse(tabs, groups, '1', 'a')).toBe('1')
    })
})

describe('resolveDrop', () => {
    it('chip target appends to that group', () => {
        expect(resolveDrop([tab('1')], { kind: 'chip', groupId: 'a' })).toEqual({ groupId: 'a', beforeTabId: null })
    })
    it('tab target inherits its group and inserts before it', () => {
        expect(resolveDrop([tab('1'), tab('2', 'a')], { kind: 'tab', tabId: '2' })).toEqual({ groupId: 'a', beforeTabId: '2' })
    })
    it('blank target ungroups at the end', () => {
        expect(resolveDrop([tab('1', 'a')], { kind: 'blank' })).toEqual({ groupId: null, beforeTabId: null })
    })
})
