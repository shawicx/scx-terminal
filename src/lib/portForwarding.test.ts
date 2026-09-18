/**
 * @description 端口转发纯逻辑单测：类型白名单 / 端口归一化 / 规则 sanitize /
 *              展示文案 / autoStart 筛选 / 规则 → 启动参数映射
 */
import { describe, expect, it } from 'vitest'
import {
    autoStartRules, describeForward, isForwardKind, normalizePort,
    ruleToSpec, sanitizeForwarding, sanitizeForwardings, type PortForwarding,
} from './portForwarding'

describe('isForwardKind', () => {
    it('accepts the three kinds and rejects others', () => {
        expect(isForwardKind('local')).toBe(true)
        expect(isForwardKind('remote')).toBe(true)
        expect(isForwardKind('dynamic')).toBe(true)
        expect(isForwardKind('socks')).toBe(false)
        expect(isForwardKind(42)).toBe(false)
    })
})

describe('normalizePort', () => {
    it('accepts integers within range and numeric strings', () => {
        expect(normalizePort(8080, true)).toBe(8080)
        expect(normalizePort('5432', false)).toBe(5432)
        expect(normalizePort(80.9, true)).toBe(80)
    })

    it('allows zero only for listen ports and rejects out-of-range', () => {
        expect(normalizePort(0, true)).toBe(0)
        expect(normalizePort(0, false)).toBeNull()
        expect(normalizePort(-1, true)).toBeNull()
        expect(normalizePort(65536, true)).toBeNull()
        expect(normalizePort('abc', true)).toBeNull()
    })
})

describe('sanitizeForwarding', () => {
    it('fills defaults and keeps valid targets for local/remote', () => {
        const rule = sanitizeForwarding({ id: 'r1', type: 'local', listenPort: 8080, targetHost: 'db.internal', targetPort: 5432 })
        expect(rule).toEqual({
            id: 'r1',
            type: 'local',
            listenHost: '127.0.0.1',
            listenPort: 8080,
            targetHost: 'db.internal',
            targetPort: 5432,
            autoStart: false,
        })
    })

    it('drops targets for dynamic rules', () => {
        const rule = sanitizeForwarding({ id: 'r2', type: 'dynamic', listenHost: '', listenPort: 0, targetHost: 'x', targetPort: 1, autoStart: true })
        expect(rule).toMatchObject({ type: 'dynamic', listenHost: '127.0.0.1', listenPort: 0, targetHost: null, targetPort: null, autoStart: true })
    })

    it('rejects invalid kind / missing target / bad ports and generates id when absent', () => {
        expect(sanitizeForwarding({ type: 'x' })).toBeNull()
        expect(sanitizeForwarding({ type: 'local', targetHost: 'db' })).toBeNull()
        expect(sanitizeForwarding({ type: 'local', listenPort: 70000, targetHost: 'db', targetPort: 5432 })).toBeNull()
        const withId = sanitizeForwarding({ type: 'remote', listenHost: '0.0.0.0', listenPort: 1, targetHost: '127.0.0.1', targetPort: 3000 })
        expect(withId?.id).toMatch(/^fwd-/)
    })
})

describe('sanitizeForwardings', () => {
    it('returns undefined for missing or non-array fields', () => {
        expect(sanitizeForwardings(undefined)).toBeUndefined()
        expect(sanitizeForwardings(null)).toBeUndefined()
        expect(sanitizeForwardings('x')).toBeUndefined()
    })

    it('filters invalid entries and keeps the rest', () => {
        const rules = sanitizeForwardings([
            { id: 'a', type: 'local', listenPort: 1, targetHost: 'h', targetPort: 2 },
            { type: 'bogus' },
            { id: 'c', type: 'dynamic', listenPort: 0 },
        ])
        expect(rules?.map(rule => rule.id)).toEqual(['a', 'c'])
    })
})

describe('describeForward', () => {
    it('formats listen → target for local/remote and SOCKS5 for dynamic', () => {
        expect(describeForward({ kind: 'local', listenHost: '127.0.0.1', listenPort: 8080, targetHost: 'db', targetPort: 5432 }))
            .toBe('127.0.0.1:8080 → db:5432')
        expect(describeForward({ kind: 'remote', listenHost: '127.0.0.1', listenPort: 9000, targetHost: '127.0.0.1', targetPort: 3000 }))
            .toBe('127.0.0.1:9000 → 127.0.0.1:3000')
        expect(describeForward({ kind: 'dynamic', listenHost: '127.0.0.1', listenPort: 1080, targetHost: null, targetPort: null }))
            .toBe('127.0.0.1:1080 · SOCKS5')
    })
})

describe('autoStartRules / ruleToSpec', () => {
    const profile: { forwardings: PortForwarding[] } = {
        forwardings: [
            { id: 'a', type: 'local', listenHost: '127.0.0.1', listenPort: 1, targetHost: 'h', targetPort: 2, autoStart: true },
            { id: 'b', type: 'dynamic', listenHost: '127.0.0.1', listenPort: 3, targetHost: null, targetPort: null, autoStart: false },
        ],
    }

    it('keeps only autoStart rules and tolerates missing field', () => {
        expect(autoStartRules(profile).map(rule => rule.id)).toEqual(['a'])
        expect(autoStartRules({})).toEqual([])
    })

    it('maps a rule to a forward spec carrying its ruleId', () => {
        expect(ruleToSpec('ssh-1', profile.forwardings[0])).toEqual({
            sshId: 'ssh-1',
            kind: 'local',
            listenHost: '127.0.0.1',
            listenPort: 1,
            targetHost: 'h',
            targetPort: 2,
            ruleId: 'a',
        })
    })
})
