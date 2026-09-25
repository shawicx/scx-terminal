/**
 * @description 终端窗格输入建议装配（原 TerminalPane 建议段）：controller 状态/锚点/
 *              宿主键盘拦截与生命周期（setup/teardown 与重试共用同一宿主元素引用）。
 */
import { ref } from 'vue'
import type { BaseSession } from '@/lib/sessions/baseSession'
import { SshSession } from '@/lib/sessions/sshSession'
import type { XTermWebGLFrontend } from '@/lib/frontends/xtermFrontend'
import { encodeUTF8 } from '@/lib/utils/bytes'
import { SuggestionsController, type SuggestionsUiState } from '@/lib/suggestions/controller'
import type { QuickCommandSource } from '@/lib/suggestions/suggestionEngine'
import type { TerminalProfile } from '@/stores/config'
import type { ConfigStore } from '@/stores/config/types'
import { listLocalDir, SshPathLister } from '@/services/pathCompletion'
import { openQuickCommandPalette } from '@/services/quickCommandPalette'

/** usePaneSuggestions 的依赖集（全部现读访问器，配置/会话变更即时生效） */
export interface PaneSuggestionsDeps {
    profile: () => TerminalProfile
    active: () => boolean
    frontend: () => XTermWebGLFrontend | null
    session: () => BaseSession | null
    config: () => ConfigStore
    /** 宿主元素解析（setup 时调用一次并缓存，teardown 复用同一引用） */
    resolveHost: () => HTMLElement
}

/**
 * @description 窗格建议状态与生命周期
 * @param deps 组件级访问器
 * @returns 状态 refs、代理方法与 setup/teardown
 *
 * @example const sug = usePaneSuggestions(deps); sug.setup()
 *
 */
export function usePaneSuggestions (deps: PaneSuggestionsDeps) {
    const suggestionState = ref<SuggestionsUiState>({ open: false, items: [], selectedIndex: 0 })
    const suggestionAnchor = ref<{ left: number, top: number, hostHeight: number, maxWidth: number }>({ left: 0, top: 0, hostHeight: 0, maxWidth: 0 })
    let controller: SuggestionsController | null = null
    let sshPathLister: SshPathLister | null = null
    // setup 时保存的宿主元素引用：组件卸载后 resolveHost 可能拿不到，
    // add/remove 事件监听共用同一引用保证对称
    let hostEl: HTMLElement | null = null

    /** 历史分桶键：本地按档案、SSH 按主机（同源优先、全局兜底的「源」） */
    function historySourceKey (): string {
        const profile = deps.profile()
        if (profile.type === 'ssh') {
            return `ssh:${profile.user}@${profile.host}:${profile.port}`
        }
        return `local:${profile.id}`
    }

    /** 建议运行配置（每次评估现读，配置变更即时生效） */
    function suggestionsConfig () {
        const conf = deps.config().terminal.suggestions
        return {
            enabled: conf?.enabled ?? true,
            trigger: conf?.trigger ?? 'auto',
            delay: conf?.delay ?? 200,
            sources: conf?.sources ?? { history: true, quickCommands: true, paths: true },
        }
    }

    /** 菜单锚点刷新：从前端取光标像素位置写入 suggestionAnchor（open 与 resize 重锚共用） */
    function refreshAnchor (): void {
        const rect = deps.frontend()?.getSuggestionAnchorRect()
        if (rect) {
            suggestionAnchor.value = { left: rect.left, top: rect.top, hostHeight: rect.hostHeight, maxWidth: rect.hostWidth * 0.6 }
        }
    }

    /** host capture keydown：菜单打开时拦截导航键（先于 xterm textarea，不进热键状态机） */
    function onHostKeydownCapture (event: KeyboardEvent): void {
        if (suggestionState.value.open && controller?.handleKeydown(event)) {
            event.preventDefault()
            event.stopPropagation()
        }
    }

    /** 菜单条目点击回调：接受选中项（补全不执行） */
    function onSuggestionSelect (index: number): void {
        controller?.acceptAt(index, false)
    }

    /** 创建控制器并挂宿主键盘拦截（start 末尾调用） */
    function setup (): void {
        hostEl = deps.resolveHost()
        controller = new SuggestionsController({
            config: suggestionsConfig,
            isAlternateScreen: () => deps.frontend()?.isAlternateScreenActive() ?? false,
            isFocusedPane: () => deps.active(),
            readLine: () => deps.frontend()?.readLogicalLineNow() ?? null,
            readLineAbove: up => deps.frontend()?.readLogicalLineAbove(up) ?? null,
            readCursorPrefix: () => deps.frontend()?.readCursorPrefix() ?? null,
            anchorRect: () => deps.frontend()?.getSuggestionAnchorRect() ?? null,
            sourceKey: historySourceKey,
            cwd: async () => deps.session()?.getWorkingDirectory() ?? null,
            sshId: () => {
                const session = deps.session()
                return session instanceof SshSession ? session.sshSessionId : null
            },
            listDir: async dir => {
                const session = deps.session()
                if (session instanceof SshSession && session.sshSessionId) {
                    sshPathLister ??= new SshPathLister(session.sshSessionId)
                    return sshPathLister.list(dir)
                }
                return listLocalDir(dir)
            },
            quickCommands: (): QuickCommandSource[] => deps.config().quickCommands.map(qc => ({
                id: qc.id,
                name: qc.name,
                command: qc.command,
                groupName: deps.config().quickCommandGroups.find(group => group.id === qc.groupId)?.name ?? null,
            })),
            sendInput: text => deps.session()?.feedFromTerminal(encodeUTF8(text)),
            openQuickCommandForm: quickCommandId => openQuickCommandPalette(quickCommandId),
            onState: state => {
                suggestionState.value = state
                if (state.open) {
                    refreshAnchor()
                }
            },
        })
        hostEl.addEventListener('keydown', onHostKeydownCapture, true)
    }

    /** 销毁控制器/路径列举器并移除监听（窗格卸载与启动重试共用） */
    function teardown (): void {
        hostEl?.removeEventListener('keydown', onHostKeydownCapture, true)
        hostEl = null
        controller?.destroy()
        controller = null
        void sshPathLister?.close()
        sshPathLister = null
    }

    return {
        suggestionState, suggestionAnchor, refreshAnchor, onSuggestionSelect,
        setup, teardown,
        notifyInput: (data: Uint8Array) => controller?.notifyInput(data),
        notifyOutput: () => controller?.notifyOutput(),
        notifyDirectRecord: (text: string) => controller?.notifyDirectRecord(text),
        close: (accept: boolean) => controller?.close(accept),
        triggerManually: () => controller?.triggerManually(),
    }
}
