/**
 * @description 标签与标签分组的共用 7 色预设色板（TabStrip 颜色标记与设置页
 *              「标签分组」配色共用；name 为 i18n 键 tab.colorNames.* 的尾段）。
 */

/** 色板条目：name 用于 i18n 词条，color 为 CSS 颜色值 */
export interface TabColorPreset {
    name: 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'gray'
    color: string
}

/** 7 色预设色板（与标签颜色标记同一套） */
export const TAB_COLORS: readonly TabColorPreset[] = [
    { name: 'red', color: '#e06c75' },
    { name: 'orange', color: '#d19a66' },
    { name: 'yellow', color: '#e5c07b' },
    { name: 'green', color: '#98c379' },
    { name: 'blue', color: '#61afef' },
    { name: 'purple', color: '#c678dd' },
    { name: 'gray', color: '#7f848e' },
] as const
