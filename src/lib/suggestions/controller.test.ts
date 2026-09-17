/**
 * @description 建议控制器单测：接受序列计算（公共前缀 + 退格）、菜单键盘语义、
 *              Esc 抑制自动弹出、评估触发条件
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeAcceptSequence, type SuggestionsControllerHost } from './controller'
import type { LogicalLine } from './promptTracker'

describe('computeAcceptSequence', () => {
    it('keeps the common prefix and only backspaces the difference', () => {
        // 'git che' 整体是 'git checkout dev' 的前缀 → 0 退格，只追加剩余
        expect(computeAcceptSequence('git che', 'git checkout dev')).toBe('ckout dev')
    })

    it('returns exactly the replacement when there is no overlap', () => {
        expect(computeAcceptSequence('abc', 'xyz')).toBe('\x7f\x7f\x7fxyz')
    })

    it('appends nothing extra when the current text is a prefix of the replacement', () => {
        expect(computeAcceptSequence('git', 'git status')).toBe(' status')
    })

    it('backspaces the diverging tail', () => {
        expect(computeAcceptSequence('git chx', 'git checkout')).toBe('\x7feckout')
    })
})

function makeHost (overrides: Partial<SuggestionsControllerHost> = {}): SuggestionsControllerHost & { sent: string[] } & { setLine (next: LogicalLine): void } {
    const sent: string[] = []
    // 逻辑行带提示符前缀（PromptTracker 从 readCursorPrefix 学得 promptLen = 13，
    // 剥离后 typedLine = 'git che'）
    let line: LogicalLine = { text: 'user@mac ~ % git che', cursorOffset: 20 }
    const host: SuggestionsControllerHost & { sent: string[] } = {
        sent,
        config: () => ({ enabled: true, trigger: 'auto', delay: 200, sources: { history: true, quickCommands: true, paths: true } }),
        isAlternateScreen: () => false,
        isFocusedPane: () => true,
        readLine: () => line,
        readLineAbove: () => null,
        readCursorPrefix: () => 'user@mac ~ % ',
        anchorRect: () => ({ left: 10, top: 20, hostHeight: 400, hostWidth: 600 }),
        sourceKey: () => 'local:p1',
        cwd: async () => '/Users/x',
        sshId: () => null,
        listDir: async () => [],
        quickCommands: () => [],
        sendInput: text => { sent.push(text) },
        openQuickCommandForm: () => {},
        onState: () => {},
        ...overrides,
    }
    // 测试中改写输入行的入口（覆盖 readLine 的闭包变量）
    return Object.assign(host, {
        setLine (next: LogicalLine) { line = next },
    })
}

describe('SuggestionsController', () => {
    beforeEach(() => {
        // 顶部静态导入已把 './controller' 计入模块缓存；清空注册表使 vi.doMock 对测试内动态 import 生效
        vi.resetModules()
        vi.useFakeTimers()
    })
    afterEach(() => { vi.useRealTimers() })

    it('opens the menu after output silence when history matches', async () => {
        vi.doMock('@/services/history', () => ({
            ensureHistoryLoaded: async () => {},
            getHistorySnapshot: () => [{ source: 'local:p1', command: 'git checkout dev', runAt: 1, hitCount: 1 }],
            recordHistory: () => {},
        }))
        const { SuggestionsController: Controller } = await import('./controller')
        const states: { open: boolean, items: string[] }[] = []
        const host = makeHost({ onState: state => states.push({ open: state.open, items: state.items.map(i => i.label) }) })
        const controller = new Controller(host)
        controller.notifyOutput()
        // 静默 250ms + 自动弹出延迟 200ms → 450ms 后打开
        await vi.advanceTimersByTimeAsync(500)
        controller.destroy()
        vi.doUnmock('@/services/history')
        expect(states.at(-1)?.open).toBe(true)
        expect(states.at(-1)?.items).toEqual(['git checkout dev'])
    })

    it('delays the auto popup by config.delay; manual trigger ignores the delay', async () => {
        vi.doMock('@/services/history', () => ({
            ensureHistoryLoaded: async () => {},
            getHistorySnapshot: () => [{ source: 'local:p1', command: 'git checkout dev', runAt: 1, hitCount: 1 }],
            recordHistory: () => {},
        }))
        const { SuggestionsController: Controller } = await import('./controller')
        const states: boolean[] = []
        const host = makeHost({
            config: () => ({ enabled: true, trigger: 'auto', delay: 60, sources: { history: true, quickCommands: true, paths: true } }),
            onState: state => states.push(state.open),
        })
        const controller = new Controller(host)
        controller.notifyOutput()
        // 静默 250ms + 延迟 60ms：309ms 未弹，310ms 弹出
        await vi.advanceTimersByTimeAsync(309)
        expect(states.at(-1) ?? false).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        expect(states.at(-1)).toBe(true)
        // 手动触发不等待延迟：关闭后立即触发、微任务冲刷后即开
        controller.close(false)
        controller.triggerManually()
        await vi.advanceTimersByTimeAsync(0)
        expect(states.at(-1)).toBe(true)
        controller.destroy()
        vi.doUnmock('@/services/history')
    })

    it('Enter accepts with execute: appends the diverging tail and \\r (no backspaces when fully prefixed)', async () => {
        vi.doMock('@/services/history', () => ({
            ensureHistoryLoaded: async () => {},
            getHistorySnapshot: () => [{ source: 'local:p1', command: 'git checkout dev', runAt: 1, hitCount: 1 }],
            recordHistory: () => {},
        }))
        const { SuggestionsController: Controller } = await import('./controller')
        const host = makeHost()
        const controller = new Controller(host)
        controller.notifyOutput()
        await vi.advanceTimersByTimeAsync(500)
        const consumed = controller.handleKeydown({ key: 'Enter' } as KeyboardEvent)
        controller.destroy()
        vi.doUnmock('@/services/history')
        expect(consumed).toBe(true)
        // typedLine 'git che' 是建议的完整前缀且光标在行尾 → 直接追加 'ckout dev\r'
        expect(host.sent).toEqual(['ckout dev\r'])
    })

    it('Esc closes and suppresses auto-popup until the typed line changes', async () => {
        vi.doMock('@/services/history', () => ({
            ensureHistoryLoaded: async () => {},
            getHistorySnapshot: () => [{ source: 'local:p1', command: 'git checkout dev', runAt: 1, hitCount: 1 }],
            recordHistory: () => {},
        }))
        const { SuggestionsController: Controller } = await import('./controller')
        const states: boolean[] = []
        const host = makeHost({ onState: state => states.push(state.open) })
        const controller = new Controller(host)
        controller.notifyOutput()
        await vi.advanceTimersByTimeAsync(500)
        controller.handleKeydown({ key: 'Escape' } as KeyboardEvent)
        // 同一行再静默：不自动弹
        controller.notifyOutput()
        await vi.advanceTimersByTimeAsync(500)
        // 行变化后恢复自动弹
        host.setLine({ text: 'user@mac ~ % git chec', cursorOffset: 21 })
        controller.notifyOutput()
        await vi.advanceTimersByTimeAsync(500)
        controller.destroy()
        vi.doUnmock('@/services/history')
        expect(states.filter(Boolean).length).toBe(2)
    })

    it('records the executed command after enter via prompt tracker silence callback', async () => {
        const recorded: [string, string][] = []
        vi.doMock('@/services/history', () => ({
            ensureHistoryLoaded: async () => {},
            getHistorySnapshot: () => [],
            recordHistory: (source: string, command: string) => recorded.push([source, command]),
        }))
        const { SuggestionsController: Controller } = await import('./controller')
        const host = makeHost()
        const controller = new Controller(host)
        controller.notifyInput(new Uint8Array([0x0d]))
        await vi.advanceTimersByTimeAsync(500)
        controller.destroy()
        vi.doUnmock('@/services/history')
        expect(recorded).toEqual([['local:p1', 'git che']])
    })
})
