/**
 * @description 命令历史服务：Rust history_* 命令封装 + 模块级内存索引（建议引擎纯内存
 *              匹配用，LRU 保留最近 5000 条）+ 本地档案首次导入 shell history 冷启动。
 */
import { invoke } from '@tauri-apps/api/core'
import type { HistoryIndexItem } from '@/lib/suggestions/suggestionEngine'
import { parseShellHistory } from '@/lib/suggestions/shellHistory'

const INDEX_LIMIT = 5000

/** 内存索引；null = 尚未加载 */
let index: HistoryIndexItem[] | null = null
let loading: Promise<void> | null = null

/**
 * @description 确保内存索引已加载（懒加载一次；清空后由 reload 重置）
 * @returns Promise<void>
 */
export async function ensureHistoryLoaded (): Promise<void> {
    if (index !== null) {
        return
    }
    loading ??= reload()
    await loading
}

/**
 * @description 从 Rust 侧重载最近 5000 条到内存索引（失败降级为空索引仅告警）
 * @returns Promise<void>
 */
async function reload (): Promise<void> {
    try {
        const entries = await invoke<Array<{ source: string, command: string, runAt: number, hitCount: number }>>('history_list', { limit: INDEX_LIMIT })
        index = entries.slice(0, INDEX_LIMIT)
    } catch (error) {
        console.warn('failed to load history index', error)
        index = []
    }
}

/**
 * @description 取内存索引快照（未加载时返回空数组；调用方应先 ensureHistoryLoaded）
 * @returns HistoryIndexItem[]
 */
export function getHistorySnapshot (): HistoryIndexItem[] {
    return index ?? []
}

/**
 * @description 记录一次命令执行：更新内存索引 + fire-and-forget 写库（失败仅告警）
 * @param source 来源分桶键
 * @param command 命令文本
 * @returns void
 */
export function recordHistory (source: string, command: string): void {
    if (index === null) {
        index = []
    }
    const existing = index.find(item => item.source === source && item.command === command)
    if (existing) {
        existing.runAt = Date.now()
        existing.hitCount++
    } else {
        index.unshift({ source, command, runAt: Date.now(), hitCount: 1 })
        if (index.length > INDEX_LIMIT) {
            index.length = INDEX_LIMIT
        }
    }
    void invoke('history_record', { source, command }).catch(error => console.warn('history_record failed', error))
}

/**
 * @description 清空历史（source 省略清全部）并重载内存索引
 * @param source 可选来源键
 * @returns Promise<void>
 */
export async function clearHistory (source?: string): Promise<void> {
    await invoke('history_clear', { source: source ?? null })
    await reload()
}

/**
 * @description 本地档案首次使用建议功能时导入 shell history 冷启动种子（幂等：Rust 侧
 *              meta 标记跳过重复导入）；SSH 档案与非 zsh/bash shell 静默跳过
 * @param profile 终端档案（type/id/command）
 * @returns Promise<void>
 */
export async function importShellHistoryForProfile (profile: { type: string, id: string, command?: string }): Promise<void> {
    if (profile.type !== 'local' || !profile.command) {
        return
    }
    const shell = profile.command.split('/').pop()?.toLowerCase() ?? ''
    let file: string | null = null
    let style: 'zsh' | 'bash' | null = null
    if (shell.includes('zsh')) {
        file = '~/.zsh_history'
        style = 'zsh'
    } else if (shell.includes('bash')) {
        file = '~/.bash_history'
        style = 'bash'
    }
    if (!file || !style) {
        return
    }
    try {
        const content = await invoke<string | null>('fs_read_text_file', { path: file })
        if (!content) {
            return
        }
        const entries = parseShellHistory(content, style)
            .map(({ command, runAt }) => ({ command, runAt: runAt * 1000 }))
            .filter(entry => entry.command.trim().length > 0)
        if (entries.length > 0) {
            await invoke('history_import', { source: `local:${profile.id}`, entries })
            await reload()
        }
    } catch (error) {
        console.warn('history import failed', error)
    }
}
