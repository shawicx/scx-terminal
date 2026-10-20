/**
 * @description cd 命令目标路径解析（纯逻辑）：从输入命令行文本解析出 cd 最终
 *              生效的目录绝对路径，供 SSH 文件面板跟随终端 cd。只做确定性解析——
 *              含变量/命令替换/通配符/上一次目录（cd -）等无法从文本得知结果的
 *              一律返回 null（面板保持原位，绝不猜错；字面路径最终由 SFTP 列
 *              目录验证兜底）。与 shellQuote 同属 shell 语义的保守子集实现。
 */

/** 命令段（由 ; && || 分隔的连续 token 序列） */
interface CommandSegment {
    tokens: string[]
}

/**
 * @description 词法切分命令行：识别单/双引号段（含空格的完整 token）与 ; && ||
 *              分隔符（引号内不切分）
 * @param line 命令行文本
 * @returns CommandSegment[] 按出现顺序的命令段
 *
 * @example tokenizeLine('cd /a && ls; cd /b') // 3 段
 *
 */
function tokenizeLine (line: string): CommandSegment[] {
    const segments: CommandSegment[] = [{ tokens: [] }]
    let current = ''
    let quoteChar = ''
    let inToken = false

    function endToken (): void {
        if (inToken) {
            segments[segments.length - 1]!.tokens.push(current)
            current = ''
            inToken = false
        }
    }

    for (let i = 0; i < line.length; i++) {
        const char = line[i]!
        if (quoteChar) {
            if (char === quoteChar) {
                quoteChar = ''
            } else if (char !== '\n') {
                current += char
            }
            continue
        }
        if (char === '\'' || char === '"') {
            // 引号开启：已有裸段内容（如 abc'def'）继续累积为同一 token
            inToken = true
            quoteChar = char
            continue
        }
        if (char === ' ' || char === '\t') {
            endToken()
            continue
        }
        if (char === ';') {
            endToken()
            segments.push({ tokens: [] })
            continue
        }
        if ((char === '&' && line[i + 1] === '&') || (char === '|' && line[i + 1] === '|')) {
            endToken()
            segments.push({ tokens: [] })
            i++
            continue
        }
        inToken = true
        current += char
    }
    endToken()
    return segments
}

/**
 * @description 归并远端 POSIX 路径：消解 '.' 与 '..'（根下 '..' 留在根）
 * @param path 任意形态路径
 * @returns string 归并后的绝对路径（空输入回退 '/'）
 *
 * @example normalizeRemotePath('/var/log/../lib') // '/var/lib'
 *
 */
export function normalizeRemotePath (path: string): string {
    const stack: string[] = []
    for (const part of path.split('/')) {
        if (!part || part === '.') {
            continue
        }
        if (part === '..') {
            stack.pop()
            continue
        }
        stack.push(part)
    }
    return `/${stack.join('/')}`
}

/**
 * @description 解析命令行中 cd 最终生效的目标目录（取最后一个 cd 段——多命令
 *              顺序执行后只有最后一个 cd 的结果保留）
 * @param line 输入命令行文本
 * @param base 相对路径解析基准（面板当前路径）
 * @param home 远端用户主目录（cd 无参 / ~ 用；null 时这两类放弃）
 * @returns string | null 目标目录绝对路径；无法确定性解析时 null
 *
 * @example resolveCdTarget('cd ../logs', '/var', null) // '/logs'
 * @example resolveCdTarget('cd $HOME', '/tmp', '/root') // null（变量不可知）
 *
 */
export function resolveCdTarget (line: string, base: string | null, home: string | null): string | null {
    const segments = tokenizeLine(line)
    for (let index = segments.length - 1; index >= 0; index--) {
        const tokens = segments[index]!.tokens
        if (tokens[0] !== 'cd') {
            continue
        }
        // 跳过 '--'（cd -- <path>；本应用面板导航即发送此形态）
        const target = tokens[1] === '--' ? tokens[2] : tokens[1]
        // cd 无参数 = 回主目录
        if (target === undefined) {
            return home
        }
        if (/[$`*?]/.test(target)) {
            return null // 变量/命令替换/通配符结果不可知
        }
        if (target === '-') {
            return null // 上一次目录不可知
        }
        if (target === '~') {
            return home
        }
        if (target.startsWith('~/')) {
            return home ? normalizeRemotePath(`${home}/${target.slice(2)}`) : null
        }
        if (target.startsWith('~')) {
            return null // ~user 形式的主目录不可知
        }
        if (target.startsWith('/')) {
            return normalizeRemotePath(target)
        }
        return base ? normalizeRemotePath(`${base}/${target}`) : null
    }
    return null
}
