/**
 * @description 路径补全服务：本地经 Rust fs_list_dir（2 秒目录缓存），SSH 懒开独立
 *              SFTP 会话（不与 SFTP 面板共用）复用 sftp_read_dir，会话销毁时由调用方 close。
 */
import { invoke } from '@tauri-apps/api/core'
import type { DirEntry } from '@/lib/suggestions/suggestionEngine'
import { closeSftp, openSftp, readSftpDir } from './sftp'

const CACHE_MS = 2000
const localCache = new Map<string, { at: number, entries: DirEntry[] }>()

/**
 * @description 列本地目录（~ 前缀由 Rust 展开；错误静默为空数组；2 秒缓存）
 * @param dir 目录路径（可含 ~ 前缀）
 * @returns Promise<DirEntry[]> 目录条目
 *
 * @example await listLocalDir('~/Doc')
 *
 */
export async function listLocalDir (dir: string): Promise<DirEntry[]> {
    const cached = localCache.get(dir)
    if (cached && Date.now() - cached.at < CACHE_MS) {
        return cached.entries
    }
    try {
        const entries = await invoke<DirEntry[]>('fs_list_dir', { path: dir })
        localCache.set(dir, { at: Date.now(), entries })
        return entries
    } catch (error) {
        console.warn('fs_list_dir failed', error)
        return []
    }
}

/**
 * @description SSH 远端目录列表器：首次 list 时懒开 SFTP 会话并记录远端家目录，
 *              之后复用同一会话（单飞保护：并发首次 list 只开一次，close 会先等
 *              在途开启完成再关）；断线后 list 报错由引擎 catch 为空数组
 */
export class SshPathLister {
    private sftpId: string | null = null
    private _home: string | null = null
    private opening: Promise<string> | undefined

    constructor (private sshId: string) { }

    /** 远端家目录（首次 list 成功后可用；SSH cwd 无 OSC 上报时的路径基准） */
    get home (): string | null {
        return this._home
    }

    /**
     * @description 懒开 SFTP 会话并记录远端家目录（仅经 list 的单飞入口调用；
     *              结束时重置 opening：失败可于下次 list 重试，不残留已完结的 Promise）
     * @returns Promise<string> 会话 id
     */
    private async open (): Promise<string> {
        try {
            const opened = await openSftp(this.sshId)
            this.sftpId = opened.id
            this._home = opened.home
            return opened.id
        } finally {
            this.opening = undefined
        }
    }

    /**
     * @description 列远端目录（懒初始化 SFTP 会话，并发调用共享同一次开启；~ 前缀展开为
     *              远端家目录（spec §7），SFTP 协议本身不展开 ~；失败返回空数组）
     * @param dir 远端目录绝对路径（可含 ~ 前缀）
     * @returns Promise<DirEntry[]> 目录条目
     */
    async list (dir: string): Promise<DirEntry[]> {
        try {
            let id = this.sftpId
            if (!id) {
                id = await (this.opening ??= this.open())
            }
            // 开启失败时 _home 可能为 null：原样透传，由 readSftpDir 报错走 catch
            const expanded = this._home !== null && (dir === '~' || dir.startsWith('~/'))
                ? this._home + dir.slice(1)
                : dir
            return await readSftpDir(id, expanded)
        } catch (error) {
            console.warn('sftp path listing failed', error)
            return []
        }
    }

    /**
     * @description 关闭懒开的 SFTP 会话（窗格销毁时调用；先等在途开启完成再关，
     *              已关/未开静默）
     * @returns Promise<void>
     */
    async close (): Promise<void> {
        await this.opening?.catch(() => {})
        if (this.sftpId) {
            const id = this.sftpId
            this.sftpId = null
            await closeSftp(id).catch(() => {})
        }
    }
}
