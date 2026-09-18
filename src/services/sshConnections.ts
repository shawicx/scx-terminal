/**
 * @description SSH 连接注册表服务：SshConnectionRegistry 的 IO 接线——headless 建连走
 *              SshProxy（hostkey 确认经全局 pendingHostKey 供 App 层对话框呈现）、断连走
 *              ssh_kill；并维护档案级连接状态的 reactive 镜像（供 SFTP 标签/隧道管理器展示
 *              「复用终端连接 / 后台连接」徽标与断线重连）。registryVersion 在任何连接
 *              集合变化时自增，供组件 watch 后重算存活态。
 */
import { reactive, ref } from 'vue'
import { nanoid } from 'nanoid'
import { useConfigStore } from '@/stores/config'
import { SshProxy, type HostKeyChallenge, type KbdChallenge, type KbdAnswer } from '@/services/ssh'
import { setProfilePassword } from '@/services/secrets'
import { SshConnectionRegistry } from '@/lib/sshConnectionRegistry'

export type ProfileConnectionStatus = 'idle' | 'connecting' | 'connected' | 'failed'

/** 档案级连接状态镜像（key = profileId） */
export const connectionStates = reactive<Record<string, ProfileConnectionStatus>>({})
/** 连接来源（pane = 复用终端窗格连接；background = 后台 headless 连接） */
export const connectionSources = reactive<Record<string, 'pane' | 'background' | null>>({})
/** 最近一次连接错误文本（失败 banner 展示） */
export const connectionErrors = reactive<Record<string, string>>({})
/** 连接集合变化计数器（组件 watch 它后重算 isAlive 等派生态） */
export const registryVersion = ref(0)

/** 全局待确认的主机指纹（App 层 HostKeyDialog 呈现）与对应连接代理 */
export const pendingHostKey = ref<HostKeyChallenge | null>(null)
let pendingHostKeyProxy: SshProxy | null = null

/** 全局待应答的凭据挑战（App 层 CredentialDialog 呈现）与对应应答 resolver */
export const pendingKbdChallenge = ref<KbdChallenge | null>(null)
let pendingKbdResolver: ((answer: KbdAnswer | null) => void) | null = null

/** headless 连接的代理登记（disconnect 时 kill） */
const headlessProxies = new Map<string, SshProxy>()

let registry: SshConnectionRegistry

/**
 * @description 为档案建立 headless 连接（无 PTY；认证/指纹复用常规流程）。
 *              hostkey 事件挂起等待全局对话框应答；exit 事件同步注册表死亡登记。
 * @param profileId 档案 id
 * @returns Promise<string> sshId；档案不存在或连接失败 reject
 *
 */
async function connectHeadless (profileId: string): Promise<string> {
    const config = useConfigStore()
    const profile = config.store.profiles.find(p => p.id === profileId)
    if (!profile || profile.type !== 'ssh') {
        throw new Error(`ssh profile ${profileId} not found`)
    }
    connectionStates[profileId] = 'connecting'
    connectionErrors[profileId] = ''
    // kbd-interactive / 密码挑战：挂全局弹窗等应答；「记住」仅对单一密码型挑战生效，
    // 以最后一轮为准，连接成功后回存（见 start 成功分支）
    // 注：初值用 as 显式联合类型——闭包内赋值不参与 CFA，否则此处被收窄为 null
    let saveable = null as { remember: boolean, password: string } | null
    const proxy = new SshProxy()
    proxy.subscribe('hostkey', payload => {
        pendingHostKey.value = payload as HostKeyChallenge
        pendingHostKeyProxy = proxy
    })
    proxy.subscribe('exit', () => {
        headlessProxies.delete(proxy.getID())
        registry.noteHeadlessDead(proxy.getID())
        refreshMirror()
    })
    proxy.subscribe('kbdchallenge', payload => {
        const challenge = payload as KbdChallenge
        pendingKbdChallenge.value = challenge
        void (async () => {
            const answer = await new Promise<KbdAnswer | null>(resolve => {
                pendingKbdResolver = resolve
            })
            pendingKbdResolver = null
            if (answer && challenge.prompts.length === 1 && !challenge.prompts[0].echo) {
                saveable = { remember: answer.remember, password: answer.responses[0] ?? '' }
            } else {
                saveable = null
            }
            await proxy.respondKbd(answer ? answer.responses : null).catch(() => {})
        })()
    })
    try {
        await proxy.start({
            id: `ssh-${nanoid(10)}`,
            profileId: profile.id,
            host: profile.host,
            port: profile.port,
            user: profile.user,
            auth: profile.auth,
            keyId: profile.keyId,
            cols: 0,
            rows: 0,
            headless: true,
        })
    } catch (error) {
        // 连接失败：关闭可能残留的全局凭据弹窗（认证已终结）
        pendingKbdChallenge.value = null
        pendingKbdResolver?.(null)
        pendingKbdResolver = null
        connectionStates[profileId] = 'failed'
        connectionErrors[profileId] = String(error instanceof Error ? error.message : error)
        registryVersion.value += 1
        throw error
    }
    // 认证成功后按最后一轮「记住密码」回存；防御性关闭残留全局弹窗
    if (saveable?.remember) {
        void setProfilePassword(profileId, saveable.password).catch(() => {})
    }
    pendingKbdChallenge.value = null
    pendingKbdResolver?.(null)
    pendingKbdResolver = null
    headlessProxies.set(proxy.getID(), proxy)
    connectionStates[profileId] = 'connected'
    registryVersion.value += 1
    return proxy.getID()
}

function disconnectHeadless (sshId: string): void {
    const proxy = headlessProxies.get(sshId)
    headlessProxies.delete(sshId)
    proxy?.kill()
}

registry = new SshConnectionRegistry({
    connect: connectHeadless,
    disconnect: disconnectHeadless,
})

/** 由注册表重算档案级状态镜像（任何连接集合变化后调用） */
function refreshMirror (): void {
    const config = useConfigStore()
    for (const profile of config.store.profiles) {
        if (profile.type !== 'ssh') {
            continue
        }
        if (registry.hasPaneSessions(profile.id)) {
            connectionStates[profile.id] = 'connected'
            connectionSources[profile.id] = 'pane'
        } else if (registry.headlessSshIdFor(profile.id)) {
            connectionStates[profile.id] = 'connected'
            connectionSources[profile.id] = 'background'
        } else if (registry.isConnecting(profile.id)) {
            connectionStates[profile.id] = 'connecting'
            connectionSources[profile.id] = 'background'
        } else if (connectionStates[profile.id] !== 'failed') {
            connectionStates[profile.id] = 'idle'
            connectionSources[profile.id] = null
        }
    }
    registryVersion.value += 1
}

/**
 * @description 登记一条终端窗格会话（TerminalPane 连接成功后调用）
 * @param profileId 档案 id
 * @param sshId 会话 id
 * @returns void
 *
 * @example registerPaneSession(profile.id, session.sshSessionId)
 *
 */
export function registerPaneSession (profileId: string, sshId: string): void {
    registry.registerPaneSession(profileId, sshId)
    refreshMirror()
}

/**
 * @description 注销一条终端窗格会话（窗格关闭/会话退出后调用）
 * @param profileId 档案 id
 * @param sshId 会话 id
 * @returns void
 *
 */
export function unregisterPaneSession (profileId: string, sshId: string): void {
    registry.unregisterPaneSession(profileId, sshId)
    refreshMirror()
}

/**
 * @description 获取档案连接（窗格会话复用优先，否则 headless 建连）；
 *              与 release 成对使用（仅 headless 连接需要）
 * @param profileId 档案 id
 * @param consumerId 消费者 id（SFTP 标签用 tabId）
 * @returns Promise<string> sshId
 *
 * @example const sshId = await acquireConnection(profileId, tabId)
 *
 */
export async function acquireConnection (profileId: string, consumerId: string): Promise<string> {
    const sshId = await registry.acquire(profileId, consumerId)
    refreshMirror()
    return sshId
}

/**
 * @description 释放消费者（SFTP 标签关闭时调用；headless 归零后宽限断开）
 * @param profileId 档案 id
 * @param consumerId 消费者 id
 * @returns void
 *
 */
export function releaseConnection (profileId: string, consumerId: string): void {
    registry.release(profileId, consumerId)
    refreshMirror()
}

/**
 * @description 指定连接是否仍存活（配合 registryVersion watch 使用）
 * @param profileId 档案 id
 * @param sshId 连接 id
 * @returns boolean
 *
 */
export function isConnectionAlive (profileId: string, sshId: string): boolean {
    return registry.isAlive(profileId, sshId)
}

/**
 * @description 当前全部活跃连接 id（转发 store 按连接订阅 changed 事件用）
 * @returns string[]
 *
 * @example for (const id of knownSshIds()) { ... }
 *
 */
export function knownSshIds (): string[] {
    return registry.allSshIds()
}

/**
 * @description 连接 id → 归属档案 id（隧道管理器把运行态映射回档案/规则）
 * @param sshId 连接 id
 * @returns string | null 档案 id；未知连接为 null
 *
 */
export function profileIdForSshId (sshId: string): string | null {
    return registry.profileIdForSshId(sshId)
}

/**
 * @description 应答全局主机指纹确认（HostKeyGlobalDialog 按钮 → 待确认连接的 confirm）
 * @param accepted 是否信任该主机密钥
 * @returns void
 *
 */
export function resolvePendingHostKey (accepted: boolean): void {
    pendingHostKey.value = null
    void pendingHostKeyProxy?.confirmHostKey(accepted).catch(() => {})
    pendingHostKeyProxy = null
}

/**
 * @description 应答全局凭据挑战（App 层 CredentialDialog 按钮 → 待应答连接的 respond）
 * @param answer 弹窗应答；null = 取消
 * @returns void
 *
 * @example resolvePendingKbd({ responses: ['hunter2'], remember: true })
 *
 */
export function resolvePendingKbd (answer: KbdAnswer | null): void {
    pendingKbdChallenge.value = null
    pendingKbdResolver?.(answer)
    pendingKbdResolver = null
}
