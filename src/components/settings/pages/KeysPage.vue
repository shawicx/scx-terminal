<!--
  @description 设置·密钥链页：SSH 密钥条目主从管理（生成 / 粘贴或拖放导入 / 重命名 /
              删除），私钥明文不出库；拖放走 Tauri webview 事件。
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { nanoid } from 'nanoid'
import { Copy, Plus, Trash2, Upload } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Select from '@/components/ui/Select.vue'
import { getCurrentWebview, type DragDropEvent } from '@tauri-apps/api/webview'
import type { Event as TauriEvent, UnlistenFn } from '@tauri-apps/api/event'
import type { SshKeyMeta, SshKeyInspection } from '@/services/secrets'
import { generateSshKey, importSshKey, inspectSshKey, listSshKeys, updateSshKey, deleteSshKey } from '@/services/secrets'
import { useConfigStore } from '@/stores/config'
import { writeClipboardText } from '@/lib/frontendContext'
import { confirmAction } from '@/components/settings/useConfirmAction'

const { t } = useI18n()
const config = useConfigStore()
const store = config.store

const sshKeys = ref<SshKeyMeta[]>([])
const selectedKeyId = ref<string | null>(null)
const selectedKey = computed(() => sshKeys.value.find(key => key.id === selectedKeyId.value) ?? null)

/**
 * @description 复制密钥条目公钥到剪贴板（公钥非敏感，可直接展示）
 * @param key 条目元数据
 * @returns void
 *
 */
function copyKeyPublic (key: SshKeyMeta): void {
    void writeClipboardText(key.publicKey)
}

onMounted(async () => {
    try {
        sshKeys.value = await listSshKeys()
    } catch (error) {
        console.error('could not load ssh keys', error)
    }
    // Tauri 拖放：drop 事件给绝对路径（dragDropEnabled 默认 true 时 HTML5 drop 不触发）
    unlistenDragDrop = await getCurrentWebview().onDragDropEvent(onDragDropEvent)
})

let unlistenDragDrop: UnlistenFn | null = null

onBeforeUnmount(() => {
    unlistenDragDrop?.()
})

function refreshSshKeys (): void {
    void listSshKeys().then(keys => (sshKeys.value = keys)).catch(() => {})
}

// ---- 密钥链分页操作 ----
const keyAlgorithmOptions = computed(() => [
    { value: 'ed25519', label: 'Ed25519（推荐）' },
    { value: 'rsa', label: 'RSA 4096' },
])

const keyGenAlgorithm = ref<'ed25519' | 'rsa'>('ed25519')
const keyGenName = ref('')
const keyGenPassphrase = ref('')
const keysError = ref('')

/**
 * @description 应用内生成密钥对（ed25519/rsa，可选口令加密）并刷新列表
 * @returns Promise<void>
 *
 * @example await generateKeyEntry()
 *
 */
async function generateKeyEntry (): Promise<void> {
    keysError.value = ''
    const name = keyGenName.value.trim() || `key-${nanoid(4)}`
    try {
        await generateSshKey({
            id: `key-${nanoid(10)}`,
            name,
            algorithm: keyGenAlgorithm.value,
            passphrase: keyGenPassphrase.value || null,
            comment: '',
        })
        keyGenName.value = ''
        keyGenPassphrase.value = ''
        refreshSshKeys()
    } catch (error) {
        keysError.value = String(error instanceof Error ? error.message : error)
    }
}

// ---- 添加密钥表单（Termius 式：粘贴私钥 → 公钥自动推导 → 拖放/文件填充） ----
const keyAddOpen = ref(false)
const keyAddName = ref('')
const keyAddPrivatePem = ref('')
const keyAddPassphrase = ref('')
const keyAddInspection = ref<SshKeyInspection | null>(null)
const keyAddError = ref('')
const keyDropActive = ref(false)
const keyDropFileName = ref('')
let keyInspectTimer: ReturnType<typeof setTimeout> | null = null

const keyDropSourcePath = ref('')

/**
 * @description 打开「添加密钥」表单（清空上次输入）
 * @returns void
 *
 */
function openKeyAddForm (): void {
    keyAddOpen.value = true
    keyAddName.value = ''
    keyAddPrivatePem.value = ''
    keyAddPassphrase.value = ''
    keyAddInspection.value = null
    keyAddError.value = ''
    keyDropFileName.value = ''
}

/**
 * @description 切换「添加密钥」表单：打开时重置草稿，再点收起
 * @returns void
 *
 */
function toggleKeyAddForm (): void {
    if (keyAddOpen.value) {
        keyAddOpen.value = false
    } else {
        openKeyAddForm()
    }
}

/**
 * @description 私钥/口令变化后防抖验证：调 key_inspect 推导公钥与指纹（不存储）
 * @returns void
 *
 */
function scheduleKeyInspect (): void {
    if (keyInspectTimer) {
        clearTimeout(keyInspectTimer)
    }
    keyAddInspection.value = null
    keyAddError.value = ''
    keyInspectTimer = setTimeout(() => {
        const pem = keyAddPrivatePem.value
        if (!pem.trim()) {
            return
        }
        void inspectSshKey(pem, keyAddPassphrase.value || null)
            .then(inspection => (keyAddInspection.value = inspection))
            .catch(error => {
                keyAddError.value = String(error instanceof Error ? error.message : error)
            })
    }, 600)
}

/**
 * @description 保存添加的密钥：content（粘贴/文件填充）或 sourcePath（拖放）导入加密入库
 * @returns Promise<void>
 *
 */
async function saveKeyEntry (): Promise<void> {
    keysError.value = ''
    if (!keyAddPrivatePem.value.trim() && !keyDropFileName.value) {
        keyAddError.value = t('settings.keychainAddEmpty')
        return
    }
    try {
        await importSshKey({
            id: `key-${nanoid(10)}`,
            name: keyAddName.value.trim() || `key-${nanoid(4)}`,
            content: keyAddPrivatePem.value.trim() || null,
            sourcePath: keyDropFileName.value && !keyAddPrivatePem.value.trim() ? keyDropSourcePath.value : null,
            passphrase: keyAddPassphrase.value || null,
            comment: '',
        })
        keyAddOpen.value = false
        refreshSshKeys()
    } catch (error) {
        keyAddError.value = String(error instanceof Error ? error.message : error)
    }
}

/**
 * @description 「从密钥文件导入」按钮：读文件内容填入私钥 textarea（粘贴式，可见可改）
 * @param event 文件 input 的 change 事件
 * @returns Promise<void>
 *
 */
async function onKeyFileChosen (event: Event): Promise<void> {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) {
        return
    }
    keyDropFileName.value = file.name
    keyDropSourcePath.value = ''
    keyAddPrivatePem.value = await file.text()
    keyAddError.value = ''
    scheduleKeyInspect()
}

/**
 * @description 处理 Tauri 拖放事件：拖入私钥文件记录路径（保存时 Rust 按路径读，内容不经前端）
 * @param event 拖放事件（over/drop/cancel）
 * @returns void
 *
 */
function onDragDropEvent (event: TauriEvent<DragDropEvent>): void {
    if (event.payload.type === 'drop') {
        const path = event.payload.paths[0]
        if (!path) {
            return
        }
        keyDropActive.value = false
        keyDropFileName.value = path.split('/').pop() ?? path
        keyDropSourcePath.value = path
        keyAddPrivatePem.value = ''
        keyAddError.value = ''
        scheduleKeyInspect()
    } else if (event.payload.type === 'over') {
        keyDropActive.value = true
    } else {
        keyDropActive.value = false
    }
}

/**
 * @description 删除密钥条目：引用中的档案同步置空 keyId
 * @param key 条目元数据
 * @returns Promise<void>
 *
 */
async function deleteKeyEntry (key: SshKeyMeta): Promise<void> {
    keysError.value = ''
    try {
        await deleteSshKey(key.id)
        for (const profile of store.profiles) {
            if (profile.type === 'ssh' && profile.keyId === key.id) {
                profile.keyId = null
            }
        }
        refreshSshKeys()
    } catch (error) {
        keysError.value = String(error instanceof Error ? error.message : error)
    }
}

/**
 * @description 重命名密钥条目（失焦提交）
 * @param key 条目元数据
 * @param name 新名称
 * @returns Promise<void>
 *
 */
async function renameKeyEntry (key: SshKeyMeta, name: string): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed || trimmed === key.name) {
        return
    }
    key.name = trimmed
    await updateSshKey({ id: key.id, name: trimmed }).catch(() => {})
}

/**
 * @description 删除密钥链条目（经确认弹窗；引用中的档案同步置空 keyId）
 * @param key 目标密钥条目
 * @returns void
 *
 */
function confirmDeleteKey (key: SshKeyMeta): void {
    confirmAction(t('settings.deleteConfirmBody', { name: key.name }), () => void deleteKeyEntry(key))
}
</script>

<template>
    <div class="settings-page">
    <h2>{{ t('settings.keychainPage') }}</h2>
    <p class="hint">{{ t('settings.keychainHint') }}</p>
    <p v-if="keysError" class="import-error">{{ keysError }}</p>
    <div class="master-detail">
        <div class="detail-list">
            <p v-if="sshKeys.length === 0" class="hint">{{ t('settings.keychainEmpty') }}</p>
            <button
                v-for="key in sshKeys"
                :key="key.id"
                class="profile-item"
                :class="{ active: key.id === selectedKeyId }"
                @click="selectedKeyId = selectedKeyId === key.id ? null : key.id"
            >
                <span class="profile-item-head">
                    <input
                        class="key-name-input"
                        :value="key.name"
                        spellcheck="false"
                        @click.stop
                        @change="renameKeyEntry(key, ($event.target as HTMLInputElement).value)"
                    />
                    <span v-if="key.hasPassphrase" class="value-hint">{{ t('settings.keychainHasPassphrase') }}</span>
                </span>
                <span class="profile-item-command">{{ key.algorithm }} · {{ key.fingerprint.slice(0, 19) }}…</span>
            </button>
        </div>
        <div class="detail-content">
            <div v-if="selectedKey" class="settings-section">
                <h3 class="settings-section-title">{{ t('settings.keychainDetail') }}</h3>
                <div class="settings-card">
                    <div class="settings-card-row">
                        <Label>{{ t('settings.keychainName') }}</Label>
                        <span class="value-hint">{{ selectedKey.name }}</span>
                    </div>
                    <div class="settings-card-row">
                        <Label>{{ t('settings.keychainAlgorithm') }}</Label>
                        <span class="value-hint mono">{{ selectedKey.algorithm }}</span>
                    </div>
                    <div class="settings-card-row">
                        <Label>{{ t('settings.keychainFingerprint') }}</Label>
                        <span class="value-hint mono key-fingerprint">{{ selectedKey.fingerprint }}</span>
                    </div>
                    <div class="settings-card-row stacked">
                        <div class="settings-row-head">
                            <Label>{{ t('settings.keychainPublicKey') }}</Label>
                            <Button variant="ghost" size="sm" @click="copyKeyPublic(selectedKey)">
                                <Copy :size="14" />
                            </Button>
                        </div>
                        <span class="value-hint mono key-public">{{ selectedKey.publicKey }}</span>
                    </div>
                    <div class="settings-card-row actions">
                        <Button variant="destructive-outline" size="sm" @click="confirmDeleteKey(selectedKey)">
                            <Trash2 :size="14" />
                            {{ t('settings.keychainDelete') }}
                        </Button>
                    </div>
                </div>
            </div>

            <div class="settings-section">
                <h3 class="settings-section-title">{{ t('settings.keychainGenerate') }}</h3>
                <div class="settings-card">
                    <div class="settings-card-row">
                        <Label>{{ t('settings.keychainAlgorithm') }}</Label>
                        <Select v-model="keyGenAlgorithm" :options="keyAlgorithmOptions" class="w-44" />
                    </div>
                    <div class="settings-card-row">
                        <Label>{{ t('settings.keychainName') }}</Label>
                        <Input v-model="keyGenName" class="w-60" :placeholder="t('settings.keychainNamePlaceholder')" />
                    </div>
                    <div class="settings-card-row">
                        <Label>{{ t('settings.keychainPassphrase') }} <span class="value-hint">{{ t('settings.keychainPassphraseOptional') }}</span></Label>
                        <Input v-model="keyGenPassphrase" type="password" class="w-60" />
                    </div>
                    <div class="settings-card-row actions">
                        <Button variant="outline" size="sm" @click="generateKeyEntry">
                            <Plus :size="14" />
                            {{ t('settings.keychainGenerateAction') }}
                        </Button>
                    </div>
                </div>
            </div>

            <div class="settings-section">
                <div class="settings-section-head">
                    <h3 class="settings-section-title">{{ t('settings.keychainImportSection') }}</h3>
                    <div class="settings-section-actions">
                        <Button variant="outline" size="sm" @click="toggleKeyAddForm">
                            {{ keyAddOpen ? t('settings.keychainCancel') : t('settings.keychainAdd') }}
                        </Button>
                        <label class="import-label">
                            <span class="import-trigger">
                                <Upload :size="14" />
                                {{ t('settings.keychainImportFile') }}
                            </span>
                            <input type="file" hidden @change="onKeyFileChosen" />
                        </label>
                    </div>
                </div>
                <div v-if="keyAddOpen" class="settings-card">
                    <div class="settings-card-row">
                        <Label>{{ t('settings.keychainName') }}</Label>
                        <Input v-model="keyAddName" class="w-60" :placeholder="t('settings.keychainNamePlaceholder')" />
                    </div>
                    <div class="settings-card-row stacked">
                        <Label>{{ t('settings.keychainPrivateKey') }} *</Label>
                        <textarea
                            v-model="keyAddPrivatePem"
                            class="key-pem-input"
                            rows="7"
                            spellcheck="false"
                            :placeholder="t('settings.keychainPrivatePlaceholder')"
                            @input="scheduleKeyInspect"
                        ></textarea>
                    </div>
                    <div class="settings-card-row">
                        <Label>{{ t('settings.keychainPassphrase') }} <span class="value-hint">{{ t('settings.keychainPassphraseHint') }}</span></Label>
                        <Input v-model="keyAddPassphrase" type="password" class="w-60" @input="scheduleKeyInspect" />
                    </div>
                    <div v-if="keyAddInspection" class="settings-card-row stacked">
                        <div class="settings-row-head">
                            <Label>{{ t('settings.keychainPublicKey') }}</Label>
                            <Button variant="ghost" size="sm" @click="copyKeyPublic({ publicKey: keyAddInspection.publicKey } as SshKeyMeta)">
                                <Copy :size="14" />
                            </Button>
                        </div>
                        <span class="value-hint mono key-public">{{ keyAddInspection.publicKey }}</span>
                        <span class="value-hint">{{ keyAddInspection.algorithm }} · {{ keyAddInspection.fingerprint }}</span>
                    </div>
                    <div class="settings-card-row stacked">
                        <div
                            class="key-drop-zone"
                            :class="{ active: keyDropActive }"
                        >
                            <span class="value-hint">{{ keyDropFileName || t('settings.keychainDropHint') }}</span>
                        </div>
                    </div>
                    <div class="settings-card-row actions">
                        <Button variant="ghost" size="sm" @click="keyAddOpen = false">{{ t('settings.keychainCancel') }}</Button>
                        <Button size="sm" @click="saveKeyEntry">{{ t('settings.keychainSave') }}</Button>
                    </div>
                    <div v-if="keyAddError" class="settings-card-row">
                        <p class="import-error">{{ keyAddError }}</p>
                    </div>
                </div>
            </div>
        </div>
    </div>
    </div>
</template>

<style scoped>
.key-fingerprint {
    word-break: break-all;
    text-align: right;
}

.key-name-input {
    min-width: 0;
    flex: 1 1 0;
    border: none;
    background: transparent;
    color: inherit;
    font-size: 13px;
    font-weight: 600;
    outline: none;
}

.key-public {
    word-break: break-all;
}

.key-pem-input {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--color-input);
    border-radius: 6px;
    background: transparent;
    color: var(--color-foreground);
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.5;
    outline: none;
    resize: vertical;
}

.key-pem-input:focus {
    border-color: var(--color-ring);
    box-shadow: 0 0 0 1px var(--color-ring);
}

.key-drop-zone {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 56px;
    margin-bottom: 12px;
    border: 1px dashed var(--color-border);
    border-radius: 8px;
    transition: border-color 0.15s ease, background-color 0.15s ease;
}

.key-drop-zone.active {
    border-color: var(--color-ring);
    background: var(--color-accent);
}
</style>
