/**
 * @description sftpPane 纯逻辑单测：排序（目录优先/空值排尾）、路径拼接、父目录、面包屑分段。
 */
import { describe, expect, it } from 'vitest'
import { breadcrumbSegments, joinPanePath, parentPanePath, sortPaneEntries, type PaneEntry } from './sftpPane'

function entry (overrides: Partial<PaneEntry>): PaneEntry {
    return {
        name: 'a',
        path: '/a',
        isDir: false,
        isSymlink: false,
        size: 1,
        mtimeMs: 100,
        ...overrides,
    }
}

describe('sortPaneEntries', () => {
    const entries = [
        entry({ name: 'z-dir', path: '/z', isDir: true }),
        entry({ name: 'b.txt', path: '/b', size: 200, mtimeMs: 200 }),
        entry({ name: 'A.txt', path: '/A', size: 100, mtimeMs: 300 }),
        entry({ name: 'null-size', path: '/n', size: null, mtimeMs: null }),
    ]

    it('目录恒在文件前，name 不区分大小写', () => {
        const sorted = sortPaneEntries(entries, 'name', 'asc')
        expect(sorted[0]!.name).toBe('z-dir')
        expect(sorted[1]!.name).toBe('A.txt')
        expect(sorted[2]!.name).toBe('b.txt')
    })

    it('按 size/mtime 排序时空值排尾', () => {
        const bySize = sortPaneEntries(entries, 'size', 'desc')
        // 目录（z-dir）恒在最前；空值条目在文件组内排尾
        expect(bySize[0]!.name).toBe('z-dir')
        expect(bySize[bySize.length - 1]!.name).toBe('null-size')
        expect(bySize[1]!.name).toBe('b.txt')
        const byMtime = sortPaneEntries(entries, 'mtime', 'asc')
        expect(byMtime[byMtime.length - 1]!.name).toBe('null-size')
        expect(byMtime[1]!.name).toBe('b.txt')
    })

    it('desc 反转组内顺序但目录仍在最前', () => {
        const sorted = sortPaneEntries(entries, 'name', 'desc')
        expect(sorted[0]!.isDir).toBe(true)
        expect(sorted[1]!.name).toBe('null-size')
        expect(sorted[2]!.name).toBe('b.txt')
        expect(sorted[3]!.name).toBe('A.txt')
    })
})

describe('path helpers', () => {
    it('joinPanePath 根目录不双斜杠', () => {
        expect(joinPanePath('/home', 'a.txt')).toBe('/home/a.txt')
        expect(joinPanePath('/', 'a.txt')).toBe('/a.txt')
        expect(joinPanePath('/home/', 'a.txt')).toBe('/home/a.txt')
    })

    it('parentPanePath 根的父仍是根', () => {
        expect(parentPanePath('/home/scx')).toBe('/home')
        expect(parentPanePath('/home')).toBe('/')
        expect(parentPanePath('/')).toBe('/')
        expect(parentPanePath('/home/scx/')).toBe('/home')
    })

    it('breadcrumbSegments 逐级累进', () => {
        expect(breadcrumbSegments('/')).toEqual([{ label: '/', path: '/' }])
        expect(breadcrumbSegments('/home/scx')).toEqual([
            { label: '/', path: '/' },
            { label: 'home', path: '/home' },
            { label: 'scx', path: '/home/scx' },
        ])
    })
})
