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
    /** 手动唤起活动窗格的输入建议菜单 */
    triggerSuggestions (): void
    /** 开关活动窗格的端口转发面板（SSH 档案窗格有效） */
    toggleForward (): void
    /** 向活动窗格会话写入文本（快捷命令；execute=true 补换行立即执行） */
    sendTextToActivePane (text: string, execute?: boolean): void
    /** 活动窗格会话的当前工作目录（新标签继承与「复制当前路径」用） */
    getActivePaneCwd (): Promise<string | null>
    /** 捕获活动窗格的运行句柄（工作流 expect/捕获用；绑定捕获时刻的窗格，不受后续切换影响） */
    captureActivePane (): PaneCapture | null
}

/** 窗格运行句柄：发送/输出订阅均绑定捕获时刻的叶窗格 */
export interface PaneCapture {
    /** 窗格稳定标识（存活校验用） */
    key: string
    /** 向该窗格会话写入文本 */
    sendText (text: string, execute?: boolean): void
    /** 订阅该窗格会话的原始输出流；返回退订函数 */
    tapOutput (cb: (chunk: string) => void): () => void
    /** 窗格是否仍存活（叶未被关闭/重建） */
    isAlive (): boolean
}

export const terminalTabApi = {
    current: null as TerminalTabApi | null,
}

export function openNewTerminalTab (): void {
    useTabsStore().openTerminalTab()
}
