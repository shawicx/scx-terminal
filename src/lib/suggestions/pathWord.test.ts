/**
 * @description 路径词切分与引号包裹单测
 */
import { describe, expect, it } from 'vitest'
import { quotePathIfNeeded, splitPathWord } from './pathWord'

describe('splitPathWord', () => {
    it('splits dir and basename prefix', () => {
        expect(splitPathWord('~/Doc')).toEqual({ dir: '~/', prefix: 'Doc' })
        expect(splitPathWord('/usr/lo')).toEqual({ dir: '/usr/', prefix: 'lo' })
        expect(splitPathWord('src/li')).toEqual({ dir: 'src/', prefix: 'li' })
    })

    it('handles bare tilde', () => {
        expect(splitPathWord('~')).toEqual({ dir: '~/', prefix: '' })
    })

    it('returns null for plain words', () => {
        expect(splitPathWord('git')).toBeNull()
    })
})

describe('quotePathIfNeeded', () => {
    it('wraps path segments containing whitespace', () => {
        expect(quotePathIfNeeded('My Files')).toBe("'My Files'")
    })

    it('escapes embedded single quotes', () => {
        expect(quotePathIfNeeded("/tmp/it's")).toBe("'/tmp/it'\\''s'")
    })

    it('leaves simple paths untouched', () => {
        expect(quotePathIfNeeded('/usr/bin')).toBe('/usr/bin')
    })
})
