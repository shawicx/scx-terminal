/**
 * @description 建议引擎：输入行上下文 + 各来源数据 → 合并排序后的建议列表。
 *              纯逻辑（IPC 由调用方以回调注入），排序口径：快捷命令 > 历史（同源 >
 *              全局兜底，run_at 优先于 hit_count）> 路径（字典序）；同文本去重、总上限 16。
 */
import { fuzzyMatch } from '@/lib/utils/fuzzy'
import { currentWordAt } from './promptTracker'
import { quotePathIfNeeded, splitPathWord } from './pathWord'
import type { Suggestion, SuggestionContext } from './types'

const MAX_HISTORY_SAME_SOURCE = 8
const MAX_HISTORY_GLOBAL = 4
const MAX_QUICK_COMMANDS = 4
const MAX_PATHS = 8
const MAX_TOTAL = 16

export interface HistoryIndexItem {
    source: string
    command: string
    runAt: number
    hitCount: number
}

export interface QuickCommandSource {
    id: string
    name: string
    command: string
    groupName: string | null
}

export interface DirEntry {
    name: string
    isDir: boolean
}

export interface SuggestionSources {
    history?: HistoryIndexItem[]
    quickCommands?: QuickCommandSource[]
    listDir?: (dir: string) => Promise<DirEntry[]>
}

/**
 * @description 计算一次建议列表（三来源并行、任一失败不阻塞其他）
 * @param context 输入行上下文（typedLine/cursorOffset/source/cwd）
 * @param sources 可用来源（缺省的来源跳过；listDir 抛错时路径来源静默为空）
 * @returns Promise<Suggestion[]> 合并去重排序后的建议（可能为空）
 *
 * @example await computeSuggestions({ typedLine: 'git che', cursorOffset: 7, source: 'local:p1', cwd: null }, { history })
 *
 */
export async function computeSuggestions (context: SuggestionContext, sources: SuggestionSources): Promise<Suggestion[]> {
    const typed = context.typedLine.slice(0, context.cursorOffset)
    if (!typed.trim()) {
        return []
    }
    const [history, quickCommands, paths] = await Promise.all([
        sources.history ? historySuggestions(typed, context, sources.history) : [],
        sources.quickCommands ? quickCommandSuggestions(typed, sources.quickCommands) : [],
        sources.listDir ? pathSuggestions(context, sources.listDir) : [],
    ])
    const seen = new Set<string>()
    const merged: Suggestion[] = []
    for (const suggestion of [...quickCommands, ...history, ...paths]) {
        if (seen.has(suggestion.label)) {
            continue
        }
        seen.add(suggestion.label)
        merged.push(suggestion)
        if (merged.length >= MAX_TOTAL) {
            break
        }
    }
    return merged
}

/** 历史匹配：整行前缀（大小写不敏感）；同源前 8 + 全局 4；排序 = 同源 > runAt 新 > hitCount 高 */
function historySuggestions (typed: string, context: SuggestionContext, items: HistoryIndexItem[]): Suggestion[] {
    const typedLower = typed.toLowerCase()
    // 前缀口径：以光标左侧已敲入的完整前缀匹配（spec §4），不放宽到最后一个空格
    const ranked = items
        .filter(item => item.command.toLowerCase().startsWith(typedLower))
        .sort((a, b) => compareHistory(a, b, context.source))
    const picked: Suggestion[] = []
    const seen = new Set<string>()
    let sameSource = 0
    let globalCount = 0
    for (const item of ranked) {
        if (seen.has(item.command)) {
            continue
        }
        if (item.source === context.source) {
            if (sameSource >= MAX_HISTORY_SAME_SOURCE) {
                continue
            }
            sameSource++
        } else {
            if (globalCount >= MAX_HISTORY_GLOBAL) {
                continue
            }
            globalCount++
        }
        seen.add(item.command)
        picked.push({
            kind: 'history',
            label: item.command,
            // 全局兜底也不暴露内部来源键（如 local:local-/bin/bash-xxx），detail 统一为 null
            detail: null,
            quickCommandId: null,
            hasParams: false,
        })
    }
    return picked
}

/** 排序比较器（spec §4）：同来源优先 → 最近使用（runAt）优先 → 使用频次（hitCount）优先 */
function compareHistory (a: HistoryIndexItem, b: HistoryIndexItem, source: string): number {
    const aSame = a.source === source ? 1 : 0
    const bSame = b.source === source ? 1 : 0
    if (aSame !== bSame) {
        return bSame - aSame
    }
    if (a.runAt !== b.runAt) {
        return b.runAt - a.runAt
    }
    return b.hitCount - a.hitCount
}

/** 快捷命令：对模板文本（占位符剥除、次选名称）做模糊匹配，最多 4 条 */
function quickCommandSuggestions (typed: string, quickCommands: QuickCommandSource[]): Suggestion[] {
    return quickCommands
        .map(quickCommand => ({
            quickCommand,
            score: fuzzyMatch(typed, quickCommand.command.replace(/\{\{[^}]*\}\}/g, ''))
                ?? fuzzyMatch(typed, quickCommand.name),
        }))
        .filter(entry => entry.score !== null)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, MAX_QUICK_COMMANDS)
        .map(({ quickCommand }) => ({
            kind: 'quickCommand' as const,
            label: quickCommand.command,
            detail: quickCommand.groupName,
            quickCommandId: quickCommand.id,
            hasParams: /\{\{[^}]*\}\}/.test(quickCommand.command),
        }))
}

/** 路径：仅当当前词含 / 或以 ~ 开头；相对词需要 cwd；label 为整行替换文本 */
async function pathSuggestions (context: SuggestionContext, listDir: (dir: string) => Promise<DirEntry[]>): Promise<Suggestion[]> {
    const cursorWord = currentWordAt(context.typedLine, context.cursorOffset)
    if (!cursorWord) {
        return []
    }
    // 光标右侧紧邻的非空白字符并入当前词（如 'cat Doc/' 光标在 / 前时词为 'Doc/'）
    const trailingMatch = /^\S*/.exec(context.typedLine.slice(cursorWord.end))
    const trailing = trailingMatch ? trailingMatch[0] : ''
    const wordText = cursorWord.text + trailing
    const wordEnd = cursorWord.end + trailing.length
    if (!wordText.includes('/') && !wordText.startsWith('~')) {
        return []
    }
    const split = splitPathWord(wordText)
    if (!split) {
        return []
    }
    const absolute = split.dir.startsWith('/') || split.dir.startsWith('~')
        ? split.dir
        : context.cwd ? `${context.cwd.replace(/\/+$/, '')}/${split.dir.replace(/\/+$/, '')}` : null
    if (!absolute) {
        return []
    }
    let entries: DirEntry[]
    try {
        entries = await listDir(absolute)
    } catch {
        return []
    }
    return entries
        .filter(entry => entry.name.startsWith(split.prefix))
        .slice(0, MAX_PATHS)
        .map(entry => {
            // 目录段保持未引用（POSIX 只在词首展开 ~，整词加引号会令 ~ 失效），仅引用 basename
            const newWord = split.dir + quotePathIfNeeded(entry.name + (entry.isDir ? '/' : ''))
            return {
                kind: 'path' as const,
                label: context.typedLine.slice(0, cursorWord.start) + newWord + context.typedLine.slice(wordEnd),
                detail: null,
                quickCommandId: null,
                hasParams: false,
            }
        })
}
