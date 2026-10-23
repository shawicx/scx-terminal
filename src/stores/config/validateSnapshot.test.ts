/**
 * @description 配置快照结构校验单元测试：完整结构通过、缺分区/类型错/缺身份键报错。
 */
import { describe, expect, it } from 'vitest'
import { validateSnapshot } from './validateSnapshot'
import { defaultConfig } from './defaults'

describe('validateSnapshot', () => {
    it('accepts the default config snapshot', () => {
        expect(validateSnapshot(defaultConfig())).toBeNull()
    })

    it('rejects non-object roots', () => {
        expect(validateSnapshot(null)).toEqual({ key: 'configFileErrRoot' })
        expect(validateSnapshot('[]')).toEqual({ key: 'configFileErrRoot' })
    })

    it('rejects missing or mistyped sections', () => {
        const config = defaultConfig() as unknown as Record<string, unknown>
        delete config.appearance
        expect(validateSnapshot(config)).toEqual({ key: 'configFileErrSection', arg: 'appearance' })
        config.appearance = []
        expect(validateSnapshot(config)).toEqual({ key: 'configFileErrSection', arg: 'appearance' })
    })

    it('rejects entity lists that are not arrays', () => {
        const config = defaultConfig() as unknown as Record<string, unknown>
        config.profiles = { id: 'x' }
        expect(validateSnapshot(config)).toEqual({ key: 'configFileErrList', arg: 'profiles' })
    })

    it('rejects entity items without a usable identity key', () => {
        const config = defaultConfig() as unknown as Record<string, unknown>
        config.workflows = [{ id: '' }, { noId: true }]
        expect(validateSnapshot(config)).toEqual({ key: 'configFileErrEntityId', arg: 'workflows' })
        config.workflows = [{ name: 'no id here' }]
        expect(validateSnapshot(config)).toEqual({ key: 'configFileErrEntityId', arg: 'workflows' })
    })

    it('rejects color scheme items without a name (name-keyed identity)', () => {
        const config = defaultConfig() as unknown as Record<string, unknown>
        config.colorSchemes = [{ id: 'has-id-but-no-name' }]
        expect(validateSnapshot(config)).toEqual({ key: 'configFileErrEntityId', arg: 'colorSchemes' })
    })
})
