import { describe, expect, it } from 'vitest'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { deepMerge } from './config'

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
