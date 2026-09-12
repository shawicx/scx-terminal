import { Observable, Subject } from 'rxjs'
import { OSCProcessor, type OSCProcessorOptions } from '@/lib/middleware/oscProcessing'
import { InputProcessor } from '@/lib/middleware/inputProcessing'
import { TerminalStreamProcessor, type NewlineMode } from '@/lib/middleware/streamProcessing'
import { SessionMiddlewareStack } from '@/lib/middleware/middleware'
import { concatBytes, decodeUTF8 } from '@/lib/utils/bytes'

export interface BaseSessionOptions extends OSCProcessorOptions {
    /** 退格键映射；缺省与 'backspace'/'ctrl-?' 为恒等映射，不挂载中间件 */
    backspace?: 'ctrl-h' | 'ctrl-?' | 'delete' | 'backspace'
    /** 输入方向（终端→会话）换行转换；null 不转换 */
    inputNewlines?: NewlineMode
    /** 输出方向（会话→终端）换行转换；null 不转换 */
    outputNewlines?: NewlineMode
}

/**
 * Base class for terminal sessions: owns the middleware stack and the
 * output/close/destroyed streams. Ported from tabby-terminal/src/session.ts.
 */
export abstract class BaseSession {
    open = false
    readonly oscProcessor: OSCProcessor
    readonly middleware = new SessionMiddlewareStack()
    protected output = new Subject<string>()
    protected binaryOutput = new Subject<Uint8Array>()
    protected closed = new Subject<void>()
    protected destroyed = new Subject<void>()
    protected reportedCWD?: string
    private initialDataBuffer: Uint8Array = new Uint8Array(0)
    private initialDataBufferReleased = false
    private destroyPromise: Promise<void> | null = null

    get output$ (): Observable<string> { return this.output }
    get binaryOutput$ (): Observable<Uint8Array> { return this.binaryOutput }
    get closed$ (): Observable<void> { return this.closed }
    get destroyed$ (): Observable<void> { return this.destroyed }

    constructor (options: BaseSessionOptions = {}) {
        this.oscProcessor = new OSCProcessor(options)
        this.middleware.push(this.oscProcessor)
        // 按配置挂载退格/换行中间件（构造期读取，配置变更对新会话生效）
        if (options.backspace === 'ctrl-h' || options.backspace === 'delete') {
            this.middleware.push(new InputProcessor({ backspace: options.backspace }))
        }
        if (options.inputNewlines || options.outputNewlines) {
            this.middleware.push(new TerminalStreamProcessor({
                inputNewlines: options.inputNewlines ?? null,
                outputNewlines: options.outputNewlines ?? null,
            }))
        }
        this.oscProcessor.cwdReported$.subscribe(cwd => {
            this.reportedCWD = cwd
        })

        this.middleware.outputToTerminal$.subscribe(data => {
            if (!this.initialDataBufferReleased) {
                this.initialDataBuffer = concatBytes([this.initialDataBuffer, data])
            } else {
                this.output.next(decodeUTF8(data))
                this.binaryOutput.next(data)
            }
        })

        this.middleware.outputToSession$.subscribe(data => this.write(data))
    }

    feedFromTerminal (data: Uint8Array): void {
        this.middleware.feedFromTerminal(data)
    }

    protected emitOutput (data: Uint8Array): void {
        this.middleware.feedFromSession(data)
    }

    /**
     * Holds output back until the frontend is attached so the first screen of
     * a session (prompt, motd) is never lost.
     */
    releaseInitialDataBuffer (): void {
        this.initialDataBufferReleased = true
        this.output.next(decodeUTF8(this.initialDataBuffer))
        this.binaryOutput.next(this.initialDataBuffer)
        this.initialDataBuffer = new Uint8Array(0)
    }

    async destroy (): Promise<void> {
        if (!this.destroyPromise) {
            this.destroyPromise = (async () => {
                if (this.open) {
                    this.open = false
                    this.closed.next()
                    this.destroyed.next()
                    await this.gracefullyKillProcess()
                }
                this.middleware.close()
                this.closed.complete()
                this.destroyed.complete()
                this.output.complete()
                this.binaryOutput.complete()
            })()
        }
        return this.destroyPromise
    }

    abstract start (options: unknown): Promise<void>
    abstract resize (columns: number, rows: number): void
    abstract write (data: Uint8Array): void
    abstract kill (signal?: string): void
    abstract gracefullyKillProcess (): Promise<void>
    abstract supportsWorkingDirectory (): boolean
    abstract getWorkingDirectory (): Promise<string | null>
}
