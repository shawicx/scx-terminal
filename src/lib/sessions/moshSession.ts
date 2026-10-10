/**
 * @description Mosh 远程 shell 会话：复用本地 PTY 直接拉起系统 mosh 客户端进程
 *              （mosh 内部自行通过 ssh 引导远端 mosh-server，认证走系统 ssh：
 *              agent / ~/.ssh 密钥 / PTY 内密码提示）。终端 I/O、resize（SIGWINCH）、
 *              断连 roaming 均由 mosh 自身处理；cwd 跟踪仅依赖远端 shell 的
 *              OSC 7/1337 上报（BaseSession 中间件已解析），无进程探测可用。
 */
import { BaseSession, type BaseSessionOptions } from './baseSession'
import { TauriPTYProxy } from '@/services/pty'
import { encodeUTF8 } from '@/lib/utils/bytes'
import { platform } from '@/lib/platform'

export interface MoshSessionOptions {
    host: string
    /** SSH 端口（mosh bootstrap 阶段使用） */
    port: number
    user: string
    /** mosh-server UDP 端口；null = 60000-61000 默认范围 */
    moshPort: number | null
    width: number | null
    height: number | null
}

/**
 * @description 组装 mosh 客户端命令行参数（不含可执行文件名）
 * @param options 连接参数（host/port/user/moshPort）
 * @returns string[] mosh 参数列表
 *
 * @example buildMoshArgs({ host: 'srv', port: 22, user: 'root', moshPort: 60001 })
 * // → ['--ssh=ssh -p 22', '-p', '60001', 'root@srv']
 *
 */
export function buildMoshArgs (options: Pick<MoshSessionOptions, 'host' | 'port' | 'user' | 'moshPort'>): string[] {
    const args: string[] = []
    // 非 22 端口经 mosh 的 --ssh 选项透传给内部 ssh（mosh -p 指的是 UDP 端口）
    if (options.port !== 22) {
        args.push(`--ssh=ssh -p ${options.port}`)
    }
    if (options.moshPort !== null) {
        args.push('-p', String(options.moshPort))
    }
    args.push(`${options.user}@${options.host}`)
    return args
}

export class MoshSession extends BaseSession {
    private pty: TauriPTYProxy | null = null
    private pendingResize: { columns: number, rows: number } | null = null

    constructor (options?: BaseSessionOptions) {
        super(options)
    }

    async start (options: MoshSessionOptions): Promise<void> {
        // mosh 官方无原生 Windows 客户端：直接拒绝并输出提示（同错误进缓冲的既有模式）
        if (platform === 'windows') {
            this.emitOutput(encodeUTF8('\r\nMosh is not supported on Windows yet — use SSH instead.\r\n'))
            return
        }

        // fit 尺寸可能在 spawn 前就通过 resize() 到达（resize$ 是 ReplaySubject），
        // 记下并在 spawn 时使用（同 LocalSession）
        const initialSize = this.pendingResize
        this.pendingResize = null

        const pty = new TauriPTYProxy()
        try {
            await pty.start({
                file: 'mosh',
                args: buildMoshArgs(options),
                env: {
                    COLORTERM: 'truecolor',
                    TERM: 'xterm-256color',
                    TERM_PROGRAM: 'scx-terminal',
                },
                cwd: null,
                cols: initialSize?.columns ?? options.width ?? 80,
                rows: initialSize?.rows ?? options.height ?? 24,
            })
        } catch (error) {
            this.emitOutput(encodeUTF8(
                '\r\nCould not start mosh (is it installed? try `brew install mosh` / `apt install mosh`):\r\n'
                + `${String(error)}\r\n`,
            ))
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
            if (this.open) {
                void this.destroy()
            }
        })

        pty.subscribe('close', () => {
            if (this.open) {
                void this.destroy()
            }
        })

        this.destroyed$.subscribe(() => pty.unsubscribeAll())
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
        if (this.open) {
            void this.pty?.write(data)
        }
    }

    kill (): void {
        this.pty?.kill()
    }

    async gracefullyKillProcess (): Promise<void> {
        this.kill()
    }

    supportsWorkingDirectory (): boolean {
        return !!this.reportedCWD
    }

    /**
     * @description 远端当前工作目录：仅 OSC 7/1337 上报（mosh 透传时可用），无探测兜底
     * @returns Promise<string | null> 上报的目录或 null
     *
     * @example const cwd = await session.getWorkingDirectory()
     *
     */
    async getWorkingDirectory (): Promise<string | null> {
        return this.reportedCWD ?? null
    }
}
