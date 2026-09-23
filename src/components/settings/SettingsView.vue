<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { invoke } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
import { openPath } from '@tauri-apps/plugin-opener'
import type { Update } from '@tauri-apps/plugin-updater'
import { nanoid } from 'nanoid'
import { writeClipboardText } from '@/lib/frontendContext'
import { Terminal, Palette, Keyboard, Info, FolderOpen, KeyRound, Copy, Plus, Trash2, Upload, Zap, Pencil, X, Globe, Server, SquareTerminal, Layers } from 'lucide-vue-next'
import { getCurrentWebview, type DragDropEvent } from '@tauri-apps/api/webview'
import type { Event as TauriEvent, UnlistenFn } from '@tauri-apps/api/event'
import type { SshKeyMeta, SshKeyInspection } from '@/services/secrets'
import { generateSshKey, importSshKey, inspectSshKey, listSshKeys, updateSshKey, deleteSshKey, setProfilePassword, removeProfilePassword, hasProfilePassword } from '@/services/secrets'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Switch from '@/components/ui/Switch.vue'
import Slider from '@/components/ui/Slider.vue'
import Select from '@/components/ui/Select.vue'
import SearchableSelect from '@/components/ui/SearchableSelect.vue'
import ColorSchemePicker from '@/components/settings/ColorSchemePicker.vue'
import ProfileForwardingsCard from '@/components/settings/ProfileForwardingsCard.vue'
import TabGroupFormDialog from '@/components/settings/TabGroupFormDialog.vue'
import { useConfigStore, defaultFirstProfiles, defaultShellCommand, type LocalProfile, type QuickCommand, type SshProfile, type TabGroup, type TerminalProfile } from '@/stores/config'
import { useTabsStore } from '@/stores/tabs'
import type { SettingsPageId } from '@/stores/tabs'
import { backgroundPreviewUrl } from '@/services/backgroundImage'
import { checkForUpdate, installUpdate, type UpdateProgress } from '@/services/updater'
import { useCommands } from '@/services/commands'
import { hotkeys } from '@/services/hotkeysSingleton'
import { formatKeystrokeForDisplay } from '@/lib/hotkeys/hotkeys'
import appIcon from '../../../src-tauri/icons/icon.png'
import { builtinColorSchemes, defaultDarkColorScheme, type TerminalColorScheme } from '@/lib/colorSchemes'
import { parseItermColorsFile } from '@/lib/itermColors'
import { groupQuickCommandSections, parseQuickCommandParams, previewQuickCommand } from '@/lib/quickCommands'
import { listSystemFonts } from '@/services/fonts'
import { clearHistory } from '@/services/history'
import type { NewlineMode } from '@/lib/middleware/streamProcessing'

const { t } = useI18n()
const config = useConfigStore()
const store = config.store
const tabsStore = useTabsStore()

const props = defineProps<{ initialPage?: SettingsPageId }>()

const page = ref<SettingsPageId>(props.initialPage ?? 'profiles')

const { sortedCommands } = useCommands()
const hotkeyCommands = computed(() => sortedCommands.value.filter(command => command.hotkeyId))
const recordingHotkeyId = ref<string | null>(null)

const languageOptions = computed(() => [
    { value: 'auto', label: t('settings.languageAuto') },
    { value: 'zh-CN', label: '简体中文' },
    { value: 'en', label: 'English' },
])

const tabBarPositionOptions = computed(() => [
    { value: 'top', label: t('settings.tabBarTop') },
    { value: 'bottom', label: t('settings.tabBarBottom') },
])

const backgroundFitOptions = computed(() => [
    { value: 'cover', label: t('settings.fitCover') },
    { value: 'contain', label: t('settings.fitContain') },
    { value: 'tile', label: t('settings.fitTile') },
])

/**
 * @description 选择本地图片为终端背景：dialog 原生选图 → Rust 校验并复制进
 *              app-data/backgrounds/ → 文件名写配置（App 层 watch 触发应用）
 * @returns Promise<void>
 *
 */
async function chooseBackgroundImage (): Promise<void> {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const picked = await open({
        multiple: false,
        filters: [{ name: t('settings.backgroundImage'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
    })
    if (typeof picked !== 'string') {
        return
    }
    try {
        const name = await invoke<string | null>('background_image_set', { path: picked })
        store.appearance.backgroundImage = name ?? null
    } catch (error) {
        console.warn('failed to set background image', error)
    }
}

/**
 * @description 清除终端背景：删 app-data 内图片文件并置空配置
 * @returns Promise<void>
 *
 */
async function clearBackgroundImage (): Promise<void> {
    await invoke('background_image_set', { path: null })
    store.appearance.backgroundImage = null
}

function bindingFor (hotkeyId: string): string {
    return (store.hotkeys[hotkeyId] ?? [])
        .map(sequence => sequence.map(formatKeystrokeForDisplay).join(' '))
        .join(', ')
}

// ---- 危险操作确认弹窗（档案/快捷命令/密钥/自定义配色删除共用） ----
const confirmState = ref<{ message: string, action: () => void } | null>(null)

/**
 * @description 打开删除确认弹窗：记录提示文案与确认后执行的动作
 * @param message 确认提示文案（含目标名称）
 * @param action 确认后执行的动作
 * @returns void
 *
 */
function confirmAction (message: string, action: () => void): void {
    confirmState.value = { message, action }
}

/**
 * @description 执行已确认的动作并关闭弹窗
 * @returns void
 *
 */
function runConfirmed (): void {
    const current = confirmState.value
    confirmState.value = null
    current?.action()
}

/**
 * @description 删除配置档案（经确认弹窗；按类型路由到对应档案页的删除逻辑）
 * @param profile 目标档案
 * @returns void
 *
 */
function confirmDeleteProfile (profile: TerminalProfile): void {
    confirmAction(t('settings.deleteConfirmBody', { name: profile.name }), () =>
        profile.type === 'ssh' ? deleteSshProfile(profile.id) : deleteLocalProfile(profile.id))
}

/**
 * @description 删除快捷命令（经确认弹窗；未命名时以命令预览为名）
 * @param quickCommand 目标快捷命令
 * @returns void
 *
 */
function confirmDeleteQuickCommand (quickCommand: QuickCommand): void {
    const name = quickCommand.name || previewQuickCommand(quickCommand.command)
    confirmAction(t('settings.deleteConfirmBody', { name }), () => deleteQuickCommand(quickCommand.id))
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

/**
 * @description 删除自定义配色（经确认弹窗）
 * @param name 配色名称
 * @param index 自定义配色列表索引
 * @returns void
 *
 */
function confirmDeleteCustomScheme (name: string, index: number): void {
    confirmAction(t('settings.deleteConfirmBody', { name }), () => deleteCustomScheme(index))
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
    { id: 'profiles' as const, label: t('settings.localTerminalPage'), icon: SquareTerminal },
    { id: 'ssh' as const, label: t('settings.sshPage'), icon: Server },
    { id: 'quickCommands' as const, label: t('settings.quickCommands'), icon: Zap },
    { id: 'keys' as const, label: t('settings.keychainPage'), icon: KeyRound },
    { id: 'terminal' as const, label: t('settings.terminal'), icon: Terminal },
    { id: 'appearance' as const, label: t('settings.appearance'), icon: Globe },
    { id: 'colorSchemes' as const, label: t('settings.colorSchemesPage'), icon: Palette },
    { id: 'hotkeys' as const, label: t('settings.hotkeys'), icon: Keyboard },
    { id: 'tabGroups' as const, label: t('settings.tabGroupsPage'), icon: Layers },
    { id: 'about' as const, label: t('settings.about'), icon: Info },
])

// ---- 本地终端页（仅 local 档案；与 SSH 档案页分离，各自独立选中态） ----
const localProfiles = computed(() => defaultFirstProfiles(store.profiles.filter((p): p is LocalProfile => p.type === 'local')))
const selectedLocalProfileId = ref<string | null>(null)
const selectedLocalProfile = computed<LocalProfile | null>(() =>
    localProfiles.value.find(p => p.id === selectedLocalProfileId.value)
    ?? localProfiles.value[0]
    ?? null)

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

// ---- SSH 页（SSH 档案 + 分组；分组交互对齐快捷命令分组） ----
const sshProfiles = computed(() => store.profiles.filter((p): p is SshProfile => p.type === 'ssh'))
const selectedSshProfileId = ref<string | null>(null)
const selectedSshProfile = computed<SshProfile | null>(() =>
    sshProfiles.value.find(p => p.id === selectedSshProfileId.value)
    ?? sshProfiles.value[0]
    ?? null)

/** SSH 左列表分段：默认分组置顶（固定标题、不可改名/删除），其余按组名排序带小节头 */
const sshSections = computed(() => {
    const sections = groupQuickCommandSections(sshProfiles.value, store.sshGroups)
        .map(section => section.groupId === null ? { ...section, title: t('settings.sshDefaultGroup') } : section)
    // 没有未分组档案时也保持默认分组段置顶（空段常驻可见）
    if (sshProfiles.value.length > 0 && !sections.some(section => section.groupId === null)) {
        sections.unshift({ title: t('settings.sshDefaultGroup'), groupId: null, items: [] })
    }
    return sections
})

/** 编辑器分组下拉：默认分组 + 各分组 */
const sshGroupOptions = computed(() => [
    { value: '', label: t('settings.sshDefaultGroup') },
    ...store.sshGroups.map(group => ({ value: group.id, label: group.name })),
])

const sshGroupModel = computed({
    get: () => selectedSshProfile.value?.groupId ?? '',
    set: (value: string) => {
        const profile = selectedSshProfile.value
        if (!profile) {
            return
        }
        if (value) {
            profile.groupId = value
        } else {
            delete profile.groupId
        }
    },
})

// ---- 分组名称弹窗（SSH 分组与快捷命令分组共用：两者均仅名称字段；确认才落库，新建不再先插默认名） ----
type GroupNameDialogKind = 'ssh-create' | 'ssh-rename' | 'qc-create' | 'qc-rename'

/** null = 弹窗关闭；打开时携带来源、目标组与名称草稿 */
const groupNameDialog = ref<{ kind: GroupNameDialogKind, groupId: string | null, draft: string } | null>(null)

/** 弹窗标题随来源切换（新建/重命名 × SSH/快捷命令） */
const groupNameDialogTitle = computed(() => {
    const dialog = groupNameDialog.value
    if (!dialog) {
        return ''
    }
    if (dialog.kind === 'ssh-create') {
        return t('settings.sshNewGroup')
    }
    if (dialog.kind === 'ssh-rename') {
        return t('settings.sshRenameGroup')
    }
    return dialog.kind === 'qc-create' ? t('settings.quickCommandNewGroup') : t('settings.quickCommandRenameGroup')
})

/**
 * @description 提交分组名称弹窗：按来源创建新组或写回组名（空名由确认按钮禁用兜底）
 * @returns void
 *
 * @example commitGroupNameDialog()
 *
 */
function commitGroupNameDialog (): void {
    const dialog = groupNameDialog.value
    if (!dialog) {
        return
    }
    const name = dialog.draft.trim()
    if (!name) {
        return
    }
    groupNameDialog.value = null
    if (dialog.kind === 'ssh-create') {
        store.sshGroups.push({ id: `sshgroup-${nanoid(6)}`, name })
    } else if (dialog.kind === 'qc-create') {
        store.quickCommandGroups.push({ id: `qcgroup-${nanoid(6)}`, name })
    } else if (dialog.kind === 'ssh-rename') {
        const group = store.sshGroups.find(g => g.id === dialog.groupId)
        if (group) {
            group.name = name
        }
    } else {
        const group = store.quickCommandGroups.find(g => g.id === dialog.groupId)
        if (group) {
            group.name = name
        }
    }
}

/**
 * @description 打开 SSH 分组新建弹窗
 * @returns void
 *
 * @example openCreateSshGroup()
 *
 */
function openCreateSshGroup (): void {
    groupNameDialog.value = { kind: 'ssh-create', groupId: null, draft: '' }
}

/**
 * @description 打开 SSH 分组重命名弹窗（预填当前组名）
 * @param id 分组 id
 * @returns void
 *
 * @example openRenameSshGroup('sshgroup-a1b2')
 *
 */
function openRenameSshGroup (id: string): void {
    const group = store.sshGroups.find(g => g.id === id)
    if (group) {
        groupNameDialog.value = { kind: 'ssh-rename', groupId: id, draft: group.name }
    }
}

/**
 * @description 打开快捷命令分组新建弹窗
 * @returns void
 *
 * @example openCreateQuickCommandGroup()
 *
 */
function openCreateQuickCommandGroup (): void {
    groupNameDialog.value = { kind: 'qc-create', groupId: null, draft: '' }
}

/**
 * @description 打开快捷命令分组重命名弹窗（预填当前组名）
 * @param id 分组 id
 * @returns void
 *
 * @example openRenameQuickCommandGroup('qcgroup-a1b2')
 *
 */
function openRenameQuickCommandGroup (id: string): void {
    const group = store.quickCommandGroups.find(g => g.id === id)
    if (group) {
        groupNameDialog.value = { kind: 'qc-rename', groupId: id, draft: group.name }
    }
}

/**
 * @description 删除 SSH 分组：组内档案降级默认分组（groupId 清空，Rust 删组命令同语义级联）
 * @param id 分组 id
 * @returns void
 *
 * @example deleteSshGroup('sshgroup-a1b2')
 *
 */
function deleteSshGroup (id: string): void {
    const index = store.sshGroups.findIndex(group => group.id === id)
    if (index === -1) {
        return
    }
    store.sshGroups.splice(index, 1)
    for (const profile of store.profiles) {
        if (profile.type === 'ssh' && profile.groupId === id) {
            delete profile.groupId
        }
    }
}

/**
 * @description 删除 SSH 分组（经确认弹窗；组内档案降级默认分组）
 * @param id 分组 id
 * @returns void
 *
 * @example confirmDeleteSshGroup('sshgroup-a1b2')
 *
 */
function confirmDeleteSshGroup (id: string): void {
    const group = store.sshGroups.find(g => g.id === id)
    if (group) {
        confirmAction(t('settings.deleteConfirmBody', { name: group.name }), () => deleteSshGroup(id))
    }
}

// ---- 标签分组页（分组定义管理；运行时归属在 tabs store，TabStrip 渲染 chip） ----

/** 分组表单弹窗开合 */
const tabGroupDialogOpen = ref(false)
/** 表单编辑中的分组；null = 新建 */
const editingTabGroup = ref<TabGroup | null>(null)

/** 各分组当前标签数（只读运行时信息，来自 tabs store） */
const tabGroupMemberCounts = computed<Record<string, number>>(() => {
    const counts: Record<string, number> = {}
    for (const tab of tabsStore.tabs) {
        if (tab.groupId) {
            counts[tab.groupId] = (counts[tab.groupId] ?? 0) + 1
        }
    }
    return counts
})

/**
 * @description 打开分组新建弹窗（空表单）
 * @returns void
 *
 * @example openCreateTabGroup()
 *
 */
function openCreateTabGroup (): void {
    editingTabGroup.value = null
    tabGroupDialogOpen.value = true
}

/**
 * @description 打开分组编辑弹窗（预填当前组）
 * @param group 目标分组
 * @returns void
 *
 * @example openEditTabGroup(group)
 *
 */
function openEditTabGroup (group: TabGroup): void {
    editingTabGroup.value = group
    tabGroupDialogOpen.value = true
}

/**
 * @description 提交分组表单弹窗：编辑模式写回当前组，新建模式落库新组
 * @param value 表单值（名称、组色、持久化）
 * @returns void
 *
 * @example commitTabGroupDialog({ name: 'work', color: undefined, persistTabs: true })
 *
 */
function commitTabGroupDialog (value: { name: string, color: string | undefined, persistTabs: boolean }): void {
    if (editingTabGroup.value) {
        const group = editingTabGroup.value
        group.name = value.name
        if (value.color) {
            group.color = value.color
        } else {
            delete group.color
        }
        group.persistTabs = value.persistTabs
    } else {
        const group: TabGroup = {
            id: `tabgroup-${nanoid(6)}`,
            name: value.name,
            persistTabs: value.persistTabs,
        }
        if (value.color) {
            group.color = value.color
        }
        store.tabGroups.push(group)
    }
    tabGroupDialogOpen.value = false
}

/**
 * @description 删除标签分组（经确认弹窗）
 * @param group 目标分组
 * @returns void
 *
 * @example confirmDeleteTabGroup(group)
 *
 */
function confirmDeleteTabGroup (group: TabGroup): void {
    confirmAction(t('settings.deleteConfirmBody', { name: group.name }), () => deleteTabGroup(group.id))
}

/**
 * @description 执行标签分组删除：组定义移除后成员标签回落未分组，
 *              该组的持久化快照条目随下次 tab_session 写盘自然消失
 * @param id 分组 id
 * @returns void
 *
 * @example deleteTabGroup('tabgroup-a1b2')
 *
 */
function deleteTabGroup (id: string): void {
    const index = store.tabGroups.findIndex(group => group.id === id)
    if (index === -1) {
        return
    }
    store.tabGroups.splice(index, 1)
    tabsStore.clearGroupMembership(id)
}

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

const localColorSchemeModel = computed({
    get: () => selectedLocalProfile.value?.colorScheme ?? '',
    set: (value: string) => {
        const profile = selectedLocalProfile.value
        if (profile) {
            profile.colorScheme = value || null
        }
    },
})

const sshColorSchemeModel = computed({
    get: () => selectedSshProfile.value?.colorScheme ?? '',
    set: (value: string) => {
        const profile = selectedSshProfile.value
        if (profile) {
            profile.colorScheme = value || null
        }
    },
})

/**
 * @description 新建本地终端档案并选中（以首个 local 档案为模板）
 * @returns void
 *
 * @example createLocalProfile() // 列表新增并选中新档案
 *
 */
function createLocalProfile (): void {
    const template = localProfiles.value[0]
    const profile: LocalProfile = {
        id: `local-${nanoid(8)}`,
        type: 'local',
        name: `${t('settings.localTerminalPage')} ${localProfiles.value.length + 1}`,
        command: template?.command ?? defaultShellCommand(),
        args: [],
        env: {},
        cwd: null,
        colorScheme: null,
        loginShell: template?.loginShell ?? true,
        isDefault: false,
    }
    store.profiles.push(profile)
    selectedLocalProfileId.value = profile.id
}

/**
 * @description 新建 SSH 档案并选中（落在默认分组）
 * @returns void
 *
 * @example createSshProfile() // 列表默认分组下新增并选中
 *
 */
function createSshProfile (): void {
    const profile: SshProfile = {
        id: `ssh-${nanoid(8)}`,
        type: 'ssh',
        name: `${t('settings.profileTypeSsh')} ${sshProfiles.value.length + 1}`,
        host: '',
        port: 22,
        user: 'root',
        auth: 'auto',
        keyId: null,
        colorScheme: null,
        isDefault: false,
    }
    store.profiles.push(profile)
    selectedSshProfileId.value = profile.id
}

/**
 * @description 删除本地终端档案；删除的是默认档案时把第一个剩余 local 档案提升为默认
 * @param id 档案 id
 * @returns void
 *
 * @example deleteLocalProfile('local-abc123')
 *
 */
function deleteLocalProfile (id: string): void {
    const index = store.profiles.findIndex(p => p.id === id)
    if (index === -1) {
        return
    }
    const [removed] = store.profiles.splice(index, 1)
    if (removed?.isDefault && localProfiles.value.length > 0) {
        config.setDefaultProfile(localProfiles.value[0]!.id)
    }
    if (selectedLocalProfileId.value === id) {
        selectedLocalProfileId.value = localProfiles.value[0]?.id ?? null
    }
}

/**
 * @description 删除 SSH 档案；删除的是选中项时选中态收敛到剩余第一项
 * @param id 档案 id
 * @returns void
 *
 * @example deleteSshProfile('ssh-abc123')
 *
 */
function deleteSshProfile (id: string): void {
    const index = store.profiles.findIndex(p => p.id === id)
    if (index === -1) {
        return
    }
    store.profiles.splice(index, 1)
    if (selectedSshProfileId.value === id) {
        selectedSshProfileId.value = sshProfiles.value[0]?.id ?? null
    }
}

const cursorOptions = computed(() => [
    { value: 'block', label: t('settings.cursorStyleBlock') },
    { value: 'bar', label: t('settings.cursorStyleBar') },
    { value: 'underline', label: t('settings.cursorStyleUnderline') },
])

/** 字重下拉：常规/加粗 + CSS 数值档（xterm 透传给字体渲染） */
const fontWeightOptions = computed(() => [
    { value: 'normal', label: t('settings.weightNormal') },
    { value: 'bold', label: t('settings.weightBold') },
    ...(['100', '200', '300', '400', '500', '600', '700', '800', '900'] as const)
        .map(weight => ({ value: weight, label: weight })),
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
 * @description 删除快捷命令分组（经确认弹窗）
 * @param id 分组 id
 * @returns void
 *
 * @example confirmDeleteQuickCommandGroup('qcgroup-a1b2')
 *
 */
function confirmDeleteQuickCommandGroup (id: string): void {
    const group = store.quickCommandGroups.find(g => g.id === id)
    if (group) {
        confirmAction(t('settings.deleteConfirmBody', { name: group.name }), () => deleteQuickCommandGroup(id))
    }
}

/**
 * @description 执行快捷命令分组删除：组内命令降级为未分组（groupId 清空）
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

const suggestionsTriggerOptions = computed(() => [
    { value: 'auto', label: t('settings.suggestionsTriggerAuto') },
    { value: 'manual', label: t('settings.suggestionsTriggerManual') },
])

/**
 * @description 清空全部命令历史并刷新内存索引（设置页入口）
 * @returns Promise<void>
 *
 * @example await onClearHistory()
 *
 */
async function onClearHistory (): Promise<void> {
    await clearHistory()
}

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
            <Transition name="page-fade" mode="out-in">
            <div v-if="page === 'terminal'" key="terminal">
                <h2>{{ t('settings.terminal') }}</h2>

                <div class="settings-section">
                    <h3 class="settings-section-title">{{ t('settings.sectionFontDisplay') }}</h3>
                    <div class="settings-card">
                        <div class="settings-card-row stacked">
                            <div class="settings-row-head">
                                <Label>{{ t('settings.fontSize') }}</Label>
                                <span class="value-hint">{{ store.terminal.fontSize }}</span>
                            </div>
                            <Slider v-model="store.terminal.fontSize" :min="8" :max="32" :step="1" />
                        </div>
                        <div class="settings-card-row">
                            <Label>{{ t('settings.fontFamily') }}</Label>
                            <!-- list_fonts 不可用时回退自由文本输入 -->
                            <SearchableSelect
                                v-if="systemFonts.length > 0"
                                v-model="store.terminal.font"
                                :options="fontOptions"
                                class="w-60"
                                :placeholder="t('settings.searchPlaceholder')"
                            />
                            <Input v-else v-model="store.terminal.font" placeholder="monospace" class="w-60" />
                        </div>
                        <div class="settings-card-row">
                            <Label>{{ t('settings.fontWeight') }}</Label>
                            <Select v-model="store.terminal.fontWeight" :options="fontWeightOptions" class="w-44" />
                        </div>
                        <div class="settings-card-row">
                            <Label>{{ t('settings.fontWeightBold') }}</Label>
                            <Select v-model="store.terminal.fontWeightBold" :options="fontWeightOptions" class="w-44" />
                        </div>
                        <div class="settings-card-row stacked">
                            <div class="settings-row-head">
                                <Label>{{ t('settings.linePadding') }}</Label>
                                <span class="value-hint">{{ store.terminal.linePadding }}</span>
                            </div>
                            <Slider v-model="store.terminal.linePadding" :min="0" :max="8" :step="1" />
                        </div>
                        <div class="settings-card-row stacked">
                            <div class="settings-row-head">
                                <Label>{{ t('settings.minimumContrast') }}</Label>
                                <span class="value-hint">{{ store.terminal.minimumContrastRatio }}</span>
                            </div>
                            <Slider v-model="store.terminal.minimumContrastRatio" :min="1" :max="7" :step="0.5" />
                        </div>
                        <div class="settings-card-row">
                            <Label>{{ t('settings.boldInBright') }}</Label>
                            <Switch v-model="store.terminal.drawBoldTextInBrightColors" />
                        </div>
                        <div class="settings-card-row">
                            <Label>{{ t('settings.paletteGenerate') }}</Label>
                            <Switch v-model="store.terminal.paletteGenerate" />
                        </div>
                        <div class="settings-card-row">
                            <Label>{{ t('settings.paletteHarmonious') }}</Label>
                            <Switch v-model="store.terminal.paletteHarmonious" :disabled="!store.terminal.paletteGenerate" />
                        </div>
                    </div>
                </div>

                <div class="settings-section">
                    <h3 class="settings-section-title">{{ t('settings.sectionCursor') }}</h3>
                    <div class="settings-card">
                        <div class="settings-card-row">
                            <Label>{{ t('settings.cursorStyle') }}</Label>
                            <Select v-model="store.terminal.cursor" :options="cursorOptions" class="w-44" />
                        </div>
                        <div class="settings-card-row">
                            <Label>{{ t('settings.cursorBlink') }}</Label>
                            <Switch v-model="store.terminal.cursorBlink" />
                        </div>
                    </div>
                </div>

                <div class="settings-section">
                    <h3 class="settings-section-title">{{ t('settings.sectionInteraction') }}</h3>
                    <div class="settings-card">
                        <div class="settings-card-row">
                            <Label>{{ t('settings.scrollback') }}</Label>
                            <Input v-model.number="store.terminal.scrollbackLines" type="number" class="w-44" />
                        </div>
                        <div class="settings-card-row">
                            <Label>{{ t('settings.copyOnSelect') }}</Label>
                            <Switch v-model="store.terminal.copyOnSelect" />
                        </div>
                        <div class="settings-card-row">
                            <Label>{{ t('settings.altIsMeta') }}</Label>
                            <Switch v-model="store.terminal.altIsMeta" />
                        </div>
                        <div class="settings-card-row">
                            <Label>{{ t('settings.wordSeparator') }}</Label>
                            <Input v-model="store.terminal.wordSeparator" class="w-44" />
                        </div>
                    </div>
                </div>

                <div class="settings-section">
                    <h3 class="settings-section-title">{{ t('settings.sectionCompatibility') }}</h3>
                    <p class="settings-section-hint">{{ t('settings.middlewareHint') }}</p>
                    <div class="settings-card">
                        <div class="settings-card-row">
                            <Label>{{ t('settings.backspace') }}</Label>
                            <Select v-model="store.terminal.backspace" :options="backspaceOptions" class="w-44" />
                        </div>
                        <div class="settings-card-row">
                            <Label>{{ t('settings.inputNewlines') }}</Label>
                            <Select v-model="inputNewlinesModel" :options="newlineOptions" class="w-44" />
                        </div>
                        <div class="settings-card-row">
                            <Label>{{ t('settings.outputNewlines') }}</Label>
                            <Select v-model="outputNewlinesModel" :options="newlineOptions" class="w-44" />
                        </div>
                    </div>
                </div>

                <div class="settings-section">
                    <h3 class="settings-section-title">{{ t('settings.suggestionsTitle') }}</h3>
                    <div class="settings-card">
                        <div class="settings-card-row">
                            <Label>{{ t('settings.suggestionsEnabled') }}</Label>
                            <Switch v-model="store.terminal.suggestions.enabled" />
                        </div>
                        <div class="settings-card-row">
                            <Label>{{ t('settings.suggestionsTrigger') }}</Label>
                            <Select v-model="store.terminal.suggestions.trigger" :options="suggestionsTriggerOptions" class="w-44" />
                        </div>
                        <div class="settings-card-row stacked">
                            <div class="settings-row-head">
                                <Label>{{ t('settings.suggestionsDelay') }}</Label>
                                <span class="value-hint">{{ store.terminal.suggestions.delay }}</span>
                            </div>
                            <Slider v-model="store.terminal.suggestions.delay" :min="100" :max="1000" :step="50" />
                        </div>
                        <div class="settings-card-row">
                            <Label>{{ t('settings.suggestionsSourceHistory') }}</Label>
                            <Switch v-model="store.terminal.suggestions.sources.history" />
                        </div>
                        <div class="settings-card-row">
                            <Label>{{ t('settings.suggestionsSourceQuickCommands') }}</Label>
                            <Switch v-model="store.terminal.suggestions.sources.quickCommands" />
                        </div>
                        <div class="settings-card-row">
                            <Label>{{ t('settings.suggestionsSourcePaths') }}</Label>
                            <Switch v-model="store.terminal.suggestions.sources.paths" />
                        </div>
                        <div class="settings-card-row">
                            <Label>{{ t('settings.suggestionsHistoryLabel') }}</Label>
                            <Button variant="outline" size="sm" @click="onClearHistory">{{ t('settings.clear') }}</Button>
                        </div>
                    </div>
                </div>
            </div>

            <div v-else-if="page === 'profiles'" key="profiles">
                <h2>{{ t('settings.localTerminalPage') }}</h2>
                <div class="master-detail">
                    <div class="detail-list">
                        <div class="profile-new-group">
                            <button class="profile-new-button" @click="createLocalProfile">
                                <Plus :size="14" />
                                <span>{{ t('settings.profileNew') }}</span>
                            </button>
                        </div>
                        <button
                            v-for="p in localProfiles"
                            :key="p.id"
                            class="profile-item"
                            :class="{ active: p.id === selectedLocalProfile?.id }"
                            @click="selectedLocalProfileId = p.id"
                        >
                            <span class="profile-item-head">
                                <span class="profile-item-name">{{ p.name }}</span>
                                <span v-if="p.isDefault" class="profile-default-badge">{{ t('tab.defaultProfile') }}</span>
                            </span>
                            <span class="profile-item-command">{{ p.command }}</span>
                        </button>
                    </div>
                    <div v-if="selectedLocalProfile" class="detail-content">
                        <div class="settings-section">
                            <h3 class="settings-section-title">{{ t('settings.profileSectionBasic') }}</h3>
                            <div class="settings-card">
                                <div class="settings-card-row">
                                    <Label>{{ t('settings.profileName') }}</Label>
                                    <Input v-model="selectedLocalProfile.name" class="w-60" />
                                </div>
                                <div class="settings-card-row">
                                    <Label>{{ t('settings.profileColorScheme') }}</Label>
                                    <SearchableSelect
                                        v-model="localColorSchemeModel"
                                        :options="profileColorSchemeOptions"
                                        class="w-60"
                                        :placeholder="t('settings.searchPlaceholder')"
                                    />
                                </div>
                            </div>
                        </div>

                        <div class="settings-section">
                            <h3 class="settings-section-title">{{ t('settings.profileSectionCommand') }}</h3>
                            <div class="settings-card">
                                <div class="settings-card-row">
                                    <Label>{{ t('settings.profileCommand') }}</Label>
                                    <Input v-model="selectedLocalProfile.command" class="w-60" />
                                </div>
                                <div class="settings-card-row">
                                    <Label>{{ t('settings.profileArgs') }} <span class="value-hint">{{ t('settings.profileArgsHint') }}</span></Label>
                                    <Input v-model="argsText" class="w-60" />
                                </div>
                                <div class="settings-card-row">
                                    <Label>{{ t('settings.profileCwd') }}</Label>
                                    <Input v-model="cwdModel" class="w-60" />
                                </div>
                                <div class="settings-card-row stacked">
                                    <Label>{{ t('settings.profileEnv') }} <span class="value-hint">{{ t('settings.profileEnvHint') }}</span></Label>
                                    <textarea v-model="envText" class="profile-env" rows="4" spellcheck="false"></textarea>
                                </div>
                                <div class="settings-card-row">
                                    <Label>{{ t('settings.profileLoginShell') }}</Label>
                                    <Switch v-model="selectedLocalProfile.loginShell" />
                                </div>
                            </div>
                        </div>

                        <div class="profile-actions">
                            <Button
                                variant="outline"
                                size="sm"
                                :disabled="selectedLocalProfile.isDefault"
                                @click="config.setDefaultProfile(selectedLocalProfile.id)"
                            >
                                {{ t('settings.profileSetDefault') }}
                            </Button>
                            <Button variant="destructive-outline" size="sm" @click="confirmDeleteProfile(selectedLocalProfile)">
                                <Trash2 :size="14" />
                                {{ t('settings.profileDelete') }}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            <div v-else-if="page === 'ssh'" key="ssh">
                <h2>{{ t('settings.sshPage') }}</h2>
                <div class="master-detail">
                    <div class="detail-list">
                        <div class="profile-new-group">
                            <button class="profile-new-button" @click="createSshProfile">
                                <Plus :size="14" />
                                <span>{{ t('settings.sshNew') }}</span>
                            </button>
                            <button class="profile-new-button" @click="openCreateSshGroup">
                                <Plus :size="14" />
                                <span>{{ t('settings.sshNewGroup') }}</span>
                            </button>
                        </div>
                        <template v-for="section in sshSections" :key="section.groupId ?? '__default'">
                            <div class="qc-group-header">
                                <span class="qc-group-name">{{ section.title }}</span>
                                <span v-if="section.groupId !== null" class="qc-group-actions">
                                    <button class="qc-group-action" :title="t('settings.sshRenameGroup')" @click.stop="openRenameSshGroup(section.groupId!)">
                                        <Pencil :size="12" />
                                    </button>
                                    <button class="qc-group-action" :title="t('settings.sshDeleteGroup')" @click.stop="confirmDeleteSshGroup(section.groupId!)">
                                        <X :size="12" />
                                    </button>
                                </span>
                            </div>
                            <button
                                v-for="p in section.items"
                                :key="p.id"
                                class="profile-item"
                                :class="{ active: p.id === selectedSshProfile?.id }"
                                @click="selectedSshProfileId = p.id"
                            >
                                <span class="profile-item-head">
                                    <span class="profile-item-name">{{ p.name }}</span>
                                    <span v-if="p.isDefault" class="profile-default-badge">{{ t('tab.defaultProfile') }}</span>
                                </span>
                                <span class="profile-item-command">{{ `${p.user}@${p.host}${p.port === 22 ? '' : `:${p.port}`}` }}</span>
                            </button>
                        </template>
                        <p v-if="sshProfiles.length === 0 && store.sshGroups.length === 0" class="hint">
                            {{ t('settings.sshEmptyHint') }}
                        </p>
                    </div>
                    <div v-if="selectedSshProfile" class="detail-content">
                        <div class="settings-section">
                            <h3 class="settings-section-title">{{ t('settings.profileSectionBasic') }}</h3>
                            <div class="settings-card">
                                <div class="settings-card-row">
                                    <Label>{{ t('settings.profileName') }}</Label>
                                    <Input v-model="selectedSshProfile.name" class="w-60" />
                                </div>
                                <div class="settings-card-row">
                                    <Label>{{ t('settings.profileColorScheme') }}</Label>
                                    <SearchableSelect
                                        v-model="sshColorSchemeModel"
                                        :options="profileColorSchemeOptions"
                                        class="w-60"
                                        :placeholder="t('settings.searchPlaceholder')"
                                    />
                                </div>
                                <div class="settings-card-row">
                                    <Label>{{ t('settings.sshGroupLabel') }}</Label>
                                    <Select v-model="sshGroupModel" :options="sshGroupOptions" class="w-60" />
                                </div>
                            </div>
                        </div>

                        <div class="settings-section">
                            <h3 class="settings-section-title">{{ t('settings.profileSectionConnection') }}</h3>
                            <div class="settings-card">
                                <div class="settings-card-row">
                                    <Label>{{ t('settings.sshHost') }}</Label>
                                    <Input v-model="selectedSshProfile.host" class="w-60" placeholder="example.com" />
                                </div>
                                <div class="settings-card-row">
                                    <Label>{{ t('settings.sshPort') }}</Label>
                                    <Input v-model.number="selectedSshProfile.port" type="number" class="w-24" />
                                </div>
                                <div class="settings-card-row">
                                    <Label>{{ t('settings.sshUser') }}</Label>
                                    <Input v-model="selectedSshProfile.user" class="w-60" />
                                </div>
                                <div class="settings-card-row">
                                    <Label>{{ t('settings.sshAuth') }}</Label>
                                    <Select v-model="selectedSshProfile.auth" :options="sshAuthOptions" class="w-44" />
                                </div>
                                <div v-if="selectedSshProfile.auth === 'publicKey' || selectedSshProfile.auth === 'auto'" class="settings-card-row">
                                    <Label>{{ t('settings.keychain') }} <span class="value-hint">{{ t('settings.keychainHint') }}</span></Label>
                                    <Select v-model="keyIdModel" :options="sshKeyOptions" class="w-60" />
                                </div>
                                <div v-if="selectedSshProfile.auth === 'password' || selectedSshProfile.auth === 'auto'" class="settings-card-row">
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
                                </div>
                                <div v-if="passwordEditorOpen && (selectedSshProfile.auth === 'password' || selectedSshProfile.auth === 'auto')" class="settings-card-row stacked">
                                    <Label>{{ t('settings.sshPassword') }}</Label>
                                    <div class="ssh-password-editor">
                                        <Input v-model="passwordDraft" type="password" class="w-60" :placeholder="t('settings.sshPasswordPlaceholder')" />
                                        <Button size="sm" @click="saveProfilePassword">{{ t('settings.sshPasswordSave') }}</Button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <ProfileForwardingsCard :profile="selectedSshProfile" />

                        <div class="profile-actions">
                            <Button
                                variant="outline"
                                size="sm"
                                :disabled="selectedSshProfile.isDefault"
                                @click="config.setDefaultProfile(selectedSshProfile.id)"
                            >
                                {{ t('settings.profileSetDefault') }}
                            </Button>
                            <Button variant="destructive-outline" size="sm" @click="confirmDeleteProfile(selectedSshProfile)">
                                <Trash2 :size="14" />
                                {{ t('settings.profileDelete') }}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            <div v-else-if="page === 'quickCommands'" key="quickCommands">
                <h2>{{ t('settings.quickCommands') }}</h2>
                <div class="master-detail">
                    <div class="detail-list">
                        <div class="profile-new-group">
                            <button class="profile-new-button" @click="createQuickCommand">
                                <Plus :size="14" />
                                <span>{{ t('settings.quickCommandNew') }}</span>
                            </button>
                            <button class="profile-new-button" @click="openCreateQuickCommandGroup">
                                <Plus :size="14" />
                                <span>{{ t('settings.quickCommandNewGroup') }}</span>
                            </button>
                        </div>
                        <template v-for="section in quickCommandSections" :key="section.groupId ?? '__ungrouped'">
                            <div v-if="section.title !== null" class="qc-group-header">
                                <span class="qc-group-name">{{ section.title }}</span>
                                <span class="qc-group-actions">
                                    <button class="qc-group-action" :title="t('settings.quickCommandRenameGroup')" @click.stop="openRenameQuickCommandGroup(section.groupId!)">
                                        <Pencil :size="12" />
                                    </button>
                                    <button class="qc-group-action" :title="t('settings.quickCommandDeleteGroup')" @click.stop="confirmDeleteQuickCommandGroup(section.groupId!)">
                                        <X :size="12" />
                                    </button>
                                </span>
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
                    <div v-if="selectedQuickCommand" class="detail-content">
                        <div class="settings-section">
                            <div class="settings-card">
                                <div class="settings-card-row">
                                    <Label>{{ t('settings.quickCommandName') }}</Label>
                                    <Input v-model="selectedQuickCommand.name" class="w-60" />
                                </div>
                                <div class="settings-card-row">
                                    <Label>{{ t('settings.quickCommandGroupLabel') }}</Label>
                                    <Select v-model="quickCommandGroupModel" :options="quickCommandGroupOptions" class="w-60" />
                                </div>
                                <div class="settings-card-row stacked">
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
                                    <p v-if="selectedQuickCommandParams.length" class="hint qc-params-hint">
                                        {{ t('settings.quickCommandParams', { names: selectedQuickCommandParams.join(', ') }) }}
                                    </p>
                                </div>
                                <div class="settings-card-row">
                                    <Label>
                                        {{ t('settings.quickCommandAutoRun') }}
                                        <span class="value-hint">{{ t('settings.quickCommandAutoRunHint') }}</span>
                                    </Label>
                                    <Switch v-model="selectedQuickCommand.autoRun" />
                                </div>
                                <div class="settings-card-row actions">
                                    <Button variant="destructive-outline" size="sm" @click="confirmDeleteQuickCommand(selectedQuickCommand)">
                                        <Trash2 :size="14" />
                                        {{ t('settings.quickCommandDelete') }}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div v-else-if="page === 'keys'" key="keys">
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

            <div v-else-if="page === 'appearance'" key="appearance">
                <h2>{{ t('settings.appearance') }}</h2>
                <div class="settings-section">
                    <div class="settings-card">
                        <div class="settings-card-row">
                            <Label>{{ t('settings.language') }}</Label>
                            <Select v-model="store.appearance.language" :options="languageOptions" class="w-44" />
                        </div>
                        <div class="settings-card-row">
                            <Label>{{ t('settings.tabBarPosition') }}</Label>
                            <Select v-model="store.appearance.tabBarPosition" :options="tabBarPositionOptions" class="w-44" />
                        </div>
                    </div>
                </div>
                <div class="settings-section">
                    <div class="settings-card">
                        <div class="settings-card-row">
                            <Label>{{ t('settings.backgroundImage') }}</Label>
                            <div class="background-image-row">
                                <div
                                    v-if="backgroundPreviewUrl"
                                    class="background-image-preview"
                                    :style="{ backgroundImage: `url(${backgroundPreviewUrl})` }"
                                ></div>
                                <Button variant="outline" size="sm" @click="chooseBackgroundImage">
                                    {{ t('settings.backgroundImageChoose') }}
                                </Button>
                                <Button
                                    v-if="store.appearance.backgroundImage"
                                    variant="outline"
                                    size="sm"
                                    @click="clearBackgroundImage"
                                >
                                    {{ t('settings.backgroundImageClear') }}
                                </Button>
                            </div>
                        </div>
                        <div class="settings-card-row stacked">
                            <div class="settings-row-head">
                                <Label>{{ t('settings.backgroundImageOpacity') }}</Label>
                                <span class="value-hint">{{ Math.round(store.appearance.backgroundOpacity * 100) }}%</span>
                            </div>
                            <Slider v-model="store.appearance.backgroundOpacity" :min="0.05" :max="1" :step="0.05" />
                        </div>
                        <div class="settings-card-row">
                            <Label>{{ t('settings.backgroundImageFit') }}</Label>
                            <Select v-model="store.appearance.backgroundFit" :options="backgroundFitOptions" class="w-44" />
                        </div>
                    </div>
                </div>
                <div class="settings-section">
                    <h3 class="settings-section-title">{{ t('settings.notifications') }}</h3>
                    <div class="settings-card">
                        <div class="settings-card-row">
                            <Label>{{ t('settings.bellNotifications') }}</Label>
                            <Switch v-model="store.appearance.bellNotifications" />
                        </div>
                    </div>
                </div>
            </div>

            <div v-else-if="page === 'colorSchemes'" key="colorSchemes">
                <h2>{{ t('settings.colorSchemesPage') }}</h2>
                <ColorSchemePicker v-model="store.appearance.colorScheme" :custom-schemes="store.colorSchemes" />
                <div class="settings-section">
                    <div class="settings-section-head">
                        <h3 class="settings-section-title">{{ t('settings.customSchemes') }}</h3>
                        <div class="settings-section-actions">
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
                        <div v-if="selectedCustom" class="settings-card">
                            <div class="settings-card-row">
                                <Label>{{ t('settings.profileName') }}</Label>
                                <Input v-model="selectedCustom.name" class="w-60" />
                            </div>
                            <div class="settings-card-row stacked">
                                <Label>{{ t('settings.schemePreviewLabel') }}</Label>
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
                            </div>
                            <div class="settings-card-row stacked">
                                <Label>{{ t('settings.schemeSlotsLabel') }}</Label>
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
                            </div>
                            <div class="settings-card-row actions">
                                <Button variant="destructive-outline" size="sm" @click="confirmDeleteCustomScheme(selectedCustom.name, selectedCustomIndex)">
                                    <Trash2 :size="14" />
                                    {{ t('settings.customSchemeDelete') }}
                                </Button>
                            </div>
                        </div>
                    </template>
                </div>
            </div>

            <div v-else-if="page === 'hotkeys'" key="hotkeys">
                <h2>{{ t('settings.hotkeys') }}</h2>
                <p class="hint">{{ t('settings.hotkeysHint') }}</p>
                <div class="settings-section">
                    <div class="settings-card">
                        <div
                            v-for="command in hotkeyCommands"
                            :key="command.id"
                            class="settings-card-row"
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
                    </div>
                </div>
            </div>

            <div v-else-if="page === 'tabGroups'" key="tabGroups">
                <h2>{{ t('settings.tabGroupsPage') }}</h2>
                <p class="hint">{{ t('settings.tabGroupsPersistHint') }}</p>
                <div class="settings-section">
                    <div class="profile-new-group">
                        <button class="profile-new-button" @click="openCreateTabGroup">
                            <Plus :size="14" />
                            <span>{{ t('settings.tabGroupsNewGroup') }}</span>
                        </button>
                    </div>
                    <p v-if="store.tabGroups.length === 0" class="hint">{{ t('settings.tabGroupsEmptyHint') }}</p>
                    <div v-for="group in store.tabGroups" :key="group.id" class="settings-card tab-group-row">
                        <span class="tab-group-name">
                            <span v-if="group.color" class="tab-color-dot" :style="{ background: group.color }"></span>
                            {{ group.name }}
                        </span>
                        <span v-if="group.persistTabs" class="tab-group-meta">{{ t('settings.tabGroupsPersistBadge') }}</span>
                        <span class="tab-group-meta">{{ t('settings.tabGroupsMemberCount', { n: tabGroupMemberCounts[group.id] ?? 0 }) }}</span>
                        <span class="tab-group-actions">
                            <button class="qc-group-action" :title="t('settings.tabGroupsEditGroup')" @click="openEditTabGroup(group)">
                                <Pencil :size="12" />
                            </button>
                            <button class="qc-group-action" :title="t('settings.tabGroupsDeleteGroup')" @click="confirmDeleteTabGroup(group)">
                                <X :size="12" />
                            </button>
                        </span>
                    </div>
                </div>
            </div>

            <div v-else key="about">
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
            </div>
            </Transition>
        </div>

        <Dialog v-if="confirmState" :title="t('settings.deleteConfirmTitle')" :width="380" @cancel="confirmState = null">
            <p class="confirm-text">{{ confirmState.message }}</p>
            <template #footer>
                <Button variant="outline" size="sm" @click="confirmState = null">{{ t('settings.cancel') }}</Button>
                <Button variant="destructive" size="sm" @click="runConfirmed">{{ t('settings.deleteConfirmButton') }}</Button>
            </template>
        </Dialog>

        <TabGroupFormDialog
            v-model:open="tabGroupDialogOpen"
            :editing="editingTabGroup"
            :title="editingTabGroup ? t('settings.tabGroupsEditGroup') : t('settings.tabGroupsNewGroup')"
            @submit="commitTabGroupDialog"
        />

        <Dialog v-if="groupNameDialog" :title="groupNameDialogTitle" :width="380" @cancel="groupNameDialog = null">
            <div class="group-name-form">
                <Label>{{ t('settings.groupNameLabel') }}</Label>
                <Input v-model="groupNameDialog.draft" @keydown.enter.prevent="commitGroupNameDialog" />
            </div>
            <template #footer>
                <Button variant="outline" size="sm" @click="groupNameDialog = null">{{ t('settings.cancel') }}</Button>
                <Button size="sm" :disabled="!groupNameDialog.draft.trim()" @click="commitGroupNameDialog">{{ t('settings.confirm') }}</Button>
            </template>
        </Dialog>

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
    cursor: pointer;
    transition: background-color 0.25s ease, color 0.25s ease;
}

.settings-nav-item:hover {
    background: var(--color-accent);
    color: var(--color-accent-foreground);
}

/* 选中态用 primary 混色，与悬停态（accent）明确区分 */
.settings-nav-item.active {
    background: color-mix(in oklch, var(--color-primary) 14%, transparent);
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
    font-family: var(--font-mono);
    font-size: 12px;
}

/* 设置页分组卡片：标题 + 卡片内逐行排布（行间以细线分隔），简单页面共用 */
.settings-section {
    max-width: 620px;
    margin-bottom: 22px;
}

.settings-section-title {
    margin: 0 0 8px;
    font-size: 13px;
    font-weight: 600;
}

.settings-section-hint {
    margin: -4px 0 8px;
    font-size: 12px;
    color: var(--color-muted-foreground);
}

.settings-card {
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-card);
}

.settings-card-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 11px 16px;
}

.settings-card-row + .settings-card-row {
    border-top: 1px solid var(--color-border);
}

.settings-card-row.stacked {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
}

.settings-row-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
}

/* 背景图片行：缩略预览 + 选择/清除按钮 */
.background-image-row {
    display: flex;
    align-items: center;
    gap: 8px;
}

.background-image-preview {
    width: 40px;
    height: 26px;
    border-radius: 4px;
    border: 1px solid var(--color-border);
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
    flex-shrink: 0;
}

.settings-section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
}

.settings-section-head .settings-section-title {
    margin: 0;
}

.settings-section-actions {
    display: flex;
    align-items: center;
    gap: 8px;
}

.settings-card-row.actions {
    justify-content: flex-end;
}

/* 档案/快捷命令/密钥链共用的主从布局：左列表 + 右编辑内容 */
.master-detail {
    display: flex;
    gap: 20px;
    align-items: flex-start;
}

.master-detail .detail-list {
    width: 240px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.master-detail .detail-content {
    flex: 1 1 0;
    min-width: 0;
    max-width: 620px;
}

.profile-actions {
    display: flex;
    gap: 8px;
}

.confirm-text {
    margin: 0;
    word-break: break-all;
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

.key-fingerprint {
    word-break: break-all;
    text-align: right;
}

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

.hint {
    color: var(--color-muted-foreground);
    font-size: 13px;
    margin-bottom: 16px;
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
    cursor: pointer;
    transition: color 0.25s ease, border-color 0.25s ease;
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
    cursor: pointer;
    transition: background-color 0.25s ease;
}

.profile-item:hover {
    background: var(--color-accent);
}

/* 选中态用 primary 混色，与悬停态（accent）明确区分 */
.profile-item.active {
    background: color-mix(in oklch, var(--color-primary) 14%, transparent);
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
    font-size: 11px;
    line-height: 18px;
}

.profile-item-command {
    font-size: 11px;
    color: var(--color-muted-foreground);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.profile-env {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--color-input);
    border-radius: 6px;
    background: transparent;
    color: var(--color-foreground);
    font-family: var(--font-mono);
    font-size: 12px;
    resize: vertical;
    outline: none;
}

.profile-env:focus-visible {
    border-color: var(--color-ring);
    box-shadow: 0 0 0 1px var(--color-ring);
}

/* 内容三态（名称文本/改名输入框/操作按钮）统一 22px 高：进入/退出编辑不改变行高 */
.qc-group-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
    padding: 12px 6px 4px;
    border-bottom: 1px solid var(--color-border);
    margin-bottom: 4px;
}

.qc-group-name {
    font-size: 12px;
    font-weight: 600;
    line-height: 22px;
    color: var(--color-foreground);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

/* 隐藏但保留占位（visibility 而非 display）避免行高变化；opacity 过渡实现图标淡入淡出 */
.qc-group-actions {
    display: inline-flex;
    gap: 2px;
    flex-shrink: 0;
    visibility: hidden;
    opacity: 0;
    transition: opacity 0.25s ease, visibility 0.25s ease;
}

.qc-group-header:hover .qc-group-actions {
    visibility: visible;
    opacity: 1;
}

.qc-group-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--color-muted-foreground);
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease;
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
    font-size: 11px;
    line-height: 16px;
}

.qc-command-input {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--color-input);
    border-radius: 6px;
    background: transparent;
    color: var(--color-foreground);
    font-family: var(--font-mono);
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
    cursor: pointer;
    transition: color 0.25s ease, border-color 0.25s ease, background-color 0.25s ease;
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

.scheme-preview {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    font-family: var(--font-mono);
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
    border: 1px solid var(--color-border);
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
    font-family: var(--font-mono);
    font-size: 12px;
    outline: none;
}

.hotkey-binding {
    min-width: 120px;
    padding: 4px 10px;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: var(--color-secondary);
    color: var(--color-foreground);
    font-family: var(--font-mono);
    font-size: 12px;
    text-align: center;
    cursor: pointer;
    transition: border-color 0.25s ease;
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

/* ---- 标签分组页 ---- */

.tab-group-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
}

.tab-group-name {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 120px;
    font-size: 13px;
    color: var(--color-foreground);
    cursor: default;
}

.tab-color-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
}

/* 分组行操作按钮列：推到行尾对齐 */
.tab-group-actions {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
}

.tab-group-meta {
    font-size: 12px;
    color: var(--color-muted-foreground);
    font-variant-numeric: tabular-nums;
}

/* 分组名称弹窗（SSH/快捷命令共用） */
.group-name-form {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.qc-group-action.danger {
    color: var(--color-destructive);
}

.qc-group-action.danger:hover {
    background: color-mix(in oklch, var(--color-destructive) 20%, transparent);
    color: var(--color-destructive);
}
</style>
