/**
 * @description 端口转发运行态聚合 store：`forward_list_all` 全量拉取 + 按连接订阅
 *              `forward:{sshId}:changed` 事件（连接集合来自 sshConnections 注册表，
 *              registryVersion 变化时同步增删订阅）。隧道管理器标签页与 TitleBar
 *              隧道指示器的数据源。
 *              注意：registryVersion 的 watch 在模块作用域同步创建（WKWebView 下
 *              await 之后创建的 watch 不触发）。
 */
import { watch } from 'vue'
import { defineStore } from 'pinia'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { ForwardState } from '@/lib/portForwarding'
import { listAllForwards } from '@/services/forward'
import { knownSshIds, registryVersion } from '@/services/sshConnections'

export const useForwardingStore = defineStore('forwarding', {
    state: () => ({
        states: [] as ForwardState[],
        /** 状态变化计数器（消费方 watch 派生用） */
        version: 0,
        initialized: false,
    }),
    getters: {
        activeStates (state): ForwardState[] {
            return state.states.filter(state => state.status === 'active')
        },
        failedStates (state): ForwardState[] {
            return state.states.filter(state => state.status === 'failed')
        },
    },
    actions: {
        /**
         * @description 初始化：全量拉取 + 订阅同步（幂等，App 挂载时调用）
         * @returns Promise<void>
         *
         * @example await useForwardingStore().init()
         *
         */
        async init (): Promise<void> {
            if (this.initialized) {
                return
            }
            this.initialized = true
            await this.refreshAll()
            await syncSubscriptions(this)
        },
        /**
         * @description 全量拉取转发运行态（任一连接的 changed 事件后调用）
         * @returns Promise<void>
         *
         */
        async refreshAll (): Promise<void> {
            try {
                this.states = await listAllForwards()
                this.version += 1
            } catch {
                // 连接层错误不打断 UI：保留上次快照
            }
        },
    },
})

/** 连接级事件订阅登记（sshId → unlisten） */
const subscriptions = new Map<string, UnlistenFn>()

/**
 * @description 按注册表连接集合增删 changed 事件订阅；事件到达后全量刷新
 * @param store 转发 store
 * @returns Promise<void>
 *
 */
async function syncSubscriptions (store: ReturnType<typeof useForwardingStore>): Promise<void> {
    const ids = knownSshIds()
    for (const sshId of ids) {
        if (subscriptions.has(sshId)) {
            continue
        }
        const unlisten = await listen(`forward:${sshId}:changed`, () => {
            void store.refreshAll()
        })
        subscriptions.set(sshId, unlisten)
    }
    for (const [sshId, unlisten] of subscriptions) {
        if (!ids.includes(sshId)) {
            unlisten()
            subscriptions.delete(sshId)
        }
    }
}

// 连接集合变化（窗格连接建立/断开、headless 建连/关闭）→ 同步订阅
watch(registryVersion, () => {
    void syncSubscriptions(useForwardingStore())
})
