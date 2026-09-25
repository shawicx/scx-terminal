/**
 * @description vue-i18n 装配入口：语言包在 zh-CN.ts / en.ts（Messages 类型以 zh-CN 为基准）。
 */
import { createI18n } from 'vue-i18n'
import { zhCN } from './zh-CN'
import { en } from './en'

export type Messages = typeof zhCN

const i18n = createI18n({
    legacy: false,
    locale: 'zh-CN',
    fallbackLocale: 'en',
    messages: {
        'zh-CN': zhCN,
        en,
    },
})

export default i18n
