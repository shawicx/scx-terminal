import { describe, expect, it } from 'vitest'
import { getKeyName, getKeystrokeName, metaKeyName, altKeyName, parseKeystroke, normalizeKeyName, normalizeHotkeysConfig } from './hotkeys'
import { HotkeysService } from '@/services/hotkeys'

function keyEvent (overrides: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
    return {
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        code: overrides.key.length === 1 ? `Key${overrides.key.toUpperCase()}` : overrides.key,
        repeat: false,
        timeStamp: performance.now(),
        ...overrides,
    } as KeyboardEvent
}

describe('key naming', () => {
    it('names plain letters by character (Dvorak-safe)', () => {
        expect(getKeyName({ eventName: 'keydown', key: 'p', code: 'KeyQ' } as never)).toBe('P')
    })

    it('normalizes modifiers', () => {
        expect(getKeyName({ eventName: 'keydown', key: 'Control' } as never)).toBe('Ctrl')
        expect(getKeyName({ eventName: 'keydown', key: 'Meta' } as never)).toBe(metaKeyName)
        expect(getKeyName({ eventName: 'keydown', key: 'Alt' } as never)).toBe(altKeyName)
    })

    it('orders modifiers strictly in keystrokes', () => {
        expect(getKeystrokeName(['Shift', metaKeyName, 'P'])).toBe(`${metaKeyName}-Shift-P`)
        expect(getKeystrokeName([altKeyName, 'Ctrl', 'K'])).toBe(`Ctrl-${altKeyName}-K`)
    })

    it('parses keystroke strings', () => {
        expect(parseKeystroke(`${metaKeyName}-Shift-P`)).toEqual([metaKeyName, 'Shift', 'P'])
    })
})

describe('keystroke normalization', () => {
    it('strips the Arrow prefix like getKeyName does', () => {
        expect(normalizeKeyName('ArrowRight')).toBe('Right')
        expect(normalizeKeyName('ArrowLeft')).toBe('Left')
        expect(normalizeKeyName('ArrowUp')).toBe('Up')
        expect(normalizeKeyName('ArrowDown')).toBe('Down')
    })

    it('maps modifier aliases to the platform key names', () => {
        expect(normalizeKeyName('Alt')).toBe(altKeyName)
        expect(normalizeKeyName('Meta')).toBe(metaKeyName)
        expect(normalizeKeyName('Cmd')).toBe(metaKeyName)
        expect(normalizeKeyName('Super')).toBe(metaKeyName)
    })

    it('unwraps physical code names and leaves canonical names untouched', () => {
        expect(normalizeKeyName('KeyA')).toBe('A')
        expect(normalizeKeyName('Digit1')).toBe('1')
        expect(normalizeKeyName(metaKeyName)).toBe(metaKeyName)
        expect(normalizeKeyName('Right')).toBe('Right')
        expect(normalizeKeyName('F5')).toBe('F5')
    })

    it('normalizes every sequence of a full hotkeys config', () => {
        const normalized = normalizeHotkeysConfig({
            'pane-forward': [[`${metaKeyName}-${altKeyName}-ArrowRight`], ['Ctrl-Alt-ArrowDown']],
            'copy': [[`${metaKeyName}-C`]],
        })
        expect(normalized).toEqual({
            'pane-forward': [[`${metaKeyName}-${altKeyName}-Right`], [`Ctrl-${altKeyName}-Down`]],
            'copy': [[`${metaKeyName}-C`]],
        })
    })
})

describe('hotkey matching', () => {
    it('matches a simple hotkey and emits it', () => {
        const service = new HotkeysService(() => ({ 'command-palette': [[`${metaKeyName}-Shift-P`]] }))
        const emitted: string[] = []
        service.hotkey$.subscribe(id => emitted.push(id))

        service.pushKeyEvent('keydown', keyEvent({ key: 'Meta', metaKey: true }))
        service.pushKeyEvent('keydown', keyEvent({ key: 'Shift', metaKey: true, shiftKey: true }))
        service.pushKeyEvent('keydown', keyEvent({ key: 'p', metaKey: true, shiftKey: true }))

        expect(emitted).toEqual(['command-palette'])
    })

    it('does not match when disabled', () => {
        const service = new HotkeysService(() => ({ 'copy': [['⌘-C']] }))
        const emitted: string[] = []
        service.hotkey$.subscribe(id => emitted.push(id))

        service.disable()
        service.pushKeyEvent('keydown', keyEvent({ key: 'Meta', metaKey: true }))
        service.pushKeyEvent('keydown', keyEvent({ key: 'c', metaKey: true }))
        service.enable()

        expect(emitted).toEqual([])
    })

    it('stays functional after an asymmetric enable (palette double-enable regression)', () => {
        const service = new HotkeysService(() => ({ 'command-palette': [[`${metaKeyName}-Shift-P`]] }))
        const emitted: string[] = []
        service.hotkey$.subscribe(id => emitted.push(id))

        // 回归场景：面板 close() 与 watch(open→false) 各 enable 一次 → 计数被打成负数，
        // isEnabled()（=== 0）永远为 false，热键永久失效。防负钳制后单次 disable 配
        // 多余 enable 不得影响后续匹配。
        service.disable()
        service.enable()
        service.enable()
        service.pushKeyEvent('keydown', keyEvent({ key: 'Meta', metaKey: true }))
        service.pushKeyEvent('keydown', keyEvent({ key: 'p', metaKey: true, shiftKey: true }))

        expect(emitted).toEqual(['command-palette'])
        expect(service.isEnabled()).toBe(true)
    })

    it('matches multi-key sequences in order', () => {
        const service = new HotkeysService(() => ({ 'close-pane': [[`${metaKeyName}-K`, `${metaKeyName}-X`]] }))
        const emitted: string[] = []
        service.hotkey$.subscribe(id => emitted.push(id))

        const press = (key: string) => {
            service.pushKeyEvent('keydown', keyEvent({ key, metaKey: true }))
            service.pushKeyEvent('keyup', keyEvent({ key, metaKey: true }))
        }
        press('k')
        press('x')
        expect(emitted).toEqual(['close-pane'])
    })
})
