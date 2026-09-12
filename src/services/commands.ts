import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTabsStore } from '@/stores/tabs'
import { useConfigStore } from '@/stores/config'
import { terminalTabApi } from './terminalTabsApi'
import { hotkeys } from './hotkeysSingleton'

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

    function registerDefaults (): void {
        register({
            id: 'command-palette', group: 'app', hotkeyId: 'command-palette',
            label: () => t('commands.commandPalette'),
            handler: () => (paletteOpen.value = true),
        })
        register({
            id: 'new-tab', group: 'tab', hotkeyId: 'new-tab',
            label: () => t('commands.newTab'),
            handler: () => tabs.openTerminalTab(),
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
            id: 'open-settings', group: 'app',
            label: () => t('commands.openSettings'),
            handler: () => tabs.openSettingsTab(),
        })
        register({
            id: 'toggle-color-scheme', group: 'app',
            label: () => t('commands.toggleColorScheme'),
            handler: () => {
                const current = config.store.appearance.colorScheme
                config.store.appearance.colorScheme =
                    current === 'light' || (current === 'auto' && window.matchMedia('(prefers-color-scheme: light)').matches)
                        ? 'dark'
                        : 'light'
            },
        })
    }

    function dispatchHotkey (hotkeyId: string): void {
        const command = commands.value.find(c => c.hotkeyId === hotkeyId)
        if (command && (!command.enabled || command.enabled())) {
            command.handler()
        }
    }

    function bindHotkeys (): void {
        hotkeys.hotkey$.subscribe(hotkeyId => dispatchHotkey(hotkeyId))
    }

    const sortedCommands = computed(() => {
        const groups = ['tab', 'terminal', 'app']
        return [...commands.value].sort((a, b) =>
            groups.indexOf(a.group) - groups.indexOf(b.group) || a.id.localeCompare(b.id))
    })

    return { register, registerDefaults, dispatchHotkey, bindHotkeys, sortedCommands, commands }
}
