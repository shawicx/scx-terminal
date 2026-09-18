/**
 * @description Rust SSH 会话（russh）的前端句柄：连接选项、二进制输出通道（带 ack 背压与
 *              订阅前缓冲）、exit/close/hostkey 事件监听与指纹确认应答。
 *              结构对照 services/pty.ts 的 TauriPTYProxy（Tauri IPC 数据面约定一致）。
 *              支持 kbd-interactive 凭据挑战事件与应答。
 */
import { Channel, invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export interface SSHConnectOptions {
    /** 会话 id：由前端生成，使事件监听可在 invoke 返回前注册（hostkey 事件在连接期间发出） */
    id: string
    /** 档案 id：Rust 据此从加密库解密已存密码 */
    profileId: string
    host: string
    port: number
    user: string
    auth: string
    /** 密钥链条目 id（Rust 据此解密私钥）；null = 不用密钥链 */
    keyId: string | null
    cols: number
    rows: number
    /** 无终端会话的后台连接（SFTP 标签/独立隧道）：跳过 PTY/shell，cols/rows/dataChannel 被忽略 */
    headless?: boolean
}

/** 主机指纹确认请求（事件 `ssh:{id}:hostkey` 载荷） */
export interface HostKeyChallenge {
    fingerprint: string
    keyType: string
    changed: boolean
}

/** kbd-interactive / 合成密码挑战的单个提问（事件 `ssh:{id}:kbdchallenge` 载荷） */
export interface KbdPrompt {
    /** 服务器原文提示语（如 "Password: " / "Verification code:"），直接作为输入框 label */
    prompt: string
    /** false = 密码/验证码（不回显）；true = 普通问题（明文） */
    echo: boolean
}

/** kbd-interactive / 合成密码挑战（事件 `ssh:{id}:kbdchallenge` 载荷） */
export interface KbdChallenge {
    name: string
    instructions: string
    prompts: KbdPrompt[]
}

/** 弹窗一轮应答：responses 对位 prompts；remember 仅前端使用（记住密码回存），不过 IPC */
export interface KbdAnswer {
    responses: string[]
    remember: boolean
}

type SshEventHandler = (payload?: unknown) => void

export class SshProxy {
    private id: string | null = null
    private handlers: Record<string, SshEventHandler[]> = {}
    private unlisteners: UnlistenFn[] = []
    private pendingChunks: Uint8Array[] = []

    /**
     * @description 建立 SSH 连接并打开远端 shell（连接/认证/PTY 由 Rust 完成）；
     *              hostkey 事件由调用方经 subscribe('hostkey') 处理并调 confirmHostKey 应答
     * @param options 连接选项（host/port/user/auth/初始尺寸）
     * @returns Promise<void> 连接失败抛出错误文本
     *
     * @example await proxy.start({ host: 'example.com', port: 22, user: 'root', auth: 'auto', privateKeyPath: null, password: null, cols: 80, rows: 24 })
     *
     */
    async start (options: SSHConnectOptions): Promise<void> {
        const channel = new Channel<ArrayBuffer | number[]>()
        channel.onmessage = message => {
            const data = message instanceof ArrayBuffer
                ? new Uint8Array(message)
                : new Uint8Array(message as number[])
            this.deliverData(data)
        }

        this.id = options.id
        // 事件监听必须先于 invoke 注册：hostkey 事件在连接握手期间发出，
        // 而 ssh_connect 要等指纹确认才返回（否则事件丢失 → 死锁）
        for (const event of ['exit', 'close', 'hostkey', 'kbdchallenge']) {
            this.unlisteners.push(await listen(`ssh:${this.id}:${event}`, e => {
                for (const handler of this.handlers[event] ?? []) {
                    handler(e.payload)
                }
            }))
        }

        await invoke<string>('ssh_connect', { options, dataChannel: channel })
    }

    /**
     * @description 应答主机指纹确认（对应 `ssh:{id}:hostkey` 事件；仅 connect 阶段有效）
     * @param accepted 是否接受该主机密钥
     * @returns Promise<void>
     *
     * @example await proxy.confirmHostKey(true)
     *
     */
    async confirmHostKey (accepted: boolean): Promise<void> {
        if (this.id) {
            await invoke('ssh_confirm_host_key', { id: this.id, accepted })
        }
    }

    /**
     * @description 应答 kbd-interactive 凭据挑战（对应 `ssh:${id}:kbdchallenge` 事件；仅认证阶段有效）
     * @param responses 对位每个 prompt 的应答；null = 用户取消
     * @returns Promise<void>
     *
     * @example await proxy.respondKbd(['hunter2'])
     *
     */
    async respondKbd (responses: string[] | null): Promise<void> {
        if (this.id) {
            await invoke('ssh_respond_kbd', { id: this.id, responses })
        }
    }

    /**
     * @description 分发一条来自 Rust 的 SSH 输出；'data' 订阅者注册前的块先缓冲回放
     * @param data 输出字节
     */
    private deliverData (data: Uint8Array): void {
        const handlers = this.handlers['data']
        if (!handlers || handlers.length === 0) {
            this.pendingChunks.push(data)
            return
        }
        for (const handler of handlers) {
            handler(data)
        }
    }

    /**
     * @description 回放缓冲的输出块（与 pty 代理同语义：订阅者晚到不丢首屏）
     */
    private flushPendingChunks (): void {
        if (this.pendingChunks.length === 0) {
            return
        }
        const chunks = this.pendingChunks
        this.pendingChunks = []
        for (const chunk of chunks) {
            this.deliverData(chunk)
        }
    }

    getID (): string {
        return this.id ?? ''
    }

    async resize (columns: number, rows: number): Promise<void> {
        if (this.id) {
            await invoke('ssh_resize', { id: this.id, cols: columns, rows })
        }
    }

    async write (data: Uint8Array): Promise<void> {
        if (this.id) {
            // 会话可能在按键与送达之间断开——与 pty 相同不视为错误
            await invoke('ssh_write', { id: this.id, data: Array.from(data) }).catch(() => {})
        }
    }

    async kill (): Promise<void> {
        if (this.id) {
            await invoke('ssh_kill', { id: this.id }).catch(() => {})
        }
    }

    ackData (length: number): void {
        if (this.id) {
            void invoke('ssh_ack_data', { id: this.id, length }).catch(() => {})
        }
    }

    subscribe (event: string, handler: SshEventHandler): void {
        this.handlers[event] ??= []
        this.handlers[event].push(handler)
        if (event === 'data') {
            this.flushPendingChunks()
        }
    }

    unsubscribeAll (): void {
        this.handlers = {}
        this.pendingChunks = []
        for (const unlisten of this.unlisteners) {
            unlisten()
        }
        this.unlisteners = []
    }
}
