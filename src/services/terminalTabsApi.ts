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

/** 终端标签 API 注册表（tabId → api）：后台标签不经激活直达自身窗格（右键菜单的复制路径/另存为配置用） */
const tabApiRegistry = new Map<string, TerminalTabApi>()

/**
 * @description 登记终端标签 API（TerminalTabContent 挂载时调用）
 * @param tabId 标签 id
 * @param api 标签的终端操作句柄
 * @returns void
 *
 * @example registerTerminalTabApi('tab-1', tabApi)
 *
 */
export function registerTerminalTabApi (tabId: string, api: TerminalTabApi): void {
    tabApiRegistry.set(tabId, api)
}

/**
 * @description 注销终端标签 API（TerminalTabContent 卸载时调用）
 * @param tabId 标签 id
 * @returns void
 *
 * @example unregisterTerminalTabApi('tab-1')
 *
 */
export function unregisterTerminalTabApi (tabId: string): void {
    tabApiRegistry.delete(tabId)
}

/**
 * @description 取指定终端标签活动窗格的当前工作目录（后台标签也可查；未登记或未上报时为 null）
 * @param tabId 标签 id
 * @returns Promise<string | null> 工作目录
 *
 * @example await getTerminalTabCwd('tab-1')
 *
 */
export async function getTerminalTabCwd (tabId: string): Promise<string | null> {
    return await tabApiRegistry.get(tabId)?.getActivePaneCwd() ?? null
}

export function openNewTerminalTab (): void {
    useTabsStore().openTerminalTab()
}
