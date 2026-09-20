/**
 * @description 标签恢复快照：形状守卫（库内 JSON 是系统边界，须校验）+ 启动加载 +
 *              变更防抖同步（Task 6）。快照 schema v1：
 *              { version: 1, entries: [{ groupId, tabs: [{ profileId?, manualTitle?, color? }] }] }
 */
import { invoke } from '@tauri-apps/api/core'
import { watch } from 'vue'
import type { Tab } from '@/stores/tabs'
import type { TabGroup } from '@/stores/config'
import type { useConfigStore } from '@/stores/config'
import type { useTabsStore } from '@/stores/tabs'

/** 单个待恢复标签的最小快照 */
export interface TabSessionEntry {
    profileId?: string
    manualTitle?: string
    color?: string
}

/** 单个持久化分组的成员快照（组序 = tabGroups 定义序） */
export interface TabSessionGroup {
    groupId: string
    tabs: TabSessionEntry[]
}

/** 快照 v1 顶层形状 */
export interface TabSessionSnapshot {
    version: 1
    entries: TabSessionGroup[]
}

function isPlainObject (value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * @description 校验并归一化未知来源的快照 JSON：version 必须为 1，条目/字段逐个判型，
 *              非法条目整体拒绝（返回 null），非法字段丢弃
 * @param snapshot tab_session_get 返回的任意值
 * @returns TabSessionGroup[] | null 合法条目列表；形状不符返回 null
 *
 * @example normalizeTabSession({ version: 1, entries: [{ groupId: 'g1', tabs: [{}] }] }) // [{ groupId: 'g1', tabs: [{}] }]
 *
 */
export function normalizeTabSession (snapshot: unknown): TabSessionGroup[] | null {
    if (!isPlainObject(snapshot) || snapshot.version !== 1 || !Array.isArray(snapshot.entries)) {
        return null
    }
    const entries: TabSessionGroup[] = []
    for (const raw of snapshot.entries) {
        if (!isPlainObject(raw) || typeof raw.groupId !== 'string' || !Array.isArray(raw.tabs)) {
            return null
        }
        const tabs: TabSessionEntry[] = []
        for (const rawTab of raw.tabs) {
            if (!isPlainObject(rawTab)) {
                return null
            }
            const entry: TabSessionEntry = {}
            if (typeof rawTab.profileId === 'string') {
                entry.profileId = rawTab.profileId
            }
            if (typeof rawTab.manualTitle === 'string') {
                entry.manualTitle = rawTab.manualTitle
            }
            if (typeof rawTab.color === 'string') {
                entry.color = rawTab.color
            }
            tabs.push(entry)
        }
        entries.push({ groupId: raw.groupId, tabs })
    }
    return entries
}

/**
 * @description 从库中读快照（失败降级为 null，由调用方走无恢复路径）
 * @returns Promise<unknown> 原始 JSON 值或 null
 *
 * @example const snapshot = await loadTabSession()
 *
 */
export async function loadTabSession (): Promise<unknown> {
    try {
        return await invoke('tab_session_get')
    } catch (error) {
        console.error('could not load tab session', error)
        return null
    }
}

/**
 * @description 由当前标签与分组定义计算恢复快照（写侧纯函数）：仅含 persistTabs 组的
 *              终端标签；只存 profileId/manualTitle/color（OSC 动态 title 不存）；组序 =
 *              定义序，成员序 = 数组序
 * @param tabs 标签数组
 * @param groups 分组定义
 * @returns TabSessionSnapshot 快照
 *
 * @example computeSnapshot(tabsStore.tabs, configStore.store.tabGroups)
 *
 */
export function computeSnapshot (tabs: Tab[], groups: TabGroup[]): TabSessionSnapshot {
    const entries: TabSessionGroup[] = []
    for (const group of groups) {
        if (!group.persistTabs) {
            continue
        }
        const tabsOfGroup = tabs
            .filter(tab => tab.type === 'terminal' && tab.groupId === group.id)
            .map(tab => ({
                ...(tab.profileId ? { profileId: tab.profileId } : {}),
                ...(tab.manualTitle ? { manualTitle: tab.manualTitle } : {}),
                ...(tab.color ? { color: tab.color } : {}),
            }))
        entries.push({ groupId: group.id, tabs: tabsOfGroup })
    }
    return { version: 1, entries }
}

/**
 * @description 建立快照同步：deep watch（标签数组 + 分组定义）→ 500ms 防抖 → 序列化
 *              有变化才 invoke('tab_session_set')；失败 console.error 并转发 dev_log，
 *              重置基线待下次变更整体重写。必须在组件 setup 同步流创建 watch（WKWebView
 *              下异步创建不触发，见 config store 内注释先例）
 * @param tabsStore tabs store 实例
 * @param configStore config store 实例
 * @returns void
 *
 * @example initTabSessionSync(useTabsStore(), useConfigStore())
 *
 */
export function initTabSessionSync (
    tabsStore: ReturnType<typeof useTabsStore>,
    configStore: ReturnType<typeof useConfigStore>,
): void {
    let timer: ReturnType<typeof setTimeout> | null = null
    let lastWritten = ''
    const writeSnapshot = (): void => {
        const snapshot = computeSnapshot(tabsStore.tabs, configStore.store.tabGroups)
        const encoded = JSON.stringify(snapshot)
        if (encoded === lastWritten) {
            return
        }
        lastWritten = encoded
        void invoke('tab_session_set', { value: snapshot }).catch((error: unknown) => {
            lastWritten = ''
            console.error('could not persist tab session', error)
            void invoke('dev_log', { message: `[tabSession] flush failed: ${String(error)}` }).catch(() => {})
        })
    }
    watch(
        () => [tabsStore.tabs, configStore.store.tabGroups] as const,
        () => {
            if (timer) {
                clearTimeout(timer)
            }
            timer = setTimeout(() => {
                timer = null
                writeSnapshot()
            }, 500)
        },
        { deep: true },
    )
}
