import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useTabsStore } from './tabs'
import { useConfigStore, type LocalProfile } from './config'

function localProfile (overrides: Partial<LocalProfile> = {}): LocalProfile {
    return {
        id: 'local-test',
        type: 'local',
        name: 'Test Shell',
        command: '/bin/zsh',
        args: [],
        env: {},
        cwd: null,
        colorScheme: null,
        loginShell: true,
        isDefault: false,
        ...overrides,
    }
}

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

    it('stores inherited cwd on the new tab unless the profile pins its own', () => {
        const config = useConfigStore()
        const store = useTabsStore()
        const fallback = localProfile({ id: 'local-fallback', name: 'fallback', isDefault: true })
        const pinned = localProfile({ id: 'local-pinned', name: 'pinned', cwd: '/var/root' })
        config.store.profiles = [fallback, pinned]

        const inherited = store.openTerminalTab(undefined, '/tmp/inherited')
        expect(inherited.cwd).toBe('/tmp/inherited')

        const withPinned = store.openTerminalTab(pinned.id, '/tmp/inherited')
        expect(withPinned.cwd).toBeNull()
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

    it('renaming overrides the OSC title until cleared', () => {
        const store = useTabsStore()
        const t1 = store.openTerminalTab()
        store.setTitle(t1.id, 'zsh — dev')
        store.renameTab(t1.id, 'build')
        expect(t1.manualTitle).toBe('build')
        // shell 上报的新标题不覆盖手动命名
        store.setTitle(t1.id, 'zsh — other')
        expect(t1.title).toBe('zsh — other')
        expect(t1.manualTitle).toBe('build')
        // 清空恢复跟随 shell 标题
        store.renameTab(t1.id, '  ')
        expect(t1.manualTitle).toBeUndefined()
    })

    it('toggles tab color markers', () => {
        const store = useTabsStore()
        const t1 = store.openTerminalTab()
        store.setTabColor(t1.id, '#61afef')
        expect(t1.color).toBe('#61afef')
        store.setTabColor(t1.id, '#98c379')
        expect(t1.color).toBe('#98c379')
        // 再次设置同色 = 清除
        store.setTabColor(t1.id, '#98c379')
        expect(t1.color).toBeUndefined()
    })

    it('closes other tabs and activates the kept one', () => {
        const store = useTabsStore()
        const t1 = store.openTerminalTab()
        const t2 = store.openTerminalTab()
        const t3 = store.openTerminalTab()
        store.closeOtherTabs(t2.id)
        expect(store.tabs.map(t => t.id)).toEqual([t2.id])
        expect(store.activeId).toBe(t2.id)
        expect(t1.id).not.toBe(t3.id)
    })

    it('marks and clears alerts without touching tabs', () => {
        const store = useTabsStore()
        const t1 = store.openTerminalTab()
        store.markAlert(t1.id)
        expect(store.alerts[t1.id]).toBe(true)
        store.clearAlert(t1.id)
        expect(store.alerts[t1.id]).toBeUndefined()
    })

    it('activating a tab clears its alert only', () => {
        const store = useTabsStore()
        const t1 = store.openTerminalTab()
        const t2 = store.openTerminalTab()
        store.markAlert(t1.id)
        store.markAlert(t2.id)
        store.activate(t1.id)
        expect(store.alerts[t1.id]).toBeUndefined()
        expect(store.alerts[t2.id]).toBe(true)
    })

    it('closing a tab drops its alert and clears the newly activated neighbor', () => {
        const store = useTabsStore()
        const t1 = store.openTerminalTab()
        const t2 = store.openTerminalTab()
        const t3 = store.openTerminalTab()
        store.activate(t2.id)
        store.markAlert(t1.id)
        store.markAlert(t2.id)
        store.markAlert(t3.id)
        store.closeTab(t2.id)
        // t2 已删除；接替激活的 t3 正在显示，告警清除；后台 t1 保留
        expect(store.alerts[t2.id]).toBeUndefined()
        expect(store.alerts[t3.id]).toBeUndefined()
        expect(store.alerts[t1.id]).toBe(true)
    })

    it('closing the last tab leaves no stale alert entries', () => {
        const store = useTabsStore()
        const t1 = store.openTerminalTab()
        store.markAlert(t1.id)
        store.closeTab(t1.id)
        expect(Object.keys(store.alerts)).toHaveLength(0)
    })

    it('closeOtherTabs clears the kept tab alert since it becomes active', () => {
        const store = useTabsStore()
        const t1 = store.openTerminalTab()
        const t2 = store.openTerminalTab()
        store.activate(t1.id)
        store.markAlert(t1.id)
        store.markAlert(t2.id)
        store.closeOtherTabs(t2.id)
        expect(store.alerts[t2.id]).toBeUndefined()
    })

    it('opens tabs bound to a profile and falls back to the default profile', () => {
        const config = useConfigStore()
        const bash = localProfile({ id: 'local-bash', name: 'bash', command: '/bin/bash', isDefault: true })
        config.store.profiles = [localProfile({ id: 'local-zsh' }), bash]

        const store = useTabsStore()
        const t1 = store.openTerminalTab()
        expect(t1.profileId).toBe('local-bash')       // 缺省 = 默认档案
        expect(t1.title).toBe('bash')                  // 初始标题为档案名

        const t2 = store.openTerminalTab('local-zsh')
        expect(t2.profileId).toBe('local-zsh')
        expect(t2.title).toBe('Test Shell')

        // 未知档案 id：不绑定，仍可打开（窗格侧回退默认档案）
        const t3 = store.openTerminalTab('local-missing')
        expect(t3.profileId).toBeUndefined()
    })
})
