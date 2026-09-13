import { describe, expect, it, vi } from 'vitest'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

// 锁定为 mac 平台：默认热键的 mac 分支曾出现与 getKeyName 产出不一致的键名（回归测试目标）
vi.mock('@/lib/platform', () => ({
    detectPlatform: () => 'macos' as const,
    platform: 'macos' as const,
}))

import { deepMerge, defaultHotkeys, profilesFromShells, defaultFirstProfiles, fallbackProfile, type TerminalProfile } from './config'
import { getKeyName, metaKeyName, altKeyName, normalizeHotkeysConfig } from '@/lib/hotkeys/hotkeys'
import type { Shell } from '@/services/shells'

/** 模拟按下带修饰键的物理按键，返回 getKeyName 产出的键名 */
function pressedKeyName (key: string, code?: string): string {
    return getKeyName({
        eventName: 'keydown',
        key,
        code: code ?? key,
        metaKey: true,
        altKey: true,
    } as never)
}

describe('config deepMerge', () => {
    it('fills missing keys with defaults and keeps user values', () => {
        const target = { a: 1, b: { c: 2, d: 3 } }
        const merged = deepMerge(target, { b: { c: 99 }, e: 'ignored' }) as typeof target & { e?: string }
        expect(merged.a).toBe(1)
        expect(merged.b.c).toBe(99)
        expect(merged.b.d).toBe(3)
        expect(merged.e).toBeUndefined() // unknown keys are dropped
    })

    it('replaces non-object values wholesale', () => {
        const merged = deepMerge({ list: [1, 2, 3], flag: false }, { list: [9], flag: true })
        expect(merged.list).toEqual([9])
        expect(merged.flag).toBe(true)
    })
})

describe('config YAML round-trip', () => {
    it('serializes and parses a full config snapshot', () => {
        const snapshot = {
            terminal: { fontSize: 15, font: 'monospace', cursor: 'bar' },
            appearance: { colorScheme: 'dark' },
        }
        const parsed = parseYaml(stringifyYaml(snapshot))
        expect(parsed.terminal.fontSize).toBe(15)
        expect(parsed.appearance.colorScheme).toBe('dark')
    })

    it('parses an empty document without error', () => {
        expect(parseYaml('')).toBe(null)
    })
})

describe('default hotkeys', () => {
    it('pane navigation defaults match the keystrokes getKeyName produces', () => {
        const hotkeys = defaultHotkeys()
        expect(hotkeys['pane-forward']).toEqual([[`${metaKeyName}-${altKeyName}-${pressedKeyName('ArrowRight')}`]])
        expect(hotkeys['pane-back']).toEqual([[`${metaKeyName}-${altKeyName}-${pressedKeyName('ArrowLeft')}`]])
    })

    it('defaults stay normalized (idempotent under normalizeHotkeysConfig)', () => {
        expect(normalizeHotkeysConfig(defaultHotkeys())).toEqual(defaultHotkeys())
    })
})

describe('profiles from shells', () => {
    const shells: Shell[] = [
        { id: 'zsh', name: 'zsh', command: '/bin/zsh', args: [], default: true },
        { id: 'bash', name: 'bash', command: '/bin/bash', args: [], default: false },
    ]

    it('creates one local profile per shell with a unique id', () => {
        const profiles = profilesFromShells(shells, true)
        expect(profiles).toHaveLength(2)
        expect(profiles.every(p => p.type === 'local')).toBe(true)
        expect(new Set(profiles.map(p => p.id)).size).toBe(2)
        expect(profiles[0]).toMatchObject({ name: 'zsh', command: '/bin/zsh', loginShell: true, isDefault: true })
        expect(profiles[1]).toMatchObject({ name: 'bash', command: '/bin/bash', isDefault: false })
    })

    it('marks only the first default shell as the default profile', () => {
        const double = [...shells, { ...shells[0]!, id: 'zsh2' }]
        const profiles = profilesFromShells(double, false)
        expect(profiles.filter(p => p.isDefault)).toHaveLength(1)
        expect(profiles[0]!.loginShell).toBe(false)
    })

    it('places the default shell profile first regardless of /etc/shells order', () => {
        const etcShellsOrder: Shell[] = [
            { id: 'bash', name: 'bash', command: '/bin/bash', args: [], default: false },
            { id: 'csh', name: 'csh', command: '/bin/csh', args: [], default: false },
            { id: 'zsh', name: 'zsh', command: '/bin/zsh', args: [], default: true },
        ]
        const profiles = profilesFromShells(etcShellsOrder, true)
        expect(profiles[0]).toMatchObject({ name: 'zsh', isDefault: true })
        expect(profiles.slice(1).map(p => p.name)).toEqual(['bash', 'csh'])
    })

    it('defaultFirstProfiles moves the default profile first without mutating the input', () => {
        const input: TerminalProfile[] = [
            { id: 'p-bash', type: 'local', name: 'bash', command: '/bin/bash', args: [], env: {}, cwd: null, colorScheme: null, loginShell: true, isDefault: false },
            { id: 'p-zsh', type: 'local', name: 'zsh', command: '/bin/zsh', args: [], env: {}, cwd: null, colorScheme: null, loginShell: true, isDefault: true },
        ]
        const sorted = defaultFirstProfiles(input)
        expect(sorted[0]!.name).toBe('zsh')
        expect(input[0]!.name).toBe('bash')
    })

    it('provides a /bin/zsh fallback profile', () => {
        expect(fallbackProfile()).toMatchObject({ type: 'local', command: '/bin/zsh', loginShell: true, isDefault: true })
    })

    it('keeps SSH profile fields intact through deepMerge (profiles array replaces wholesale)', () => {
        const sshProfile = {
            id: 'ssh-abc123',
            type: 'ssh',
            name: 'build box',
            host: 'build.example.com',
            port: 2222,
            user: 'deploy',
            auth: 'publicKey',
            privateKeyPath: '/Users/scx/.ssh/id_ed25519',
            password: null,
            colorScheme: null,
            isDefault: false,
        }
        const merged = deepMerge({ profiles: [] as TerminalProfile[] }, { profiles: [sshProfile] })
        expect(merged.profiles).toEqual([sshProfile])
    })
})
