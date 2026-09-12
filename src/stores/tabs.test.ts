import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useTabsStore } from './tabs'

describe('tabs store', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
    })

    it('opens tabs and activates them', () => {
        const store = useTabsStore()
        const t1 = store.openTerminalTab()
        const t2 = store.openTerminalTab()
        expect(store.tabs.map(t => t.id)).toEqual([t1.id, t2.id])
        expect(store.activeId).toBe(t2.id)
    })

    it('closing the active tab activates a neighbor', () => {
        const store = useTabsStore()
        const t1 = store.openTerminalTab()
        const t2 = store.openTerminalTab()
        const t3 = store.openTerminalTab()
        store.activate(t2.id)
        store.closeTab(t2.id)
        expect(store.activeId).toBe(t3.id) // neighbor to the right
        expect(store.tabs.map(t => t.id)).toEqual([t1.id, t3.id])
    })

    it('closing the last tab opens a fresh one', () => {
        const store = useTabsStore()
        const t1 = store.openTerminalTab()
        store.closeTab(t1.id)
        expect(store.tabs).toHaveLength(1)
        expect(store.activeId).toBe(store.tabs[0]!.id)
    })

    it('moves tabs', () => {
        const store = useTabsStore()
        const t1 = store.openTerminalTab()
        const t2 = store.openTerminalTab()
        const t3 = store.openTerminalTab()
        store.moveTab(2, 0)
        expect(store.tabs.map(t => t.id)).toEqual([t3.id, t1.id, t2.id])
        store.moveTab(0, 5) // out of range — no-op
        expect(store.tabs.map(t => t.id)).toEqual([t3.id, t1.id, t2.id])
    })

    it('sets titles', () => {
        const store = useTabsStore()
        const t1 = store.openTerminalTab()
        store.setTitle(t1.id, 'zsh — dev')
        expect(store.tabs[0]!.title).toBe('zsh — dev')
    })
})
