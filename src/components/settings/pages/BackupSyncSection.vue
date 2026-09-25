<!--
  @description 配置备份页·云端同步区（S3 兼容 / MinIO）：表单/测试/保存/清除、
              状态展示、上传/恢复触发（口令弹窗与覆盖确认由父页承担，经 emit 通信）。
-->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Download, Eye, EyeOff, Upload } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Switch from '@/components/ui/Switch.vue'
import {
    getS3SyncConfig,
    setS3SyncConfig,
    clearS3SyncConfig,
    testS3SyncConnection,
    getS3SyncStatus,
    listRemoteSnapshots,
    type RemoteSnapshot,
    type S3SyncConfig,
    type SyncStatus,
} from '@/services/configSync'
import { confirmAction } from '@/components/settings/useConfirmAction'

const emit = defineEmits<{
    /** 请求口令弹窗（云端上传） */
    (e: 'request-push'): void
    /** 请求口令弹窗（云端恢复选定快照） */
    (e: 'request-pull', item: RemoteSnapshot): void
}>()

const { t } = useI18n()

const syncBusy = ref(false)
const syncError = ref('')
const syncNotice = ref('')
const syncForm = ref<S3SyncConfig>({
    endpoint: '',
    region: 'us-east-1',
    bucket: '',
    pathStyle: true,
    accessKey: '',
    secretKey: '',
})
const syncHasSecret = ref(false)
const syncStatus = ref<SyncStatus | null>(null)
const pullDialog = ref<null | { items: RemoteSnapshot[] }>(null)
const showSyncSecret = ref(false)

onMounted(() => {
    void refreshState()
})

defineExpose({
    refreshState,
    syncErrorMessage,
})

/**
 * @description 拉取云端同步配置与状态（进入配置备份分页时刷新）
 * @returns Promise<void>
 *
 */
async function refreshState (): Promise<void> {
    try {
        const view = await getS3SyncConfig()
        if (view) {
            syncForm.value = {
                endpoint: view.endpoint,
                region: view.region || 'us-east-1',
                bucket: view.bucket,
                pathStyle: view.pathStyle,
                accessKey: view.accessKey,
                secretKey: '',
            }
            syncHasSecret.value = view.hasSecretKey
        } else {
            syncForm.value = { endpoint: '', region: 'us-east-1', bucket: '', pathStyle: true, accessKey: '', secretKey: '' }
            syncHasSecret.value = false
        }
        syncStatus.value = await getS3SyncStatus()
    } catch (error) {
        syncError.value = syncErrorMessage(error)
    }
}

/** 配置表单可保存：endpoint/bucket/accessKey 必填；secretKey 已存则可留空 */
const syncFormValid = computed(() => {
    const form = syncForm.value
    return form.endpoint.trim() !== ''
        && form.bucket.trim() !== ''
        && form.accessKey.trim() !== ''
        && (syncHasSecret.value || form.secretKey.length > 0)
})

/**
 * @description 保存云端同步配置（secretKey 留空 = 沿用已存值由后端保持）
 * @returns Promise<void>
 *
 */
async function saveSyncConfig (): Promise<void> {
    if (!syncFormValid.value || syncBusy.value) {
        return
    }
    syncBusy.value = true
    syncError.value = ''
    syncNotice.value = ''
    try {
        await setS3SyncConfig(syncForm.value)
        syncNotice.value = t('settings.syncSaved')
        await refreshState()
    } catch (error) {
        syncError.value = syncErrorMessage(error)
    } finally {
        syncBusy.value = false
    }
}

/**
 * @description 测试连接（用当前表单值；secretKey 留空时后端沿用已存密钥）
 * @returns Promise<void>
 *
 */
async function runSyncTest (): Promise<void> {
    if (syncBusy.value) {
        return
    }
    syncBusy.value = true
    syncError.value = ''
    syncNotice.value = ''
    try {
        await testS3SyncConnection(syncForm.value)
        syncNotice.value = t('settings.syncTestOk')
    } catch (error) {
        syncError.value = syncErrorMessage(error)
    } finally {
        syncBusy.value = false
    }
}

/**
 * @description 清除云端同步配置（覆盖确认后执行）
 * @returns void
 *
 */
function clearSyncConfig (): void {
    confirmAction(t('settings.syncClearConfirmBody'), () => { void doClearSyncConfig() })
}

async function doClearSyncConfig (): Promise<void> {
    syncBusy.value = true
    syncError.value = ''
    syncNotice.value = ''
    try {
        await clearS3SyncConfig()
        syncNotice.value = t('settings.syncSaved')
        await refreshState()
    } catch (error) {
        syncError.value = syncErrorMessage(error)
    } finally {
        syncBusy.value = false
    }
}

/** 云端操作前置校验：未保存配置直接前端拦截 */
function requireSyncConfigured (): boolean {
    if (!syncHasSecret.value) {
        syncError.value = t('settings.syncErrNotConfigured')
        return false
    }
    syncError.value = ''
    return true
}

/**
 * @description 发起云端上传：口令弹窗（export 模式，s3 kind；由父页呈现）
 * @returns void
 *
 */
function startSyncPush (): void {
    if (syncBusy.value || !requireSyncConfigured()) {
        return
    }
    emit('request-push')
}

/**
 * @description 发起云端恢复：列出设备快照 → 选择 → 覆盖确认 → 口令弹窗
 * @returns Promise<void>
 *
 */
async function startSyncPull (): Promise<void> {
    if (syncBusy.value || !requireSyncConfigured()) {
        return
    }
    syncBusy.value = true
    syncError.value = ''
    try {
        const items = (await listRemoteSnapshots())
            .sort((a, b) => b.lastModified.localeCompare(a.lastModified))
        pullDialog.value = { items }
    } catch (error) {
        syncError.value = syncErrorMessage(error)
    } finally {
        syncBusy.value = false
    }
}

/**
 * @description 选定设备快照：关列表 → 覆盖确认 → 请求父页打开口令弹窗
 * @param item 选中的云端快照条目
 * @returns void
 *
 */
function chooseRemoteSnapshot (item: RemoteSnapshot): void {
    pullDialog.value = null
    confirmAction(t('settings.backupImportConfirmBody'), () => {
        emit('request-pull', item)
    })
}

/** 后端英文技术错误 → 用户文案映射（按 S3 错误码分诊） */
function syncErrorMessage (error: unknown): string {
    const raw = String(error instanceof Error ? error.message : error)
    if (raw.includes('failed to reach object storage')) {
        return t('settings.syncErrUnreachable')
    }
    if (raw.includes('SignatureDoesNotMatch')) {
        return t('settings.syncErrSignature')
    }
    if (raw.includes('InvalidAccessKeyId')) {
        return t('settings.syncErrAccessKey')
    }
    if (raw.includes('AccessDenied')) {
        return t('settings.syncErrAccessDenied')
    }
    if (raw.includes('RequestTimeTooSkewed')) {
        return t('settings.syncErrSkew')
    }
    if (raw.includes('rejected credentials')) {
        return t('settings.syncErrCredentials')
    }
    if (raw.includes('bucket not found')) {
        return t('settings.syncErrBucket')
    }
    if (raw.includes('object not found')) {
        return t('settings.syncErrObject')
    }
    if (raw.includes('not configured')) {
        return t('settings.syncErrNotConfigured')
    }
    return raw
}

/** 毫秒时间戳或 ISO 字符串 → 本地化时间（无效值显示 —） */
function formatSyncTime (value: string | number | null): string {
    if (value === null || value === '') {
        return '—'
    }
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

/** 字节数 → 人类可读（B/KB/MB） */
function formatBytes (size: number): string {
    if (size >= 1024 * 1024) {
        return `${(size / 1024 / 1024).toFixed(1)} MB`
    }
    if (size >= 1024) {
        return `${(size / 1024).toFixed(1)} KB`
    }
    return `${size} B`
}
</script>

<template>
    <div class="settings-section">
        <p class="settings-section-title">{{ t('settings.syncSectionTitle') }}</p>
        <div class="settings-card">
            <div class="settings-card-row stacked">
                <div class="settings-field">
                    <Label>{{ t('settings.syncEndpoint') }}</Label>
                    <Input
                        v-model="syncForm.endpoint"
                        :placeholder="t('settings.syncEndpointPlaceholder')"
                    />
                </div>
                <div class="settings-field">
                    <Label>{{ t('settings.syncRegion') }}</Label>
                    <Input v-model="syncForm.region" />
                </div>
                <div class="settings-field">
                    <Label>{{ t('settings.syncBucket') }}</Label>
                    <Input v-model="syncForm.bucket" />
                </div>
                <div class="settings-field">
                    <Label>{{ t('settings.syncAccessKey') }}</Label>
                    <Input v-model="syncForm.accessKey" autocomplete="off" />
                </div>
                <div class="settings-field">
                    <Label>{{ t('settings.syncSecretKey') }}</Label>
                    <div class="secret-input">
                        <Input
                            v-model="syncForm.secretKey"
                            :type="showSyncSecret ? 'text' : 'password'"
                            autocomplete="off"
                            :placeholder="syncHasSecret ? t('settings.syncSecretKeep') : ''"
                        />
                        <button
                            type="button"
                            class="secret-toggle"
                            :title="showSyncSecret ? t('settings.syncHideSecret') : t('settings.syncShowSecret')"
                            @click="showSyncSecret = !showSyncSecret"
                        >
                            <EyeOff v-if="showSyncSecret" :size="14" />
                            <Eye v-else :size="14" />
                        </button>
                    </div>
                </div>
                <div class="settings-field row">
                    <Label>{{ t('settings.syncPathStyle') }}</Label>
                    <Switch v-model="syncForm.pathStyle" />
                </div>
            </div>
            <div class="settings-card-row">
                <Label>{{ t('settings.syncActions') }}</Label>
                <div class="sync-actions">
                    <Button variant="outline" size="sm" :disabled="syncBusy" @click="runSyncTest">
                        {{ t('settings.syncTest') }}
                    </Button>
                    <Button variant="outline" size="sm" :disabled="syncBusy || !syncFormValid" @click="saveSyncConfig">
                        {{ t('settings.syncSave') }}
                    </Button>
                    <Button variant="ghost" size="sm" :disabled="syncBusy || !syncHasSecret" @click="clearSyncConfig">
                        {{ t('settings.syncClear') }}
                    </Button>
                </div>
            </div>
            <div class="settings-card-row">
                <Label>{{ t('settings.syncStatus') }}</Label>
                <div class="sync-status">
                    <span class="value-hint mono">
                        {{ syncStatus ? t('settings.syncDevice', { id: syncStatus.deviceId.slice(0, 8) }) : '…' }}
                    </span>
                    <span class="value-hint">{{ t('settings.syncLastPush') }} {{ formatSyncTime(syncStatus?.lastPushAt ?? null) }}</span>
                    <span class="value-hint">{{ t('settings.syncLastPull') }} {{ formatSyncTime(syncStatus?.lastPullAt ?? null) }}</span>
                </div>
            </div>
            <div class="settings-card-row">
                <Label>{{ t('settings.syncBackup') }}</Label>
                <div class="sync-actions">
                    <Button variant="outline" size="sm" :disabled="syncBusy" @click="startSyncPush">
                        <Upload :size="14" />
                        {{ t('settings.syncPush') }}
                    </Button>
                    <Button variant="outline" size="sm" :disabled="syncBusy" @click="startSyncPull">
                        <Download :size="14" />
                        {{ t('settings.syncPull') }}
                    </Button>
                </div>
            </div>
        </div>
        <p v-if="syncNotice" class="hint">{{ syncNotice }}</p>
        <p v-if="syncError" class="import-error">{{ syncError }}</p>
        <p class="hint">{{ t('settings.syncHint') }}</p>
    </div>

    <Dialog v-if="pullDialog" :title="t('settings.syncPullTitle')" :width="440" @cancel="pullDialog = null">
        <div class="sync-pull-list">
            <p v-if="pullDialog.items.length === 0" class="hint">{{ t('settings.syncPullEmpty') }}</p>
            <button
                v-for="item in pullDialog.items"
                :key="item.key"
                class="sync-pull-item"
                @click="chooseRemoteSnapshot(item)"
            >
                <span class="value-hint mono">{{ item.deviceId.slice(0, 8) }}</span>
                <span class="sync-pull-meta">
                    {{ formatSyncTime(item.lastModified) }} · {{ formatBytes(item.size) }}
                </span>
            </button>
        </div>
    </Dialog>
</template>

<style scoped>
.sync-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    min-width: 0;
}

.sync-status {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    justify-content: flex-end;
}

.sync-pull-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 260px;
    overflow-y: auto;
}

.sync-pull-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 10px;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: transparent;
    color: var(--color-foreground);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    transition: background-color 0.2s ease;
}

.sync-pull-item:hover {
    background: var(--color-accent);
}

.sync-pull-meta {
    color: var(--color-muted-foreground);
    font-size: 11px;
}

.secret-input {
    position: relative;
}

.secret-input :deep(input) {
    padding-right: 34px;
}

.secret-toggle {
    position: absolute;
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    padding: 5px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--color-muted-foreground);
    cursor: pointer;
    transition: color 0.2s ease;
}

.secret-toggle:hover {
    color: var(--color-foreground);
}
</style>
