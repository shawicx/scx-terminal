/**
 * @description 配置快照结构校验（纯逻辑）：设置页「配置文件」编辑保存前，校验
 *              JSON 文本解析出的对象是否为结构完整的 ConfigStore（必需分区为
 *              对象、实体集合为数组且各项带身份键）。只做结构级校验——字段值的
 *              业务合法性由各消费方与默认值兜底，不在此重复实现。
 */
import { isPlainObject } from './defaults'

/** 结构错误（key 用于 i18n 组装，args 为插值参数） */
export interface SnapshotIssue {
    key: 'configFileErrRoot' | 'configFileErrSection' | 'configFileErrList' | 'configFileErrEntityId'
    arg?: string
}

/** 设置分区键（值必须是对象） */
const SECTION_KEYS = ['terminal', 'appearance', 'advanced', 'recents', 'monitor', 'files', 'workflowCtl', 'hotkeys'] as const

/** 实体集合键（值必须是数组）与各项身份键字段 */
const LIST_KEYS: { key: string, idField: 'id' | 'name' }[] = [
    { key: 'profiles', idField: 'id' },
    { key: 'localGroups', idField: 'id' },
    { key: 'sshGroups', idField: 'id' },
    { key: 'tabGroups', idField: 'id' },
    { key: 'quickCommands', idField: 'id' },
    { key: 'quickCommandGroups', idField: 'id' },
    { key: 'workflows', idField: 'id' },
    { key: 'workflowGroups', idField: 'id' },
    { key: 'colorSchemes', idField: 'name' },
]

/**
 * @description 校验解析后的配置对象结构是否完整（分区齐全且类型正确）
 * @param parsed JSON.parse 的结果（unknown）
 * @returns SnapshotIssue | null 首个结构错误；null = 结构完整
 *
 * @example validateSnapshot({ terminal: {} }) // { key: 'configFileErrSection', arg: 'appearance' }
 * @example validateSnapshot(defaultConfig()) // null
 *
 */
export function validateSnapshot (parsed: unknown): SnapshotIssue | null {
    if (!isPlainObject(parsed)) {
        return { key: 'configFileErrRoot' }
    }
    for (const key of SECTION_KEYS) {
        if (!isPlainObject(parsed[key])) {
            return { key: 'configFileErrSection', arg: key }
        }
    }
    for (const { key, idField } of LIST_KEYS) {
        const list = parsed[key]
        if (!Array.isArray(list)) {
            return { key: 'configFileErrList', arg: key }
        }
        for (const item of list) {
            if (!isPlainObject(item) || typeof item[idField] !== 'string' || !item[idField]) {
                return { key: 'configFileErrEntityId', arg: key }
            }
        }
    }
    return null
}
