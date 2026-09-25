/**
 * @description 窗格级主题派生（原 TerminalPane 主题段）：档案专属配色解析与
 *              背景图洗色（铺满宿主的半透明方案底色，窗格级内联变量下发）。
 */
import { computed } from 'vue'
import { resolveColorScheme } from '@/lib/colorSchemes'
import { composeTerminalBackground } from '@/lib/backgroundImage'
import type { ConfigStore } from '@/stores/config/types'

/** usePaneTheme 的依赖集 */
export interface PaneThemeDeps {
    /** 档案专属配色名（null = 跟随全局） */
    profileColorScheme: () => string | null
    /** 全局配置 store */
    config: () => ConfigStore
}

/**
 * @description 窗格配色与背景洗色
 * @param deps 配色名与配置访问器
 * @returns paneColorScheme（档案配色或 null）与 terminalBgWash（rgba 洗色）
 *
 * @example const theme = usePaneTheme({ profileColorScheme: () => props.profile.colorScheme, config: () => configStore.store })
 *
 */
export function usePaneTheme (deps: PaneThemeDeps) {
    // 档案专属配色：档案指定配色名时解析后经 terminalColorScheme 通道下发，null 跟随全局
    const paneColorScheme = computed(() => {
        const name = deps.profileColorScheme()
        return name
            ? resolveColorScheme(
                name,
                window.matchMedia('(prefers-color-scheme: light)').matches,
                deps.config().colorSchemes,
            )
            : null
    })

    // 背景图洗色：铺满整个宿主的半透明方案底色（含 fit 取整的右侧/底部条带——viewport
    // 在背景图激活时全透明，着色统一由背景层渐变承担）；无图时全透明（不参与合成）。
    // 洗色跟档案配色走（窗格级内联变量），非全局
    const terminalBgWash = computed(() => {
        const appearance = deps.config().appearance
        if (appearance.backgroundImage === null) {
            return 'rgba(0, 0, 0, 0)'
        }
        const scheme = paneColorScheme.value
            ?? resolveColorScheme(
                appearance.colorScheme,
                window.matchMedia('(prefers-color-scheme: light)').matches,
                deps.config().colorSchemes,
            )
        return composeTerminalBackground(scheme.background, appearance.backgroundOpacity)
    })

    return { paneColorScheme, terminalBgWash }
}
