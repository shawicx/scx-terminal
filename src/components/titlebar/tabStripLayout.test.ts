import { describe, expect, it } from 'vitest'
import { getTabStripWheelDelta, resolveActiveTabScrollLeft } from './tabStripLayout'

describe('tab strip layout', () => {
    it('converts the dominant wheel axis to horizontal scrolling', () => {
        expect(getTabStripWheelDelta({ deltaX: 0, deltaY: 120, deltaMode: 0, viewportWidth: 800 })).toBe(120)
        expect(getTabStripWheelDelta({ deltaX: -80, deltaY: 20, deltaMode: 0, viewportWidth: 800 })).toBe(-80)
    })

    it('normalizes line and page wheel deltas', () => {
        expect(getTabStripWheelDelta({ deltaX: 3, deltaY: 0, deltaMode: 1, viewportWidth: 800 })).toBe(96)
        expect(getTabStripWheelDelta({ deltaX: 2, deltaY: 0, deltaMode: 2, viewportWidth: 800 })).toBe(1600)
    })

    it('scrolls backward just enough to reveal an active tab clipped on the left', () => {
        expect(resolveActiveTabScrollLeft({
            scrollLeft: 300,
            viewportWidth: 800,
            tabStart: 260,
            tabEnd: 400,
            padding: 8,
        })).toBe(252)
    })

    it('scrolls forward just enough to reveal an active tab clipped on the right', () => {
        expect(resolveActiveTabScrollLeft({
            scrollLeft: 300,
            viewportWidth: 800,
            tabStart: 1000,
            tabEnd: 1140,
            padding: 8,
        })).toBe(348)
    })

    it('keeps the current scroll position when the active tab is visible', () => {
        expect(resolveActiveTabScrollLeft({
            scrollLeft: 200,
            viewportWidth: 800,
            tabStart: 260,
            tabEnd: 400,
            padding: 8,
        })).toBe(200)
    })

    it('reserves extra right space so the active tab clears the sticky add button', () => {
        expect(resolveActiveTabScrollLeft({
            scrollLeft: 300,
            viewportWidth: 800,
            tabStart: 1000,
            tabEnd: 1140,
            padding: 8,
            rightReserve: 32,
        })).toBe(380)
    })
})
