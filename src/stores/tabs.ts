import { defineStore } from 'pinia'
import { nanoid } from 'nanoid'
import { useConfigStore } from '@/stores/config'

export type TabType = 'terminal' | 'settings' | 'sftp' | 'forwarding'

export interface Tab {
    id: string
    type: TabType
    title: string
    /** 手动重命名的标题；存在时优先于 shell 上报标题（title）显示 */
    manualTitle?: string
    /** 标签颜色标记（CSS 颜色值） */
    color?: string
    /** 开标签所用配置档案；缺省 = 默认档案 */
    profileId?: string
    /** 继承的初始工作目录（开标签时来自上一个活动标签；档案显式 cwd 优先于此值） */
    cwd?: string | null
}

/**
 * Tab management. All tab panes stay mounted (v-show) so background
 * sessions keep running, mirroring Tabby's behavior.
 */
export const useTabsStore = defineStore('tabs', {
    state: () => ({
        tabs: [] as Tab[],
        activeId: null as string | null,
    }),
    getters: {
        activeTab (state): Tab | null {
            return state.tabs.find(t => t.id === state.activeId) ?? null
        },
    },
    actions: {
        /**
         * @description 打开新的终端标签（缺省用默认档案；cwd 为继承的初始目录，
         *              档案显式配置了 cwd 时该值被忽略——同 Tabby getNewTabParameters 语义）
         * @param profileId 配置档案 id（缺省 = 默认档案）
         * @param cwd 继承的初始工作目录（可选）
         * @returns Tab 新标签
         *
         * @example openTerminalTab(undefined, '/tmp')
         *
         */
        openTerminalTab (profileId?: string, cwd?: string | null): Tab {
            const config = useConfigStore()
            const profile = profileId
                ? config.store.profiles.find(p => p.id === profileId)
                : (config.defaultProfile() ?? undefined)
            // cwd 继承仅对 local 档案有意义（SSH 档案的 cwd 是远端路径概念，忽略）
            const inheritsCwd = cwd && profile?.type === 'local' && !profile.cwd ? cwd : null
            const tab: Tab = {
                id: nanoid(),
                type: 'terminal',
                title: profile?.name ?? '',
                profileId: profile?.id,
                cwd: inheritsCwd,
            }
            this.tabs.push(tab)
            this.activeId = tab.id
            return tab
        },
        openSettingsTab (): Tab {
            const existing = this.tabs.find(t => t.type === 'settings')
            if (existing) {
                this.activeId = existing.id
                return existing
            }
            const tab: Tab = {
                id: `settings-${nanoid()}`,
                type: 'settings',
                title: 'Settings',
            }
            this.tabs.push(tab)
            this.activeId = tab.id
            return tab
        },
        /**
         * @description 打开档案的 SFTP 标签（本地/远端双栏文件传输；同一档案可开多个）
         * @param profileId SSH 档案 id
         * @returns Tab 新标签
         *
         * @example openSftpTab('ssh-web-01')
         *
         */
        openSftpTab (profileId: string): Tab {
            const config = useConfigStore()
            const profile = config.store.profiles.find(p => p.id === profileId)
            const tab: Tab = {
                id: nanoid(),
                type: 'sftp',
                title: `SFTP · ${profile?.name ?? ''}`,
                profileId,
            }
            this.tabs.push(tab)
            this.activeId = tab.id
            return tab
        },
        /**
         * @description 打开隧道管理器标签（单实例；标题由 ForwardingTabContent 挂载时按
         *              当前语言设置）
         * @returns Tab 隧道管理器标签
         *
         * @example openForwardingTab()
         *
         */
        openForwardingTab (): Tab {
            const existing = this.tabs.find(t => t.type === 'forwarding')
            if (existing) {
                this.activeId = existing.id
                return existing
            }
            const tab: Tab = {
                id: `forwarding-${nanoid()}`,
                type: 'forwarding',
                title: '',
            }
            this.tabs.push(tab)
            this.activeId = tab.id
            return tab
        },
        closeTab (id: string) {
            const index = this.tabs.findIndex(t => t.id === id)
            if (index === -1) {
                return
            }
            this.tabs.splice(index, 1)
            if (this.activeId === id) {
                const neighbor = this.tabs[Math.min(index, this.tabs.length - 1)]
                this.activeId = neighbor?.id ?? null
            }
            if (this.tabs.length === 0) {
                this.openTerminalTab()
            }
        },
        activate (id: string) {
            if (this.tabs.some(t => t.id === id)) {
                this.activeId = id
            }
        },
        moveTab (from: number, to: number) {
            if (from === to || from < 0 || to < 0 || from >= this.tabs.length || to >= this.tabs.length) {
                return
            }
            const [tab] = this.tabs.splice(from, 1)
            this.tabs.splice(to, 0, tab!)
        },
        setTitle (id: string, title: string) {
            const tab = this.tabs.find(t => t.id === id)
            if (tab) {
                tab.title = title
            }
        },
        /**
         * 重命名标签；空串清除手动标题，恢复显示 shell 上报标题
         */
        renameTab (id: string, title: string) {
            const tab = this.tabs.find(t => t.id === id)
            if (!tab) {
                return
            }
            const trimmed = title.trim()
            tab.manualTitle = trimmed || undefined
        },
        /**
         * 设置标签颜色标记；再次设置同色则清除
         */
        setTabColor (id: string, color?: string) {
            const tab = this.tabs.find(t => t.id === id)
            if (!tab) {
                return
            }
            tab.color = color && tab.color !== color ? color : undefined
        },
        /**
         * 关闭除指定标签外的全部标签
         */
        closeOtherTabs (id: string) {
            const keep = this.tabs.find(t => t.id === id)
            if (!keep) {
                return
            }
            this.tabs = [keep]
            this.activeId = id
        },
    },
})
