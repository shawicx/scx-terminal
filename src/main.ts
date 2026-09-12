import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import App from './App.vue'
import i18n from './i18n'
import { useConfigStore } from './stores/config'
import { useThemeStore } from './stores/theme'
import '../node_modules/tw-animate-css/dist/tw-animate.css'
import './assets/styles/main.css'

async function bootstrap (): Promise<void> {
    const app = createApp(App)
    const pinia = createPinia()

    app.use(pinia)
    app.use(i18n)

    // config must be loaded before any terminal frontend is created
    await useConfigStore(pinia).load()
    useThemeStore(pinia).init()

    // forward frontend errors to the Rust console (visible in `tauri dev` output)
    app.config.errorHandler = (err, _instance, info) => {
        void invoke('dev_log', { message: `VUE-ERR ${info}: ${String(err)}\n${err instanceof Error ? err.stack : ''}` })
    }
    window.addEventListener('error', e => {
        void invoke('dev_log', { message: `JS-ERR ${e.message} @ ${e.filename}:${e.lineno}` })
    })
    window.addEventListener('unhandledrejection', e => {
        void invoke('dev_log', { message: `REJ ${String(e.reason)}` })
    })

    app.mount('#app')
}

void bootstrap()
