/**
 * @description xterm 键盘门函数单元测试：粘贴保留键（Meta+V / Shift+Insert）必须先喂热键
 *              状态机再屏蔽 xterm 与原生粘贴（⌘V 粘贴失效回归）、keypress 不喂、普通键透传
 */
import { describe, expect, it, vi } from 'vitest'
import { createKeyGate, createKeyboardEventHandler } from './keyboard'
import { HotkeysService } from '@/services/hotkeys'
import { metaKeyName } from '@/lib/hotkeys/hotkeys'

vi.mock('./support', () => ({
    isIMETextKey: () => false,
}))

type FakeKeyboardEvent = KeyboardEvent & {
    preventDefault: ReturnType<typeof vi.fn>
    stopPropagation: ReturnType<typeof vi.fn>
}

/**
 * @description 构造门函数可消费的最小键盘事件（getModifierState 按修饰键标志位回答）
 * @param overrides 事件字段覆盖（必须含 key）
 * @returns FakeKeyboardEvent
 */
function keyEvent (overrides: Partial<KeyboardEvent> & { key: string }): FakeKeyboardEvent {
    const base = {
        type: 'keydown',
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        code: overrides.key.length === 1 ? `Key${overrides.key.toUpperCase()}` : overrides.key,
        repeat: false,
        timeStamp: performance.now(),
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        ...overrides,
    }
    return {
        ...base,
        getModifierState: (modifier: string) => ({
            Meta: base.metaKey,
            Control: base.ctrlKey,
            Alt: base.altKey,
            Shift: base.shiftKey,
        })[modifier] ?? false,
    } as unknown as FakeKeyboardEvent
}

describe('createKeyGate paste shortcuts', () => {
    it('feeds Meta+V keydown to the hotkey chain and still blocks xterm/native paste', () => {
        const handle = vi.fn(() => true)
        const gate = createKeyGate({ platform: 'macos', handle })
        const event = keyEvent({ key: 'v', metaKey: true })

        expect(gate(event)).toBe(false)
        expect(handle).toHaveBeenCalledWith('keydown', event)
        expect(event.preventDefault).toHaveBeenCalled()
    })

    it('feeds Shift+Insert keydown to the hotkey chain and still blocks xterm/native paste', () => {
        const handle = vi.fn(() => true)
        const gate = createKeyGate({ platform: 'windows', handle })
        const event = keyEvent({ key: 'Insert', shiftKey: true })

        expect(gate(event)).toBe(false)
        expect(handle).toHaveBeenCalledWith('keydown', event)
        expect(event.preventDefault).toHaveBeenCalled()
    })

    it('passes the real event type through for a paste-shortcut keyup', () => {
        const handle = vi.fn(() => true)
        const gate = createKeyGate({ platform: 'linux', handle })
        const event = keyEvent({ key: 'Insert', shiftKey: true, type: 'keyup' })

        expect(gate(event)).toBe(false)
        expect(handle).toHaveBeenCalledWith('keyup', event)
    })

    it('does not feed a paste-shortcut keypress (WKWebView meta keypress echo) but still blocks it', () => {
        const handle = vi.fn(() => true)
        const gate = createKeyGate({ platform: 'macos', handle })
        const event = keyEvent({ key: 'v', metaKey: true, type: 'keypress' })

        expect(gate(event)).toBe(false)
        expect(handle).not.toHaveBeenCalled()
        expect(event.preventDefault).toHaveBeenCalled()
    })

    it('leaves non-paste keys on the regular path', () => {
        const handle = vi.fn(() => true)
        const gate = createKeyGate({ platform: 'macos', handle })
        const event = keyEvent({ key: 'a' })

        expect(gate(event)).toBe(true)
        expect(handle).toHaveBeenCalledWith('keydown', event)
        expect(event.preventDefault).not.toHaveBeenCalled()
    })

    it('emits the paste hotkey exactly once for a Meta+V keydown through the full chain', () => {
        const service = new HotkeysService(() => ({ 'paste': [[`${metaKeyName}-V`]] }))
        const emitted: string[] = []
        service.hotkey$.subscribe(id => emitted.push(id))
        const input = { next: vi.fn() }
        const gate = createKeyGate({
            platform: 'macos',
            handle: createKeyboardEventHandler({
                isAlternateScreenActive: () => false,
                input,
                hotkeys: service,
            }),
        })

        expect(gate(keyEvent({ key: 'v', metaKey: true }))).toBe(false)

        expect(emitted).toEqual(['paste'])
        expect(input.next).not.toHaveBeenCalled()
    })
})
