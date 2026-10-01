import { describe, expect, it } from 'vitest'
import { findNearestSortableGroup, findSortableGroupAtPoint } from './groupDragSort'

function header (key: string): Element {
    const element = { dataset: { groupKey: key } } as unknown as Element
    Object.defineProperty(element, 'closest', {
        value: (selector: string) => selector === '[data-group-key]' ? element : null,
    })
    return element
}

function childOfHeader (key: string): Element {
    const parent = header(key)
    return {
        closest: (selector: string) => selector === '[data-group-key]' ? parent : null,
    } as unknown as Element
}

describe('findSortableGroupAtPoint', () => {
    const sections = [
        { key: 'default', sortable: false },
        { key: 'custom', sortable: true },
    ]

    it('finds a sortable section from a descendant element', () => {
        const found = findSortableGroupAtPoint(
            sections,
            12,
            24,
            () => [childOfHeader('custom')],
        )
        expect(found?.key).toBe('custom')
    })

    it('ignores virtual groups that cannot be sorted', () => {
        const found = findSortableGroupAtPoint(
            sections,
            12,
            24,
            () => [header('default')],
        )
        expect(found).toBeNull()
    })

    it('returns null when the point is outside every group header', () => {
        const found = findSortableGroupAtPoint(
            sections,
            12,
            24,
            () => [{ closest: () => null } as unknown as Element],
        )
        expect(found).toBeNull()
    })
})

describe('findNearestSortableGroup', () => {
    const sections = [
        { key: 'default', sortable: false },
        { key: 'custom', sortable: true },
        { key: 'other', sortable: true },
    ]

    it('falls back to the nearest sortable header while dragging through gaps', () => {
        const found = findNearestSortableGroup(
            sections,
            [
                { key: 'default', x: 100, y: 100 },
                { key: 'custom', x: 100, y: 160 },
                { key: 'other', x: 100, y: 260 },
            ],
            120,
            180,
        )
        expect(found?.key).toBe('custom')
    })

    it('returns null when the nearest header cannot participate in sorting', () => {
        const found = findNearestSortableGroup(
            sections,
            [
                { key: 'default', x: 100, y: 100 },
                { key: 'custom', x: 100, y: 260 },
            ],
            100,
            105,
        )
        expect(found).toBeNull()
    })

    it('returns null when no headers are available', () => {
        expect(findNearestSortableGroup(sections, [], 0, 0)).toBeNull()
    })
})
