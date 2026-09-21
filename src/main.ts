import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import App from './App.vue'
import i18n from './i18n'
import { useConfigStore } from './stores/config'
import { useThemeStore } from './stores/theme'
import '../node_modules/tw-animate-css/dist/tw-animate.css'
import './assets/styles/main.css'
import './assets/styles/palette.css'

async function bootstrap (): Promise<void> {
    const app = createApp(App)
    const pinia = createPinia()

    app.use(pinia)
    app.use(i18n)

    // forward frontend errors to the Rust console (visible in `tauri dev` output);
    // 注册须早于配置加载：boot 早期异常也要能经 dev_log 进入调试日志
    app.config.errorHandler = (err, _instance, info) => {
        void invoke('dev_log', { message: `VUE-ERR ${info}: ${String(err)}\n${err instanceof Error ? err.stack : ''}` })
    }
    window.addEventListener('error', e => {
        void invoke('dev_log', { message: `JS-ERR ${e.message} @ ${e.filename}:${e.lineno}` })
    })
    window.addEventListener('unhandledrejection', e => {
        void invoke('dev_log', { message: `REJ ${String(e.reason)}` })
    })

    // config must be loaded before any terminal frontend is created
    const config = useConfigStore(pinia)
    await config.load()
    useThemeStore(pinia).init()

    // 调试模式（advanced.debugEnabled）：开启文件日志并随启动打开 DevTools
    if (config.store.advanced.debugEnabled) {
        void invoke('debug_set_enabled', { enabled: true })
        void invoke('debug_open_devtools')
    }

    app.mount('#app')
}

void bootstrap()
