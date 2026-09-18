<!--
  @description 端口转发规则共享表单弹窗（隧道管理器 / 档案编辑器 / 窗格临时转发三处复用）：
                主机归属（隧道管理器内可选下拉，其余场景只读展示）、类型 Select（附方向
                说明一行，dynamic 隐藏目标字段）、监听/目标输入、可选 autoStart 开关；
                提交经 sanitizeForwarding 校验归一后以 submit 事件交调用方持久化或直接启动。
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Globe } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Select, { type SelectOption } from '@/components/ui/Select.vue'
import Switch from '@/components/ui/Switch.vue'
import { sanitizeForwarding, type ForwardKind, type PortForwarding } from '@/lib/portForwarding'

const props = defineProps<{
    /** 弹窗开合（v-model:open） */
    open: boolean
    /** 编辑中的规则；null = 新增（默认草稿） */
    editing: PortForwarding | null
    /** 是否展示 autoStart 开关（临时转发不展示） */
    showAutoStart?: boolean
    /** 弹窗标题（调用方按上下文传文案） */
    title: string
    /** 可选的主机选项（隧道管理器添加规则：弹窗内直接选择归属主机） */
    hostOptions?: SelectOption[]
    /** 初始选中的主机 id（配合 hostOptions） */
    initialHostId?: string
    /** 只读主机名（编辑规则/档案编辑器/窗格面板：归属固定，仅展示） */
    hostLabel?: string
}>()

const emit = defineEmits<{
    (e: 'update:open', open: boolean): void
    (e: 'submit', rule: PortForwarding, hostId?: string): void
}>()

const { t } = useI18n()

const kindOptions = computed(() => [
    { value: 'local', label: t('forward.kindLocal') },
    { value: 'remote', label: t('forward.kindRemote') },
    { value: 'dynamic', label: t('forward.kindDynamic') },
])

/** 类型方向说明（帮助选择 -L/-R/-D） */
const kindHint = computed(() => {
    switch (form.value.type) {
        case 'local': return t('forward.typeHintLocal')
        case 'remote': return t('forward.typeHintRemote')
        case 'dynamic': return t('forward.typeHintDynamic')
    }
})

/** 弹窗内选择的归属主机（hostOptions 模式下随 submit 一并回传） */
const hostId = ref('')

const form = ref({
    type: 'local' as ForwardKind,
    listenHost: '127.0.0.1',
    listenPort: '',
    targetHost: '',
    targetPort: '',
    autoStart: false,
})
const formError = ref('')

/** 打开时按 editing 载入草稿（新增复位默认值；主机回到初始选择） */
watch(() => props.open, open => {
    if (!open) {
        return
    }
    formError.value = ''
    hostId.value = props.initialHostId
        ?? props.hostOptions?.[0]?.value
        ?? ''
    if (props.editing) {
        form.value = {
            type: props.editing.type,
            listenHost: props.editing.listenHost,
            listenPort: String(props.editing.listenPort),
            targetHost: props.editing.targetHost ?? '',
            targetPort: props.editing.targetPort === null ? '' : String(props.editing.targetPort),
            autoStart: props.editing.autoStart,
        }
    } else {
        form.value = { type: 'local', listenHost: '127.0.0.1', listenPort: '', targetHost: '', targetPort: '', autoStart: false }
    }
})

function cancel (): void {
    emit('update:open', false)
}

/**
 * @description 提交表单：sanitize 校验归一后交调用方（失败保留弹窗与输入）
 * @returns void
 *
 */
function commit (): void {
    formError.value = ''
    const rule = sanitizeForwarding({
        id: props.editing?.id,
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
    if (props.hostOptions && !hostId.value) {
        formError.value = t('forward.hostRequired')
        return
    }
    emit('update:open', false)
    emit('submit', rule, props.hostOptions ? hostId.value : undefined)
}
</script>

<template>
    <Dialog v-if="props.open" :title="props.title" :width="440" @cancel="cancel">
        <div class="rule-form">
            <div v-if="props.hostOptions" class="rule-row">
                <Label>{{ t('forward.host') }}</Label>
                <Select v-model="hostId" :options="props.hostOptions" class="flex-1" />
            </div>
            <div v-else-if="props.hostLabel" class="rule-row">
                <Label>{{ t('forward.host') }}</Label>
                <span class="rule-host-fixed">{{ props.hostLabel }}</span>
            </div>
            <div class="rule-row">
                <Label>{{ t('forward.ruleType') }}</Label>
                <Select v-model="form.type" :options="kindOptions" class="flex-1" />
            </div>
            <p class="rule-hint">{{ kindHint }}</p>
            <div class="rule-row">
                <Label>{{ t('forward.ruleListen') }}</Label>
                <div class="rule-pair">
                    <Input v-model="form.listenHost" class="flex-1" spellcheck="false" />
                    <Input v-model="form.listenPort" class="port" :placeholder="t('forward.portAuto')" spellcheck="false" />
                </div>
            </div>
            <div v-if="form.type !== 'dynamic'" class="rule-row">
                <Label>{{ t('forward.ruleTarget') }}</Label>
                <div class="rule-pair">
                    <Input v-model="form.targetHost" class="flex-1" spellcheck="false" />
                    <Input v-model="form.targetPort" class="port" spellcheck="false" />
                </div>
            </div>
            <p v-else class="rule-hint">
                <Globe :size="12" />
                {{ t('forward.socksHint') }}
            </p>
            <div v-if="props.showAutoStart" class="rule-row">
                <Label>{{ t('forward.autoStart') }}</Label>
                <Switch v-model="form.autoStart" />
            </div>
            <p v-if="formError" class="rule-error">{{ formError }}</p>
        </div>
        <template #footer>
            <Button variant="outline" size="sm" @click="cancel">{{ t('forward.cancel') }}</Button>
            <Button size="sm" @click="commit">{{ t('sftp.confirm') }}</Button>
        </template>
    </Dialog>
</template>

<style scoped>
.rule-form {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.rule-row {
    display: flex;
    align-items: center;
    gap: 12px;
}

.rule-row > :first-child {
    width: 72px;
    flex-shrink: 0;
    text-align: right;
}

.rule-pair {
    flex: 1 1 0;
    display: flex;
    gap: 8px;
    min-width: 0;
}

.rule-pair .port {
    width: 110px;
    flex-shrink: 0;
}

.rule-host-fixed {
    flex: 1 1 0;
    min-width: 0;
    font-size: 13px;
    color: var(--color-foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.rule-hint {
    margin: -4px 0 0 84px;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--color-muted-foreground);
}

.rule-error {
    margin: 0;
    font-size: 12px;
    color: var(--color-destructive);
}
</style>
