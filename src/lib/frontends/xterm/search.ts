/**
 * @description xterm 搜索控制器：SearchAddon 装载、高亮装饰配色与结果计数包装
 *              （原 XTermFrontend 的 search/searchState/getSearchOptions/wrapSearchResult）。
 */
import type { Terminal } from '@xterm/xterm'
import { SearchAddon, type ISearchOptions } from '@xterm/addon-search'
import type { SearchOptions, SearchState } from '../frontend'

export class XtermSearchController {
    private addon = new SearchAddon()
    private state: SearchState = { resultCount: 0 }

    /** 挂载搜索附加器并订阅结果计数（attach 阶段调用一次） */
    attach (xterm: Terminal): void {
        xterm.loadAddon(this.addon)
        this.addon.onDidChangeResults(state => {
            this.state = state
        })
    }

    private getSearchOptions (searchOptions?: SearchOptions): ISearchOptions {
        return {
            ...searchOptions,
            decorations: {
                matchOverviewRuler: '#888888',
                activeMatchColorOverviewRuler: '#ffff00',
                matchBackground: '#888888',
                activeMatchBackground: '#ffff00',
            },
        }
    }

    private wrapSearchResult (result: boolean): SearchState {
        if (!result) {
            return { resultCount: 0 }
        }
        return this.state
    }

    /** 向下查找（onBeforeSearch 供 copyOnSelect 前端抑制一次选中复制） */
    findNext (term: string, searchOptions?: SearchOptions, onBeforeSearch?: () => void): SearchState {
        onBeforeSearch?.()
        return this.wrapSearchResult(this.addon.findNext(term, this.getSearchOptions(searchOptions)))
    }

    /** 向上查找 */
    findPrevious (term: string, searchOptions?: SearchOptions, onBeforeSearch?: () => void): SearchState {
        onBeforeSearch?.()
        return this.wrapSearchResult(this.addon.findPrevious(term, this.getSearchOptions(searchOptions)))
    }

    /** 清除高亮装饰 */
    clearDecorations (): void {
        this.addon.clearDecorations()
    }
}
