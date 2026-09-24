import { describe, expect, it, vi } from 'vitest'
import { parse as parseYaml } from 'yaml'

// 锁定为 mac 平台：默认热键的 mac 分支曾出现与 getKeyName 产出不一致的键名（回归测试目标）
vi.mock('@/lib/platform', () => ({
    detectPlatform: () => 'macos' as const,
    platform: 'macos' as const,
}))

import {
    deepMerge,
    defaultHotkeys,
    profilesFromShells,
    localGroupsFromShells,
    migrateLocalGroups,
    groupLocalProfiles,
    defaultFirstProfiles,
    fallbackProfile,
    defaultConfig,
    stableStringify,
    diffById,
    computeOps,
    captureBaseline,
    emptyBaseline,
    type TerminalProfile,
    type SshProfile,
    type LocalProfile,
    type FlushOp,
} from './config'
import { getKeyName, metaKeyName, altKeyName, normalizeHotkeysConfig, parseKeystroke } from '@/lib/hotkeys/hotkeys'
import type { Shell } from '@/services/shells'
import type { TerminalColorScheme } from '@/lib/colorSchemes'

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

    it('keeps nested terminal.suggestions defaults when a snapshot lacks the key', () => {
        const config = defaultConfig()
        deepMerge(config, { terminal: { fontSize: 16 } })
        expect(config.terminal.suggestions).toEqual(defaultConfig().terminal.suggestions)
        // 部分持久化的 suggestions（缺 sources 二级）同样由默认值兜底
        deepMerge(config, { terminal: { suggestions: { enabled: false } } })
        expect(config.terminal.suggestions).toEqual({ ...defaultConfig().terminal.suggestions, enabled: false })
    })

    it('treats null section values as absent (Rust snapshot serializes unpersisted sections as null)', () => {
        const config = defaultConfig()
        // 复现：全新安装第二次启动（terminal/appearance 行不存在）与既有库缺 advanced 行
        deepMerge(config, { terminal: null, appearance: null, advanced: null })
        expect(config.terminal).toEqual(defaultConfig().terminal)
        expect(config.appearance).toEqual(defaultConfig().appearance)
        expect(config.advanced).toEqual({ debugEnabled: false })
    })
})

describe('legacy config.yaml parsing (one-time migration source)', () => {
    it('parses a legacy config file body', () => {
        const parsed = parseYaml('terminal:\n  fontSize: 15\nappearance:\n  colorScheme: dark\n')
        expect(parsed).toEqual({ terminal: { fontSize: 15 }, appearance: { colorScheme: 'dark' } })
    })

    it('parses an empty document without error', () => {
        expect(parseYaml('')).toBe(null)
    })
})

describe('stableStringify', () => {
    it('sorts object keys so key order does not affect comparison', () => {
        expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
        expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }))
    })

    it('sorts keys of nested arrays and objects', () => {
        expect(stableStringify([{ y: 1, x: { d: 4, c: 3 } }])).toBe('[{"x":{"c":3,"d":4},"y":1}]')
    })
})

describe('diffById', () => {
    it('classifies creates, updates and deletes by id', () => {
        const saved = {
            a: stableStringify({ id: 'a', v: 1 }),
            b: stableStringify({ id: 'b', v: 2 }),
        }
        const diff = diffById([{ id: 'a', v: 9 }, { id: 'b', v: 2 }, { id: 'c', v: 3 }], saved)
        expect(diff.creates.map(item => item.id)).toEqual(['c'])
        expect(diff.updates.map(item => item.id)).toEqual(['a'])
        expect(diff.deletes).toEqual([])

        const afterDelete = diffById([{ id: 'a', v: 9 }], saved)
        expect(afterDelete.deletes).toEqual(['b'])
    })
})

describe('computeOps (entity-level diff flush)', () => {
    function localProfile (id: string, name: string): TerminalProfile {
        return { id, type: 'local', name, command: `/bin/${name}`, args: [], env: {}, cwd: null, colorScheme: null, loginShell: true, isDefault: false, builtin: false }
    }

    function scheme (name: string): TerminalColorScheme {
        return { name, foreground: '#fff', background: '#000', cursor: '#ccc', colors: ['#000000', '#ffffff'] }
    }

    it('emits nothing when the store matches the baseline', () => {
        const config = defaultConfig()
        config.profiles.push(localProfile('p1', 'zsh'))
        expect(computeOps(config, captureBaseline(config))).toEqual([])
    })

    it('emits a section set for changed terminal settings only', () => {
        const config = defaultConfig()
        const baseline = captureBaseline(config)
        config.terminal.fontSize = 18
        const ops = computeOps(config, baseline)
        expect(ops).toHaveLength(1)
        expect(ops[0]).toMatchObject({ kind: 'settingsSection', key: 'terminal' })
    })

    it('emits per-entity create/update/delete for profiles, quick commands and groups', () => {
        const config = defaultConfig()
        config.profiles.push(localProfile('p1', 'zsh'))
        config.quickCommandGroups.push({ id: 'g1', name: 'ops' })
        config.sshGroups.push({ id: 'sg1', name: 'prod' })
        config.quickCommands.push(
            { id: 'q1', name: 'list', command: 'ls', autoRun: false },
            { id: 'q2', name: 'deploy', command: 'deploy', groupId: 'g1', autoRun: true },
        )
        // 实体为空的基线（设置分片已同步）：diff 只产出实体级 create
        const emptyEntities = { ...captureBaseline(config), profiles: {}, quickCommands: {}, quickCommandGroups: {}, sshGroups: {} }
        const kinds = computeOps(config, emptyEntities).map(op => op.kind)
        expect(kinds).toEqual(expect.arrayContaining(['profileCreate', 'quickCommandGroupCreate', 'sshGroupCreate', 'quickCommandCreate', 'quickCommandCreate']))

        // 变更前的状态捕获为基线后：改名 → update，删除 → delete，只产出对应实体的操作
        const baseline = captureBaseline(config)
        config.profiles[0]!.name = 'bash'
        config.quickCommands.splice(0, 1)
        config.sshGroups[0]!.name = '生产'
        expect(computeOps(config, baseline).map(op => op.kind).sort()).toEqual(['profileUpdate', 'quickCommandDelete', 'sshGroupUpdate'])
        config.sshGroups.splice(0, 1)
        expect(computeOps(config, baseline).map(op => op.kind).sort()).toEqual(['profileUpdate', 'quickCommandDelete', 'sshGroupDelete'])
    })

    it('diffs tabGroups as entity ops', () => {
        const config = defaultConfig()
        config.tabGroups.push({ id: 'tg1', name: 'work', persistTabs: true })
        // 实体为空的基线：diff 产出 tabGroupCreate
        const emptyEntities = { ...captureBaseline(config), tabGroups: {} }
        expect(computeOps(config, emptyEntities).map(op => op.kind)).toEqual(['tabGroupCreate'])

        const baseline = captureBaseline(config)
        config.tabGroups[0]!.name = '工作'
        config.tabGroups[0]!.collapsed = true
        expect(computeOps(config, baseline).map(op => op.kind)).toEqual(['tabGroupUpdate'])
        config.tabGroups.splice(0, 1)
        expect(computeOps(config, baseline).map(op => op.kind)).toEqual(['tabGroupDelete'])
    })

    it('treats a renamed color scheme as delete-old + save-new', () => {
        const config = defaultConfig()
        config.colorSchemes.push(scheme('solar'))
        const baseline = captureBaseline(config)
        config.colorSchemes[0]!.name = 'solarized'
        const ops = computeOps(config, baseline)
        expect(ops.map(op => op.kind).sort()).toEqual(['colorSchemeDelete', 'colorSchemeSave'])
        expect(ops.find(op => op.kind === 'colorSchemeDelete')).toMatchObject({ kind: 'colorSchemeDelete', name: 'solar' })
        expect(ops.find(op => op.kind === 'colorSchemeSave')).toMatchObject({ kind: 'colorSchemeSave', name: 'solarized' })
    })

    it('clears a hotkey whose action vanished from the store', () => {
        const config = defaultConfig()
        const baseline = captureBaseline(config)
        delete config.hotkeys['copy']
        const op = computeOps(config, baseline).find(item => item.kind === 'hotkey') as Extract<FlushOp, { kind: 'hotkey' }>
        expect(op.bindings).toEqual([])
    })

    it('emits a full import against the empty baseline (legacy migration)', () => {
        const config = defaultConfig()
        const ops = computeOps(config, emptyBaseline())
        const sections = ops.filter(op => op.kind === 'settingsSection').map(op => op.kind === 'settingsSection' ? op.key : '')
        expect(sections).toEqual(['terminal', 'appearance', 'advanced', 'recents', 'monitor'])
        expect(ops.filter(op => op.kind === 'hotkey')).toHaveLength(Object.keys(defaultHotkeys()).length)
    })
})

describe('advanced settings section', () => {
    it('defaults debugEnabled to false and keeps persisted values', () => {
        const config = defaultConfig()
        expect(config).toMatchObject({ advanced: { debugEnabled: false } })
        deepMerge(config, { advanced: { debugEnabled: true } })
        expect(config.advanced.debugEnabled).toBe(true)
    })

    it('emits a section set for changed advanced settings only', () => {
        const config = defaultConfig()
        const baseline = captureBaseline(config)
        config.advanced.debugEnabled = true
        expect(computeOps(config, baseline)).toMatchObject([{ kind: 'settingsSection', key: 'advanced' }])
    })
})

describe('default hotkeys', () => {
    it('pane navigation defaults match the keystrokes getKeyName produces', () => {
        const hotkeys = defaultHotkeys()
        expect(hotkeys['pane-forward']).toEqual([[`${metaKeyName}-${altKeyName}-${pressedKeyName('ArrowRight')}`]])
        expect(hotkeys['pane-backward']).toEqual([[`${metaKeyName}-${altKeyName}-${pressedKeyName('ArrowLeft')}`]])
    })

    it('suggestions trigger default is producible by the keystroke parser', () => {
        // 输入建议手动唤起热键可被解析器产出（mac ⌥Space / 非 mac Ctrl-Space）
        expect(parseKeystroke('⌥-Space').join('-')).toBe('⌥-Space')
        expect(parseKeystroke('Ctrl-Space').join('-')).toBe('Ctrl-Space')
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
            { id: 'p-bash', type: 'local', name: 'bash', command: '/bin/bash', args: [], env: {}, cwd: null, colorScheme: null, loginShell: true, isDefault: false, builtin: false },
            { id: 'p-zsh', type: 'local', name: 'zsh', command: '/bin/zsh', args: [], env: {}, cwd: null, colorScheme: null, loginShell: true, isDefault: true, builtin: false },
        ]
        const sorted = defaultFirstProfiles(input)
        expect(sorted[0]!.name).toBe('zsh')
        expect(input[0]!.name).toBe('bash')
    })
})

describe('local groups from shells', () => {
    const shells: Shell[] = [
        { id: 'bash', name: 'bash', command: '/bin/bash', args: [], default: false },
        { id: 'zsh', name: 'zsh', command: '/bin/zsh', args: [], default: true },
    ]

    it('creates one builtin group per shell with the default shell first', () => {
        const groups = localGroupsFromShells(shells)
        expect(groups).toHaveLength(2)
        expect(groups[0]).toEqual({ id: 'localgroup-zsh', name: 'zsh', builtin: true })
        expect(groups[1]).toEqual({ id: 'localgroup-bash', name: 'bash', builtin: true })
    })

    it('generated profiles are builtin and assigned to their shell group', () => {
        const profiles = profilesFromShells(shells, true)
        expect(profiles.every(p => p.builtin)).toBe(true)
        expect(profiles.map(p => p.groupId)).toEqual(['localgroup-zsh', 'localgroup-bash'])
    })
})

describe('migrateLocalGroups', () => {
    const shells: Shell[] = [
        { id: 'zsh', name: 'zsh', command: '/bin/zsh', args: [], default: true },
        { id: 'bash', name: 'bash', command: '/bin/bash', args: [], default: false },
    ]
    const ssh: TerminalProfile = {
        id: 'ssh-1', type: 'ssh', name: 'web', host: 'h', port: 22, user: 'root',
        auth: 'auto', keyId: null, colorScheme: null, isDefault: false,
    }

    /** 存量自动生成档案的字面量（id 遵循 local-{shellId}- 前缀） */
    function generated (shellId: string, command: string, isDefault = false): TerminalProfile {
        return { id: `local-${shellId}-Ab3xY9`, type: 'local', name: shellId, command, args: [], env: {}, cwd: null, colorScheme: null, loginShell: true, isDefault, builtin: false }
    }

    it('marks auto-generated profiles builtin and assigns their default group', () => {
        const profiles = [generated('zsh', '/bin/zsh', true), generated('bash', '/bin/bash')]
        const migrated = migrateLocalGroups(profiles, shells, true)
        expect(migrated.groups.map(g => g.id)).toEqual(['localgroup-zsh', 'localgroup-bash'])
        const [zsh, bash] = migrated.profiles as Extract<TerminalProfile, { type: 'local' }>[]
        expect(zsh).toMatchObject({ builtin: true, groupId: 'localgroup-zsh', isDefault: true })
        expect(bash).toMatchObject({ builtin: true, groupId: 'localgroup-bash', isDefault: false })
    })

    it('leaves user-created profiles ungrouped and non-builtin', () => {
        const custom: TerminalProfile = {
            id: 'local-Zz1x2Y3w', type: 'local', name: 'zsh-工作', command: '/bin/zsh', args: [], env: {}, cwd: '/tmp', colorScheme: null, loginShell: true, isDefault: false, builtin: false,
        }
        const migrated = migrateLocalGroups([generated('zsh', '/bin/zsh'), custom], shells, true)
        const moved = migrated.profiles.find(p => p.id === custom.id) as Extract<TerminalProfile, { type: 'local' }>
        expect(moved.builtin).toBe(false)
        expect(moved.groupId).toBeUndefined()
        expect(moved.cwd).toBe('/tmp')
    })

    it('rebuilds a builtin profile for shells whose auto profile was deleted', () => {
        const migrated = migrateLocalGroups([generated('zsh', '/bin/zsh', true)], shells, true)
        const rebuilt = migrated.profiles.find(p => p.name === 'bash') as Extract<TerminalProfile, { type: 'local' }>
        expect(rebuilt).toMatchObject({ type: 'local', command: '/bin/bash', builtin: true, groupId: 'localgroup-bash', isDefault: false })
    })

    it('does not mutate the input array and passes ssh profiles through', () => {
        const input = [generated('zsh', '/bin/zsh'), ssh]
        const migrated = migrateLocalGroups(input, shells, true)
        expect(migrated.profiles).toContain(ssh)
        expect(input[0]).toMatchObject({ builtin: false })
        expect(migrated.profiles[0]).not.toBe(input[0])
    })
})

describe('groupLocalProfiles (settings sections)', () => {
    const groups = [
        { id: 'localgroup-zsh', name: 'zsh', builtin: true },
        { id: 'lg-work', name: '工作', builtin: false },
    ]

    /** 本地档案字面量（仅填分段所需字段） */
    function local (id: string, groupId?: string): LocalProfile {
        return { id, type: 'local', name: id, command: '/bin/zsh', args: [], env: {}, cwd: null, colorScheme: null, loginShell: true, isDefault: false, builtin: false, ...(groupId ? { groupId } : {}) }
    }

    it('puts the ungrouped (default) section first and keeps group order after', () => {
        const sections = groupLocalProfiles([local('u1'), local('w1', 'lg-work'), local('z1', 'localgroup-zsh')], groups)
        expect(sections.map(s => s.group?.id ?? null)).toEqual([null, 'localgroup-zsh', 'lg-work'])
        expect(sections[0]!.profiles.map(p => p.id)).toEqual(['u1'])
        expect(sections[1]!.profiles.map(p => p.id)).toEqual(['z1'])
    })

    it('drops dangling groupId into the default section and omits it when empty', () => {
        const sections = groupLocalProfiles([local('ghost', 'gone')], groups)
        expect(sections.map(s => s.group?.id ?? null)).toEqual([null, 'localgroup-zsh', 'lg-work'])
        expect(sections[0]!.profiles.map(p => p.id)).toEqual(['ghost'])
        expect(groupLocalProfiles([], groups)).toHaveLength(2)
    })
})

describe('profiles misc', () => {
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

    it('keeps SSH forwardings through deepMerge and flushes edits via profileUpdate', () => {
        const sshProfile: TerminalProfile = {
            id: 'ssh-1',
            type: 'ssh',
            name: 'prod',
            host: 'p.example.com',
            port: 22,
            user: 'u',
            auth: 'agent',
            keyId: null,
            colorScheme: null,
            isDefault: false,
            forwardings: [{ id: 'f1', type: 'local', listenHost: '127.0.0.1', listenPort: 8080, targetHost: 'db.internal', targetPort: 5432, autoStart: true }],
        }
        // 档案数组整体替换语义：forwardings 随档案存活（同 SSH 基础字段的既有回归口径）
        const merged = deepMerge({ profiles: [] as TerminalProfile[] }, { profiles: [sshProfile] })
        expect(merged.profiles).toEqual([sshProfile])

        // 规则编辑 → 实体级 diff 产出 profileUpdate 且携带 forwardings
        const config = defaultConfig()
        config.profiles.push(sshProfile)
        const baseline = captureBaseline(config)
        sshProfile.forwardings = [{ id: 'f1', type: 'local', listenHost: '127.0.0.1', listenPort: 8080, targetHost: 'db.internal', targetPort: 5432, autoStart: false }]
        const ops = computeOps(config, baseline)
        expect(ops).toHaveLength(1)
        const op = ops[0] as { kind: string, profile: SshProfile }
        expect(op.kind).toBe('profileUpdate')
        expect(op.profile.forwardings?.[0]?.autoStart).toBe(false)
    })
})
