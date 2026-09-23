<!--
  @description 连接中心（起始页）标签页：左侧分组导航（全部主机默认选中 + 分组计数 +
              管理入口 + 本地终端区），右侧全局搜索 + 最近连接条 + 分组分段主机卡片网格；
              连接状态点实时取自 sshConnections 的响应式 connectionStates。
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, Search, Server, Settings } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import HostCard from '@/components/start/HostCard.vue'
import { buildGroupViews, filterGroupViews, recentEntries, relativeTimeBucket } from '@/lib/startPage'
import { connectionErrors, connectionStates, type ProfileConnectionStatus } from '@/services/sshConnections'
import { useConfigStore, defaultFirstProfiles, type SshProfile } from '@/stores/config'
import { useTabsStore } from '@/stores/tabs'

const props = defineProps<{ tabId: string }>()

const { t, locale } = useI18n()
const tabs = useTabsStore()
const config = useConfigStore()

// 标题在 setup 同步设置（避免闪空标题，同 ForwardingTabContent 先例）
tabs.setTitle(props.tabId, t('start.tabTitle'))

const selectedGroup = ref<'all' | string>('all')
const searchQuery = ref('')

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
const localProfiles = computed(() => defaultFirstProfiles(config.store.profiles).filter(p => p.type === 'local'))
const hasAnySsh = computed(() => sshProfiles.value.length > 0)

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
            <button class="nav-item" :class="{ sel: selectedGroup === 'all' }" @click="selectedGroup = 'all'">
                <span class="nav-name">{{ t('start.allHosts') }}</span>
                <span class="nav-count">{{ sshProfiles.length }}</span>
            </button>
            <button
                v-for="view in customGroups"
                :key="view.id"
                class="nav-item"
                :class="{ sel: selectedGroup === view.id }"
                @click="selectedGroup = view.id"
            >
                <span class="nav-name">{{ view.name }}</span>
                <span class="nav-count">{{ view.profiles.length }}</span>
            </button>
            <button class="manage-link" @click="tabs.openSettingsTab('ssh')">
                <Settings class="h-4 w-4" />
                {{ t('start.manageGroups') }}
            </button>
            <div v-if="localProfiles.length > 0" class="locals">
                <div class="sidebar-label">{{ t('start.localTerminals') }}</div>
                <button v-for="p in localProfiles" :key="p.id" class="local-chip" @click="tabs.openTerminalTab(p.id)">
                    <span class="local-name">{{ p.name }}</span>
                    <span v-if="p.isDefault" class="badge">{{ t('start.defaultBadge') }}</span>
                </button>
                <button class="local-chip ghost" @click="tabs.openSettingsTab('profiles')">
                    <Plus class="h-4 w-4" />
                    {{ t('start.newProfile') }}
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
                    <h2 class="content-title">{{ selectedGroup === 'all' ? t('start.allHosts') : groupLabel({ id: selectedGroup, name: groupNames.get(selectedGroup) ?? '' }) }}</h2>
                    <p class="content-sub">{{ t('start.hostsSummary', { n: sshProfiles.length, m: activeCount }) }}</p>
                </div>
                <div class="search-box">
                    <Search class="h-4 w-4" />
                    <input v-model="searchQuery" type="text" :placeholder="t('start.searchPlaceholder')" />
                </div>
            </header>
            <div v-if="recents.length > 0" class="recents">
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
            <!-- 分组切换过渡：key 绑定 selectedGroup，搜索过滤不触发重挂载 -->
            <Transition name="page-fade" mode="out-in">
                <div v-if="hasAnySsh" :key="selectedGroup" class="group-views">
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

<style scoped>
.start-page {
    position: relative;
    display: flex;
    height: 100%;
    background: var(--color-background);
    color: var(--color-foreground);
    font-size: 13px;
}
/* 拖拽调宽期间禁用文本选择，避免指针扫过内容时选中文字 */
.start-page.resizing {
    user-select: none;
}
.sidebar {
    flex: none;
    border-right: 1px solid var(--color-border);
    padding: 14px 10px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    overflow-y: auto;
}
/* 侧栏右缘调宽手柄：6px 热区跨骑边框线（left 由模板按 sidebarWidth 定位） */
.sidebar-resizer {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 6px;
    z-index: 10;
    cursor: col-resize;
    touch-action: none;
    transition: background-color 0.15s ease;
}
.sidebar-resizer:hover,
.sidebar-resizer:active {
    background: color-mix(in oklch, var(--color-primary) 40%, transparent);
}
.sidebar-label {
    font-size: 10px;
    letter-spacing: 0.14em;
    color: var(--color-muted-foreground);
    padding: 0 8px;
    margin-bottom: 4px;
}
.nav-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 10px;
    border-radius: var(--radius-md);
    border: 1px solid transparent;
    color: var(--color-foreground);
    opacity: 0.85;
    text-align: left;
    transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}
.nav-item:hover { background: var(--color-card); }
.nav-item.sel {
    background: var(--color-card);
    border-color: var(--color-border);
    opacity: 1;
}
.nav-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nav-count { color: var(--color-muted-foreground); font-size: 11px; flex: none; }
.manage-link {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 6px 10px;
    margin-top: 6px;
    border-radius: var(--radius-md);
    color: var(--color-muted-foreground);
    font-size: 12px;
    text-align: left;
    transition: background-color 0.15s ease, color 0.15s ease;
}
.manage-link:hover { background: var(--color-card); color: var(--color-foreground); }
.locals { margin-top: auto; display: flex; flex-direction: column; gap: 6px; }
.local-chip {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    border: 1px solid var(--color-border);
    background: var(--color-card);
    border-radius: var(--radius-md);
    padding: 5px 12px;
    color: var(--color-foreground);
    font-size: 12px;
    transition: border-color 0.15s ease;
}
.local-chip:hover { border-color: color-mix(in oklch, var(--color-primary) 45%, transparent); }
.local-chip.ghost { justify-content: center; gap: 6px; color: var(--color-muted-foreground); }
.local-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.badge { color: var(--color-muted-foreground); font-size: 10px; flex: none; }
.content { flex: 1; min-width: 0; padding: 18px 22px; overflow-y: auto; }
.content-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.content-title { font-size: 15px; font-weight: 600; }
.content-sub { color: var(--color-muted-foreground); font-size: 11px; margin-top: 2px; }
.search-box {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 240px;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    background: var(--color-background);
    padding: 6px 12px;
    color: var(--color-muted-foreground);
}
.search-box input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--color-foreground);
    font-size: 12px;
    min-width: 0;
}
.recents { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
.recent-chip {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    border: 1px solid var(--color-border);
    background: var(--color-card);
    border-radius: var(--radius-md);
    padding: 4px 10px;
    color: var(--color-foreground);
    font-size: 11px;
    white-space: nowrap;
    transition: border-color 0.15s ease;
}
.recent-chip:hover { border-color: color-mix(in oklch, var(--color-primary) 45%, transparent); }
.recent-time { color: var(--color-muted-foreground); }
.group-section { margin-top: 16px; }
.group-title { font-size: 10px; letter-spacing: 0.14em; color: var(--color-muted-foreground); }
.card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 10px;
    margin-top: 8px;
}
.empty-hint { color: var(--color-muted-foreground); margin-top: 24px; }
.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    margin-top: 10%;
    color: var(--color-muted-foreground);
    text-align: center;
}
.empty-icon { width: 40px; height: 40px; }
.empty-state h3 { color: var(--color-foreground); font-size: 14px; }
.status-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.status-dot.idle { background: var(--color-muted-foreground); opacity: 0.5; }
.status-dot.connected { background: oklch(0.77 0.15 152); }
.status-dot.connecting { background: var(--color-primary); }
.status-dot.failed { background: var(--color-destructive); }
</style>
