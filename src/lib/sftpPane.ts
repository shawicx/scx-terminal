/**
 * @description SFTP 双栏浏览的纯逻辑：统一条目类型（本地/远端同形）、列排序（目录恒前）、
 *              路径拼接/父目录/面包屑分段。远端路径 POSIX 语义，本地路径复用同一拼接
 *              （macOS 单一 '/' 分隔符）。
 */

/** 浏览栏条目（本地/远端统一形状） */
export interface PaneEntry {
    name: string
    path: string
    isDir: boolean
    isSymlink: boolean
    size: number | null
    mtimeMs: number | null
}

export type SortKey = 'name' | 'size' | 'mtime'
export type SortDir = 'asc' | 'desc'

/**
 * @description 目录排序：目录恒在文件前，组内按 key 排序（name 不区分大小写；
 *              size/mtime 空值排尾）
 * @param entries 待排序条目
 * @param key 排序列
 * @param dir 升/降
 * @returns PaneEntry[] 新数组（不改原数组）
 *
 * @example sortPaneEntries(entries, 'size', 'desc')
 *
 */
export function sortPaneEntries (entries: PaneEntry[], key: SortKey, dir: SortDir): PaneEntry[] {
    const factor = dir === 'asc' ? 1 : -1
    return [...entries].sort((a, b) => {
        if (a.isDir !== b.isDir) {
            return a.isDir ? -1 : 1
        }
        let result = 0
        if (key === 'name') {
            result = a.name.toLowerCase().localeCompare(b.name.toLowerCase())
        } else {
            const av = key === 'size' ? a.size : a.mtimeMs
            const bv = key === 'size' ? b.size : b.mtimeMs
            // 空值（未知大小/时间）排尾：asc 时 null 最大，desc 时 null 最小
            if (av === null && bv === null) {
                result = 0
            } else if (av === null) {
                return 1
            } else if (bv === null) {
                return -1
            } else {
                result = av - bv
            }
        }
        return result * factor
    })
}

/**
 * @description 路径拼接（dir/name；根目录不加双斜杠；本地/远端同构）
 * @param dir 目录路径
 * @param name 条目名
 * @returns string
 *
 * @example joinPanePath('/home', 'a.txt') // '/home/a.txt'
 *
 */
export function joinPanePath (dir: string, name: string): string {
    const base = dir.endsWith('/') ? dir : `${dir}/`
    return `${base}${name}`
}

/**
 * @description 父目录路径（根的父目录仍是根）
 * @param path 路径
 * @returns string
 *
 * @example parentPanePath('/home/scx') // '/home'
 *
 */
export function parentPanePath (path: string): string {
    const trimmed = path.replace(/\/+$/, '') || '/'
    const slash = trimmed.lastIndexOf('/')
    return slash <= 0 ? '/' : trimmed.slice(0, slash)
}

export interface BreadcrumbSegment {
    label: string
    path: string
}

/**
 * @description 面包屑分段：'/' → [{ label: '/', path: '/' }]；
 *              '/home/scx/x' → 根 + 每级目录（label 不含 '/'）
 * @param path 目录路径
 * @returns BreadcrumbSegment[]
 *
 * @example breadcrumbSegments('/home/scx') // [{label:'/',path:'/'},{label:'home',...},{label:'scx',...}]
 *
 */
export function breadcrumbSegments (path: string): BreadcrumbSegment[] {
    const segments: BreadcrumbSegment[] = [{ label: '/', path: '/' }]
    const parts = path.split('/').filter(Boolean)
    let current = ''
    for (const part of parts) {
        current += `/${part}`
        segments.push({ label: part, path: current })
    }
    return segments
}
