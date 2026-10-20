/**
 * @description 输入命令行跟踪器：从终端输入字节流重建用户敲入的命令行文本，
 *              供 SSH 文件面板跟随 cd 等目录切换命令。只做行缓冲级还原——
 *              遇到无法精确模拟的行编辑键（Tab 补全、方向键历史、Ctrl+W 删词等）
 *              将该行标记为不可信，行结束时不上报（宁可不同步也不猜错）。
 */
import { decodeUTF8 } from '@/lib/utils/bytes'

const CR = 0x0d
const LF = 0x0a
const BS = 0x08
const DEL = 0x7f
/** 行中止键：清空当前行但不触发上报（shell 提示符重开新行） */
const LINE_ABORT = new Set([0x03, 0x04, 0x1a])

/** 跟踪器句柄 */
export interface InputLineTracker {
    /** 喂入一段输入字节（xterm 编码后的原始字节流） */
    feed (data: Uint8Array): void
    /** 清空缓冲（会话重连等行上下文失效时） */
    reset (): void
}

/**
 * @description 创建输入命令行跟踪器：按字节累积当前行，\r 或 \n 触发上报完整行
 * @param onLine 行结束回调（仅该行全部来自可精确模拟的输入时触发；空行不上报）
 * @returns InputLineTracker
 *
 * @example const tracker = createInputLineTracker(line => console.log(line))
 *
 */
export function createInputLineTracker (onLine: (line: string) => void): InputLineTracker {
    let buffer: number[] = []
    let clean = true
    let lastByte = 0

    /** UTF-8 感知退格：从尾部回退连续字节后删除一个完整码点 */
    function backspace (): void {
        if (!buffer.length) {
            return
        }
        while (buffer.length > 1 && (buffer[buffer.length - 1]! & 0xc0) === 0x80) {
            buffer.pop()
        }
        buffer.pop()
    }

    return {
        feed (data: Uint8Array): void {
            for (const byte of data) {
                if (byte === CR || byte === LF) {
                    // \r\n / \n\r 只触发一次行结束
                    const paired = (lastByte === CR && byte === LF) || (lastByte === LF && byte === CR)
                    if (!paired && clean && buffer.length) {
                        onLine(decodeUTF8(new Uint8Array(buffer)))
                    }
                    buffer = []
                    clean = true
                } else if (byte === BS || byte === DEL) {
                    backspace()
                } else if (LINE_ABORT.has(byte)) {
                    // Ctrl+C/Ctrl+D/Ctrl+Z 作废当前行：清缓冲开新行，不上报
                    buffer = []
                    clean = true
                } else if (byte === 0x15) {
                    // Ctrl+U 清整行：可精确模拟，清缓冲但保持行可信
                    buffer = []
                } else if (byte < 0x20) {
                    // 其余控制字符（Tab 补全、光标移动、ESC 序列、Ctrl+W 等）无法
                    // 从输入流还原 shell侧行编辑结果，标记该行不可信
                    clean = false
                } else {
                    buffer.push(byte)
                }
                lastByte = byte
            }
        },
        reset (): void {
            buffer = []
            clean = true
            lastByte = 0
        },
    }
}
