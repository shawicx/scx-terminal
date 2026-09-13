/**
 * @description 会话工厂：按配置档案 type（local/ssh）创建对应会话，
 *              供 TerminalPane 统一构造（消除对具体会话类型的硬编码）
 */
import { BaseSession, type BaseSessionOptions } from './baseSession'
import { LocalSession } from './localSession'
import { SshSession, type SshSessionSetup } from './sshSession'
import type { LocalProfile, SshProfile, TerminalProfile } from '@/stores/config'

/**
 * @description 按档案类型创建终端会话
 * @param profile 配置档案（local 或 ssh）
 * @param options 基础会话选项（中间件配置、剪贴板、SSH 指纹回调）
 * @returns BaseSession 会话实例（local → LocalSession，ssh → SshSession）
 *
 * @example createSessionForProfile(profile, { setClipboard })
 *
 */
export function createSessionForProfile (profile: TerminalProfile, options: BaseSessionOptions & Partial<SshSessionSetup>): BaseSession {
    if (profile.type === 'ssh') {
        return new SshSession(options)
    }
    return new LocalSession(options)
}

export type { LocalProfile, SshProfile }
export { LocalSession }
export { SshSession }
