<!--
  @description 设置·配置备份页：本地导出/导入卡片 + 口令弹窗（本地/云端四种模式共用）+
              云端同步区（BackupSyncSection 子组件，经 ref 触发状态刷新）。
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Download, Upload } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import BackupSyncSection from '@/components/settings/pages/BackupSyncSection.vue'
import { exportConfigBackup, importConfigBackup } from '@/services/configBackup'
import {
    pushBackupToCloud,
    pullRemoteSnapshot,
    type RemoteSnapshot,
} from '@/services/configSync'
import { useConfigStore } from '@/stores/config'
import { confirmAction } from '@/components/settings/useConfirmAction'

const { t } = useI18n()
const config = useConfigStore()

const syncSection = ref<InstanceType<typeof BackupSyncSection> | null>(null)

// ---- 配置备份（本地导出/导入）----

const backupBusy = ref(false)
const backupError = ref('')
const backupNotice = ref('')
const passphraseDialog = ref<null | {
    mode: 'export' | 'import'
    kind: 'local' | 's3'
    /** 本地文件路径（kind=local） */
    path?: string
    /** 云端对象键（kind=s3 且 mode=import） */
    key?: string
    passphrase: string
    confirm: string
}>(null)

/**
 * @description 生成默认备份文件名 scx-terminal-backup-YYYYMMDD-HHmmss.json
 * @returns string 文件名
 *
 */
function backupDefaultName (): string {
    const now = new Date()
    const pad = (value: number) => String(value).padStart(2, '0')
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    return `scx-terminal-backup-${stamp}.json`
}

/**
 * @description 发起导出：保存对话框选路径 → 打开口令弹窗（设置 + 确认两次输入）
 * @returns Promise<void>
 *
 */
async function startBackupExport (): Promise<void> {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const path = await save({
        defaultPath: backupDefaultName(),
        filters: [{ name: 'scx-terminal backup', extensions: ['json'] }],
    })
    if (typeof path !== 'string') {
        return
    }
    backupError.value = ''
    backupNotice.value = ''
    passphraseDialog.value = { mode: 'export', kind: 'local', path, passphrase: '', confirm: '' }
}

/**
 * @description 发起导入：文件选择 → 覆盖确认 → 口令弹窗
 * @returns Promise<void>
 *
 */
async function startBackupImport (): Promise<void> {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const picked = await open({
        multiple: false,
        filters: [{ name: 'scx-terminal backup', extensions: ['json'] }],
    })
    if (typeof picked !== 'string') {
        return
    }
    backupError.value = ''
    backupNotice.value = ''
    confirmAction(t('settings.backupImportConfirmBody'), () => {
        passphraseDialog.value = { mode: 'import', kind: 'local', path: picked, passphrase: '', confirm: '' }
    })
}

/** 口令弹窗可提交：导出需 ≥8 字符且两次一致；导入需非空 */
const passphraseValid = computed(() => {
    const dialog = passphraseDialog.value
    if (!dialog) {
        return false
    }
    if (dialog.mode === 'export') {
        return dialog.passphrase.length >= 8 && dialog.passphrase === dialog.confirm
    }
    return dialog.passphrase.length > 0
})

/** 口令弹窗标题（本地导出/导入与云端上传/恢复区分） */
const passphraseDialogTitle = computed(() => {
    const dialog = passphraseDialog.value
    if (!dialog) {
        return ''
    }
    if (dialog.kind === 's3') {
        return dialog.mode === 'export'
            ? t('settings.syncPushTitle')
            : t('settings.backupImportTitle')
    }
    return dialog.mode === 'export' ? t('settings.backupExportTitle') : t('settings.backupImportTitle')
})

/** 口令弹窗确认按钮文案 */
const passphraseDialogAction = computed(() => {
    const dialog = passphraseDialog.value
    if (!dialog) {
        return ''
    }
    return dialog.mode === 'export' ? t('settings.backupExportAction') : t('settings.backupImportAction')
})

/**
 * @description 提交口令弹窗：按 kind/mode 执行本地导出导入或云端上传恢复；导入成功后重载配置并提示重启
 * @returns Promise<void>
 *
 */
async function commitBackupPassphrase (): Promise<void> {
    const dialog = passphraseDialog.value
    if (!dialog || !passphraseValid.value || backupBusy.value) {
        return
    }
    backupBusy.value = true
    backupError.value = ''
    try {
        if (dialog.kind === 'local' && dialog.mode === 'export') {
            const summary = await exportConfigBackup(dialog.path ?? '', dialog.passphrase)
            backupNotice.value = t('settings.backupExportDone', {
                p: summary.profileCount,
                q: summary.quickCommandCount,
                k: summary.sshKeyCount,
            })
        } else if (dialog.kind === 'local') {
            await importConfigBackup(dialog.path ?? '', dialog.passphrase)
            await config.load()
            backupNotice.value = t('settings.backupImportDone')
        } else if (dialog.mode === 'export') {
            const result = await pushBackupToCloud(dialog.passphrase)
            backupNotice.value = t('settings.syncPushDone', { size: formatBytes(result.size) })
            void syncSection.value?.refreshState()
        } else {
            await pullRemoteSnapshot(dialog.key ?? '', dialog.passphrase)
            await config.load()
            backupNotice.value = t('settings.backupImportDone')
            void syncSection.value?.refreshState()
        }
        passphraseDialog.value = null
    } catch (error) {
        backupError.value = dialog.kind === 's3'
            ? syncSection.value?.syncErrorMessage(error) ?? String(error)
            : String(error instanceof Error ? error.message : error)
    } finally {
        backupBusy.value = false
    }
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

/** 云端恢复选定快照：打开口令弹窗（import 模式，携带对象键） */
function onSyncPullRequest (item: RemoteSnapshot): void {
    backupError.value = ''
    backupNotice.value = ''
    passphraseDialog.value = { mode: 'import', kind: 's3', key: item.key, passphrase: '', confirm: '' }
}
</script>

<template>
    <div class="settings-page">
    <h2>{{ t('settings.backupPage') }}</h2>
    <p class="hint">{{ t('settings.backupHint') }}</p>
    <div class="settings-section">
        <div class="settings-card">
            <div class="settings-card-row">
                <Label>{{ t('settings.backupExportLabel') }}</Label>
                <Button variant="outline" size="sm" :disabled="backupBusy" @click="startBackupExport">
                    <Download :size="14" />
                    {{ t('settings.backupExportAction') }}
                </Button>
            </div>
            <div class="settings-card-row">
                <Label>{{ t('settings.backupImportLabel') }}</Label>
                <Button variant="outline" size="sm" :disabled="backupBusy" @click="startBackupImport">
                    <Upload :size="14" />
                    {{ t('settings.backupImportAction') }}
                </Button>
            </div>
        </div>
        <p v-if="backupNotice" class="hint">{{ backupNotice }}</p>
        <p v-if="backupError" class="import-error">{{ backupError }}</p>
        <p class="hint">{{ t('settings.backupSecurityHint') }}</p>
    </div>

    <BackupSyncSection
        ref="syncSection"
        @request-push="backupError = ''; backupNotice = ''; passphraseDialog = { mode: 'export', kind: 's3', passphrase: '', confirm: '' }"
        @request-pull="onSyncPullRequest"
    />

    <Dialog
        v-if="passphraseDialog"
        :title="passphraseDialogTitle"
        :width="380"
        @cancel="passphraseDialog = null"
    >
        <div class="backup-passphrase-form">
            <Label>{{ t('settings.backupPassphraseLabel') }}</Label>
            <Input
                v-model="passphraseDialog.passphrase"
                type="password"
                autocomplete="off"
                @keydown.enter.prevent="commitBackupPassphrase"
            />
            <template v-if="passphraseDialog.mode === 'export'">
                <Label>{{ t('settings.backupPassphraseConfirm') }}</Label>
                <Input
                    v-model="passphraseDialog.confirm"
                    type="password"
                    autocomplete="off"
                    @keydown.enter.prevent="commitBackupPassphrase"
                />
            </template>
            <p class="hint">{{ t('settings.backupPassphraseHint') }}</p>
        </div>
        <template #footer>
            <Button variant="outline" size="sm" :disabled="backupBusy" @click="passphraseDialog = null">{{ t('settings.cancel') }}</Button>
            <Button size="sm" :disabled="!passphraseValid || backupBusy" @click="commitBackupPassphrase">
                {{ passphraseDialogAction }}
            </Button>
        </template>
    </Dialog>
    </div>
</template>

<style scoped>
.backup-passphrase-form {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
</style>
