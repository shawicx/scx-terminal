/**
 * @description 快捷命令模板工具：Warp Workflow 式 {{参数}} 占位符解析与渲染（纯函数，无副作用）
 */

/** 占位符语法：{{参数名}}，参数名限字母/数字/下划线/连字符（前后容忍空白） */
const PARAM_PATTERN = /\{\{\s*([\w-]+)\s*\}\}/g

/**
 * @description 从命令模板中提取参数名列表（按出现顺序去重）
 * @param command 含 {{参数}} 占位符的命令模板
 * @returns string[] 参数名列表（去重、保序）
 *
 * @example parseQuickCommandParams('git checkout {{分支}} && git pull {{分支}}') // ['分支']
 *
 */
export function parseQuickCommandParams (command: string): string[] {
    const names: string[] = []
    for (const match of command.matchAll(PARAM_PATTERN)) {
        const name = match[1]
        if (!names.includes(name)) {
            names.push(name)
        }
    }
    return names
}

/**
 * @description 用填写值渲染命令模板：替换全部 {{参数}} 占位符，未填/空缺参数替换为空串。
 *              用函数式 replace 规避替换值中 $&/$1 等特殊序列被展开
 * @param command 命令模板
 * @param values 参数名 -> 填写值（缺省视为空串）
 * @returns string 渲染后的最终命令文本（多行原样保留）
 *
 * @example renderQuickCommand('ssh {{user}}@{{host}}', { user: 'root' }) // 'ssh root@'
 *
 */
export function renderQuickCommand (command: string, values: Record<string, string>): string {
    return command.replace(PARAM_PATTERN, (_match, name: string) => values[name] ?? '')
}

/**
 * @description 命令模板的单行预览（选择器/列表展示用）：折叠换行为空格并截断
 * @param command 命令模板
 * @param maxLength 最大长度（默认 60）
 * @returns string 单行截断文本
 *
 * @example previewQuickCommand('git add -A\ngit commit', 10) // 'git add -…'
 *
 */
export function previewQuickCommand (command: string, maxLength = 60): string {
    const flat = command.replace(/\s+/g, ' ').trim()
    return flat.length > maxLength ? flat.slice(0, maxLength - 1) + '…' : flat
}

/** 分段结果：未分组段 title 为 null；空分组保留（是否隐藏由渲染层决定） */
export interface QuickCommandSection<T> {
    title: string | null
    groupId: string | null
    items: T[]
}

/**
 * @description 把快捷命令按分组整理为分段列表：未分组置顶（无标题），其余按组名排序；空分组保留
 * @param quickCommands 快捷命令列表
 * @param groups 分组列表
 * @returns QuickCommandSection<T>[] 分段列表
 *
 * @example groupQuickCommandSections([{ name: 'a' }], [{ id: 'g1', name: 'Git' }])[0].title // null
 *
 */
export function groupQuickCommandSections<T extends { groupId?: string }> (
    quickCommands: T[],
    groups: { id: string, name: string }[],
): QuickCommandSection<T>[] {
    const byGroup = new Map<string | null, T[]>()
    for (const quickCommand of quickCommands) {
        const key = quickCommand.groupId ?? null
        if (!byGroup.has(key)) {
            byGroup.set(key, [])
        }
        byGroup.get(key)!.push(quickCommand)
    }
    const sections: QuickCommandSection<T>[] = []
    const ungrouped = byGroup.get(null) ?? []
    if (ungrouped.length) {
        sections.push({ title: null, groupId: null, items: ungrouped })
    }
    for (const group of [...groups].sort((a, b) => a.name.localeCompare(b.name))) {
        sections.push({ title: group.name, groupId: group.id, items: byGroup.get(group.id) ?? [] })
    }
    return sections
}
