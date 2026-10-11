/**
 * @description 跳板链解析纯函数单测：单跳/多跳顺序、环检测、自引用、引用缺失、
 *              类型非法、深度超限与 canUseAsJump 禁用逻辑。
 */
import { describe, expect, it } from 'vitest'
import { canUseAsJump, resolveJumpChain } from '@/lib/jumpChain'
import type { SshProfile } from '@/stores/config/types'

function sshProfile (id: string, overrides: Partial<SshProfile> = {}): SshProfile {
    return {
        id,
        type: 'ssh',
        name: id,
        host: `${id}.example.com`,
        port: 22,
        user: 'root',
        auth: 'auto',
        keyId: null,
        colorScheme: null,
        isDefault: false,
        ...overrides
    }
}

function index (...profiles: SshProfile[]): Map<string, SshProfile> {
    return new Map(profiles.map(p => [p.id, p]))
}

describe('resolveJumpChain', () => {
    it('returns empty hops for direct connection', () => {
        const target = sshProfile('target')
        expect(resolveJumpChain(target, index(target))).toEqual({ hops: [] })
    })

    it('resolves a single jump in connection order', () => {
        const target = sshProfile('target', { jumpProfileId: 'bastion' })
        const bastion = sshProfile('bastion', { host: '10.0.0.1', port: 2222, auth: 'agent' })
        expect(resolveJumpChain(target, index(target, bastion))).toEqual({
            hops: [{ profileId: 'bastion', host: '10.0.0.1', port: 2222, user: 'root', auth: 'agent', keyId: null }]
        })
    })

    it('resolves a multi-hop chain outermost first', () => {
        const target = sshProfile('target', { jumpProfileId: 'mid' })
        const mid = sshProfile('mid', { jumpProfileId: 'bastion' })
        const bastion = sshProfile('bastion')
        const result = resolveJumpChain(target, index(target, mid, bastion))
        expect('hops' in result && result.hops.map(h => h.profileId)).toEqual(['bastion', 'mid'])
    })

    it('detects cycles', () => {
        // a→b→c→b：链回到中间跳板（不含目标），命中 cycle
        const a = sshProfile('a', { jumpProfileId: 'b' })
        const b = sshProfile('b', { jumpProfileId: 'c' })
        const c = sshProfile('c', { jumpProfileId: 'b' })
        const result = resolveJumpChain(a, index(a, b, c))
        expect('error' in result && result.error.kind).toBe('cycle')
    })

    it('detects a chain returning to the target as self reference', () => {
        // a→b→a：链回到目标自身，优先命中 selfReference
        const a = sshProfile('a', { jumpProfileId: 'b' })
        const b = sshProfile('b', { jumpProfileId: 'a' })
        const result = resolveJumpChain(a, index(a, b))
        expect('error' in result && result.error.kind).toBe('selfReference')
    })

    it('detects self reference', () => {
        const a = sshProfile('a', { jumpProfileId: 'a' })
        const result = resolveJumpChain(a, index(a))
        expect('error' in result && result.error.kind).toBe('selfReference')
    })

    it('reports missing referenced profile', () => {
        const target = sshProfile('target', { jumpProfileId: 'gone' })
        const result = resolveJumpChain(target, index(target))
        expect('error' in result && result.error.kind).toBe('missing')
    })

    it('rejects non-ssh jump profile', () => {
        const target = sshProfile('target', { jumpProfileId: 'j' })
        const notSsh = { ...sshProfile('j'), type: 'local' } as unknown as SshProfile
        const result = resolveJumpChain(target, index(target, notSsh))
        expect('error' in result && result.error.kind).toBe('notSsh')
    })

    it('enforces depth limit', () => {
        const profiles: SshProfile[] = [sshProfile('target', { jumpProfileId: 'p0' })]
        for (let i = 0; i < 12; i++) {
            profiles.push(sshProfile(`p${i}`, { jumpProfileId: `p${i + 1}` }))
        }
        const result = resolveJumpChain(profiles[0], index(...profiles))
        expect('error' in result && result.error.kind).toBe('tooDeep')
    })
})

describe('canUseAsJump', () => {
    it('excludes self and non-ssh candidates', () => {
        const target = sshProfile('target')
        expect(canUseAsJump(target, target, index(target))).toBe(false)
        const local = { ...sshProfile('l'), type: 'local' } as unknown as SshProfile
        expect(canUseAsJump(target, local, index(target, local))).toBe(false)
    })

    it('excludes candidates whose chain contains the target (would form a cycle)', () => {
        const target = sshProfile('target')
        const bastion = sshProfile('bastion', { jumpProfileId: 'target' })
        expect(canUseAsJump(target, bastion, index(target, bastion))).toBe(false)
    })

    it('accepts a valid candidate', () => {
        const target = sshProfile('target')
        const bastion = sshProfile('bastion')
        expect(canUseAsJump(target, bastion, index(target, bastion))).toBe(true)
    })
})
