/**
 * @description 建议控制器：聚合 PromptTracker（输入行模型 + 提示符学习 + 命令采集）、
 *              建议引擎与菜单 UI 状态。菜单键盘语义（↑↓/Tab/Enter/→/Esc）、接受写入
 *              （公共前缀保留 + 退格差异）、Esc 抑制自动弹出、历史记录写入。
 */
import { ensureHistoryLoaded, getHistorySnapshot, recordHistory } from '@/services/history'
import { PromptTracker, type LogicalLine } from './promptTracker'
import { computeSuggestions, type DirEntry, type QuickCommandSource } from './suggestionEngine'
import type { Suggestion, SuggestionContext } from './types'

export interface SuggestionsRuntimeConfig {
    enabled: boolean
    trigger: 'auto' | 'manual'
    delay: number
    sources: { history: boolean, quickCommands: boolean, paths: boolean }
}

export interface SuggestionsUiState {
    open: boolean
    items: Suggestion[]
    selectedIndex: number
}

export interface SuggestionsControllerHost {
    /** 当前运行配置（每次评估现读，配置变更即时生效） */
    config (): SuggestionsRuntimeConfig
    isAlternateScreen (): boolean
    isFocusedPane (): boolean
    /** buffer 读取（由 XTermFrontend 实现） */
    readLine (): LogicalLine | null
    readLineAbove (up: number): LogicalLine | null
    readCursorPrefix (): string | null
    anchorRect (): { left: number, top: number, hostHeight: number, hostWidth: number } | null
    /** 建议上下文原料 */
    sourceKey (): string
    cwd (): Promise<string | null>
    sshId (): string | null
    listDir (dir: string): Promise<DirEntry[]>
    quickCommands (): QuickCommandSource[]
    /** 动作 */
    sendInput (text: string): void
    openQuickCommandForm (quickCommandId: string): void
    /** UI 状态回调（TerminalPane 持 ref 驱动 SuggestionMenu） */
    onState (state: SuggestionsUiState): void
}

/**
 * @description 接受建议的写入序列：保留公共前缀，退格删掉差异部分后追加建议剩余文本
 * @param current 当前输入行（或词）文本
 * @param replacement 目标文本
 * @returns string 可直接 feedFromTerminal 的序列（\x7f 退格）
 *
 * @example computeAcceptSequence('git', 'git status') // ' status'
 *
 */
export function computeAcceptSequence (current: string, replacement: string): string {
    let common = 0
    const max = Math.min(current.length, replacement.length)
    while (common < max && current[common] === replacement[common]) {
        common++
    }
    return '\x7f'.repeat(current.length - common) + replacement.slice(common)
}

/**
 * @description 建议菜单控制器（每窗格一个；TerminalPane 在 onMounted 创建）
 */
export class SuggestionsController {
    private readonly promptTracker: PromptTracker
    private readonly host: SuggestionsControllerHost
    private state: SuggestionsUiState = { open: false, items: [], selectedIndex: 0 }
    private lastTyped = ''
    private suppressed = false
    private destroyed = false
    private evaluating = false
    private popupTimer: ReturnType<typeof setTimeout> | undefined

    constructor (host: SuggestionsControllerHost) {
        this.host = host
        this.promptTracker = new PromptTracker(
            {
                readLine: () => host.readLine(),
                readLineAbove: up => host.readLineAbove(up),
                readCursorPrefix: () => host.readCursorPrefix(),
            },
            () => void this.onSilence(),
        )
        // 手动模式下评估入口不会被自然触发，历史索引会饥饿到首条记录：构造即预载（fire-and-forget）
        void ensureHistoryLoaded()
    }

    /** 用户输入透传（挂 frontend.input$ 之后） */
    notifyInput (data: Uint8Array): void {
        this.promptTracker.notifyInput(data)
    }

    /** shell 输出透传（挂 session.output$ 之后） */
    notifyOutput (): void {
        this.promptTracker.notifyOutput()
    }

    /** 手动触发（快捷键唤起；忽略 Esc 抑制与自动弹出延迟） */
    triggerManually (): void {
        this.suppressed = false
        this.clearPopupTimer()
        void this.evaluate()
    }

    /** 关闭菜单（suppress=true 时本次输入会话内不再自动弹） */
    close (suppress: boolean): void {
        if (suppress) {
            this.suppressed = true
        }
        this.setState({ open: false, items: [], selectedIndex: 0 })
    }

    /** 销毁（窗格卸载） */
    destroy (): void {
        this.destroyed = true
        this.clearPopupTimer()
        this.promptTracker.destroy()
    }

    /**
     * @description 菜单打开时的键盘处理（TerminalPane 在 host capture keydown 调用）
     * @param event 键盘事件
     * @returns boolean true = 已消费（调用方 preventDefault + stopPropagation）
     */
    handleKeydown (event: KeyboardEvent): boolean {
        if (!this.state.open) {
            return false
        }
        if (event.metaKey || event.ctrlKey || event.altKey) {
            return event.key === 'Escape' // Ctrl+[ 的 key 是 Escape
        }
        switch (event.key) {
            case 'ArrowUp':
                this.moveSelection(-1)
                return true
            case 'ArrowDown':
                this.moveSelection(1)
                return true
            case 'Tab':
                void this.acceptSelected(false)
                return true
            case 'Enter':
                void this.acceptSelected(true)
                return true
            case 'ArrowRight': {
                const typed = this.promptTracker.getTypedLine()
                if (typed && typed.cursorOffset >= typed.text.length) {
                    void this.acceptSelected(false)
                    return true
                }
                return false
            }
            case 'Escape':
                this.close(true)
                return true
            default:
                return false
        }
    }

    /**
     * @description 鼠标点击菜单条目的接受入口：先把目标项设为选中再接受
     * @param index 目标建议项下标（越界时忽略）
     * @param execute 是否补换行立即执行（false 只补全不执行）
     * @returns void
     *
     * @example acceptAt(2, false) // 点击第 3 项 = 补全不执行
     *
     */
    acceptAt (index: number, execute: boolean): void {
        if (index >= 0 && index < this.state.items.length) {
            this.setState({ ...this.state, selectedIndex: index })
            void this.acceptSelected(execute)
        }
    }

    private moveSelection (delta: number): void {
        if (!this.state.items.length) {
            return
        }
        const next = (this.state.selectedIndex + delta + this.state.items.length) % this.state.items.length
        this.setState({ ...this.state, selectedIndex: next })
    }

    private async acceptSelected (execute: boolean): Promise<void> {
        const suggestion = this.state.items[this.state.selectedIndex]
        if (!suggestion) {
            this.close(false)
            return
        }
        const typed = this.promptTracker.getTypedLine()
        if (suggestion.kind === 'quickCommand' && suggestion.hasParams) {
            // 清空当前输入行（逐退格，不用 Ctrl+U 避免 kill ring 污染），再进填参表单；
            // 表单确认后经 sendText 整行发送 = 「整行替换后发送」
            if (typed) {
                let clear = ''
                if (typed.cursorOffset < typed.text.length) {
                    clear += '\x05' // 光标移到行尾再清（与无参分支同基准）
                }
                clear += '\x7f'.repeat(typed.text.length)
                this.host.sendInput(clear)
            }
            this.host.openQuickCommandForm(suggestion.quickCommandId!)
            this.close(false)
            return
        }
        if (typed) {
            // 历史/快捷命令的 label = 整行命令；路径的 label = 替换后的完整输入行（引擎已拼好）
            let sequence = ''
            if (typed.cursorOffset < typed.text.length) {
                sequence += '\x05' // 移到行尾再替换（建议以行尾为基准）
            }
            sequence += computeAcceptSequence(typed.text, suggestion.label)
            if (execute) {
                sequence += '\r'
            }
            this.host.sendInput(sequence)
        }
        this.close(false)
    }

    private async onSilence (): Promise<void> {
        const config = this.host.config()
        if (!config.enabled || this.host.isAlternateScreen() || !this.host.isFocusedPane()) {
            return
        }
        const recorded = this.promptTracker.takeRecordedCommand()
        if (recorded) {
            recordHistory(this.host.sourceKey(), this.stripUnlearnedPrompt(recorded))
        }
        if (config.trigger === 'auto' || this.state.open) {
            if (!this.state.open && config.trigger === 'auto') {
                // 自动弹出防抖：延迟 delay 毫秒再评估（静默重触发时重排计时）
                if (this.popupTimer !== undefined) {
                    clearTimeout(this.popupTimer)
                }
                this.popupTimer = setTimeout(() => {
                    this.popupTimer = undefined
                    void this.evaluate()
                }, config.delay)
            } else {
                // 菜单已开（随输入刷新路径）：立即评估，不打防抖
                this.clearPopupTimer()
                await this.evaluate()
            }
        }
    }

    /** 清掉挂起的自动弹出防抖计时 */
    private clearPopupTimer (): void {
        if (this.popupTimer !== undefined) {
            clearTimeout(this.popupTimer)
            this.popupTimer = undefined
        }
    }

    /**
     * @description 首条命令可能在提示符学习完成前被采集（Enter 早于任何静默，promptLen 仍为 0）：
     *              剥掉记录中残留的提示符前缀；正常流程命令不含提示符，此剥离为空操作
     * @param recorded 回车时采集的命令
     * @returns string 剥离残留提示符后的命令
     */
    private stripUnlearnedPrompt (recorded: string): string {
        const prefix = this.host.readCursorPrefix()
        if (prefix !== null && prefix.length > 0 && recorded.startsWith(prefix)) {
            return recorded.slice(prefix.length)
        }
        return recorded
    }

    private async evaluate (): Promise<void> {
        if (this.destroyed || this.evaluating) {
            return
        }
        this.evaluating = true
        try {
            const config = this.host.config()
            if (!config.enabled || this.host.isAlternateScreen() || !this.host.isFocusedPane()) {
                this.setState({ open: false, items: [], selectedIndex: 0 })
                return
            }
            const typed = this.promptTracker.getTypedLine()
            if (!typed || !typed.text.trim()) {
                this.setState({ open: false, items: [], selectedIndex: 0 })
                return
            }
            if (this.suppressed && typed.text === this.lastTyped) {
                return
            }
            this.lastTyped = typed.text
            this.suppressed = false
            await ensureHistoryLoaded()
            const context: SuggestionContext = {
                typedLine: typed.text,
                cursorOffset: typed.cursorOffset,
                source: this.host.sourceKey(),
                cwd: await this.host.cwd(),
            }
            const items = await computeSuggestions(context, {
                history: config.sources.history ? getHistorySnapshot() : undefined,
                quickCommands: config.sources.quickCommands ? this.host.quickCommands() : undefined,
                listDir: config.sources.paths ? dir => this.host.listDir(dir) : undefined,
            })
            this.setState({ open: items.length > 0, items, selectedIndex: 0 })
        } finally {
            this.evaluating = false
        }
    }

    private setState (state: SuggestionsUiState): void {
        this.state = state
        this.host.onState(state)
    }
}
