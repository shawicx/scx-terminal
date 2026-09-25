/**
 * @description SFTP 面板导航状态机：路径/前进后退历史/加载（序号防串）/面包屑分段
 *              （原 SftpBrowserPane.vue 的导航段；成功加载后回调清理选择态）。
 */
import { computed, ref } from 'vue'
import { breadcrumbSegments, type PaneEntry } from '@/lib/sftpPane'

/** usePaneNavigation 的依赖集 */
export interface PaneNavigationDeps {
    /** 目录列举适配器 */
    lister: (path: string) => Promise<PaneEntry[]>
    /** 主目录（面包屑兜底用） */
    homePath: () => string
    /** 路径变化通知（父组件联动对侧栏等） */
    onPathChange: (path: string) => void
    /** 目录成功切换后的回调（面板用来清空选择/锚点） */
    onDirectoryChanged: () => void
}

/**
 * @description 面板导航状态与操作集合
 * @param deps 依赖（lister/主目录/通知回调）
 * @returns path/entries/loading/error/历史游标与导航操作
 *
 * @example const nav = usePaneNavigation({ lister, homePath: () => props.homePath, ... })
 *
 */
export function usePaneNavigation (deps: PaneNavigationDeps) {
    const path = ref('')
    const entries = ref<PaneEntry[]>([])
    const loading = ref(false)
    const error = ref('')
    const history = ref<string[]>([])
    const historyIndex = ref(-1)
    let loadSeq = 0

    /** 面包屑分段（根 + 每级目录） */
    const crumbs = computed(() => breadcrumbSegments(path.value || deps.homePath() || '/'))

    /**
     * @description 加载目录：序号防串（快速导航时旧响应不得覆盖新目录）
     * @param dir 目录绝对路径
     * @param push 是否压入导航历史（后退/前进不压）
     * @returns Promise<void>
     *
     */
    async function loadDir (dir: string, push = true): Promise<void> {
        const seq = ++loadSeq
        loading.value = true
        error.value = ''
        try {
            const list = await deps.lister(dir)
            if (seq !== loadSeq) {
                return
            }
            entries.value = list
            path.value = dir
            deps.onDirectoryChanged()
            if (push) {
                history.value = [...history.value.slice(0, historyIndex.value + 1), dir]
                historyIndex.value = history.value.length - 1
            }
            deps.onPathChange(dir)
        } catch (e) {
            if (seq !== loadSeq) {
                return
            }
            error.value = String(e instanceof Error ? e.message : e)
        } finally {
            if (seq === loadSeq) {
                loading.value = false
            }
        }
    }

    function navigate (dir: string): void {
        if (dir !== path.value || error.value) {
            void loadDir(dir)
        } else {
            void loadDir(dir, false)
        }
    }

    function goHome (): void {
        const home = deps.homePath()
        if (home) {
            navigate(home)
        }
    }

    function goBack (): void {
        if (historyIndex.value > 0) {
            historyIndex.value -= 1
            void loadDir(history.value[historyIndex.value]!, false)
        }
    }

    function goForward (): void {
        if (historyIndex.value < history.value.length - 1) {
            historyIndex.value += 1
            void loadDir(history.value[historyIndex.value]!, false)
        }
    }

    function refresh (): void {
        void loadDir(path.value, false)
    }

    const canGoBack = computed(() => historyIndex.value > 0)
    const canGoForward = computed(() => historyIndex.value < history.value.length - 1)

    return { path, entries, loading, error, crumbs, canGoBack, canGoForward, loadDir, navigate, goHome, goBack, goForward, refresh }
}
