<!--
  @description 全局传输中心（右下角 popover）：所有 SFTP 上传/下载任务的进度、速度（EMA）、
                ETA、取消与完成后的 Finder 定位；TitleBar 指示器点击唤起。数据来自
                transfers store（订阅 Rust `sftp-transfers-changed` 全量快照）。
-->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDownToLine, ArrowUpFromLine, Ban, Check, FolderSearch, Pause, Play, RotateCcw, X } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import { useTransfersStore } from '@/stores/transfers'
import { cancelTransfer, clearTransfers, pauseTransfer, resumeTransfer, retryTransfer, type TransferSnapshot } from '@/services/sftp'
import { transferCenterOpen } from '@/services/transferCenter'
import { etaSeconds, formatBytes, formatEta, formatSpeed } from '@/lib/sftpTransferMath'
import { panelEnter } from '@/lib/motion'

const { t } = useI18n()
const store = useTransfersStore()

const popoverEl = ref<HTMLDivElement>()

// 打开时从右下角弹性浮入（关闭仍瞬卸，保持轻量）
watch(transferCenterOpen, open => {
    if (open) {
        void nextTick(() => {
            if (popoverEl.value) {
                panelEnter(popoverEl.value, { from: 'bottom', overshoot: true })
            }
        })
    }
})

const rows = computed(() => store.transfers)

const activeCount = computed(() => store.activeTransfers.length)

function close (): void {
    transferCenterOpen.value = false
}

/**
 * @description 请求取消一条进行中/已暂停的传输（部分文件保留，可重试续传）
 * @param transfer 目标任务
 * @returns void
 *
 */
function onCancel (transfer: TransferSnapshot): void {
    void cancelTransfer(transfer.id).catch(() => {})
}

/**
 * @description 请求暂停一条排队/进行中的传输（部分文件保留在目标侧）
 * @param transfer 目标任务
 * @returns void
 *
 */
function onPause (transfer: TransferSnapshot): void {
    void pauseTransfer(transfer.id).catch(() => {})
}

/**
 * @description 继续一条已暂停的传输（从断点续传）
 * @param transfer 目标任务
 * @returns void
 *
 */
function onResume (transfer: TransferSnapshot): void {
    void resumeTransfer(transfer.id).catch(() => {})
}

/**
 * @description 重试一条失败/已取消的传输（已完成部分不重传）
 * @param transfer 目标任务
 * @returns void
 *
 */
function onRetry (transfer: TransferSnapshot): void {
    void retryTransfer(transfer.id).catch(() => {})
}

/**
 * @description 清除全部终态任务（后端同步移除，进行中任务不受影响）
 * @returns void
 *
 */
function onClearAll (): void {
    void clearTransfers(null).catch(() => {})
}

/**
 * @description 在 Finder 中定位已完成传输的本地文件
 * @param transfer 目标任务
 * @returns void
 *
 */
async function onReveal (transfer: TransferSnapshot): Promise<void> {
    const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
    void revealItemInDir(transfer.localPath).catch(() => {})
}

function percent (transfer: TransferSnapshot): number {
    if (transfer.totalBytes <= 0) {
        return transfer.status === 'done' ? 100 : 0
    }
    return Math.min(100, Math.round((transfer.transferredBytes / transfer.totalBytes) * 100))
}

function statusLabel (transfer: TransferSnapshot): string {
    switch (transfer.status) {
        case 'queued': return t('transfer.queued')
        case 'running': return `${percent(transfer)}%`
        case 'paused': return t('transfer.paused')
        case 'done': return t('transfer.done')
        case 'canceled': return t('transfer.canceled')
        case 'error': return t('transfer.failed')
    }
}

function etaLabel (transfer: TransferSnapshot): string {
    if (transfer.status !== 'running') {
        return ''
    }
    return formatEta(etaSeconds(transfer.transferredBytes, transfer.totalBytes, store.speeds[transfer.id] ?? null))
}
</script>

<template>
    <Teleport to="body">
        <div v-if="transferCenterOpen" class="transfer-backdrop" @mousedown.self="close">
            <div ref="popoverEl" class="transfer-popover">
                <div class="transfer-header">
                    <span class="transfer-title">{{ t('transfer.title') }}</span>
                    <span v-if="activeCount > 0" class="transfer-active-count">{{ t('transfer.activeCount', { count: activeCount }) }}</span>
                    <span class="transfer-header-actions">
                        <Button v-if="rows.length > 0" variant="ghost" size="sm" @click="onClearAll">
                            {{ t('transfer.clearAll') }}
                        </Button>
                        <button class="transfer-close" :title="t('sftp.cancel')" @click="close">
                            <X :size="13" />
                        </button>
                    </span>
                </div>
                <div class="transfer-list">
                    <p v-if="rows.length === 0" class="transfer-empty">{{ t('transfer.empty') }}</p>
                    <div v-for="transfer in rows" :key="transfer.id" class="transfer-row" :class="transfer.status">
                        <div class="transfer-row-head">
                            <ArrowUpFromLine v-if="transfer.kind === 'upload'" class="transfer-kind" :size="13" />
                            <ArrowDownToLine v-else class="transfer-kind" :size="13" />
                            <span class="transfer-name" :title="transfer.kind === 'upload' ? transfer.localPath : transfer.remotePath">
                                {{ transfer.fileName }}
                            </span>
                            <Check v-if="transfer.status === 'done'" class="transfer-state-icon ok" :size="13" />
                            <span class="transfer-status">{{ statusLabel(transfer) }}</span>
                            <template v-if="transfer.status === 'queued' || transfer.status === 'running'">
                                <button v-if="transfer.status === 'running'" class="transfer-action" :title="t('transfer.pause')" @click="onPause(transfer)">
                                    <Pause :size="12" />
                                </button>
                                <button class="transfer-action" :title="t('transfer.cancel')" @click="onCancel(transfer)">
                                    <Ban :size="12" />
                                </button>
                            </template>
                            <template v-else-if="transfer.status === 'paused'">
                                <button class="transfer-action" :title="t('transfer.resume')" @click="onResume(transfer)">
                                    <Play :size="12" />
                                </button>
                                <button class="transfer-action" :title="t('transfer.cancel')" @click="onCancel(transfer)">
                                    <Ban :size="12" />
                                </button>
                            </template>
                            <template v-else-if="transfer.status === 'error' || transfer.status === 'canceled'">
                                <button class="transfer-action" :title="t('transfer.retry')" @click="onRetry(transfer)">
                                    <RotateCcw :size="12" />
                                </button>
                            </template>
                            <template v-else-if="transfer.status === 'done'">
                                <button class="transfer-action" :title="t('transfer.reveal')" @click="onReveal(transfer)">
                                    <FolderSearch :size="12" />
                                </button>
                            </template>
                        </div>
                        <div class="transfer-bar">
                            <div
                                class="transfer-fill"
                                :class="{ indeterminate: transfer.status === 'running' && transfer.totalBytes <= 0, error: transfer.status === 'error' || transfer.status === 'canceled', paused: transfer.status === 'paused' }"
                                :style="{ width: transfer.totalBytes > 0 ? `${percent(transfer)}%` : undefined }"
                            ></div>
                        </div>
                        <div class="transfer-row-meta">
                            <span class="transfer-size">
                                {{ formatBytes(transfer.transferredBytes) }}<template v-if="transfer.totalBytes > 0"> / {{ formatBytes(transfer.totalBytes) }}</template>
                            </span>
                            <span v-if="transfer.status === 'running'" class="transfer-speed">{{ formatSpeed(store.speeds[transfer.id] ?? null) }}</span>
                            <span v-if="etaLabel(transfer)" class="transfer-eta">{{ t('transfer.eta', { time: etaLabel(transfer) }) }}</span>
                            <span v-if="transfer.error" class="transfer-error" :title="transfer.error">{{ transfer.error }}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<script lang="ts">
export default { name: 'TransferPopover' }
</script>

<style scoped>
.transfer-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
}

.transfer-popover {
    position: absolute;
    right: 16px;
    bottom: 16px;
    width: 400px;
    max-height: min(60vh, 480px);
    display: flex;
    flex-direction: column;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-popover);
    color: var(--color-popover-foreground);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
    overflow: hidden;
}

@media (prefers-reduced-motion: reduce) {
    .transfer-popover {
        animation: none;
    }
}

.transfer-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 8px 8px 12px;
    border-bottom: 1px solid var(--color-border);
    user-select: none;
}

.transfer-title {
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
    flex-shrink: 0;
}

.transfer-active-count {
    font-size: 11px;
    color: var(--color-muted-foreground);
}

.transfer-header-actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 2px;
}

.transfer-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--color-muted-foreground);
    cursor: pointer;
    transition: background-color 0.25s ease, color 0.25s ease;
}

.transfer-close:hover {
    background: var(--color-accent);
    color: var(--color-accent-foreground);
}

.transfer-list {
    flex: 1 1 0;
    min-height: 64px;
    overflow-y: auto;
    padding: 6px 10px;
}

.transfer-empty {
    margin: 0;
    padding: 24px 0;
    text-align: center;
    font-size: 12px;
    color: var(--color-muted-foreground);
}

.transfer-row {
    padding: 8px 4px;
    border-bottom: 1px solid var(--color-border);
}

.transfer-row:last-child {
    border-bottom: none;
}

.transfer-row-head {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    min-width: 0;
}

.transfer-kind {
    flex-shrink: 0;
    color: var(--color-muted-foreground);
}

.transfer-name {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.transfer-state-icon.ok {
    color: var(--color-primary);
    flex-shrink: 0;
}

.transfer-status {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--color-muted-foreground);
    font-variant-numeric: tabular-nums;
}

.transfer-row.error .transfer-status,
.transfer-row.canceled .transfer-status {
    color: var(--color-destructive);
}

/* 暂停态：琥珀色提示（无全局 warning token，局部取值） */
.transfer-row.paused .transfer-status {
    color: #d97706;
}

.transfer-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--color-muted-foreground);
    cursor: pointer;
    transition: background-color 0.25s ease, color 0.25s ease;
}

.transfer-action:hover {
    background: var(--color-accent);
    color: var(--color-accent-foreground);
}

.transfer-bar {
    height: 3px;
    margin-top: 6px;
    border-radius: 2px;
    background: var(--color-border);
    overflow: hidden;
}

.transfer-fill {
    height: 100%;
    background: var(--color-primary);
    transition: width 0.2s ease;
}

.transfer-fill.error {
    background: var(--color-destructive);
}

.transfer-fill.paused {
    background: #d97706;
}

/* 总量未知（目录统计中）：流光不定进度 */
.transfer-fill.indeterminate {
    width: 40%;
    animation: transferIndeterminate 1.2s ease-in-out infinite;
}

@keyframes transferIndeterminate {
    0% {
        transform: translateX(-100%);
    }
    100% {
        transform: translateX(280%);
    }
}

.transfer-row-meta {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-top: 4px;
    font-size: 11px;
    color: var(--color-muted-foreground);
    font-variant-numeric: tabular-nums;
}

.transfer-speed,
.transfer-eta {
    flex-shrink: 0;
}

.transfer-error {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-destructive);
}
</style>
