<!--
  @description SSH 窗格内的端口转发面板（右侧抽屉）：活动转发列表（临时转发 + 档案规则
              启停）、添加临时转发内联表单。复用所属窗格已认证的 SSH 连接（三种转发
              local/remote/dynamic 由 Rust forward.rs 承载）；会话断开后端级联停止并广播空快照。
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowRightLeft, BookmarkPlus, Play, Plus, Square, X } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import ForwardRuleFormDialog from '@/components/forwarding/ForwardRuleFormDialog.vue'
import { listForwards, onForwardsChanged, startForward, stopForward } from '@/services/forward'
import {
    describeForward, ruleToSpec, sanitizeForwarding,
    type ForwardState, type PortForwarding,
} from '@/lib/portForwarding'
import { useTabsStore } from '@/stores/tabs'
import type { SshProfile } from '@/stores/config'

const props = defineProps<{
    /** 所属窗格的 SSH 会话 id（SshProxy.getID） */
    sshId: string
    /** 窗格档案（读取已保存的转发规则；临时转发放学为规则时直改其 forwardings） */
    profile: SshProfile
}>()

const emit = defineEmits<{
    (e: 'close'): void
}>()

const { t } = useI18n()
const tabsStore = useTabsStore()
const states = ref<ForwardState[]>([])
const error = ref('')
let unlisten: (() => void) | null = null

/** 档案规则按 id 匹配运行态（autoStart 规则连接后已由 TerminalPane 自动启动） */
const savedRules = computed<PortForwarding[]>(() => props.profile.forwardings ?? [])
const ruleState = (ruleId: string): ForwardState | undefined =>
    states.value.find(state => state.ruleId === ruleId)
/** 临时转发（无规则 id 的运行态） */
const tempStates = computed<ForwardState[]>(() => states.value.filter(state => state.ruleId === null))

/**
 * @description 规则行展示文案：运行中时用运行态的实际生效端口（listenPort=0 由
 *              OS/server 分配后回填），未运行用规则配置
 * @param rule 档案规则
 * @returns string 展示串
 *
 */
function describeRule (rule: PortForwarding): string {
    const state = ruleState(rule.id)
    if (state) {
        return describeForward(state)
    }
    return describeForward(rule)
}

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

/**
 * @description 把临时转发保存为档案规则（实际生效端口一并固化；经 config store 持久化）
 * @param state 临时转发运行态
 * @returns void
 *
 */
function saveStateAsRule (state: ForwardState): void {
    const rule = sanitizeForwarding({
        type: state.kind,
        listenHost: state.listenHost,
        listenPort: state.listenPort,
        targetHost: state.targetHost,
        targetPort: state.targetPort,
        autoStart: false,
    })
    if (!rule) {
        return
    }
    props.profile.forwardings = [...(props.profile.forwardings ?? []), rule]
}

// ---- 添加临时转发（共享规则表单；不落档案，随连接结束消失） ----
const addOpen = ref(false)

/**
 * @description 提交临时转发表单：直接启动（ruleId=null）
 * @param rule 归一化后的规则
 * @returns Promise<void>
 *
 */
async function onAddSubmit (rule: PortForwarding): Promise<void> {
    error.value = ''
    try {
        await startForward({ ...ruleToSpec(props.sshId, rule), ruleId: null })
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
            <button class="forward-manage" :title="t('forward.manageAll')" @click="tabsStore.openForwardingTab()">
                {{ t('forward.manageAll') }}
            </button>
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
                        <span class="forward-desc" :title="describeRule(rule)">{{ describeRule(rule) }}</span>
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
                    <Button variant="ghost" size="icon" class="h-6 w-6" :title="t('forward.saveAsRule')" @click="saveStateAsRule(state)">
                        <BookmarkPlus :size="12" />
                    </Button>
                    <Button variant="ghost" size="icon" class="h-6 w-6" :title="t('forward.stop')" @click="void stopState(state)">
                        <Square :size="12" />
                    </Button>
                </div>
            </div>
        </div>

        <div class="forward-bottom">
            <Button variant="outline" size="sm" class="forward-add-button" @click="addOpen = true">
                <Plus :size="13" />
                {{ t('forward.add') }}
            </Button>
        </div>

        <ForwardRuleFormDialog
            v-model:open="addOpen"
            :editing="null"
            :show-auto-start="false"
            :host-label="props.profile.name"
            :title="t('forward.add')"
            @submit="rule => void onAddSubmit(rule)"
        />
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
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

/* 「管理全部」链接：跳转隧道管理器标签 */
.forward-manage {
    border: none;
    padding: 2px 4px;
    background: transparent;
    color: var(--color-muted-foreground);
    font-size: 11px;
    white-space: nowrap;
    flex-shrink: 0;
    cursor: pointer;
    transition: color 0.25s ease;
}

.forward-manage:hover {
    color: var(--color-foreground);
    text-decoration: underline;
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
    transition: background-color 0.15s ease;
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

.forward-bottom {
    border-top: 1px solid var(--color-border);
    padding: 6px 8px;
}

.forward-add-button {
    width: 100%;
}
</style>
