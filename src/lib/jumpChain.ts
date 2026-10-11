/**
 * @description 跳板机（ProxyJump）链解析：按档案 jumpProfileId 引用递归展开为有序跳板
 *              参数列表（最外层跳板在前，目标主机前最后一跳在尾）。环检测、深度上限、
 *              引用合法性校验均为纯逻辑，连接前在前端完成（Rust 收到扁平列表直接逐跳建连）。
 */
import type { SshProfile } from '@/stores/config/types'

/** 跳板链解析错误（用户可读文案 key 化：调用方以 t('ssh.jumpErrors.xxx') 呈现） */
export type JumpChainError =
    | { kind: 'missing'; profileId: string }
    | { kind: 'notSsh'; profileId: string }
    | { kind: 'cycle'; profileId: string }
    | { kind: 'tooDeep' }
    | { kind: 'selfReference' }


/** 单个跳板参数（services/ssh.ts → Rust SshHop；id 由调用方按 `{最终id}:jump{i}` 生成） */
export interface JumpHop {
    profileId: string
    host: string
    port: number
    user: string
    auth: string
    keyId: string | null
}

/** 跳板链最大深度（对齐 OpenSSH 常见限制量级，防误配置递归） */
export const MAX_JUMP_DEPTH = 8

/**
 * @description 解析档案的跳板链：沿 jumpProfileId 引用从目标向外回溯，再反转为连接顺序
 * @param profile 目标 SSH 档案
 * @param profilesById 全部档案按 id 索引
 * @returns 跳板参数列表（连接顺序；空数组 = 直连）或错误
 *
 * @example resolveJumpChain(target, profilesById) // [{ profileId: 'p1', host: 'bastion', ... }]
 *
 */
export function resolveJumpChain (
    profile: SshProfile,
    profilesById: Map<string, SshProfile>
): { hops: JumpHop[] } | { error: JumpChainError } {
    // 从目标向外回溯收集，最后反转为「最外层 → 目标前一跳」连接顺序
    const chain: SshProfile[] = []
    const visited = new Set<string>([profile.id])
    let cursor: SshProfile | undefined = profile

    while (cursor?.jumpProfileId) {
        if (cursor.jumpProfileId === profile.id) {
            return { error: { kind: 'selfReference' } }
        }
        if (visited.has(cursor.jumpProfileId)) {
            return { error: { kind: 'cycle', profileId: cursor.jumpProfileId } }
        }
        if (chain.length >= MAX_JUMP_DEPTH) {
            return { error: { kind: 'tooDeep' } }
        }
        const jump = profilesById.get(cursor.jumpProfileId)
        if (!jump) {
            return { error: { kind: 'missing', profileId: cursor.jumpProfileId } }
        }
        if (jump.type !== 'ssh') {
            return { error: { kind: 'notSsh', profileId: jump.id } }
        }
        visited.add(jump.id)
        chain.push(jump)
        cursor = jump
    }

    const hops: JumpHop[] = chain
        .slice()
        .reverse()
        .map(jump => ({
            profileId: jump.id,
            host: jump.host,
            port: jump.port,
            user: jump.user,
            auth: jump.auth,
            keyId: jump.keyId
        }))
    return { hops }
}

/**
 * @description 跳板链解析错误 → 用户可读文本（与 Rust 连接错误文本同为英文中性表述，
 *              含档案名便于定位）
 * @param error 解析错误
 * @param profilesById 全部档案按 id 索引（取名）
 * @returns string 错误文本
 *
 * @example jumpChainErrorText({ kind: 'cycle', profileId: 'p1' }, profilesById)
 *
 */
export function jumpChainErrorText (error: JumpChainError, profilesById: Map<string, SshProfile>): string {
    const name = (id: string) => profilesById.get(id)?.name ?? id
    switch (error.kind) {
        case 'missing':
            return `referenced jump profile "${name(error.profileId)}" no longer exists`
        case 'notSsh':
            return `jump profile "${name(error.profileId)}" is not an SSH profile`
        case 'cycle':
            return `jump chain has a cycle at "${name(error.profileId)}"`
        case 'selfReference':
            return 'jump chain references the target profile itself'
        case 'tooDeep':
            return `jump chain exceeds the maximum depth of ${MAX_JUMP_DEPTH}`
    }
}

/**
 * @description 判断候选档案能否作为目标的跳板（排除自身与会经目标回到自身的引用，
 *              供档案表单下拉禁用项；双向检查避免编辑出环）
 * @param profile 目标 SSH 档案
 * @param candidate 候选跳板档案
 * @param profilesById 全部档案按 id 索引
 * @returns true = 可选
 *
 * @example canUseAsJump(target, candidate, profilesById)
 *
 */
export function canUseAsJump (
    profile: SshProfile,
    candidate: SshProfile,
    profilesById: Map<string, SshProfile>
): boolean {
    if (candidate.type !== 'ssh' || candidate.id === profile.id) {
        return false
    }
    // 候选自身链上出现目标 = 选中即成环
    const resolved = resolveJumpChain(candidate, profilesById)
    if ('error' in resolved) {
        return false
    }
    return !resolved.hops.some(hop => hop.profileId === profile.id)
        && candidate.jumpProfileId !== profile.id
}
