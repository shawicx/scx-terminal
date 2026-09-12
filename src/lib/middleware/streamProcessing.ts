import { replaceBytes } from '@/lib/utils/bytes'
import { SessionMiddleware } from './middleware'

export type NewlineMode = null | 'cr' | 'lf' | 'crlf' | 'implicit_cr' | 'implicit_lf'

export interface StreamProcessingOptions {
    inputNewlines: NewlineMode
    outputNewlines: NewlineMode
}

const CR = [0x0d]
const LF = [0x0a]
const CRLF = [0x0d, 0x0a]

/**
 * Converts line endings between the session and the terminal according to
 * user preference. Simplified port of tabby-terminal's TerminalStreamProcessor
 * (the readline/hexdump debug modes are not part of scx-terminal's MVP).
 */
export class TerminalStreamProcessor extends SessionMiddleware {
    constructor (
        private options: StreamProcessingOptions,
    ) {
        super()
    }

    feedFromSession (data: Uint8Array): void {
        this.outputToTerminal.next(this.replaceNewlines(data, this.options.outputNewlines))
    }

    feedFromTerminal (data: Uint8Array): void {
        this.outputToSession.next(this.replaceNewlines(data, this.options.inputNewlines))
    }

    private replaceNewlines (data: Uint8Array, mode: NewlineMode): Uint8Array {
        if (!mode) {
            return data
        }
        if (mode === 'implicit_cr') {
            return replaceBytes(data, LF, CRLF)
        }
        if (mode === 'implicit_lf') {
            return replaceBytes(data, CR, CRLF)
        }
        data = replaceBytes(data, CRLF, LF)
        data = replaceBytes(data, CR, LF)
        const replacement = mode === 'cr' ? CR : mode === 'lf' ? LF : CRLF
        return replaceBytes(data, LF, replacement)
    }
}
