import { describe, expect, it } from 'vitest'
import { buildGroupViews, buildLocalSections, filterGroupViews, filterLocalSections, recentEntries, relativeTimeBucket, type StartGroupView } from './startPage'
import type { LocalGroup, LocalProfile, SshGroup, SshProfile, TerminalProfile } from '@/stores/config'

function ssh (overrides: Partial<SshProfile> = {}): SshProfile {
    return {
        id: 'ssh-x',
        type: 'ssh',
        name: 'host-x',
        host: '10.0.0.1',
        port: 22,
        user: 'root',
        auth: 'password',
        keyId: null,
        colorScheme: null,
        isDefault: false,
        ...overrides,
    } as SshProfile
}

function group (id: string, name: string): SshGroup {
    return { id, name }
}

function local (overrides: Partial<LocalProfile> = {}): LocalProfile {
    return {
        id: 'local-x',
        type: 'local',
        name: 'zsh',
        command: '/bin/zsh',
        args: [],
        env: {},
        cwd: null,
        colorScheme: null,
        loginShell: true,
        isDefault: false,
        builtin: false,
        ...overrides,
    }
}

function localGroup (id: string, name: string, builtin = false): LocalGroup {
    return { id, name, builtin }
}

describe('buildGroupViews', () => {
    it('无 groupId 与悬空 groupId 归默认组且默认组排最前', () => {
        const views = buildGroupViews(
            [ssh({ id: 'a' }), ssh({ id: 'b', groupId: 'gone' }), ssh({ id: 'c', groupId: 'g1' })],
            [group('g1', '生产')],
        )
        expect(views.map(v => v.id)).toEqual(['default', 'g1'])
        expect(views[0]!.profiles.map(p => p.id)).toEqual(['a', 'b'])
        expect(views[1]!.profiles.map(p => p.id)).toEqual(['c'])
    })

    it('默认组为空时不出现；自定义组保留（即使为空）且按 config 顺序', () => {
        const views = buildGroupViews([ssh({ id: 'c', groupId: 'g2' })], [group('g1', 'a'), group('g2', 'b')])
        expect(views.map(v => v.id)).toEqual(['g1', 'g2'])
        expect(views[0]!.profiles).toHaveLength(0)
    })

    it('本地档案不参与分组视图', () => {
        expect(buildGroupViews([{ id: 'l', type: 'local' } as TerminalProfile], [])).toEqual([])
    })
})

describe('filterGroupViews', () => {
    const views: StartGroupView[] = [
        { id: 'default', name: '', profiles: [ssh({ id: 'a', name: 'gw', host: '10.0.0.1', user: 'root' })] },
        { id: 'g1', name: '生产', profiles: [ssh({ id: 'c', name: 'db', host: '192.168.1.1', user: 'admin', groupId: 'g1' })] },
    ]
    const names = new Map([['g1', '生产']])

    it('空 query 原样返回', () => {
        expect(filterGroupViews(views, '  ', names)).toEqual(views)
    })

    it('按 name/host/user/组名不区分大小写过滤，空组隐藏', () => {
        expect(filterGroupViews(views, 'GW', names).map(v => v.id)).toEqual(['default'])
        expect(filterGroupViews(views, '192.168', names).map(v => v.id)).toEqual(['g1'])
        expect(filterGroupViews(views, 'ADMIN', names).map(v => v.id)).toEqual(['g1'])
        expect(filterGroupViews(views, '生产', names).map(v => v.id)).toEqual(['g1'])
        expect(filterGroupViews(views, 'nothing', names)).toEqual([])
    })
})

describe('buildLocalSections', () => {
    it('默认分组（未分组）置首 + 分组定义序，悬空 groupId 容错归默认分组', () => {
        const sections = buildLocalSections(
            [local({ id: 'u', name: '自由' }), local({ id: 'z', groupId: 'localgroup-zsh' }), local({ id: 'ghost', groupId: 'gone' }), ssh({ id: 's' })],
            [localGroup('localgroup-zsh', 'zsh', true), localGroup('lg1', '工作')],
        )
        expect(sections.map(s => s.group?.id ?? null)).toEqual([null, 'localgroup-zsh', 'lg1'])
        expect(sections[0]!.profiles.map(p => p.id)).toEqual(['u', 'ghost'])
        expect(sections[1]!.profiles.map(p => p.id)).toEqual(['z'])
    })
})

describe('filterLocalSections', () => {
    const sections = buildLocalSections(
        [local({ id: 'z', name: 'zsh', command: '/bin/zsh', groupId: 'localgroup-zsh' }), local({ id: 'w', name: '工作机', command: '/bin/bash', groupId: 'lg1' }), local({ id: 'u', name: '自由', command: '/usr/bin/fish' })],
        [localGroup('localgroup-zsh', 'zsh', true), localGroup('lg1', '工作')],
    )

    it('空 query 原样返回', () => {
        expect(filterLocalSections(sections, '  ')).toEqual(sections)
    })

    it('按 name/command/组名不区分大小写过滤，空段隐藏', () => {
        expect(filterLocalSections(sections, 'BASH').map(s => s.group?.id ?? null)).toEqual(['lg1'])
        expect(filterLocalSections(sections, 'fish').map(s => s.group?.id ?? null)).toEqual([null])
        expect(filterLocalSections(sections, 'zsh').map(s => s.group?.id ?? null)).toEqual(['localgroup-zsh'])
        expect(filterLocalSections(sections, 'nothing')).toEqual([])
    })
})

describe('recentEntries', () => {
    it('按时间降序、过滤悬空与非 ssh 档案、截取 limit', () => {
        const profiles = [ssh({ id: 'a', name: 'A' }), ssh({ id: 'b', name: 'B' }), { id: 'l', type: 'local' } as TerminalProfile]
        const entries = recentEntries({ a: 1, b: 2, gone: 3, l: 4 }, profiles, 2)
        expect(entries.map(e => e.profile.id)).toEqual(['b', 'a'])
    })
})

describe('relativeTimeBucket', () => {
    it('今天 → HH:mm；昨天；本周周几；更早日期', () => {
        const now = new Date(2026, 8, 22, 15, 0).getTime() // 2026-09-22 周二
        expect(relativeTimeBucket(new Date(2026, 8, 22, 9, 5).getTime(), now)).toMatchObject({ kind: 'today', time: '09:05' })
        expect(relativeTimeBucket(new Date(2026, 8, 21, 9, 5).getTime(), now).kind).toBe('yesterday')
        expect(relativeTimeBucket(new Date(2026, 8, 18, 9, 5).getTime(), now)).toMatchObject({ kind: 'weekday', weekday: 5 }) // 周五
        expect(relativeTimeBucket(new Date(2026, 8, 14, 9, 5).getTime(), now)).toMatchObject({ kind: 'date', date: '2026-09-14' }) // 上周一
    })
})
