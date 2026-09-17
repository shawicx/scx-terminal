/**
 * @description 终端建议功能的共享类型：建议项、建议计算上下文
 */

export type SuggestionKind = 'history' | 'quickCommand' | 'path'

export interface Suggestion {
    kind: SuggestionKind
    /** 历史/快捷命令 = 整行命令文本；路径 = 替换后的完整输入行 */
    label: string
    /** 来源徽标：全局历史时为来源键，快捷命令为分组名，其余 null */
    detail: string | null
    /** kind=quickCommand 时对应的快捷命令 id */
    quickCommandId: string | null
    /** 快捷命令含 {{参数}} 占位符时 true（接受时进填参表单） */
    hasParams: boolean
}

export interface SuggestionContext {
    typedLine: string
    cursorOffset: number
    source: string
    cwd: string | null
}
