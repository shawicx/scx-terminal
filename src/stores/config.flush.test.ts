import { describe, expect, it, vi, beforeEach } from 'vitest'

// 集成验证差异 flush 链路：store mutation → 顶层 deep watch → 防抖 → 实体级 CRUD invoke。
// mock invoke 用内存 DB 模拟 Rust 命令语义（upsert/级联），端到端断言命令调用与参数。
vi.mock('@/lib/platform', () => ({
    detectPlatform: () => 'macos' as const,
    platform: 'macos' as const,
}))
vi.mock('@/services/shells', () => ({
    listShells: vi.fn(async () => []),
}))
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}))

import { createPinia, setActivePinia } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import { useConfigStore } from './config'
import type { SshProfile, TerminalProfile } from './config'

const mockInvoke = vi.mocked(invoke)

/** 内存 DB：按 Rust config.rs 的命令语义模拟（settings/hotkeys upsert、实体增删、组删除级联） */
const db = {
    initialized: false,
    settings: new Map<string, Record<string, unknown>>(),
    hotkeys: new Map<string, unknown>(),
    profiles: new Map<string, Record<string, unknown>>(),
    quickCommands: new Map<string, Record<string, unknown>>(),
    groups: new Map<string, Record<string, unknown>>(),
    sshGroups: new Map<string, Record<string, unknown>>(),
    colorSchemes: new Map<string, Record<string, unknown>>(),
}

function resetDb (): void {
    db.initialized = false
    db.settings.clear()
    db.hotkeys.clear()
    db.profiles.clear()
    db.quickCommands.clear()
    db.groups.clear()
    db.sshGroups.clear()
    db.colorSchemes.clear()
}

beforeEach(() => {
    resetDb()
    mockInvoke.mockReset()
    mockImplementationBody()
})

/** 内存 DB 命令实现（返回 Promise<unknown> 以匹配 invoke 签名） */
function mockImplementationBody (): void {
    mockInvoke.mockImplementation(async (cmd: string, args?: unknown): Promise<unknown> => {
        const a = (args ?? {}) as Record<string, unknown>
        switch (cmd) {
            case 'config_load':
                return db.initialized
                    ? {
                        terminal: db.settings.get('terminal'),
                        appearance: db.settings.get('appearance'),
                        hotkeys: Object.fromEntries(db.hotkeys),
                        profiles: [...db.profiles.values()],
                        colorSchemes: [...db.colorSchemes.values()],
                        quickCommands: [...db.quickCommands.values()],
                        quickCommandGroups: [...db.groups.values()],
                        sshGroups: [...db.sshGroups.values()],
                    }
                    : null
            case 'config_load_legacy_yaml':
                return null
            case 'config_archive_legacy_yaml':
                return false
            case 'config_dir_path':
                return '/tmp'
            case 'settings_set_section':
                db.settings.set(a.key as string, a.value as Record<string, unknown>)
                db.initialized = true
                return null
            case 'hotkey_set':
                db.hotkeys.set(a.action as string, a.bindings)
                db.initialized = true
                return null
            case 'profile_create':
                db.profiles.set((a.profile as Record<string, unknown>).id as string, a.profile as Record<string, unknown>)
                db.initialized = true
                return null
            case 'profile_update':
                db.profiles.set((a.profile as Record<string, unknown>).id as string, a.profile as Record<string, unknown>)
                return null
            case 'profile_delete':
                db.profiles.delete(a.id as string)
                return null
            case 'quick_command_create':
            case 'quick_command_update':
                db.quickCommands.set((a.command as Record<string, unknown>).id as string, a.command as Record<string, unknown>)
                db.initialized = true
                return null
            case 'quick_command_delete':
                db.quickCommands.delete(a.id as string)
                return null
            case 'quick_command_group_create':
            case 'quick_command_group_update':
                db.groups.set((a.group as Record<string, unknown>).id as string, a.group as Record<string, unknown>)
                db.initialized = true
                return null
            case 'quick_command_group_delete': {
                db.groups.delete(a.id as string)
                for (const command of db.quickCommands.values()) {
                    if (command.groupId === a.id) {
                        delete command.groupId
                    }
                }
                return null
            }
            case 'ssh_group_create':
            case 'ssh_group_update':
                db.sshGroups.set((a.group as Record<string, unknown>).id as string, a.group as Record<string, unknown>)
                db.initialized = true
                return null
            case 'ssh_group_delete': {
                db.sshGroups.delete(a.id as string)
                for (const profile of db.profiles.values()) {
                    if (profile.type === 'ssh' && profile.groupId === a.id) {
                        delete profile.groupId
                    }
                }
                return null
            }
            case 'color_scheme_save':
                db.colorSchemes.set(a.name as string, a.data as Record<string, unknown>)
                db.initialized = true
                return null
            case 'color_scheme_delete':
                db.colorSchemes.delete(a.name as string)
                return null
            case 'dev_log':
                return null
            case 'list_shells':
                return []
            default:
                throw new Error(`unexpected invoke: ${cmd}`)
        }
    })
}

describe('config store diff-flush integration', () => {
    it('flushes appearance changes to settings_set_section after debounce', async () => {
        db.initialized = true
        db.settings.set('appearance', { colorScheme: 'ayu_light', language: 'zh-CN' })
        setActivePinia(createPinia())
        const config = useConfigStore()
        await config.load()

        config.store.appearance.colorScheme = 'Ayu Dark'
        await new Promise(resolve => setTimeout(resolve, 700))

        expect(mockInvoke).toHaveBeenCalledWith('settings_set_section', {
            key: 'appearance',
            value: expect.objectContaining({ colorScheme: 'Ayu Dark' }),
        })
        expect(db.settings.get('appearance')).toMatchObject({ colorScheme: 'Ayu Dark' })
    })

    it('flushes entity CRUD ops (profile create/update/delete, group cascade)', async () => {
        db.initialized = true
        db.profiles.set('p1', {
            id: 'p1', type: 'local', name: 'zsh', command: '/bin/zsh', args: [], env: {},
            cwd: null, colorScheme: null, loginShell: true, isDefault: true,
        } as unknown as Record<string, unknown>)
        setActivePinia(createPinia())
        const config = useConfigStore()
        await config.load()
        expect(config.store.profiles).toHaveLength(1)

        const profile: TerminalProfile = {
            id: 'p2', type: 'ssh', name: 'build', host: 'h', port: 22, user: 'u',
            auth: 'auto', keyId: null, colorScheme: null, isDefault: false,
        }
        config.store.profiles.push(profile)
        config.store.profiles[0]!.name = 'bash'
        config.store.quickCommandGroups.push({ id: 'g1', name: 'ops' })
        config.store.quickCommands.push({ id: 'q1', name: 'ls', command: 'ls', groupId: 'g1', autoRun: false })
        await new Promise(resolve => setTimeout(resolve, 700))

        expect(mockInvoke).toHaveBeenCalledWith('profile_create', { profile: expect.objectContaining({ id: 'p2' }) })
        expect(mockInvoke).toHaveBeenCalledWith('profile_update', { profile: expect.objectContaining({ id: 'p1', name: 'bash' }) })
        expect(mockInvoke).toHaveBeenCalledWith('quick_command_group_create', { group: { id: 'g1', name: 'ops' } })
        expect(mockInvoke).toHaveBeenCalledWith('quick_command_create', { command: expect.objectContaining({ id: 'q1', groupId: 'g1' }) })

        // 删除组 → 组删除命令（Rust 端级联降级）；删档案 → delete 命令
        config.store.quickCommandGroups.splice(0, 1)
        config.store.profiles.splice(1, 1)
        await new Promise(resolve => setTimeout(resolve, 700))
        expect(mockInvoke).toHaveBeenCalledWith('quick_command_group_delete', { id: 'g1' })
        expect(mockInvoke).toHaveBeenCalledWith('profile_delete', { id: 'p2' })
        expect(db.profiles.has('p2')).toBe(false)
    })

    it('flushes ssh group CRUD and cascades ungroup on delete', async () => {
        db.initialized = true
        db.profiles.set('s1', {
            id: 's1', type: 'ssh', name: 'web', host: 'h', port: 22, user: 'root',
            auth: 'auto', keyId: null, colorScheme: null, isDefault: false,
        } as unknown as Record<string, unknown>)
        setActivePinia(createPinia())
        const config = useConfigStore()
        await config.load()
        expect(config.store.profiles).toHaveLength(1)

        // 建组 + 把 SSH 档案归组：分组 create 与档案 update 都要落库
        config.store.sshGroups.push({ id: 'sg1', name: 'prod' })
        ;(config.store.profiles[0] as SshProfile).groupId = 'sg1'
        await new Promise(resolve => setTimeout(resolve, 700))
        expect(mockInvoke).toHaveBeenCalledWith('ssh_group_create', { group: { id: 'sg1', name: 'prod' } })
        expect(mockInvoke).toHaveBeenCalledWith('profile_update', { profile: expect.objectContaining({ id: 's1', groupId: 'sg1' }) })

        // 删组：组删除命令 + 前端级联把档案降级默认分组（再触发一条 profile_update）
        config.store.sshGroups.splice(0, 1)
        delete (config.store.profiles[0] as SshProfile).groupId
        await new Promise(resolve => setTimeout(resolve, 700))
        expect(mockInvoke).toHaveBeenCalledWith('ssh_group_delete', { id: 'sg1' })
        expect(db.sshGroups.has('sg1')).toBe(false)
        expect(db.profiles.get('s1')).not.toHaveProperty('groupId')
    })

    it('drops dangling ssh profile groupId on load (sanitize)', async () => {
        db.initialized = true
        db.sshGroups.set('sg1', { id: 'sg1', name: 'prod' })
        db.profiles.set('s1', {
            id: 's1', type: 'ssh', name: 'web', host: 'h', port: 22, user: 'root',
            auth: 'auto', keyId: null, colorScheme: null, isDefault: false, groupId: 'gone',
        } as unknown as Record<string, unknown>)
        setActivePinia(createPinia())
        const config = useConfigStore()
        await config.load()
        expect(config.store.profiles[0]).not.toHaveProperty('groupId')
    })

    it('persists nothing until load() completes (loaded gate)', async () => {
        db.initialized = true
        setActivePinia(createPinia())
        const config = useConfigStore()
        const loadPromise = config.load()
        config.store.terminal.fontSize = 20 // 在 load resolve 前的变更
        await loadPromise
        config.store.terminal.fontSize = 21
        await new Promise(resolve => setTimeout(resolve, 700))
        expect(mockInvoke).toHaveBeenCalledWith('settings_set_section', { key: 'terminal', value: expect.objectContaining({ fontSize: 21 }) })
    })
})
