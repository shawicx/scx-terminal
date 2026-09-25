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

/** 「重连中」错误哨兵：HostCard/MonitorSidebar 据此渲染横幅，两侧必须同源 */
export const MONITOR_ERROR_RECONNECTING = 'reconnecting'

/** 卡片建连错峰间隔 */
const STAGGER_MS = 500

/** 重连挂起态 */
interface RetryState {
    timer: ReturnType<typeof setTimeout> | null
    attempt: number
    /** 重连体在跑（timer 已触发）：防第二次 onFatal 另起并发重试链 */
    running: boolean
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
     *              单台失败记入错误不阻塞后续；epoch 失效（stopCard 已发生）
     *              时不再建连，ensure 期间失效则补偿停释防孤儿采样任务
     * @param profileIds SSH 档案 id 列表
     * @returns Promise<void>
     *
     * @example await orchestrator.startCard(['p1', 'p2'])
     *
     */
    async startCard (profileIds: string[]): Promise<void> {
        const epoch = this.startEpoch
        for (let i = 0; i < profileIds.length; i++) {
            const id = profileIds[i]!
            if (epoch !== this.startEpoch) {
                return
            }
            if (this.detailIds.has(id) || this.cardIds.has(id)) {
                continue
            }
            this.cardIds.add(id)
            try {
                await this.ensure(id)
                // ensure 的 await 期间 stopCard 可能已发生：迟到 start 已复活采样，
                // 补偿停释；若期间到达了详情绑定则不补偿（连接与任务归详情）
                if (epoch !== this.startEpoch && !this.detailIds.has(id)) {
                    await this.teardown(id)
                    return
                }
                if (i < profileIds.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, STAGGER_MS))
                }
            } catch (error) {
                this.cardIds.delete(id)
                if (epoch === this.startEpoch) {
                    this.deps.reportError(id, String(error))
                }
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
            // 单台停释失败不得中断其余档案的清理（否则残留绑定与泄漏连接）
            await this.teardown(id)
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
            await this.ensure(profileId)
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
                await this.ensure(profileId) // detailIds 已删 → ensure 内求值为 card
            } catch (error) {
                this.deps.reportError(profileId, String(error))
            }
            return
        }
        await this.teardown(profileId)
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
        if (!this.isBound(profileId)) {
            return
        }
        this.deps.reportError(profileId, MONITOR_ERROR_RECONNECTING)
        this.scheduleRetry(profileId)
    }

    /** 档案仍有任意层（卡片/详情）绑定 */
    private isBound (profileId: string): boolean {
        return this.cardIds.has(profileId) || this.detailIds.has(profileId)
    }

    /** 当前档案应使用的采样等级（详情绑定优先 full） */
    private levelOf (profileId: string): 'card' | 'full' {
        return this.detailIds.has(profileId) ? 'full' : 'card'
    }

    /**
     * 取连接并启动采样（consumer id 稳定为 monitor:{profileId}，Set 去重）。
     * 等级在 acquire 之后求值：错峰/重试窗口内到达的 bindDetail 不会被迟到的
     * 卡片级 start 降级。start 失败立即补偿 release，防泄漏无人停止的消费者。
     */
    private async ensure (profileId: string): Promise<void> {
        const sshId = await this.deps.acquire(profileId, consumerId(profileId))
        try {
            await this.deps.start(profileId, sshId, this.levelOf(profileId))
        } catch (error) {
            this.deps.release(profileId, consumerId(profileId))
            throw error
        }
    }

    /** 停任务并释放消费者；stop 失败也必须 release（否则 headless 连接永不进宽限期） */
    private async teardown (profileId: string): Promise<void> {
        this.cancelRetry(profileId)
        try {
            await this.deps.stop(profileId)
        } catch (error) {
            this.deps.reportError(profileId, String(error))
        } finally {
            this.deps.release(profileId, consumerId(profileId))
        }
    }

    /** 按退避序列安排一次重连 */
    private scheduleRetry (profileId: string): void {
        const state = this.retries.get(profileId) ?? { timer: null, attempt: 0, running: false }
        if (state.timer !== null || state.running) {
            return
        }
        const delay = RETRY_DELAYS_MS[Math.min(state.attempt, RETRY_DELAYS_MS.length - 1)]!
        state.timer = setTimeout(() => {
            state.timer = null
            state.running = true
            void (async () => {
                // 需在 running 复位后再排下一轮（scheduleRetry 的在跑守卫会拒绝在跑期间的
                // 重排），故用标志延后到 finally 之后
                let reschedule = false
                try {
                    this.deps.release(profileId, consumerId(profileId))
                    await this.ensure(profileId)
                    if (this.isBound(profileId)) {
                        this.retries.delete(profileId) // 成功且仍绑定：重置退避
                    } else {
                        // ensure 的 await 期间绑定被解除：迟到 start 已复活采样，补偿停释
                        await this.teardown(profileId)
                    }
                } catch {
                    state.attempt += 1
                    reschedule = this.isBound(profileId) // 已解绑则放弃，不复活连接
                } finally {
                    state.running = false
                }
                if (reschedule) {
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
