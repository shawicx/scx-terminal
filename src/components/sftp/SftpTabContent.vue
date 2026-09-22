<!--
  @description SFTP 标签宿主（本地/远端双栏）：经连接注册表获取 SSH 连接（复用终端连接或
              后台 headless 建连）并打开 SFTP 会话；承载栏间指针拖拽（ghost + 落点高亮 +
              放下传输）、系统文件拖入（webview 级 onDragDropEvent）、同名冲突对话框
              （替换/跳过/应用到全部）与传输完成后的目录刷新。
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDownToLine, ArrowUpFromLine, Loader2 } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import { useConfigStore } from '@/stores/config'
import { useTransfersStore } from '@/stores/transfers'
import SftpBrowserPane, { type PaneOps } from '@/components/sftp/SftpBrowserPane.vue'
import { joinPanePath, type PaneEntry } from '@/lib/sftpPane'
import { browseLocalDir, localHomeDir } from '@/services/localFs'
import { closeSftp, openSftp, readSftpDir, sftpDownload, sftpMkdir, sftpRemoveDir, sftpRemoveFile, sftpRename, sftpUpload } from '@/services/sftp'
import {
    acquireConnection,
    connectionSources,
    isConnectionAlive,
    registryVersion,
    releaseConnection,
} from '@/services/sshConnections'

const props = defineProps<{
    tabId: string
    profileId: string
}>()

const { t } = useI18n()
const config = useConfigStore()
const transfersStore = useTransfersStore()

const profile = computed(() => config.store.profiles.find(p => p.id === props.profileId))

// ---- 连接状态：sshId（复用或 headless）→ sftp 会话 ----
const sshId = ref('')
const sftpId = ref('')
const remoteHome = ref('')
const localHome = ref('')
const status = ref<'connecting' | 'ready' | 'failed' | 'disconnected'>('connecting')
const connectError = ref('')

/**
 * @description 建立/重建连接：注册表获取 SSH 连接（窗格复用优先）→ 打开 SFTP 会话 →
 *              远端栏进入主目录
 * @returns Promise<void>
 *
 */
async function connect (): Promise<void> {
    status.value = 'connecting'
    connectError.value = ''
    try {
        sshId.value = await acquireConnection(props.profileId, props.tabId)
        const opened = await openSftp(sshId.value)
        sftpId.value = opened.id
        remoteHome.value = opened.home
        status.value = 'ready'
        remotePane.value?.setPath(opened.home)
    } catch (e) {
        status.value = 'failed'
        connectError.value = String(e instanceof Error ? e.message : e)
    }
}

// WKWebView 坑：长生命周期 watch 必须在 setup 同步流创建（await 之后创建的不触发）
watch(registryVersion, () => {
    if (sshId.value && status.value === 'ready' && !isConnectionAlive(props.profileId, sshId.value)) {
        status.value = 'disconnected'
    }
})

const connectionBadge = computed(() => {
    if (status.value !== 'ready') {
        return ''
    }
    return connectionSources[props.profileId] === 'pane'
        ? t('sftp.connectedViaPane')
        : t('sftp.connectedViaBackground')
})

// ---- 双栏 ----
const localPane = ref<InstanceType<typeof SftpBrowserPane>>()
const remotePane = ref<InstanceType<typeof SftpBrowserPane>>()

const localLister = (path: string): Promise<PaneEntry[]> => browseLocalDir(path)
const remoteLister = (path: string): Promise<PaneEntry[]> =>
    sftpId.value ? readSftpDir(sftpId.value, path) : Promise.resolve([])

const remoteOps: PaneOps = {
    rename: (from, to) => sftpRename(sftpId.value, from, to),
    mkdir: path => sftpMkdir(sftpId.value, path),
    removeEntry: async entry => {
        if (entry.isDir) {
            await sftpRemoveDir(sftpId.value, entry.path)
        } else {
            await sftpRemoveFile(sftpId.value, entry.path)
        }
    },
}

// ---- 栏间拖拽会话：pane 发起（阈值后），此处接管 ghost/落点判定/放下传输 ----
const dragEntries = ref<PaneEntry[]>([])
const dragging = ref(false)
const dragSourceSide = ref<'local' | 'remote'>('local')
const dragPos = ref({ x: 0, y: 0 })
const dropTarget = ref<{ side: 'local' | 'remote', dir: string | null } | null>(null)

function onDragMove (event: PointerEvent): void {
    dragPos.value = { x: event.clientX, y: event.clientY }
    const element = document.elementFromPoint(event.clientX, event.clientY)
    const zone = element?.closest<HTMLElement>('.sftp-pane[data-side]')
    if (zone && zone.dataset.side !== dragSourceSide.value) {
        const dirRow = element?.closest<HTMLElement>('[data-drop-dir]')
        dropTarget.value = { side: zone.dataset.side as 'local' | 'remote', dir: dirRow?.dataset.dropDir ?? null }
    } else {
        dropTarget.value = null
    }
}

function onDragUp (): void {
    cleanupDrag()
    const target = dropTarget.value
    if (target) {
        // 放下的目标目录 = 高亮目录行或对侧栏当前目录
        void startTransfer(dragEntries.value, target.side === 'remote' ? 'upload' : 'download', target.dir ?? undefined)
    }
    dragging.value = false
    dragEntries.value = []
    dropTarget.value = null
}

function cleanupDrag (): void {
    document.removeEventListener('pointermove', onDragMove)
    document.removeEventListener('pointerup', onDragUp)
}

function onRowDragstart (source: 'local' | 'remote', entries: PaneEntry[], event: PointerEvent): void {
    dragSourceSide.value = source
    dragEntries.value = entries
    dragging.value = true
    document.addEventListener('pointermove', onDragMove)
    document.addEventListener('pointerup', onDragUp)
    onDragMove(event)
}

const ghostLabel = computed(() => dragEntries.value.length === 1
    ? dragEntries.value[0]!.name
    : t('sftp.dragCount', { count: dragEntries.value.length }))

// ---- 系统文件拖入（webview 级 onDragDropEvent；WKWebView dataTransfer 无绝对路径） ----
const externalHover = ref(false)
let unlistenDragDrop: (() => void) | null = null

function pointInRemotePane (physicalX: number, physicalY: number): boolean {
    const el = remotePane.value?.rootElement()
    if (!el) {
        return false
    }
    const ratio = window.devicePixelRatio || 1
    const x = physicalX / ratio
    const y = physicalY / ratio
    const rect = el.getBoundingClientRect()
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

// ---- 传输：冲突检查（对侧栏现有条目名）→ 冲突对话框 → 入队 ----
const transferError = ref('')
const conflict = ref<{ entry: PaneEntry, remaining: number } | null>(null)
const conflictApplyAll = ref(false)
let conflictResolver: ((decision: ConflictDecision) => void) | null = null

type ConflictDecision = 'replace' | 'skip' | 'cancel' | 'all-replace' | 'all-skip'

/**
 * @description 弹出同名冲突对话框并等待决定（替换/跳过/取消；可应用到剩余全部冲突）
 * @param entry 冲突条目
 * @param remaining 剩余冲突数（含当前）
 * @returns Promise<ConflictDecision>
 *
 */
function askConflict (entry: PaneEntry, remaining: number): Promise<ConflictDecision> {
    return new Promise(resolve => {
        conflict.value = { entry, remaining }
        conflictApplyAll.value = false
        conflictResolver = resolve
    })
}

function resolveConflict (decision: 'replace' | 'skip' | 'cancel'): void {
    conflict.value = null
    const resolved: ConflictDecision = conflictApplyAll.value && decision !== 'cancel'
        ? `all-${decision}` as ConflictDecision
        : decision
    conflictResolver?.(resolved)
    conflictResolver = null
}

/**
 * @description 传输条目到对侧：逐条冲突检查（目标名已存在时询问，可选应用到全部），
 *              随后入队（上传 sftpUpload / 下载 sftpDownload，目录自动递归）
 * @param entries 源条目
 * @param direction upload=本地→远端；download=远端→本地
 * @param targetDir 可选目标目录（拖到目录行）；缺省 = 对侧栏当前目录
 * @returns Promise<void>
 *
 */
async function startTransfer (entries: PaneEntry[], direction: 'upload' | 'download', targetDir?: string): Promise<void> {
    if (!sftpId.value || entries.length === 0) {
        return
    }
    const targetPane = direction === 'upload' ? remotePane.value : localPane.value
    const base = targetDir ?? targetPane?.currentPath() ?? '/'
    const existing = new Set((targetPane?.entriesSnapshot() ?? []).map(entry => entry.name))
    const conflictCount = entries.filter(entry => existing.has(entry.name)).length
    let applyToAll: 'replace' | 'skip' | null = null
    let asked = 0
    transferError.value = ''
    for (const entry of entries) {
        if (existing.has(entry.name)) {
            if (applyToAll === 'skip') {
                continue
            }
            if (applyToAll === null) {
                asked += 1
                const decision = await askConflict(entry, conflictCount - asked + 1)
                if (decision === 'cancel') {
                    return
                }
                if (decision === 'all-replace') {
                    applyToAll = 'replace'
                } else if (decision === 'all-skip') {
                    applyToAll = 'skip'
                    continue
                } else if (decision === 'skip') {
                    continue
                }
            }
        }
        const target = joinPanePath(base, entry.name)
        try {
            if (direction === 'upload') {
                await sftpUpload(sftpId.value, entry.path, target)
            } else {
                await sftpDownload(sftpId.value, entry.path, target)
            }
        } catch (e) {
            transferError.value = String(e instanceof Error ? e.message : e)
        }
    }
}

function onPaneTransfer (source: 'local' | 'remote', entries: PaneEntry[], targetDir?: string): void {
    void startTransfer(entries, source === 'local' ? 'upload' : 'download', targetDir)
}

/**
 * @description 系统文件落入远端栏：按文件名冲突检查后逐个入队上传
 * @param paths 本地绝对路径列表（Tauri 拖放事件）
 * @returns Promise<void>
 *
 */
async function onExternalFiles (paths: string[]): Promise<void> {
    if (!sftpId.value || paths.length === 0) {
        return
    }
    const base = remotePane.value?.currentPath() ?? '/'
    const existing = new Set((remotePane.value?.entriesSnapshot() ?? []).map(entry => entry.name))
    transferError.value = ''
    for (const localPath of paths) {
        const name = localPath.split('/').pop() ?? localPath
        if (existing.has(name)) {
            const decision = await askConflict(
                { name, path: localPath, isDir: false, isSymlink: false, size: null, mtimeMs: null },
                paths.length,
            )
            if (decision === 'cancel') {
                return
            }
            if (decision === 'skip' || decision === 'all-skip') {
                continue
            }
        }
        try {
            await sftpUpload(sftpId.value, localPath, joinPanePath(base, name))
        } catch (e) {
            transferError.value = String(e instanceof Error ? e.message : e)
        }
    }
}

// ---- 传输完成后刷新两栏（仅终态迁移触发，进度事件不刷） ----
const knownStatuses = new Map<string, string>()
let refreshTimer: ReturnType<typeof setTimeout> | null = null

watch(() => transfersStore.version, () => {
    if (!sshId.value) {
        return
    }
    let terminal = false
    for (const transfer of transfersStore.transfers) {
        if (transfer.sshId !== sshId.value) {
            continue
        }
        const previous = knownStatuses.get(transfer.id)
        if (previous !== transfer.status && (transfer.status === 'done' || transfer.status === 'error')) {
            terminal = true
        }
        knownStatuses.set(transfer.id, transfer.status)
    }
    if (terminal) {
        if (refreshTimer !== null) {
            clearTimeout(refreshTimer)
        }
        refreshTimer = setTimeout(() => {
            refreshTimer = null
            localPane.value?.refresh()
            remotePane.value?.refresh()
        }, 300)
    }
})

onMounted(() => {
    void connect()
    void (async () => {
        localHome.value = await localHomeDir()
        localPane.value?.setPath(localHome.value)
    })()
    void (async () => {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview')
        unlistenDragDrop = await getCurrentWebview().onDragDropEvent(event => {
            const payload = event.payload
            if (payload.type === 'over') {
                externalHover.value = pointInRemotePane(payload.position.x, payload.position.y)
            } else if (payload.type === 'drop') {
                externalHover.value = false
                if (pointInRemotePane(payload.position.x, payload.position.y) && sftpId.value) {
                    void onExternalFiles(payload.paths)
                }
            } else {
                externalHover.value = false
            }
        })
    })()
})

onBeforeUnmount(() => {
    unlistenDragDrop?.()
    cleanupDrag()
    if (refreshTimer !== null) {
        clearTimeout(refreshTimer)
    }
    if (sftpId.value) {
        void closeSftp(sftpId.value).catch(() => {})
    }
    releaseConnection(props.profileId, props.tabId)
})
</script>

<template>
    <div class="sftp-tab">
        <header class="sftp-header">
            <span class="sftp-title">{{ profile?.name ?? props.profileId }}</span>
            <Loader2 v-if="status === 'connecting'" class="sftp-spinner" :size="13" />
            <span v-else-if="status === 'ready' && connectionBadge" class="conn-badge">{{ connectionBadge }}</span>
            <Button v-if="status === 'failed' || status === 'disconnected'" variant="outline" size="sm" @click="connect">
                {{ status === 'failed' ? t('terminal.retry') : t('sftp.reconnect') }}
            </Button>
            <span v-if="connectError" class="sftp-error-text">{{ connectError }}</span>
            <span v-if="transferError" class="sftp-error-text" :title="transferError">{{ transferError }}</span>
        </header>

        <div class="sftp-body">
            <SftpBrowserPane
                ref="localPane"
                side="local"
                :home-path="localHome"
                :lister="localLister"
                :ops="null"
                :drop-active="dropTarget?.side === 'local'"
                :drop-dir-path="dropTarget?.side === 'local' ? dropTarget.dir : null"
                @transfer="(entries, dir) => onPaneTransfer('local', entries, dir)"
                @row-dragstart="(entries, event) => onRowDragstart('local', entries, event)"
            />
            <SftpBrowserPane
                ref="remotePane"
                side="remote"
                :home-path="remoteHome"
                :lister="remoteLister"
                :ops="status === 'ready' ? remoteOps : null"
                :disabled="status !== 'ready'"
                :drop-active="dropTarget?.side === 'remote' || externalHover"
                :drop-dir-path="dropTarget?.side === 'remote' ? dropTarget.dir : null"
                @transfer="(entries, dir) => onPaneTransfer('remote', entries, dir)"
                @row-dragstart="(entries, event) => onRowDragstart('remote', entries, event)"
            />
            <div v-if="status === 'disconnected'" class="remote-overlay">
                <p class="remote-overlay-text">{{ t('sftp.disconnected') }}</p>
                <Button size="sm" @click="connect">{{ t('sftp.reconnect') }}</Button>
            </div>
        </div>

        <div v-if="dragging" class="drag-ghost" :style="{ left: `${dragPos.x + 12}px`, top: `${dragPos.y + 12}px` }">
            <ArrowUpFromLine v-if="dragSourceSide === 'local'" :size="12" />
            <ArrowDownToLine v-else :size="12" />
            <span>{{ ghostLabel }}</span>
        </div>

        <Dialog v-if="conflict" :title="t('sftp.conflictTitle')" :width="400" @cancel="resolveConflict('cancel')">
            <p class="conflict-body">{{ t('sftp.conflictBody', { name: conflict.entry.name }) }}</p>
            <label v-if="conflict.remaining > 1" class="conflict-apply-all">
                <input v-model="conflictApplyAll" type="checkbox" />
                {{ t('sftp.conflictApplyAll', { count: conflict.remaining - 1 }) }}
            </label>
            <template #footer>
                <Button variant="outline" size="sm" @click="resolveConflict('cancel')">{{ t('sftp.cancelTransfer') }}</Button>
                <Button variant="outline" size="sm" @click="resolveConflict('skip')">{{ t('sftp.conflictSkip') }}</Button>
                <Button size="sm" @click="resolveConflict('replace')">{{ t('sftp.conflictReplace') }}</Button>
            </template>
        </Dialog>
    </div>
</template>

<script lang="ts">
export default { name: 'SftpTabContent' }
</script>

<style scoped>
.sftp-tab {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--color-background);
}

.sftp-header {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 34px;
    padding: 4px 12px;
    border-bottom: 1px solid var(--color-border);
    user-select: none;
}

.sftp-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-foreground);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 280px;
    flex-shrink: 1;
}

.sftp-spinner {
    color: var(--color-muted-foreground);
    animation: sftp-spin 1s linear infinite;
}

@keyframes sftp-spin {
    to {
        transform: rotate(360deg);
    }
}

.conn-badge {
    padding: 1px 8px;
    border-radius: 999px;
    border: 1px solid var(--color-border);
    font-size: 11px;
    color: var(--color-muted-foreground);
    white-space: nowrap;
}

.sftp-error-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    color: var(--color-destructive);
}

.sftp-body {
    position: relative;
    flex: 1 1 0;
    min-height: 0;
    display: flex;
}

.remote-overlay {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 50%;
    z-index: var(--z-pane-overlay);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    background: color-mix(in oklch, var(--color-background) 82%, transparent);
}

.remote-overlay-text {
    margin: 0;
    font-size: 13px;
    color: var(--color-muted-foreground);
}

.drag-ghost {
    position: fixed;
    z-index: var(--z-drag-ghost, 1000);
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 6px;
    border: 1px solid var(--color-border);
    background: var(--color-popover);
    color: var(--color-popover-foreground);
    font-size: 12px;
    pointer-events: none;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    max-width: 260px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}

.conflict-body {
    margin: 0;
    font-size: 13px;
    word-break: break-all;
}

.conflict-apply-all {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 10px;
    font-size: 12px;
    color: var(--color-muted-foreground);
    cursor: pointer;
}
</style>
