import { useTabsStore } from '@/stores/tabs'

/**
 * Handles to the active terminal tab's split-tree actions. The active
 * TerminalTabContent registers itself here so app-level commands (palette,
 * hotkeys) can drive the focused tab.
 */
export interface TerminalTabApi {
    split (direction: 'right' | 'down'): void
    closePane (): void
    navigatePane (delta: 1 | -1): void
    copy (): void
    paste (): void
    clear (): void
    find (): void
}

export const terminalTabApi = {
    current: null as TerminalTabApi | null,
}

export function openNewTerminalTab (): void {
    useTabsStore().openTerminalTab()
}
