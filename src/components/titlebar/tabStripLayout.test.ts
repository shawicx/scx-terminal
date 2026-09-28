import { describe, expect, it } from 'vitest'
import {
    getTabStripWheelDelta,
    resolveActiveTabScrollLeft,
    resolveArrowScrollTarget,
    resolveTabOverflowState,
} from './tabStripLayout'

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

describe('tab strip overflow state', () => {
    it('reports no scroll direction when tabs fit the viewport', () => {
        expect(resolveTabOverflowState({ scrollLeft: 0, viewportWidth: 800, scrollWidth: 780 }))
            .toEqual({ canScrollLeft: false, canScrollRight: false })
    })

    it('reports only forward scrolling at the left edge', () => {
        expect(resolveTabOverflowState({ scrollLeft: 0, viewportWidth: 800, scrollWidth: 1200 }))
            .toEqual({ canScrollLeft: false, canScrollRight: true })
    })

    it('reports both directions in the middle and neither at the right edge', () => {
        expect(resolveTabOverflowState({ scrollLeft: 200, viewportWidth: 800, scrollWidth: 1200 }))
            .toEqual({ canScrollLeft: true, canScrollRight: true })
        expect(resolveTabOverflowState({ scrollLeft: 400, viewportWidth: 800, scrollWidth: 1200 }))
            .toEqual({ canScrollLeft: true, canScrollRight: false })
    })
})

describe('arrow scroll target', () => {
    it('scrolls by the given step forward and backward', () => {
        expect(resolveArrowScrollTarget({ direction: 1, scrollLeft: 100, step: 600, maxScrollLeft: 2000 })).toBe(700)
        expect(resolveArrowScrollTarget({ direction: -1, scrollLeft: 700, step: 600, maxScrollLeft: 2000 })).toBe(100)
    })

    it('clamps the target within [0, maxScrollLeft]', () => {
        expect(resolveArrowScrollTarget({ direction: 1, scrollLeft: 0, step: 600, maxScrollLeft: 400 })).toBe(400)
        expect(resolveArrowScrollTarget({ direction: -1, scrollLeft: 100, step: 600, maxScrollLeft: 400 })).toBe(0)
    })
})
