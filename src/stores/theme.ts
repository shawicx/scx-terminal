import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { useConfigStore } from '@/stores/config'
import { resolveColorScheme, type TerminalColorScheme } from '@/lib/colorSchemes'
import { deriveChromeTokens, isColorSchemeDark } from '@/lib/schemeColors'

/**
 * Theme engine: toggles the `dark` class on <html>, follows the OS color
 * scheme when configured as 'auto', and bumps `epoch` whenever anything
 * theme-relevant changes so terminal frontends can re-apply their palettes.
 * The selected color scheme also drives the app chrome: its derived CSS
 * variables are injected on <html>, matching Tabby's UI-follows-scheme look.
 */
export const useThemeStore = defineStore('theme', () => {
    const isDark = ref(true)
    const epoch = ref(0)

    /**
     * @description 将配色派生的界面颜色变量写入 <html>。
     * 派生键集合恒定，切换配色时逐键覆盖即可，不会残留旧配色变量。
     * @param scheme 当前生效的终端配色方案
     */
    function applyChromeTokens (scheme: TerminalColorScheme): void {
        const root = document.documentElement
        for (const [prop, value] of Object.entries(deriveChromeTokens(scheme))) {
            root.style.setProperty(prop, value)
        }
    }

    function apply (): void {
        const config = useConfigStore()
        const media = window.matchMedia('(prefers-color-scheme: light)')
        const scheme = resolveColorScheme(config.store.appearance.colorScheme, media.matches, config.store.colorSchemes)
        // UI 深浅跟随配色背景亮度：具名配色取其背景，auto/dark/light 解析出的
        // 默认配色背景与系统深浅一致
        isDark.value = isColorSchemeDark(scheme)
        document.documentElement.classList.toggle('dark', isDark.value)
        document.documentElement.style.colorScheme = isDark.value ? 'dark' : 'light'
        applyChromeTokens(scheme)
        epoch.value++
    }

    function init (): void {
        const config = useConfigStore()
        // 自定义配色内容编辑（如正在使用的方案改色）也需要重派生界面 token
        watch(() => [config.store.appearance.colorScheme, config.store.colorSchemes] as const, apply, { deep: true })
        window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', apply)
        apply()
    }

    return { isDark, epoch, init }
})
