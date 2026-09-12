import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { useConfigStore } from '@/stores/config'

/**
 * Theme engine: toggles the `dark` class on <html>, follows the OS color
 * scheme when configured as 'auto', and bumps `epoch` whenever anything
 * theme-relevant changes so terminal frontends can re-apply their palettes.
 */
export const useThemeStore = defineStore('theme', () => {
    const isDark = ref(true)
    const epoch = ref(0)

    function apply (): void {
        const config = useConfigStore()
        const media = window.matchMedia('(prefers-color-scheme: light)')
        const pref = config.store.appearance.colorScheme
        isDark.value = !(pref === 'light' || (pref === 'auto' && media.matches))
        document.documentElement.classList.toggle('dark', isDark.value)
        document.documentElement.style.colorScheme = isDark.value ? 'dark' : 'light'
        epoch.value++
    }

    function init (): void {
        const config = useConfigStore()
        watch(() => config.store.appearance.colorScheme, apply)
        window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', apply)
        apply()
    }

    return { isDark, epoch, init }
})
