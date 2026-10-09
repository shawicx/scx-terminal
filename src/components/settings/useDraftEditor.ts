/**
 * @description 设置域共享的「草稿编辑器」：档案/SSH/快捷命令等编辑表单不再实时
 *              写入 config store，而是编辑条目的草稿副本，经「保存」按钮统一提交；
 *              存在未保存修改时切换条目/新建经确认弹窗放行（复用共享 confirmAction）。
 */
import { computed, ref, type Ref } from 'vue'
import { confirmAction } from './useConfirmAction'

interface DraftEditorOptions<T> {
    /** 构造一条全新草稿（尚未进入 store） */
    create: () => T
    /** 提交草稿：isNew 时插入 store，否则按 id 原位覆盖目标条目 */
    persist: (draft: T, isNew: boolean) => void
}

/**
 * @description 稳定序列化（对象键排序），用于草稿与基线的脏比较，
 *              避免键删除/回添导致的顺序性假阳性
 * @param value 待序列化的任意值
 * @returns string 排键后的 JSON 字符串
 *
 * @example stableStringify({ b: 1, a: 2 }) // '{"a":2,"b":1}'
 *
 */
function stableStringify (value: unknown): string {
    return JSON.stringify(value, (_key, val) => {
        if (val && typeof val === 'object' && !Array.isArray(val)) {
            return Object.keys(val).sort().reduce<Record<string, unknown>>((acc, key) => {
                acc[key] = (val as Record<string, unknown>)[key]
                return acc
            }, {})
        }
        return val
    })
}

/**
 * @description 创建一个草稿编辑器实例：edit 打开既有条目副本、createNew 打开全新草稿、
 *              save 提交到 store、discard 还原/关闭、guard 在脏状态下用确认弹窗放行动作
 * @param options 编辑器选项（create 构造新草稿 / persist 提交回调）
 * @returns 编辑器状态与方法（draft / isNew / dirty 为响应式）
 *
 * @example const editor = useDraftEditor({ create, persist })
 *
 */
export function useDraftEditor<T> (options: DraftEditorOptions<T>) {
    const draft = ref<T | null>(null) as Ref<T | null>
    const isNew = ref(false)
    const baseline = ref('')
    const dirty = computed(() => draft.value !== null && stableStringify(draft.value) !== baseline.value)

    /**
     * @description 打开一条既有条目的草稿副本（深拷贝，改动不影响 store）
     * @param item 既有条目
     * @returns void
     *
     * @example editor.edit(store.profiles[0]!)
     *
     */
    function edit (item: T): void {
        draft.value = JSON.parse(JSON.stringify(item)) as T
        isNew.value = false
        baseline.value = stableStringify(item)
    }

    /**
     * @description 关闭草稿编辑器（清空草稿与基线）
     * @returns void
     *
     * @example editor.clear()
     *
     */
    function clear (): void {
        draft.value = null
        isNew.value = false
        baseline.value = ''
    }

    /**
     * @description 打开一条全新草稿（不进入 store，保存时才提交）
     * @returns void
     *
     * @example editor.createNew()
     *
     */
    function createNew (): void {
        const item = options.create()
        draft.value = item
        isNew.value = true
        baseline.value = stableStringify(item)
    }

    /**
     * @description 保存草稿：经 persist 提交到 store 后同步基线（无修改时不动作）
     * @returns void
     *
     * @example editor.save()
     *
     */
    function save (): void {
        if (!draft.value || !dirty.value) {
            return
        }
        options.persist(draft.value, isNew.value)
        baseline.value = stableStringify(draft.value)
        isNew.value = false
    }

    /**
     * @description 放弃修改：全新草稿直接关闭，既有条目还原为基线副本
     * @returns void
     *
     * @example editor.discard()
     *
     */
    function discard (): void {
        if (!draft.value) {
            return
        }
        if (isNew.value) {
            clear()
            return
        }
        draft.value = JSON.parse(baseline.value) as T
    }

    /**
     * @description 脏状态守卫：无修改直接执行动作；有修改经确认弹窗（放弃修改）后执行
     * @param message 确认弹窗正文文案
     * @param action 实际要执行的动作
     * @param confirmLabel 确认按钮文案（缺省用共享弹窗默认「删除」）
     * @param title 确认弹窗标题（缺省用共享弹窗默认「删除确认」）
     * @returns void
     *
     * @example editor.guard(t('settings.unsavedChangesBody'), () => switchTo(id))
     *
     */
    function guard (message: string, action: () => void, confirmLabel?: string, title?: string): void {
        if (!dirty.value) {
            action()
            return
        }
        confirmAction(message, action, confirmLabel, title)
    }

    return { draft, isNew, dirty, edit, clear, createNew, save, discard, guard }
}
