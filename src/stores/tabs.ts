import { defineStore } from 'pinia'
import { nanoid } from 'nanoid'

export type TabType = 'terminal' | 'settings'

export interface Tab {
    id: string
    type: TabType
    title: string
    /** 手动重命名的标题；存在时优先于 shell 上报标题（title）显示 */
    manualTitle?: string
    /** 标签颜色标记（CSS 颜色值） */
    color?: string
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
        openTerminalTab (): Tab {
            const tab: Tab = {
                id: nanoid(),
                type: 'terminal',
                title: '',
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
