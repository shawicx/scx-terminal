import { describe, expect, it } from 'vitest'
import {
    defaultDarkColorScheme,
    defaultLightColorScheme,
    builtinColorSchemes,
    findColorScheme,
    resolveColorScheme,
} from './colorSchemes'
import {
    deriveChromeTokens,
    isColorSchemeDark,
    mixColors,
    parseHexColor,
    rgbaToCss,
} from './schemeColors'

describe('colorSchemes', () => {
    it('provides a non-empty builtin scheme library with unique names', () => {
        // 严格复刻 Tabby：2 套核心默认 + 社区全集（191 套）
        expect(builtinColorSchemes.length).toBe(193)
        const names = new Set(builtinColorSchemes.map(scheme => scheme.name))
        expect(names.size).toBe(builtinColorSchemes.length)
        for (const scheme of builtinColorSchemes) {
            expect(scheme.colors).toHaveLength(16)
        }
    })

    it('keeps the Tabby core defaults first and community schemes sorted', () => {
        expect(builtinColorSchemes[0]).toBe(defaultDarkColorScheme)
        expect(builtinColorSchemes[1]).toBe(defaultLightColorScheme)
        expect(builtinColorSchemes[0]!.name).toBe('Tabby Default')
        // 社区方案颜色均为合法 6 位 hex
        expect(builtinColorSchemes[2]!.colors.every(color => /^#[0-9a-f]{6}$/.test(color))).toBe(true)
    })

    it('finds schemes by exact name and returns null otherwise', () => {
        expect(findColorScheme('Dracula')?.background).toBe('#1e1f29')
        expect(findColorScheme('no-such-scheme')).toBeNull()
    })

    it('prefers custom schemes over builtin ones with the same name', () => {
        const custom = {
            name: 'Dracula',
            foreground: '#ffffff',
            background: '#000000',
            cursor: '#ffffff',
            colors: Array.from({ length: 16 }, () => '#123456'),
        }
        expect(findColorScheme('Dracula', [custom])).toBe(custom)
        expect(resolveColorScheme('Dracula', false, [custom])).toBe(custom)
    })

    it('resolves legacy preferences and named schemes with fallback', () => {
        expect(resolveColorScheme('dark', true)).toBe(defaultDarkColorScheme)
        expect(resolveColorScheme('light', false)).toBe(defaultLightColorScheme)
        expect(resolveColorScheme('auto', true)).toBe(defaultLightColorScheme)
        expect(resolveColorScheme('auto', false)).toBe(defaultDarkColorScheme)
        expect(resolveColorScheme('Nord', true).name).toBe('Nord')
        // 未知名称回退到系统深浅对应的默认配色
        expect(resolveColorScheme('bogus', false)).toBe(defaultDarkColorScheme)
        expect(resolveColorScheme('Tokyo Night', false)).toBe(defaultDarkColorScheme) // 已被严格复刻口径移除
    })
})

describe('schemeColors', () => {
    it('parses #rgb, #rrggbb and #rrggbbaa hex colors', () => {
        expect(parseHexColor('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 })
        expect(parseHexColor('#282a36')).toEqual({ r: 40, g: 42, b: 54, a: 1 })
        expect(parseHexColor('#44475acc')?.a).toBeCloseTo(0.8, 2)
        expect(parseHexColor('nope')).toBeNull()
    })

    it('emits rgb()/rgba() css strings', () => {
        expect(rgbaToCss({ r: 40, g: 42, b: 54, a: 1 })).toBe('rgb(40, 42, 54)')
        expect(rgbaToCss({ r: 40, g: 42, b: 54, a: 0.5 })).toBe('rgba(40, 42, 54, 0.5)')
    })

    it('classifies schemes by background luminance', () => {
        expect(isColorSchemeDark(defaultDarkColorScheme)).toBe(true)
        expect(isColorSchemeDark(defaultLightColorScheme)).toBe(false)
    })

    it('mixes colors toward the target', () => {
        const mixed = mixColors({ r: 0, g: 0, b: 0, a: 1 }, { r: 100, g: 100, b: 100, a: 1 }, 0.5)
        expect(mixed.r).toBeCloseTo(50)
        expect(mixed.a).toBe(1)
    })

    it('derives a stable chrome token set from a scheme', () => {
        const tokens = deriveChromeTokens(defaultDarkColorScheme)
        expect(tokens['--background']).toBe('rgb(23, 23, 23)')
        expect(tokens['--foreground']).toBe('rgb(202, 202, 202)')
        expect(tokens['--primary']).toBeTruthy()
        // 每套配色派生出的键集合一致，切换配色不会残留旧值
        expect(Object.keys(tokens).sort()).toEqual(Object.keys(deriveChromeTokens(defaultLightColorScheme)).sort())
    })
})
