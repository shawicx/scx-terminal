import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useTabsStore } from './tabs'
import { useConfigStore, type LocalProfile, type SshProfile } from './config'

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

function sshProfile (overrides: Partial<SshProfile> = {}): SshProfile {
    return {
        id: 'ssh-test',
        type: 'ssh',
        name: 'Test Host',
        host: '10.0.0.1',
        port: 22,
        user: 'root',
        auth: 'password',
        keyId: null,
        colorScheme: null,
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

    it('assigns tabs to existing groups only', () => {
        const config = useConfigStore()
        const store = useTabsStore()
        config.store.tabGroups.push({ id: 'g1', name: 'work', persistTabs: false })
        const t1 = store.openTerminalTab()
        store.assignTabToGroup(t1.id, 'g1')
        expect(t1.groupId).toBe('g1')
        store.assignTabToGroup(t1.id, 'ghost')
        expect(t1.groupId).toBe('g1')
        store.assignTabToGroup(t1.id, null)
        expect(t1.groupId).toBeUndefined()
    })

    it('moves tabs within a group and appends on chip drop', () => {
        const config = useConfigStore()
        const store = useTabsStore()
        config.store.tabGroups.push({ id: 'g1', name: 'work', persistTabs: false })
        const a = store.openTerminalTab(undefined, null, 'g1')
        const b = store.openTerminalTab(undefined, null, 'g1')
        const c = store.openTerminalTab(undefined, null, 'g1')
        store.moveTabToGroup(a.id, 'g1', c.id) // a 插到 c 前
        expect(store.tabs.map(t => t.id)).toEqual([b.id, a.id, c.id])
        store.moveTabToGroup(a.id, 'g1', null) // 组尾
        expect(store.tabs.map(t => t.id)).toEqual([b.id, c.id, a.id])
    })

    it('ungroups tabs dropped on the blank area', () => {
        const config = useConfigStore()
        const store = useTabsStore()
        config.store.tabGroups.push({ id: 'g1', name: 'work', persistTabs: false })
        const a = store.openTerminalTab(undefined, null, 'g1')
        const b = store.openTerminalTab()
        store.moveTabToGroup(a.id, null, null)
        expect(a.groupId).toBeUndefined()
        expect(store.tabs.map(t => t.id)).toEqual([b.id, a.id])
    })

    it('clears group membership without closing tabs', () => {
        const config = useConfigStore()
        const store = useTabsStore()
        config.store.tabGroups.push({ id: 'g1', name: 'work', persistTabs: false })
        const a = store.openTerminalTab(undefined, null, 'g1')
        const b = store.openTerminalTab()
        store.clearGroupMembership('g1')
        expect(a.groupId).toBeUndefined()
        expect(store.tabs).toHaveLength(2)
        expect(store.tabs.map(t => t.id)).toEqual([a.id, b.id])
    })

    it('closeTab activates the nearest visible neighbor across groups', () => {
        const config = useConfigStore()
        const store = useTabsStore()
        config.store.tabGroups.push({ id: 'g1', name: 'work', persistTabs: false, collapsed: true })
        const t1 = store.openTerminalTab()
        store.openTerminalTab(undefined, null, 'g1') // 折叠组成员：closeTab 接替时不可见
        const t2 = store.openTerminalTab()
        store.activate(t1.id)
        store.closeTab(t1.id)
        expect(store.activeId).toBe(t2.id) // 右邻可见优先，跳过折叠组内的 hidden
    })

    it('restores persisted groups from a session snapshot', () => {
        const config = useConfigStore()
        const store = useTabsStore()
        config.store.profiles = [localProfile({ id: 'p1' })]
        config.store.tabGroups.push({ id: 'g1', name: 'work', persistTabs: true })
        const restored = store.restoreSession({
            version: 1,
            entries: [
                // 悬空组（config 中未定义，如已删除的组）→ 整组跳过
                { groupId: 'gone', tabs: [{ profileId: 'p1' }] },
                { groupId: 'g1', tabs: [{ profileId: 'p1', manualTitle: 'build', color: '#e06c75' }, {}] },
            ],
        })
        expect(restored).toBe(true)
        expect(store.tabs).toHaveLength(2)
        expect(store.tabs.every(t => t.groupId === 'g1')).toBe(true)
        expect(store.tabs[0]!.manualTitle).toBe('build')
        expect(store.tabs[0]!.color).toBe('#e06c75')
        expect(store.tabs[1]!.profileId).toBe('p1')
        expect(store.activeId).toBe(store.tabs[0]!.id)
    })

    it('returns false for empty/invalid snapshots without touching tabs', () => {
        const store = useTabsStore()
        const t1 = store.openTerminalTab()
        expect(store.restoreSession(null)).toBe(false)
        expect(store.restoreSession({ version: 99, entries: [] })).toBe(false)
        expect(store.tabs).toEqual([t1])
    })
})

describe('start 标签与设置页深链', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
    })

    it('openStartTab 单例聚焦：二次调用不新建', () => {
        const store = useTabsStore()
        const t1 = store.openStartTab()
        const t2 = store.openStartTab()
        expect(t2.id).toBe(t1.id)
        expect(store.tabs.filter(t => t.type === 'start')).toHaveLength(1)
        expect(store.activeId).toBe(t1.id)
    })

    it('closing the last tab opens the start tab（改写原 "opens a fresh one" 用例）', () => {
        const store = useTabsStore()
        const t1 = store.openTerminalTab()
        store.closeTab(t1.id)
        expect(store.tabs).toHaveLength(1)
        expect(store.tabs[0]!.type).toBe('start')
        expect(store.activeId).toBe(store.tabs[0]!.id)
    })

    it('openTerminalTab 对 ssh 档案记录最近连接', () => {
        const config = useConfigStore()
        config.store.profiles = [sshProfile({ id: 'ssh-1', name: 'prod' })]
        const store = useTabsStore()
        store.openTerminalTab('ssh-1')
        expect(config.store.recents['ssh-1']).toBeTypeOf('number')
    })

    it('openTerminalTab 对本地档案不记录最近连接', () => {
        const config = useConfigStore()
        config.store.profiles = [localProfile({ id: 'local-1', isDefault: true })]
        const store = useTabsStore()
        store.openTerminalTab('local-1')
        expect(config.store.recents).toEqual({})
    })

    it('openSettingsTab 可携带 initialPage（仅新建时生效）', () => {
        const store = useTabsStore()
        const tab = store.openSettingsTab('ssh')
        expect(tab.initialPage).toBe('ssh')
        const again = store.openSettingsTab('about')
        expect(again.id).toBe(tab.id)
        expect(again.initialPage).toBe('ssh')
    })

    it('restoreSession 不恢复 start 标签（快照归一化丢弃 type，恒为 terminal）', () => {
        const config = useConfigStore()
        config.store.profiles = [localProfile({ id: 'local-1', isDefault: true })]
        config.store.tabGroups = [{ id: 'g', name: 'G', persistTabs: true }]
        const store = useTabsStore()
        const snapshot = { version: 1, entries: [{ groupId: 'g', tabs: [{ type: 'start' }, { profileId: 'local-1' }] }] }
        store.restoreSession(snapshot)
        expect(store.tabs.length).toBeGreaterThan(0)
        expect(store.tabs.some(t => t.type === 'start')).toBe(false)
    })
})
