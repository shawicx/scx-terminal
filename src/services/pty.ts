import { Channel, invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export interface PTYSpawnOptions {
    file: string
    args: string[]
    env: Record<string, string>
    cwd: string | null
    cols: number
    rows: number
}

type PTYEventHandler = (payload?: unknown) => void

/**
 * Renderer-side handle to a Rust-managed PTY.
 *
 * Data plane: output arrives as raw binary over a Tauri IPC channel
 * (ArrayBuffer on the JS side). Every chunk is acknowledged immediately on
 * receipt — the Rust side stops reading the pty while unacknowledged bytes
 * pile up, which is what keeps `yes` from eating all the memory.
 *
 * Ported from tabby-electron/src/pty.ts (Electron IPC → Tauri IPC).
 */
export class TauriPTYProxy {
    private id: string | null = null
    private handlers: Record<string, PTYEventHandler[]> = {}
    private unlisteners: UnlistenFn[] = []
    private exited = false
    private pendingChunks: Uint8Array[] = []

    async start (options: PTYSpawnOptions): Promise<void> {
        const channel = new Channel<ArrayBuffer | number[]>()
        channel.onmessage = message => {
            const data = message instanceof ArrayBuffer
                ? new Uint8Array(message)
                : new Uint8Array(message as number[])
            this.deliverData(data)
        }

        this.id = await invoke<string>('pty_spawn', { options, channel })

        for (const event of ['exit', 'close']) {
            this.unlisteners.push(await listen(`pty:${this.id}:${event}`, e => {
                if (event === 'exit') {
                    this.exited = true
                }
                for (const handler of this.handlers[event] ?? []) {
                    handler(e.payload)
                }
            }))
        }
    }

    /**
     * @description 分发一条来自 Rust 的 PTY 输出。channel 回调在 spawn 前就已安装，
     * 而 'data' 订阅者要等 spawn 与事件监听往返之后才注册；这段窗口内到达的
     * 输出（通常是提示符行的开头字节）先缓冲，待首个订阅者注册时统一回放。
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
     * @description 回放缓冲的输出块；订阅者在 flush 过程中接收数据与正常路径完全一致
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

    async exists (): Promise<boolean> {
        if (!this.id || this.exited) {
            return false
        }
        return invoke<boolean>('pty_exists', { id: this.id })
    }

    /**
     * @description 经 Rust 进程探测读取会话 shell 子进程的当前工作目录
     * @returns Promise<string | null> 目录绝对路径；未启动/已退出/探测失败为 null
     *
     * @example const cwd = await pty.getWorkingDirectory()
     *
     */
    async getWorkingDirectory (): Promise<string | null> {
        if (!this.id || this.exited) {
            return null
        }
        try {
            return await invoke<string | null>('pty_get_cwd', { id: this.id })
        } catch {
            return null
        }
    }

    async resize (columns: number, rows: number): Promise<void> {
        if (this.id) {
            await invoke('pty_resize', { id: this.id, cols: columns, rows })
        }
    }

    async write (data: Uint8Array): Promise<void> {
        if (this.id) {
            // a pty may exit between keystroke and delivery — not an error
            await invoke('pty_write', { id: this.id, data: Array.from(data) }).catch(() => {})
        }
    }

    async kill (_signal?: string): Promise<void> {
        if (this.id) {
            await invoke('pty_kill', { id: this.id })
        }
    }

    ackData (length: number): void {
        if (this.id) {
            void invoke('pty_ack_data', { id: this.id, length })
        }
    }

    subscribe (event: string, handler: PTYEventHandler): void {
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
