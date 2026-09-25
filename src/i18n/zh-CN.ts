/**
 * @description 简体中文语言包装配：设置域（settings）+ 面板域（panels）浅合并；
 *              键结构是 en 与类型 Messages 的基准。
 */
import { settings } from './zh/settings'
import { panels } from './zh/panels'

export const zhCN = {
    ...settings,
    ...panels,
}
