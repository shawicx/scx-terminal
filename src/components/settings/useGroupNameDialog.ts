/**
 * @description 设置域共享的分组名称弹窗（模块级单例）：SSH 分组 / 快捷命令分组 /
 *              本地档案分组共用（均仅名称字段，确认才落库）。各页调用 open* 触发，
 *              SettingsView 外壳统一渲染 Dialog 与提交逻辑。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { nanoid } from 'nanoid'
import { useConfigStore } from '@/stores/config'
import { ref } from 'vue'

type GroupNameDialogKind = 'ssh-create' | 'ssh-rename' | 'qc-create' | 'qc-rename' | 'local-create' | 'local-rename'

interface GroupNameDialog { kind: GroupNameDialogKind, groupId: string | null, draft: string }

/** null = 弹窗关闭；打开时携带来源、目标组与名称草稿 */
const groupNameDialog = ref<GroupNameDialog | null>(null)

/**
 * @description 提交分组名称弹窗：按来源创建新组或写回组名（空名由确认按钮禁用兜底）
 * @returns void
 *
 * @example commitGroupNameDialog()
 *
 */
export function useGroupNameDialog () {
    const { t } = useI18n()
    const config = useConfigStore()
    const store = config.store

    /** 弹窗标题随来源切换（新建/重命名 × SSH/快捷命令/本地档案） */
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
        if (dialog.kind === 'local-create') {
            return t('settings.localNewGroup')
        }
        if (dialog.kind === 'local-rename') {
            return t('settings.localRenameGroup')
        }
        return dialog.kind === 'qc-create' ? t('settings.quickCommandNewGroup') : t('settings.quickCommandRenameGroup')
    })

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
        } else if (dialog.kind === 'local-create') {
            store.localGroups.push({ id: `localgroup-${nanoid(6)}`, name, builtin: false })
        } else if (dialog.kind === 'ssh-rename') {
            const group = store.sshGroups.find(g => g.id === dialog.groupId)
            if (group) {
                group.name = name
            }
        } else if (dialog.kind === 'qc-rename') {
            const group = store.quickCommandGroups.find(g => g.id === dialog.groupId)
            if (group) {
                group.name = name
            }
        } else {
            const group = store.localGroups.find(g => g.id === dialog.groupId)
            if (group && !group.builtin) {
                group.name = name
            }
        }
    }

    return { groupNameDialog, groupNameDialogTitle, commitGroupNameDialog }
}

/**
 * @description 打开本地档案分组新建弹窗
 * @returns void
 *
 * @example openCreateLocalGroup()
 *
 */
export function openCreateLocalGroup (): void {
    groupNameDialog.value = { kind: 'local-create', groupId: null, draft: '' }
}

/**
 * @description 打开本地档案分组重命名弹窗（预填当前组名；默认分组锁定不可达）
 * @param id 分组 id
 * @returns void
 *
 * @example openRenameLocalGroup('localgroup-zsh')
 *
 */
export function openRenameLocalGroup (id: string): void {
    const store = useConfigStore().store
    const group = store.localGroups.find(g => g.id === id)
    if (group && !group.builtin) {
        groupNameDialog.value = { kind: 'local-rename', groupId: id, draft: group.name }
    }
}

/**
 * @description 打开 SSH 分组新建弹窗
 * @returns void
 *
 * @example openCreateSshGroup()
 *
 */
export function openCreateSshGroup (): void {
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
export function openRenameSshGroup (id: string): void {
    const store = useConfigStore().store
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
export function openCreateQuickCommandGroup (): void {
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
export function openRenameQuickCommandGroup (id: string): void {
    const store = useConfigStore().store
    const group = store.quickCommandGroups.find(g => g.id === id)
    if (group) {
        groupNameDialog.value = { kind: 'qc-rename', groupId: id, draft: group.name }
    }
}
