import { BaseSession } from './baseSession'
import { TauriPTYProxy } from '@/services/pty'
import { encodeUTF8 } from '@/lib/utils/bytes'

export interface LocalSessionOptions {
    command: string
    args: string[]
    env: Record<string, string>
    cwd: string | null
    width: number | null
    height: number | null
    pauseAfterExit?: boolean
}

/**
 * A local shell session running over a Rust-managed PTY.
 * Ported from tabby-local/src/session.ts (Electron IPC → Tauri IPC).
 */
export class LocalSession extends BaseSession {
    private pty: TauriPTYProxy | null = null
    private ptyClosed = false
    private pauseAfterExit = false
    private pendingResize: { columns: number, rows: number } | null = null

    async start (options: LocalSessionOptions): Promise<void> {
        const env = {
            COLORTERM: 'truecolor',
            TERM: 'xterm-256color',
            TERM_PROGRAM: 'scx-terminal',
            ...options.env,
        }

        // fit 尺寸可能在 spawn 前就通过 resize() 到达（resize$ 是 ReplaySubject），
        // 记下并在 spawn 时使用，避免 PTY 固定以 80×30 启动导致输入行提前换行
        const initialSize = this.pendingResize
        this.pendingResize = null

        const pty = new TauriPTYProxy()
        try {
            await pty.start({
                file: options.command,
                args: options.args,
                env,
                cwd: options.cwd,
                cols: initialSize?.columns ?? options.width ?? 80,
                rows: initialSize?.rows ?? options.height ?? 30,
            })
        } catch (error) {
            this.emitOutput(encodeUTF8(`\r\nCould not start ${options.command}:\r\n${String(error)}\r\n`))
            return
        }

        this.pty = pty
        this.open = true

        // spawn 往返期间若又有新的 resize 到达，启动后立即补发
        if (this.pendingResize) {
            const { columns, rows } = this.pendingResize
            this.pendingResize = null
            void pty.resize(columns, rows)
        }

        pty.subscribe('data', payload => {
            const data = payload as Uint8Array
            pty.ackData(data.length)
            this.emitOutput(data)
        })

        pty.subscribe('exit', () => {
            if (this.open && !this.pauseAfterExit) {
                void this.destroy()
            }
        })

        pty.subscribe('close', () => {
            this.ptyClosed = true
            if (this.pauseAfterExit) {
                this.emitOutput(encodeUTF8('\r\nPress any key to close\r\n'))
            } else if (this.open) {
                void this.destroy()
            }
        })

        this.pauseAfterExit = options.pauseAfterExit ?? false

        this.destroyed$.subscribe(() => pty.unsubscribeAll())
    }

    getID (): string | null {
        return this.pty?.getID() ?? null
    }

    resize (columns: number, rows: number): void {
        if (!this.pty) {
            // PTY 尚未启动：先记录，start() 会以该尺寸 spawn 或在启动后补发
            this.pendingResize = { columns, rows }
            return
        }
        void this.pty.resize(columns, rows)
    }

    write (data: Uint8Array): void {
        if (this.ptyClosed) {
            void this.destroy()
        }
        if (this.open) {
            void this.pty?.write(data)
        }
    }

    kill (signal?: string): void {
        this.pty?.kill(signal)
    }

    async gracefullyKillProcess (): Promise<void> {
        // Rust side closes the master writer (EOF/SIGHUP to the session)
        // and escalates to a hard kill.
        this.kill()
    }

    supportsWorkingDirectory (): boolean {
        return !!this.reportedCWD
    }

    async getWorkingDirectory (): Promise<string | null> {
        return this.reportedCWD ?? null
    }
}
