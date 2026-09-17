/**
 * @description 输入行模型：从 xterm buffer 现读现算当前逻辑行（soft-wrap 链拼接）、
 * 提示符剥离、续行合并、词定位；PromptTracker 在此之上做提示符长度自适应学习与
 * 回车命令采集。对 shell 端编辑（Tab 补全/↑ 调历史/Ctrl+R）免疫——永不维护影子副本。
 */

export interface BufferLineAccess {
    getLineText (y: number, trimRight: boolean): string | null
    isWrapped (y: number): boolean
    readonly cursorX: number
    readonly cursorY: number
}

export interface LogicalLine {
    text: string
    cursorOffset: number
}

/**
 * @description 从光标沿 soft-wrap 链向上拼接完整逻辑行；中间段不 trimRight（保满宽防偏移漂移），末段 trimRight
 * @param access buffer 行读取接口
 * @returns LogicalLine 逻辑行文本与光标偏移；光标行不可读时 null
 *
 * @example readLogicalLine(access) // { text: 'user@mac ~ % git che', cursorOffset: 18 }
 *
 */
export function readLogicalLine (access: BufferLineAccess): LogicalLine | null {
    const tail = access.getLineText(access.cursorY, true)
    if (tail === null) {
        return null
    }
    const segments = [tail]
    let y = access.cursorY
    while (y > 0 && access.isWrapped(y)) {
        y--
        const segment = access.getLineText(y, false)
        if (segment === null) {
            break
        }
        segments.unshift(segment)
    }
    const text = segments.join('')
    return { text, cursorOffset: text.length - tail.length + access.cursorX }
}

/**
 * @description 剥掉逻辑行首部 promptLen 个字符（提示符），光标偏移同步左移
 * @param line 逻辑行
 * @param promptLen 提示符长度
 * @returns LogicalLine 剥离后的行（永不产生负偏移）
 *
 * @example stripPrompt({ text: 'user@mac ~ % git', cursorOffset: 17 }, 13) // { text: 'git', cursorOffset: 4 }
 *
 */
export function stripPrompt (line: LogicalLine, promptLen: number): LogicalLine {
    const cut = Math.max(promptLen, 0)
    return { text: line.text.slice(cut), cursorOffset: Math.max(0, line.cursorOffset - cut) }
}

/**
 * @description 多行命令续行合并（单行化）：每段去尾部反斜杠，行首 PS2 提示符（> / …）
 *              只从第 2 段起剥（首段可能是合法以 > 开头的命令，如 '> notes.log'），
 *              段间空格拼接；反斜杠续行处直接拼接（反斜杠-换行整体消除，不插空格）。
 *              单行化保证历史记录回灌时不被 shell 逐行执行
 * @param segments 从上到下的各逻辑行文本
 * @returns string 合并后的单行命令
 *
 * @example mergeContinuationLines(['git push \\', '> --force']) // 'git push --force'
 *
 */
export function mergeContinuationLines (segments: readonly string[]): string {
    let merged = ''
    let joinBySpace = true // 上一段是否以普通段结束（需要空格分隔下一段）
    for (const [index, raw] of segments.entries()) {
        // 段 0 是命令首行，永不剥 PS2 前缀；> notes.log 这类重定向命令的历史数据不能被破坏
        const segment = index === 0
            ? raw.trimEnd()
            : raw.trimEnd().replace(/^(?:…|>)\s*/, '')
        if (segment.endsWith('\\')) {
            merged += segment.replace(/\\\s*$/, '')
            joinBySpace = false
        } else {
            if (merged.length > 0 && joinBySpace && segment.trim().length > 0) {
                merged += ' '
            }
            merged += segment.trim()
            joinBySpace = true
        }
    }
    return merged.trim()
}

/**
 * @description 光标左侧的当前词（到空白符为止）
 * @param line 逻辑行文本
 * @param offset 光标偏移
 * @returns object 词文本与起止偏移；光标紧跟空白/行首时 null
 *
 * @example currentWordAt('git checkout ~/Doc', 18) // { text: '~/Doc', start: 13, end: 18 }
 *
 */
export function currentWordAt (line: string, offset: number): { text: string, start: number, end: number } | null {
    const before = line.slice(0, offset)
    const match = /(\S+)$/.exec(before)
    if (!match) {
        return null
    }
    return { text: match[1], start: offset - match[1].length, end: offset }
}

/** 输出静默窗口（ms）：提示符学习与建议评估都在静默后进行 */
const DEFAULT_SILENCE_MS = 250
/** promptLen 学习跳变上限：超出视为异步输出污染，丢弃本次学习 */
const DEFAULT_MAX_PROMPT_JUMP = 20

export interface PromptTrackerHost {
    readLine (): LogicalLine | null
    readLineAbove (up: number): LogicalLine | null
    readCursorPrefix (): string | null
}

/**
 * @description 提示符长度自适应学习器：命令执行完、输出停止后光标停在新提示符后，
 *              此刻光标行 [0, cursorX) 即提示符。回车时采集输入行（剥提示符 + 续行
 *              合并）供历史记录。所有时序以「输出静默」为锚（输入或输出都会重置计时）。
 */
export class PromptTracker {
    private silenceTimer: ReturnType<typeof setTimeout> | undefined
    private readonly silenceMs: number
    private readonly maxPromptJump: number
    private promptLen = 0
    private awaitingPromptLearn = true // 启动后首个静默学习首个提示符
    private pendingRecord: string | null = null
    private destroyed = false

    /**
     * @param host buffer 读取接口（由 xterm 前端实现）
     * @param onSilence 输出静默回调（建议评估触发点；可选）
     * @param options silenceMs 静默窗口 / maxPromptJump 学习跳变上限
     */
    constructor (
        private host: PromptTrackerHost,
        private onSilence?: () => void,
        options?: { silenceMs?: number, maxPromptJump?: number },
    ) {
        this.silenceMs = options?.silenceMs ?? DEFAULT_SILENCE_MS
        this.maxPromptJump = options?.maxPromptJump ?? DEFAULT_MAX_PROMPT_JUMP
    }

    get promptLength (): number {
        return this.promptLen
    }

    /**
     * @description 用户输入通知（挂 frontend.input$）：含 \r 时采集命令并请求提示符学习；
     *              其他输入取消挂起的学习（提示符行正在被编辑）
     * @param data 输入字节（UTF-8）
     * @returns void
     */
    notifyInput (data: Uint8Array): void {
        if (this.destroyed) {
            return
        }
        if (data.includes(0x0d)) {
            this.pendingRecord = this.collectCommand()
            this.awaitingPromptLearn = true
        } else {
            this.awaitingPromptLearn = false
        }
        this.scheduleSilence()
    }

    /**
     * @description shell 输出通知（挂 session.output$）：重置静默计时
     * @returns void
     */
    notifyOutput (): void {
        if (this.destroyed) {
            return
        }
        this.scheduleSilence()
    }

    /**
     * @description 当前输入行（buffer 现读 + 剥提示符）
     * @returns LogicalLine | null
     */
    getTypedLine (): LogicalLine | null {
        const line = this.host.readLine()
        return line ? stripPrompt(line, this.promptLen) : null
    }

    /**
     * @description 取走回车采集到的命令（一次性；空命令为 null）
     * @returns string | null
     */
    takeRecordedCommand (): string | null {
        const command = this.pendingRecord
        this.pendingRecord = null
        return command
    }

    destroy (): void {
        this.destroyed = true
        if (this.silenceTimer !== undefined) {
            clearTimeout(this.silenceTimer)
            this.silenceTimer = undefined
        }
    }

    private scheduleSilence (): void {
        if (this.silenceTimer !== undefined) {
            clearTimeout(this.silenceTimer)
        }
        this.silenceTimer = setTimeout(() => this.onSilent(), this.silenceMs)
    }

    private onSilent (): void {
        if (this.destroyed) {
            return
        }
        if (this.awaitingPromptLearn) {
            this.awaitingPromptLearn = false
            const prefix = this.host.readCursorPrefix()
            if (prefix !== null && Math.abs(prefix.length - this.promptLen) <= this.maxPromptJump) {
                this.promptLen = prefix.length
            }
        }
        this.onSilence?.()
    }

    /** 回车时刻采集命令：光标行 + 向上合并以 \ 结尾的续行，剥提示符后单行化 */
    private collectCommand (): string | null {
        const cursor = this.host.readLine()
        if (!cursor) {
            return null
        }
        const segments = [cursor.text]
        for (let up = 1; up <= 20; up++) {
            const above = this.host.readLineAbove(up)
            if (!above) {
                break
            }
            segments.unshift(above.text)
            if (!above.text.trimEnd().endsWith('\\')) {
                break
            }
        }
        const first = stripPrompt({ text: segments[0], cursorOffset: segments[0].length }, this.promptLen).text
        const merged = mergeContinuationLines([first, ...segments.slice(1)])
        return merged.trim() ? merged : null
    }
}
