import type { FrontendContext } from './frontends/frontend'
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager'
import { useConfigStore } from '@/stores/config'
import { platform } from './platform'
import { hotkeys } from '@/services/hotkeysSingleton'
import { resolveColorScheme } from './colorSchemes'

export { readClipboardText, writeClipboardText }

async function writeClipboardText (text: string): Promise<void> {
    try {
        await writeText(text)
    } catch {
        await navigator.clipboard.writeText(text)
    }
}

async function readClipboardText (): Promise<string> {
    try {
        return await readText()
    } catch {
        return await navigator.clipboard.readText()
    }
}

/** Builds the service context handed to terminal frontends (replaces Angular DI). */
export function createFrontendContext (): FrontendContext {
    const config = useConfigStore()
    return {
        config: config.store,
        getCSSFontFamily: () => config.getCSSFontFamily(),
        platform,
        colorScheme () {
            return resolveColorScheme(
                config.store.appearance.colorScheme,
                window.matchMedia('(prefers-color-scheme: light)').matches,
                config.store.colorSchemes,
            )
        },
        async setClipboard (text: string) {
            await writeClipboardText(text)
        },
        hotkeys: {
            pushKeyEvent: (name, event) => hotkeys.pushKeyEvent(name, event),
            matchActiveHotkey: keydown => hotkeys.matchActiveHotkey(keydown),
        },
    }
}
