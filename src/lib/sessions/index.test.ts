/**
 * @description 会话工厂单元测试：按档案 type 分发到 LocalSession / SshSession / MoshSession
 */
import { describe, expect, it } from 'vitest'
import { createSessionForProfile } from './index'
import { LocalSession } from './localSession'
import { SshSession } from './sshSession'
import { MoshSession } from './moshSession'
import type { LocalProfile, SshProfile, MoshProfile } from '@/stores/config'

const localProfile = { id: 'l1', type: 'local' } as LocalProfile
const sshProfile = { id: 's1', type: 'ssh' } as SshProfile
const moshProfile = { id: 'm1', type: 'mosh' } as MoshProfile

describe('createSessionForProfile', () => {
    it('local 档案创建 LocalSession', () => {
        expect(createSessionForProfile(localProfile, {})).toBeInstanceOf(LocalSession)
    })

    it('ssh 档案创建 SshSession', () => {
        expect(createSessionForProfile(sshProfile, {})).toBeInstanceOf(SshSession)
    })

    it('mosh 档案创建 MoshSession', () => {
        expect(createSessionForProfile(moshProfile, {})).toBeInstanceOf(MoshSession)
    })
})
