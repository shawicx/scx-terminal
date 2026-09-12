import { Observable, Subject, Unsubscribable } from 'rxjs'

/**
 * A piece of terminal I/O processing sitting between the session and the
 * frontend. Data flowing session→terminal passes through feedFromSession,
 * terminal→session through feedFromTerminal.
 *
 * Ported from tabby-terminal/src/api/middleware.ts (Buffer → Uint8Array).
 */
export class SessionMiddleware {
    get outputToSession$ (): Observable<Uint8Array> { return this.outputToSession }
    get outputToTerminal$ (): Observable<Uint8Array> { return this.outputToTerminal }

    protected outputToSession = new Subject<Uint8Array>()
    protected outputToTerminal = new Subject<Uint8Array>()

    feedFromSession (data: Uint8Array): void {
        this.outputToTerminal.next(data)
    }

    feedFromTerminal (data: Uint8Array): void {
        this.outputToSession.next(data)
    }

    close (): void {
        this.outputToSession.complete()
        this.outputToTerminal.complete()
    }
}

/** Chains middlewares and links their subjects together. */
export class SessionMiddlewareStack extends SessionMiddleware {
    private stack: SessionMiddleware[] = []
    private subs: Unsubscribable[] = []

    constructor () {
        super()
        this.stack.push(new SessionMiddleware())
    }

    push (middleware: SessionMiddleware): void {
        this.stack.push(middleware)
        this.relink()
    }

    unshift (middleware: SessionMiddleware): void {
        this.stack.unshift(middleware)
        this.relink()
    }

    remove (middleware: SessionMiddleware): void {
        this.stack = this.stack.filter(m => m !== middleware)
        this.relink()
    }

    replace (middleware: SessionMiddleware, newMiddleware: SessionMiddleware): void {
        const index = this.stack.indexOf(middleware)
        if (index >= 0) {
            this.stack[index].close()
            this.stack[index] = newMiddleware
        } else {
            this.stack.push(newMiddleware)
        }
        this.relink()
    }

    feedFromSession (data: Uint8Array): void {
        this.stack[0]!.feedFromSession(data)
    }

    feedFromTerminal (data: Uint8Array): void {
        this.stack[this.stack.length - 1]!.feedFromTerminal(data)
    }

    close (): void {
        for (const m of this.stack) {
            m.close()
        }
        for (const sub of this.subs) {
            sub.unsubscribe()
        }
        this.subs = []
        super.close()
    }

    private relink (): void {
        for (const sub of this.subs) {
            sub.unsubscribe()
        }
        this.subs = []

        for (let i = 0; i < this.stack.length - 1; i++) {
            this.subs.push(
                this.stack[i]!.outputToTerminal$.subscribe(x => this.stack[i + 1]!.feedFromSession(x)),
            )
        }
        this.subs.push(
            this.stack[this.stack.length - 1]!.outputToTerminal$.subscribe(x => this.outputToTerminal.next(x)),
        )

        for (let i = this.stack.length - 2; i >= 0; i--) {
            this.subs.push(
                this.stack[i + 1]!.outputToSession$.subscribe(x => this.stack[i]!.feedFromTerminal(x)),
            )
        }
        this.subs.push(
            this.stack[0]!.outputToSession$.subscribe(x => this.outputToSession.next(x)),
        )
    }
}
