<!--
  @description 设置·SSH 页：SSH 档案主从管理（分组列表 + 连接/认证/密码编辑器 +
              档案级端口转发卡片）；编辑器走草稿模式（改动经「保存」按钮提交，
              不再实时写入 store）；密钥下拉数据由本页挂载时拉取（页面互斥挂载，
              密钥页改动后切回即重载）。
-->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { nanoid } from 'nanoid'
import { Plus, Trash2 } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Select from '@/components/ui/Select.vue'
import SearchableSelect from '@/components/ui/SearchableSelect.vue'
import ProfileForwardingsCard from '@/components/settings/ProfileForwardingsCard.vue'
import GroupAccordion from '@/components/settings/GroupAccordion.vue'
import { useConfigStore, reorderGroups, type SshProfile, type MoshProfile, type RemoteProfile } from '@/stores/config'
import { useMonitorStore } from '@/stores/monitor'
import { builtinColorSchemes } from '@/lib/colorSchemes'
import { groupQuickCommandSections } from '@/lib/quickCommands'
import { listSshKeys, setProfilePassword, removeProfilePassword, hasProfilePassword, type SshKeyMeta } from '@/services/secrets'
import { confirmAction } from '@/components/settings/useConfirmAction'
import { useDraftEditor } from '@/components/settings/useDraftEditor'
import { openCreateSshGroup, openRenameSshGroup } from '@/components/settings/useGroupNameDialog'

const { t } = useI18n()
const config = useConfigStore()
const store = config.store
const monitorStore = useMonitorStore()

const sshProfiles = computed(() => store.profiles.filter((p): p is RemoteProfile => p.type === 'ssh' || p.type === 'mosh'))
const selectedSshProfileId = ref<string | null>(null)
const selectedSshProfile = computed<RemoteProfile | null>(() =>
    sshProfiles.value.find(p => p.id === selectedSshProfileId.value)
    ?? sshProfiles.value[0]
    ?? null)

/** 新建草稿的协议类型（create 回调读取；点「新建 SSH/Mosh」按钮时设置） */
const nextCreateKind = ref<'ssh' | 'mosh'>('ssh')

/** 草稿编辑器：表单（含端口转发卡片）只改草稿副本，「保存」时统一提交 store */
const sshEditor = useDraftEditor<RemoteProfile>({
    create: () => nextCreateKind.value === 'mosh' ? buildMoshProfile() : buildSshProfile(),
    persist: (draft, isNew) => {
        if (isNew) {
            store.profiles.push(draft)
            selectedSshProfileId.value = draft.id
            return
        }
        const target = store.profiles.find(p => p.id === draft.id)
        if (target) {
            Object.assign(target, draft)
        }
    },
})
const { draft: sshDraft, isNew: isNewSshDraft, dirty: isSshDraftDirty } = sshEditor

/**
 * @description 把编辑器同步到当前选中项（选中变化/删除后的兜底收敛均走这里）
 * @returns void
 *
 * @example syncEditorToSelection()
 *
 */
function syncEditorToSelection (): void {
    if (selectedSshProfile.value) {
        sshEditor.edit(selectedSshProfile.value)
    } else {
        sshEditor.clear()
    }
}

watch(selectedSshProfile, syncEditorToSelection, { immediate: true })

/**
 * @description 选中左侧列表档案（有未保存修改时经确认弹窗放行）
 * @param profile 目标档案
 * @returns void
 *
 * @example selectSshProfile(profile)
 *
 */
function selectSshProfile (profile: RemoteProfile): void {
    sshEditor.guard(t('settings.unsavedChangesBody'), () => {
        if (profile.id !== selectedSshProfileId.value) {
            selectedSshProfileId.value = profile.id
        } else {
            // 新建草稿打开时点回当前选中项：直接回到该档案
            sshEditor.edit(profile)
        }
    }, t('settings.unsavedChangesDiscard'), t('settings.unsavedChangesTitle'))
}

/** SSH 左列表分段：默认分组置顶（固定标题、不可改名/删除），其余按手动顺序带小节头 */
const sshSections = computed(() => {
    const sections = groupQuickCommandSections(sshProfiles.value, store.sshGroups)
        .map(section => section.groupId === null ? { ...section, title: t('settings.sshDefaultGroup') } : section)
    // 没有未分组档案时也保持默认分组段置顶（空段常驻可见）
    if (sshProfiles.value.length > 0 && !sections.some(section => section.groupId === null)) {
        sections.unshift({ title: t('settings.sshDefaultGroup'), groupId: null, items: [] })
    }
    return sections
})

/** 默认分组段在手风琴分段键中的键 */
const SSH_DEFAULT_KEY = '__default'

/** SSH 手风琴分段视图（GroupAccordion 消费） */
const sshAccordionSections = computed(() => sshSections.value.map(section => ({
    key: section.groupId ?? SSH_DEFAULT_KEY,
    title: section.title ?? t('settings.sshDefaultGroup'),
    count: section.items.length,
    manageable: section.groupId !== null,
    sortable: section.groupId !== null,
    data: section,
})))

/** 自动展开目标：选中档案所在分段 */
const selectedSshSectionKey = computed(() =>
    sshAccordionSections.value.find(section => section.data.items.some(p => p.id === selectedSshProfile.value?.id))?.key)

/** 编辑器分组下拉：默认分组 + 各分组（新建草稿未保存时也可选择，保存时一并提交） */
const sshGroupOptions = computed(() => [
    { value: '', label: t('settings.sshDefaultGroup') },
    ...store.sshGroups.map(group => ({ value: group.id, label: group.name })),
])

const sshGroupModel = computed({
    get: () => sshDraft.value?.groupId ?? '',
    set: (value: string) => {
        const profile = sshDraft.value
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

const profileColorSchemeOptions = computed(() => [
    { value: '', label: t('settings.profileColorSchemeGlobal') },
    { value: 'auto', label: t('settings.colorSchemeAuto') },
    ...builtinColorSchemes.map(scheme => ({ value: scheme.name, label: scheme.name })),
])

const sshColorSchemeModel = computed({
    get: () => sshDraft.value?.colorScheme ?? '',
    set: (value: string) => {
        const profile = sshDraft.value
        if (profile) {
            profile.colorScheme = value || null
        }
    },
})

const sshAuthOptions = computed(() => [
    { value: 'auto', label: t('settings.sshAuthAuto') },
    { value: 'agent', label: t('settings.sshAuthAgent') },
    { value: 'publicKey', label: t('settings.sshAuthPublicKey') },
    { value: 'password', label: t('settings.sshAuthPassword') },
])

/** Mosh UDP 端口表单模型：空串 ↔ null（60000-61000 默认范围） */
const moshPortModel = computed({
    get: () => (sshDraft.value?.type === 'mosh' ? sshDraft.value.moshPort : null)?.toString() ?? '',
    set: (value: string) => {
        const profile = sshDraft.value
        if (profile && profile.type === 'mosh') {
            const parsed = Number.parseInt(value, 10)
            profile.moshPort = Number.isFinite(parsed) && value !== '' ? parsed : null
        }
    },
})

// ---- 密钥链下拉（密钥页管理条目；本页仅消费元数据列表） ----
const sshKeys = ref<SshKeyMeta[]>([])

onMounted(async () => {
    try {
        sshKeys.value = await listSshKeys()
    } catch (error) {
        console.error('could not load ssh keys', error)
    }
})

const keyIdModel = computed({
    get: () => (sshDraft.value?.type === 'ssh' ? sshDraft.value.keyId : '') ?? '',
    set: (value: string) => {
        const profile = sshDraft.value
        if (profile && profile.type === 'ssh') {
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

// ---- 档案密码（加密存 SQLite；表单只显示"已设置"状态；随草稿切换档案） ----
const profilePasswordSet = ref(false)
const passwordEditorOpen = ref(false)
const passwordDraft = ref('')

watch(sshDraft, async (profile: RemoteProfile | null) => {
    passwordEditorOpen.value = false
    passwordDraft.value = ''
    // 密码仅 SSH 档案支持（mosh 认证由其内部 ssh 完成）
    profilePasswordSet.value = profile && profile.type === 'ssh'
        ? await hasProfilePassword(profile.id).catch(() => false)
        : false
})

async function saveProfilePassword (): Promise<void> {
    const profile = sshDraft.value
    if (!profile || profile.type !== 'ssh') {
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
    const profile = sshDraft.value
    if (!profile || profile.type !== 'ssh') {
        return
    }
    await removeProfilePassword(profile.id)
    profilePasswordSet.value = false
    passwordEditorOpen.value = false
    passwordDraft.value = ''
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
        if ((profile.type === 'ssh' || profile.type === 'mosh') && profile.groupId === id) {
            delete profile.groupId
        }
    }
}

/**
 * @description 手动排序 SSH 分组（默认分组虚拟段固定置顶）
 * @param sourceKey 被移动分组 id
 * @param targetKey 放置目标分组 id
 * @returns void
 *
 * @example reorderSshGroups('sg2', 'sg1')
 *
 */
function reorderSshGroups (sourceKey: string, targetKey: string): void {
    if (sourceKey === SSH_DEFAULT_KEY || targetKey === SSH_DEFAULT_KEY) {
        return
    }
    store.sshGroups = reorderGroups(store.sshGroups, sourceKey, targetKey)
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

/**
 * @description 构造一条全新 SSH 档案草稿（落在默认分组；不进入 store）
 * @returns SshProfile 新档案对象
 *
 * @example buildSshProfile()
 *
 */
function buildSshProfile (): SshProfile {
    return {
        id: `ssh-${nanoid(8)}`,
        type: 'ssh',
        name: `${t('settings.profileTypeSsh')} ${sshProfiles.value.filter(p => p.type === 'ssh').length + 1}`,
        host: '',
        port: 22,
        user: 'root',
        auth: 'auto',
        keyId: null,
        colorScheme: null,
        isDefault: false,
    }
}

/**
 * @description 构造一条全新 Mosh 档案草稿（落在默认分组；不进入 store）
 * @returns MoshProfile 新档案对象
 *
 * @example buildMoshProfile()
 *
 */
function buildMoshProfile (): MoshProfile {
    return {
        id: `mosh-${nanoid(8)}`,
        type: 'mosh',
        name: `${t('settings.profileTypeMosh')} ${sshProfiles.value.filter(p => p.type === 'mosh').length + 1}`,
        host: '',
        port: 22,
        user: 'root',
        moshPort: null,
        colorScheme: null,
        isDefault: false,
    }
}

/**
 * @description 新建 SSH 档案：打开全新草稿编辑器（有未保存修改时经确认放行），
 *              点「保存」后才进入列表并持久化
 * @returns void
 *
 * @example createSshProfile() // 编辑器切换为未保存的新档案草稿
 *
 */
function createSshProfile (): void {
    nextCreateKind.value = 'ssh'
    sshEditor.guard(t('settings.unsavedChangesBody'), sshEditor.createNew, t('settings.unsavedChangesDiscard'), t('settings.unsavedChangesTitle'))
}

/**
 * @description 新建 Mosh 档案：打开全新草稿编辑器（有未保存修改时经确认放行），
 *              点「保存」后才进入列表并持久化
 * @returns void
 *
 * @example createMoshProfile() // 编辑器切换为未保存的 Mosh 新档案草稿
 *
 */
function createMoshProfile (): void {
    nextCreateKind.value = 'mosh'
    sshEditor.guard(t('settings.unsavedChangesBody'), sshEditor.createNew, t('settings.unsavedChangesDiscard'), t('settings.unsavedChangesTitle'))
}

/**
 * @description 保存当前草稿并同步选中态
 * @returns void
 *
 * @example saveSshDraft()
 *
 */
function saveSshDraft (): void {
    sshEditor.save()
}

/**
 * @description 取消当前草稿：全新草稿关闭并回到选中项，既有档案还原为基线
 * @returns void
 *
 * @example cancelSshDraft()
 *
 */
function cancelSshDraft (): void {
    if (isNewSshDraft.value) {
        syncEditorToSelection()
        return
    }
    sshEditor.discard()
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
    // 同步清掉监控 store 的样本/错误缓冲：profileId 不复用，残留条目只会白占内存
    monitorStore.clear(id)
    if (selectedSshProfileId.value === id) {
        selectedSshProfileId.value = sshProfiles.value[0]?.id ?? null
    }
    syncEditorToSelection()
}

/**
 * @description 删除 SSH 档案（经确认弹窗）
 * @param profile 目标档案
 * @returns void
 *
 */
function confirmDeleteProfile (profile: RemoteProfile): void {
    confirmAction(t('settings.deleteConfirmBody', { name: profile.name }), () => deleteSshProfile(profile.id))
}
</script>

<template>
    <div class="settings-page">
    <h2>{{ t('settings.sshPage') }}</h2>
    <div class="master-detail">
        <div class="detail-list">
            <div class="profile-new-group">
                <button class="profile-new-button" @click="createSshProfile">
                    <Plus :size="14" />
                    <span>{{ t('settings.sshNew') }}</span>
                </button>
                <button class="profile-new-button" @click="createMoshProfile">
                    <Plus :size="14" />
                    <span>{{ t('settings.moshNew') }}</span>
                </button>
                <button class="profile-new-button" @click="openCreateSshGroup">
                    <Plus :size="14" />
                    <span>{{ t('settings.sshNewGroup') }}</span>
                </button>
            </div>
            <GroupAccordion
                :sections="sshAccordionSections"
                :preferred-key="selectedSshSectionKey"
                :rename-title="t('settings.sshRenameGroup')"
                :delete-title="t('settings.sshDeleteGroup')"
                :move-up-title="t('settings.groupMoveUp')"
                :move-down-title="t('settings.groupMoveDown')"
                @rename="openRenameSshGroup"
                @delete="confirmDeleteSshGroup"
                @reorder="reorderSshGroups"
            >
                <template #default="{ data }">
                    <button
                        v-for="p in data.items"
                        :key="p.id"
                        class="profile-item"
                        :class="{ active: p.id === sshDraft?.id }"
                        @click="selectSshProfile(p)"
                    >
                        <span class="profile-item-head">
                            <span class="profile-item-name">{{ p.name }}</span>
                            <span class="profile-protocol-badge" :class="p.type">{{ p.type === 'mosh' ? 'Mosh' : 'SSH' }}</span>
                            <span v-if="p.isDefault" class="profile-default-badge">{{ t('tab.defaultProfile') }}</span>
                        </span>
                        <span class="profile-item-command">{{ `${p.user}@${p.host}${p.port === 22 ? '' : `:${p.port}`}` }}</span>
                    </button>
                </template>
            </GroupAccordion>
            <p v-if="sshProfiles.length === 0 && store.sshGroups.length === 0" class="hint">
                {{ t('settings.sshEmptyHint') }}
            </p>
        </div>
        <div v-if="sshDraft" class="detail-content">
            <div class="settings-section">
                <h3 class="settings-section-title">{{ t('settings.profileSectionBasic') }}</h3>
                <div class="settings-card">
                    <div class="settings-card-row">
                        <Label>{{ t('settings.profileName') }}</Label>
                        <Input v-model="sshDraft.name" class="w-60" />
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
                        <Input v-model="sshDraft.host" class="w-60" placeholder="example.com" />
                    </div>
                    <div class="settings-card-row">
                        <Label>{{ t('settings.sshPort') }}</Label>
                        <Input v-model.number="sshDraft.port" type="number" class="w-24" />
                    </div>
                    <div class="settings-card-row">
                        <Label>{{ t('settings.sshUser') }}</Label>
                        <Input v-model="sshDraft.user" class="w-60" />
                    </div>
                    <template v-if="sshDraft.type === 'ssh'">
                        <div class="settings-card-row">
                            <Label>{{ t('settings.sshAuth') }}</Label>
                            <Select v-model="sshDraft.auth" :options="sshAuthOptions" class="w-44" />
                        </div>
                        <div v-if="sshDraft.auth === 'publicKey' || sshDraft.auth === 'auto'" class="settings-card-row">
                            <Label>{{ t('settings.keychain') }} <span class="value-hint">{{ t('settings.keychainHint') }}</span></Label>
                            <Select v-model="keyIdModel" :options="sshKeyOptions" class="w-60" />
                        </div>
                        <div v-if="sshDraft.auth === 'password' || sshDraft.auth === 'auto'" class="settings-card-row">
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
                        <div v-if="passwordEditorOpen && (sshDraft.auth === 'password' || sshDraft.auth === 'auto')" class="settings-card-row stacked">
                            <Label>{{ t('settings.sshPassword') }}</Label>
                            <div class="ssh-password-editor">
                                <Input v-model="passwordDraft" type="password" class="w-60" :placeholder="t('settings.sshPasswordPlaceholder')" />
                                <Button size="sm" @click="saveProfilePassword">{{ t('settings.sshPasswordSave') }}</Button>
                            </div>
                        </div>
                    </template>
                    <template v-else>
                        <div class="settings-card-row">
                            <Label>{{ t('settings.moshPort') }} <span class="value-hint">{{ t('settings.moshPortHint') }}</span></Label>
                            <Input v-model="moshPortModel" type="number" class="w-24" :placeholder="t('settings.moshPortPlaceholder')" />
                        </div>
                        <div class="settings-card-row stacked">
                            <Label>{{ t('settings.moshAuthLabel') }}</Label>
                            <span class="value-hint">{{ t('settings.moshAuthHint') }}</span>
                        </div>
                    </template>
                </div>
            </div>

            <ProfileForwardingsCard v-if="sshDraft.type === 'ssh'" :profile="sshDraft" />

            <div class="profile-actions">
                <Button size="sm" :disabled="!isSshDraftDirty" @click="saveSshDraft">
                    {{ t('settings.profileSave') }}
                </Button>
                <Button
                    v-if="isSshDraftDirty || isNewSshDraft"
                    variant="outline"
                    size="sm"
                    @click="cancelSshDraft"
                >
                    {{ t('settings.cancel') }}
                </Button>
                <template v-if="!isNewSshDraft">
                    <Button
                        variant="outline"
                        size="sm"
                        :disabled="sshDraft.isDefault"
                        @click="config.setDefaultProfile(sshDraft.id)"
                    >
                        {{ t('settings.profileSetDefault') }}
                    </Button>
                    <Button variant="destructive-outline" size="sm" @click="confirmDeleteProfile(sshDraft)">
                        <Trash2 :size="14" />
                        {{ t('settings.profileDelete') }}
                    </Button>
                </template>
            </div>
        </div>
    </div>
    </div>
</template>

<style scoped>
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

.profile-protocol-badge {
    flex: none;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 10px;
    line-height: 1.4;
    color: var(--muted-foreground);
    border: 1px solid var(--border);
}

.profile-protocol-badge.mosh {
    color: var(--primary);
    border-color: var(--primary);
}
</style>
