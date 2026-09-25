/**
 * @description English 语言包装配：设置域 + 面板域浅合并；结构与 zh-CN 对齐
 *              （Messages 类型由 zh-CN 推导）。
 */
import { settings } from './en/settings'
import { panels } from './en/panels'

export const en = {
    ...settings,
    ...panels,
}
