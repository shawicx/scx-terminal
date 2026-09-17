/**
 * @description shell 历史文件解析（纯函数）：zsh EXTENDED_HISTORY 格式
 *              （`: <ts>:<dur>;<cmd>`，多行命令的续行不带时间戳前缀）与 bash 纯行格式。
 */

/** zsh 扩展格式行首：`: 1700000000:0;命令` */
const ZSH_EXTENDED = /^: (\d+):\d+;(.*)$/

/**
 * @description 解析 history 文件内容为命令条目
 * @param content 文件原始文本
 * @param style shell 风格（zsh 支持扩展格式回退纯行；bash 每行一条）
 * @returns object[] 命令与执行时间（秒级；bash/无时间戳为 0）
 *
 * @example parseShellHistory(': 1:0;ls\n', 'zsh') // [{ command: 'ls', runAt: 1 }]
 *
 */
export function parseShellHistory (content: string, style: 'zsh' | 'bash'): { command: string, runAt: number }[] {
    const lines = content.split('\n')
    const entries: { command: string, runAt: number }[] = []
    /** 上一条是否来自时间戳行：续行仅并入扩展格式的上一条，纯行之间互不合并 */
    let extendedEntry = false
    for (const line of lines) {
        if (!line.trim()) {
            continue
        }
        if (style === 'zsh') {
            const match = ZSH_EXTENDED.exec(line)
            if (match) {
                entries.push({ command: match[2], runAt: Number(match[1]) })
                extendedEntry = true
                continue
            }
            const last = entries[entries.length - 1]
            if (extendedEntry && last) {
                last.command += '\n' + line // 续行：并入上一条
                continue
            }
            entries.push({ command: line, runAt: 0 })
            extendedEntry = false
        } else {
            entries.push({ command: line, runAt: 0 })
        }
    }
    return entries.filter(entry => entry.command.trim().length > 0)
}
