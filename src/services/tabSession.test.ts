/**
 * @description tabSession 服务测试：computeSnapshot 写侧投影（persistTabs 组、仅终端标签、
 *              只存 profileId/manualTitle/color）、normalizeTabSession 形状守卫（Task 5 行为
 *              回归）、initTabSessionSync 防抖同步链路（mutation → deep watch → 500ms 防抖 →
 *              序列化比对 → tab_session_set，无变化不重写）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import { computeSnapshot, initTabSessionSync, normalizeTabSession } from './tabSession'
import { useTabsStore } from '@/stores/tabs'
import { useConfigStore } from '@/stores/config'
import type { Tab } from '@/stores/tabs'
import type { TabGroup } from '@/stores/config'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

describe('computeSnapshot', () => {
    it('keeps only persistTabs groups with terminal tabs, in definition order', () => {
        const tabs: Tab[] = [
            { id: '1', type: 'terminal', title: '', groupId: 'keep', manualTitle: 'build', color: '#e06c75', profileId: 'p1' },
            { id: '2', type: 'terminal', title: 'osc-title', groupId: 'keep', profileId: 'p1' },
            { id: '3', type: 'terminal', title: '', groupId: 'off' },
            { id: '4', type: 'settings', title: '', groupId: 'keep' },
            { id: '5', type: 'terminal', title: '' },
        ]
        const groups: TabGroup[] = [
            { id: 'keep', name: 'k', persistTabs: true },
            { id: 'off', name: 'o', persistTabs: false },
        ]
        const snapshot = computeSnapshot(tabs, groups)
        expect(snapshot).toEqual({
            version: 1,
            entries: [{
                groupId: 'keep',
                tabs: [
                    { profileId: 'p1', manualTitle: 'build', color: '#e06c75' },
                    { profileId: 'p1' },
                ],
            }],
        })
    })

    it('keeps a persistTabs group entry even when it has no matching tabs', () => {
        const snapshot = computeSnapshot([{ id: '1', type: 'terminal', title: '' }], [{ id: 'g', name: 'n', persistTabs: true }])
        expect(snapshot).toEqual({ version: 1, entries: [{ groupId: 'g', tabs: [] }] })
    })
})

describe('normalizeTabSession', () => {
    it('rejects malformed shapes and drops unknown fields', () => {
        expect(normalizeTabSession(null)).toBeNull()
        expect(normalizeTabSession({ version: 2, entries: [] })).toBeNull()
        expect(normalizeTabSession({ version: 1, entries: [{ groupId: 1, tabs: [] }] })).toBeNull()
        expect(normalizeTabSession({ version: 1, entries: [{ groupId: 'g', tabs: [{ profileId: 'p', cwd: '/tmp' }] }] }))
            .toEqual([{ groupId: 'g', tabs: [{ profileId: 'p' }] }])
    })
})

describe('initTabSessionSync', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        vi.clearAllMocks()
        // 真实 invoke 恒返回 Promise；mock 缺省返回 undefined 会让实现的 .catch 崩溃
        vi.mocked(invoke).mockResolvedValue(null)
    })

    it('debounces mutations into one tab_session_set and skips no-op writes', async () => {
        vi.useFakeTimers()
        try {
            const store = useTabsStore()
            const config = useConfigStore()
            config.store.tabGroups.push({ id: 'g1', name: 'work', persistTabs: true })
            initTabSessionSync(store, config)
            store.openTerminalTab(undefined, null, 'g1')
            store.renameTab(store.tabs[0]!.id, 'build')
            await vi.advanceTimersByTimeAsync(600)
            expect(vi.mocked(invoke)).toHaveBeenCalledTimes(1)
            expect(vi.mocked(invoke)).toHaveBeenCalledWith('tab_session_set', expect.objectContaining({ value: expect.objectContaining({ version: 1 }) }))
            await vi.advanceTimersByTimeAsync(600)
            expect(vi.mocked(invoke)).toHaveBeenCalledTimes(1) // 无变化不重写
        } finally {
            vi.useRealTimers()
        }
    })

    it('writes again after a later mutation changes the snapshot', async () => {
        vi.useFakeTimers()
        try {
            const store = useTabsStore()
            const config = useConfigStore()
            config.store.tabGroups.push({ id: 'g1', name: 'work', persistTabs: true })
            initTabSessionSync(store, config)
            store.openTerminalTab(undefined, null, 'g1')
            await vi.advanceTimersByTimeAsync(600)
            expect(vi.mocked(invoke)).toHaveBeenCalledTimes(1)

            store.renameTab(store.tabs[0]!.id, 'build')
            await vi.advanceTimersByTimeAsync(600)
            expect(vi.mocked(invoke)).toHaveBeenCalledTimes(2)
            expect(vi.mocked(invoke)).toHaveBeenLastCalledWith('tab_session_set', {
                value: { version: 1, entries: [{ groupId: 'g1', tabs: [{ manualTitle: 'build' }] }] },
            })
        } finally {
            vi.useRealTimers()
        }
    })

    it('resets the baseline after a failed write and forwards dev_log', async () => {
        vi.useFakeTimers()
        try {
            const store = useTabsStore()
            const config = useConfigStore()
            config.store.tabGroups.push({ id: 'g1', name: 'work', persistTabs: true })
            initTabSessionSync(store, config)
            store.openTerminalTab(undefined, null, 'g1')
            vi.mocked(invoke).mockRejectedValueOnce(new Error('db locked'))
            await vi.advanceTimersByTimeAsync(600)
            const sessionSetCalls = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === 'tab_session_set')
            expect(sessionSetCalls).toHaveLength(1)
            expect(vi.mocked(invoke)).toHaveBeenCalledWith('dev_log', expect.objectContaining({ message: expect.stringContaining('flush failed') }))

            // 写失败已重置基线；无新变更时不重试
            await vi.advanceTimersByTimeAsync(600)
            expect(vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === 'tab_session_set')).toHaveLength(1)
        } finally {
            vi.useRealTimers()
        }
    })
})
