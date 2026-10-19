/**
 * @description 端口转发运行态聚合 store：订阅 Rust 全局 `forwards-changed` 事件（负载为全部
 *              连接的完整状态快照，整体替换）+ 初始化时 `forward_list_all` 拉取基线。
 *              订阅必须不绑定连接集合：会话断开时后端级联清理的终态空快照与前端连接注销
 *              同一时刻到达，按连接增删订阅会在退订瞬间漏掉该快照而残留无法停止的条目。
 *              隧道管理器标签页与 TitleBar 隧道指示器的数据源。
 */
import { defineStore } from 'pinia'
import { listen } from '@tauri-apps/api/event'
import type { ForwardState } from '@/lib/portForwarding'
import { listAllForwards } from '@/services/forward'

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
         * @description 初始化：订阅全局事件并拉取一次全量（幂等，App 挂载时调用）
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
            await listen<ForwardState[]>('forwards-changed', event => {
                this.apply(event.payload)
            })
            await this.refreshAll()
        },
        /**
         * @description 应用一份全量快照（整体替换并递增 version）
         * @param states 全部连接的转发运行态
         * @returns void
         *
         */
        apply (states: ForwardState[]): void {
            this.states = states
            this.version += 1
        },
        /**
         * @description 全量拉取转发运行态（初始化基线；失败保留上次快照）
         * @returns Promise<void>
         *
         */
        async refreshAll (): Promise<void> {
            try {
                this.apply(await listAllForwards())
            } catch {
                // 连接层错误不打断 UI：保留上次快照
            }
        },
    },
})
