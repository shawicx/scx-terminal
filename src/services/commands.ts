import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTabsStore } from '@/stores/tabs'
import { useConfigStore, type QuickCommand, type TerminalProfile } from '@/stores/config'
import { terminalTabApi } from './terminalTabsApi'
import { openQuickCommandPalette } from './quickCommandPalette'
import { hotkeys } from './hotkeysSingleton'
import { hkLog } from '@/services/hkDebug'
import { defaultDarkColorScheme, defaultLightColorScheme } from '@/lib/colorSchemes'
import { writeClipboardText } from '@/lib/frontendContext'
import { parseQuickCommandParams, previewQuickCommand } from '@/lib/quickCommands'

export interface Command {
    id: string
    group: string
    hotkeyId?: string
    label: () => string
    handler: () => void
    enabled?: () => boolean
}

const commands = ref<Command[]>([])
export const paletteOpen = ref(false)

export function useCommands () {
    const { t } = useI18n()
    const tabs = useTabsStore()
    const config = useConfigStore()

    function register (command: Command): void {
        if (!commands.value.some(c => c.id === command.id)) {
            commands.value.push(command)
        }
    }

    /**
     * @description 取当前活动标签活动窗格的 cwd 后按档案开新标签（新标签 cwd 继承入口；
     *              活动标签不是终端标签时 cwd 为 null，走 HOME 兜底）
     * @param profileId 配置档案 id（缺省 = 默认档案）
     * @returns Promise<void>
     *
     * @example void openNewTerminalTabWithCwd('local-zsh-abc')
     *
     */
    async function openNewTerminalTabWithCwd (profileId?: string): Promise<void> {
        const cwd = await terminalTabApi.current?.getActivePaneCwd() ?? null
        tabs.openTerminalTab(profileId, cwd)
    }

    const PROFILE_COMMAND_PREFIX = 'new-tab-profile:'
    const SFTP_PROFILE_COMMAND_PREFIX = 'sftp-profile:'

    /**
     * 同步式注册"按档案新建标签"命令：先移除全部旧命令再按当前档案重建
     * （档案增删改名后由 App.vue 的 watch 调用）；SSH 档案用「连接」文案与本地终端区分，
     *              SSH 档案同时注册「在 SFTP 中打开」命令（双栏文件传输标签）
     */
    function registerProfileCommands (profiles: TerminalProfile[]): void {
        commands.value = commands.value.filter(c =>
            !c.id.startsWith(PROFILE_COMMAND_PREFIX) && !c.id.startsWith(SFTP_PROFILE_COMMAND_PREFIX))
        for (const profile of profiles) {
            if (profile.type !== 'local' && profile.type !== 'ssh') {
                continue
            }
            register({
                id: `${PROFILE_COMMAND_PREFIX}${profile.id}`,
                group: 'tab',
                label: () => profile.type === 'ssh'
                    ? t('commands.newTabWithSshProfile', { name: profile.name })
                    : t('commands.newTabWithProfile', { name: profile.name }),
                handler: () => void openNewTerminalTabWithCwd(profile.id),
            })
            if (profile.type === 'ssh') {
                register({
                    id: `${SFTP_PROFILE_COMMAND_PREFIX}${profile.id}`,
                    group: 'sftp',
                    label: () => t('commands.openSftpWithProfile', { name: profile.name }),
                    handler: () => tabs.openSftpTab(profile.id),
                })
            }
        }
    }

    const QUICK_COMMAND_PREFIX = 'quick-command:'

    /**
     * 同步式注册"快捷命令"面板条目：先移除全部旧命令再按当前命令重建
     * （增删改后由 App.vue 的 watch 调用）。无参数命令直接发送；
     * 有参数命令打开选择器并直接进入填参态
     */
    function registerQuickCommandCommands (quickCommands: QuickCommand[]): void {
        commands.value = commands.value.filter(c => !c.id.startsWith(QUICK_COMMAND_PREFIX))
        for (const quickCommand of quickCommands) {
            register({
                id: `${QUICK_COMMAND_PREFIX}${quickCommand.id}`,
                group: 'quickCommand',
                label: () => quickCommand.name || previewQuickCommand(quickCommand.command),
                enabled: () => !!terminalTabApi.current,
                handler: () => {
                    if (parseQuickCommandParams(quickCommand.command).length) {
                        openQuickCommandPalette(quickCommand.id)
                    } else {
                        terminalTabApi.current?.sendTextToActivePane(quickCommand.command, quickCommand.autoRun)
                    }
                },
            })
        }
    }

    function registerDefaults (): void {
        register({
            id: 'command-palette', group: 'app', hotkeyId: 'command-palette',
            label: () => t('commands.commandPalette'),
            handler: () => (paletteOpen.value = true),
        })
        register({
            id: 'new-tab', group: 'tab', hotkeyId: 'new-tab',
            label: () => t('commands.newTab'),
            handler: () => void openNewTerminalTabWithCwd(),
        })
        register({
            id: 'close-tab', group: 'tab', hotkeyId: 'close-tab',
            label: () => t('commands.closeTab'),
            handler: () => {
                if (tabs.activeId) {
                    tabs.closeTab(tabs.activeId)
                }
            },
            enabled: () => !!tabs.activeId,
        })
        register({
            id: 'next-tab', group: 'tab', hotkeyId: 'next-tab',
            label: () => t('commands.nextTab'),
            handler: () => {
                const index = tabs.tabs.findIndex(tab => tab.id === tabs.activeId)
                if (index >= 0 && tabs.tabs.length > 1) {
                    tabs.activate(tabs.tabs[(index + 1) % tabs.tabs.length]!.id)
                }
            },
            enabled: () => tabs.tabs.length > 1,
        })
        register({
            id: 'prev-tab', group: 'tab', hotkeyId: 'prev-tab',
            label: () => t('commands.prevTab'),
            handler: () => {
                const index = tabs.tabs.findIndex(tab => tab.id === tabs.activeId)
                if (index >= 0 && tabs.tabs.length > 1) {
                    tabs.activate(tabs.tabs[(index - 1 + tabs.tabs.length) % tabs.tabs.length]!.id)
                }
            },
            enabled: () => tabs.tabs.length > 1,
        })
        register({
            id: 'split-right', group: 'terminal', hotkeyId: 'split-right',
            label: () => t('commands.splitRight'),
            handler: () => terminalTabApi.current?.split('right'),
        })
        register({
            id: 'split-down', group: 'terminal', hotkeyId: 'split-down',
            label: () => t('commands.splitDown'),
            handler: () => terminalTabApi.current?.split('down'),
        })
        register({
            id: 'close-pane', group: 'terminal', hotkeyId: 'close-pane',
            label: () => t('commands.closePane'),
            handler: () => terminalTabApi.current?.closePane(),
        })
        register({
            id: 'navigate-pane-forward', group: 'terminal', hotkeyId: 'pane-forward',
            label: () => t('commands.paneForward'),
            handler: () => terminalTabApi.current?.navigatePane(1),
        })
        register({
            id: 'navigate-pane-back', group: 'terminal', hotkeyId: 'pane-back',
            label: () => t('commands.paneBack'),
            handler: () => terminalTabApi.current?.navigatePane(-1),
        })
        register({
            id: 'copy', group: 'terminal', hotkeyId: 'copy',
            label: () => t('commands.copy'),
            handler: () => terminalTabApi.current?.copy(),
        })
        register({
            id: 'paste', group: 'terminal', hotkeyId: 'paste',
            label: () => t('commands.paste'),
            handler: () => terminalTabApi.current?.paste(),
        })
        register({
            id: 'clear', group: 'terminal', hotkeyId: 'clear',
            label: () => t('commands.clear'),
            handler: () => terminalTabApi.current?.clear(),
        })
        register({
            id: 'find', group: 'terminal', hotkeyId: 'find',
            label: () => t('commands.find'),
            handler: () => terminalTabApi.current?.find(),
        })
        register({
            id: 'open-suggestions', group: 'terminal', hotkeyId: 'suggestions-trigger',
            label: () => t('commands.openSuggestions'),
            enabled: () => !!terminalTabApi.current,
            handler: () => terminalTabApi.current?.triggerSuggestions(),
        })
        register({
            id: 'toggle-forward', group: 'terminal',
            label: () => t('forward.menuToggle'),
            enabled: () => !!terminalTabApi.current,
            handler: () => terminalTabApi.current?.toggleForward(),
        })
        register({
            id: 'open-sftp', group: 'sftp',
            label: () => t('commands.openSftp'),
            enabled: () => {
                const tab = tabs.activeTab
                return !!tab?.profileId
                    && config.store.profiles.some(p => p.id === tab.profileId && p.type === 'ssh')
            },
            handler: () => {
                const profileId = tabs.activeTab?.profileId
                if (profileId) {
                    tabs.openSftpTab(profileId)
                }
            },
        })
        register({
            id: 'copy-current-path', group: 'terminal', hotkeyId: 'copy-current-path',
            label: () => t('commands.copyCurrentPath'),
            enabled: () => !!terminalTabApi.current,
            handler: () => {
                void (async () => {
                    const cwd = await terminalTabApi.current?.getActivePaneCwd()
                    if (cwd) {
                        void writeClipboardText(cwd)
                    }
                })()
            },
        })
        register({
            id: 'open-quick-commands', group: 'app', hotkeyId: 'quick-commands-palette',
            label: () => t('commands.quickCommands'),
            enabled: () => !!terminalTabApi.current,
            handler: () => openQuickCommandPalette(),
        })
        register({
            id: 'open-settings', group: 'app',
            label: () => t('commands.openSettings'),
            handler: () => tabs.openSettingsTab(),
        })
        register({
            id: 'open-forwarding', group: 'app',
            label: () => t('commands.openForwarding'),
            handler: () => tabs.openForwardingTab(),
        })
        register({
            id: 'toggle-color-scheme', group: 'app',
            label: () => t('commands.toggleColorScheme'),
            handler: () => {
                const current = config.store.appearance.colorScheme
                const osLight = window.matchMedia('(prefers-color-scheme: light)').matches
                const isLight = current === 'light' || current === defaultLightColorScheme.name ||
                    (current === 'auto' && osLight)
                // 与设置页下拉的值域保持一致：在两套默认配色之间切换
                config.store.appearance.colorScheme =
                    isLight ? defaultDarkColorScheme.name : defaultLightColorScheme.name
            },
        })
    }

    function dispatchHotkey (hotkeyId: string): void {
        hkLog(`DISPATCH ${hotkeyId}`)
        const command = commands.value.find(c => c.hotkeyId === hotkeyId)
        if (command && (!command.enabled || command.enabled())) {
            command.handler()
        }
    }

    function bindHotkeys (): void {
        hotkeys.hotkey$.subscribe(hotkeyId => dispatchHotkey(hotkeyId))
    }

    const sortedCommands = computed(() => {
        const groups = ['tab', 'terminal', 'sftp', 'quickCommand', 'app']
        return [...commands.value].sort((a, b) =>
            groups.indexOf(a.group) - groups.indexOf(b.group) || a.id.localeCompare(b.id))
    })

    return { register, registerDefaults, registerProfileCommands, registerQuickCommandCommands, dispatchHotkey, bindHotkeys, sortedCommands, commands }
}
