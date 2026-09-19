import { describe, expect, it } from 'vitest'
import { scheduleSearchFocus } from './searchFocus'

describe('scheduleSearchFocus', () => {
    it('focuses the search input only after overlay focus restoration has run', () => {
        const tasks: Array<() => void> = []
        let focusCount = 0
        const target = {
            focus: () => {
                focusCount++
            },
        }

        scheduleSearchFocus(target, task => tasks.push(task))

        expect(focusCount).toBe(0)
        tasks.shift()!()
        expect(focusCount).toBe(0)
        tasks.shift()!()
        expect(focusCount).toBe(1)
    })

    it('does nothing when the input is absent', () => {
        const tasks: Array<() => void> = []

        scheduleSearchFocus(null, task => tasks.push(task))
        tasks.shift()!()
        tasks.shift()!()

        expect(tasks).toHaveLength(0)
    })
})
