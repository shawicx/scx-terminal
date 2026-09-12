import { Observable, Subject } from 'rxjs'
import { OSCProcessor } from '@/lib/middleware/oscProcessing'
import { SessionMiddlewareStack } from '@/lib/middleware/middleware'
import { concatBytes, decodeUTF8 } from '@/lib/utils/bytes'

/**
 * Base class for terminal sessions: owns the middleware stack and the
 * output/close/destroyed streams. Ported from tabby-terminal/src/session.ts.
 */
export abstract class BaseSession {
    open = false
    readonly oscProcessor = new OSCProcessor()
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

    constructor () {
        this.middleware.push(this.oscProcessor)
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
