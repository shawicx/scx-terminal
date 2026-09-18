/**
 * @description SSH 远程 shell 会话：对接 Rust russh 会话（services/ssh.ts SshProxy）。
 *              连接/认证/指纹确认失败以错误文本打进终端缓冲（同 LocalSession 的
 *              "Could not start" 模式，不抛异常）；cwd 跟踪仅依赖远端 shell 的
 *              OSC 7/1337 上报（BaseSession 中间件已解析），无进程探测可用；
 *              kbd-interactive 凭据挑战应答与记住密码回存。
 */
import { BaseSession, type BaseSessionOptions } from './baseSession'
import { SshProxy, type HostKeyChallenge, type KbdAnswer, type KbdChallenge } from '@/services/ssh'
import { setProfilePassword } from '@/services/secrets'
import { encodeUTF8 } from '@/lib/utils/bytes'
import { nanoid } from 'nanoid'

export interface SshSessionOptions {
    host: string
    port: number
    user: string
    auth: string
    /** 档案 id（Rust 据此解密已存密码） */
    profileId: string
    /** 密钥链条目 id（Rust 据此解密私钥）；null = 不用密钥链 */
    keyId: string | null
    width: number | null
    height: number | null
}

export interface SshSessionSetup extends BaseSessionOptions {
    /** 主机指纹确认回调（返回是否接受；UI 层弹对话框实现） */
    onHostKey?: (challenge: HostKeyChallenge) => Promise<boolean>
    /** kbd-interactive / 密码挑战回调（返回应答；null = 取消。多轮挑战会多次调用） */
    onKeyboardInteractive?: (challenge: KbdChallenge) => Promise<KbdAnswer | null>
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

        // kbd-interactive / 合成密码挑战：回调挂起等 UI 应答；「记住」仅对单一密码型挑战
        // 生效，多轮时以最后一轮为准（成功后回存见 start 尾部）
        // 注：初值用 as 显式联合类型——闭包内赋值不参与 CFA，否则此处被收窄为 null
        let lastSaveable = null as { remember: boolean, password: string } | null
        proxy.subscribe('kbdchallenge', payload => {
            void (async () => {
                const challenge = payload as KbdChallenge
                const answer = this.setup.onKeyboardInteractive
                    ? await this.setup.onKeyboardInteractive(challenge)
                    : null
                if (answer && challenge.prompts.length === 1 && !challenge.prompts[0].echo) {
                    lastSaveable = { remember: answer.remember, password: answer.responses[0] ?? '' }
                } else {
                    lastSaveable = null
                }
                await proxy.respondKbd(answer ? answer.responses : null).catch(() => {})
            })()
        })

        try {
            await proxy.start({
                id: `ssh-${nanoid(10)}`,
                profileId: options.profileId,
                host: options.host,
                port: options.port,
                user: options.user,
                auth: options.auth,
                keyId: options.keyId,
                cols: initialSize?.columns ?? options.width ?? 80,
                rows: initialSize?.rows ?? options.height ?? 24,
            })
        } catch (error) {
            this.emitOutput(encodeUTF8(`\r\nSSH connection to ${options.host}:${options.port} failed:\r\n${String(error)}\r\n`))
            return
        }

        // 认证成功后按最后一轮「记住密码」回存（失败/取消路径已在上面 return，不会到达）
        if (lastSaveable?.remember) {
            void setProfilePassword(options.profileId, lastSaveable.password).catch(() => {})
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

    /**
     * @description 本会话的 SSH 连接 id（SFTP 面板等按 id 定位 Rust 侧连接）
     * @returns string | null 会话 id；未启动为 null
     *
     * @example const sshId = session.sshSessionId
     *
     */
    get sshSessionId (): string | null {
        return this.proxy?.getID() ?? null
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
