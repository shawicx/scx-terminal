/**
 * @description SSH 密钥链与档案凭据的前端封装：Rust 加密存储（SQLite + AES-GCM，
 *              主密钥在系统钥匙串）的命令薄包装。私钥/口令/密码明文永不经过前端。
 */
import { invoke } from '@tauri-apps/api/core'

/** 密钥链条目元数据（私钥本体不出加密库） */
export interface SshKeyMeta {
    id: string
    name: string
    algorithm: string
    publicKey: string
    fingerprint: string
    comment: string
    createdAt: number
    hasPassphrase: boolean
}

export interface KeyGenerateOptions {
    id: string
    name: string
    algorithm: 'ed25519' | 'rsa'
    passphrase?: string | null
    comment?: string | null
}

export interface KeyImportOptions {
    id: string
    name: string
    /** 私钥内容（OpenSSH/PKCS8 PEM）；与 sourcePath 二选一 */
    content?: string | null
    /** 私钥文件绝对路径（拖放导入） */
    sourcePath?: string | null
    passphrase?: string | null
    comment?: string | null
}

/** key_inspect 返回：验证私钥推导出的元数据 */
export interface SshKeyInspection {
    publicKey: string
    fingerprint: string
    algorithm: string
}

/**
 * @description 验证私钥并推导元数据（不存储）——粘贴/修改私钥后调用，自动填充公钥
 * @param content 私钥内容
 * @param passphrase 加密私钥的口令（可空）
 * @returns Promise<SshKeyInspection>
 *
 * @example const inspection = await inspectSshKey(pem, passphrase)
 *
 */
export function inspectSshKey (content: string, passphrase?: string | null): Promise<SshKeyInspection> {
    return invoke<SshKeyInspection>('key_inspect', { content, passphrase })
}

/**
 * @description 应用内生成密钥对（私钥加密入库），返回公钥元数据
 * @param options id/name/algorithm/passphrase/comment
 * @returns Promise<SshKeyMeta>
 *
 * @example const meta = await generateSshKey({ id, name: 'work', algorithm: 'ed25519' })
 *
 */
export function generateSshKey (options: KeyGenerateOptions): Promise<SshKeyMeta> {
    return invoke<SshKeyMeta>('key_generate', { options })
}

/**
 * @description 导入私钥（content 或 sourcePath 二选一，加密钥须口令正确），加密入库
 * @param options id/name/content|sourcePath/passphrase/comment
 * @returns Promise<SshKeyMeta>
 *
 * @example const meta = await importSshKey({ id, name: 'ops', content })
 *
 */
export function importSshKey (options: KeyImportOptions): Promise<SshKeyMeta> {
    return invoke<SshKeyMeta>('key_import', { options })
}

/**
 * @description 列出密钥链条目元数据（按创建时间倒序）
 * @returns Promise<SshKeyMeta[]>
 *
 * @example const keys = await listSshKeys()
 *
 */
export function listSshKeys (): Promise<SshKeyMeta[]> {
    return invoke<SshKeyMeta[]>('key_list')
}

/**
 * @description 更新条目元数据（重命名/备注）
 * @param options id + 可选 name/comment
 * @returns Promise<void>
 *
 * @example await updateSshKey({ id, name: '新名字' })
 *
 */
export function updateSshKey (options: { id: string, name?: string, comment?: string }): Promise<void> {
    return invoke<void>('key_update', { options })
}

/**
 * @description 删除密钥链条目（私钥密文随行删除）
 * @param id 条目 id
 * @returns Promise<void>
 *
 * @example await deleteSshKey(id)
 *
 */
export function deleteSshKey (id: string): Promise<void> {
    return invoke<void>('key_delete', { id })
}

/**
 * @description 设置/覆盖档案密码（加密入库，按档案 id 引用）
 * @param profileId 档案 id
 * @param password 密码明文（仅在本次调用中传输）
 * @returns Promise<void>
 *
 * @example await setProfilePassword(profileId, password)
 *
 */
export function setProfilePassword (profileId: string, password: string): Promise<void> {
    return invoke<void>('cred_set_password', { profileId, password })
}

/**
 * @description 清除档案密码
 * @param profileId 档案 id
 * @returns Promise<void>
 *
 * @example await removeProfilePassword(profileId)
 *
 */
export function removeProfilePassword (profileId: string): Promise<void> {
    return invoke<void>('cred_remove', { profileId })
}

/**
 * @description 查询档案是否已设置密码（不返回内容）
 * @param profileId 档案 id
 * @returns Promise<boolean>
 *
 * @example if (await hasProfilePassword(profileId)) { ... }
 *
 */
export function hasProfilePassword (profileId: string): Promise<boolean> {
    return invoke<boolean>('cred_has_password', { profileId })
}
