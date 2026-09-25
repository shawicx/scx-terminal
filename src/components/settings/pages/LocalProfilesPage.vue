<!--
  @description 设置·本地终端页：local 档案主从管理（手风琴分组列表 + 编辑器），
              分组弹窗经共享 useGroupNameDialog，删除经共享确认弹窗。
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { nanoid } from 'nanoid'
import { Plus, Trash2 } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Switch from '@/components/ui/Switch.vue'
import Select from '@/components/ui/Select.vue'
import SearchableSelect from '@/components/ui/SearchableSelect.vue'
import GroupAccordion, { type AccordionSection } from '@/components/settings/GroupAccordion.vue'
import { useConfigStore, defaultFirstProfiles, defaultShellCommand, groupLocalProfiles, type LocalProfile, type LocalProfileSection } from '@/stores/config'
import { builtinColorSchemes } from '@/lib/colorSchemes'
import { confirmAction } from '@/components/settings/useConfirmAction'
import { openCreateLocalGroup, openRenameLocalGroup } from '@/components/settings/useGroupNameDialog'

const { t } = useI18n()
const config = useConfigStore()
const store = config.store

const localProfiles = computed(() => defaultFirstProfiles(store.profiles.filter((p): p is LocalProfile => p.type === 'local')))
const selectedLocalProfileId = ref<string | null>(null)
const selectedLocalProfile = computed<LocalProfile | null>(() =>
    localProfiles.value.find(p => p.id === selectedLocalProfileId.value)
    ?? localProfiles.value[0]
    ?? null)

/** 左列表分段：默认分组（未分组）置顶 + 各分组按定义序；没有未分组档案时默认分组段
 *  也常驻置顶（空段可见，对齐 SSH 页空段常驻） */
const localSections = computed(() => {
    const sections = groupLocalProfiles(localProfiles.value, store.localGroups)
    if (localProfiles.value.length > 0 && !sections.some(section => section.group === null)) {
        sections.unshift({ group: null, profiles: [] })
    }
    return sections
})

/** 未分组段在手风琴分段键中的键 */
const LOCAL_UNGROUPED_KEY = '__ungrouped'

/** 本地终端手风琴分段视图（GroupAccordion 消费；未分组段以「默认分组」语义置顶） */
const localAccordionSections = computed<AccordionSection<LocalProfileSection>[]>(() =>
    localSections.value.map(section => ({
        key: section.group?.id ?? LOCAL_UNGROUPED_KEY,
        title: section.group?.name ?? t('settings.localDefaultGroup'),
        count: section.profiles.length,
        ...(section.group?.builtin ? { badge: t('settings.localDefaultGroupBadge') } : {}),
        manageable: !!section.group && !section.group.builtin,
        data: section,
    })))

/** 自动展开目标：选中档案所在分段 */
const selectedLocalSectionKey = computed(() =>
    localAccordionSections.value.find(section => section.data.profiles.some(p => p.id === selectedLocalProfile.value?.id))?.key)

/** 编辑器分组下拉：未分组 + 各分组（默认分组也开放容纳自建档案） */
const localGroupOptions = computed(() => [
    { value: '', label: t('settings.localDefaultGroup') },
    ...store.localGroups.map(group => ({ value: group.id, label: group.name })),
])

const localGroupModel = computed({
    get: () => selectedLocalProfile.value?.groupId ?? '',
    set: (value: string) => {
        const profile = selectedLocalProfile.value
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

const localColorSchemeModel = computed({
    get: () => selectedLocalProfile.value?.colorScheme ?? '',
    set: (value: string) => {
        const profile = selectedLocalProfile.value
        if (profile) {
            profile.colorScheme = value || null
        }
    },
})

/**
 * @description 删除本地档案分组：组内档案降级未分组（groupId 清空，Rust 删组命令同语义级联）；
 *              默认分组（builtin）锁定不可删
 * @param id 分组 id
 * @returns void
 *
 * @example deleteLocalGroup('localgroup-a1b2')
 *
 */
function deleteLocalGroup (id: string): void {
    const index = store.localGroups.findIndex(group => group.id === id)
    const group = store.localGroups[index]
    if (index === -1 || group?.builtin) {
        return
    }
    store.localGroups.splice(index, 1)
    for (const profile of store.profiles) {
        if (profile.type === 'local' && profile.groupId === id) {
            delete profile.groupId
        }
    }
}

/**
 * @description 删除本地档案分组（经确认弹窗；组内档案降级未分组；默认分组锁定不可达）
 * @param id 分组 id
 * @returns void
 *
 * @example confirmDeleteLocalGroup('localgroup-a1b2')
 *
 */
function confirmDeleteLocalGroup (id: string): void {
    const group = store.localGroups.find(g => g.id === id)
    if (group && !group.builtin) {
        confirmAction(t('settings.deleteConfirmBody', { name: group.name }), () => deleteLocalGroup(id))
    }
}

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
        builtin: false,
    }
    store.profiles.push(profile)
    selectedLocalProfileId.value = profile.id
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
 * @description 删除本地终端档案（经确认弹窗）
 * @param profile 目标档案
 * @returns void
 *
 */
function confirmDeleteProfile (profile: LocalProfile): void {
    confirmAction(t('settings.deleteConfirmBody', { name: profile.name }), () => deleteLocalProfile(profile.id))
}
</script>

<template>
    <div class="settings-page">
    <h2>{{ t('settings.localTerminalPage') }}</h2>
    <div class="master-detail">
        <div class="detail-list">
            <div class="profile-new-group">
                <button class="profile-new-button" @click="createLocalProfile">
                    <Plus :size="14" />
                    <span>{{ t('settings.profileNew') }}</span>
                </button>
                <button class="profile-new-button" @click="openCreateLocalGroup">
                    <Plus :size="14" />
                    <span>{{ t('settings.localNewGroup') }}</span>
                </button>
            </div>
            <GroupAccordion
                :sections="localAccordionSections"
                :preferred-key="selectedLocalSectionKey"
                :rename-title="t('settings.localRenameGroup')"
                :delete-title="t('settings.localDeleteGroup')"
                @rename="openRenameLocalGroup"
                @delete="confirmDeleteLocalGroup"
            >
                <template #default="{ data }">
                    <button
                        v-for="p in data.profiles"
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
                </template>
            </GroupAccordion>
            <p v-if="localProfiles.length === 0 && store.localGroups.length === 0" class="hint">
                {{ t('settings.localEmptyHint') }}
            </p>
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
                    <div class="settings-card-row">
                        <Label>{{ t('settings.localGroupLabel') }}</Label>
                        <Select
                            v-model="localGroupModel"
                            :options="localGroupOptions"
                            class="w-60"
                            :disabled="selectedLocalProfile.builtin"
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
                        <Label>
                            {{ t('settings.profileCwd') }}
                            <span v-if="selectedLocalProfile.builtin" class="value-hint">{{ t('settings.profileCwdLockedHint') }}</span>
                        </Label>
                        <Input v-model="cwdModel" class="w-60" :disabled="selectedLocalProfile.builtin" />
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
                <Button
                    variant="destructive-outline"
                    size="sm"
                    :disabled="selectedLocalProfile.builtin"
                    :title="selectedLocalProfile.builtin ? t('settings.profileDeleteLockedHint') : undefined"
                    @click="confirmDeleteProfile(selectedLocalProfile)"
                >
                    <Trash2 :size="14" />
                    {{ t('settings.profileDelete') }}
                </Button>
            </div>
        </div>
    </div>
    </div>
</template>

<style scoped>
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
</style>
