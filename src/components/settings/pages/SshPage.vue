<!--
  @description 设置·SSH 页：SSH 档案主从管理（分组列表 + 连接/认证/密码编辑器 +
              档案级端口转发卡片）；密钥下拉数据由本页挂载时拉取（页面互斥挂载，
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
import { useConfigStore, type SshProfile } from '@/stores/config'
import { useMonitorStore } from '@/stores/monitor'
import { builtinColorSchemes } from '@/lib/colorSchemes'
import { groupQuickCommandSections } from '@/lib/quickCommands'
import { listSshKeys, setProfilePassword, removeProfilePassword, hasProfilePassword, type SshKeyMeta } from '@/services/secrets'
import { confirmAction } from '@/components/settings/useConfirmAction'
import { openCreateSshGroup, openRenameSshGroup } from '@/components/settings/useGroupNameDialog'

const { t } = useI18n()
const config = useConfigStore()
const store = config.store
const monitorStore = useMonitorStore()

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

/** 默认分组段在手风琴分段键中的键 */
const SSH_DEFAULT_KEY = '__default'

/** SSH 手风琴分段视图（GroupAccordion 消费） */
const sshAccordionSections = computed(() => sshSections.value.map(section => ({
    key: section.groupId ?? SSH_DEFAULT_KEY,
    title: section.title ?? t('settings.sshDefaultGroup'),
    count: section.items.length,
    manageable: section.groupId !== null,
    data: section,
})))

/** 自动展开目标：选中档案所在分段 */
const selectedSshSectionKey = computed(() =>
    sshAccordionSections.value.find(section => section.data.items.some(p => p.id === selectedSshProfile.value?.id))?.key)

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

const profileColorSchemeOptions = computed(() => [
    { value: '', label: t('settings.profileColorSchemeGlobal') },
    { value: 'auto', label: t('settings.colorSchemeAuto') },
    ...builtinColorSchemes.map(scheme => ({ value: scheme.name, label: scheme.name })),
])

const sshColorSchemeModel = computed({
    get: () => selectedSshProfile.value?.colorScheme ?? '',
    set: (value: string) => {
        const profile = selectedSshProfile.value
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
}

/**
 * @description 删除 SSH 档案（经确认弹窗）
 * @param profile 目标档案
 * @returns void
 *
 */
function confirmDeleteProfile (profile: SshProfile): void {
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
                @rename="openRenameSshGroup"
                @delete="confirmDeleteSshGroup"
            >
                <template #default="{ data }">
                    <button
                        v-for="p in data.items"
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
            </GroupAccordion>
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
</style>
