<!--
  @description SSH 终端页右侧监控侧栏（标签页级，跨所有窗格）：紧凑主机头（名称/
              endpoint/连接徽标/元信息）、CPU/内存/网络收发纵向曲线、磁盘条形、
              Top 进程表；左缘拖拽调宽、可收起为右缘细把手。开合态与宽度持久化于
              config store 的 monitor section；采样绑定生命周期归 TerminalTabContent。
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Activity, PanelRightClose } from 'lucide-vue-next'
import { useMonitorStore, MONITOR_ERROR_UNSUPPORTED } from '@/stores/monitor'
import { MONITOR_ERROR_RECONNECTING } from '@/lib/monitorOrchestrator'
import { useConfigStore, type SshProfile } from '@/stores/config'
import { connectionSources, connectionStates } from '@/services/sshConnections'
import MetricChart from '@/components/monitor/MetricChart.vue'

const props = defineProps<{ profileId: string }>()

const { t } = useI18n()
const config = useConfigStore()
const monitor = useMonitorStore()

const profile = computed<SshProfile | undefined>(() =>
    config.store.profiles.find((p): p is SshProfile => p.id === props.profileId && p.type === 'ssh'))

const open = computed(() => config.store.monitor.open === true)
const width = computed(() => config.store.monitor.width)

const latest = computed(() => monitor.latest[props.profileId] ?? null)
const errorState = computed(() => monitor.errors[props.profileId] ?? '')
const series = computed(() => monitor.samples[props.profileId] ?? [])
const cpuSeries = computed(() => series.value.map(s => s.cpuPercent))
const memSeries = computed(() => series.value.map(s => s.mem.percent))
const rxSeries = computed(() => series.value.map(s => s.netRates?.reduce((acc, n) => acc + n.rxKbS, 0) ?? null))
const txSeries = computed(() => series.value.map(s => s.netRates?.reduce((acc, n) => acc + n.txKbS, 0) ?? null))

const processSort = ref<'cpu' | 'mem'>('cpu')
const sortedProcesses = computed(() => {
    const list = latest.value?.processes ?? []
    return [...list].sort((a, b) => processSort.value === 'cpu'
        ? b.cpuPercent - a.cpuPercent
        : b.memPercent - a.memPercent)
})

const endpoint = computed(() => {
    const p = profile.value
    if (!p) {
        return ''
    }
    return p.port === 22 ? `${p.user}@${p.host}` : `${p.user}@${p.host}:${p.port}`
})

const connectionSource = computed(() => {
    if (connectionStates[props.profileId] !== 'connected') {
        return null
    }
    return connectionSources[props.profileId] === 'pane' ? t('start.reusePane') : t('start.backgroundConn')
})

/* 拖拽调宽：左缘手柄向左拖增宽；拖动中仅更新本地 ref（不触发落库），松手持久化 */
const SIDEBAR_MIN_WIDTH = 260
const SIDEBAR_MAX_WIDTH = 480
const SIDEBAR_COLLAPSED_WIDTH = 26
const sidebarEl = ref<HTMLElement | null>(null)
const draggingWidth = ref<number | null>(null)
const resizing = ref(false)

/**
 * @description 侧栏拖拽开始：把指针捕获到左缘手柄，进入调宽状态
 * @param event 手柄上的指针按下事件
 * @returns void
 *
 * @example onDragStart(event)
 *
 */
function onDragStart (event: PointerEvent) {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    resizing.value = true
    draggingWidth.value = width.value
}

/**
 * @description 侧栏拖拽移动：按指针相对侧栏右缘的 x 坐标更新宽度（钳制 260–480）
 * @param event 手柄上的指针移动事件
 * @returns void
 *
 * @example onDragMove(event)
 *
 */
function onDragMove (event: PointerEvent) {
    if (!resizing.value || !sidebarEl.value) {
        return
    }
    const right = sidebarEl.value.getBoundingClientRect().right
    draggingWidth.value = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(right - event.clientX)))
}

/**
 * @description 侧栏拖拽结束：松手时把最终宽度持久化到 monitor section
 * @returns void
 *
 * @example onDragEnd()
 *
 */
function onDragEnd () {
    resizing.value = false
    if (draggingWidth.value !== null) {
        config.setMonitor({ width: draggingWidth.value })
        draggingWidth.value = null
    }
}

/**
 * @description KB 自动单位格式化（B/KB/MB/GB/TB）
 * @param kb 千字节数
 * @returns string 格式化文本
 *
 * @example fmtKb(1536) === '1.5MB'
 *
 */
function fmtKb (kb: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let value = kb * 1024
    let unit = 0
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024
        unit++
    }
    return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)}${units[unit]}`
}

/**
 * @description 网络速率自动单位格式化（KB/s → MB/s）
 * @param kbS 千字节每秒
 * @returns string 如 '1.5MB/s'
 *
 * @example fmtRate(1536) === '1.5MB/s'
 *
 */
function fmtRate (kbS: number): string {
    return kbS >= 1024 ? `${(kbS / 1024).toFixed(1)}MB/s` : `${kbS.toFixed(1)}KB/s`
}

/**
 * @description uptime 秒 → 天/时/分/秒可读文本
 * @param seconds 秒数
 * @returns string 如 '3天 4:05:06'
 *
 * @example fmtUptime(123456) 包含 '1天'
 *
 */
function fmtUptime (seconds: number): string {
    const d = Math.floor(seconds / 86400)
    const h = String(Math.floor((seconds % 86400) / 3600)).padStart(2, '0')
    const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')
    const s = String(seconds % 60).padStart(2, '0')
    return d > 0 ? `${d}${t('monitor.days')} ${h}:${m}:${s}` : `${h}:${m}:${s}`
}
</script>

<template>
    <div class="monitor-sidebar">
        <aside
            ref="sidebarEl"
            class="sidebar-panel"
            :class="{ resizing }"
            :style="{ width: `${open ? (draggingWidth ?? width) : SIDEBAR_COLLAPSED_WIDTH}px` }"
        >
            <template v-if="open">
            <div
                class="drag-handle"
                :class="{ resizing }"
                @pointerdown="onDragStart"
                @pointermove="onDragMove"
                @pointerup="onDragEnd"
                @pointercancel="onDragEnd"
            />
            <div class="sidebar-body" :style="open ? { width: `${draggingWidth ?? width}px` } : undefined">
                <div v-if="!profile" class="monitor-empty">{{ t('start.goCreate') }}</div>
                <template v-else>
                    <header class="sidebar-head">
                        <div class="sidebar-head-main">
                            <span class="sidebar-name">{{ profile.name }}</span>
                            <button
                                class="collapse-btn"
                                :title="t('monitor.collapse')"
                                @click="config.setMonitor({ open: false })"
                            >
                                <PanelRightClose class="h-4 w-4" />
                            </button>
                        </div>
                        <div class="sidebar-endpoint">{{ endpoint }}</div>
                        <div class="sidebar-meta">
                            <span v-if="connectionSource" class="monitor-badge">{{ connectionSource }}</span>
                            <span v-if="latest?.osInfo" class="monitor-os" :title="latest.osInfo">{{ latest.osInfo }}</span>
                            <span v-if="latest">{{ t('monitor.cpuCores', { n: latest.cpuCores }) }}</span>
                            <span v-if="latest">{{ t('monitor.uptime') }} {{ fmtUptime(latest.uptimeS) }}</span>
                            <span v-if="latest">{{ t('monitor.load') }} {{ latest.load.map(v => v.toFixed(2)).join(' / ') }}</span>
                            <span v-if="latest">{{ t('monitor.swapUsed') }} {{ fmtKb(latest.swap.usedKb) }} / {{ fmtKb(latest.swap.totalKb) }}</span>
                        </div>
                    </header>

                    <div v-if="errorState === MONITOR_ERROR_UNSUPPORTED" class="monitor-banner">{{ t('monitor.unsupported') }}</div>
                    <div v-else-if="errorState === MONITOR_ERROR_RECONNECTING" class="monitor-banner">{{ t('monitor.recovering') }}</div>
                    <div v-else-if="errorState" class="monitor-banner">{{ t('monitor.samplingError') }}：{{ errorState }}</div>
                    <div v-else-if="!latest" class="monitor-banner">{{ t('monitor.waiting') }}</div>

                    <div v-if="latest" class="monitor-charts">
                        <MetricChart :label="t('monitor.cpu')" :values="cpuSeries" color="var(--color-primary)" :max="100" />
                        <MetricChart :label="t('monitor.memory')" :values="memSeries" color="oklch(0.72 0.14 250)" :max="100" />
                        <MetricChart :label="`${t('monitor.network')} ${t('monitor.rx')}`" :values="rxSeries" color="oklch(0.75 0.14 165)" :format="fmtRate" />
                        <MetricChart :label="`${t('monitor.network')} ${t('monitor.tx')}`" :values="txSeries" color="oklch(0.75 0.14 60)" :format="fmtRate" />
                    </div>

                    <section v-if="latest?.disks?.length" class="monitor-disks">
                        <h4>{{ t('monitor.disks') }}</h4>
                        <div v-for="disk in latest.disks" :key="disk.mount" class="disk-row">
                            <span class="disk-mount" :title="disk.fs">{{ disk.mount }}</span>
                            <span class="disk-bar"><i :style="{ width: `${Math.min(100, disk.percent)}%` }" /></span>
                            <span class="disk-text">{{ fmtKb(disk.usedKb) }} / {{ fmtKb(disk.totalKb) }}</span>
                        </div>
                    </section>

                    <section v-if="latest?.processes?.length" class="monitor-processes">
                        <h4>
                            {{ t('monitor.processes') }}
                            <button class="sort-toggle" @click="processSort = processSort === 'cpu' ? 'mem' : 'cpu'">
                                {{ processSort === 'cpu' ? t('monitor.sortByCpu') : t('monitor.sortByMem') }}
                            </button>
                        </h4>
                        <table class="process-table">
                            <thead>
                                <tr>
                                    <th>{{ t('monitor.pid') }}</th>
                                    <th>{{ t('monitor.command') }}</th>
                                    <th>CPU%</th>
                                    <th>MEM%</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="proc in sortedProcesses" :key="proc.pid">
                                    <td class="mono">{{ proc.pid }}</td>
                                    <td class="proc-name" :title="proc.command">{{ proc.command }}</td>
                                    <td class="mono">{{ proc.cpuPercent.toFixed(1) }}</td>
                                    <td class="mono">{{ proc.memPercent.toFixed(1) }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </section>
                </template>
            </div>
            </template>

            <!-- 收起态：右缘细把手，点击展开（侧栏宽度过渡到 26px 时可见） -->
            <button
                v-else
                class="sidebar-collapsed-handle"
                :title="t('monitor.actionMonitor')"
                @click="config.setMonitor({ open: true })"
            >
                <Activity class="h-4 w-4" />
            </button>
        </aside>
    </div>
</template>

<style scoped>
.monitor-sidebar {
    display: flex;
    height: 100%;
    flex: none;
}
.sidebar-panel {
    border-left: 1px solid var(--color-border);
    display: flex;
    height: 100%;
    min-width: 0;
    overflow: hidden;
    position: relative;
    transition: width 0.2s ease;
}
/* 拖拽调宽时禁用过渡：宽度须实时跟手 */
.sidebar-panel.resizing {
    transition: none;
}
.drag-handle {
    cursor: col-resize;
    flex: none;
    height: 100%;
    left: -2px;
    position: absolute;
    touch-action: none;
    width: 5px;
    z-index: 2;
}
.drag-handle:hover,
.drag-handle.resizing {
    background: color-mix(in oklch, var(--color-primary) 45%, transparent);
}
.sidebar-body {
    /* 固定为展开宽度：宽度过渡期间内容不回流挤压，仅被 overflow 裁切露出 */
    flex: none;
    min-width: 0;
    overflow-y: auto;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.monitor-empty {
    color: var(--color-muted-foreground);
    padding: 24px 0;
    text-align: center;
}
.sidebar-head {
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.sidebar-head-main {
    align-items: center;
    display: flex;
    gap: 8px;
    justify-content: space-between;
}
.sidebar-name {
    color: var(--color-foreground);
    font-size: 14px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.collapse-btn {
    background: none;
    border: none;
    color: var(--color-muted-foreground);
    cursor: pointer;
    flex: none;
    padding: 2px;
}
.collapse-btn:hover {
    color: var(--color-foreground);
}
.sidebar-endpoint {
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.sidebar-meta {
    color: var(--color-muted-foreground);
    display: flex;
    flex-wrap: wrap;
    font-size: 11px;
    gap: 8px;
}
.monitor-badge {
    border: 1px solid var(--color-border);
    border-radius: 999px;
    font-size: 11px;
    line-height: 18px;
    padding: 0 8px;
}
.monitor-os {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.monitor-banner {
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    color: var(--color-muted-foreground);
    font-size: 12px;
    padding: 8px 10px;
    text-align: center;
}
.monitor-charts {
    display: grid;
    gap: 10px;
    grid-template-columns: 1fr;
}
.monitor-disks h4,
.monitor-processes h4 {
    color: var(--color-foreground);
    display: flex;
    align-items: center;
    font-size: 12px;
    gap: 8px;
    margin: 0 0 6px;
}
.disk-row {
    align-items: center;
    display: grid;
    font-size: 11px;
    gap: 8px;
    grid-template-columns: minmax(0, 88px) 1fr auto;
    margin-bottom: 5px;
}
.disk-mount {
    color: var(--color-foreground);
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.disk-bar {
    background: var(--color-border);
    border-radius: 999px;
    height: 5px;
    overflow: hidden;
}
.disk-bar i {
    background: var(--color-primary);
    display: block;
    height: 100%;
}
.disk-text {
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    white-space: nowrap;
}
.sort-toggle {
    background: none;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    color: var(--color-muted-foreground);
    cursor: pointer;
    font-size: 11px;
    padding: 1px 8px;
}
.process-table {
    border-collapse: collapse;
    font-size: 11px;
    width: 100%;
}
.process-table th {
    color: var(--color-muted-foreground);
    font-weight: 500;
    padding: 3px 8px 5px 0;
    text-align: left;
}
.process-table td {
    border-top: 1px solid var(--color-border);
    padding: 3px 8px 3px 0;
}
.mono {
    font-family: var(--font-mono);
    white-space: nowrap;
}
.proc-name {
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.sidebar-collapsed-handle {
    align-items: center;
    background: var(--color-card);
    border: none;
    color: var(--color-muted-foreground);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    height: 100%;
    justify-content: flex-start;
    padding: 10px 0;
    width: 100%;
}
.sidebar-collapsed-handle:hover {
    background: var(--color-border);
    color: var(--color-foreground);
}
</style>
