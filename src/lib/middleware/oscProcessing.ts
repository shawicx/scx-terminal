import { Observable, Subject } from 'rxjs'
import { SessionMiddleware } from './middleware'
import { concatBytes, indexOfBytes, bytesFromBase64, decodeUTF8 } from '@/lib/utils/bytes'

const OSC_PREFIX = [0x1b, 0x5d] as const // ESC ]
const OSC_SUFFIXES = [[0x07], [0x1b, 0x5c]] as const // BEL, ESC \

/** OSC 52 剪贴板写入内容的字节上限（对齐 Tabby，防止远端程序灌爆剪贴板） */
export const OSC52_MAX_CLIPBOARD_BYTES = 100 * 1024

export interface OSCProcessorOptions {
    /** 剪贴板写入函数（OSC 52 的目标）；未提供时内容直接丢弃 */
    setClipboard?: (text: string) => Promise<void>
}

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
 * @description 解析 OSC 7 载荷（file://[host]/path URI）为绝对路径
 * @param payload OSC 7 载荷字符串
 * @returns string | null percent-decode 后的路径；载荷非法时返回 null
 *
 * @example parseOsc7Cwd('file:///tmp/my%20dir') // '/tmp/my dir'
 *
 */
export function parseOsc7Cwd (payload: string): string | null {
    if (!payload.startsWith('file://')) {
        return null
    }
    try {
        const url = new URL(payload)
        const path = decodeURIComponent(url.pathname)
        if (!path.startsWith('/')) {
            return null
        }
        return path
    } catch {
        return null
    }
}

/**
 * Intercepts OSC escape sequences that carry side channels:
 * - OSC 7 ; file://host/path — working directory reporting (standard; tmux passes it through)
 * - OSC 1337 ; CurrentDir=… — shell-reported working directory (e.g. by zsh hooks)
 * - OSC 52 ; c ; <base64> — clipboard write request from the remote program
 * Everything else passes through untouched.
 *
 * Ported from tabby-terminal/src/middleware/oscProcessing.ts (OSC 7 added).
 */
export class OSCProcessor extends SessionMiddleware {
    get cwdReported$ (): Observable<string> { return this.cwdReported }

    private cwdReported = new Subject<string>()
    private buffer: Uint8Array | null = null

    constructor (private readonly options: OSCProcessorOptions = {}) {
        super()
    }

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

            if (oscCode === 7) {
                // OSC 7 ; file://[host]/path：标准 cwd 上报（host 忽略——本地场景空或本机名）；
                // 非法载荷静默丢弃（序列仍被吞掉不透传）
                const cwd = parseOsc7Cwd(oscParams.join(';'))
                if (cwd) {
                    this.cwdReported.next(cwd)
                }
            } else if (oscCode === 1337) {
                const paramString = oscParams.join(';')
                if (paramString.startsWith('CurrentDir=')) {
                    const reportedCWD = paramString.split('=').slice(1).join('=')
                    this.cwdReported.next(reportedCWD)
                }
            } else if (oscCode === 52) {
                // OSC 52 ; <selection> ; <base64>：剪贴板写入请求。
                // 只支持写入（selection 'c' 或缺省）；'?' 为读取查询，不响应。
                const selection = oscParams[0] ?? ''
                const payload = oscParams[1] ?? ''
                if ((selection === 'c' || selection === '') && payload && payload !== '?' && this.options.setClipboard) {
                    try {
                        const content = bytesFromBase64(payload)
                        if (content.length <= OSC52_MAX_CLIPBOARD_BYTES) {
                            void this.options.setClipboard(decodeUTF8(content))
                        }
                    } catch {
                        // 非法 base64 载荷：丢弃该序列（序列本身仍被吞掉不透传）
                    }
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
