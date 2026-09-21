import { describe, expect, it, vi } from 'vitest'

// 锁定为 windows 平台：验证档案命令的平台默认值（/bin/* 在 Windows 不存在，spawn 必败）
vi.mock('@/lib/platform', () => ({
    detectPlatform: () => 'windows' as const,
    platform: 'windows' as const,
}))

import { defaultShellCommand, fallbackProfile } from './config'

describe('windows platform shell defaults', () => {
    it('default shell command is powershell.exe', () => {
        expect(defaultShellCommand()).toBe('powershell.exe')
    })

    it('fallback profile spawns powershell on windows', () => {
        expect(fallbackProfile().command).toBe('powershell.exe')
    })
})
