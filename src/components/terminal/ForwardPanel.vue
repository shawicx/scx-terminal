<!--
  @description SSH 窗格内的端口转发面板（右侧抽屉）：活动转发列表（临时转发 + 档案规则
              启停）、添加临时转发内联表单。复用所属窗格已认证的 SSH 连接（三种转发
              local/remote/dynamic 由 Rust forward.rs 承载）；会话断开后端级联停止并广播空快照。
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowRightLeft, Globe, Play, Plus, Square, X } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import Select from '@/components/ui/Select.vue'
import { listForwards, onForwardsChanged, startForward, stopForward } from '@/services/forward'
import {
    describeForward, ruleToSpec, sanitizeForwarding,
    type ForwardKind, type ForwardState, type PortForwarding,
} from '@/lib/portForwarding'
import type { SshProfile } from '@/stores/config'

const props = defineProps<{
    /** 所属窗格的 SSH 会话 id（SshProxy.getID） */
    sshId: string
    /** 窗格档案（读取已保存的转发规则） */
    profile: SshProfile
}>()

const emit = defineEmits<{
    (e: 'close'): void
}>()

const { t } = useI18n()
const states = ref<ForwardState[]>([])
const error = ref('')
let unlisten: (() => void) | null = null

const kindOptions = computed(() => [
    { value: 'local', label: t('forward.kindLocal') },
    { value: 'remote', label: t('forward.kindRemote') },
    { value: 'dynamic', label: t('forward.kindDynamic') },
])

/** 档案规则按 id 匹配运行态（autoStart 规则连接后已由 TerminalPane 自动启动） */
const savedRules = computed<PortForwarding[]>(() => props.profile.forwardings ?? [])
const ruleState = (ruleId: string): ForwardState | undefined =>
    states.value.find(state => state.ruleId === ruleId)
/** 临时转发（无规则 id 的运行态） */
const tempStates = computed<ForwardState[]>(() => states.value.filter(state => state.ruleId === null))

/**
 * @description 初始化：全量拉取当前快照并订阅变化（快照全量同步，直接整体替换）
 * @returns Promise<void>
 *
 */
async function init (): Promise<void> {
    try {
        states.value = await listForwards(props.sshId)
    } catch (e) {
        error.value = String(e instanceof Error ? e.message : e)
    }
    unlisten = await onForwardsChanged(props.sshId, snapshot => {
        states.value = snapshot
    })
}

/**
 * @description 停止一条转发（失败静默：条目可能已被后端清理）
 * @param state 运行态
 * @returns Promise<void>
 *
 */
async function stopState (state: ForwardState): Promise<void> {
    try {
        await stopForward(state.id)
    } catch {
        // 已随会话清理：忽略，快照事件会同步列表
    }
}

/**
 * @description 启动一条档案规则（先清掉同规则的失效残条目再启动）
 * @param rule 档案规则
 * @returns Promise<void>
 *
 */
async function startRule (rule: PortForwarding): Promise<void> {
    error.value = ''
    const stale = ruleState(rule.id)
    if (stale) {
        await stopState(stale)
    }
    try {
        await startForward(ruleToSpec(props.sshId, rule))
    } catch (e) {
        error.value = String(e instanceof Error ? e.message : e)
    }
}

// ---- 添加临时转发（内联表单；不落档案，随连接结束消失） ----
const showAdd = ref(false)
const draft = ref<{ kind: ForwardKind, listenHost: string, listenPort: string, targetHost: string, targetPort: string }>({
    kind: 'local',
    listenHost: '127.0.0.1',
    listenPort: '',
    targetHost: '',
    targetPort: '',
})

function resetDraft (): void {
    draft.value = { kind: 'local', listenHost: '127.0.0.1', listenPort: '', targetHost: '', targetPort: '' }
}

/**
 * @description 取消添加临时转发（收起表单并复位草稿）
 * @returns void
 *
 */
function cancelAdd (): void {
    showAdd.value = false
    resetDraft()
}

/**
 * @description 提交临时转发：经 sanitizeForwarding 校验归一后启动
 * @returns Promise<void>
 *
 */
async function commitAdd (): Promise<void> {
    error.value = ''
    const rule = sanitizeForwarding({
        type: draft.value.kind,
        listenHost: draft.value.listenHost,
        listenPort: draft.value.listenPort === '' ? 0 : draft.value.listenPort,
        targetHost: draft.value.kind === 'dynamic' ? null : draft.value.targetHost,
        targetPort: draft.value.kind === 'dynamic' ? null : draft.value.targetPort,
    })
    if (!rule) {
        error.value = t('forward.invalidDraft')
        return
    }
    try {
        await startForward({ ...ruleToSpec(props.sshId, rule), ruleId: null })
        showAdd.value = false
        resetDraft()
    } catch (e) {
        error.value = String(e instanceof Error ? e.message : e)
    }
}

onMounted(() => {
    void init()
})

onBeforeUnmount(() => {
    unlisten?.()
    unlisten = null
})
</script>

<template>
    <div class="forward-panel">
        <div class="forward-toolbar">
            <ArrowRightLeft :size="14" class="forward-title-icon" />
            <span class="forward-title">{{ t('forward.title') }}</span>
            <Button variant="ghost" size="icon" class="h-8 w-8" :title="t('forward.close')" @click="emit('close')">
                <X :size="14" />
            </Button>
        </div>

        <p v-if="error" class="forward-error">{{ error }}</p>

        <div class="forward-list">
            <div v-if="savedRules.length > 0" class="forward-section">
                <p class="forward-section-title">{{ t('forward.savedSection') }}</p>
                <div v-for="rule in savedRules" :key="rule.id" class="forward-row">
                    <span class="forward-badge" :class="rule.type">{{ rule.type === 'local' ? 'L' : rule.type === 'remote' ? 'R' : 'D' }}</span>
                    <div class="forward-row-main">
                        <span class="forward-desc">{{ describeForward(rule) }}</span>
                        <span v-if="rule.autoStart" class="forward-tag">{{ t('forward.autoStartTag') }}</span>
                        <span v-if="ruleState(rule.id)?.status === 'failed'" class="forward-failed-text" :title="ruleState(rule.id)?.error ?? ''">{{ t('forward.failed') }}</span>
                    </div>
                    <Button
                        v-if="ruleState(rule.id)?.status === 'active'"
                        variant="ghost"
                        size="icon"
                        class="h-6 w-6"
                        :title="t('forward.stop')"
                        @click="void stopState(ruleState(rule.id)!)"
                    >
                        <Square :size="12" />
                    </Button>
                    <Button
                        v-else
                        variant="ghost"
                        size="icon"
                        class="h-6 w-6"
                        :title="t('forward.start')"
                        @click="void startRule(rule)"
                    >
                        <Play :size="12" />
                    </Button>
                </div>
            </div>

            <div class="forward-section">
                <p class="forward-section-title">{{ t('forward.activeSection') }}</p>
                <p v-if="states.length === 0" class="forward-hint">{{ t('forward.empty') }}</p>
                <div v-for="state in tempStates" :key="state.id" class="forward-row">
                    <span class="forward-badge" :class="state.kind">{{ state.kind === 'local' ? 'L' : state.kind === 'remote' ? 'R' : 'D' }}</span>
                    <div class="forward-row-main">
                        <span class="forward-desc">{{ describeForward(state) }}</span>
                        <span v-if="state.status === 'failed'" class="forward-failed-text" :title="state.error ?? ''">{{ state.error ?? t('forward.failed') }}</span>
                    </div>
                    <Button variant="ghost" size="icon" class="h-6 w-6" :title="t('forward.stop')" @click="void stopState(state)">
                        <Square :size="12" />
                    </Button>
                </div>
            </div>

            <div v-if="showAdd" class="forward-add">
                <div class="forward-add-row">
                    <Select v-model="draft.kind" :options="kindOptions" />
                </div>
                <div class="forward-add-row">
                    <input v-model="draft.listenHost" class="forward-input host" spellcheck="false" :placeholder="t('forward.listenHost')">
                    <input v-model="draft.listenPort" class="forward-input port" spellcheck="false" :placeholder="t('forward.portAuto')">
                </div>
                <div v-if="draft.kind !== 'dynamic'" class="forward-add-row">
                    <input v-model="draft.targetHost" class="forward-input host" spellcheck="false" :placeholder="t('forward.targetHost')">
                    <input v-model="draft.targetPort" class="forward-input port" spellcheck="false" :placeholder="t('forward.targetPort')">
                </div>
                <p v-else class="forward-socks-hint">
                    <Globe :size="12" />
                    {{ t('forward.socksHint') }}
                </p>
                <div class="forward-add-actions">
                    <Button variant="outline" size="sm" @click="cancelAdd">{{ t('forward.cancel') }}</Button>
                    <Button size="sm" @click="void commitAdd()">{{ t('forward.add') }}</Button>
                </div>
            </div>
        </div>

        <div class="forward-bottom">
            <Button v-if="!showAdd" variant="outline" size="sm" class="forward-add-button" @click="showAdd = true">
                <Plus :size="13" />
                {{ t('forward.add') }}
            </Button>
        </div>
    </div>
</template>

<script lang="ts">
export default { name: 'ForwardPanel' }
</script>

<style scoped>
.forward-panel {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(400px, 60%);
    z-index: var(--z-side-panel);
    display: flex;
    flex-direction: column;
    background: var(--color-background);
    border-left: 1px solid var(--color-border);
    animation: 0.125s cubic-bezier(0, 0, 0.2, 1) forwardSlideIn;
}

@keyframes forwardSlideIn {
    from {
        transform: translateX(24px);
        opacity: 0;
    }
    to {
        transform: translateX(0);
        opacity: 1;
    }
}

@media (prefers-reduced-motion: reduce) {
    .forward-panel {
        animation: none;
    }
}

.forward-toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px;
    border-bottom: 1px solid var(--color-border);
}

.forward-title-icon {
    color: var(--color-muted-foreground);
}

.forward-title {
    flex: 1 1 0;
    font-size: 13px;
    font-weight: 500;
}

.forward-error {
    margin: 0;
    padding: 6px 10px;
    font-size: 12px;
    color: var(--color-destructive);
    border-bottom: 1px solid var(--color-border);
    word-break: break-all;
}

.forward-list {
    flex: 1 1 0;
    min-height: 0;
    overflow-y: auto;
    padding-bottom: 8px;
}

.forward-section-title {
    margin: 0;
    padding: 8px 10px 4px;
    font-size: 11px;
    color: var(--color-muted-foreground);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}

.forward-hint {
    margin: 0;
    padding: 8px 10px;
    font-size: 12px;
    color: var(--color-muted-foreground);
}

.forward-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 10px;
    font-size: 12px;
}

.forward-row:hover {
    background: var(--color-accent);
}

/* 类型徽标定宽：L / R / D */
.forward-badge {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--color-border);
    border-radius: 5px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--color-muted-foreground);
}

.forward-badge.local {
    color: var(--color-primary);
    border-color: color-mix(in oklch, var(--color-primary) 40%, transparent);
}

.forward-row-main {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
}

.forward-desc {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 11.5px;
}

.forward-tag {
    flex-shrink: 0;
    padding: 0 5px;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    font-size: 10px;
    color: var(--color-muted-foreground);
}

.forward-failed-text {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    color: var(--color-destructive);
}

.forward-add {
    margin: 6px 10px;
    padding: 8px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.forward-add-row {
    display: flex;
    gap: 6px;
}

.forward-input {
    height: 30px;
    padding: 0 8px;
    border: 1px solid var(--color-input);
    border-radius: 6px;
    background: transparent;
    color: var(--color-foreground);
    font-family: var(--font-mono);
    font-size: 12px;
    outline: none;
}

.forward-input:focus {
    border-color: var(--color-ring);
    box-shadow: 0 0 0 1px var(--color-ring);
}

.forward-input.host {
    flex: 1 1 0;
    min-width: 0;
}

.forward-input.port {
    width: 88px;
    flex-shrink: 0;
}

.forward-socks-hint {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--color-muted-foreground);
}

.forward-add-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
}

.forward-bottom {
    border-top: 1px solid var(--color-border);
    padding: 6px 8px;
}

.forward-add-button {
    width: 100%;
}
</style>
