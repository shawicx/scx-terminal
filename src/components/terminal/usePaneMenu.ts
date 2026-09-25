/**
 * @description 终端窗格右键菜单（原 TerminalPane 菜单段）：项构造（SSH 档案追加
 *              SFTP/转发入口）、选区状态刷新与分发（动作由依赖回调注入）。
 */
import { computed, ref } from 'vue'
import type { ComposerTranslation } from 'vue-i18n'
import type { ContextMenuItemSpec } from '@/components/ui/ContextMenu.vue'

/** usePaneMenu 的动作集（组件既有能力复用） */
export interface PaneMenuActions {
    copy (): void
    paste (): void
    selectAll (): void
    clear (): void
    find (): void
    openSftp (): void
    toggleForward (): void
    splitRight (): void
    splitDown (): void
    closePane (): void
}

/** usePaneMenu 的依赖集 */
export interface PaneMenuDeps {
    t: ComposerTranslation
    isSsh: () => boolean
    hasSelection: () => boolean
    actions: PaneMenuActions
}

/**
 * @description 右键菜单状态与处理器
 * @param deps i18n/档案类型/选区访问器/动作集
 * @returns menuItems/onMenuOpen/onMenuSelect
 *
 * @example const menu = usePaneMenu({ t, isSsh: () => props.profile.type === 'ssh', ... })
 *
 */
export function usePaneMenu (deps: PaneMenuDeps) {
    const menuHasSelection = ref(false)

    /**
     * @description 右键菜单打开时刷新选区状态（用于"复制"项的禁用判定）
     * @param open 菜单是否打开
     * @returns void
     *
     */
    function onMenuOpen (open: boolean): void {
        if (open) {
            menuHasSelection.value = deps.hasSelection()
        }
    }

    const menuItems = computed<ContextMenuItemSpec[]>(() => [
        { key: 'copy', label: deps.t('commands.copy'), disabled: !menuHasSelection.value },
        { key: 'paste', label: deps.t('commands.paste') },
        { key: 'select-all', label: deps.t('commands.selectAll') },
        { key: 'clear', label: deps.t('commands.clear'), separatorBefore: true },
        { key: 'find', label: deps.t('commands.find') },
        ...(deps.isSsh()
            ? [
                { key: 'sftp', label: deps.t('sftp.menuToggle'), separatorBefore: true },
                { key: 'forward', label: deps.t('forward.menuToggle') },
            ]
            : []),
        { key: 'split-right', label: deps.t('commands.splitRight'), separatorBefore: true },
        { key: 'split-down', label: deps.t('commands.splitDown') },
        { key: 'close-pane', label: deps.t('commands.closePane'), danger: true },
    ])

    /**
     * @description 处理终端右键菜单选择，动作复用窗格既有能力
     * @param key 菜单项 key
     * @returns void
     *
     */
    function onMenuSelect (key: string): void {
        const actions = deps.actions
        switch (key) {
            case 'copy': actions.copy(); break
            case 'paste': actions.paste(); break
            case 'select-all': actions.selectAll(); break
            case 'clear': actions.clear(); break
            case 'find': actions.find(); break
            case 'sftp': actions.openSftp(); break
            case 'forward': actions.toggleForward(); break
            case 'split-right': actions.splitRight(); break
            case 'split-down': actions.splitDown(); break
            case 'close-pane': actions.closePane(); break
        }
    }

    return { menuItems, onMenuOpen, onMenuSelect }
}
