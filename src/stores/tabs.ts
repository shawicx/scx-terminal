import { defineStore } from 'pinia'
import { nanoid } from 'nanoid'
import { useConfigStore } from '@/stores/config'
import { visibleNeighborId } from '@/components/titlebar/tabGroupLayout'
import { normalizeTabSession } from '@/services/tabSession'

export type TabType = 'terminal' | 'settings' | 'sftp' | 'forwarding' | 'start'

/** 设置页分页 id（SettingsView 的 page 取值；Tab.initialPage 深链用） */
export type SettingsPageId = 'terminal' | 'profiles' | 'ssh' | 'quickCommands' | 'keys' | 'appearance' | 'colorSchemes' | 'hotkeys' | 'tabGroups' | 'backup' | 'about'

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
    /** 所属标签分组 id（见 config.store.tabGroups）；缺省 = 未分组 */
    groupId?: string
    /** 设置页深链分页（仅新建 settings 标签时生效） */
    initialPage?: SettingsPageId
}

/**
 * Tab management. All tab panes stay mounted (v-show) so background
 * sessions keep running, mirroring Tabby's behavior.
 */
export const useTabsStore = defineStore('tabs', {
    state: () => ({
        tabs: [] as Tab[],
        activeId: null as string | null,
        /** 后台标签的响铃未读标记（tabId → true；非持久化，切换/关闭标签时清除） */
        alerts: {} as Record<string, true>,
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
         * @param groupId 目标分组 id（可选；组不存在时不归属）
         * @returns Tab 新标签
         *
         * @example openTerminalTab(undefined, '/tmp', 'g1')
         *
         */
        openTerminalTab (profileId?: string, cwd?: string | null, groupId?: string): Tab {
            const config = useConfigStore()
            const profile = profileId
                ? config.store.profiles.find(p => p.id === profileId)
                : (config.defaultProfile() ?? undefined)
            // cwd 继承仅对 local 档案有意义（SSH 档案的 cwd 是远端路径概念，忽略）
            const inheritsCwd = cwd && profile?.type === 'local' && !profile.cwd ? cwd : null
            // SSH 连接记录到最近连接（连接中心起始页消费；本地档案不记）
            if (profile?.type === 'ssh') {
                useConfigStore().noteRecentConnection(profile.id)
            }
            const group = groupId ? config.store.tabGroups.find(g => g.id === groupId) : undefined
            const tab: Tab = {
                id: nanoid(),
                type: 'terminal',
                title: profile?.name ?? '',
                profileId: profile?.id,
                cwd: inheritsCwd,
                ...(group ? { groupId: group.id } : {}),
            }
            this.tabs.push(tab)
            this.activeId = tab.id
            return tab
        },
        /**
         * @description 打开设置标签（单例：存在则聚焦，否则新建）；initialPage 深链
         *              分页仅在新建时生效，已存在标签的分页不被覆盖
         * @param initialPage 设置页深链分页（可选；仅新建时生效）
         * @returns Tab 设置标签
         *
         * @example openSettingsTab('ssh')
         *
         */
        openSettingsTab (initialPage?: SettingsPageId): Tab {
            const existing = this.tabs.find(t => t.type === 'settings')
            if (existing) {
                this.activeId = existing.id
                return existing
            }
            const tab: Tab = {
                id: `settings-${nanoid()}`,
                type: 'settings',
                title: 'Settings',
                ...(initialPage ? { initialPage } : {}),
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
        /**
         * @description 打开连接中心标签（单例：存在则聚焦，否则新建；标题由
         *              StartPageContent 挂载时按当前语言设置，同 ForwardingTabContent 先例）
         * @returns Tab 连接中心标签
         *
         * @example openStartTab()
         *
         */
        openStartTab (): Tab {
            const existing = this.tabs.find(t => t.type === 'start')
            if (existing) {
                this.activeId = existing.id
                return existing
            }
            const tab: Tab = {
                id: `start-${nanoid()}`,
                type: 'start',
                title: '',
            }
            this.tabs.push(tab)
            this.activeId = tab.id
            return tab
        },
        /**
         * @description 关闭标签；活动标签被关时接替激活展示序最近的可见邻居（折叠组成员
         *              不可见，直接跳过——见 visibleNeighborId），全部关空时回到连接中心起始页
         * @param id 标签 id
         *
         * @example closeTab('tab-1')
         *
         */
        closeTab (id: string) {
            const index = this.tabs.findIndex(t => t.id === id)
            if (index === -1) {
                return
            }
            // 邻居须在 splice 之前算：删除后折叠组归属等展示序信息仍在，但索引语义已变
            let neighborId: string | null = null
            if (this.activeId === id) {
                neighborId = visibleNeighborId(this.tabs, useConfigStore().store.tabGroups, id)
            }
            this.tabs.splice(index, 1)
            delete this.alerts[id]
            if (this.activeId === id) {
                this.activeId = neighborId
                // 接替激活的邻居已进入视野，其未读标记一并清除
                if (neighborId) {
                    delete this.alerts[neighborId]
                }
            }
            if (this.tabs.length === 0) {
                // 全部关空时回到连接中心起始页
                this.openStartTab()
            }
        },
        activate (id: string) {
            if (this.tabs.some(t => t.id === id)) {
                this.activeId = id
                delete this.alerts[id]
            }
        },
        /**
         * @description 设置标签归属分组；groupId 为 null 清除归属，组不存在时忽略（防悬空）
         * @param tabId 标签 id
         * @param groupId 目标组 id 或 null
         *
         * @example assignTabToGroup('tab-1', 'g1')
         *
         */
        assignTabToGroup (tabId: string, groupId: string | null) {
            const tab = this.tabs.find(t => t.id === tabId)
            if (!tab) {
                return
            }
            if (!groupId) {
                delete tab.groupId
                return
            }
            if (useConfigStore().store.tabGroups.some(group => group.id === groupId)) {
                tab.groupId = groupId
            }
        },
        /**
         * @description 拖拽落点统一入口：把标签移入目标组并落到 beforeTabId 之前；
         *              beforeTabId 为 null 时组目标追加到数组末尾（组内相对序：末尾即组尾），
         *              未分组目标同样落到数组末尾
         * @param tabId 被拖标签 id
         * @param groupId 目标组 id（null = 未分组）
         * @param beforeTabId 插入锚点标签 id（null = 该区域末尾）
         *
         * @example moveTabToGroup('tab-1', 'g1', 'tab-2') // tab-1 入 g1 组并插到 tab-2 前
         *
         */
        moveTabToGroup (tabId: string, groupId: string | null, beforeTabId: string | null) {
            const from = this.tabs.findIndex(t => t.id === tabId)
            if (from === -1) {
                return
            }
            const [tab] = this.tabs.splice(from, 1)
            if (!tab) {
                return
            }
            if (groupId) {
                this.assignTabToGroup(tab.id, groupId)
            } else {
                delete tab.groupId
            }
            // 锚点缺失（-1，如目标同组重排时自身已被移出）统一直落数组末尾；
            // 组内相对序是展示序的唯一消费点，末尾即组尾/未分组区尾
            const anchor = beforeTabId ? this.tabs.findIndex(t => t.id === beforeTabId) : -1
            this.tabs.splice(anchor === -1 ? this.tabs.length : anchor, 0, tab)
        },
        /**
         * @description 清除某组全部成员的归属（chip「全部移出本组」与设置页删组共用）；
         *              标签本身保留
         * @param groupId 组 id
         *
         * @example clearGroupMembership('g1')
         *
         */
        clearGroupMembership (groupId: string) {
            for (const tab of this.tabs) {
                if (tab.groupId === groupId) {
                    delete tab.groupId
                }
            }
        },
        /**
         * @description 按快照恢复持久化组的终端标签：按 config.store.tabGroups 定义序遍历
         *              （且仅 persistTabs 组），逐条 openTerminalTab（档案缺失时现语义自动落
         *              默认档案）后回填 manualTitle/color；恢复了至少一个标签才改 activeId
         * @param snapshot tab_session_get 返回的任意值
         * @returns boolean 是否恢复了至少一个标签
         *
         * @example restoreSession(await loadTabSession())
         *
         */
        restoreSession (snapshot: unknown): boolean {
            const entries = normalizeTabSession(snapshot)
            if (!entries || entries.length === 0) {
                return false
            }
            const config = useConfigStore()
            let first: Tab | null = null
            for (const entry of entries) {
                const group = config.store.tabGroups.find(g => g.id === entry.groupId && g.persistTabs)
                if (!group) {
                    continue
                }
                for (const item of entry.tabs) {
                    const tab = this.openTerminalTab(item.profileId, null, group.id)
                    if (item.manualTitle) {
                        tab.manualTitle = item.manualTitle
                    }
                    if (item.color) {
                        tab.color = item.color
                    }
                    first ??= tab
                }
            }
            if (first) {
                this.activeId = first.id
            }
            return first !== null
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
         * @description 标记后台标签有未读响铃（调用方仅对非激活标签触发；非持久化状态）
         * @param id 标签 id
         *
         * @example markAlert('tab-1')
         *
         */
        markAlert (id: string) {
            this.alerts[id] = true
        },
        /**
         * @description 清除标签的响铃未读标记
         * @param id 标签 id
         *
         * @example clearAlert('tab-1')
         *
         */
        clearAlert (id: string) {
            delete this.alerts[id]
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
            // 被关标签的未读标记随标签消亡；保留标签随即激活，标记同步清除
            this.alerts = {}
            this.activeId = id
        },
    },
})
