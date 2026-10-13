/**
 * @description shellQuoteSingle 单元测试：普通路径、含空格、含单引号、空串
 */
import { describe, expect, it } from 'vitest'
import { shellQuoteSingle } from './shellQuote'

describe('shellQuoteSingle', () => {
    it('引用普通路径', () => {
        expect(shellQuoteSingle('/home/user')).toBe("'/home/user'")
    })

    it('引用含空格路径', () => {
        expect(shellQuoteSingle('/home/u/my dir')).toBe("'/home/u/my dir'")
    })

    it('转义单引号', () => {
        expect(shellQuoteSingle("it's")).toBe("'it'\\''s'")
    })

    it('引用空串', () => {
        expect(shellQuoteSingle('')).toBe("''")
    })
})
