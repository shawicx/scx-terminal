/**
 * @description 路径补全的词级纯函数：当前词切分（dirname + basename 前缀）与空白路径引号包裹
 */

/**
 * @description 切分一个待补全的词；仅当词含 / 或以 ~ 开头时才算路径词
 * @param word 当前词文本
 * @returns object dir（含尾 /，支持 ~ 前缀）与 prefix（basename 前缀）；非路径词返回 null
 *
 * @example splitPathWord('~/Doc') // { dir: '~/', prefix: 'Doc' }
 *
 */
export function splitPathWord (word: string): { dir: string, prefix: string } | null {
    const lastSlash = word.lastIndexOf('/')
    if (lastSlash === -1) {
        if (word.startsWith('~')) {
            return { dir: '~/', prefix: '' }
        }
        return null
    }
    return { dir: word.slice(0, lastSlash + 1), prefix: word.slice(lastSlash + 1) }
}

/**
 * @description 含空白或单引号的补全结果用单引号包裹；内嵌单引号按 POSIX 口径转义为 '\''（闭引号 + 转义引号 + 重开引号），否则原样返回。
 *              仅作用于路径词的 basename 段——目录段保持未引用，POSIX 才能在词首展开 ~
 * @param text 补全后的路径段（basename）文本
 * @returns string 处理后的文本
 *
 * @example quotePathIfNeeded('My Files') // "'My Files'"
 *
 */
export function quotePathIfNeeded (text: string): string {
    if (!/\s/.test(text) && !text.includes('\'')) {
        return text
    }
    return `'${text.replace(/'/g, "'\\''")}'`
}
