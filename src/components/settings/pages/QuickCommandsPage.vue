<!--
  @description 设置·快捷命令页：命令主从管理（分组手风琴 + 名称/命令/参数模板/
              自动执行编辑器）；编辑器走草稿模式（改动经「保存」按钮提交，不再
              实时写入 store）；分组弹窗经共享 useGroupNameDialog。
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { nanoid } from 'nanoid'
import { Plus, Trash2 } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Switch from '@/components/ui/Switch.vue'
import Select from '@/components/ui/Select.vue'
import GroupAccordion from '@/components/settings/GroupAccordion.vue'
import { useConfigStore, reorderGroups, type QuickCommand } from '@/stores/config'
import { groupQuickCommandSections, parseQuickCommandParams, previewQuickCommand } from '@/lib/quickCommands'
import { findQuickCommandRefs, previewWorkflow } from '@/lib/workflows'
import { confirmAction } from '@/components/settings/useConfirmAction'
import { useDraftEditor } from '@/components/settings/useDraftEditor'
import { openCreateQuickCommandGroup, openRenameQuickCommandGroup } from '@/components/settings/useGroupNameDialog'

const { t } = useI18n()
const config = useConfigStore()
const store = config.store

const selectedQuickCommandId = ref<string | null>(null)
const selectedQuickCommand = computed(() =>
    store.quickCommands.find(qc => qc.id === selectedQuickCommandId.value)
    ?? store.quickCommands[0]
    ?? null)

/** 草稿编辑器：表单只改草稿副本，「保存」时统一提交 store（store 防抖落库不变） */
const quickCommandEditor = useDraftEditor<QuickCommand>({
    create: buildQuickCommand,
    persist: (draft, isNew) => {
        if (isNew) {
            store.quickCommands.push(draft)
            selectedQuickCommandId.value = draft.id
            return
        }
        const target = store.quickCommands.find(qc => qc.id === draft.id)
        if (target) {
            Object.assign(target, draft)
        }
    },
})
const { draft: qcDraft, isNew: isNewQcDraft, dirty: isQcDraftDirty } = quickCommandEditor

/**
 * @description 把编辑器同步到当前选中项（选中变化/删除后的兜底收敛均走这里）
 * @returns void
 *
 * @example syncEditorToSelection()
 *
 */
function syncEditorToSelection (): void {
    if (selectedQuickCommand.value) {
        quickCommandEditor.edit(selectedQuickCommand.value)
    } else {
        quickCommandEditor.clear()
    }
}

watch(selectedQuickCommand, syncEditorToSelection, { immediate: true })

/**
 * @description 选中左侧列表命令（有未保存修改时经确认弹窗放行）
 * @param quickCommand 目标命令
 * @returns void
 *
 * @example selectQuickCommand(quickCommand)
 *
 */
function selectQuickCommand (quickCommand: QuickCommand): void {
    quickCommandEditor.guard(t('settings.unsavedChangesBody'), () => {
        if (quickCommand.id !== selectedQuickCommandId.value) {
            selectedQuickCommandId.value = quickCommand.id
        } else {
            // 新建草稿打开时点回当前选中项：直接回到该命令
            quickCommandEditor.edit(quickCommand)
        }
    }, t('settings.unsavedChangesDiscard'), t('settings.unsavedChangesTitle'))
}

/** 左列表分段：未分组置顶无标题，其余按手动顺序带小节头 */
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
    sortable: section.groupId !== null,
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
    get: () => qcDraft.value?.groupId ?? '',
    set: (value: string) => {
        const quickCommand = qcDraft.value
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
    qcDraft.value ? parseQuickCommandParams(qcDraft.value.command) : [])

/**
 * @description 构造一条全新快捷命令草稿（不进入 store）
 * @returns QuickCommand 新命令对象
 *
 * @example buildQuickCommand()
 *
 */
function buildQuickCommand (): QuickCommand {
    return {
        id: `qc-${nanoid(8)}`,
        name: `${t('settings.quickCommands')} ${store.quickCommands.length + 1}`,
        command: '',
        autoRun: false,
    }
}

/**
 * @description 新建快捷命令：打开全新草稿编辑器（有未保存修改时经确认放行），
 *              点「保存」后才进入列表并持久化
 * @returns void
 *
 * @example createQuickCommand() // 编辑器切换为未保存的新命令草稿
 *
 */
function createQuickCommand (): void {
    quickCommandEditor.guard(t('settings.unsavedChangesBody'), quickCommandEditor.createNew, t('settings.unsavedChangesDiscard'), t('settings.unsavedChangesTitle'))
}

/**
 * @description 保存当前草稿并同步选中态
 * @returns void
 *
 * @example saveQuickCommandDraft()
 *
 */
function saveQuickCommandDraft (): void {
    quickCommandEditor.save()
}

/**
 * @description 取消当前草稿：全新草稿关闭并回到选中项，既有命令还原为基线
 * @returns void
 *
 * @example cancelQuickCommandDraft()
 *
 */
function cancelQuickCommandDraft (): void {
    if (isNewQcDraft.value) {
        syncEditorToSelection()
        return
    }
    quickCommandEditor.discard()
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
    syncEditorToSelection()
}

/**
 * @description 删除快捷命令（经弹窗）：被工作流引用时阻断删除并提示引用它的
 *              工作流名称（需先在工作流中移除该步骤）；无引用时走删除确认
 * @param quickCommand 目标快捷命令
 * @returns void
 *
 */
function confirmDeleteQuickCommand (quickCommand: QuickCommand): void {
    const name = quickCommand.name || previewQuickCommand(quickCommand.command)
    const refs = findQuickCommandRefs(store.workflows, quickCommand.id)
    if (refs.length) {
        const refNames = refs.map(workflow => workflow.name || previewWorkflow(workflow, store.quickCommands)).join('、')
        confirmAction(
            t('settings.quickCommandReferencedBody', { name, workflows: refNames }),
            () => {},
            t('settings.confirm'),
            t('settings.quickCommandReferencedTitle'),
        )
        return
    }
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

/**
 * @description 手动排序快捷命令分组（未分组虚拟段固定置顶）
 * @param sourceKey 被移动分组 id
 * @param targetKey 放置目标分组 id
 * @returns void
 *
 * @example reorderQuickCommandGroups('qcgroup-2', 'qcgroup-1')
 *
 */
function reorderQuickCommandGroups (sourceKey: string, targetKey: string): void {
    if (sourceKey === QUICK_COMMAND_UNGROUPED_KEY || targetKey === QUICK_COMMAND_UNGROUPED_KEY) {
        return
    }
    store.quickCommandGroups = reorderGroups(store.quickCommandGroups, sourceKey, targetKey)
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
                :move-up-title="t('settings.groupMoveUp')"
                :move-down-title="t('settings.groupMoveDown')"
                @rename="openRenameQuickCommandGroup"
                @delete="confirmDeleteQuickCommandGroup"
                @reorder="reorderQuickCommandGroups"
            >
                <template #default="{ data }">
                    <button
                        v-for="qc in data.items"
                        :key="qc.id"
                        class="profile-item"
                        :class="{ active: qc.id === qcDraft?.id }"
                        @click="selectQuickCommand(qc)"
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
        <div v-if="qcDraft" class="detail-content">
            <div class="settings-section">
                <div class="settings-card">
                    <div class="settings-card-row">
                        <Label>{{ t('settings.quickCommandName') }}</Label>
                        <Input v-model="qcDraft.name" class="w-60" />
                    </div>
                    <div class="settings-card-row">
                        <Label>{{ t('settings.quickCommandDescription') }}</Label>
                        <Input
                            v-model="qcDraft.description"
                            class="w-60"
                            :placeholder="t('settings.quickCommandDescriptionPlaceholder')"
                        />
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
                            v-model="qcDraft.command"
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
                        <Switch v-model="qcDraft.autoRun" />
                    </div>
                    <div class="settings-card-row actions">
                        <Button size="sm" :disabled="!isQcDraftDirty" @click="saveQuickCommandDraft">
                            {{ t('settings.profileSave') }}
                        </Button>
                        <Button
                            v-if="isQcDraftDirty || isNewQcDraft"
                            variant="outline"
                            size="sm"
                            @click="cancelQuickCommandDraft"
                        >
                            {{ t('settings.cancel') }}
                        </Button>
                        <Button v-if="!isNewQcDraft" variant="destructive-outline" size="sm" @click="confirmDeleteQuickCommand(qcDraft)">
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
