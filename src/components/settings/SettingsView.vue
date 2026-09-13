<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { invoke } from '@tauri-apps/api/core'
import { nanoid } from 'nanoid'
import { Terminal, Palette, Keyboard, Info, FolderOpen, Layers, Plus, Trash2 } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Switch from '@/components/ui/Switch.vue'
import Slider from '@/components/ui/Slider.vue'
import Select from '@/components/ui/Select.vue'
import Separator from '@/components/ui/Separator.vue'
import { useConfigStore, type TerminalProfile } from '@/stores/config'
import { useCommands } from '@/services/commands'
import { hotkeys } from '@/services/hotkeysSingleton'
import { builtinColorSchemes } from '@/lib/colorSchemes'
import type { NewlineMode } from '@/lib/middleware/streamProcessing'

const { t } = useI18n()
const config = useConfigStore()
const store = config.store

const page = ref<'terminal' | 'profiles' | 'appearance' | 'hotkeys' | 'about'>('profiles')

const { sortedCommands } = useCommands()
const hotkeyCommands = computed(() => sortedCommands.value.filter(command => command.hotkeyId))
const recordingHotkeyId = ref<string | null>(null)

const languageOptions = computed(() => [
    { value: 'auto', label: t('settings.languageAuto') },
    { value: 'zh-CN', label: '简体中文' },
    { value: 'en', label: 'English' },
])

function bindingFor (hotkeyId: string): string {
    return (store.hotkeys[hotkeyId] ?? []).map(sequence => sequence.join('-')).join(', ')
}

function startRecording (hotkeyId: string): void {
    recordingHotkeyId.value = hotkeyId
}

function onKeystroke (keystroke: string): void {
    const hotkeyId = recordingHotkeyId.value
    if (!hotkeyId) {
        return
    }
    recordingHotkeyId.value = null
    if (keystroke === 'Escape') {
        return
    }
    if (keystroke === 'Backspace' || keystroke === 'Delete') {
        delete store.hotkeys[hotkeyId]
        return
    }
    store.hotkeys[hotkeyId] = [[keystroke]]
}

onMounted(() => {
    const sub = hotkeys.keystroke$.subscribe(onKeystroke)
    onBeforeUnmount(() => sub.unsubscribe())
})

const pages = computed(() => [
    { id: 'profiles' as const, label: t('settings.profiles'), icon: Layers },
    { id: 'terminal' as const, label: t('settings.terminal'), icon: Terminal },
    { id: 'appearance' as const, label: t('settings.appearance'), icon: Palette },
    { id: 'hotkeys' as const, label: t('settings.hotkeys'), icon: Keyboard },
    { id: 'about' as const, label: t('settings.about'), icon: Info },
])

// ---- profiles page ----
const profiles = computed(() => store.profiles)
const selectedProfileId = ref<string | null>(null)
const selectedProfile = computed<TerminalProfile | null>(() =>
    profiles.value.find(p => p.id === selectedProfileId.value)
    ?? profiles.value[0]
    ?? null)

const argsText = computed({
    get: () => selectedProfile.value?.args.join(' ') ?? '',
    set: (value: string) => {
        const profile = selectedProfile.value
        if (profile) {
            profile.args = value.split(/\s+/).filter(Boolean)
        }
    },
})

const cwdModel = computed({
    get: () => selectedProfile.value?.cwd ?? '',
    set: (value: string) => {
        const profile = selectedProfile.value
        if (profile) {
            profile.cwd = value.trim() || null
        }
    },
})

const envText = computed({
    get: () => Object.entries(selectedProfile.value?.env ?? {}).map(([key, value]) => `${key}=${value}`).join('\n'),
    set: (value: string) => {
        const profile = selectedProfile.value
        if (!profile) {
            return
        }
        const env: Record<string, string> = {}
        for (const line of value.split('\n')) {
            const trimmed = line.trim()
            const eq = trimmed.indexOf('=')
            if (eq > 0) {
                env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1)
            }
        }
        profile.env = env
    },
})

const profileColorSchemeOptions = computed(() => [
    { value: '', label: t('settings.profileColorSchemeGlobal') },
    { value: 'auto', label: t('settings.colorSchemeAuto') },
    ...builtinColorSchemes.map(scheme => ({ value: scheme.name, label: scheme.name })),
])

const profileColorSchemeModel = computed({
    get: () => selectedProfile.value?.colorScheme ?? '',
    set: (value: string) => {
        const profile = selectedProfile.value
        if (profile) {
            profile.colorScheme = value || null
        }
    },
})

/**
 * @description 新建配置档案（以当前默认档案的命令与登录 shell 设置为模板）并选中
 * @returns void
 *
 * @example createProfile() // 列表新增并选中新档案
 *
 */
function createProfile (): void {
    const template = config.defaultProfile()
    const profile: TerminalProfile = {
        id: `local-${nanoid(8)}`,
        type: 'local',
        name: `${t('settings.profiles')} ${store.profiles.length + 1}`,
        command: template?.command ?? '/bin/zsh',
        args: [],
        env: {},
        cwd: null,
        colorScheme: null,
        loginShell: template?.loginShell ?? true,
        isDefault: false,
    }
    store.profiles.push(profile)
    selectedProfileId.value = profile.id
}

/**
 * @description 删除配置档案；删除的是默认档案时把第一个剩余档案提升为默认
 * @param id 档案 id
 * @returns void
 *
 * @example deleteProfile('local-abc123')
 *
 */
function deleteProfile (id: string): void {
    const index = store.profiles.findIndex(p => p.id === id)
    if (index === -1) {
        return
    }
    const [removed] = store.profiles.splice(index, 1)
    if (removed?.isDefault && store.profiles.length > 0) {
        config.setDefaultProfile(store.profiles[0]!.id)
    }
    if (selectedProfileId.value === id) {
        selectedProfileId.value = store.profiles[0]?.id ?? null
    }
}

const cursorOptions = computed(() => [
    { value: 'block', label: t('settings.cursorStyleBlock') },
    { value: 'bar', label: t('settings.cursorStyleBar') },
    { value: 'underline', label: t('settings.cursorStyleUnderline') },
])

const backspaceOptions = computed(() => [
    { value: 'backspace', label: t('settings.backspaceDefault') },
    { value: 'ctrl-h', label: t('settings.backspaceCtrlH') },
    { value: 'ctrl-?', label: t('settings.backspaceCtrlQ') },
    { value: 'delete', label: t('settings.backspaceDelete') },
])

const newlineOptions = computed(() => [
    { value: 'auto', label: t('settings.newlinesAuto') },
    { value: 'cr', label: t('settings.newlinesCr') },
    { value: 'lf', label: t('settings.newlinesLf') },
    { value: 'crlf', label: t('settings.newlinesCrlf') },
    { value: 'implicit_cr', label: t('settings.newlinesImplicitCr') },
    { value: 'implicit_lf', label: t('settings.newlinesImplicitLf') },
])

/**
 * @description 换行转换配置的双向绑定：配置值为 null 表示不转换，UI 用 'auto' 占位
 * @param key 配置键（'inputNewlines' | 'outputNewlines'）
 * @returns WritableComputed<string, void> 以字符串值驱动的双向绑定
 *
 * @example newlineModel('inputNewlines').value = 'auto' // store.terminal.inputNewlines = null
 *
 */
function newlineModel (key: 'inputNewlines' | 'outputNewlines') {
    return computed({
        get: () => store.terminal[key] ?? 'auto',
        set: (value: string) => {
            store.terminal[key] = (value === 'auto' ? null : value) as NewlineMode
        },
    })
}

const inputNewlinesModel = newlineModel('inputNewlines')
const outputNewlinesModel = newlineModel('outputNewlines')

const colorSchemeOptions = computed(() => [
    { value: 'auto', label: t('settings.colorSchemeAuto') },
    ...builtinColorSchemes.map(scheme => ({ value: scheme.name, label: scheme.name })),
])

const configDir = ref('')
invoke<string>('config_dir_path').then(path => (configDir.value = path)).catch(() => {})

function openConfigDir (): void {
    if (configDir.value) {
        void invoke('plugin:opener|open_path', { path: configDir.value }).catch(() => {})
    }
}
</script>

<template>
    <div class="settings-view">
        <aside class="settings-nav">
            <button
                v-for="p in pages"
                :key="p.id"
                class="settings-nav-item"
                :class="{ active: page === p.id }"
                @click="page = p.id"
            >
                <component :is="p.icon" :size="15" />
                <span>{{ p.label }}</span>
            </button>
        </aside>

        <div class="settings-content">
            <template v-if="page === 'terminal'">
                <h2>{{ t('settings.terminal') }}</h2>
                <div class="settings-field">
                    <Label>{{ t('settings.fontSize') }} <span class="value-hint">{{ store.terminal.fontSize }}</span></Label>
                    <Slider v-model="store.terminal.fontSize" :min="8" :max="32" :step="1" />
                </div>
                <div class="settings-field">
                    <Label>{{ t('settings.fontFamily') }}</Label>
                    <Input v-model="store.terminal.font" placeholder="monospace" />
                </div>
                <div class="settings-field">
                    <Label>{{ t('settings.linePadding') }} <span class="value-hint">{{ store.terminal.linePadding }}</span></Label>
                    <Slider v-model="store.terminal.linePadding" :min="0" :max="8" :step="1" />
                </div>
                <Separator />
                <div class="settings-field">
                    <Label>{{ t('settings.cursorStyle') }}</Label>
                    <Select v-model="store.terminal.cursor" :options="cursorOptions" class="w-44" />
                </div>
                <div class="settings-field row">
                    <Label>{{ t('settings.cursorBlink') }}</Label>
                    <Switch v-model="store.terminal.cursorBlink" />
                </div>
                <Separator />
                <div class="settings-field">
                    <Label>{{ t('settings.scrollback') }}</Label>
                    <Input v-model.number="store.terminal.scrollbackLines" type="number" class="w-44" />
                </div>
                <div class="settings-field row">
                    <Label>{{ t('settings.copyOnSelect') }}</Label>
                    <Switch v-model="store.terminal.copyOnSelect" />
                </div>
                <div class="settings-field row">
                    <Label>{{ t('settings.altIsMeta') }}</Label>
                    <Switch v-model="store.terminal.altIsMeta" />
                </div>
                <div class="settings-field">
                    <Label>{{ t('settings.minimumContrast') }} <span class="value-hint">{{ store.terminal.minimumContrastRatio }}</span></Label>
                    <Slider v-model="store.terminal.minimumContrastRatio" :min="1" :max="7" :step="0.5" />
                </div>
                <Separator />
                <p class="hint">{{ t('settings.middlewareHint') }}</p>
                <div class="settings-field">
                    <Label>{{ t('settings.backspace') }}</Label>
                    <Select v-model="store.terminal.backspace" :options="backspaceOptions" class="w-44" />
                </div>
                <div class="settings-field">
                    <Label>{{ t('settings.inputNewlines') }}</Label>
                    <Select v-model="inputNewlinesModel" :options="newlineOptions" class="w-44" />
                </div>
                <div class="settings-field">
                    <Label>{{ t('settings.outputNewlines') }}</Label>
                    <Select v-model="outputNewlinesModel" :options="newlineOptions" class="w-44" />
                </div>
                <Separator />
                <div class="settings-field">
                    <Label>{{ t('settings.wordSeparator') }}</Label>
                    <Input v-model="store.terminal.wordSeparator" class="w-44" />
                </div>
                <div class="settings-field row">
                    <Label>{{ t('settings.boldInBright') }}</Label>
                    <Switch v-model="store.terminal.drawBoldTextInBrightColors" />
                </div>
            </template>

            <template v-else-if="page === 'profiles'">
                <h2>{{ t('settings.profiles') }}</h2>
                <div class="profiles-layout">
                    <div class="profiles-list">
                        <button class="profile-new-button" @click="createProfile">
                            <Plus :size="14" />
                            <span>{{ t('settings.profileNew') }}</span>
                        </button>
                        <button
                            v-for="p in profiles"
                            :key="p.id"
                            class="profile-item"
                            :class="{ active: p.id === selectedProfile?.id }"
                            @click="selectedProfileId = p.id"
                        >
                            <span class="profile-item-head">
                                <span class="profile-item-name">{{ p.name }}</span>
                                <span v-if="p.isDefault" class="profile-default-badge">{{ t('tab.defaultProfile') }}</span>
                            </span>
                            <span class="profile-item-command">{{ p.command }}</span>
                        </button>
                    </div>
                    <div v-if="selectedProfile" class="profile-editor">
                        <div class="settings-field">
                            <Label>{{ t('settings.profileName') }}</Label>
                            <Input v-model="selectedProfile.name" class="w-60" />
                        </div>
                        <div class="settings-field">
                            <Label>{{ t('settings.profileCommand') }}</Label>
                            <Input v-model="selectedProfile.command" class="w-60" />
                        </div>
                        <div class="settings-field">
                            <Label>{{ t('settings.profileArgs') }} <span class="value-hint">{{ t('settings.profileArgsHint') }}</span></Label>
                            <Input v-model="argsText" class="w-60" />
                        </div>
                        <div class="settings-field">
                            <Label>{{ t('settings.profileCwd') }}</Label>
                            <Input v-model="cwdModel" class="w-60" />
                        </div>
                        <div class="settings-field">
                            <Label>{{ t('settings.profileEnv') }} <span class="value-hint">{{ t('settings.profileEnvHint') }}</span></Label>
                            <textarea v-model="envText" class="profile-env" rows="4" spellcheck="false"></textarea>
                        </div>
                        <div class="settings-field">
                            <Label>{{ t('settings.profileColorScheme') }}</Label>
                            <Select v-model="profileColorSchemeModel" :options="profileColorSchemeOptions" class="w-44" />
                        </div>
                        <div class="settings-field row">
                            <Label>{{ t('settings.profileLoginShell') }}</Label>
                            <Switch v-model="selectedProfile.loginShell" />
                        </div>
                        <Separator />
                        <div class="settings-field row profile-actions">
                            <Button
                                variant="outline"
                                size="sm"
                                :disabled="selectedProfile.isDefault"
                                @click="config.setDefaultProfile(selectedProfile.id)"
                            >
                                {{ t('settings.profileSetDefault') }}
                            </Button>
                            <Button variant="ghost" size="sm" class="profile-delete" @click="deleteProfile(selectedProfile.id)">
                                <Trash2 :size="14" />
                                {{ t('settings.profileDelete') }}
                            </Button>
                        </div>
                    </div>
                </div>
            </template>

            <template v-else-if="page === 'appearance'">
                <h2>{{ t('settings.appearance') }}</h2>
                <div class="settings-field">
                    <Label>{{ t('settings.colorScheme') }}</Label>
                    <Select v-model="store.appearance.colorScheme" :options="colorSchemeOptions" class="w-44" />
                </div>
                <Separator />
                <div class="settings-field">
                    <Label>{{ t('settings.language') }}</Label>
                    <Select v-model="store.appearance.language" :options="languageOptions" class="w-44" />
                </div>
            </template>

            <template v-else-if="page === 'hotkeys'">
                <h2>{{ t('settings.hotkeys') }}</h2>
                <p class="hint">{{ t('settings.hotkeysHint') }}</p>
                <div
                    v-for="command in hotkeyCommands"
                    :key="command.id"
                    class="settings-field row hotkey-row"
                >
                    <Label>{{ command.label() }}</Label>
                    <button
                        class="hotkey-binding"
                        :class="{ recording: recordingHotkeyId === command.hotkeyId }"
                        @click="startRecording(command.hotkeyId!)"
                    >
                        {{ recordingHotkeyId === command.hotkeyId ? '…' : (bindingFor(command.hotkeyId!) || '—') }}
                    </button>
                </div>
            </template>

            <template v-else>
                <h2>{{ t('settings.about') }}</h2>
                <div class="settings-field row">
                    <Label>{{ t('settings.version') }}</Label>
                    <span class="value-hint">0.1.0</span>
                </div>
                <Separator />
                <div class="settings-field row">
                    <Label>{{ t('settings.configDir') }}</Label>
                    <span class="value-hint mono">{{ configDir }}</span>
                    <Button variant="ghost" size="sm" @click="openConfigDir">
                        <FolderOpen :size="14" />
                        {{ t('settings.openConfigDir') }}
                    </Button>
                </div>
            </template>
        </div>
    </div>
</template>

<style scoped>
.settings-view {
    height: 100%;
    display: flex;
    background: var(--color-background);
    color: var(--color-foreground);
    animation: 0.5s ease-out fadeIn;
}

.settings-nav {
    width: 180px;
    padding: 16px 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    border-right: 1px solid var(--color-border);
    flex-shrink: 0;
}

.settings-nav-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--color-muted-foreground);
    font-size: 13px;
    text-align: left;
    cursor: default;
    transition: all 0.25s ease;
}

.settings-nav-item:hover {
    background: var(--color-accent);
    color: var(--color-accent-foreground);
}

.settings-nav-item.active {
    background: var(--color-accent);
    color: var(--color-foreground);
}

.settings-content {
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px;
    min-width: 0;
}

.settings-content h2 {
    margin: 0 0 16px;
    font-size: 15px;
    font-weight: 600;
}

.settings-field {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 18px;
    max-width: 480px;
}

.settings-field.row {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
}

.value-hint {
    color: var(--color-muted-foreground);
    font-weight: 400;
    font-size: 12px;
}

.value-hint.mono {
    font-family: monospace;
    font-size: 12px;
}

.hint {
    color: var(--color-muted-foreground);
    font-size: 13px;
    margin-bottom: 16px;
}

.hotkey-row {
    max-width: 560px;
}

.profiles-layout {
    display: flex;
    gap: 20px;
    align-items: flex-start;
}

.profiles-list {
    width: 220px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.profile-new-button {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 10px;
    margin-bottom: 6px;
    border: 1px dashed var(--color-border);
    border-radius: 6px;
    background: transparent;
    color: var(--color-muted-foreground);
    font-size: 13px;
    cursor: default;
    transition: all 0.25s ease;
}

.profile-new-button:hover {
    color: var(--color-foreground);
    border-color: var(--color-ring);
}

.profile-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 7px 10px;
    border: none;
    border-radius: 6px;
    background: transparent;
    text-align: left;
    cursor: default;
    transition: all 0.25s ease;
}

.profile-item:hover {
    background: var(--color-accent);
}

.profile-item.active {
    background: var(--color-accent);
    color: var(--color-foreground);
}

.profile-item-head {
    display: flex;
    align-items: center;
    gap: 6px;
}

.profile-item-name {
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.profile-default-badge {
    flex-shrink: 0;
    padding: 0 5px;
    border-radius: 4px;
    background: var(--color-primary);
    color: var(--color-primary-foreground);
    font-size: 10px;
    line-height: 16px;
}

.profile-item-command {
    font-size: 11px;
    color: var(--color-muted-foreground);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.profile-editor {
    flex: 1;
    min-width: 0;
    max-width: 480px;
}

.profile-env {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--color-input);
    border-radius: 6px;
    background: transparent;
    color: var(--color-foreground);
    font-family: monospace;
    font-size: 12px;
    resize: vertical;
    outline: none;
}

.profile-env:focus-visible {
    border-color: var(--color-ring);
    box-shadow: 0 0 0 1px var(--color-ring);
}

.profile-actions {
    gap: 8px;
    justify-content: flex-start;
}

.profile-delete {
    color: var(--color-destructive);
}

.hotkey-binding {
    min-width: 120px;
    padding: 4px 10px;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: var(--color-secondary);
    color: var(--color-foreground);
    font-family: monospace;
    font-size: 12px;
    text-align: center;
    cursor: default;
    transition: all 0.25s ease;
}

.hotkey-binding:hover {
    border-color: var(--color-ring);
}

.hotkey-binding.recording {
    border-color: var(--color-primary);
    color: var(--color-primary);
    animation: 1s ease-in-out infinite recordPulse;
}

@keyframes recordPulse {
    0%, 100% {
        opacity: 1;
    }
    50% {
        opacity: 0.5;
    }
}

@keyframes fadeIn {
    from {
        opacity: 0;
    }
    to {
        opacity: 1;
    }
}
</style>
