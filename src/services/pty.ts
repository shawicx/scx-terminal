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

    async start (options: PTYSpawnOptions): Promise<void> {
        const channel = new Channel<ArrayBuffer | number[]>()
        channel.onmessage = message => {
            const data = message instanceof ArrayBuffer
                ? new Uint8Array(message)
                : new Uint8Array(message as number[])
            for (const handler of this.handlers['data'] ?? []) {
                handler(data)
            }
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

    getID (): string {
        return this.id ?? ''
    }

    async exists (): Promise<boolean> {
        if (!this.id || this.exited) {
            return false
        }
        return invoke<boolean>('pty_exists', { id: this.id })
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
    }

    unsubscribeAll (): void {
        this.handlers = {}
        for (const unlisten of this.unlisteners) {
            unlisten()
        }
        this.unlisteners = []
    }
}
