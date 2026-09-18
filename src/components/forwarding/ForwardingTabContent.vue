<!--
  @description 隧道管理器标签页（对标 Termius Port Forwarding 屏）：运行中的隧道总览
              （跨连接，一键停止）+ 按档案分组的规则库（启停/编辑/删除/autoStart）。
              规则启动无既有连接时经连接注册表后台建 headless 连接（独立隧道）；
              隧道停止或消失时释放对应连接消费者。
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronRight, Pencil, Play, Plus, Square, Trash2 } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Switch from '@/components/ui/Switch.vue'
import ForwardRuleFormDialog from '@/components/forwarding/ForwardRuleFormDialog.vue'
import { describeForward, ruleToSpec, type ForwardState, type PortForwarding } from '@/lib/portForwarding'
import { startForward, stopForward } from '@/services/forward'
import { acquireConnection, profileIdForSshId, releaseConnection } from '@/services/sshConnections'
import { useConfigStore, type SshProfile } from '@/stores/config'
import { useForwardingStore } from '@/stores/forwarding'
import { useTabsStore } from '@/stores/tabs'

const props = defineProps<{
    tabId: string
}>()

const { t } = useI18n()
const tabsStore = useTabsStore()
const config = useConfigStore()
const forwardingStore = useForwardingStore()

// 标题在 setup 同步设置（避免闪空标题；标签 store 的 title 即展示名）
tabsStore.setTitle(props.tabId, t('forward.tabTitle'))

const error = ref('')

// ---- 运行态 → 档案/规则 映射 ----
const profileOf = (state: ForwardState): SshProfile | undefined => {
    const profileId = profileIdForSshId(state.sshId)
    return profileId
        ? config.store.profiles.find((p): p is SshProfile => p.id === profileId && p.type === 'ssh')
        : undefined
}

/** 运行中（active）与失败（failed，含 autoStart 失败）的隧道总览 */
const runningStates = computed(() =>
    forwardingStore.states.filter(state => state.status === 'active' || state.status === 'failed'))

/**
 * @description 规则的运行态匹配（同档案连接上、同规则 id 的最新条目）
 * @param profile 归属档案
 * @param rule 规则
 * @returns ForwardState | undefined
 *
 */
function stateForRule (profile: SshProfile, rule: PortForwarding): ForwardState | undefined {
    return forwardingStore.states.find(state =>
        state.ruleId === rule.id && profileOf(state)?.id === profile.id)
}

// ---- 规则库：按档案分组（可折叠） ----
const profiles = computed<SshProfile[]>(() =>
    config.store.profiles.filter((p): p is SshProfile => p.type === 'ssh' && (p.forwardings?.length ?? 0) > 0))
const collapsed = ref(new Set<string>())

function toggleGroup (profileId: string): void {
    if (collapsed.value.has(profileId)) {
        collapsed.value.delete(profileId)
    } else {
        collapsed.value.add(profileId)
    }
}

// ---- 启停（独立隧道：无既有连接时后台建连；停止后释放消费者） ----
const tunnelConsumers = new Map<string, string>() // ruleId → profileId（释放 headless 连接用）

/**
 * @description 启动一条档案规则：清同规则残条目 → 获取连接（复用/headless）→ forward_start
 * @param profile 归属档案
 * @param rule 规则
 * @returns Promise<void>
 *
 */
async function startRule (profile: SshProfile, rule: PortForwarding): Promise<void> {
    error.value = ''
    try {
        const stale = stateForRule(profile, rule)
        if (stale) {
            await stopForward(stale.id).catch(() => {})
        }
        const sshId = await acquireConnection(profile.id, `tunnel:${rule.id}`)
        tunnelConsumers.set(rule.id, profile.id)
        await startForward(ruleToSpec(sshId, rule))
    } catch (e) {
        error.value = String(e instanceof Error ? e.message : e)
    }
}

/**
 * @description 停止一条规则对应的运行态并释放连接消费者
 * @param profile 归属档案
 * @param rule 规则
 * @param state 运行态
 * @returns Promise<void>
 *
 */
async function stopRule (profile: SshProfile, rule: PortForwarding, state: ForwardState): Promise<void> {
    try {
        await stopForward(state.id)
    } catch {
        // 已随会话清理：忽略，快照事件会同步
    }
    releaseConnection(profile.id, `tunnel:${rule.id}`)
    tunnelConsumers.delete(rule.id)
}

/**
 * @description 停止运行总览中的一条隧道（规则启动的顺带释放消费者；临时转发直接停）
 * @param state 运行态
 * @returns Promise<void>
 *
 */
async function stopState (state: ForwardState): Promise<void> {
    try {
        await stopForward(state.id)
    } catch {
        // 忽略：快照事件会同步
    }
    if (state.ruleId) {
        const profile = profileOf(state)
        if (profile) {
            releaseConnection(profile.id, `tunnel:${state.ruleId}`)
            tunnelConsumers.delete(state.ruleId)
        }
    }
}

// 隧道从别处（窗格面板/会话断开级联）消失时释放消费者（WKWebView：setup 同步创建）
watch(() => forwardingStore.version, () => {
    // Map 迭代中删除当前条目是安全的（快照语义无需数组展开）
    for (const [ruleId, profileId] of tunnelConsumers) {
        const alive = forwardingStore.states.some(state =>
            state.ruleId === ruleId && profileIdForSshId(state.sshId) === profileId)
        if (!alive) {
            releaseConnection(profileId, `tunnel:${ruleId}`)
            tunnelConsumers.delete(ruleId)
        }
    }
})

// ---- 规则编辑（共享表单；直改档案对象，config store watch 持久化） ----
const sshProfiles = computed(() => config.store.profiles.filter((p): p is SshProfile => p.type === 'ssh'))
/** 弹窗内的归属主机选项（添加规则时在表单顶部选择） */
const hostOptions = computed(() => sshProfiles.value.map(p => ({ value: p.id, label: p.name })))

const formOpen = ref(false)
const editingRule = ref<PortForwarding | null>(null)
const editingProfile = ref<SshProfile | null>(null)
const formTitle = computed(() => editingRule.value ? t('forward.editRule') : t('forward.addRule'))

function openAdd (): void {
    if (sshProfiles.value.length === 0) {
        return
    }
    editingRule.value = null
    editingProfile.value = null
    formOpen.value = true
}

function openEdit (profile: SshProfile, rule: PortForwarding): void {
    editingRule.value = rule
    editingProfile.value = profile
    formOpen.value = true
}

/**
 * @description 提交规则表单：按弹窗选择的归属主机（或编辑中的档案）写回 forwardings
 *              （新增或原位替换）
 * @param rule 归一化后的规则
 * @param hostId 弹窗选择的归属主机 id（添加模式）
 * @returns void
 *
 */
function onFormSubmit (rule: PortForwarding, hostId?: string): void {
    const profile = editingProfile.value
        ?? sshProfiles.value.find(p => p.id === hostId)
    if (!profile) {
        return
    }
    const next = [...(profile.forwardings ?? [])]
    const index = next.findIndex(entry => entry.id === rule.id)
    if (index === -1) {
        next.push(rule)
    } else {
        next.splice(index, 1, rule)
    }
    profile.forwardings = next
}

/**
 * @description 切换规则 autoStart（行内开关直改）
 * @param profile 归属档案
 * @param rule 规则
 * @param value 新值
 * @returns void
 *
 */
function toggleAutoStart (profile: SshProfile, rule: PortForwarding, value: boolean): void {
    const next = [...(profile.forwardings ?? [])]
    const index = next.findIndex(entry => entry.id === rule.id)
    if (index !== -1) {
        next.splice(index, 1, { ...rule, autoStart: value })
        profile.forwardings = next
    }
}

// ---- 删除确认 ----
const confirming = ref<{ profile: SshProfile, rule: PortForwarding } | null>(null)

function removeRule (): void {
    const target = confirming.value
    if (!target) {
        return
    }
    target.profile.forwardings = (target.profile.forwardings ?? []).filter(entry => entry.id !== target.rule.id)
    confirming.value = null
}
</script>

<template>
    <div class="forwarding-tab">
        <!-- 页头不重复标签标题（窄窗口下与标签同名标题垂直相邻会被看成文字换行）；
             添加规则的主机选择在弹窗内 -->
        <header v-if="sshProfiles.length > 0" class="forwarding-header">
            <Button variant="outline" size="sm" @click="openAdd">
                <Plus :size="13" />
                {{ t('forward.addRule') }}
            </Button>
        </header>

        <p v-if="error" class="forwarding-error">{{ error }}</p>

        <div class="forwarding-body">
            <section v-if="runningStates.length > 0" class="forwarding-section">
                <h3 class="section-title">{{ t('forward.runningSection') }} ({{ runningStates.length }})</h3>
                <div class="section-card">
                    <div v-for="state in runningStates" :key="state.id" class="row">
                        <span class="row-badge" :class="state.kind">{{ state.kind === 'local' ? 'L' : state.kind === 'remote' ? 'R' : 'D' }}</span>
                        <div class="row-main">
                            <span class="row-profile">{{ profileOf(state)?.name ?? t('forward.unknownProfile') }}</span>
                            <span class="row-desc">{{ describeForward(state) }}</span>
                            <span v-if="state.status === 'failed'" class="row-failed" :title="state.error ?? ''">
                                {{ t('forward.failed') }}: {{ state.error ?? '' }}
                            </span>
                        </div>
                        <span class="row-status" :class="state.status">
                            {{ state.status === 'active' ? t('forward.statusActive') : t('forward.failed') }}
                        </span>
                        <Button variant="ghost" size="icon" class="h-6 w-6" :title="t('forward.stop')" @click="void stopState(state)">
                            <Square :size="12" />
                        </Button>
                    </div>
                </div>
            </section>

            <section class="forwarding-section">
                <h3 class="section-title">{{ t('forward.rulesSection') }}</h3>
                <p v-if="profiles.length === 0" class="empty-hint">
                    {{ sshProfiles.length === 0 ? t('forward.noSshProfiles') : t('forward.noRules') }}
                </p>
                <div v-for="profile in profiles" :key="profile.id" class="section-card">
                    <button class="group-header" @click="toggleGroup(profile.id)">
                        <ChevronRight v-if="collapsed.has(profile.id)" :size="13" />
                        <ChevronDown v-else :size="13" />
                        <span class="group-name">{{ profile.name }}</span>
                        <span class="group-count">{{ profile.forwardings?.length ?? 0 }}</span>
                    </button>
                    <template v-if="!collapsed.has(profile.id)">
                        <div v-for="rule in profile.forwardings" :key="rule.id" class="row">
                            <span class="row-badge" :class="rule.type">{{ rule.type === 'local' ? 'L' : rule.type === 'remote' ? 'R' : 'D' }}</span>
                            <div class="row-main">
                                <span class="row-desc">{{ describeForward(rule) }}</span>
                                <span v-if="stateForRule(profile, rule)?.status === 'failed'" class="row-failed" :title="stateForRule(profile, rule)?.error ?? ''">
                                    {{ t('forward.failed') }}
                                </span>
                            </div>
                            <span
                                class="row-status"
                                :class="{ active: stateForRule(profile, rule)?.status === 'active' }"
                                :title="stateForRule(profile, rule)?.status === 'active' ? describeForward(stateForRule(profile, rule)!) : ''"
                            >
                                {{ stateForRule(profile, rule)?.status === 'active' ? t('forward.statusActive') : t('forward.statusStopped') }}
                            </span>
                            <Switch
                                :model-value="rule.autoStart"
                                :title="t('forward.autoStart')"
                                @update:model-value="value => toggleAutoStart(profile, rule, value)"
                            />
                            <Button
                                v-if="stateForRule(profile, rule)?.status === 'active'"
                                variant="ghost" size="icon" class="h-6 w-6" :title="t('forward.stop')"
                                @click="void stopRule(profile, rule, stateForRule(profile, rule)!)"
                            >
                                <Square :size="12" />
                            </Button>
                            <Button
                                v-else
                                variant="ghost" size="icon" class="h-6 w-6" :title="t('forward.start')"
                                @click="void startRule(profile, rule)"
                            >
                                <Play :size="12" />
                            </Button>
                            <Button variant="ghost" size="icon" class="h-6 w-6" :title="t('forward.editRule')" @click="openEdit(profile, rule)">
                                <Pencil :size="12" />
                            </Button>
                            <Button variant="ghost" size="icon" class="h-6 w-6" :title="t('settings.profileDelete')" @click="confirming = { profile, rule }">
                                <Trash2 :size="12" />
                            </Button>
                        </div>
                    </template>
                </div>
            </section>
        </div>

        <ForwardRuleFormDialog
            v-model:open="formOpen"
            :editing="editingRule"
            :host-options="editingRule ? undefined : hostOptions"
            :host-label="editingRule ? editingProfile?.name : undefined"
            :title="formTitle"
            @submit="(rule, hostId) => onFormSubmit(rule, hostId)"
        />

        <Dialog v-if="confirming" :title="t('forward.deleteRuleConfirm')" :width="360" @cancel="confirming = null">
            <p class="confirm-text">{{ describeForward(confirming.rule) }}</p>
            <template #footer>
                <Button variant="outline" size="sm" @click="confirming = null">{{ t('forward.cancel') }}</Button>
                <Button variant="destructive" size="sm" @click="removeRule">{{ t('settings.profileDelete') }}</Button>
            </template>
        </Dialog>
    </div>
</template>

<script lang="ts">
export default { name: 'ForwardingTabContent' }
</script>

<style scoped>
.forwarding-tab {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--color-background);
}

.forwarding-header {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    min-height: 38px;
    padding: 4px 14px;
    border-bottom: 1px solid var(--color-border);
    user-select: none;
}

.forwarding-error {
    margin: 0;
    padding: 6px 14px;
    font-size: 12px;
    color: var(--color-destructive);
    border-bottom: 1px solid var(--color-border);
    word-break: break-all;
}

.forwarding-body {
    flex: 1 1 0;
    min-height: 0;
    overflow-y: auto;
    padding: 14px 14px 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.forwarding-section {
    max-width: 860px;
}

.section-title {
    margin: 0 0 8px;
    font-size: 11px;
    font-weight: 500;
    color: var(--color-muted-foreground);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}

.section-card {
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-card);
    padding: 4px 10px;
}

.empty-hint {
    margin: 8px 0;
    font-size: 12px;
    color: var(--color-muted-foreground);
}

.group-header {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 2px;
    border: none;
    border-bottom: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-muted-foreground);
    font-size: 12px;
    cursor: default;
}

.group-name {
    color: var(--color-foreground);
    font-weight: 500;
}

.group-count {
    font-size: 11px;
}

.row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 2px;
    font-size: 12px;
    border-top: 1px solid var(--color-border);
}

.group-header + .row,
.row:first-child {
    border-top: none;
}

.row-badge {
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

.row-badge.local,
.row-badge.dynamic {
    color: var(--color-primary);
    border-color: color-mix(in oklch, var(--color-primary) 40%, transparent);
}

.row-main {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
}

.row-profile {
    flex-shrink: 0;
    color: var(--color-muted-foreground);
}

.row-desc {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 11.5px;
}

.row-failed {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    color: var(--color-destructive);
}

.row-status {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--color-muted-foreground);
    display: inline-flex;
    align-items: center;
    gap: 4px;
}

.row-status.active::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-primary);
}

.confirm-text {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 12px;
    word-break: break-all;
}
</style>
