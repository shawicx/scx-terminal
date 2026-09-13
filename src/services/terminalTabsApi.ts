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
    /** 活动窗格会话的当前工作目录（新标签继承与「复制当前路径」用） */
    getActivePaneCwd (): Promise<string | null>
}

export const terminalTabApi = {
    current: null as TerminalTabApi | null,
}

export function openNewTerminalTab (): void {
    useTabsStore().openTerminalTab()
}
