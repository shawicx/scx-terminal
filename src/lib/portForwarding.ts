/**
 * @description 端口转发纯逻辑层：转发类型与数据模型（档案持久化规则 + 运行态）、
 *              规则归一化校验（sanitize，config 加载时清洗）、展示文案、autoStart
 *              规则筛选与规则 → 启动参数映射。IPC 封装见 services/forward.ts。
 */
import { nanoid } from 'nanoid'

/** 转发类型：local（-L）/ remote（-R）/ dynamic（-D SOCKS5） */
export type ForwardKind = 'local' | 'remote' | 'dynamic'

/** 档案持久化的转发规则（存 SshProfile.forwardings，对标 Tabby） */
export interface PortForwarding {
    id: string
    type: ForwardKind
    /** local/dynamic：本地绑定地址；remote：请求 server 监听的地址 */
    listenHost: string
    /** 0 = 自动分配（local/dynamic 由 OS 分配；remote 由 server 分配并回填） */
    listenPort: number
    /** local：远端侧目标；remote：本地侧目标；dynamic：null */
    targetHost: string | null
    targetPort: number | null
    /** 连接建立后自动启动 */
    autoStart: boolean
}

/** forward_start 参数（services/forward.ts → Rust ForwardOptions） */
export interface ForwardSpec {
    sshId: string
    kind: ForwardKind
    listenHost: string
    listenPort: number
    targetHost: string | null
    targetPort: number | null
    /** 来源规则 id（面板匹配用；临时转发为 null） */
    ruleId: string | null
}

/** 转发运行态（forward_start 返回 / forward_list / changed 事件快照） */
export interface ForwardState {
    id: string
    sshId: string
    kind: ForwardKind
    ruleId: string | null
    listenHost: string
    listenPort: number
    targetHost: string | null
    targetPort: number | null
    status: 'active' | 'failed'
    error: string | null
}

const KINDS: readonly ForwardKind[] = ['local', 'remote', 'dynamic']

/**
 * @description 判断是否合法转发类型
 * @param value 待检值
 * @returns boolean 是否为 local/remote/dynamic 之一
 *
 * @example isForwardKind('local') // true
 *
 */
export function isForwardKind (value: unknown): value is ForwardKind {
    return typeof value === 'string' && (KINDS as readonly string[]).includes(value)
}

/**
 * @description 归一化端口字段：0-65535 的整数；0 仅对监听端口合法（自动分配）
 * @param value 待检值
 * @param allowZero 是否允许 0（监听端口允许，目标端口不允许）
 * @returns number | null 合法端口；非法返回 null
 *
 * @example normalizePort(8080, true) // 8080
 *
 */
export function normalizePort (value: unknown, allowZero: boolean): number | null {
    const port = typeof value === 'number' ? Math.trunc(value) : Number.parseInt(String(value ?? ''), 10)
    if (!Number.isFinite(port)) {
        return null
    }
    if (port === 0) {
        return allowZero ? 0 : null
    }
    if (port < 1 || port > 65535) {
        return null
    }
    return port
}

/**
 * @description 归一化单条转发规则：类型白名单、监听地址默认 127.0.0.1、端口范围、
 *              local/remote 必填目标、dynamic 清空目标、autoStart 布尔化；非法条目返回 null
 * @param raw 原始规则（未知形状）
 * @returns PortForwarding | null 合法规则；不可修复的条目返回 null
 *
 * @example sanitizeForwarding({ type: 'local', listenPort: 8080, targetHost: 'db', targetPort: 5432 })
 *
 */
export function sanitizeForwarding (raw: unknown): PortForwarding | null {
    if (typeof raw !== 'object' || raw === null) {
        return null
    }
    const entry = raw as Record<string, unknown>
    const type = entry.type
    if (!isForwardKind(type)) {
        return null
    }
    const listenHost = typeof entry.listenHost === 'string' && entry.listenHost.trim() ? entry.listenHost.trim() : '127.0.0.1'
    const listenPort = normalizePort(entry.listenPort, true)
    if (listenPort === null) {
        return null
    }
    let targetHost: string | null = null
    let targetPort: number | null = null
    if (type !== 'dynamic') {
        targetHost = typeof entry.targetHost === 'string' ? entry.targetHost.trim() : ''
        targetPort = normalizePort(entry.targetPort, false)
        if (!targetHost || targetPort === null) {
            return null
        }
    }
    return {
        id: typeof entry.id === 'string' && entry.id ? entry.id : `fwd-${nanoid(8)}`,
        type,
        listenHost,
        listenPort,
        targetHost,
        targetPort,
        autoStart: entry.autoStart === true,
    }
}

/**
 * @description 归一化档案上的转发规则数组（config 加载清洗用）
 * @param raw 原始字段值（未知形状）
 * @returns PortForwarding[] | undefined 非数组/缺失返回 undefined（视为无该字段）；
 *          数组返回过滤后的合法条目（可为空）
 *
 * @example sanitizeForwardings(profile.forwardings)
 *
 */
export function sanitizeForwardings (raw: unknown): PortForwarding[] | undefined {
    if (!Array.isArray(raw)) {
        return undefined
    }
    return raw
        .map(entry => sanitizeForwarding(entry))
        .filter((entry): entry is PortForwarding => entry !== null)
}

/**
 * @description 转发展示文案：local/remote 为 `监听 → 目标`（语义由类型徽标补充），
 *              dynamic 为 `监听 (SOCKS5)`。接受规则（type 字段）与运行态（kind 字段）两种形态
 * @param forward 转发（规则或运行态的公共字段）
 * @returns string 展示串
 *
 * @example describeForward({ kind: 'local', listenHost: '127.0.0.1', listenPort: 8080, targetHost: 'db', targetPort: 5432 })
 *          // '127.0.0.1:8080 → db:5432'
 *
 */
export function describeForward (forward: {
    kind?: ForwardKind
    type?: ForwardKind
    listenHost: string
    listenPort: number
    targetHost: string | null
    targetPort: number | null
}): string {
    const kind = forward.kind ?? forward.type ?? 'local'
    const listen = `${forward.listenHost}:${forward.listenPort}`
    if (kind === 'dynamic') {
        return `${listen} · SOCKS5`
    }
    return `${listen} → ${forward.targetHost}:${forward.targetPort}`
}

/**
 * @description 筛选档案上 autoStart 的转发规则（连接建立后自动启动）
 * @param profile SSH 档案（或仅含 forwardings 的形状）
 * @returns PortForwarding[] 需自动启动的规则
 *
 * @example autoStartRules(profile).forEach(rule => startForward(ruleToSpec(sshId, rule)))
 *
 */
export function autoStartRules (profile: { forwardings?: PortForwarding[] | null }): PortForwarding[] {
    return (profile.forwardings ?? []).filter(rule => rule.autoStart)
}

/**
 * @description 档案规则 → forward_start 参数
 * @param sshId SSH 会话 id
 * @param rule 档案规则
 * @returns ForwardSpec 启动参数（携带 ruleId 供面板匹配）
 *
 * @example startForward(ruleToSpec(sshSessionId, rule))
 *
 */
export function ruleToSpec (sshId: string, rule: PortForwarding): ForwardSpec {
    return {
        sshId,
        kind: rule.type,
        listenHost: rule.listenHost,
        listenPort: rule.listenPort,
        targetHost: rule.targetHost,
        targetPort: rule.targetPort,
        ruleId: rule.id,
    }
}
