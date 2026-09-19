/**
 * @description 背景图片纯逻辑单测：rgba 合成（正常 hex / 非法回退 / clamp）、填充方式映射
 */
import { describe, expect, it } from 'vitest'
import { composeTerminalBackground, mapBackgroundFit } from './backgroundImage'

describe('composeTerminalBackground', () => {
    it('composes rgba from hex with the given opacity', () => {
        expect(composeTerminalBackground('#282a36', 0.6)).toBe('rgba(40, 42, 54, 0.6)')
    })

    it('supports short hex and full opacity', () => {
        expect(composeTerminalBackground('#abc', 1)).toBe('rgba(170, 187, 204, 1)')
    })

    it('falls back to dark gray for invalid colors', () => {
        expect(composeTerminalBackground('not-a-color', 0.5)).toBe('rgba(23, 23, 23, 0.5)')
    })

    it('clamps opacity into [0.05, 1]', () => {
        expect(composeTerminalBackground('#282a36', 0)).toBe('rgba(40, 42, 54, 0.05)')
        expect(composeTerminalBackground('#282a36', 2)).toBe('rgba(40, 42, 54, 1)')
    })
})

describe('mapBackgroundFit', () => {
    it('cover crops to fill', () => {
        expect(mapBackgroundFit('cover')).toEqual({
            backgroundSize: 'cover',
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'center',
        })
    })

    it('contain keeps the whole image visible', () => {
        expect(mapBackgroundFit('contain')).toEqual({
            backgroundSize: 'contain',
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'center',
        })
    })

    it('tile repeats at native size from the top-left', () => {
        expect(mapBackgroundFit('tile')).toEqual({
            backgroundSize: 'auto',
            backgroundRepeat: 'repeat',
            backgroundPosition: 'left top',
        })
    })
})
