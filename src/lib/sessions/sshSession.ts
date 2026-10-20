/**
 * @description SSH 远程 shell 会话：对接 Rust russh 会话（services/ssh.ts SshProxy）。
 *              连接/认证/指纹确认失败以错误文本打进终端缓冲（同 LocalSession 的
 *              "Could not start" 模式，不抛异常）；cwd 跟踪优先依赖远端 shell 的
 *              OSC 7/1337 上报（BaseSession 中间件已解析），另以输入命令行跟踪
 *              （shellCommand$，逐行还原用户键入的命令）支撑无上报时的 cd 跟随；
 *              kbd-interactive 凭据挑战应答与记住密码回存；连接丢失（exit 载荷
 *              lost）不销毁会话，改发 disconnected$ 供 UI 保留窗格并提供手动重连。
 */
import { Observable, Subject } from 'rxjs'
import { BaseSession, type BaseSessionOptions } from './baseSession'
import { SshProxy, type HostKeyChallenge, type JumpHop, type KbdAnswer, type KbdChallenge } from '@/services/ssh'
import { setProfilePassword } from '@/services/secrets'
import { encodeUTF8 } from '@/lib/utils/bytes'
import { nanoid } from 'nanoid'
import { createInputLineTracker } from './inputLineTracker'

export interface SshSessionOptions {
    host: string
    port: number
    user: string
    auth: string
    /** 档案 id（Rust 据此解密已存密码） */
    profileId: string
    /** 密钥链条目 id（Rust 据此解密私钥）；null = 不用密钥链 */
    keyId: string | null
    /** 跳板机链（连接顺序；缺省 = 直连）。由调用方经 resolveJumpChain 解析填入 */
    jumpHops?: JumpHop[]
    /** 跳板链解析失败文案（环/引用缺失等；有值时以失败文本打进终端后放弃连接） */
    jumpChainError?: string
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
    /** 首次 start 的连接参数（reconnect 原样复用：含跳板链） */
    private connectOptions: SshSessionOptions | null = null
    /** 重连进行中标志（覆盖层按钮防重入） */
    private reconnecting = false
    private disconnectedSubj = new Subject<void>()
    private shellCommandSubj = new Subject<string>()
    private readonly inputTracker: ReturnType<typeof createInputLineTracker>

    /** 连接丢失（非远端正常退出）时发出；窗格据此显示重连覆盖层而不关窗格 */
    get disconnected$ (): Observable<void> { return this.disconnectedSubj }

    /** 用户执行的 shell 命令行（输入流逐行还原；不可信行不上报）——文件面板 cd 跟随用 */
    get shellCommand$ (): Observable<string> { return this.shellCommandSubj }

    constructor (private readonly setup: SshSessionSetup = {}) {
        super(setup)
        this.inputTracker = createInputLineTracker(line => this.shellCommandSubj.next(line))
    }

    async start (options: SshSessionOptions): Promise<void> {
        // 跳板链解析失败（环/引用缺失等）：与连接失败同模式打进终端缓冲后放弃
        if (options.jumpChainError) {
            this.emitOutput(encodeUTF8(`\r\nSSH jump chain error:\r\n${options.jumpChainError}\r\n`))
            return
        }

        this.connectOptions = options

        try {
            await this.connect(options)
        } catch (error) {
            this.emitOutput(encodeUTF8(`\r\nSSH connection to ${options.host}:${options.port} failed:\r\n${String(error)}\r\n`))
        }
    }

    /**
     * @description 建立一次 SSH 连接并完成全部事件接线（挑战应答/数据/exit）；
     *              start 与 reconnect 共用，连接失败以异常上抛由调用方决定呈现方式
     * @param options 连接参数（host/port/user/auth/跳板链/初始尺寸）
     * @returns Promise<SshProxy> 已就绪并接入本会话的代理
     *
     * @example this.proxy = await this.connect(options)
     *
     */
    private async connect (options: SshSessionOptions): Promise<SshProxy> {
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
        // 生效，多轮时以最后一轮为准（成功后回存见下方）
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
                jumpHops: options.jumpHops,
                cols: initialSize?.columns ?? options.width ?? 80,
                rows: initialSize?.rows ?? options.height ?? 24,
            })
        } catch (error) {
            proxy.unsubscribeAll()
            throw error
        }

        // 认证成功后按最后一轮「记住密码」回存（失败/取消路径已在上面 throw，不会到达）
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

        proxy.subscribe('exit', payload => {
            if (!this.open || this.proxy !== proxy) {
                return
            }
            const reason = typeof payload === 'string' ? payload : ''
            if (reason === 'lost') {
                // 连接丢失（长时空闲/网络中断/睡眠唤醒等）：Rust 侧已自清理，无残余资源；
                // 保留会话与终端缓冲，仅清理代理并通知 UI 显示重连入口
                proxy.unsubscribeAll()
                this.proxy = null
                this.open = false
                this.emitOutput(encodeUTF8('\r\n\x1b[90m[SSH connection lost]\x1b[0m\r\n'))
                this.disconnectedSubj.next()
            } else {
                // 远端 shell 正常退出（用户敲 exit 等）：维持既有行为，销毁会话关窗格
                void this.destroy()
            }
        })

        this.destroyed$.subscribe(() => proxy.unsubscribeAll())
        return proxy
    }

    /**
     * @description 连接丢失后手动重连：以首次 start 的连接参数（含跳板链）新建连接，
     *              终端滚动缓冲保留；失败把错误文本打进缓冲并由调用方保留重连入口
     * @returns Promise<boolean> 是否重连成功
     *
     * @example const ok = await session.reconnect()
     *
     */
    async reconnect (): Promise<boolean> {
        const options = this.connectOptions
        if (!options || this.open || this.reconnecting) {
            return false
        }
        this.reconnecting = true
        try {
            await this.connect(options)
            return true
        } catch (error) {
            this.emitOutput(encodeUTF8(`\r\nSSH reconnect to ${options.host}:${options.port} failed:\r\n${String(error)}\r\n`))
            return false
        } finally {
            this.reconnecting = false
        }
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

    /** 输入透传中间件后再喂命令行跟踪器（shellCommand$ 的数据源） */
    override feedFromTerminal (data: Uint8Array): void {
        super.feedFromTerminal(data)
        this.inputTracker.feed(data)
    }

    override async destroy (): Promise<void> {
        await super.destroy()
        this.shellCommandSubj.complete()
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
