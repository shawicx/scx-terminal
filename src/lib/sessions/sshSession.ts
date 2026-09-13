/**
 * @description SSH 远程 shell 会话：对接 Rust russh 会话（services/ssh.ts SshProxy）。
 *              连接/认证/指纹确认失败以错误文本打进终端缓冲（同 LocalSession 的
 *              "Could not start" 模式，不抛异常）；cwd 跟踪仅依赖远端 shell 的
 *              OSC 7/1337 上报（BaseSession 中间件已解析），无进程探测可用。
 */
import { BaseSession, type BaseSessionOptions } from './baseSession'
import { SshProxy, type HostKeyChallenge } from '@/services/ssh'
import { encodeUTF8 } from '@/lib/utils/bytes'
import { nanoid } from 'nanoid'

export interface SshSessionOptions {
    host: string
    port: number
    user: string
    auth: string
    privateKeyPath: string | null
    password: string | null
    width: number | null
    height: number | null
}

export interface SshSessionSetup extends BaseSessionOptions {
    /** 主机指纹确认回调（返回是否接受；UI 层弹对话框实现） */
    onHostKey?: (challenge: HostKeyChallenge) => Promise<boolean>
}

export class SshSession extends BaseSession {
    private proxy: SshProxy | null = null
    private pendingResize: { columns: number, rows: number } | null = null

    constructor (private readonly setup: SshSessionSetup = {}) {
        super(setup)
    }

    async start (options: SshSessionOptions): Promise<void> {
        // fit 尺寸可能在连接前就通过 resize() 到达（resize$ 是 ReplaySubject），连接时使用
        const initialSize = this.pendingResize
        this.pendingResize = null

        const proxy = new SshProxy()
        proxy.subscribe('hostkey', payload => {
            void (async () => {
                const challenge = payload as HostKeyChallenge
                const accepted = this.setup.onHostKey ? await this.setup.onHostKey(challenge) : false
                await proxy.confirmHostKey(accepted).catch(() => {})
            })()
        })

        try {
            await proxy.start({
                id: `ssh-${nanoid(10)}`,
                host: options.host,
                port: options.port,
                user: options.user,
                auth: options.auth,
                privateKeyPath: options.privateKeyPath,
                password: options.password,
                cols: initialSize?.columns ?? options.width ?? 80,
                rows: initialSize?.rows ?? options.height ?? 24,
            })
        } catch (error) {
            this.emitOutput(encodeUTF8(`\r\nSSH connection to ${options.host}:${options.port} failed:\r\n${String(error)}\r\n`))
            return
        }

        this.proxy = proxy
        this.open = true

        if (this.pendingResize) {
            const { columns, rows } = this.pendingResize
            this.pendingResize = null
            void proxy.resize(columns, rows)
        }

        proxy.subscribe('data', payload => {
            const data = payload as Uint8Array
            proxy.ackData(data.length)
            this.emitOutput(data)
        })

        proxy.subscribe('exit', () => {
            if (this.open) {
                void this.destroy()
            }
        })

        this.destroyed$.subscribe(() => proxy.unsubscribeAll())
    }

    resize (columns: number, rows: number): void {
        if (this.proxy) {
            void this.proxy.resize(columns, rows)
        } else {
            this.pendingResize = { columns, rows }
        }
    }

    write (data: Uint8Array): void {
        if (this.proxy && this.open) {
            void this.proxy.write(data)
        }
    }

    kill (): void {
        this.proxy?.kill()
    }

    async gracefullyKillProcess (): Promise<void> {
        this.kill()
    }

    supportsWorkingDirectory (): boolean {
        return !!this.reportedCWD
    }

    /**
     * @description 远端当前工作目录：仅 OSC 7/1337 上报（远端 shell 配置了 hook 时可用），无探测兜底
     * @returns Promise<string | null> 上报的目录或 null
     *
     * @example const cwd = await session.getWorkingDirectory()
     *
     */
    async getWorkingDirectory (): Promise<string | null> {
        return this.reportedCWD ?? null
    }
}
