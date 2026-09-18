/**
 * @description 建议引擎单测：历史前缀匹配与分桶排序 / 快捷命令模糊匹配 / 路径来源 / 合并去重上限
 */
import { describe, expect, it } from 'vitest'
import { computeSuggestions, type HistoryIndexItem, type QuickCommandSource } from './suggestionEngine'

const baseCtx = { typedLine: 'git che', cursorOffset: 7, source: 'local:p1', cwd: '/Users/x' }

const history: HistoryIndexItem[] = [
    { source: 'local:p1', command: 'git checkout dev', runAt: 300, hitCount: 1 },
    { source: 'local:p1', command: 'git checkout -b feat', runAt: 200, hitCount: 1 },
    { source: 'ssh:h', command: 'git cherry-pick', runAt: 500, hitCount: 1 },
]

describe('computeSuggestions — history', () => {
    it('prefix-matches case-insensitively, same-source first then recency', async () => {
        const result = await computeSuggestions(baseCtx, { history })
        expect(result.map(s => s.label)).toEqual([
            'git checkout dev',
            'git checkout -b feat',
            'git cherry-pick', // 全局兜底，detail 为 null（不暴露内部来源键）
        ])
        expect(result[2].detail).toBeNull()
        expect(result[0].detail).toBeNull()
    })

    it('ranks recency above hit count within the same source (spec §4: sameSource > runAt > hitCount)', async () => {
        const items: HistoryIndexItem[] = [
            { source: 'local:p1', command: 'git deploy old-frequent', runAt: 100, hitCount: 50 },
            { source: 'local:p1', command: 'git deploy new-rare', runAt: 1000, hitCount: 1 },
        ]
        const result = await computeSuggestions({ ...baseCtx, typedLine: 'git dep', cursorOffset: 7 }, { history: items })
        expect(result.map(s => s.label)).toEqual(['git deploy new-rare', 'git deploy old-frequent'])
    })

    it('caps same-source at 8 and global at 4, dedupes identical text', async () => {
        const many: HistoryIndexItem[] = []
        for (let i = 0; i < 12; i++) {
            many.push({ source: 'local:p1', command: `git cmd-${i}`, runAt: i, hitCount: 1 })
        }
        for (let i = 0; i < 6; i++) {
            many.push({ source: 'other', command: `git ext-${i}`, runAt: i, hitCount: 1 })
        }
        many.push({ source: 'other', command: 'git cmd-0', runAt: 999, hitCount: 9 }) // 与同源重复文本
        // 整行前缀口径下两族命令前缀不同：分别以各自前缀查询，各自命中分桶上限
        const cmdResult = await computeSuggestions({ ...baseCtx, typedLine: 'git cmd', cursorOffset: 7 }, { history: many })
        const extResult = await computeSuggestions({ ...baseCtx, typedLine: 'git ext', cursorOffset: 7 }, { history: many })
        // detail 不再区分来源分桶，改用数量断言：8 条同源上限 + 1 条全局兜底（'git cmd-0'）
        expect(cmdResult.length).toBe(9)
        expect(extResult.length).toBe(4)
        expect(cmdResult.filter(s => s.label === 'git cmd-0').length).toBe(1)
    })

    it('does not match history beyond the typed prefix (full-line prefix, not last-word)', async () => {
        // 'git che' 不能因为放宽到最后一个空格而带出所有 'git *' 历史
        const items: HistoryIndexItem[] = [
            { source: 'local:p1', command: 'git checkout dev', runAt: 1, hitCount: 1 },
            { source: 'local:p1', command: 'git cmd-0', runAt: 999, hitCount: 99 },
        ]
        const result = await computeSuggestions(baseCtx, { history: items })
        expect(result.map(s => s.label)).toEqual(['git checkout dev'])
    })
})

describe('computeSuggestions — quick commands', () => {
    const quickCommands: QuickCommandSource[] = [
        { id: 'qc1', name: '切分支', command: 'git checkout {{分支}}', groupName: 'Git' },
        { id: 'qc2', name: '', command: 'git cherry-pick', groupName: null },
    ]

    it('matches by template text, marks params and group detail', async () => {
        const result = await computeSuggestions(baseCtx, { quickCommands })
        const qc = result.find(s => s.kind === 'quickCommand')!
        expect(qc.quickCommandId).toBe('qc1')
        expect(qc.hasParams).toBe(true)
        expect(qc.detail).toBe('Git')
    })

    it('drops quick commands whose text duplicates a history suggestion', async () => {
        const result = await computeSuggestions(baseCtx, { history, quickCommands })
        expect(result.filter(s => s.label === 'git cherry-pick').length).toBe(1)
    })
})

describe('computeSuggestions — paths', () => {
    it('lists dir entries for the current word, dirs get a trailing slash, quoted when needed', async () => {
        const listDir = async (dir: string) => {
            expect(dir).toBe('/Users/x/Doc')
            return [
                { name: 'notes.txt', isDir: false },
                { name: 'My Project', isDir: true },
            ]
        }
        const result = await computeSuggestions(
            { ...baseCtx, typedLine: 'cat Doc/', cursorOffset: 7 },
            { listDir },
        )
        // 词 = 'Doc/'，cwd 拼接 → 列 /Users/x/Doc；引擎保持 listDir 传入序；
        // 目录段不加引号（保 ~ 词首展开），仅 basename 段按需引用
        expect(result.map(s => s.label)).toEqual([
            'cat Doc/notes.txt',
            "cat Doc/'My Project/'",
        ])
    })

    it('skips paths for plain words without slash or tilde', async () => {
        const listDir = async () => { throw new Error('should not be called') }
        const result = await computeSuggestions(baseCtx, { listDir })
        expect(result).toEqual([])
    })

    it('hides dotfiles unless the completion prefix starts with a dot', async () => {
        const listDir = async () => [
            { name: '.config', isDir: true },
            { name: '.zshrc', isDir: false },
            { name: 'Documents', isDir: true },
        ]
        // 前缀空（cat ~/）：点文件不可见
        const plain = await computeSuggestions(
            { ...baseCtx, typedLine: 'cat ~/', cursorOffset: 6, cwd: null },
            { listDir },
        )
        expect(plain.map(s => s.label)).toEqual(['cat ~/Documents/'])
        // 前缀 '.'（cat ~/.）：点文件可见、常规文件按前缀过滤
        const dotted = await computeSuggestions(
            { ...baseCtx, typedLine: 'cat ~/.', cursorOffset: 7, cwd: null },
            { listDir },
        )
        expect(dotted.map(s => s.label)).toEqual(['cat ~/.config/', 'cat ~/.zshrc'])
    })

    it('skips relative words when cwd is unknown', async () => {
        const listDir = async () => { throw new Error('should not be called') }
        const result = await computeSuggestions({ ...baseCtx, typedLine: 'cat Doc/', cursorOffset: 7, cwd: null }, { listDir })
        expect(result).toEqual([])
    })
})

describe('computeSuggestions — merge order & total cap', () => {
    it('orders quickCommands > history > paths and caps total at 16', async () => {
        const historyMany: HistoryIndexItem[] = Array.from({ length: 20 }, (_, i) => ({
            source: 'local:p1', command: `git x${i}`, runAt: i, hitCount: 1,
        }))
        const result = await computeSuggestions(
            { ...baseCtx, typedLine: 'git x', cursorOffset: 5 },
            {
                history: historyMany,
                quickCommands: [{ id: 'q', name: '', command: 'git x-param', groupName: null }],
                listDir: async () => Array.from({ length: 10 }, (_, i) => ({ name: `f${i}`, isDir: false })),
            },
        )
        expect(result.length).toBeLessThanOrEqual(16)
        expect(result[0].kind).toBe('quickCommand')
    })
})
