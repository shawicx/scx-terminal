<!--
  @description 设置·关于页：应用图标/版本展示、配置与日志目录打开、调试开关、
              手动检查更新（下载进度 + 安装确认弹窗，成功后 relaunch）。
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { invoke } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
import { openPath } from '@tauri-apps/plugin-opener'
import type { Update } from '@tauri-apps/plugin-updater'
import { FolderOpen } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Label from '@/components/ui/Label.vue'
import Switch from '@/components/ui/Switch.vue'
import { useConfigStore } from '@/stores/config'
import { checkForUpdate, installUpdate, type UpdateProgress } from '@/services/updater'
import appIcon from '../../../../src-tauri/icons/icon.png'

const { t } = useI18n()
const config = useConfigStore()
const store = config.store

const configDir = ref('')
invoke<string>('config_dir_path').then(path => (configDir.value = path)).catch(() => {})

const logDir = ref('')
invoke<string>('debug_log_dir').then(path => (logDir.value = path)).catch(() => {})

/**
 * @description 打开调试日志目录（app-data/logs/，含 scx-terminal.log；opener 插件 open_path）
 * @returns Promise<void>
 *
 * @example await openLogDir() // 打开 ~/Library/Application Support/com.scx.terminal/logs
 *
 */
async function openLogDir (): Promise<void> {
    if (!logDir.value) {
        return
    }
    try {
        await openPath(logDir.value)
    } catch (error) {
        console.error('[settings] open log dir failed:', error)
        void invoke('dev_log', { message: `[settings] open log dir failed: ${String(error)}` }).catch(() => {})
    }
}

/**
 * @description 在 Finder 中打开配置数据目录（opener 插件 open_path，capabilities 已放行
 *              identifier 数据目录范围，config.db / secrets.db 所在）
 * @returns Promise<void>
 *
 * @example await openConfigDir() // 打开 ~/Library/Application Support/com.scx.terminal
 *
 */
async function openConfigDir (): Promise<void> {
    if (!configDir.value) {
        return
    }
    try {
        await openPath(configDir.value)
    } catch (error) {
        console.error('[settings] open config dir failed:', error)
        void invoke('dev_log', { message: `[settings] open config dir failed: ${String(error)}` }).catch(() => {})
    }
}

// ---- 关于页：自动更新（仅手动检查；成功安装后由服务 relaunch 重启） ----
const appVersion = ref('')
const updaterPhase = ref<'idle' | 'checking' | 'uptodate' | 'checkFailed' | 'downloading' | 'downloadFailed'>('idle')
const updateProgress = ref<UpdateProgress | null>(null)
const pendingUpdate = shallowRef<Update | null>(null)
let updaterRevertTimer = 0

getVersion().then(version => (appVersion.value = version)).catch(() => {})

const updaterBusy = computed(() => updaterPhase.value === 'checking' || updaterPhase.value === 'downloading')

const updaterButtonLabel = computed(() => {
    switch (updaterPhase.value) {
        case 'checking': return t('settings.updateChecking')
        case 'uptodate': return t('settings.updateUptodate')
        case 'checkFailed': return t('settings.updateError')
        case 'downloadFailed': return t('settings.updateDownloadFailed')
        case 'downloading': return updateProgress.value?.percent != null
            ? `${t('settings.updateDownloading')} ${updateProgress.value.percent}%`
            : t('settings.updateDownloading')
        default: return t('settings.checkUpdate')
    }
})

/** 瞬态结果（已是最新/失败）3s 后回到「检查更新」，避免按钮停留在过期状态 */
function revertUpdaterButton () {
    window.clearTimeout(updaterRevertTimer)
    updaterRevertTimer = window.setTimeout(() => {
        updaterPhase.value = 'idle'
    }, 3000)
}

/**
 * @description 手动检查更新：无更新/失败以按钮文案反馈 3s；有更新弹确认对话框
 * @returns Promise<void>
 *
 * @example await checkUpdates()
 *
 */
async function checkUpdates (): Promise<void> {
    if (updaterBusy.value) {
        return
    }
    updaterPhase.value = 'checking'
    try {
        const update = await checkForUpdate()
        if (update) {
            pendingUpdate.value = update
            updaterPhase.value = 'idle'
        } else {
            updaterPhase.value = 'uptodate'
            revertUpdaterButton()
        }
    } catch (error) {
        console.error('[settings] update check failed:', error)
        updaterPhase.value = 'checkFailed'
        revertUpdaterButton()
    }
}

/**
 * @description 确认安装：关闭对话框，按钮转为下载进度；成功后 relaunch 重启，
 *              失败停在「下载失败」3s
 * @returns Promise<void>
 *
 * @example await confirmUpdate()
 *
 */
async function confirmUpdate (): Promise<void> {
    const update = pendingUpdate.value
    if (!update) {
        return
    }
    pendingUpdate.value = null
    updaterPhase.value = 'downloading'
    updateProgress.value = null
    try {
        await installUpdate(update, progress => (updateProgress.value = progress))
    } catch (error) {
        console.error('[settings] update download failed:', error)
        updaterPhase.value = 'downloadFailed'
        revertUpdaterButton()
    }
}

onBeforeUnmount(() => window.clearTimeout(updaterRevertTimer))
</script>

<template>
    <div class="settings-page">
    <h2>{{ t('settings.about') }}</h2>
    <div class="about-hero">
        <img class="about-icon" :src="appIcon" alt="scx-terminal" />
        <div class="about-name">scx-terminal</div>
        <div class="about-version">v{{ appVersion || '…' }}</div>
    </div>
    <div class="settings-section">
        <div class="settings-card">
            <div class="settings-card-row">
                <Label>{{ t('settings.configDir') }}</Label>
                <div class="about-config">
                    <span class="value-hint mono about-config-path">{{ configDir }}</span>
                    <Button variant="ghost" size="sm" @click="openConfigDir">
                        <FolderOpen :size="14" />
                        {{ t('settings.openConfigDir') }}
                    </Button>
                </div>
            </div>
            <div class="settings-card-row">
                <Label>{{ t('settings.debugMode') }}</Label>
                <Switch v-model="store.advanced.debugEnabled" />
            </div>
            <div class="settings-card-row">
                <Label>{{ t('settings.logDir') }}</Label>
                <div class="about-config">
                    <span class="value-hint mono about-config-path">{{ logDir }}</span>
                    <Button variant="ghost" size="sm" @click="openLogDir">
                        <FolderOpen :size="14" />
                        {{ t('settings.openLogDir') }}
                    </Button>
                </div>
            </div>
            <div class="settings-card-row">
                <Label>{{ t('settings.appVersion') }}</Label>
                <Button variant="outline" size="sm" :disabled="updaterBusy" @click="checkUpdates">
                    {{ updaterButtonLabel }}
                </Button>
            </div>
        </div>
        <p class="hint">{{ t('settings.debugModeHint') }}</p>
    </div>

    <Dialog v-if="pendingUpdate" :title="t('settings.updateAvailableTitle')" :width="440" @cancel="pendingUpdate = null">
        <div class="update-confirm">
            <p class="update-version">v{{ pendingUpdate.version }}</p>
            <template v-if="pendingUpdate.body">
                <p class="update-notes-label">{{ t('settings.updateNotes') }}</p>
                <pre class="update-notes">{{ pendingUpdate.body }}</pre>
            </template>
        </div>
        <template #footer>
            <Button variant="outline" size="sm" @click="pendingUpdate = null">{{ t('settings.cancel') }}</Button>
            <Button size="sm" @click="confirmUpdate">{{ t('settings.updateInstall') }}</Button>
        </template>
    </Dialog>
    </div>
</template>

<style scoped>
/* 关于页：应用图标 + 名称 + 版本居中展示 */
.about-hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 28px 0 24px;
}

.about-icon {
    width: 76px;
    height: 76px;
    border-radius: 16px;
    margin-bottom: 6px;
}

.about-name {
    font-size: 16px;
    font-weight: 600;
}

.about-version {
    font-size: 12px;
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
}

.about-config {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    min-width: 0;
}

.about-config-path {
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* 更新确认对话框：版本号 + 可滚动更新说明 */
.update-confirm {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.update-version {
    margin: 0;
    font-weight: 600;
}

.update-notes-label {
    margin: 0;
    font-size: 12px;
    color: var(--color-muted-foreground);
}

.update-notes {
    margin: 0;
    padding: 8px;
    max-height: 200px;
    overflow: auto;
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    border: 1px solid var(--color-border);
    border-radius: 6px;
}
</style>
