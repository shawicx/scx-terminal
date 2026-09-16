import { Subject } from 'rxjs'
import { platform } from '@/lib/platform'
import { getKeyName, getKeystrokeName, metaKeyName, altKeyName, type KeyEventData, type Keystroke } from '@/lib/hotkeys/hotkeys'

/**
 * Keystroke state machine: tracks pressed keys, produces keystroke names,
 * matches them against the configured hotkey table (including multi-key
 * sequences). Ported from tabby-core/src/services/hotkeys.service.ts.
 *
 * Events arrive from two sources: document-level listeners (regular UI) and
 * xterm's attachCustomKeyEventHandler (keys that would otherwise be consumed
 * by the terminal).
 */
export class HotkeysService {
    hotkey$ = new Subject<string>()
    keystroke$ = new Subject<Keystroke>()

    private pressedKeys = new Map<string, number>()
    private pressedKeyTimestamps = new Map<string, number>()
    private pressedKeystroke: Keystroke | null = null
    private lastKeystrokes: { keystroke: Keystroke, time: number }[] = []
    private recognitionPhase = false
    private suppressNextKeyupKeystroke = false
    private disabledLevel = 0
    private pressedHotkey: string | null = null

    constructor (
        private getHotkeysConfig: () => Record<string, string[][]>,
    ) {}

    disable (): void {
        this.disabledLevel++
    }

    /** 计数恢复，向下钳制到 0：防止不对称的 enable 调用把计数打成负数、热键永久禁用 */
    enable (): void {
        this.disabledLevel = Math.max(0, this.disabledLevel - 1)
    }

    isEnabled (): boolean {
        return this.disabledLevel === 0
    }

    /** Feed a DOM event into the machine ('keydown' | 'keyup' | 'wheel' | 'mouseup' | 'auxclick'). */
    pushKeyEvent (eventName: string, nativeEvent: KeyboardEvent | WheelEvent | MouseEvent): void {
        const eventData: KeyEventData = {
            ctrlKey: nativeEvent.ctrlKey,
            metaKey: nativeEvent.metaKey,
            altKey: nativeEvent.altKey,
            shiftKey: nativeEvent.shiftKey,
            code: 'code' in nativeEvent ? nativeEvent.code : '',
            key: 'key' in nativeEvent ? nativeEvent.key : '',
            deltaX: 'deltaX' in nativeEvent ? nativeEvent.deltaX : undefined,
            deltaY: 'deltaY' in nativeEvent ? nativeEvent.deltaY : undefined,
            button: 'button' in nativeEvent ? nativeEvent.button : undefined,
            eventName,
            time: nativeEvent.timeStamp,
            registrationTime: performance.now(),
        }

        for (const [key, time] of this.pressedKeyTimestamps.entries()) {
            if (time < performance.now() - 2000) {
                this.removePressedKey(key)
            }
        }

        const keyName = getKeyName(eventData)

        if (eventName === 'keydown') {
            this.addPressedKey(keyName, eventData)
            this.recognitionPhase = true
            if (!(nativeEvent as KeyboardEvent).repeat) {
                this.suppressNextKeyupKeystroke = false
            }
            this.updateModifiers(eventData)
        }
        if (eventName === 'keyup') {
            const shouldSuppressKeystroke = this.suppressNextKeyupKeystroke
            this.suppressNextKeyupKeystroke = false
            const keystroke = getKeystrokeName([...this.pressedKeys.keys()])
            if (!shouldSuppressKeystroke && keystroke && this.recognitionPhase) {
                this.keystroke$.next(keystroke)
                this.lastKeystrokes.push({
                    keystroke,
                    time: performance.now(),
                })
                this.recognitionPhase = false
            }
            this.pressedKeys.clear()
            this.pressedKeyTimestamps.clear()
            this.removePressedKey(keyName)
        }
        if (eventName === 'wheel' || eventName === 'mouseup' || eventName === 'auxclick') {
            this.updateModifiers(eventData)
            this.addPressedKey(keyName, eventData)
            const keystroke = getKeystrokeName([...this.pressedKeys.keys()])
            this.keystroke$.next(keystroke)
            this.lastKeystrokes.push({
                keystroke,
                time: performance.now(),
            })
            this.pressedKeystroke = keystroke
            this.recognitionPhase = true
            this.suppressNextKeyupKeystroke = true
        }

        if (this.pressedKeys.size) {
            this.pressedKeystroke = getKeystrokeName([...this.pressedKeys.keys()])
        } else {
            this.pressedKeystroke = null
        }

        const matched = this.matchActiveHotkey()
        if (matched) {
            if (this.recognitionPhase) {
                this.emitHotkeyOn(matched)
                if (eventName === 'wheel' || eventName === 'mouseup' || eventName === 'auxclick') {
                    this.emitHotkeyOff(matched)
                }
            }
        } else if (this.pressedHotkey) {
            this.emitHotkeyOff(this.pressedHotkey)
        }

        // macOS will swallow non-modified keyups if Cmd is held down
        if (platform === 'macos' && eventData.metaKey && eventName === 'keydown' &&
            !['Ctrl', 'Shift', '⌥', '⌘', 'Enter'].includes(keyName)) {
            this.pushKeyEvent('keyup', nativeEvent)
        }

        if (eventName === 'wheel' || eventName === 'mouseup' || eventName === 'auxclick') {
            this.recognitionPhase = false
            this.pressedKeys.clear()
            this.pressedKeyTimestamps.clear()
            this.pressedKeystroke = null
        }
    }

    getCurrentKeystrokes (): Keystroke[] {
        if (!this.pressedKeystroke) {
            return []
        }
        return [...this.lastKeystrokes.map(x => x.keystroke), this.pressedKeystroke]
    }

    /**
     * Returns the id of the hotkey matching the current key sequence.
     * With `partial=true`, matches a prefix of a longer sequence (used to let
     * xterm know a keydown belongs to a hotkey and must not reach the shell).
     */
    matchActiveHotkey (partial = false): string | null {
        if (!this.isEnabled() || !this.pressedKeystroke) {
            return null
        }
        const matches: { id: string, sequence: string[] }[] = []

        const currentSequence = this.getCurrentKeystrokes()
        const config = this.getHotkeysConfig()

        for (const id in config) {
            for (const sequence of config[id]) {
                if (currentSequence.length < sequence.length) {
                    continue
                }
                if (sequence[sequence.length - 1] !== this.pressedKeystroke) {
                    continue
                }

                let lastIndex = 0
                let matchedAll = true
                for (const item of sequence) {
                    const nextOffset = currentSequence.slice(lastIndex).findIndex(
                        x => x.toLowerCase() === item.toLowerCase(),
                    )
                    if (nextOffset === -1) {
                        matchedAll = false
                        break
                    }
                    lastIndex += nextOffset
                }

                if (partial ? lastIndex > 0 : matchedAll) {
                    matches.push({ id, sequence })
                }
            }
        }

        matches.sort((a, b) => b.sequence.length - a.sequence.length)
        if (!matches.length) {
            return null
        }
        if (matches[0]!.sequence.length > 1) {
            this.clearCurrentKeystrokes()
        }
        return matches[0]!.id
    }

    clearCurrentKeystrokes (): void {
        this.lastKeystrokes = []
        this.pressedKeys.clear()
        this.pressedKeyTimestamps.clear()
        this.pressedKeystroke = null
        this.pressedHotkey = null
    }

    private emitHotkeyOn (id: string): void {
        this.pressedHotkey = id
        this.hotkey$.next(id)
    }

    private emitHotkeyOff (id: string): void {
        void id
        this.pressedHotkey = null
    }

    private addPressedKey (keyName: string, event: KeyEventData): void {
        if (['Ctrl', 'Shift', '⌘', 'Super', 'Win', '⌥', 'Alt'].includes(keyName)) {
            // modifiers are handled through updateModifiers
            return
        }
        this.pressedKeys.set(keyName, event.time)
        this.pressedKeyTimestamps.set(keyName, event.time)
    }

    private removePressedKey (keyName: string): void {
        this.pressedKeys.delete(keyName)
        this.pressedKeyTimestamps.delete(keyName)
    }

    private updateModifiers (event: KeyEventData): void {
        const modifierMap: [keyof KeyEventData, string][] = [
            ['ctrlKey', 'Ctrl'],
            ['metaKey', metaKeyName],
            ['altKey', altKeyName],
            ['shiftKey', 'Shift'],
        ]
        for (const [prop, key] of modifierMap) {
            if (event[prop] && !this.pressedKeys.has(key)) {
                this.pressedKeys.set(key, event.time)
                this.pressedKeyTimestamps.set(key, event.time)
            } else if (!event[prop]) {
                this.pressedKeys.delete(key)
                this.pressedKeyTimestamps.delete(key)
            }
        }
    }
}
