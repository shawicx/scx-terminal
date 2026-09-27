<!--
  @description SSH 终端页右侧监控侧栏（标签页级，跨所有窗格）：状态点 + 主机头
              （名称/endpoint/连接徽标/OS），下方三页签分段切换（概览/磁盘/进程，
              液态滑块 + 新视图轻浮入场）：概览 = 2×2 信息网格（运行/核心/负载/
              Swap）+ CPU/内存/网络收发 sparkline；磁盘 = 分级着色用量条；进程 =
              表格占满剩余高度内滚（粘性表头、CPU/MEM 分段排序），长列表不再
              推长整栏滚动。左缘拖拽调宽、可收起为右缘细把手；开合态与宽度持久
              化于 config store 的 monitor section；采样绑定生命周期归
              TerminalTabContent。入场 stagger 仅在每次展开（或换档案后首帧）
              播放一次，后续采样只更新数据不重放动画。
-->
<script setup lang="ts">
import { computed, markRaw, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Activity, Gauge, HardDrive, PanelRightClose, Table2 } from 'lucide-vue-next'
import { useMonitorStore, MONITOR_ERROR_UNSUPPORTED } from '@/stores/monitor'
import { MONITOR_ERROR_RECONNECTING } from '@/lib/monitorOrchestrator'
import { useConfigStore, type SshProfile } from '@/stores/config'
import { connectionSources, connectionStates } from '@/services/sshConnections'
import MetricChart from '@/components/monitor/MetricChart.vue'
import { gsap, moveHighlight, prefersReducedMotion, MOTION_EASE } from '@/lib/motion'

const props = defineProps<{ profileId: string }>()

const { t } = useI18n()
const config = useConfigStore()
const monitor = useMonitorStore()

const chartsEl = ref<HTMLDivElement>()
const tabsEl = ref<HTMLElement>()
const tabSliderEl = ref<HTMLElement>()
const viewContentEl = ref<HTMLElement>()

const open = computed(() => config.store.monitor.open === true)
const width = computed(() => config.store.monitor.width)

const latest = computed(() => monitor.latest[props.profileId] ?? null)

/* 入场 stagger 每个展开周期只播一次：latest 每次采样都变，若无闸会在每个采样
   周期重放整组卡片浮现（表现为整个面板像被刷新），故用旗标闸住 */
let entrancePlayed = false

// 侧栏展开（或展开态下首批样本到达）时图表卡 stagger 浮现（v-show 常驻不重挂，需主动触发；
// immediate：挂载时已展开且缓存有数据也要播入场）
watch([open, latest], ([isOpen, has]) => {
    if (!(isOpen && has) || entrancePlayed || prefersReducedMotion()) {
        return
    }
    entrancePlayed = true
    void nextTick(() => {
        const cards = chartsEl.value?.querySelectorAll('.metric-chart, .info-grid')
        if (cards?.length) {
            gsap.from(cards, {
                opacity: 0,
                y: 10,
                duration: 0.3,
                stagger: 0.06,
                ease: MOTION_EASE.move,
                clearProps: 'all',
            })
        }
    })
}, { immediate: true })

// 收起或切换档案后重置旗标：下次展开/首帧允许再次入场
watch(open, isOpen => {
    if (!isOpen) {
        entrancePlayed = false
    }
})
watch(() => props.profileId, () => {
    entrancePlayed = false
})

const profile = computed<SshProfile | undefined>(() =>
    config.store.profiles.find((p): p is SshProfile => p.id === props.profileId && p.type === 'ssh'))

/** 连接状态点语义（与连接中心主机卡同源）：idle/connecting/connected/failed */
const connectionState = computed(() => connectionStates[props.profileId] ?? 'idle')

/** 当前页签：概览（信息网格 + 曲线）/ 磁盘 / 进程；本地态，随侧栏存续 */
type MonitorView = 'overview' | 'disks' | 'processes'
const activeView = ref<MonitorView>('overview')

/** 页签定义（顺序即渲染顺序；图标 markRaw 避免组件被响应式代理） */
const viewTabs = computed(() => [
    { id: 'overview' as const, label: t('monitor.overview'), icon: markRaw(Gauge) },
    { id: 'disks' as const, label: t('monitor.disks'), icon: markRaw(HardDrive) },
    { id: 'processes' as const, label: t('monitor.processes'), icon: markRaw(Table2) },
])

/**
 * @description 页签液态滑块定位：把滑块移动到当前激活页签的位置与尺寸
 * @param animate true 补间滑移（切页签）；false 瞬时就位（首次定位/拖宽重排）
 * @returns void
 *
 * @example positionSlider(true)
 *
 */
function positionSlider (animate: boolean): void {
    const slider = tabSliderEl.value
    const tabs = tabsEl.value
    if (!slider || !tabs) {
        return
    }
    const target = tabs.querySelector<HTMLButtonElement>(`[data-view="${activeView.value}"]`)
    if (target) {
        moveHighlight(slider, target, animate && !prefersReducedMotion())
    }
}

// 页签条出现（展开/首帧/挂载即有数据）时瞬时定位滑块；宽度变化的重排 watch 在拖拽状态声明之后注册
watch([open, latest], ([isOpen]) => {
    if (isOpen) {
        void nextTick(() => positionSlider(false))
    }
}, { immediate: true })

// 切换页签：滑块液态滑移 + 新视图轻浮入场（v-show 常驻，需主动触发）
watch(activeView, () => {
    void nextTick(() => {
        positionSlider(true)
        const el = viewContentEl.value?.querySelector<HTMLElement>(`[data-view="${activeView.value}"]`)
        if (el && !prefersReducedMotion()) {
            gsap.fromTo(el,
                { opacity: 0, y: 8 },
                { opacity: 1, y: 0, duration: 0.22, ease: MOTION_EASE.enter, clearProps: 'opacity,transform' })
        }
    })
})

const errorState = computed(() => monitor.errors[props.profileId] ?? '')
const series = computed(() => monitor.samples[props.profileId] ?? [])
const cpuSeries = computed(() => series.value.map(s => s.cpuPercent))
const memSeries = computed(() => series.value.map(s => s.mem.percent))
const rxSeries = computed(() => series.value.map(s => s.netRates?.reduce((acc, n) => acc + n.rxKbS, 0) ?? null))
const txSeries = computed(() => series.value.map(s => s.netRates?.reduce((acc, n) => acc + n.txKbS, 0) ?? null))

/** 内存卡副信息：已用 / 总量 */
const memSub = computed(() => latest.value ? `${fmtKb(latest.value.mem.usedKb)} / ${fmtKb(latest.value.mem.totalKb)}` : '')

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

// 拖拽中（draggingWidth）与落库（width）宽度变化时瞬时重排滑块，防错位
watch([draggingWidth, width], () => {
    if (open.value) {
        void nextTick(() => positionSlider(false))
    }
})

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

/**
 * @description 磁盘占用分级着色：<70% 主题色、70–90% 琥珀、≥90% 危险红
 *              （语义色不随主题 token 漂移，与连接中心状态点同策略）
 * @param percent 磁盘占用百分比
 * @returns string CSS 颜色值
 *
 * @example diskTone(95) === 'var(--color-destructive)'
 *
 */
function diskTone (percent: number): string {
    if (percent >= 90) {
        return 'var(--color-destructive)'
    }
    return percent >= 70 ? 'oklch(0.78 0.14 75)' : 'var(--color-primary)'
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
                            <span class="status-dot" :class="connectionState" />
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
                        <div v-if="connectionSource || latest?.osInfo" class="sidebar-chips">
                            <span v-if="connectionSource" class="chip">{{ connectionSource }}</span>
                            <span v-if="latest?.osInfo" class="chip" :title="latest.osInfo">{{ latest.osInfo }}</span>
                        </div>
                    </header>

                    <div v-if="errorState === MONITOR_ERROR_UNSUPPORTED" class="monitor-banner">{{ t('monitor.unsupported') }}</div>
                    <div v-else-if="errorState === MONITOR_ERROR_RECONNECTING" class="monitor-banner">{{ t('monitor.recovering') }}</div>
                    <div v-else-if="errorState" class="monitor-banner">{{ t('monitor.samplingError') }}：{{ errorState }}</div>
                    <div v-else-if="!latest" class="monitor-banner">{{ t('monitor.waiting') }}</div>

                    <nav v-if="latest" ref="tabsEl" class="view-tabs">
                        <span ref="tabSliderEl" class="tab-slider" />
                        <button
                            v-for="view in viewTabs"
                            :key="view.id"
                            :data-view="view.id"
                            class="view-tab"
                            :class="{ active: activeView === view.id }"
                            @click="activeView = view.id"
                        >
                            <component :is="view.icon" class="h-3 w-3" />
                            <span>{{ view.label }}</span>
                        </button>
                    </nav>

                    <div v-if="latest" ref="viewContentEl" class="view-content">
                        <div v-show="activeView === 'overview'" data-view="overview" class="view-overview">
                            <div ref="chartsEl" class="overview-inner">
                                <div class="info-grid">
                                    <div class="info-tile">
                                        <span class="info-label">{{ t('monitor.uptime') }}</span>
                                        <span class="info-value">{{ fmtUptime(latest.uptimeS) }}</span>
                                    </div>
                                    <div class="info-tile">
                                        <span class="info-label">{{ t('monitor.cores') }}</span>
                                        <span class="info-value">{{ latest.cpuCores }}</span>
                                    </div>
                                    <div class="info-tile">
                                        <span class="info-label">{{ t('monitor.load') }}</span>
                                        <span class="info-value">{{ latest.load.map(v => v.toFixed(2)).join(' ') }}</span>
                                    </div>
                                    <div class="info-tile">
                                        <span class="info-label">{{ t('monitor.swapUsed') }}</span>
                                        <span class="info-value">{{ latest.swap.totalKb > 0 ? `${fmtKb(latest.swap.usedKb)} / ${fmtKb(latest.swap.totalKb)}` : '—' }}</span>
                                    </div>
                                </div>
                                <MetricChart :label="t('monitor.cpu')" :values="cpuSeries" color="var(--color-primary)" :max="100" :height="64" />
                                <MetricChart :label="t('monitor.memory')" :values="memSeries" color="oklch(0.72 0.14 250)" :max="100" :height="64" :sub="memSub" />
                                <MetricChart :label="`${t('monitor.network')} ↓ ${t('monitor.rx')}`" :values="rxSeries" color="oklch(0.75 0.14 165)" :height="64" :format="fmtRate" />
                                <MetricChart :label="`${t('monitor.network')} ↑ ${t('monitor.tx')}`" :values="txSeries" color="oklch(0.75 0.14 60)" :height="64" :format="fmtRate" />
                            </div>
                        </div>

                        <div v-show="activeView === 'disks'" data-view="disks" class="view-disks">
                            <template v-if="latest?.disks?.length">
                                <div v-for="disk in latest.disks" :key="disk.mount" class="disk-row">
                                    <div class="disk-head">
                                        <span class="disk-mount" :title="disk.fs">{{ disk.mount }}</span>
                                        <span class="disk-size">{{ fmtKb(disk.usedKb) }} / {{ fmtKb(disk.totalKb) }}</span>
                                        <span class="disk-pct">{{ disk.percent.toFixed(0) }}%</span>
                                    </div>
                                    <span class="disk-bar"><i :style="{ width: `${Math.min(100, disk.percent)}%`, background: diskTone(disk.percent) }" /></span>
                                </div>
                            </template>
                            <div v-else class="view-empty">{{ t('monitor.noData') }}</div>
                        </div>

                        <div v-show="activeView === 'processes'" data-view="processes" class="view-processes">
                            <template v-if="latest?.processes?.length">
                                <div class="section-head">
                                    <h4>{{ t('monitor.processes') }}<span class="count-badge">{{ sortedProcesses.length }}</span></h4>
                                    <div class="sort-seg">
                                        <button
                                            :class="{ active: processSort === 'cpu' }"
                                            :title="t('monitor.sortByCpu')"
                                            @click="processSort = 'cpu'"
                                        >CPU</button>
                                        <button
                                            :class="{ active: processSort === 'mem' }"
                                            :title="t('monitor.sortByMem')"
                                            @click="processSort = 'mem'"
                                        >MEM</button>
                                    </div>
                                </div>
                                <div class="process-table-wrap">
                                    <table class="process-table">
                                        <thead>
                                            <tr>
                                                <th>{{ t('monitor.pid') }}</th>
                                                <th>{{ t('monitor.command') }}</th>
                                                <th class="num">CPU%</th>
                                                <th class="num">MEM%</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr v-for="proc in sortedProcesses" :key="proc.pid">
                                                <td class="mono">{{ proc.pid }}</td>
                                                <td class="proc-name" :title="proc.command">{{ proc.command }}</td>
                                                <td class="mono num">{{ proc.cpuPercent.toFixed(1) }}</td>
                                                <td class="mono num">{{ proc.memPercent.toFixed(1) }}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </template>
                            <div v-else class="view-empty">{{ t('monitor.noData') }}</div>
                        </div>
                    </div>
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
/* 主体不再整栏滚动：头部/页签固定，各页签内容区自理滚动 */
.sidebar-body {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
    padding: 10px 12px;
}
.monitor-empty {
    color: var(--color-muted-foreground);
    padding: 24px 0;
    text-align: center;
}
.sidebar-head {
    display: flex;
    flex-direction: column;
    flex: none;
    gap: 5px;
}
.sidebar-head-main {
    align-items: center;
    display: flex;
    gap: 8px;
}
.sidebar-name {
    color: var(--color-foreground);
    flex: 1;
    font-size: 14px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.collapse-btn {
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--color-muted-foreground);
    cursor: pointer;
    flex: none;
    padding: 2px;
}
.collapse-btn:hover {
    background: var(--color-accent);
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
.sidebar-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
}
.chip {
    border: 1px solid var(--color-border);
    border-radius: 999px;
    color: var(--color-muted-foreground);
    font-size: 10px;
    line-height: 17px;
    max-width: 100%;
    overflow: hidden;
    padding: 0 8px;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.status-dot {
    border-radius: 50%;
    flex: none;
    height: 7px;
    width: 7px;
}
.status-dot.idle { background: var(--color-muted-foreground); opacity: 0.5; }
.status-dot.connected { background: oklch(0.77 0.15 152); }
.status-dot.connecting { background: var(--color-primary); animation: status-pulse 1.2s ease-in-out infinite; }
.status-dot.failed { background: var(--color-destructive); }
@keyframes status-pulse {
    0%, 100% { box-shadow: 0 0 0 0 color-mix(in oklch, var(--color-primary) 35%, transparent); }
    50% { box-shadow: 0 0 0 4px color-mix(in oklch, var(--color-primary) 35%, transparent); }
}
.monitor-banner {
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    color: var(--color-muted-foreground);
    flex: none;
    font-size: 12px;
    padding: 8px 10px;
    text-align: center;
}
.view-tabs {
    border: 1px solid var(--color-border);
    border-radius: 999px;
    display: flex;
    flex: none;
    gap: 2px;
    padding: 2px;
    position: relative;
}
.tab-slider {
    background: var(--color-accent);
    border-radius: 999px;
    left: 0;
    position: absolute;
    top: 0;
    will-change: transform, width, height;
    z-index: 0;
}
.view-tab {
    align-items: center;
    background: none;
    border: none;
    border-radius: 999px;
    color: var(--color-muted-foreground);
    cursor: pointer;
    display: flex;
    flex: 1;
    font-size: 11px;
    gap: 5px;
    justify-content: center;
    overflow: hidden;
    padding: 4px 0;
    position: relative;
    white-space: nowrap;
    z-index: 1;
}
.view-tab:hover {
    color: var(--color-foreground);
}
.view-tab.active {
    color: var(--color-foreground);
    font-weight: 500;
}
.view-content {
    display: flex;
    flex: 1;
    min-height: 0;
    min-width: 0;
}
.view-overview {
    display: flex;
    flex: 1;
    min-height: 0;
    min-width: 0;
    overflow-y: auto;
}
.overview-inner {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
}
.view-disks {
    flex: 1;
    min-height: 0;
    min-width: 0;
    overflow-y: auto;
}
.view-processes {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
}
.view-empty {
    align-items: center;
    color: var(--color-muted-foreground);
    display: flex;
    flex: 1;
    font-size: 12px;
    justify-content: center;
}
.info-grid {
    display: grid;
    gap: 6px;
    grid-template-columns: 1fr 1fr;
}
.info-tile {
    background: var(--color-card);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    padding: 7px 10px;
}
.info-label {
    color: var(--color-muted-foreground);
    font-size: 10px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
}
.info-value {
    color: var(--color-foreground);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.disk-row {
    margin-bottom: 10px;
}
.disk-row:last-child {
    margin-bottom: 0;
}
.disk-head {
    align-items: baseline;
    display: flex;
    font-size: 11px;
    gap: 8px;
    margin-bottom: 4px;
}
.disk-mount {
    color: var(--color-foreground);
    flex: 1;
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.disk-size {
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 10px;
    white-space: nowrap;
}
.disk-pct {
    color: var(--color-foreground);
    flex: none;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    min-width: 34px;
    text-align: right;
}
.disk-bar {
    background: var(--color-border);
    border-radius: 999px;
    display: block;
    height: 5px;
    overflow: hidden;
}
.disk-bar i {
    border-radius: 999px;
    display: block;
    height: 100%;
    transition: width 0.4s ease;
}
.section-head {
    align-items: center;
    display: flex;
    flex: none;
    justify-content: space-between;
    margin-bottom: 8px;
}
.section-head h4 {
    color: var(--color-muted-foreground);
    display: flex;
    align-items: center;
    font-size: 10px;
    font-weight: 500;
    gap: 6px;
    letter-spacing: 0.04em;
    margin: 0;
    text-transform: uppercase;
}
.count-badge {
    background: var(--color-secondary);
    border-radius: 999px;
    color: var(--color-muted-foreground);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    line-height: 15px;
    padding: 0 6px;
}
.sort-seg {
    border: 1px solid var(--color-border);
    border-radius: 999px;
    display: flex;
    overflow: hidden;
}
.sort-seg button {
    background: none;
    border: none;
    color: var(--color-muted-foreground);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 2px 9px;
}
.sort-seg button + button {
    border-left: 1px solid var(--color-border);
}
.sort-seg button.active {
    background: var(--color-accent);
    color: var(--color-foreground);
}
.process-table-wrap {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
}
.process-table {
    border-collapse: collapse;
    font-size: 11px;
    width: 100%;
}
.process-table th {
    background: var(--color-background);
    color: var(--color-muted-foreground);
    font-weight: 500;
    padding: 3px 8px 5px 0;
    position: sticky;
    text-align: left;
    top: 0;
    z-index: 1;
}
.process-table td {
    border-top: 1px solid var(--color-border);
    padding: 3px 8px 3px 0;
}
.process-table tbody tr:hover {
    background: var(--color-accent);
}
.mono {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}
.num {
    text-align: right;
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
