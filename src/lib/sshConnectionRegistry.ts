/**
 * @description SSH 连接注册表（纯逻辑）：按档案索引活跃 SSH 连接——终端窗格会话（register/
 *              unregister 登记）与后台 headless 连接（acquire/release 引用计数）。acquire
 *              优先复用窗格会话（SSH 多路复用），无则经注入的 connect 建 headless 连接；
 *              消费者归零后经注入的 disconnect 宽限关闭。IO 全部注入，便于单测。
 */

/** 一条 headless 连接的登记信息（消费者集合 + 宽限关闭定时器） */
export interface HeadlessRecord {
    sshId: string
    consumers: Set<string>
    closeTimer: ReturnType<typeof setTimeout> | null
}

/** 注册表注入依赖 */
export interface RegistryOptions {
    /** 为档案建立 headless 连接（resolve sshId；失败 reject） */
    connect: (profileId: string) => Promise<string>
    /** 断开一条 headless 连接 */
    disconnect: (sshId: string) => void
    /** 消费者归零后的关闭宽限毫秒数 */
    graceMs?: number
}

const DEFAULT_GRACE_MS = 30_000

export class SshConnectionRegistry {
    private readonly paneSessions = new Map<string, string[]>()
    private readonly headless = new Map<string, HeadlessRecord>()
    private readonly connecting = new Map<string, Promise<string>>()
    private readonly graceMs: number

    constructor (private readonly options: RegistryOptions) {
        this.graceMs = options.graceMs ?? DEFAULT_GRACE_MS
    }

    /**
     * @description 登记一条终端窗格会话（窗格连接建立后调用；生命周期归窗格，不做引用计数）
     * @param profileId 档案 id
     * @param sshId 会话 id
     * @returns void
     *
     * @example registry.registerPaneSession('ssh-1', 'ssh-abc')
     *
     */
    registerPaneSession (profileId: string, sshId: string): void {
        const sessions = this.paneSessions.get(profileId) ?? []
        if (!sessions.includes(sshId)) {
            sessions.push(sshId)
        }
        this.paneSessions.set(profileId, sessions)
    }

    /**
     * @description 注销一条终端窗格会话（窗格关闭/会话退出后调用）
     * @param profileId 档案 id
     * @param sshId 会话 id
     * @returns void
     *
     */
    unregisterPaneSession (profileId: string, sshId: string): void {
        const sessions = this.paneSessions.get(profileId)
        if (!sessions) {
            return
        }
        const next = sessions.filter(id => id !== sshId)
        if (next.length === 0) {
            this.paneSessions.delete(profileId)
        } else {
            this.paneSessions.set(profileId, next)
        }
    }

    /**
     * @description 该档案最近登记的窗格会话 id（复用优先取最新连接）
     * @param profileId 档案 id
     * @returns string | null 会话 id；无窗格会话为 null
     *
     */
    paneSshIdFor (profileId: string): string | null {
        const sessions = this.paneSessions.get(profileId)
        return sessions?.length ? sessions[sessions.length - 1]! : null
    }

    hasPaneSessions (profileId: string): boolean {
        return (this.paneSessions.get(profileId)?.length ?? 0) > 0
    }

    /**
     * @description 获取该档案的连接：窗格会话优先复用（不计数，生命周期归窗格）；
     *              否则复用/建立 headless 连接并登记消费者
     * @param profileId 档案 id
     * @param consumerId 消费者 id（SFTP 标签/隧道，release 对称使用）
     * @returns Promise<string> sshId
     *
     */
    async acquire (profileId: string, consumerId: string): Promise<string> {
        const pane = this.paneSshIdFor(profileId)
        if (pane) {
            return pane
        }
        const existing = this.headless.get(profileId)
        if (existing) {
            if (existing.closeTimer !== null) {
                clearTimeout(existing.closeTimer)
                existing.closeTimer = null
            }
            existing.consumers.add(consumerId)
            return existing.sshId
        }
        let pending = this.connecting.get(profileId)
        if (!pending) {
            pending = this.options.connect(profileId).then(sshId => {
                this.connecting.delete(profileId)
                this.headless.set(profileId, { sshId, consumers: new Set(), closeTimer: null })
                return sshId
            }, error => {
                this.connecting.delete(profileId)
                throw error
            })
            this.connecting.set(profileId, pending)
        }
        const sshId = await pending
        const record = this.headless.get(profileId)
        if (record) {
            if (record.closeTimer !== null) {
                clearTimeout(record.closeTimer)
                record.closeTimer = null
            }
            record.consumers.add(consumerId)
        }
        return sshId
    }

    /**
     * @description 释放一个消费者；headless 连接归零后进入宽限期，期满无新消费者则断开
     * @param profileId 档案 id
     * @param consumerId 消费者 id
     * @returns void
     *
     */
    release (profileId: string, consumerId: string): void {
        const record = this.headless.get(profileId)
        if (!record) {
            return
        }
        record.consumers.delete(consumerId)
        if (record.consumers.size === 0 && record.closeTimer === null) {
            record.closeTimer = setTimeout(() => {
                record.closeTimer = null
                if (record.consumers.size === 0) {
                    this.headless.delete(profileId)
                    this.options.disconnect(record.sshId)
                }
            }, this.graceMs)
        }
    }

    /**
     * @description headless 连接断开通知（exit 事件）：移除登记（宽限定时器一并清理）
     * @param sshId 连接 id
     * @returns void
     *
     */
    noteHeadlessDead (sshId: string): void {
        for (const [profileId, record] of this.headless) {
            if (record.sshId === sshId) {
                if (record.closeTimer !== null) {
                    clearTimeout(record.closeTimer)
                }
                this.headless.delete(profileId)
                return
            }
        }
    }

    /**
     * @description 指定连接是否仍存活（SFTP 标签判断是否需要重连）
     * @param profileId 档案 id
     * @param sshId 连接 id
     * @returns boolean
     *
     */
    isAlive (profileId: string, sshId: string): boolean {
        return this.paneSessions.get(profileId)?.includes(sshId) === true
            || this.headless.get(profileId)?.sshId === sshId
    }

    /**
     * @description 连接 id → 归属档案 id（隧道管理器把运行态映射回档案/规则）
     * @param sshId 连接 id
     * @returns string | null 档案 id；未知连接为 null
     *
     * @example const profileId = registry.profileIdForSshId('ssh-abc')
     *
     */
    profileIdForSshId (sshId: string): string | null {
        for (const [profileId, sessions] of this.paneSessions) {
            if (sessions.includes(sshId)) {
                return profileId
            }
        }
        for (const [profileId, record] of this.headless) {
            if (record.sshId === sshId) {
                return profileId
            }
        }
        return null
    }

    headlessSshIdFor (profileId: string): string | null {
        return this.headless.get(profileId)?.sshId ?? null
    }

    isConnecting (profileId: string): boolean {
        return this.connecting.has(profileId)
    }

    /**
     * @description 当前全部活跃连接 id（窗格 + headless；转发事件按连接订阅用）
     * @returns string[]
     *
     * @example for (const id of registry.allSshIds()) { subscribe(id) }
     *
     */
    allSshIds (): string[] {
        const ids = new Set<string>()
        for (const sessions of this.paneSessions.values()) {
            for (const id of sessions) {
                ids.add(id)
            }
        }
        for (const record of this.headless.values()) {
            ids.add(record.sshId)
        }
        return [...ids]
    }
}
