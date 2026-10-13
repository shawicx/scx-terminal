/**
 * @description shell 单字参数安全引用：POSIX 单引号语义（'…' 内除单引号外无任何
 *              特殊字符，单引号以 '\'' 转义拼接），供文件侧栏向终端发送 cd 命令使用。
 */

/**
 * @description 把任意字符串引用为 shell 安全的单字（POSIX 单引号转义）
 * @param value 待引用的原始文本
 * @returns string 形如 'it'\''s' 的引用串
 *
 * @example shellQuoteSingle("/home/u/my dir") // "'/home/u/my dir'"
 * @example shellQuoteSingle("it's") // "'it'\\''s'"
 *
 */
export function shellQuoteSingle (value: string): string {
    return `'${value.replace(/'/g, "'\\''")}'`
}
