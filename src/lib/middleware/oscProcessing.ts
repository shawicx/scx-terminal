import { Observable, Subject } from 'rxjs'
import { SessionMiddleware } from './middleware'
import { concatBytes, indexOfBytes, bytesFromBase64 } from '@/lib/utils/bytes'

const OSC_PREFIX = [0x1b, 0x5d] as const // ESC ]
const OSC_SUFFIXES = [[0x07], [0x1b, 0x5c]] as const // BEL, ESC \

function ascii (bytes: readonly number[]): Uint8Array {
    return new Uint8Array(bytes as number[])
}

function asciiSlice (data: Uint8Array, start: number, end: number): string {
    let result = ''
    for (let i = start; i < end; i++) {
        result += String.fromCharCode(data[i]!)
    }
    return result
}

/**
 * Intercepts OSC escape sequences that carry side channels:
 * - OSC 1337 ; CurrentDir=… — shell-reported working directory (e.g. by zsh hooks)
 * - OSC 52 ; c ; <base64> — clipboard write request from the remote program
 * Everything else passes through untouched.
 *
 * Ported from tabby-terminal/src/middleware/oscProcessing.ts.
 */
export class OSCProcessor extends SessionMiddleware {
    get cwdReported$ (): Observable<string> { return this.cwdReported }

    private cwdReported = new Subject<string>()
    private buffer: Uint8Array | null = null

    feedFromSession (data: Uint8Array): void {
        if (this.buffer) {
            data = concatBytes([this.buffer, data])
            this.buffer = null
        }

        const prefix = ascii(OSC_PREFIX)
        const suffixes = OSC_SUFFIXES.map(ascii)

        let startIndex = 0
        const processedData: Uint8Array[] = []

        while (startIndex < data.length) {
            const prefixIndex = indexOfBytes(data, prefix, startIndex)

            if (prefixIndex === -1) {
                // No complete OSC prefix ahead — but the tail could be a
                // truncated prefix; hold back the last byte if it is ESC.
                const tail = data.length - startIndex === 1 && data[startIndex] === 0x1b ? 1 : 0
                if (startIndex < data.length - tail) {
                    processedData.push(data.subarray(startIndex, data.length - tail))
                }
                if (tail) {
                    this.buffer = data.subarray(data.length - 1)
                }
                break
            }

            if (prefixIndex > startIndex) {
                processedData.push(data.subarray(startIndex, prefixIndex))
            }

            const suffixSearchStart = prefixIndex + prefix.length
            let foundSuffix: [Uint8Array, number] | null = null

            for (const suffix of suffixes) {
                const suffixIndex = indexOfBytes(data, suffix, suffixSearchStart)
                if (suffixIndex !== -1 && (!foundSuffix || suffixIndex < foundSuffix[1])) {
                    foundSuffix = [suffix, suffixIndex]
                }
            }

            if (!foundSuffix) {
                // No suffix found - buffer the rest and wait for next chunk
                this.buffer = data.subarray(prefixIndex)
                break
            }

            const oscString = asciiSlice(data, suffixSearchStart, foundSuffix[1])
            const [oscCodeString, ...oscParams] = oscString.split(';')
            const oscCode = parseInt(oscCodeString!)

            if (oscCode === 1337) {
                const paramString = oscParams.join(';')
                if (paramString.startsWith('CurrentDir=')) {
                    const reportedCWD = paramString.split('=').slice(1).join('=')
                    this.cwdReported.next(reportedCWD)
                }
            } else if (oscCode === 52) {
                if (oscParams[0] === 'c' || oscParams[0] === '') {
                    const content = bytesFromBase64(oscParams[1] ?? '')
                    // TODO(phase-later): forward clipboard write to platform clipboard
                    void content
                }
            } else {
                processedData.push(data.subarray(prefixIndex, foundSuffix[1] + foundSuffix[0].length))
            }

            startIndex = foundSuffix[1] + foundSuffix[0].length
        }

        if (processedData.length > 0) {
            super.feedFromSession(concatBytes(processedData))
        }
    }

    close (): void {
        this.cwdReported.complete()
        super.close()
    }
}
