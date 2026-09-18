<!--
  @description SSH 档案编辑器的「端口转发规则」卡片：规则列表（启停时自动启动开关/编辑/删除
              确认）+ Dialog 添加/编辑表单（类型 Select，目标字段按类型条件显隐）。
              直接编辑档案对象（与 SettingsView 既有编辑器一致的响应式直改模式）。
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowRightLeft, Pencil, Plus, Trash2 } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Select from '@/components/ui/Select.vue'
import Switch from '@/components/ui/Switch.vue'
import { describeForward, sanitizeForwarding, type ForwardKind, type PortForwarding } from '@/lib/portForwarding'
import type { SshProfile } from '@/stores/config'

const props = defineProps<{
    /** 正在编辑的 SSH 档案（直接变更其 forwardings 字段） */
    profile: SshProfile
}>()

const { t } = useI18n()
const rules = computed<PortForwarding[]>(() => props.profile.forwardings ?? [])

const kindOptions = computed(() => [
    { value: 'local', label: t('forward.kindLocal') },
    { value: 'remote', label: t('forward.kindRemote') },
    { value: 'dynamic', label: t('forward.kindDynamic') },
])

// ---- 添加 / 编辑：同一个 Dialog 表单（editingId 为 null = 新增） ----
const editingId = ref<string | null>(null)
const editorOpen = ref(false)
const formError = ref('')
const form = ref({
    type: 'local' as ForwardKind,
    listenHost: '127.0.0.1',
    listenPort: '',
    targetHost: '',
    targetPort: '',
    autoStart: false,
})

/**
 * @description 打开添加表单（复位为默认草稿）
 * @returns void
 *
 */
function openAdd (): void {
    editingId.value = null
    formError.value = ''
    form.value = { type: 'local', listenHost: '127.0.0.1', listenPort: '', targetHost: '', targetPort: '', autoStart: false }
    editorOpen.value = true
}

/**
 * @description 打开编辑表单（载入既有规则）
 * @param rule 待编辑规则
 * @returns void
 *
 */
function openEdit (rule: PortForwarding): void {
    editingId.value = rule.id
    formError.value = ''
    form.value = {
        type: rule.type,
        listenHost: rule.listenHost,
        listenPort: String(rule.listenPort),
        targetHost: rule.targetHost ?? '',
        targetPort: rule.targetPort === null ? '' : String(rule.targetPort),
        autoStart: rule.autoStart,
    }
    editorOpen.value = true
}

/**
 * @description 提交表单：sanitize 校验归一后写回档案（新增或原位替换）
 * @returns void
 *
 */
function commitEditor (): void {
    formError.value = ''
    const rule = sanitizeForwarding({
        id: editingId.value ?? undefined,
        type: form.value.type,
        listenHost: form.value.listenHost,
        listenPort: form.value.listenPort === '' ? 0 : form.value.listenPort,
        targetHost: form.value.type === 'dynamic' ? null : form.value.targetHost,
        targetPort: form.value.type === 'dynamic' ? null : form.value.targetPort,
        autoStart: form.value.autoStart,
    })
    if (!rule) {
        formError.value = t('forward.invalidDraft')
        return
    }
    const next = [...rules.value]
    const index = next.findIndex(entry => entry.id === rule.id)
    if (index === -1) {
        next.push(rule)
    } else {
        next.splice(index, 1, rule)
    }
    props.profile.forwardings = next
    editorOpen.value = false
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

        <Dialog v-if="editorOpen" :title="editingId ? t('forward.editRule') : t('forward.addRule')" :width="420" @cancel="editorOpen = false">
            <div class="editor-grid">
                <div class="editor-row">
                    <Label>{{ t('forward.ruleType') }}</Label>
                    <Select v-model="form.type" :options="kindOptions" />
                </div>
                <div class="editor-row">
                    <Label>{{ t('forward.ruleListen') }}</Label>
                    <div class="editor-pair">
                        <Input v-model="form.listenHost" class="flex-1" spellcheck="false" />
                        <Input v-model="form.listenPort" class="port" :placeholder="t('forward.portAuto')" spellcheck="false" />
                    </div>
                </div>
                <div v-if="form.type !== 'dynamic'" class="editor-row">
                    <Label>{{ t('forward.ruleTarget') }}</Label>
                    <div class="editor-pair">
                        <Input v-model="form.targetHost" class="flex-1" spellcheck="false" />
                        <Input v-model="form.targetPort" class="port" spellcheck="false" />
                    </div>
                </div>
                <p v-else class="editor-hint">{{ t('forward.socksHint') }}</p>
                <div class="editor-row">
                    <Label>{{ t('forward.autoStart') }}</Label>
                    <Switch v-model="form.autoStart" />
                </div>
                <p v-if="formError" class="editor-error">{{ formError }}</p>
            </div>
            <template #footer>
                <Button variant="outline" size="sm" @click="editorOpen = false">{{ t('forward.cancel') }}</Button>
                <Button size="sm" @click="commitEditor">{{ t('sftp.confirm') }}</Button>
            </template>
        </Dialog>

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

.editor-grid {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.editor-row {
    display: flex;
    align-items: center;
    gap: 12px;
}

.editor-row > :first-child {
    width: 72px;
    flex-shrink: 0;
    text-align: right;
}

.editor-pair {
    flex: 1 1 0;
    display: flex;
    gap: 8px;
    min-width: 0;
}

.editor-pair .port {
    width: 110px;
    flex-shrink: 0;
}

.editor-hint {
    margin: -4px 0 0 84px;
    font-size: 12px;
    color: var(--color-muted-foreground);
}

.editor-error {
    margin: 0;
    font-size: 12px;
    color: var(--color-destructive);
}

.confirm-text {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 12px;
    word-break: break-all;
}
</style>
