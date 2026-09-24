/**
 * @description SSH 监控编排器（纯逻辑，IO 全注入）：管理档案级的卡片/详情两级
 *              采样绑定，经注册表消费计数管理连接生命周期；fatal 后按退避序列
 *              重连（release → acquire → start），成功即重置退避。
 */

/** 注入依赖 */
export interface MonitorDeps {
    /** 为档案取连接（窗格优先，否则建/复用 headless） */
    acquire: (profileId: string, consumerId: string) => Promise<string>
    /** 释放消费者（headless 归零进宽限期） */
    release: (profileId: string, consumerId: string) => void
    /** 启动采样任务 */
    start: (profileId: string, sshId: string, level: 'card' | 'full') => Promise<void>
    /** 停止采样任务 */
    stop: (profileId: string) => Promise<void>
    /** 上报错误（连接失败 / 重连中） */
    reportError: (profileId: string, message: string) => void
}

/** fatal 重连退避序列；末值封顶重复 */
export const RETRY_DELAYS_MS = [1000, 2000, 5000, 10000]

/** 卡片建连错峰间隔 */
const STAGGER_MS = 500

/** 重连挂起态 */
interface RetryState {
    timer: ReturnType<typeof setTimeout> | null
    attempt: number
}

export class MonitorOrchestrator {
    private readonly cardIds = new Set<string>()
    private readonly detailIds = new Set<string>()
    private readonly retries = new Map<string, RetryState>()
    /** startCard 错峰循环代号：stopCard 递增使在跑循环失效，防迟到建连成孤儿 */
    private startEpoch = 0

    constructor (private readonly deps: MonitorDeps) {}

    /**
     * @description 启动卡片级监控：逐台串行 acquire + start（500ms 错峰），
     *              单台失败记入错误不阻塞后续；错峰醒来后建连前复查 epoch，
     *              stopCard 已发生则剩余档案不再建连（防无人停止的孤儿采样）
     * @param profileIds SSH 档案 id 列表
     * @returns Promise<void>
     *
     * @example await orchestrator.startCard(['p1', 'p2'])
     *
     */
    async startCard (profileIds: string[]): Promise<void> {
        const epoch = this.startEpoch
        for (const id of profileIds) {
            if (epoch !== this.startEpoch) {
                return
            }
            if (this.detailIds.has(id) || this.cardIds.has(id)) {
                continue
            }
            this.cardIds.add(id)
            try {
                // ensure 前复查详情绑定：错峰期间到达的 bindDetail 不得被迟到的卡片级 ensure 降级
                if (this.detailIds.has(id)) {
                    this.cardIds.delete(id)
                    continue
                }
                await this.ensure(id, this.levelOf(id))
                if (profileIds.indexOf(id) !== profileIds.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, STAGGER_MS))
                }
            } catch (error) {
                this.cardIds.delete(id)
                this.deps.reportError(id, String(error))
            }
        }
    }

    /**
     * @description 停止卡片级监控；仍有详情绑定的档案跳过（连接与任务归详情）；
     *              递增 startEpoch 使在跑的 startCard 错峰循环失效
     * @returns Promise<void>
     *
     * @example await orchestrator.stopCard()
     *
     */
    async stopCard (): Promise<void> {
        this.startEpoch += 1
        // 快照后遍历：循环内会从 cardIds 删除，避免边迭代边变更
        const ids = [...this.cardIds]
        for (const id of ids) {
            this.cardIds.delete(id)
            if (this.detailIds.has(id)) {
                continue
            }
            this.cancelRetry(id)
            await this.deps.stop(id)
            this.deps.release(id, consumerId(id))
        }
    }

    /**
     * @description 绑定详情面板：升级为 full 级采样
     * @param profileId 档案 id
     * @returns Promise<void>
     *
     * @example await orchestrator.bindDetail('p1')
     *
     */
    async bindDetail (profileId: string): Promise<void> {
        this.detailIds.add(profileId)
        this.cancelRetry(profileId)
        try {
            await this.ensure(profileId, 'full')
        } catch (error) {
            this.deps.reportError(profileId, String(error))
        }
    }

    /**
     * @description 解绑详情面板：卡片监控存活则降级 card，否则停任务并释放连接
     * @param profileId 档案 id
     * @returns Promise<void>
     *
     * @example await orchestrator.unbindDetail('p1')
     *
     */
    async unbindDetail (profileId: string): Promise<void> {
        if (!this.detailIds.delete(profileId)) {
            return
        }
        if (this.cardIds.has(profileId)) {
            try {
                await this.ensure(profileId, 'card')
            } catch (error) {
                this.deps.reportError(profileId, String(error))
            }
            return
        }
        this.cancelRetry(profileId)
        await this.deps.stop(profileId)
        this.deps.release(profileId, consumerId(profileId))
    }

    /**
     * @description 会话死亡通知（monitor-fatal 事件）：仍在绑定集内则退避重连
     * @param profileId 档案 id
     * @returns void
     *
     * @example orchestrator.onFatal('p1')
     *
     */
    onFatal (profileId: string): void {
        if (!this.cardIds.has(profileId) && !this.detailIds.has(profileId)) {
            return
        }
        this.deps.reportError(profileId, 'reconnecting')
        this.scheduleRetry(profileId)
    }

    /** 当前档案应使用的采样等级（详情绑定优先 full） */
    private levelOf (profileId: string): 'card' | 'full' {
        return this.detailIds.has(profileId) ? 'full' : 'card'
    }

    /** 取连接并启动采样（consumer id 稳定为 monitor:{profileId}，Set 去重） */
    private async ensure (profileId: string, level: 'card' | 'full'): Promise<void> {
        const sshId = await this.deps.acquire(profileId, consumerId(profileId))
        await this.deps.start(profileId, sshId, level)
    }

    /** 按退避序列安排一次重连 */
    private scheduleRetry (profileId: string): void {
        const state = this.retries.get(profileId) ?? { timer: null, attempt: 0 }
        if (state.timer !== null) {
            return
        }
        const delay = RETRY_DELAYS_MS[Math.min(state.attempt, RETRY_DELAYS_MS.length - 1)]!
        state.timer = setTimeout(() => {
            state.timer = null
            void (async () => {
                try {
                    this.deps.release(profileId, consumerId(profileId))
                    await this.ensure(profileId, this.levelOf(profileId))
                    this.retries.delete(profileId) // 成功即重置退避
                } catch {
                    state.attempt += 1
                    this.scheduleRetry(profileId)
                }
            })()
        }, delay)
        this.retries.set(profileId, state)
    }

    /** 取消挂起的重连定时器 */
    private cancelRetry (profileId: string): void {
        const state = this.retries.get(profileId)
        if (state && state.timer !== null) {
            clearTimeout(state.timer)
            state.timer = null
        }
        this.retries.delete(profileId)
    }
}

/** 注册表消费者 id（卡片与详情共用一个，Set 去重） */
function consumerId (profileId: string): string {
    return `monitor:${profileId}`
}
