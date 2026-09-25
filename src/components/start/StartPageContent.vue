<!--
  @description 连接中心（起始页）标签页：左侧分组导航（主机区 + 本地终端区，各含全部/
              分组/管理入口）+ 右侧全局搜索 + 最近连接条 + 分组分段卡片网格（主机卡片/
              终端卡片随选中域切换）；连接状态点实时取自 sshConnections 的响应式
              connectionStates。
-->
<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Search, Server, Settings, SquareTerminal } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import HostCard from '@/components/start/HostCard.vue'
import { buildGroupViews, buildLocalSections, filterGroupViews, filterLocalSections, recentEntries, relativeTimeBucket } from '@/lib/startPage'
import { startCardMonitoring, stopCardMonitoring } from '@/services/monitor'
import { connectionErrors, connectionStates, type ProfileConnectionStatus } from '@/services/sshConnections'
import { useConfigStore, defaultFirstProfiles, type LocalProfile, type SshProfile } from '@/stores/config'
import { useTabsStore } from '@/stores/tabs'

const props = defineProps<{ tabId: string, tabActive: boolean }>()

const { t, locale } = useI18n()
const tabs = useTabsStore()
const config = useConfigStore()

// 标题在 setup 同步设置（避免闪空标题，同 ForwardingTabContent 先例）
tabs.setTitle(props.tabId, t('start.tabTitle'))

/** 当前域：主机（SSH）/ 本地终端；决定右侧内容与侧栏选中态 */
const domain = ref<'ssh' | 'local'>('ssh')
const selectedGroup = ref<'all' | string>('all')
const selectedLocalGroup = ref<'all' | string>('all')
const searchQuery = ref('')

/** 连接中心激活即对全部 SSH 档案启动卡片监控（页面驱动按需） */
const sshProfileIds = computed(() =>
    config.store.profiles.filter(p => p.type === 'ssh').map(p => p.id))

// 标签面板 v-show 常驻不卸载：卡片监控跟随 tabActive 激活/停用（离开页面即停）；
// 每次激活重新快照档案列表（orchestrator 跳过已绑定 id，幂等），顺带覆盖页面存续期间新增的档案
watch(() => props.tabActive, active => {
    if (active) {
        startCardMonitoring(sshProfileIds.value)
    } else {
        stopCardMonitoring()
    }
}, { immediate: true })
onUnmounted(() => {
    stopCardMonitoring()
})

/* 侧栏拖拽调宽范围（px） */
const SIDEBAR_MIN_WIDTH = 180
const SIDEBAR_MAX_WIDTH = 240

const sidebarEl = ref<HTMLElement | null>(null)
const sidebarWidth = ref(SIDEBAR_MIN_WIDTH)
const sidebarResizing = ref(false)

/**
 * @description 侧栏拖拽开始：把指针捕获到拖拽手柄，进入调宽状态
 * @param event 手柄上的指针按下事件
 * @returns void
 *
 * @example onSidebarResizeStart(event)
 *
 */
function onSidebarResizeStart (event: PointerEvent) {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    sidebarResizing.value = true
}

/**
 * @description 侧栏拖拽移动：按指针相对侧栏左缘的 x 坐标更新宽度（钳制 180–240）
 * @param event 手柄上的指针移动事件
 * @returns void
 *
 * @example onSidebarResizeMove(event)
 *
 */
function onSidebarResizeMove (event: PointerEvent) {
    if (!sidebarResizing.value || !sidebarEl.value) return
    const left = sidebarEl.value.getBoundingClientRect().left
    sidebarWidth.value = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(event.clientX - left)))
}

/**
 * @description 侧栏拖拽结束：释放指针捕获，退出调宽状态
 * @param event 手柄上的指针 up/cancel 事件
 * @returns void
 *
 * @example onSidebarResizeEnd(event)
 *
 */
function onSidebarResizeEnd (event: PointerEvent) {
    sidebarResizing.value = false
    const handle = event.currentTarget as HTMLElement
    if (handle.hasPointerCapture(event.pointerId)) {
        handle.releasePointerCapture(event.pointerId)
    }
}

const groupViews = computed(() => buildGroupViews(config.store.profiles, config.store.sshGroups))
const customGroups = computed(() => groupViews.value.filter(view => view.id !== 'default'))
const groupNames = computed(() => new Map(config.store.sshGroups.map(g => [g.id, g.name])))
const filteredViews = computed(() => filterGroupViews(groupViews.value, searchQuery.value, groupNames.value))
const visibleViews = computed(() => selectedGroup.value === 'all'
    ? filteredViews.value
    : filteredViews.value.filter(view => view.id === selectedGroup.value))
const sshProfiles = computed(() => config.store.profiles.filter((p): p is SshProfile => p.type === 'ssh'))
const activeCount = computed(() => sshProfiles.value.filter(p => connectionStates[p.id] === 'connected').length)
const recents = computed(() => recentEntries(config.store.recents, config.store.profiles))
const localProfiles = computed(() => defaultFirstProfiles(config.store.profiles).filter((p): p is LocalProfile => p.type === 'local'))
const hasAnySsh = computed(() => sshProfiles.value.length > 0)

/** 本地终端分段（分组定义序 + 未分组置末）与其搜索/选组过滤 */
const localSections = computed(() => buildLocalSections(config.store.profiles, config.store.localGroups))
const localGroupNames = computed(() => new Map(config.store.localGroups.map(g => [g.id, g.name])))
/** 侧栏本地分组成员计数（含未计入分组的悬空档案不计数，与分段视图一致） */
const localGroupCounts = computed(() => {
    const counts: Record<string, number> = {}
    for (const section of localSections.value) {
        if (section.group) {
            counts[section.group.id] = section.profiles.length
        }
    }
    return counts
})
const visibleLocalSections = computed(() => {
    const filtered = filterLocalSections(localSections.value, searchQuery.value)
    return selectedLocalGroup.value === 'all'
        ? filtered
        : filtered.filter(section => section.group?.id === selectedLocalGroup.value)
})

const weekdayLabels = computed(() => locale.value.startsWith('zh')
    ? ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])

/**
 * @description 分组显示名（默认组走 i18n，自定义组用配置名）
 * @param view 分组视图
 * @returns string 显示名
 *
 * @example groupLabel(views[0]) // '默认'
 *
 */
function groupLabel (view: { id: 'default' | string; name: string }): string {
    return view.id === 'default' ? t('start.defaultGroup') : view.name
}

/**
 * @description 本地终端分段显示名（未分组段即「默认分组」，走主机区同款 i18n 键）
 * @param section 分段视图
 * @returns string 显示名
 *
 * @example localSectionLabel({ group: null }) // '默认'
 *
 */
function localSectionLabel (section: { group: { name: string } | null }): string {
    return section.group ? section.group.name : t('start.defaultGroup')
}

/**
 * @description 档案当前连接状态（未登记视为 idle）
 * @param profileId 档案 id
 * @returns ProfileConnectionStatus 状态
 *
 * @example statusOf('ssh-1') // 'connected'
 *
 */
function statusOf (profileId: string): ProfileConnectionStatus {
    return connectionStates[profileId] ?? 'idle'
}

/**
 * @description 最近连接的相对时间文案（今天 HH:mm / 昨天 HH:mm / 周X / YYYY-MM-DD）
 * @param ts 连接时间（epoch 毫秒）
 * @returns string 显示文案
 *
 * @example recentLabel(Date.now()) // '15:04'
 *
 */
function recentLabel (ts: number): string {
    const bucket = relativeTimeBucket(ts)
    if (bucket.kind === 'today') {
        return bucket.time
    }
    if (bucket.kind === 'yesterday') {
        return `${t('start.yesterday')} ${bucket.time}`
    }
    if (bucket.kind === 'weekday') {
        return weekdayLabels.value[bucket.weekday] ?? bucket.date
    }
    return bucket.date
}
</script>

<template>
    <div class="start-page" :class="{ resizing: sidebarResizing }">
        <aside ref="sidebarEl" class="sidebar" :style="{ width: `${sidebarWidth}px` }">
            <div class="sidebar-label">{{ t('start.hostsLabel') }}</div>
            <button
                class="nav-item"
                :class="{ sel: domain === 'ssh' && selectedGroup === 'all' }"
                @click="domain = 'ssh'; selectedGroup = 'all'"
            >
                <span class="nav-name">{{ t('start.allHosts') }}</span>
                <span class="nav-count">{{ sshProfiles.length }}</span>
            </button>
            <button
                v-for="view in customGroups"
                :key="view.id"
                class="nav-item"
                :class="{ sel: domain === 'ssh' && selectedGroup === view.id }"
                @click="domain = 'ssh'; selectedGroup = view.id"
            >
                <span class="nav-name">{{ view.name }}</span>
                <span class="nav-count">{{ view.profiles.length }}</span>
            </button>
            <button class="manage-link" @click="tabs.openSettingsTab('ssh')">
                <Settings class="h-4 w-4" />
                {{ t('start.manageGroups') }}
            </button>
            <div class="locals">
                <div class="sidebar-label">{{ t('start.localTerminals') }}</div>
                <button
                    class="nav-item"
                    :class="{ sel: domain === 'local' && selectedLocalGroup === 'all' }"
                    @click="domain = 'local'; selectedLocalGroup = 'all'"
                >
                    <span class="nav-name">{{ t('start.allTerminals') }}</span>
                    <span class="nav-count">{{ localProfiles.length }}</span>
                </button>
                <button
                    v-for="group in config.store.localGroups"
                    :key="group.id"
                    class="nav-item"
                    :class="{ sel: domain === 'local' && selectedLocalGroup === group.id }"
                    @click="domain = 'local'; selectedLocalGroup = group.id"
                >
                    <span class="nav-name">{{ group.name }}</span>
                    <span class="nav-count">{{ localGroupCounts[group.id] ?? 0 }}</span>
                </button>
                <button class="manage-link" @click="tabs.openSettingsTab('profiles')">
                    <Settings class="h-4 w-4" />
                    {{ t('start.manageGroups') }}
                </button>
            </div>
        </aside>
        <!-- 侧栏调宽手柄：绝对定位跨骑侧栏右缘，不参与 flex 排布、不随侧栏滚动 -->
        <div
            class="sidebar-resizer"
            :style="{ left: `${sidebarWidth - 3}px` }"
            @pointerdown="onSidebarResizeStart"
            @pointermove="onSidebarResizeMove"
            @pointerup="onSidebarResizeEnd"
            @pointercancel="onSidebarResizeEnd"
        ></div>
        <section class="content">
            <header class="content-head">
                <div>
                    <h2 v-if="domain === 'ssh'" class="content-title">{{ selectedGroup === 'all' ? t('start.allHosts') : groupLabel({ id: selectedGroup, name: groupNames.get(selectedGroup) ?? '' }) }}</h2>
                    <h2 v-else class="content-title">{{ selectedLocalGroup === 'all' ? t('start.allTerminals') : localGroupNames.get(selectedLocalGroup) ?? '' }}</h2>
                    <p class="content-sub">
                        {{ domain === 'ssh'
                            ? t('start.hostsSummary', { n: sshProfiles.length, m: activeCount })
                            : t('start.localSummary', { n: localProfiles.length }) }}
                    </p>
                </div>
                <div class="search-box">
                    <Search class="h-4 w-4" />
                    <input v-model="searchQuery" type="text" :placeholder="t('start.searchPlaceholder')" />
                </div>
            </header>
            <div v-if="domain === 'ssh' && recents.length > 0" class="recents">
                <span class="sidebar-label">{{ t('start.recent') }}</span>
                <button
                    v-for="entry in recents"
                    :key="entry.profile.id"
                    class="recent-chip"
                    @click="tabs.openTerminalTab(entry.profile.id)"
                >
                    <span class="status-dot" :class="statusOf(entry.profile.id)" />
                    <span>{{ entry.profile.name }}</span>
                    <span class="recent-time">{{ recentLabel(entry.ts) }}</span>
                </button>
            </div>
            <!-- 分组切换过渡：key 绑定域 + 选中组，搜索过滤不触发重挂载 -->
            <Transition name="page-fade" mode="out-in">
                <div v-if="domain === 'local'" :key="`local-${selectedLocalGroup}`" class="group-views">
                    <p v-if="visibleLocalSections.length === 0" class="empty-hint">{{ t('start.noMatch') }}</p>
                    <section v-for="section in visibleLocalSections" :key="section.group?.id ?? '__ungrouped'" class="group-section">
                        <div class="group-title">{{ localSectionLabel(section) }} · {{ section.profiles.length }}</div>
                        <div class="card-grid">
                            <div
                                v-for="p in section.profiles"
                                :key="p.id"
                                class="local-card"
                                @click="tabs.openTerminalTab(p.id)"
                            >
                                <div class="local-card-head">
                                    <SquareTerminal class="local-card-icon" />
                                    <span class="local-card-name">{{ p.name }}</span>
                                    <span v-if="p.isDefault" class="local-card-badge">{{ t('start.defaultBadge') }}</span>
                                </div>
                                <div class="local-card-command">{{ p.command }}</div>
                            </div>
                        </div>
                    </section>
                </div>
                <div v-else-if="hasAnySsh" :key="selectedGroup" class="group-views">
                    <p v-if="visibleViews.length === 0" class="empty-hint">
                        {{ searchQuery.trim() ? t('start.noMatch') : t('start.noHosts') }}
                    </p>
                    <section v-for="view in visibleViews" :key="view.id" class="group-section">
                        <div class="group-title">{{ groupLabel(view) }} · {{ view.profiles.length }}</div>
                        <div class="card-grid">
                            <HostCard
                                v-for="p in view.profiles"
                                :key="p.id"
                                :profile="p"
                                :status="statusOf(p.id)"
                                :error="connectionErrors[p.id]"
                            />
                        </div>
                    </section>
                </div>
                <div v-else key="empty" class="empty-state">
                    <Server class="empty-icon" />
                    <h3>{{ t('start.emptyTitle') }}</h3>
                    <p>{{ t('start.emptyHint') }}</p>
                    <Button @click="tabs.openSettingsTab('ssh')">{{ t('start.goCreate') }}</Button>
                </div>
            </Transition>
        </section>
    </div>
</template>

<style scoped src="./StartPageContent.css"></style>
