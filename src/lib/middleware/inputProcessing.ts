import { encodeUTF8 } from '@/lib/utils/bytes'
import { SessionMiddleware } from './middleware'

export interface InputProcessingOptions {
    backspace: 'ctrl-h' | 'ctrl-?' | 'delete' | 'backspace'
}

/** Remaps the backspace key according to user preference. Ported from tabby-terminal. */
export class InputProcessor extends SessionMiddleware {
    constructor (
        private options: InputProcessingOptions,
    ) {
        super()
    }

    feedFromTerminal (data: Uint8Array): void {
        if (data.length === 1 && data[0] === 0x7f) {
            if (this.options.backspace === 'ctrl-h') {
                data = encodeUTF8('\x08')
            } else if (this.options.backspace === 'delete') {
                data = encodeUTF8('\x1b[3~')
            }
            // 'ctrl-?' and 'backspace' both map to 0x7f
        }
        this.outputToSession.next(data)
    }
}
