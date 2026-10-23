/**
 * @description i18n 消息编译冒烟测试：遍历 zh-CN 与 en 全部文案键逐条编译，
 *              防止消息内字面量花括号被当作占位符语法等编译错误流入运行时
 *              （曾在 customCssPlaceholder 的 CSS 示例上触发渲染期 SyntaxError）。
 */
import { describe, expect, it } from 'vitest'
import i18n from './index'

/**
 * @description 深度展平消息对象的叶子键路径（嵌套对象下钻，数组跳过）
 * @param messages 消息树
 * @param prefix 键前缀
 * @returns string[] 叶子键全路径列表
 *
 * @example flattenKeys({ a: { b: 'x' } }) // ['a.b']
 *
 */
function flattenKeys (messages: Record<string, unknown>, prefix = ''): string[] {
    const keys: string[] = []
    for (const [key, value] of Object.entries(messages)) {
        const path = prefix ? `${prefix}.${key}` : key
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            keys.push(...flattenKeys(value as Record<string, unknown>, path))
        } else {
            keys.push(path)
        }
    }
    return keys
}

describe('i18n message compilation', () => {
    it('compiles every zh-CN and en message without syntax errors', () => {
        for (const locale of ['zh-CN', 'en'] as const) {
            const messages = i18n.global.getLocaleMessage(locale) as Record<string, unknown>
            const keys = flattenKeys(messages)
            expect(keys.length).toBeGreaterThan(0)
            for (const key of keys) {
                expect(() => i18n.global.t(key, locale), `${locale}:${key}`).not.toThrow()
            }
        }
    })

    it('renders literal braces in the custom CSS placeholder verbatim', () => {
        expect(i18n.global.t('settings.customCssPlaceholder', 'zh-CN')).toContain('{ font-size: 12px }')
    })
})
