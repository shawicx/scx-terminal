import { describe, expect, it, vi } from 'vitest'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

// 锁定为 mac 平台：默认热键的 mac 分支曾出现与 getKeyName 产出不一致的键名（回归测试目标）
vi.mock('@/lib/platform', () => ({
    detectPlatform: () => 'macos' as const,
    platform: 'macos' as const,
}))

import { deepMerge, defaultHotkeys } from './config'
import { getKeyName, metaKeyName, altKeyName, normalizeHotkeysConfig } from '@/lib/hotkeys/hotkeys'

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
