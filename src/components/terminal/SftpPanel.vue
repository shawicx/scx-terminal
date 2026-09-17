<!--
  @description SSH 窗格内的 SFTP 文件面板（右侧抽屉）：目录浏览/导航、上传/下载（进度）、
              删除/重命名/新建目录。复用所属窗格已认证的 SSH 连接；会话断开自动报错关闭。
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowUp, File as FileIcon, Folder, FolderPlus, RefreshCw, Trash2, Upload, X } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import ContextMenu, { type ContextMenuItemSpec } from '@/components/ui/ContextMenu.vue'
import type { SftpFileEntry, TransferProgress } from '@/services/sftp'
import { closeSftp, openSftp, readSftpDir, sftpMkdir, sftpRemoveDir, sftpRemoveFile, sftpRename, sftpDownload, sftpUpload } from '@/services/sftp'

const props = defineProps<{
    /** 所属窗格的 SSH 会话 id（SshProxy.getID） */
    sshId: string
}>()

const emit = defineEmits<{
    (e: 'close'): void
}>()

const { t } = useI18n()
const sftpId = ref('')
const home = ref('')
const path = ref('')
const pathDraft = ref('')
const entries = ref<SftpFileEntry[]>([])
const loading = ref(false)
const error = ref('')
const selectedPath = ref<string | null>(null)
const transfers = ref<TransferProgress[]>([])

/** 本会话所有传输（done/error 后延时移除）的进度回调 */
function onTransferProgress (progress: TransferProgress): void {
    const index = transfers.value.findIndex(t => t.transferId === progress.transferId)
    if (index === -1) {
        transfers.value.push(progress)
    } else {
        transfers.value[index] = progress
    }
    if (progress.state === 'done') {
        setTimeout(() => {
            transfers.value = transfers.value.filter(t => t.transferId !== progress.transferId)
        }, 1200)
        void loadDir(currentDir())
    } else if (progress.state === 'error') {
        error.value = progress.error ?? 'transfer failed'
    }
}

function currentDir (): string {
    // 从当前路径取目录部分（跳转输入框允许指向文件时的容错）
    const trimmed = path.value.replace(/\/+$/, '') || '/'
    const slash = trimmed.lastIndexOf('/')
    return slash <= 0 ? '/' : trimmed.slice(0, slash)
}

function joinPath (dir: string, name: string): string {
    return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`
}

/**
 * @description 加载目录并列出条目
 * @param dir 远端目录绝对路径
 * @returns Promise<void>
 *
 */
async function loadDir (dir: string): Promise<void> {
    loading.value = true
    error.value = ''
    try {
        entries.value = await readSftpDir(sftpId.value, dir)
        path.value = dir
        pathDraft.value = dir
        selectedPath.value = null
    } catch (e) {
        error.value = String(e instanceof Error ? e.message : e)
    } finally {
        loading.value = false
    }
}

/**
 * @description 初始化：打开 SFTP 会话并进入远端主目录
 * @returns Promise<void>
 *
 */
async function init (): Promise<void> {
    try {
        const opened = await openSftp(props.sshId)
        sftpId.value = opened.id
        home.value = opened.home
        await loadDir(opened.home)
    } catch (e) {
        error.value = String(e instanceof Error ? e.message : e)
    }
}

function enterEntry (entry: SftpFileEntry): void {
    if (entry.isDir) {
        void loadDir(entry.path)
        return
    }
    // 文件双击 = 下载到用户选定位置
    void downloadEntry(entry)
}

function jumpToDraft (): void {
    const target = pathDraft.value.trim()
    if (target) {
        void loadDir(target)
    }
}

function goUp (): void {
    void loadDir(currentDir())
}

function refresh (): void {
    void loadDir(path.value)
}

async function downloadEntry (entry: SftpFileEntry): Promise<void> {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const localPath = await save({ defaultPath: entry.name })
    if (!localPath) {
        return
    }
    await sftpDownload(sftpId.value, entry.path, localPath, onTransferProgress)
}

async function uploadFiles (): Promise<void> {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const paths = await open({ multiple: true })
    if (!paths) {
        return
    }
    for (const localPath of Array.isArray(paths) ? paths : [paths]) {
        const name = localPath.split('/').pop() ?? localPath
        await sftpUpload(sftpId.value, localPath, joinPath(path.value, name), onTransferProgress)
    }
}

// ---- 新建目录 / 重命名：应用内弹窗（替代 window.prompt，与全局 Dialog 风格一致） ----
const prompt = ref<{ kind: 'mkdir' } | { kind: 'rename', entry: SftpFileEntry } | null>(null)
const promptValue = ref('')

const promptTitle = computed(() => prompt.value?.kind === 'rename' ? t('sftp.rename') : t('sftp.newDir'))
const promptPlaceholder = computed(() => prompt.value?.kind === 'rename' ? t('sftp.renamePrompt') : t('sftp.newDirPrompt'))

/**
 * @description 函数 ref：弹窗输入框挂载时立即聚焦（卸载时 el 为 null，忽略）
 * @param el 挂载/卸载的 input 元素
 * @returns void
 *
 */
function setPromptInput (el: unknown): void {
    if (el) {
        (el as HTMLInputElement).focus()
    }
}

/**
 * @description 打开「新建目录」弹窗（预填空值）
 * @returns void
 *
 */
function promptNewDir (): void {
    prompt.value = { kind: 'mkdir' }
    promptValue.value = ''
}

/**
 * @description 打开「重命名」弹窗（预填当前名称）
 * @param entry 目标条目
 * @returns void
 *
 */
function promptRename (entry: SftpFileEntry): void {
    prompt.value = { kind: 'rename', entry }
    promptValue.value = entry.name
}

/**
 * @description 提交目录/重命名弹窗：执行对应远端操作并刷新列表
 * @returns Promise<void>
 *
 */
async function commitPrompt (): Promise<void> {
    const current = prompt.value
    if (!current) {
        return
    }
    const name = promptValue.value.trim()
    prompt.value = null
    if (!name || (current.kind === 'rename' && name === current.entry.name)) {
        return
    }
    error.value = ''
    try {
        if (current.kind === 'mkdir') {
            await sftpMkdir(sftpId.value, joinPath(path.value, name))
        } else {
            await sftpRename(sftpId.value, current.entry.path, joinPath(path.value, name))
        }
        await loadDir(path.value)
    } catch (e) {
        error.value = String(e instanceof Error ? e.message : e)
    }
}

async function removeEntry (entry: SftpFileEntry): Promise<void> {
    // window.confirm 被 dialog 插件接管后转发到 plugin:dialog|confirm，该命令在插件 2.7+ 已并入 message，
    // 直接调用会被 ACL 拒绝（Command not found），必须走插件 JS API
    const { confirm } = await import('@tauri-apps/plugin-dialog')
    if (!(await confirm(t('sftp.deleteConfirm', { name: entry.name })))) {
        return
    }
    error.value = ''
    try {
        if (entry.isDir) {
            await sftpRemoveDir(sftpId.value, entry.path)
        } else {
            await sftpRemoveFile(sftpId.value, entry.path)
        }
        await loadDir(path.value)
    } catch (e) {
        error.value = String(e instanceof Error ? e.message : e)
    }
}

function menuItemsFor (entry: SftpFileEntry): ContextMenuItemSpec[] {
    const items: ContextMenuItemSpec[] = []
    if (!entry.isDir) {
        items.push({ key: 'download', label: t('sftp.download') })
    }
    items.push(
        { key: 'rename', label: t('sftp.rename') },
        { key: 'delete', label: t('sftp.delete'), danger: true, separatorBefore: true },
    )
    return items
}

function onMenuSelect (entry: SftpFileEntry, key: string): void {
    if (key === 'download') {
        void downloadEntry(entry)
    } else if (key === 'rename') {
        promptRename(entry)
    } else if (key === 'delete') {
        void removeEntry(entry)
    }
}

function formatSize (size: number | null): string {
    if (size === null) {
        return '—'
    }
    if (size < 1024) {
        return `${size} B`
    }
    const units = ['KB', 'MB', 'GB', 'TB']
    let value = size
    let unit = 'B'
    for (const next of units) {
        if (value < 1024) {
            break
        }
        value /= 1024
        unit = next
    }
    return `${value.toFixed(value >= 100 ? 0 : 1)} ${unit}`
}

function formatTime (mtimeMs: number | null): string {
    if (!mtimeMs) {
        return '—'
    }
    return new Date(mtimeMs).toLocaleString(undefined, {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
    })
}

function progressPercent (progress: TransferProgress): number {
    if (progress.total <= 0) {
        return progress.state === 'done' ? 100 : 0
    }
    return Math.min(100, Math.round((progress.done / progress.total) * 100))
}

function close (): void {
    if (sftpId.value) {
        void closeSftp(sftpId.value)
    }
    emit('close')
}

onMounted(() => {
    void init()
})

onBeforeUnmount(() => {
    if (sftpId.value) {
        void closeSftp(sftpId.value)
    }
})

defineExpose({ refresh })
</script>

<template>
    <div class="sftp-panel">
        <div class="sftp-toolbar">
            <Button variant="ghost" size="icon" class="h-8 w-8" :title="t('sftp.goUp')" @click="goUp">
                <ArrowUp :size="14" />
            </Button>
            <input
                v-model="pathDraft"
                class="sftp-path"
                spellcheck="false"
                @keydown.enter="jumpToDraft"
            />
            <Button variant="ghost" size="icon" class="h-8 w-8" :title="t('sftp.refresh')" @click="refresh">
                <RefreshCw :size="14" />
            </Button>
            <Button variant="ghost" size="icon" class="h-8 w-8" :title="t('sftp.close')" @click="close">
                <X :size="14" />
            </Button>
        </div>

        <p v-if="error" class="sftp-error">{{ error }}</p>

        <div class="sftp-list">
            <p v-if="loading" class="sftp-hint">{{ t('sftp.loading') }}</p>
            <p v-else-if="entries.length === 0" class="sftp-hint">{{ t('sftp.empty') }}</p>
            <ContextMenu
                v-for="entry in entries"
                v-else
                :key="entry.path"
                :items="menuItemsFor(entry)"
                @select="key => onMenuSelect(entry, key)"
            >
                <div
                    class="sftp-entry"
                    :class="{ selected: entry.path === selectedPath }"
                    @click="selectedPath = entry.path"
                    @dblclick="enterEntry(entry)"
                >
                    <Folder v-if="entry.isDir" class="sftp-entry-icon dir" :size="14" />
                    <FileIcon v-else class="sftp-entry-icon" :size="14" />
                    <span class="sftp-entry-name">{{ entry.name }}</span>
                    <span class="sftp-entry-meta sftp-entry-size">{{ entry.isDir ? '—' : formatSize(entry.size) }}</span>
                    <span class="sftp-entry-meta sftp-entry-time">{{ formatTime(entry.mtimeMs) }}</span>
                </div>
            </ContextMenu>
        </div>

        <div class="sftp-bottom">
            <div class="sftp-actions">
                <Button variant="ghost" size="sm" @click="uploadFiles">
                    <Upload :size="13" />
                    {{ t('sftp.upload') }}
                </Button>
                <Button variant="ghost" size="sm" @click="promptNewDir">
                    <FolderPlus :size="13" />
                    {{ t('sftp.newDir') }}
                </Button>
            </div>
            <div v-if="transfers.length > 0" class="sftp-transfers">
                <div v-for="transfer in transfers" :key="transfer.transferId" class="sftp-transfer">
                    <div class="sftp-transfer-head">
                        <span class="sftp-transfer-name">
                            {{ transfer.state === 'done' ? '✓' : '' }}
                            {{ transfer.path.split('/').pop() }}
                            <template v-if="transfer.state === 'progress'">{{ progressPercent(transfer) }}%</template>
                        </span>
                        <Trash2
                            v-if="transfer.state === 'error'"
                            class="sftp-transfer-dismiss"
                            :size="12"
                            @click="transfers = transfers.filter(t => t.transferId !== transfer.transferId)"
                        />
                    </div>
                    <div class="sftp-transfer-bar">
                        <div
                            class="sftp-transfer-fill"
                            :class="{ error: transfer.state === 'error' }"
                            :style="{ width: `${progressPercent(transfer)}%` }"
                        ></div>
                    </div>
                    <span v-if="transfer.state === 'error'" class="sftp-transfer-error">{{ transfer.error }}</span>
                </div>
            </div>
        </div>

        <Dialog v-if="prompt" :title="promptTitle" :width="380" @cancel="prompt = null">
            <input
                :ref="setPromptInput"
                v-model="promptValue"
                class="sftp-prompt-input"
                spellcheck="false"
                :placeholder="promptPlaceholder"
                @keydown.enter.prevent="commitPrompt"
            />
            <template #footer>
                <Button variant="outline" size="sm" @click="prompt = null">{{ t('sftp.cancel') }}</Button>
                <Button size="sm" @click="commitPrompt">{{ t('sftp.confirm') }}</Button>
            </template>
        </Dialog>
    </div>
</template>

<script lang="ts">
export default { name: 'SftpPanel' }
</script>

<style scoped>
.sftp-panel {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(400px, 60%);
    z-index: var(--z-side-panel);
    display: flex;
    flex-direction: column;
    background: var(--color-background);
    border-left: 1px solid var(--color-border);
    animation: 0.125s cubic-bezier(0, 0, 0.2, 1) sftpSlideIn;
}

@keyframes sftpSlideIn {
    from {
        transform: translateX(24px);
        opacity: 0;
    }
    to {
        transform: translateX(0);
        opacity: 1;
    }
}

@media (prefers-reduced-motion: reduce) {
    .sftp-panel {
        animation: none;
    }
}

.sftp-toolbar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px;
    border-bottom: 1px solid var(--color-border);
}

.sftp-path {
    flex: 1 1 0;
    min-width: 0;
    height: 32px;
    padding: 0 8px;
    border: 1px solid var(--color-input);
    border-radius: 6px;
    background: transparent;
    color: var(--color-foreground);
    font-family: var(--font-mono);
    font-size: 12px;
    outline: none;
}

.sftp-path:focus {
    border-color: var(--color-ring);
    box-shadow: 0 0 0 1px var(--color-ring);
}

.sftp-error {
    margin: 0;
    padding: 6px 10px;
    font-size: 12px;
    color: var(--color-destructive);
    border-bottom: 1px solid var(--color-border);
}

.sftp-list {
    flex: 1 1 0;
    min-height: 0;
    overflow-y: auto;
}

.sftp-hint {
    margin: 0;
    padding: 16px 10px;
    text-align: center;
    font-size: 12px;
    color: var(--color-muted-foreground);
}

.sftp-entry {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 10px;
    font-size: 12px;
    cursor: default;
    user-select: none;
}

.sftp-entry:hover {
    background: var(--color-accent);
}

.sftp-entry.selected {
    background: color-mix(in oklch, var(--color-primary) 14%, transparent);
}

.sftp-entry-icon {
    flex-shrink: 0;
    color: var(--color-muted-foreground);
}

.sftp-entry-icon.dir {
    color: var(--color-primary);
}

.sftp-entry-name {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* 大小/时间两列固定宽度右对齐，保证逐行对齐 */
.sftp-entry-meta {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--color-muted-foreground);
}

.sftp-entry-size {
    width: 56px;
    text-align: right;
}

.sftp-entry-time {
    width: 112px;
    text-align: right;
}

.sftp-bottom {
    border-top: 1px solid var(--color-border);
}

.sftp-actions {
    display: flex;
    gap: 4px;
    padding: 6px 8px;
}

.sftp-transfers {
    max-height: 140px;
    overflow-y: auto;
    padding: 0 8px 8px;
}

.sftp-transfer {
    margin-bottom: 8px;
}

.sftp-transfer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 11px;
}

.sftp-transfer-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-foreground);
}

.sftp-transfer-dismiss {
    color: var(--color-muted-foreground);
    cursor: default;
}

.sftp-transfer-bar {
    height: 3px;
    margin-top: 4px;
    border-radius: 2px;
    background: var(--color-border);
    overflow: hidden;
}

.sftp-transfer-fill {
    height: 100%;
    background: var(--color-primary);
    transition: width 0.2s ease;
}

.sftp-transfer-fill.error {
    background: var(--color-destructive);
}

.sftp-transfer-error {
    display: block;
    margin-top: 3px;
    font-size: 11px;
    color: var(--color-destructive);
    word-break: break-all;
}

.sftp-prompt-input {
    width: 100%;
    box-sizing: border-box;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--color-input);
    border-radius: 6px;
    background: transparent;
    color: var(--color-foreground);
    font-family: var(--font-mono);
    font-size: 13px;
    outline: none;
}

.sftp-prompt-input:focus {
    border-color: var(--color-ring);
    box-shadow: 0 0 0 1px var(--color-ring);
}
</style>
