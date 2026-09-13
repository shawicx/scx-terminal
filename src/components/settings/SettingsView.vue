<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { invoke } from '@tauri-apps/api/core'
import { openPath } from '@tauri-apps/plugin-opener'
import { nanoid } from 'nanoid'
import { Terminal, Palette, Keyboard, Info, FolderOpen, Layers, Plus, Trash2, Upload } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Switch from '@/components/ui/Switch.vue'
import Slider from '@/components/ui/Slider.vue'
import Select from '@/components/ui/Select.vue'
import Separator from '@/components/ui/Separator.vue'
import SearchableSelect from '@/components/ui/SearchableSelect.vue'
import { useConfigStore, defaultFirstProfiles, type TerminalProfile } from '@/stores/config'
import { useCommands } from '@/services/commands'
import { hotkeys } from '@/services/hotkeysSingleton'
import { builtinColorSchemes, defaultDarkColorScheme, type TerminalColorScheme } from '@/lib/colorSchemes'
import { parseItermColorsFile } from '@/lib/itermColors'
import { listSystemFonts } from '@/services/fonts'
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
const profiles = computed(() => defaultFirstProfiles(store.profiles))
const selectedProfileId = ref<string | null>(null)
const selectedProfile = computed<TerminalProfile | null>(() =>
    profiles.value.find(p => p.id === selectedProfileId.value)
    ?? profiles.value[0]
    ?? null)

// 仅 local 档案存在这些字段；编辑器在 SSH 档案下隐藏对应区块
const selectedLocalProfile = computed(() => {
    const profile = selectedProfile.value
    return profile?.type === 'local' ? profile : null
})

const argsText = computed({
    get: () => selectedLocalProfile.value?.args.join(' ') ?? '',
    set: (value: string) => {
        const profile = selectedLocalProfile.value
        if (profile) {
            profile.args = value.split(/\s+/).filter(Boolean)
        }
    },
})

const cwdModel = computed({
    get: () => selectedLocalProfile.value?.cwd ?? '',
    set: (value: string) => {
        const profile = selectedLocalProfile.value
        if (profile) {
            profile.cwd = value.trim() || null
        }
    },
})

const envText = computed({
    get: () => Object.entries(selectedLocalProfile.value?.env ?? {}).map(([key, value]) => `${key}=${value}`).join('\n'),
    set: (value: string) => {
        const profile = selectedLocalProfile.value
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

const sshAuthOptions = computed(() => [
    { value: 'auto', label: t('settings.sshAuthAuto') },
    { value: 'agent', label: t('settings.sshAuthAgent') },
    { value: 'publicKey', label: t('settings.sshAuthPublicKey') },
    { value: 'password', label: t('settings.sshAuthPassword') },
])

// 仅 SSH 档案存在这些字段
const selectedSshProfile = computed(() => {
    const profile = selectedProfile.value
    return profile?.type === 'ssh' ? profile : null
})

const privateKeyModel = computed({
    get: () => selectedSshProfile.value?.privateKeyPath ?? '',
    set: (value: string) => {
        const profile = selectedSshProfile.value
        if (profile) {
            profile.privateKeyPath = value.trim() || null
        }
    },
})

const passwordModel = computed({
    get: () => selectedSshProfile.value?.password ?? '',
    set: (value: string) => {
        const profile = selectedSshProfile.value
        if (profile) {
            profile.password = value || null
        }
    },
})

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
 * @description 新建配置档案并选中：local 以默认档案为模板；ssh 为远端连接模板
 * @param type 档案类型（local / ssh）
 * @returns void
 *
 * @example createProfile('ssh') // 列表新增并选中新 SSH 档案
 *
 */
function createProfile (type: 'local' | 'ssh'): void {
    if (type === 'ssh') {
        const profile: TerminalProfile = {
            id: `ssh-${nanoid(8)}`,
            type: 'ssh',
            name: `${t('settings.profileTypeSsh')} ${store.profiles.length + 1}`,
            host: '',
            port: 22,
            user: 'root',
            auth: 'auto',
            privateKeyPath: null,
            password: null,
            colorScheme: null,
            isDefault: false,
        }
        store.profiles.push(profile)
        selectedProfileId.value = profile.id
        return
    }
    const template = config.defaultProfile()
    const profile: TerminalProfile = {
        id: `local-${nanoid(8)}`,
        type: 'local',
        name: `${t('settings.profiles')} ${store.profiles.length + 1}`,
        command: (template?.type === 'local' ? template.command : undefined) ?? '/bin/zsh',
        args: [],
        env: {},
        cwd: null,
        colorScheme: null,
        loginShell: (template?.type === 'local' ? template.loginShell : undefined) ?? true,
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
        config.setDefaultProfile(profiles.value[0]!.id)
    }
    if (selectedProfileId.value === id) {
        selectedProfileId.value = profiles.value[0]?.id ?? null
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
    ...store.colorSchemes.map(scheme => ({ value: scheme.name, label: scheme.name, hint: t('settings.customTag') })),
])

// ---- custom color schemes editor ----
type SchemeColorKey = 'foreground' | 'background' | 'cursor' | 'cursorAccent' | 'selection' | 'selectionForeground'

const customSchemes = computed(() => store.colorSchemes)
const selectedCustomIndex = ref(0)
const selectedCustom = computed<TerminalColorScheme | null>(() => customSchemes.value[selectedCustomIndex.value] ?? null)
const importError = ref('')

const specialSlots = computed<{ key: SchemeColorKey, label: string }[]>(() => [
    { key: 'foreground', label: t('settings.schemeColorForeground') },
    { key: 'background', label: t('settings.schemeColorBackground') },
    { key: 'cursor', label: t('settings.schemeColorCursor') },
    { key: 'cursorAccent', label: t('settings.schemeColorCursorAccent') },
    { key: 'selection', label: t('settings.schemeColorSelection') },
    { key: 'selectionForeground', label: t('settings.schemeColorSelectionForeground') },
])

/** 16 个 ANSI 槽位的 i18n key（黑红绿黄蓝洋红青白 × 常规/亮色） */
const ANSI_COLOR_KEYS = [
    'colorBlack', 'colorRed', 'colorGreen', 'colorYellow', 'colorBlue', 'colorMagenta', 'colorCyan', 'colorWhite',
    'colorBrightBlack', 'colorBrightRed', 'colorBrightGreen', 'colorBrightYellow', 'colorBrightBlue', 'colorBrightMagenta', 'colorBrightCyan', 'colorBrightWhite',
] as const

const ansiSlots = computed(() => ANSI_COLOR_KEYS.map((key, index) => ({
    key: index,
    label: t(`settings.${key}`),
})))

/**
 * @description 读取槽位颜色（可缺省字段回退前景色以便 color input 显示）
 * @param scheme 配色对象
 * @param key 槽位键
 * @returns string #rrggbb 形式颜色
 *
 */
function schemeSlotColor (scheme: TerminalColorScheme, key: SchemeColorKey): string {
    return (scheme[key] ?? scheme.foreground).slice(0, 7)
}

/**
 * @description 写入槽位颜色；若现有值带 alpha 后缀（#rrggbbaa）则保留
 * @param scheme 配色对象
 * @param key 槽位键
 * @param hex #rrggbb 颜色
 * @returns void
 *
 */
function setSchemeSlotColor (scheme: TerminalColorScheme, key: SchemeColorKey, hex: string): void {
    const current = scheme[key] ?? ''
    const alpha = current.length === 9 ? current.slice(7) : ''
    scheme[key] = `${hex}${alpha}`
}

/**
 * @description 以名称写入槽位颜色（hex 文本输入），非法值忽略
 * @param scheme 配色对象
 * @param key 槽位键
 * @param text 用户输入的 hex 文本
 * @returns void
 *
 */
function setSchemeSlotColorText (scheme: TerminalColorScheme, key: SchemeColorKey, text: string): void {
    const value = text.trim().toLowerCase()
    if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(value)) {
        scheme[key] = value
    }
}

/**
 * @description 以文本写入 16 色 ANSI 槽位（hex 文本输入），非法值忽略
 * @param scheme 配色对象
 * @param index ANSI 槽位下标（0-15）
 * @param text 用户输入的 hex 文本
 * @returns void
 *
 */
function setAnsiColorText (scheme: TerminalColorScheme, index: number, text: string): void {
    const value = text.trim().toLowerCase()
    if (/^#[0-9a-f]{6}$/.test(value)) {
        scheme.colors[index] = value
    }
}

/**
 * @description 新建自定义配色（克隆 Tabby Default）并进入编辑
 * @returns void
 *
 */
function newCustomScheme (): void {
    const base = toRawScheme(defaultDarkColorScheme)
    base.name = `${t('settings.customSchemes')} ${customSchemes.value.length + 1}`
    store.colorSchemes.push(base)
    selectedCustomIndex.value = store.colorSchemes.length - 1
}

/**
 * @description 深拷贝配色对象（structuredClone 需要纯对象，去掉响应式代理）
 * @param scheme 源配色
 * @returns TerminalColorScheme 拷贝
 *
 */
function toRawScheme (scheme: TerminalColorScheme): TerminalColorScheme {
    return JSON.parse(JSON.stringify(scheme)) as TerminalColorScheme
}

/**
 * @description 删除自定义配色并收敛选中索引
 * @param index 列表索引
 * @returns void
 *
 */
function deleteCustomScheme (index: number): void {
    store.colorSchemes.splice(index, 1)
    if (selectedCustomIndex.value >= store.colorSchemes.length) {
        selectedCustomIndex.value = Math.max(store.colorSchemes.length - 1, 0)
    }
}

/**
 * @description 处理 iTerm2 配色文件选择：解析后加入自定义配色并选中
 * @param event 文件 input 的 change 事件
 * @returns void
 *
 */
function onImportFile (event: Event): void {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) {
        return
    }
    void file.text().then(text => {
        const name = file.name.replace(/\.itermcolors$/i, '')
        const scheme = parseItermColorsFile(text, name)
        importError.value = ''
        store.colorSchemes.push(scheme)
        selectedCustomIndex.value = store.colorSchemes.length - 1
    }).catch(() => {
        importError.value = t('settings.importFailed')
    })
}

// ---- font picker ----
const systemFonts = ref<string[]>([])

onMounted(async () => {
    systemFonts.value = await listSystemFonts()
})

const fontOptions = computed(() => [
    { value: 'monospace', label: 'monospace' },
    ...systemFonts.value.map(font => ({ value: font, label: font })),
])

const configDir = ref('')
invoke<string>('config_dir_path').then(path => (configDir.value = path)).catch(() => {})

/**
 * @description 在 Finder 中打开配置目录（opener 插件 open_path，capabilities 已放行 $APPDATA 范围）
 * @returns Promise<void>
 *
 * @example await openConfigDir() // 打开 ~/Library/Application Support/scx-terminal
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
                    <SearchableSelect
                        v-if="systemFonts.length > 0"
                        v-model="store.terminal.font"
                        :options="fontOptions"
                        class="w-60"
                        :placeholder="t('settings.searchPlaceholder')"
                    />
                    <!-- list_fonts 不可用时回退自由文本输入 -->
                    <Input v-else v-model="store.terminal.font" placeholder="monospace" />
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
                        <div class="profile-new-group">
                            <button class="profile-new-button" @click="createProfile('local')">
                                <Plus :size="14" />
                                <span>{{ t('settings.profileNew') }}</span>
                            </button>
                            <button class="profile-new-button" @click="createProfile('ssh')">
                                <Plus :size="14" />
                                <span>{{ t('settings.profileNewSsh') }}</span>
                            </button>
                        </div>
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
                            <span class="profile-item-command">{{ p.type === 'ssh' ? `${p.user}@${p.host}${p.port === 22 ? '' : `:${p.port}`}` : p.command }}</span>
                        </button>
                    </div>
                    <div v-if="selectedProfile" class="profile-editor">
                        <div class="settings-field">
                            <Label>{{ t('settings.profileName') }}</Label>
                            <Input v-model="selectedProfile.name" class="w-60" />
                        </div>
                        <template v-if="selectedProfile.type === 'local'">
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
                            <div class="settings-field row">
                                <Label>{{ t('settings.profileLoginShell') }}</Label>
                                <Switch v-model="selectedProfile.loginShell" />
                            </div>
                        </template>
                        <template v-else>
                            <div class="settings-field">
                                <Label>{{ t('settings.sshHost') }}</Label>
                                <Input v-model="selectedProfile.host" class="w-60" placeholder="example.com" />
                            </div>
                            <div class="settings-field">
                                <Label>{{ t('settings.sshPort') }}</Label>
                                <Input v-model.number="selectedProfile.port" type="number" class="w-24" />
                            </div>
                            <div class="settings-field">
                                <Label>{{ t('settings.sshUser') }}</Label>
                                <Input v-model="selectedProfile.user" class="w-60" />
                            </div>
                            <div class="settings-field">
                                <Label>{{ t('settings.sshAuth') }}</Label>
                                <Select v-model="selectedProfile.auth" :options="sshAuthOptions" class="w-44" />
                            </div>
                            <div v-if="selectedProfile.auth === 'publicKey' || selectedProfile.auth === 'auto'" class="settings-field">
                                <Label>{{ t('settings.sshPrivateKeyPath') }} <span class="value-hint">{{ t('settings.sshPrivateKeyHint') }}</span></Label>
                                <Input v-model="privateKeyModel" class="w-60" placeholder="~/.ssh/id_ed25519" />
                            </div>
                            <div v-if="selectedProfile.auth === 'password' || selectedProfile.auth === 'auto'" class="settings-field">
                                <Label>{{ t('settings.sshPassword') }} <span class="value-hint">{{ t('settings.sshPasswordHint') }}</span></Label>
                                <Input v-model="passwordModel" type="password" class="w-60" />
                            </div>
                        </template>
                        <div class="settings-field">
                            <Label>{{ t('settings.profileColorScheme') }}</Label>
                            <SearchableSelect
                                v-model="profileColorSchemeModel"
                                :options="profileColorSchemeOptions"
                                class="w-60"
                                :placeholder="t('settings.searchPlaceholder')"
                            />
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
                    <SearchableSelect
                        v-model="store.appearance.colorScheme"
                        :options="colorSchemeOptions"
                        class="w-60"
                        :placeholder="t('settings.searchPlaceholder')"
                    />
                </div>
                <Separator />
                <div class="custom-schemes-section">
                    <div class="custom-schemes-toolbar">
                        <h3 class="custom-schemes-title">{{ t('settings.customSchemes') }}</h3>
                        <Button variant="outline" size="sm" @click="newCustomScheme">
                            <Plus :size="14" />
                            {{ t('settings.customSchemeNew') }}
                        </Button>
                        <label class="import-label">
                            <span class="import-trigger">
                                <Upload :size="14" />
                                {{ t('settings.customSchemeImport') }}
                            </span>
                            <input type="file" accept=".itermcolors" hidden @change="onImportFile" />
                        </label>
                    </div>
                    <p v-if="importError" class="import-error">{{ importError }}</p>
                    <p v-if="customSchemes.length === 0" class="hint">{{ t('settings.customSchemeEmpty') }}</p>
                    <template v-else>
                        <div class="custom-scheme-chips">
                            <button
                                v-for="(scheme, index) in customSchemes"
                                :key="index"
                                class="custom-scheme-chip"
                                :class="{ active: index === selectedCustomIndex }"
                                @click="selectedCustomIndex = index"
                            >
                                {{ scheme.name }}
                            </button>
                        </div>
                        <div v-if="selectedCustom" class="custom-scheme-editor">
                            <div class="settings-field">
                                <Label>{{ t('settings.profileName') }}</Label>
                                <Input v-model="selectedCustom.name" class="w-60" />
                            </div>
                            <div
                                class="scheme-preview"
                                :style="{
                                    background: selectedCustom.background,
                                    color: selectedCustom.foreground,
                                    borderColor: selectedCustom.cursor,
                                }"
                            >
                                <span>AaBb 命令输出 <b>bold</b> <i>italic</i> → $</span>
                                <span class="scheme-preview-colors">
                                    <span
                                        v-for="(color, index) in selectedCustom.colors"
                                        :key="index"
                                        class="scheme-preview-swatch"
                                        :style="{ background: color }"
                                    ></span>
                                </span>
                            </div>
                            <div class="scheme-slots">
                                <div v-for="slot in specialSlots" :key="slot.key" class="scheme-slot">
                                    <Label class="scheme-slot-label">{{ slot.label }}</Label>
                                    <input
                                        type="color"
                                        class="scheme-color-input"
                                        :value="schemeSlotColor(selectedCustom, slot.key)"
                                        @input="setSchemeSlotColor(selectedCustom, slot.key, ($event.target as HTMLInputElement).value)"
                                    />
                                    <input
                                        class="scheme-hex-input"
                                        :value="selectedCustom[slot.key] ?? ''"
                                        @change="setSchemeSlotColorText(selectedCustom, slot.key, ($event.target as HTMLInputElement).value)"
                                    />
                                </div>
                                <div v-for="slot in ansiSlots" :key="`ansi-${slot.key}`" class="scheme-slot">
                                    <Label class="scheme-slot-label">{{ slot.label }}</Label>
                                    <input
                                        type="color"
                                        class="scheme-color-input"
                                        :value="selectedCustom.colors[slot.key]!"
                                        @input="selectedCustom.colors[slot.key] = ($event.target as HTMLInputElement).value"
                                    />
                                    <input
                                        class="scheme-hex-input"
                                        :value="selectedCustom.colors[slot.key]!"
                                        @change="setAnsiColorText(selectedCustom, slot.key, ($event.target as HTMLInputElement).value)"
                                    />
                                </div>
                            </div>
                            <div class="settings-field row profile-actions">
                                <Button variant="ghost" size="sm" class="profile-delete" @click="deleteCustomScheme(selectedCustomIndex)">
                                    <Trash2 :size="14" />
                                    {{ t('settings.customSchemeDelete') }}
                                </Button>
                            </div>
                        </div>
                    </template>
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

.profile-new-group {
    display: flex;
    gap: 6px;
    margin-bottom: 6px;
}

.profile-new-group .profile-new-button {
    flex: 1 1 0;
    margin-bottom: 0;
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

.custom-schemes-section {
    max-width: 560px;
}

.custom-schemes-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
}

.custom-schemes-title {
    margin: 0;
    margin-right: auto;
    font-size: 13px;
    font-weight: 600;
}

.import-label {
    display: inline-flex;
    cursor: pointer;
}

/* 与 Button outline/sm 同视觉，但保持非交互元素（label 才能激活隐藏的 file input） */
.import-trigger {
    display: inline-flex;
    height: 32px;
    align-items: center;
    justify-content: center;
    gap: 8px;
    white-space: nowrap;
    padding: 0 12px;
    border: 1px solid var(--color-input);
    border-radius: 6px;
    background: transparent;
    font-size: 12px;
    font-weight: 500;
    transition: background-color 0.15s;
}

.import-label:hover .import-trigger {
    background: var(--color-accent);
}

.import-error {
    margin: 0 0 10px;
    font-size: 12px;
    color: var(--color-destructive);
}

.custom-scheme-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 12px;
}

.custom-scheme-chip {
    padding: 3px 10px;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    background: transparent;
    color: var(--color-muted-foreground);
    font-size: 12px;
    cursor: default;
    transition: all 0.25s ease;
}

.custom-scheme-chip:hover {
    color: var(--color-foreground);
    border-color: var(--color-ring);
}

.custom-scheme-chip.active {
    background: var(--color-accent);
    border-color: var(--color-ring);
    color: var(--color-foreground);
}

.custom-scheme-editor {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.scheme-preview {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    font-family: monospace;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
}

.scheme-preview-colors {
    display: inline-flex;
    gap: 3px;
}

.scheme-preview-swatch {
    width: 14px;
    height: 14px;
    border-radius: 3px;
    border: 1px solid rgba(128, 128, 128, 0.4);
}

.scheme-slots {
    display: grid;
    grid-template-columns: repeat(2, minmax(220px, 1fr));
    gap: 6px 16px;
}

.scheme-slot {
    display: flex;
    align-items: center;
    gap: 8px;
}

.scheme-slot-label {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.scheme-color-input {
    width: 28px;
    height: 22px;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    background: transparent;
    cursor: pointer;
}

.scheme-hex-input {
    width: 84px;
    height: 22px;
    padding: 0 6px;
    border: 1px solid var(--color-input);
    border-radius: 4px;
    background: transparent;
    color: var(--color-foreground);
    font-family: monospace;
    font-size: 11px;
    outline: none;
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
