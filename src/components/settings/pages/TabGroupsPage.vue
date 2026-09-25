<!--
  @description 设置·标签分组页：分组定义管理（新建/编辑表单弹窗、成员计数、删除），
              运行时归属在 tabs store，TabStrip 渲染 chip。
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { nanoid } from 'nanoid'
import { Pencil, Plus, X } from 'lucide-vue-next'
import TabGroupFormDialog from '@/components/settings/TabGroupFormDialog.vue'
import { useConfigStore, type TabGroup } from '@/stores/config'
import { useTabsStore } from '@/stores/tabs'
import { confirmAction } from '@/components/settings/useConfirmAction'

const { t } = useI18n()
const config = useConfigStore()
const store = config.store
const tabsStore = useTabsStore()

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
</script>

<template>
    <div class="settings-page">
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
    <TabGroupFormDialog
        v-model:open="tabGroupDialogOpen"
        :editing="editingTabGroup"
        :title="editingTabGroup ? t('settings.tabGroupsEditGroup') : t('settings.tabGroupsNewGroup')"
        @submit="commitTabGroupDialog"
    />
    </div>
</template>

<style scoped>
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
</style>
