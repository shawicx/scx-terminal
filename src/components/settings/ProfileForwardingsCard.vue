<!--
  @description SSH 档案编辑器的「端口转发规则」卡片：规则列表（autoStart 开关/编辑/删除确认）；
              添加/编辑表单复用共享的 ForwardRuleFormDialog（与隧道管理器/窗格面板同源）。
              直接编辑档案对象（与 SettingsView 既有编辑器一致的响应式直改模式）。
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowRightLeft, Pencil, Plus, Trash2 } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Switch from '@/components/ui/Switch.vue'
import ForwardRuleFormDialog from '@/components/forwarding/ForwardRuleFormDialog.vue'
import { describeForward, type PortForwarding } from '@/lib/portForwarding'
import type { SshProfile } from '@/stores/config'

const props = defineProps<{
    /** 正在编辑的 SSH 档案（直接变更其 forwardings 字段） */
    profile: SshProfile
}>()

const { t } = useI18n()
const rules = computed<PortForwarding[]>(() => props.profile.forwardings ?? [])

// ---- 添加 / 编辑：共享规则表单（editingRule 为 null = 新增） ----
const editorOpen = ref(false)
const editingRule = ref<PortForwarding | null>(null)

function openAdd (): void {
    editingRule.value = null
    editorOpen.value = true
}

function openEdit (rule: PortForwarding): void {
    editingRule.value = rule
    editorOpen.value = true
}

/**
 * @description 提交规则表单：写回档案 forwardings（新增或原位替换；config store watch 持久化）
 * @param rule 归一化后的规则
 * @returns void
 *
 */
function onFormSubmit (rule: PortForwarding): void {
    const next = [...rules.value]
    const index = next.findIndex(entry => entry.id === rule.id)
    if (index === -1) {
        next.push(rule)
    } else {
        next.splice(index, 1, rule)
    }
    props.profile.forwardings = next
}

/**
 * @description 删除规则（确认弹窗由 confirming 控制）
 * @param rule 待删除规则
 * @returns void
 *
 */
function removeRule (rule: PortForwarding): void {
    props.profile.forwardings = rules.value.filter(entry => entry.id !== rule.id)
    confirming.value = null
}

// ---- 删除确认（SettingsView confirmState 同款模式） ----
const confirming = ref<PortForwarding | null>(null)
</script>

<template>
    <div class="settings-section">
        <h3 class="settings-section-title">{{ t('forward.rules') }}</h3>
        <div class="settings-card">
            <p class="forwardings-hint">{{ t('forward.rulesHint') }}</p>
            <div v-for="rule in rules" :key="rule.id" class="forwarding-row">
                <ArrowRightLeft :size="13" class="forwarding-icon" />
                <div class="forwarding-main">
                    <span class="forwarding-desc">{{ describeForward(rule) }}</span>
                    <span class="forwarding-meta">
                        <span class="forwarding-kind">{{ rule.type === 'local' ? 'L' : rule.type === 'remote' ? 'R' : 'D' }}</span>
                        <span v-if="rule.autoStart" class="forwarding-autostart">{{ t('forward.autoStartTag') }}</span>
                    </span>
                </div>
                <Switch
                    :model-value="rule.autoStart"
                    :title="t('forward.autoStart')"
                    @update:model-value="value => {
                        const next = [...rules]
                        const index = next.findIndex(entry => entry.id === rule.id)
                        if (index !== -1) {
                            next.splice(index, 1, { ...rule, autoStart: value })
                            profile.forwardings = next
                        }
                    }"
                />
                <Button variant="ghost" size="icon" class="h-7 w-7" :title="t('forward.editRule')" @click="openEdit(rule)">
                    <Pencil :size="13" />
                </Button>
                <Button variant="ghost" size="icon" class="h-7 w-7" :title="t('settings.profileDelete')" @click="confirming = rule">
                    <Trash2 :size="13" />
                </Button>
            </div>
            <Button variant="outline" size="sm" class="forwarding-add" @click="openAdd">
                <Plus :size="13" />
                {{ t('forward.addRule') }}
            </Button>
        </div>

        <ForwardRuleFormDialog
            v-model:open="editorOpen"
            :editing="editingRule"
            :host-label="profile.name"
            :title="editingRule ? t('forward.editRule') : t('forward.addRule')"
            @submit="rule => onFormSubmit(rule)"
        />

        <Dialog v-if="confirming" :title="t('forward.deleteRuleConfirm')" :width="360" @cancel="confirming = null">
            <p class="confirm-text">{{ describeForward(confirming) }}</p>
            <template #footer>
                <Button variant="outline" size="sm" @click="confirming = null">{{ t('forward.cancel') }}</Button>
                <Button variant="destructive" size="sm" @click="removeRule(confirming)">{{ t('settings.profileDelete') }}</Button>
            </template>
        </Dialog>
    </div>
</template>

<script lang="ts">
export default { name: 'ProfileForwardingsCard' }
</script>

<style scoped>
.forwardings-hint {
    margin: 0 0 8px;
    font-size: 12px;
    color: var(--color-muted-foreground);
}

.forwarding-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    border-top: 1px solid var(--color-border);
}

.forwarding-icon {
    flex-shrink: 0;
    color: var(--color-muted-foreground);
}

.forwarding-main {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
}

.forwarding-desc {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 12px;
}

.forwarding-meta {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 4px;
}

.forwarding-kind {
    width: 18px;
    height: 18px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--color-muted-foreground);
}

.forwarding-autostart {
    padding: 0 5px;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    font-size: 10px;
    color: var(--color-muted-foreground);
}

/* 行内自动启动开关与编辑/删除按钮：与设置页 settings-card-row 的动作密度一致 */

.forwarding-add {
    margin-top: 8px;
}

.confirm-text {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 12px;
    word-break: break-all;
}
</style>
