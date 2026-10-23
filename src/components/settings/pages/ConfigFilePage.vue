<!--
  @description 设置·配置文件页：以 JSON 查看/直接编辑当前全部配置（明文视图，
              不含凭据——密码存独立的加密库）。操作按钮（重载/校验并保存）
              固定在页头右侧（不随内容滚动），编辑器占满剩余视口。保存流程：
              JSON 语法解析 → 结构校验（分区/实体集合完整）→ 二次确认 →
              整体替换 store（flush 引擎自动 diff 落库）；重载 = 从 store
              重新生成文本，丢弃未保存编辑。
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RefreshCw, Save } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import { message } from '@/components/ui/message'
import { useConfigStore } from '@/stores/config'
import type { ConfigStore } from '@/stores/config'
import { validateSnapshot } from '@/stores/config/validateSnapshot'
import { confirmAction } from '@/components/settings/useConfirmAction'

const { t } = useI18n()
const config = useConfigStore()
const store = config.store

/** 编辑器文本（进入页面时从 store 生成；保存/重载后重新生成） */
const draft = ref(JSON.stringify(store, null, 4))
/** 校验失败信息（语法错误原文 / 结构错误翻译文案）；空串 = 无错误 */
const parseError = ref('')

/** 有未保存修改时编辑器边框高亮提示用 */
const dirty = computed(() => draft.value !== JSON.stringify(store, null, 4))

/**
 * @description 从 store 重新生成编辑器文本（丢弃未保存的编辑）
 * @returns void
 *
 * @example reloadDraft()
 *
 */
function reloadDraft (): void {
    draft.value = JSON.stringify(store, null, 4)
    parseError.value = ''
}

/**
 * @description 用解析结果整体替换 store 各分区/实体集合（替换语义而非合并——
 *              编辑器里删除的实体必须真正删除）；store 的 deep watch 会驱动
 *              flush 引擎 diff 落库
 * @param parsed 校验通过的配置快照
 * @returns void
 *
 * @example applySnapshot(parsed)
 *
 */
function applySnapshot (parsed: ConfigStore): void {
    store.terminal = parsed.terminal
    store.appearance = parsed.appearance
    store.advanced = parsed.advanced
    store.recents = parsed.recents
    store.monitor = parsed.monitor
    store.files = parsed.files
    store.workflowCtl = parsed.workflowCtl
    store.hotkeys = parsed.hotkeys
    store.profiles = parsed.profiles
    store.localGroups = parsed.localGroups
    store.sshGroups = parsed.sshGroups
    store.tabGroups = parsed.tabGroups
    store.colorSchemes = parsed.colorSchemes
    store.quickCommands = parsed.quickCommands
    store.quickCommandGroups = parsed.quickCommandGroups
    store.workflows = parsed.workflows
    store.workflowGroups = parsed.workflowGroups
    draft.value = JSON.stringify(store, null, 4)
}

/**
 * @description 保存编辑：JSON 解析 → 结构校验 → 二次确认后整体应用
 * @returns void
 *
 * @example saveDraft()
 *
 */
function saveDraft (): void {
    parseError.value = ''
    let parsed: unknown
    try {
        parsed = JSON.parse(draft.value)
    } catch (error) {
        parseError.value = String(error instanceof Error ? error.message : error)
        return
    }
    const issue = validateSnapshot(parsed)
    if (issue) {
        parseError.value = t(`settings.${issue.key}`, issue.arg ? { key: issue.arg } : {})
        return
    }
    confirmAction(t('settings.configFileSaveConfirmBody'), () => {
        applySnapshot(parsed as ConfigStore)
        message.success(t('settings.configFileSaved'))
    })
}
</script>

<template>
    <div class="settings-page config-file-page">
    <div class="config-file-head">
        <h2>{{ t('settings.configFilePage') }}</h2>
        <div class="config-file-actions">
            <Button variant="outline" size="sm" @click="reloadDraft">
                <RefreshCw :size="14" />
                {{ t('settings.configFileReload') }}
            </Button>
            <Button size="sm" @click="saveDraft">
                <Save :size="14" />
                {{ t('settings.configFileSave') }}
            </Button>
        </div>
    </div>
    <p class="hint">{{ t('settings.configFileHint') }}</p>
    <textarea
        v-model="draft"
        class="config-editor"
        :class="{ dirty }"
        spellcheck="false"
        wrap="off"
    />
    <p v-if="parseError" class="config-error" :title="parseError">
        {{ t('settings.configFileInvalid') }}：{{ parseError }}
    </p>
    </div>
</template>

<style scoped>
/* 配置文件页：不限宽（editor 全幅），整体纵向铺满（编辑器高度见 .config-editor） */
.config-file-page {
    display: flex;
    flex-direction: column;
}

/* 页头：标题左侧 + 操作按钮恒定右侧（固定可视，不随编辑器内容滚动） */
.config-file-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 8px;
}

/* 共享样式给了 h2 底部 margin，行内布局下由 head 统一控制间距 */
.config-file-head h2 {
    margin: 0;
}

.config-file-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
}

/* 编辑器占满剩余视口：页头（标题行+说明）之外的全部高度；窗口过矮时保底 420px */
.config-editor {
    height: calc(100vh - 280px);
    min-height: 420px;
    margin-top: 8px;
    padding: 10px 12px;
    box-sizing: border-box;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-card);
    color: var(--color-foreground);
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.5;
    resize: vertical;
    white-space: pre;
    overflow: auto;
}

/* 有未保存修改时边框提示 */
.config-editor.dirty {
    border-color: color-mix(in oklch, var(--color-primary) 55%, transparent);
}

.config-error {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--color-destructive);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
</style>
