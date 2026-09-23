/**
 * @description 连接中心（起始页）纯逻辑：SSH 档案分组视图构建、本地终端分组过滤、
 *              全局搜索过滤、最近连接排序与相对时间分桶。UI 无关，便于单测。
 */
import { groupLocalProfiles, type LocalGroup, type LocalProfile, type LocalProfileSection, type SshGroup, type SshProfile, type TerminalProfile } from '@/stores/config'

/** 起始页一组的展示视图（'default' 为内置默认组 id，展示名由组件按 i18n 解析） */
export interface StartGroupView {
    id: 'default' | string
    name: string
    profiles: SshProfile[]
}

/** 分组 id → 名称索引（搜索按组名匹配用） */
export type GroupNameIndex = Map<string, string>

/** 最近连接条目（已过滤悬空档案） */
export interface RecentEntry {
    profile: SshProfile
    ts: number
}

/** 相对时间分桶结果（组件按 kind 做 i18n 渲染） */
export interface RelativeTimeBucket {
    kind: 'today' | 'yesterday' | 'weekday' | 'date'
    /** HH:mm（today / yesterday 档用） */
    time: string
    /** 星期几，0-6 周日为 0（weekday 档用） */
    weekday: number
    /** YYYY-MM-DD（date 档用） */
    date: string
}

/**
 * @description 构建 SSH 档案分组视图：无 groupId 或 groupId 悬空的档案归「默认」组
 *              （排最前，为空则不出现）；自定义组按 groups 顺序保留（空组也保留供侧栏计数）
 * @param profiles 全部档案（取其中 ssh 类型）
 * @param groups SSH 分组列表（config 顺序）
 * @returns StartGroupView[] 分组视图
 *
 * @example buildGroupViews(sshProfiles, []) // [ { id: 'default', ... } ]
 *
 */
export function buildGroupViews (profiles: TerminalProfile[], groups: SshGroup[]): StartGroupView[] {
    const sshProfiles = profiles.filter((p): p is SshProfile => p.type === 'ssh')
    const defaultProfiles = sshProfiles.filter(p => !p.groupId || !groups.some(g => g.id === p.groupId))
    const views: StartGroupView[] = defaultProfiles.length > 0
        ? [{ id: 'default', name: '', profiles: defaultProfiles }]
        : []
    for (const group of groups) {
        views.push({ id: group.id, name: group.name, profiles: sshProfiles.filter(p => p.groupId === group.id) })
    }
    return views
}

/**
 * @description 全局搜索过滤：query 对档案 name/host/user/所属组名做不区分大小写
 *              includes；空组整体隐藏；query 为空（或纯空白）原样返回
 * @param views 分组视图
 * @param query 搜索词
 * @param groupNames 分组 id → 名称索引
 * @returns StartGroupView[] 过滤后视图
 *
 * @example filterGroupViews(views, 'gw', names).length // 1
 *
 */
export function filterGroupViews (views: StartGroupView[], query: string, groupNames: GroupNameIndex): StartGroupView[] {
    const q = query.trim().toLowerCase()
    if (!q) {
        return views
    }
    const match = (p: SshProfile): boolean =>
        p.name.toLowerCase().includes(q) ||
        p.host.toLowerCase().includes(q) ||
        p.user.toLowerCase().includes(q) ||
        (p.groupId ? groupNames.get(p.groupId) ?? '' : '').toLowerCase().includes(q)
    return views
        .map(view => ({ ...view, profiles: view.profiles.filter(match) }))
        .filter(view => view.profiles.length > 0)
}

/**
 * @description 本地终端分组视图构建（连接中心用）：直接复用设置页分段逻辑（分组定义序、
 *              未分组段置末、悬空 groupId 容错归未分组）
 * @param profiles 全部档案（取其中 local 类型）
 * @param groups 本地分组列表（config 顺序）
 * @returns LocalProfileSection[] 分段列表（空段保留，是否隐藏由渲染层决定）
 *
 * @example buildLocalSections([{ name: 'zsh' }], [{ id: 'localgroup-zsh', name: 'zsh', builtin: true }]).length // 1
 *
 */
export function buildLocalSections (profiles: TerminalProfile[], groups: LocalGroup[]): LocalProfileSection[] {
    const localProfiles = profiles.filter((p): p is LocalProfile => p.type === 'local')
    return groupLocalProfiles(localProfiles, groups)
}

/**
 * @description 本地终端分段搜索过滤：query 对档案 name/command/所属组名做不区分大小写
 *              includes；组名命中保留整段，否则逐档案过滤；空段丢弃；query 为空原样返回
 * @param sections 分段列表
 * @param query 搜索词
 * @returns LocalProfileSection[] 过滤后分段
 *
 * @example filterLocalSections(sections, 'zsh').length // 1
 *
 */
export function filterLocalSections (sections: LocalProfileSection[], query: string): LocalProfileSection[] {
    const q = query.trim().toLowerCase()
    if (!q) {
        return sections
    }
    return sections
        .map(section => {
            if (section.group && section.group.name.toLowerCase().includes(q)) {
                return section
            }
            return { group: section.group, profiles: section.profiles.filter(p =>
                p.name.toLowerCase().includes(q) || p.command.toLowerCase().includes(q)) }
        })
        .filter(section => section.profiles.length > 0)
}

/**
 * @description 最近连接排序：按时间降序取前 limit 条，过滤已删除档案与非 ssh 档案
 * @param recents 最近连接记录（profileId → epoch 毫秒）
 * @param profiles 全部档案
 * @param limit 取前 N 条（默认 8）
 * @returns RecentEntry[] 降序列表
 *
 * @example recentEntries({ a: 2, b: 1 }, profiles)[0].profile.id // 'a'
 *
 */
export function recentEntries (recents: Record<string, number>, profiles: TerminalProfile[], limit = 8): RecentEntry[] {
    const byId = new Map(profiles.map(p => [p.id, p]))
    return Object.entries(recents)
        .flatMap(([id, ts]) => {
            const profile = byId.get(id)
            return profile && profile.type === 'ssh' ? [{ profile, ts }] : []
        })
        .sort((a, b) => b.ts - a.ts)
        .slice(0, limit)
}

/**
 * @description 相对时间分桶：今天（含未来时刻）→ 昨天 → 最近 7 天内（按周几）→ 更早日期
 * @param ts 目标时间（epoch 毫秒）
 * @param now 当前时间（默认 Date.now()）
 * @returns RelativeTimeBucket 分桶结果
 *
 * @example relativeTimeBucket(Date.now()).kind // 'today'
 *
 */
export function relativeTimeBucket (ts: number, now = Date.now()): RelativeTimeBucket {
    const target = new Date(ts)
    const current = new Date(now)
    const pad = (n: number) => String(n).padStart(2, '0')
    const time = `${pad(target.getHours())}:${pad(target.getMinutes())}`
    const date = `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`
    const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    const days = Math.round((dayStart(current) - dayStart(target)) / 86_400_000)
    if (days <= 0) {
        return { kind: 'today', time, weekday: target.getDay(), date }
    }
    if (days === 1) {
        return { kind: 'yesterday', time, weekday: target.getDay(), date }
    }
    if (days <= 7) { // 含今日往前 7 天内按周几展示（覆盖跨自然周场景）
        return { kind: 'weekday', time, weekday: target.getDay(), date }
    }
    return { kind: 'date', time, weekday: target.getDay(), date }
}
