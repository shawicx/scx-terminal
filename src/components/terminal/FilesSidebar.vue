<!--
  @description SSH 终端页文件侧栏（标签页级，跟随活动窗格当前路径）：与监控侧栏
              同交互模式——可展开/收起（收起为右缘细把手）、左缘拖拽调宽，开合态
              与宽度持久化于 config store 的 files section。列目录走同连接的 SFTP
              channel（openSftp/readSftpDir）；双击文件夹 = 向该窗格终端发送
              cd 命令（由 TerminalTabContent 执行 emit navigate）。当前路径解析：
              优先窗格 OSC 7/1337 上报的 cwd（TerminalTabContent 轮询下发），
              远端 shell 未配置上报 hook 时退化为面板自跟踪路径（初始 = 远端
              home，双击导航时乐观更新），此限制下终端手动 cd 不会同步面板。
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { listen } from '@tauri-apps/api/event'
import { ArrowUp, File, Folder, FolderOpen, Link, PanelRightClose, RefreshCw } from 'lucide-vue-next'
import { useConfigStore } from '@/stores/config'
import { closeSftp, openSftp, readSftpDir, type SftpFileEntry } from '@/services/sftp'
import { breadcrumbSegments, parentPanePath, sortPaneEntries, type PaneEntry } from '@/lib/sftpPane'

const props = defineProps<{
    /** 活动窗格的 SSH 会话 id（null = 非 SSH 窗格或未连接） */
    sshId: string | null
    /** 活动窗格上报的当前目录（OSC 7/1337；null = 上报不可用） */
    cwd: string | null
}>()

const emit = defineEmits<{
    (e: 'navigate', path: string): void
    (e: 'refresh-cwd'): void
}>()

const { t } = useI18n()
const config = useConfigStore()

const open = computed(() => config.store.files.open === true)
const width = computed(() => config.store.files.width)

// ---- SFTP 会话状态 ----
const sftpId = ref('')
const home = ref('')
const opening = ref(false)
/** 面板自跟踪路径（无 OSC 上报时的浏览位置；双击进入时乐观更新） */
const trackedPath = ref('')
const entries = ref<PaneEntry[]>([])
const loading = ref(false)
const errorText = ref('')

/** 实际列目录路径：窗格上报 cwd 优先，其次面板自跟踪，最后远端 home */
const effectivePath = computed(() => props.cwd ?? trackedPath.value ?? home.value ?? null)

/** 上报 cwd 与自跟踪路径出现分歧（远端上报恢复/变化）时，重置自跟踪跟随上报 */
watch(() => props.cwd, reported => {
    if (reported && trackedPath.value && reported !== trackedPath.value) {
        trackedPath.value = ''
    }
})

/**
 * @description 关闭当前 SFTP 会话并清空列目录状态（连接切换/断开/组件卸载时）
 * @returns void
 *
 * @example resetSession()
 *
 */
function resetSession (): void {
    if (sftpId.value) {
        const id = sftpId.value
        sftpId.value = ''
        void closeSftp(id).catch(() => {})
    }
    home.value = ''
    trackedPath.value = ''
    entries.value = []
    errorText.value = ''
}

/**
 * @description 打开 SFTP 会话（面板展开且 sshId 就绪时调用；打开失败进错误横幅，
 *              重复调用在会话存续期内短路）
 * @param sshId 目标 SSH 会话 id
 * @returns void
 *
 * @example openSession('ssh-1')
 *
 */
function openSession (sshId: string): void {
    if (sftpId.value || opening.value) {
        return
    }
    opening.value = true
    errorText.value = ''
    openSftp(sshId)
        .then(result => {
            if (config.store.files.open && props.sshId === sshId) {
                sftpId.value = result.id
                home.value = result.home
            } else {
                void closeSftp(result.id).catch(() => {})
            }
        })
        .catch(err => {
            errorText.value = String(err)
        })
        .finally(() => {
            opening.value = false
        })
}

// 面板展开且 sshId 就绪时打开 SFTP 会话；sshId 变化/收起不主动关闭（多路复用
// 开销低），仅断开或组件卸载时关闭
watch([open, () => props.sshId], ([isOpen, sshId]) => {
    if (isOpen && sshId) {
        openSession(sshId)
    }
}, { immediate: true })

// SSH 会话断开（ssh:{id}:exit 事件）：关闭 SFTP 会话清态，面板退回等待
let unlistenExit: (() => void) | null = null
watch(() => props.sshId, async sshId => {
    unlistenExit?.()
    unlistenExit = null
    if (!sshId) {
        resetSession()
        return
    }
    unlistenExit = await listen(`ssh:${sshId}:exit`, () => resetSession())
}, { immediate: true })

onBeforeUnmount(() => {
    unlistenExit?.()
    resetSession()
})

/**
 * @description 刷新当前路径列目录（手动刷新按钮 / 路径变化触发）
 * @returns void
 *
 * @example refresh()
 *
 */
function refresh (): void {
    const path = effectivePath.value
    if (!sftpId.value || !path) {
        return
    }
    loading.value = true
    errorText.value = ''
    readSftpDir(sftpId.value, path)
        .then(list => {
            entries.value = sortPaneEntries(list as SftpFileEntry[], 'name', 'asc')
        })
        .catch(err => {
            entries.value = []
            errorText.value = String(err)
        })
        .finally(() => {
            loading.value = false
        })
}

watch(effectivePath, path => {
    if (path) {
        refresh()
    }
})

// 会话就绪（openSftp 完成写入 sftpId）后立即列一次目录
watch(sftpId, id => {
    if (id) {
        refresh()
    }
})

/**
 * @description 双击文件夹/点击面包屑祖先段：向终端发送 cd 并乐观更新面板浏览位置
 * @param path 目标目录绝对路径
 * @returns void
 *
 * @example navigateTo('/home/scx/project')
 *
 */
function navigateTo (path: string): void {
    trackedPath.value = path
    emit('navigate', path)
    emit('refresh-cwd')
}

const breadcrumbs = computed(() => effectivePath.value ? breadcrumbSegments(effectivePath.value) : [])
const parentPath = computed(() => effectivePath.value ? parentPanePath(effectivePath.value) : null)

/**
 * @description 字节数自动单位格式化（B/KB/MB/GB/TB；目录/未知显示空串）
 * @param size 字节数或 null
 * @returns string 格式化文本
 *
 * @example fmtSize(1536) === '1.5KB'
 *
 */
function fmtSize (size: number | null): string {
    if (size === null) {
        return ''
    }
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let value = size
    let unit = 0
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024
        unit++
    }
    return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)}${units[unit]}`
}

/* ---- 拖拽调宽（与监控侧栏同款：左缘手柄向左拖增宽；拖动中本地 ref，松手落库） ---- */
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
 * @description 侧栏拖拽结束：松手时把最终宽度持久化到 files section
 * @returns void
 *
 * @example onDragEnd()
 *
 */
function onDragEnd () {
    resizing.value = false
    if (draggingWidth.value !== null) {
        config.setFiles({ width: draggingWidth.value })
        draggingWidth.value = null
    }
}
</script>

<template>
    <div class="files-sidebar">
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
                <div class="sidebar-body" :style="{ width: `${draggingWidth ?? width}px` }">
                    <header class="sidebar-head">
                        <div class="sidebar-head-main">
                            <span class="sidebar-name">{{ t('files.title') }}</span>
                            <span v-if="entries.length" class="count-badge">{{ entries.length }}</span>
                            <button
                                class="head-btn"
                                :title="t('files.goParent')"
                                :disabled="!parentPath || parentPath === effectivePath"
                                @click="parentPath && parentPath !== effectivePath && navigateTo(parentPath)"
                            >
                                <ArrowUp class="h-3.5 w-3.5" />
                            </button>
                            <button class="head-btn" :title="t('files.refresh')" @click="refresh">
                                <RefreshCw class="h-3.5 w-3.5" />
                            </button>
                            <button
                                class="head-btn"
                                :title="t('files.collapse')"
                                @click="config.setFiles({ open: false })"
                            >
                                <PanelRightClose class="h-4 w-4" />
                            </button>
                        </div>
                        <div v-if="breadcrumbs.length" class="breadcrumb">
                            <template v-for="(segment, index) in breadcrumbs" :key="segment.path">
                                <span v-if="index > 0" class="crumb-sep">/</span>
                                <button
                                    class="crumb"
                                    :class="{ current: index === breadcrumbs.length - 1 }"
                                    :title="segment.path"
                                    @click="navigateTo(segment.path)"
                                >{{ segment.label }}</button>
                            </template>
                        </div>
                    </header>

                    <div v-if="!props.sshId" class="files-banner">{{ t('files.waiting') }}</div>
                    <div v-else-if="opening" class="files-banner">{{ t('files.opening') }}</div>
                    <div v-else-if="errorText" class="files-banner">
                        {{ t('files.error') }}：{{ errorText }}
                        <button v-if="!sftpId" class="retry-btn" @click="props.sshId && openSession(props.sshId)">{{ t('files.retry') }}</button>
                        <button v-else class="retry-btn" @click="refresh">{{ t('files.retry') }}</button>
                    </div>
                    <div v-else-if="loading && !entries.length" class="files-banner">{{ t('files.loading') }}</div>

                    <div v-if="sftpId && !errorText" class="entry-list">
                        <div
                            v-for="entry in entries"
                            :key="entry.path"
                            class="entry-row"
                            :class="{ dir: entry.isDir }"
                            :title="entry.isDir ? t('files.enterHint', { name: entry.name }) : entry.path"
                            @dblclick="entry.isDir && navigateTo(entry.path)"
                        >
                            <Folder v-if="entry.isDir" class="h-3.5 w-3.5 entry-icon dir" />
                            <File v-else class="h-3.5 w-3.5 entry-icon" />
                            <Link v-if="entry.isSymlink" class="h-3 w-3 entry-icon symlink" />
                            <span class="entry-name">{{ entry.name }}</span>
                            <span class="entry-size">{{ fmtSize(entry.size) }}</span>
                        </div>
                        <div v-if="!entries.length && !loading" class="files-banner">{{ t('files.empty') }}</div>
                    </div>
                </div>
            </template>

            <!-- 收起态：右缘细把手，点击展开 -->
            <button
                v-else
                class="sidebar-collapsed-handle"
                :title="t('files.actionFiles')"
                @click="config.setFiles({ open: true })"
            >
                <FolderOpen class="h-4 w-4" />
            </button>
        </aside>
    </div>
</template>

<style scoped>
.files-sidebar {
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
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
    padding: 10px 12px;
}
.sidebar-head {
    display: flex;
    flex-direction: column;
    flex: none;
    gap: 6px;
}
.sidebar-head-main {
    align-items: center;
    display: flex;
    gap: 6px;
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
.head-btn {
    align-items: center;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--color-muted-foreground);
    cursor: pointer;
    display: flex;
    flex: none;
    padding: 2px;
}
.head-btn:hover:not(:disabled) {
    background: var(--color-accent);
    color: var(--color-foreground);
}
.head-btn:disabled {
    cursor: default;
    opacity: 0.4;
}
.count-badge {
    background: var(--color-secondary);
    border-radius: 999px;
    color: var(--color-muted-foreground);
    flex: none;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    line-height: 15px;
    padding: 0 6px;
}
.breadcrumb {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    font-family: var(--font-mono);
    gap: 2px;
    overflow: hidden;
}
.crumb {
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--color-muted-foreground);
    cursor: pointer;
    font-family: inherit;
    font-size: 11px;
    max-width: 120px;
    overflow: hidden;
    padding: 1px 4px;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.crumb:hover {
    background: var(--color-accent);
    color: var(--color-foreground);
}
.crumb.current {
    color: var(--color-foreground);
}
.crumb-sep {
    color: var(--color-muted-foreground);
    font-size: 11px;
    opacity: 0.6;
}
.files-banner {
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    color: var(--color-muted-foreground);
    flex: none;
    font-size: 12px;
    padding: 8px 10px;
    text-align: center;
}
.retry-btn {
    background: none;
    border: none;
    color: var(--color-primary);
    cursor: pointer;
    font-size: 12px;
    margin-left: 6px;
    padding: 0;
    text-decoration: underline;
}
.entry-list {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 1px;
    min-height: 0;
    overflow-y: auto;
}
.entry-row {
    align-items: center;
    border-radius: var(--radius-sm);
    color: var(--color-foreground);
    display: flex;
    font-size: 12px;
    gap: 5px;
    min-width: 0;
    padding: 3px 6px;
}
.entry-row:hover {
    background: var(--color-accent);
}
.entry-row.dir .entry-name {
    font-weight: 500;
}
.entry-row.dir {
    cursor: pointer;
}
.entry-icon {
    color: var(--color-muted-foreground);
    flex: none;
}
.entry-icon.dir {
    color: var(--color-primary);
}
.entry-icon.symlink {
    color: var(--color-muted-foreground);
}
.entry-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.entry-size {
    color: var(--color-muted-foreground);
    flex: none;
    font-family: var(--font-mono);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
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
