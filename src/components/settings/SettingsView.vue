<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { invoke } from '@tauri-apps/api/core'
import { openPath } from '@tauri-apps/plugin-opener'
import { nanoid } from 'nanoid'
import { writeClipboardText } from '@/lib/frontendContext'
import { Terminal, Palette, Keyboard, Info, FolderOpen, Layers, KeyRound, Copy, Plus, Trash2, Upload, Zap, Pencil, X } from 'lucide-vue-next'
import { getCurrentWebview, type DragDropEvent } from '@tauri-apps/api/webview'
import type { Event as TauriEvent, UnlistenFn } from '@tauri-apps/api/event'
import type { SshKeyMeta, SshKeyInspection } from '@/services/secrets'
import { generateSshKey, importSshKey, inspectSshKey, listSshKeys, updateSshKey, deleteSshKey, setProfilePassword, removeProfilePassword, hasProfilePassword } from '@/services/secrets'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Switch from '@/components/ui/Switch.vue'
import Slider from '@/components/ui/Slider.vue'
import Select from '@/components/ui/Select.vue'
import Separator from '@/components/ui/Separator.vue'
import SearchableSelect from '@/components/ui/SearchableSelect.vue'
import { useConfigStore, defaultFirstProfiles, type QuickCommand, type SshProfile, type TerminalProfile } from '@/stores/config'
import { useCommands } from '@/services/commands'
import { hotkeys } from '@/services/hotkeysSingleton'
import { builtinColorSchemes, defaultDarkColorScheme, type TerminalColorScheme } from '@/lib/colorSchemes'
import { parseItermColorsFile } from '@/lib/itermColors'
import { groupQuickCommandSections, parseQuickCommandParams, previewQuickCommand } from '@/lib/quickCommands'
import { listSystemFonts } from '@/services/fonts'
import type { NewlineMode } from '@/lib/middleware/streamProcessing'

const { t } = useI18n()
const config = useConfigStore()
const store = config.store

const page = ref<'terminal' | 'profiles' | 'quickCommands' | 'keys' | 'appearance' | 'hotkeys' | 'about'>('profiles')

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
    { id: 'quickCommands' as const, label: t('settings.quickCommands'), icon: Zap },
    { id: 'keys' as const, label: t('settings.keychainPage'), icon: KeyRound },
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

// ---- SSH 密钥链（元数据存加密 SQLite，私钥明文不出库） ----
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

onBeforeUnmount(() => {
    unlistenDragDrop?.()
})

function refreshSshKeys (): void {
    void listSshKeys().then(keys => (sshKeys.value = keys)).catch(() => {})
}

const keyIdModel = computed({
    get: () => selectedSshProfile.value?.keyId ?? '',
    set: (value: string) => {
        const profile = selectedSshProfile.value
        if (profile) {
            profile.keyId = value || null
        }
    },
})

const sshKeyOptions = computed(() => [
    { value: '', label: t('settings.keychainNone') },
    ...sshKeys.value.map(key => ({
        value: key.id,
        label: `${key.name} (${key.fingerprint.slice(0, 19)}…)`,
    })),
])

// ---- 档案密码（加密存 SQLite；表单只显示"已设置"状态） ----
const profilePasswordSet = ref(false)
const passwordEditorOpen = ref(false)
const passwordDraft = ref('')

watch(selectedSshProfile, async (profile: SshProfile | null) => {
    passwordEditorOpen.value = false
    passwordDraft.value = ''
    profilePasswordSet.value = profile ? await hasProfilePassword(profile.id).catch(() => false) : false
})

async function saveProfilePassword (): Promise<void> {
    const profile = selectedSshProfile.value
    if (!profile) {
        return
    }
    if (passwordDraft.value) {
        await setProfilePassword(profile.id, passwordDraft.value)
        profilePasswordSet.value = true
    }
    passwordEditorOpen.value = false
    passwordDraft.value = ''
}

async function clearProfilePassword (): Promise<void> {
    const profile = selectedSshProfile.value
    if (!profile) {
        return
    }
    await removeProfilePassword(profile.id)
    profilePasswordSet.value = false
    passwordEditorOpen.value = false
    passwordDraft.value = ''
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
let unlistenDragDrop: UnlistenFn | null = null

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

const keyDropSourcePath = ref('')

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
            keyId: null,
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

// ---- quick commands page ----
const selectedQuickCommandId = ref<string | null>(null)
const selectedQuickCommand = computed(() =>
    store.quickCommands.find(qc => qc.id === selectedQuickCommandId.value)
    ?? store.quickCommands[0]
    ?? null)

/** 左列表分段：未分组置顶无标题，其余按组名排序带小节头 */
const quickCommandSections = computed(() =>
    groupQuickCommandSections(store.quickCommands, store.quickCommandGroups))

/** 编辑器分组下拉：未分组 + 各分组 */
const quickCommandGroupOptions = computed(() => [
    { value: '', label: t('settings.quickCommandUngrouped') },
    ...store.quickCommandGroups.map(group => ({ value: group.id, label: group.name })),
])

const quickCommandGroupModel = computed({
    get: () => selectedQuickCommand.value?.groupId ?? '',
    set: (value: string) => {
        const quickCommand = selectedQuickCommand.value
        if (quickCommand) {
            if (value) {
                quickCommand.groupId = value
            } else {
                delete quickCommand.groupId
            }
        }
    },
})

/** 编辑器底部实时提示：当前模板检测到的占位参数 */
const selectedQuickCommandParams = computed(() =>
    selectedQuickCommand.value ? parseQuickCommandParams(selectedQuickCommand.value.command) : [])

/** 左列表组标题的行内改名状态；null = 无进行中的改名 */
const editingGroupId = ref<string | null>(null)
const groupNameDraft = ref('')

/**
 * @description 新建快捷命令并选中（名称/命令留空，填好后自动持久化）
 * @returns void
 *
 * @example createQuickCommand()
 *
 */
function createQuickCommand (): void {
    const quickCommand: QuickCommand = {
        id: `qc-${nanoid(8)}`,
        name: `${t('settings.quickCommands')} ${store.quickCommands.length + 1}`,
        command: '',
        autoRun: false,
    }
    store.quickCommands.push(quickCommand)
    selectedQuickCommandId.value = quickCommand.id
}

/**
 * @description 删除快捷命令；删除的是选中项时选中态收敛到剩余第一项
 * @param id 命令 id
 * @returns void
 *
 * @example deleteQuickCommand('qc-abc123')
 *
 */
function deleteQuickCommand (id: string): void {
    const index = store.quickCommands.findIndex(qc => qc.id === id)
    if (index === -1) {
        return
    }
    store.quickCommands.splice(index, 1)
    if (selectedQuickCommandId.value === id) {
        selectedQuickCommandId.value = store.quickCommands[0]?.id ?? null
    }
}

/**
 * @description 新建分组并直接进入行内改名
 * @returns void
 *
 * @example createQuickCommandGroup()
 *
 */
function createQuickCommandGroup (): void {
    const group = {
        id: `qcgroup-${nanoid(6)}`,
        name: t('settings.quickCommandNewGroupName'),
    }
    store.quickCommandGroups.push(group)
    startGroupRename(group.id)
}

/**
 * @description 删除分组：组内命令降级为未分组（groupId 清空）
 * @param id 分组 id
 * @returns void
 *
 * @example deleteQuickCommandGroup('qcgroup-a1b2')
 *
 */
function deleteQuickCommandGroup (id: string): void {
    const index = store.quickCommandGroups.findIndex(group => group.id === id)
    if (index === -1) {
        return
    }
    store.quickCommandGroups.splice(index, 1)
    for (const quickCommand of store.quickCommands) {
        if (quickCommand.groupId === id) {
            delete quickCommand.groupId
        }
    }
    if (editingGroupId.value === id) {
        editingGroupId.value = null
    }
}

/**
 * @description 开始分组行内改名（组名写入草稿）
 * @param id 分组 id
 * @returns void
 *
 * @example startGroupRename('qcgroup-a1b2')
 *
 */
function startGroupRename (id: string): void {
    const group = store.quickCommandGroups.find(g => g.id === id)
    if (!group) {
        return
    }
    editingGroupId.value = id
    groupNameDraft.value = group.name
}

/**
 * @description 提交分组改名（空名放弃修改）
 * @returns void
 *
 * @example commitGroupRename()
 *
 */
function commitGroupRename (): void {
    const id = editingGroupId.value
    const group = store.quickCommandGroups.find(g => g.id === id)
    if (group) {
        const name = groupNameDraft.value.trim()
        if (name) {
            group.name = name
        }
    }
    editingGroupId.value = null
}


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
                                <Label>{{ t('settings.keychain') }} <span class="value-hint">{{ t('settings.keychainHint') }}</span></Label>
                                <Select v-model="keyIdModel" :options="sshKeyOptions" class="w-60" />
                            </div>
                            <div v-if="selectedProfile.auth === 'password' || selectedProfile.auth === 'auto'" class="settings-field">
                                <Label>{{ t('settings.sshPassword') }}</Label>
                                <div class="ssh-password-row">
                                    <Button variant="outline" size="sm" @click="passwordEditorOpen = !passwordEditorOpen">
                                        {{ profilePasswordSet ? t('settings.sshPasswordReplace') : t('settings.sshPasswordSet') }}
                                    </Button>
                                    <span v-if="profilePasswordSet" class="value-hint">{{ t('settings.sshPasswordStored') }}</span>
                                    <Button v-if="profilePasswordSet" variant="ghost" size="sm" class="profile-delete" @click="clearProfilePassword">
                                        {{ t('settings.sshPasswordClear') }}
                                    </Button>
                                </div>
                                <div v-if="passwordEditorOpen" class="ssh-password-editor">
                                    <Input v-model="passwordDraft" type="password" class="w-60" :placeholder="t('settings.sshPasswordPlaceholder')" />
                                    <Button size="sm" @click="saveProfilePassword">{{ t('settings.sshPasswordSave') }}</Button>
                                </div>
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

            <template v-else-if="page === 'quickCommands'">
                <h2>{{ t('settings.quickCommands') }}</h2>
                <div class="profiles-layout">
                    <div class="profiles-list">
                        <div class="profile-new-group">
                            <button class="profile-new-button" @click="createQuickCommand">
                                <Plus :size="14" />
                                <span>{{ t('settings.quickCommandNew') }}</span>
                            </button>
                            <button class="profile-new-button" @click="createQuickCommandGroup">
                                <Plus :size="14" />
                                <span>{{ t('settings.quickCommandNewGroup') }}</span>
                            </button>
                        </div>
                        <template v-for="section in quickCommandSections" :key="section.groupId ?? '__ungrouped'">
                            <div v-if="section.title !== null" class="qc-group-header">
                                <template v-if="editingGroupId === section.groupId">
                                    <input
                                        v-model="groupNameDraft"
                                        class="qc-group-name-input"
                                        @keydown.enter.prevent="commitGroupRename"
                                        @keydown.esc.prevent="editingGroupId = null"
                                        @blur="commitGroupRename"
                                    />
                                </template>
                                <template v-else>
                                    <span class="qc-group-name">{{ section.title }}</span>
                                    <span class="qc-group-actions">
                                        <button class="qc-group-action" :title="t('settings.quickCommandRenameGroup')" @click.stop="startGroupRename(section.groupId!)">
                                            <Pencil :size="12" />
                                        </button>
                                        <button class="qc-group-action" :title="t('settings.quickCommandDeleteGroup')" @click.stop="deleteQuickCommandGroup(section.groupId!)">
                                            <X :size="12" />
                                        </button>
                                    </span>
                                </template>
                            </div>
                            <button
                                v-for="qc in section.items"
                                :key="qc.id"
                                class="profile-item"
                                :class="{ active: qc.id === selectedQuickCommand?.id }"
                                @click="selectedQuickCommandId = qc.id"
                            >
                                <span class="profile-item-head">
                                    <span class="profile-item-name">{{ qc.name || previewQuickCommand(qc.command) }}</span>
                                    <span v-if="qc.autoRun" class="qc-auto-run-badge">↵</span>
                                </span>
                                <span class="profile-item-command">{{ previewQuickCommand(qc.command) }}</span>
                            </button>
                        </template>
                        <p v-if="store.quickCommands.length === 0 && store.quickCommandGroups.length === 0" class="hint">
                            {{ t('settings.quickCommandEmptyHint') }}
                        </p>
                    </div>
                    <div v-if="selectedQuickCommand" class="profile-editor">
                        <div class="settings-field">
                            <Label>{{ t('settings.quickCommandName') }}</Label>
                            <Input v-model="selectedQuickCommand.name" class="w-60" />
                        </div>
                        <div class="settings-field">
                            <Label>{{ t('settings.quickCommandGroupLabel') }}</Label>
                            <Select v-model="quickCommandGroupModel" :options="quickCommandGroupOptions" class="w-60" />
                        </div>
                        <div class="settings-field">
                            <Label>
                                {{ t('settings.quickCommandCommand') }}
                                <span class="value-hint">{{ t('settings.quickCommandCommandHint') }}</span>
                            </Label>
                            <textarea
                                v-model="selectedQuickCommand.command"
                                class="qc-command-input"
                                rows="6"
                                spellcheck="false"
                                :placeholder="t('settings.quickCommandCommandPlaceholder')"
                            ></textarea>
                        </div>
                        <p v-if="selectedQuickCommandParams.length" class="hint qc-params-hint">
                            {{ t('settings.quickCommandParams', { names: selectedQuickCommandParams.join(', ') }) }}
                        </p>
                        <div class="settings-field row">
                            <Label>
                                {{ t('settings.quickCommandAutoRun') }}
                                <span class="value-hint">{{ t('settings.quickCommandAutoRunHint') }}</span>
                            </Label>
                            <Switch v-model="selectedQuickCommand.autoRun" />
                        </div>
                        <Separator />
                        <div class="settings-field row profile-actions">
                            <Button variant="ghost" size="sm" class="profile-delete" @click="deleteQuickCommand(selectedQuickCommand.id)">
                                <Trash2 :size="14" />
                                {{ t('settings.quickCommandDelete') }}
                            </Button>
                        </div>
                    </div>
                </div>
            </template>

            <template v-else-if="page === 'keys'">
                <h2>{{ t('settings.keychainPage') }}</h2>
                <p class="hint">{{ t('settings.keychainHint') }}</p>
                <p v-if="keysError" class="import-error">{{ keysError }}</p>
                <div class="keys-layout">
                    <div class="keys-list">
                        <p v-if="sshKeys.length === 0" class="hint">{{ t('settings.keychainEmpty') }}</p>
                        <button
                            v-for="key in sshKeys"
                            :key="key.id"
                            class="profile-item"
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
                    <div class="keys-editor">
                        <div class="keys-actions">
                            <Button variant="outline" size="sm" @click="openKeyAddForm">
                                <Plus :size="14" />
                                {{ t('settings.keychainAdd') }}
                            </Button>
                            <label class="import-label">
                                <span class="import-trigger">
                                    <Upload :size="14" />
                                    {{ t('settings.keychainImportFile') }}
                                </span>
                                <input type="file" hidden @change="onKeyFileChosen" />
                            </label>
                        </div>
                        <div v-if="keyAddOpen" class="keys-form key-add-form">
                            <div class="settings-field">
                                <Label>{{ t('settings.keychainName') }}</Label>
                                <Input v-model="keyAddName" class="w-full" :placeholder="t('settings.keychainNamePlaceholder')" />
                            </div>
                            <div class="settings-field">
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
                            <div class="settings-field">
                                <Label>{{ t('settings.keychainPassphrase') }} <span class="value-hint">{{ t('settings.keychainPassphraseHint') }}</span></Label>
                                <Input v-model="keyAddPassphrase" type="password" class="w-60" @input="scheduleKeyInspect" />
                            </div>
                            <div v-if="keyAddInspection" class="settings-field">
                                <Label>{{ t('settings.keychainPublicKey') }}</Label>
                                <div class="ssh-password-row">
                                    <span class="value-hint mono key-public">{{ keyAddInspection.publicKey }}</span>
                                    <Button variant="ghost" size="sm" @click="copyKeyPublic({ publicKey: keyAddInspection.publicKey } as SshKeyMeta)">
                                        <Copy :size="14" />
                                    </Button>
                                </div>
                                <span class="value-hint">{{ keyAddInspection.algorithm }} · {{ keyAddInspection.fingerprint }}</span>
                            </div>
                            <div
                                class="key-drop-zone"
                                :class="{ active: keyDropActive }"
                            >
                                <span class="value-hint">{{ keyDropFileName || t('settings.keychainDropHint') }}</span>
                            </div>
                            <div class="settings-field row">
                                <Button size="sm" @click="saveKeyEntry">{{ t('settings.keychainSave') }}</Button>
                                <Button variant="ghost" size="sm" @click="keyAddOpen = false">{{ t('settings.keychainCancel') }}</Button>
                            </div>
                            <p v-if="keyAddError" class="import-error">{{ keyAddError }}</p>
                        </div>
                        <div class="keys-form">
                            <p class="keys-form-title">{{ t('settings.keychainGenerate') }}</p>
                            <div class="settings-field">
                                <Label>{{ t('settings.keychainAlgorithm') }}</Label>
                                <Select v-model="keyGenAlgorithm" :options="keyAlgorithmOptions" class="w-44" />
                            </div>
                            <div class="settings-field">
                                <Label>{{ t('settings.keychainName') }}</Label>
                                <Input v-model="keyGenName" class="w-60" :placeholder="t('settings.keychainNamePlaceholder')" />
                            </div>
                            <div class="settings-field">
                                <Label>{{ t('settings.keychainPassphrase') }} <span class="value-hint">{{ t('settings.keychainPassphraseOptional') }}</span></Label>
                                <Input v-model="keyGenPassphrase" type="password" class="w-60" />
                            </div>
                            <Button variant="outline" size="sm" @click="generateKeyEntry">
                                <Plus :size="14" />
                                {{ t('settings.keychainGenerateAction') }}
                            </Button>
                        </div>
                        <template v-if="selectedKey">
                            <Separator />
                            <div class="settings-field">
                                <Label>{{ t('settings.keychainPublicKey') }}</Label>
                                <div class="ssh-password-row">
                                    <span class="value-hint mono key-public">{{ selectedKey.publicKey }}</span>
                                    <Button variant="ghost" size="sm" @click="copyKeyPublic(selectedKey)">
                                        <Copy :size="14" />
                                    </Button>
                                </div>
                            </div>
                            <div class="settings-field row profile-actions">
                                <Button variant="ghost" size="sm" class="profile-delete" @click="deleteKeyEntry(selectedKey)">
                                    <Trash2 :size="14" />
                                    {{ t('settings.keychainDelete') }}
                                </Button>
                            </div>
                        </template>
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

.keys-layout {
    display: flex;
    gap: 20px;
    align-items: flex-start;
}

.keys-list {
    width: 320px;
    flex-shrink: 0;
}

.keys-editor {
    flex: 1 1 0;
    min-width: 0;
    max-width: 520px;
}

.keys-actions {
    display: flex;
    gap: 8px;
    margin-bottom: 14px;
}

.keys-form {
    margin-bottom: 16px;
}

.keys-form-title {
    margin: 0 0 10px;
    font-size: 13px;
    font-weight: 600;
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

.ssh-password-row {
    display: flex;
    align-items: center;
    gap: 10px;
}

.ssh-password-editor {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
}

.key-add-form {
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 14px;
}

.key-pem-input {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--color-input);
    border-radius: 6px;
    background: transparent;
    color: var(--color-foreground);
    font-family: var(--font-mono, monospace);
    font-size: 11px;
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
    transition: all 0.15s;
}

.key-drop-zone.active {
    border-color: var(--color-ring);
    background: var(--color-accent);
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

.qc-group-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
    padding: 8px 6px 2px;
    border-bottom: 1px solid var(--color-border);
    margin-bottom: 2px;
}

.qc-group-name {
    font-size: 11px;
    color: var(--color-muted-foreground);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.qc-group-name-input {
    flex: 1;
    min-width: 0;
    padding: 2px 6px;
    border: 1px solid var(--color-input);
    border-radius: 4px;
    background: transparent;
    color: var(--color-foreground);
    font-size: 11px;
    outline: none;
}

.qc-group-actions {
    display: none;
    gap: 2px;
    flex-shrink: 0;
}

.qc-group-header:hover .qc-group-actions {
    display: inline-flex;
}

.qc-group-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--color-muted-foreground);
    cursor: default;
}

.qc-group-action:hover {
    background: var(--color-accent);
    color: var(--color-accent-foreground);
}

.qc-auto-run-badge {
    flex-shrink: 0;
    padding: 0 4px;
    border-radius: 4px;
    background: var(--color-accent);
    color: var(--color-accent-foreground);
    font-size: 10px;
    line-height: 14px;
}

.qc-command-input {
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

.qc-command-input:focus-visible {
    border-color: var(--color-ring);
    box-shadow: 0 0 0 1px var(--color-ring);
}

.qc-params-hint {
    margin: -4px 0 8px;
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
