<!--
  @description 设置·快捷命令页：命令主从管理（分组手风琴 + 名称/命令/参数模板/
              自动执行编辑器）；分组弹窗经共享 useGroupNameDialog。
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
import GroupAccordion from '@/components/settings/GroupAccordion.vue'
import { useConfigStore, type QuickCommand } from '@/stores/config'
import { groupQuickCommandSections, parseQuickCommandParams, previewQuickCommand } from '@/lib/quickCommands'
import { confirmAction } from '@/components/settings/useConfirmAction'
import { openCreateQuickCommandGroup, openRenameQuickCommandGroup } from '@/components/settings/useGroupNameDialog'

const { t } = useI18n()
const config = useConfigStore()
const store = config.store

const selectedQuickCommandId = ref<string | null>(null)
const selectedQuickCommand = computed(() =>
    store.quickCommands.find(qc => qc.id === selectedQuickCommandId.value)
    ?? store.quickCommands[0]
    ?? null)

/** 左列表分段：未分组置顶无标题，其余按组名排序带小节头 */
const quickCommandSections = computed(() =>
    groupQuickCommandSections(store.quickCommands, store.quickCommandGroups))

/** 未分组段在手风琴分段键中的键 */
const QUICK_COMMAND_UNGROUPED_KEY = '__ungrouped'

/** 快捷命令手风琴分段视图（GroupAccordion 消费；未分组段仅有成员时出现，标题「未分组」） */
const quickCommandAccordionSections = computed(() => quickCommandSections.value.map(section => ({
    key: section.groupId ?? QUICK_COMMAND_UNGROUPED_KEY,
    title: section.title ?? t('settings.quickCommandUngrouped'),
    count: section.items.length,
    manageable: section.groupId !== null,
    data: section,
})))

/** 自动展开目标：选中命令所在分段 */
const selectedQuickCommandSectionKey = computed(() =>
    quickCommandAccordionSections.value.find(section => section.data.items.some(qc => qc.id === selectedQuickCommand.value?.id))?.key)

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
</script>

<template>
    <div class="settings-page">
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
            <GroupAccordion
                :sections="quickCommandAccordionSections"
                :preferred-key="selectedQuickCommandSectionKey"
                :rename-title="t('settings.quickCommandRenameGroup')"
                :delete-title="t('settings.quickCommandDeleteGroup')"
                @rename="openRenameQuickCommandGroup"
                @delete="confirmDeleteQuickCommandGroup"
            >
                <template #default="{ data }">
                    <button
                        v-for="qc in data.items"
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
            </GroupAccordion>
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
</template>

<style scoped>
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
</style>
