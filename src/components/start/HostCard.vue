<!--
  @description 连接中心主机卡片：档案名 + user@host + 迷你指标行 + 连接状态点；单击整卡
              开终端，悬停浮现 监控/SFTP/隧道/编辑 次级动作（状态色为语义色，不随主题
              token 漂移）。
-->
<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Activity, ArrowLeftRight, ArrowUpDown, Pencil } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import type { SshProfile } from '@/stores/config'
import { useTabsStore } from '@/stores/tabs'
import { useMonitorStore } from '@/stores/monitor'

const props = defineProps<{
    profile: SshProfile
    status: 'idle' | 'connecting' | 'connected' | 'failed'
    error?: string
}>()

const { t } = useI18n()
const tabs = useTabsStore()
const monitor = useMonitorStore()

const endpoint = computed(() => props.profile.port === 22
    ? `${props.profile.user}@${props.profile.host}`
    : `${props.profile.user}@${props.profile.host}:${props.profile.port}`)

/** 本档案最新采样（未收到首帧时为 null，卡片显示骨架） */
const latest = computed(() => monitor.latest[props.profile.id] ?? null)
/** 指标错误态：'unsupported'/'reconnecting' 哨兵透传，其余非空归并为 'error' */
const metricError = computed(() => {
    const err = monitor.errors[props.profile.id]
    return err === 'unsupported' || err === 'reconnecting' ? err : (err ? 'error' : '')
})
/** 指标错误态提示标题：重连中单独文案，其余为指标不可用 */
const metricErrorTitle = computed(() =>
    metricError.value === 'reconnecting' ? t('monitor.recovering') : t('monitor.metricUnavailable'))
</script>

<template>
    <div
        class="host-card"
        :title="status === 'failed' ? (error ?? '') : undefined"
        @click="tabs.openTerminalTab(profile.id)"
    >
        <div class="host-card-head">
            <span class="host-name">{{ profile.name }}</span>
            <span class="status-dot" :class="status" />
        </div>
        <div class="host-endpoint">{{ endpoint }}</div>
        <div
            v-if="metricError === 'unsupported'"
            class="host-metrics host-metrics--muted"
            :title="t('monitor.unsupported')"
        >—</div>
        <div v-else-if="metricError" class="host-metrics host-metrics--muted" :title="metricErrorTitle">
            <Activity class="h-3.5 w-3.5" />
        </div>
        <div v-else-if="!latest" class="host-metrics">
            <span class="metric-skeleton" />
            <span class="metric-skeleton" />
        </div>
        <div v-else class="host-metrics">
            <span class="metric">
                CPU {{ latest.cpuPercent === null ? '—' : latest.cpuPercent.toFixed(0) }}%
                <i class="micro-bar"><b :style="{ width: `${Math.min(100, latest.cpuPercent ?? 0)}%` }" /></i>
            </span>
            <span class="metric">
                MEM {{ latest.mem.percent.toFixed(0) }}%
                <i class="micro-bar"><b :style="{ width: `${Math.min(100, latest.mem.percent)}%` }" /></i>
            </span>
        </div>
        <div class="host-actions" @click.stop>
            <Button variant="ghost" size="icon" class="h-7 w-7" :title="t('monitor.actionMonitor')" @click="tabs.openSshWithMonitor(profile.id)">
                <Activity class="h-5 w-5" />
            </Button>
            <Button variant="ghost" size="icon" class="h-7 w-7" :title="t('start.actionSftp')" @click="tabs.openSftpTab(profile.id)">
                <ArrowUpDown class="h-5 w-5" />
            </Button>
            <Button variant="ghost" size="icon" class="h-7 w-7" :title="t('start.actionTunnel')" @click="tabs.openForwardingTab()">
                <ArrowLeftRight class="h-5 w-5" />
            </Button>
            <Button variant="ghost" size="icon" class="h-7 w-7" :title="t('start.actionEdit')" @click="tabs.openSettingsTab('ssh')">
                <Pencil class="h-5 w-5" />
            </Button>
        </div>
    </div>
</template>

<style scoped>
.host-card {
    background: var(--color-card);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    padding: 10px 12px;
    cursor: pointer;
    transition: border-color 0.15s ease;
}
.host-card:hover {
    border-color: color-mix(in oklch, var(--color-primary) 45%, transparent);
}
.host-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}
.host-name {
    color: var(--color-foreground);
    font-weight: 600;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.host-endpoint {
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 11px;
    margin-top: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.host-metrics {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 6px;
    min-height: 16px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--color-muted-foreground);
}
.host-metrics--muted {
    color: var(--color-muted-foreground);
    opacity: 0.6;
}
.metric {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    white-space: nowrap;
}
.micro-bar {
    background: var(--color-border);
    border-radius: 999px;
    display: inline-block;
    height: 4px;
    overflow: hidden;
    width: 44px;
}
.micro-bar b {
    background: var(--color-primary);
    display: block;
    height: 100%;
}
.metric-skeleton {
    background: var(--color-border);
    border-radius: 999px;
    height: 6px;
    opacity: 0.5;
    width: 72px;
}
.host-actions {
    display: flex;
    gap: 2px;
    margin-top: 8px;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.15s ease, visibility 0.15s ease;
}
.host-card:hover .host-actions {
    opacity: 1;
    visibility: visible;
}
.status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex: none;
}
.status-dot.idle { background: var(--color-muted-foreground); opacity: 0.5; }
.status-dot.connected { background: oklch(0.77 0.15 152); }
.status-dot.connecting { background: var(--color-primary); animation: status-pulse 1.2s ease-in-out infinite; }
.status-dot.failed { background: var(--color-destructive); }
@keyframes status-pulse {
    0%, 100% { box-shadow: 0 0 0 0 color-mix(in oklch, var(--color-primary) 35%, transparent); }
    50% { box-shadow: 0 0 0 4px color-mix(in oklch, var(--color-primary) 35%, transparent); }
}
</style>
