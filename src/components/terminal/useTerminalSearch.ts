/**
 * @description 终端窗格内搜索条状态与键盘路由（原 TerminalPane 搜索段）：打开/关闭、
 *              增量查找、焦点兜底（reka-ui 菜单卸载后会延时恢复触发器焦点）。
 */
import { computed, nextTick, ref } from 'vue'
import type { XTermWebGLFrontend } from '@/lib/frontends/xtermFrontend'
import { scheduleSearchFocus } from '@/components/terminal/searchFocus'

/**
 * @description 搜索条状态与处理器集合
 * @param getFrontend 前端实例访问器（销毁期为 null）
 * @returns 状态 refs 与模板事件处理器
 *
 * @example const search = useTerminalSearch(() => frontend)
 *
 */
export function useTerminalSearch (getFrontend: () => XTermWebGLFrontend | null) {
    const searchOpen = ref(false)
    const searchQuery = ref('')
    const searchResultCount = ref(0)
    const searchInputEl = ref<HTMLInputElement>()

    const searchNoResults = computed(() => searchOpen.value && !!searchQuery.value && searchResultCount.value === 0)

    function openSearch (): void {
        searchOpen.value = true
        // 右键菜单路径中，reka-ui 会在卸载菜单后的 setTimeout 里恢复触发器焦点；
        // 等待两轮宏任务再聚焦，确保搜索输入不会被终端抢回焦点。
        void nextTick(() => scheduleSearchFocus(searchInputEl.value))
    }

    function closeSearch (): void {
        searchOpen.value = false
        getFrontend()?.cancelSearch()
    }

    function runSearch (forward: boolean): void {
        const frontend = getFrontend()
        if (!frontend || !searchQuery.value) {
            searchResultCount.value = 0
            return
        }
        const state = forward
            ? frontend.findNext(searchQuery.value, { incremental: true })
            : frontend.findPrevious(searchQuery.value)
        searchResultCount.value = state.resultCount
    }

    function onSearchKeydown (event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            event.preventDefault()
            closeSearch()
        } else if (event.key === 'Enter') {
            event.preventDefault()
            runSearch(!event.shiftKey)
        }
    }

    /**
     * @description 搜索条打开但焦点意外落回终端时的兜底处理：阻止按键进入 shell，
     *              并把后续输入上下文交还给搜索框
     * @param event 窗格内捕获到的键盘事件
     * @returns void
     *
     */
    function onSearchKeydownCapture (event: KeyboardEvent): void {
        if (!searchOpen.value || event.target === searchInputEl.value) {
            return
        }

        event.preventDefault()
        event.stopPropagation()
        if (event.key === 'Escape') {
            closeSearch()
            return
        }
        if (event.key === 'Enter') {
            runSearch(!event.shiftKey)
            return
        }
        searchInputEl.value?.focus({ preventScroll: true })
    }

    /** 窗格失活时由组件调用：关条并清除高亮 */
    function deactivate (): void {
        if (searchOpen.value) {
            searchOpen.value = false
            getFrontend()?.cancelSearch()
        }
    }

    /** 模板函数 ref：挂载/卸载搜索输入框（v-if 场景下 el 为 null） */
    function setSearchInput (el: unknown): void {
        searchInputEl.value = (el as HTMLInputElement | null) ?? undefined
    }

    return {
        searchOpen, searchQuery, searchResultCount, searchInputEl, setSearchInput, searchNoResults,
        openSearch, closeSearch, runSearch, onSearchKeydown, onSearchKeydownCapture, deactivate,
    }
}
