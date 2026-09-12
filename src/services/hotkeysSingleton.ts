import { HotkeysService } from './hotkeys'
import { useConfigStore } from '@/stores/config'

/**
 * Singleton hotkey service. Created lazily so it can read the config store
 * on every lookup (bindings may change at runtime through settings).
 */
let instance: HotkeysService | null = null

export function getHotkeys (): HotkeysService {
    if (!instance) {
        instance = new HotkeysService(() => useConfigStore().store.hotkeys ?? {})
    }
    return instance
}

export const hotkeys = {
    get hotkey$ () { return getHotkeys().hotkey$ },
    get keystroke$ () { return getHotkeys().keystroke$ },
    pushKeyEvent (name: 'keydown' | 'keyup' | 'wheel' | 'mouseup' | 'auxclick', event: Event): void {
        getHotkeys().pushKeyEvent(name, event as KeyboardEvent)
    },
    matchActiveHotkey (keydown: boolean): string | null {
        return getHotkeys().matchActiveHotkey(keydown)
    },
    disable (): void { getHotkeys().disable() },
    enable (): void { getHotkeys().enable() },
}
