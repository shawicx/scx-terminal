<script setup lang="ts">
/**
 * @description 终端标签页内容：分屏树容器 + 文件侧栏 + 监控侧栏（后两者仅 SSH 档案）。
 *              文件侧栏跟随活动窗格：轮询窗格 cwd（OSC 7/1337）与 sshId 下发，
 *              双击文件夹经 sendTextToLeaf 在该窗格执行 cd；远端无 OSC 上报时
 *              以输入命令行识别兜底——活动窗格执行的 cd 解析出目标后由面板
 *              SFTP 验证并跟随。系统文件拖入本标签页（终端区或文件面板）上传
 *              到面板当前浏览路径（webview 级拖放事件，悬停时浮层提示目标路径）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import SplitContainer from '@/components/split/SplitContainer.vue'
import MonitorSidebar from '@/components/monitor/MonitorSidebar.vue'
import FilesSidebar from '@/components/terminal/FilesSidebar.vue'
import { shellQuoteSingle } from '@/lib/shellQuote'
import { resolveCdTarget } from '@/lib/sessions/resolveCdTarget'
import {
    listLeaves,
    makeLeaf,
    neighborLeaf,
    removeLeaf,
    splitLeaf,
    type SplitNode,
} from '@/components/split/splitTree'
import { useTabsStore } from '@/stores/tabs'
import { fallbackProfile, useConfigStore, type TerminalProfile } from '@/stores/config'
import { terminalTabApi, registerTerminalTabApi, unregisterTerminalTabApi } from '@/services/terminalTabsApi'
import { sendBellNotification } from '@/services/notifications'
import { bindDetailMonitor, unbindDetailMonitor } from '@/services/monitor'

const props = defineProps<{
    tabId: string
    tabActive: boolean
    profileId?: string
}>()

const tabs = useTabsStore()
const config = useConfigStore()
const { t } = useI18n()
// 初始叶子继承标签创建时的 cwd（新标签来自上一个活动标签的活动窗格，见 commands.ts）
const tree = ref<SplitNode>(makeLeaf(tabs.tabs.find(t => t.id === props.tabId)?.cwd ?? undefined))
const activeLeafId = ref(tree.value.id)
const rootContainer = ref<InstanceType<typeof SplitContainer>>()
const paneTitles = reactive(new Map<string, string>())

// 本标签使用的配置档案：profileId 精确匹配 → 默认档案 → 兜底档案；
// 档案被编辑后此处响应式更新，新分屏窗格取新值（已运行会话不受影响）
const profile = computed<TerminalProfile>(() => {
    return config.store.profiles.find(p => p.id === props.profileId)
        ?? config.defaultProfile()
        ?? fallbackProfile()
})

function applyActiveTitle () {
    const title = paneTitles.get(activeLeafId.value)
    if (title) {
        tabs.setTitle(props.tabId, title)
    }
}

// 固定档案名为标签默认名：SSH/Mosh 恒固定（既有语义）；非默认本地档案随
// appearance.tabTitleSource（'profile' 固定档案名 = 默认，'shell' 采用 shell 上报的
// 动态标题）；默认本地档案恒采用动态标题
const pinsProfileName = computed(() => {
    if (profile.value.type === 'ssh' || profile.value.type === 'mosh') {
        return true
    }
    return profile.value.type === 'local'
        && !profile.value.isDefault
        && config.store.appearance.tabTitleSource === 'profile'
})

function setPaneTitle (leafId: string, title: string) {
    if (!title) {
        return
    }
    // 固定档案名的标签不采用 shell 上报的动态标题（手动重命名优先显示，不受影响）
    if (pinsProfileName.value) {
        return
    }
    paneTitles.set(leafId, title)
    if (leafId === activeLeafId.value) {
        tabs.setTitle(props.tabId, title)
    }
}

// 命名来源切回「档案名称」时，已开标签立即归位档案名：清掉记录过的 shell 标题（防
// 窗格切换时 applyActiveTitle 回放旧值）；manualTitle 存在时显示优先级仍更高
watch(pinsProfileName, pinned => {
    if (pinned) {
        paneTitles.clear()
        tabs.setTitle(props.tabId, profile.value.name)
    }
})

/**
 * @description 分屏：新窗格继承源窗格会话的当前工作目录（档案显式 cwd 仍优先，见 TerminalPane）
 * @param direction 分屏方向
 * @param leafId 源叶 id（缺省为活动叶）
 * @returns Promise<void>
 *
 * @example await split('right')
 *
 */
async function split (direction: 'right' | 'down', leafId?: string): Promise<void> {
    const sourceLeafId = leafId ?? activeLeafId.value
    const cwd = await rootContainer.value?.getLeafCwd(sourceLeafId)
    const result = splitLeaf(tree.value, sourceLeafId, direction, cwd ?? undefined)
    if (result) {
        tree.value = result.tree
        activeLeafId.value = result.newLeafId
    }
}

function closePane (id: string) {
    if (tree.value.type === 'leaf') {
        tabs.closeTab(props.tabId)
        return
    }
    const neighbor = neighborLeaf(tree.value, id, -1) ?? neighborLeaf(tree.value, id, 1)
    const updated = removeLeaf(tree.value, id)
    paneTitles.delete(id)
    if (updated) {
        tree.value = updated
        activeLeafId.value = neighbor && neighbor.id !== id ? neighbor.id : listLeaves(updated)[0]!.id
        applyActiveTitle()
    } else {
        tabs.closeTab(props.tabId)
    }
}

function navigatePane (delta: 1 | -1) {
    const neighbor = neighborLeaf(tree.value, activeLeafId.value, delta)
    if (neighbor) {
        activeLeafId.value = neighbor.id
        applyActiveTitle()
        rootContainer.value?.focusLeaf(neighbor.id)
    }
}

/**
 * @description 后台标签响铃：打未读标记并发送系统通知（前台标签仅窗格内
 *              visualBell 闪烁，不在此处理）
 * @returns void
 *
 * @example handleLeafBell()
 *
 */
function handleLeafBell () {
    if (props.tabActive) {
        return
    }
    tabs.markAlert(props.tabId)
    const tab = tabs.tabs.find(item => item.id === props.tabId)
    const title = tab?.manualTitle || tab?.title || 'Terminal'
    void sendBellNotification(props.tabId, title, t('tab.bellBody'))
}

// expose the active tab's actions to app-level commands (palette / hotkeys)
const tabApi = {
    split,
    closePane: () => closePane(activeLeafId.value),
    navigatePane,
    copy: () => rootContainer.value?.invokeOnLeaf(activeLeafId.value, 'copy'),
    paste: () => rootContainer.value?.invokeOnLeaf(activeLeafId.value, 'paste'),
    clear: () => rootContainer.value?.invokeOnLeaf(activeLeafId.value, 'clear'),
    find: () => rootContainer.value?.invokeOnLeaf(activeLeafId.value, 'find'),
    triggerSuggestions: () => rootContainer.value?.invokeOnLeaf(activeLeafId.value, 'triggerSuggestions'),
    toggleForward: () => rootContainer.value?.invokeOnLeaf(activeLeafId.value, 'toggleForward'),
    sendTextToActivePane: (text: string, execute?: boolean) =>
        rootContainer.value?.sendTextToLeaf(activeLeafId.value, text, execute),
    getActivePaneCwd: async (): Promise<string | null> =>
        (await rootContainer.value?.getLeafCwd(activeLeafId.value)) ?? null,
    captureActivePane: () => {
        const leafId = activeLeafId.value
        const container = rootContainer.value
        const key = container?.getLeafPaneKey(leafId)
        if (!container || !key) {
            return null
        }
        return {
            key,
            sendText: (text: string, execute?: boolean) => container.sendTextToLeaf(leafId, text, execute),
            tapOutput: (cb: (chunk: string) => void) => container.tapLeafOutput(leafId, cb) ?? (() => {}),
            isAlive: () => container.getLeafPaneKey(leafId) === key,
        }
    },
}

// 按标签登记 API：后台标签的右键操作（复制当前路径/另存为配置）不经激活直达本标签
registerTerminalTabApi(props.tabId, tabApi)

watch(() => props.tabActive, active => {
    if (active) {
        terminalTabApi.current = tabApi
        rootContainer.value?.focusLeaf(activeLeafId.value)
    } else if (terminalTabApi.current === tabApi) {
        terminalTabApi.current = null
    }
}, { immediate: true })

// 监控侧栏（仅 SSH 档案）：采样绑定条件 = 标签激活 && 侧栏展开；收起/切走即停（降级或
// 释放由编排器语义决定），v-show 常驻面板不卸载因此不能依赖挂载钩子
const isSshProfile = computed(() => profile.value.type === 'ssh')
const monitorActive = computed(() => isSshProfile.value && config.store.monitor.open === true)
watch([() => props.tabActive, monitorActive], ([active, open]) => {
    if (active && open) {
        bindDetailMonitor(profile.value.id)
    } else {
        unbindDetailMonitor(profile.value.id)
    }
}, { immediate: true })

onBeforeUnmount(() => {
    unbindDetailMonitor(profile.value.id)
    stopFilesPolling()
    resetFilesBinding()
    untapShellCommand?.()
    untapShellCommand = null
    unregisterTerminalTabApi(props.tabId)
    if (terminalTabApi.current === tabApi) {
        terminalTabApi.current = null
    }
})

// ---- 文件侧栏（仅 SSH 档案）：跟随活动窗格的 sshId 与当前路径 ----
const filesActiveSshId = ref<string | null>(null)
const filesCwd = ref<string | null>(null)
/** cwd 轮询间隔（毫秒）：OSC 7 上报无推送通道，展开期间轻量轮询 */
const FILES_POLL_INTERVAL_MS = 1500
let filesPollTimer: ReturnType<typeof setInterval> | null = null

/**
 * @description 解析活动窗格的 SSH 会话 id 并同步到文件侧栏（窗格切换/连接建立后调用）
 * @returns Promise<string | null> 活动 SSH 会话 id（非 SSH/未连接为 null）
 *
 * @example await refreshFilesBinding()
 *
 */
async function refreshFilesBinding (): Promise<string | null> {
    const sshId = await rootContainer.value?.getLeafSshId(activeLeafId.value)
    const next = sshId ?? null
    if (filesActiveSshId.value !== next) {
        filesActiveSshId.value = next
        if (!next) {
            filesCwd.value = null
        }
    }
    return next
}

/**
 * @description 文件侧栏 cwd 轮询单次执行：重解析 sshId 后查询窗格 cwd，仅当活动
 *              窗格仍是同一 SSH 会话时下发（防切换竞态写串面板）
 * @returns Promise<void>
 *
 * @example await pollFilesCwd()
 *
 */
async function pollFilesCwd (): Promise<void> {
    const sshId = await refreshFilesBinding()
    if (!sshId) {
        return
    }
    const cwd = await rootContainer.value?.getLeafCwd(activeLeafId.value)
    if (filesActiveSshId.value === sshId) {
        filesCwd.value = cwd ?? null
    }
}

/**
 * @description 启动/停止 cwd 轮询：仅「SSH 档案 && 文件侧栏展开 && 标签激活」时轮询
 * @returns void
 *
 * @example startFilesPolling()
 *
 */
function startFilesPolling (): void {
    if (filesPollTimer) {
        return
    }
    void pollFilesCwd()
    filesPollTimer = setInterval(() => void pollFilesCwd(), FILES_POLL_INTERVAL_MS)
}

/**
 * @description 停止 cwd 轮询（收起/切走标签时）：只停定时器，保留 sshId/cwd 绑定——
 *              切回标签面板才能原位恢复（清空会让 FilesSidebar 关闭 SFTP 会话并
 *              丢失自跟踪路径，表现为面板回退到 home 与终端不一致）
 * @returns void
 *
 * @example stopFilesPolling()
 *
 */
function stopFilesPolling (): void {
    if (filesPollTimer) {
        clearInterval(filesPollTimer)
        filesPollTimer = null
    }
}

/**
 * @description 清空面板跟随状态（组件卸载时彻底清理）
 * @returns void
 *
 * @example resetFilesBinding()
 *
 */
function resetFilesBinding (): void {
    filesActiveSshId.value = null
    filesCwd.value = null
}

const filesPolling = computed(() =>
    isSshProfile.value && config.store.files.open === true && props.tabActive)
watch(filesPolling, active => {
    if (active) {
        startFilesPolling()
    } else {
        stopFilesPolling()
    }
}, { immediate: true })

// 活动窗格切换立即重绑定（不等下一个轮询周期）
watch(activeLeafId, () => {
    if (filesPolling.value) {
        void refreshFilesBinding()
    }
})

// ---- 终端 cd 命令跟随（OSC 上报不可用时的兜底）：订阅活动窗格的 shell 命令行 ----
let untapShellCommand: (() => void) | null = null

/**
 * @description 处理活动窗格执行的命令行：无 OSC cwd 上报时解析 cd 目标并让文件
 *              面板验证跟随（不可确定性解析的形态返回 null，面板不动）
 * @param line 输入流还原的命令行文本
 * @returns void
 *
 * @example handleShellCommand('cd /var/log')
 *
 */
function handleShellCommand (line: string): void {
    // OSC 上报可用时轮询已同步 cwd，双机制无益且会与上报路径打架
    if (filesCwd.value !== null) {
        return
    }
    const candidate = resolveCdTarget(line, filesRef.value?.currentPath() ?? null, filesRef.value?.homePath() ?? null)
    if (candidate) {
        void filesRef.value?.followCwd(candidate)
    }
}

/**
 * @description 重挂活动窗格的 shell 命令订阅（活动窗格切换/面板轮询启停时）：
 *              先退旧订阅，nextTick 等新窗格挂载后挂 tap
 * @returns void
 *
 * @example retapShellCommand()
 *
 */
function retapShellCommand (): void {
    untapShellCommand?.()
    untapShellCommand = null
    if (!filesPolling.value) {
        return
    }
    void nextTick(() => {
        if (!filesPolling.value || !rootContainer.value) {
            return
        }
        untapShellCommand = rootContainer.value.tapLeafCommand(activeLeafId.value, handleShellCommand) ?? null
    })
}

// immediate：单窗格场景下 activeLeafId/filesPolling 自始不变，无 immediate 会永不挂订阅
watch([activeLeafId, filesPolling], () => retapShellCommand(), { immediate: true })

/**
 * @description 文件侧栏导航请求：向活动窗格终端发送 cd -- '<path>' 并立即执行
 * @param path 目标目录绝对路径
 * @returns void
 *
 * @example handleFilesNavigate('/home/scx/project')
 *
 */
function handleFilesNavigate (path: string): void {
    rootContainer.value?.sendTextToLeaf(activeLeafId.value, `cd -- ${shellQuoteSingle(path)}`, true)
}

// ---- 系统文件拖入上传：落点在本标签页内（终端区或文件面板）= 上传到面板当前路径 ----
const tabRoot = ref<HTMLElement | null>(null)
const filesRef = ref<InstanceType<typeof FilesSidebar>>()
/** 拖拽悬停中的上传目标路径（null = 不在可投放区域/面板不可用） */
const dropUploadPath = ref<string | null>(null)
let unlistenDragDrop: (() => void) | null = null
const filesDropEnabled = computed(() => isSshProfile.value && config.store.files.open === true)

/**
 * @description 判断拖放物理坐标（webview 事件为物理像素）是否落在本标签页根元素内
 * @param physicalX 物理像素 x
 * @param physicalY 物理像素 y
 * @returns boolean 是否命中
 *
 * @example pointInTab(100, 200)
 *
 */
function pointInTab (physicalX: number, physicalY: number): boolean {
    const el = tabRoot.value
    if (!el) {
        return false
    }
    const ratio = window.devicePixelRatio || 1
    const x = physicalX / ratio
    const y = physicalY / ratio
    const rect = el.getBoundingClientRect()
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

onMounted(() => {
    void (async () => {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview')
        unlistenDragDrop = await getCurrentWebview().onDragDropEvent(event => {
            const payload = event.payload
            if (!filesDropEnabled.value || !props.tabActive) {
                dropUploadPath.value = null
                return
            }
            if (payload.type === 'enter' || payload.type === 'over') {
                dropUploadPath.value = pointInTab(payload.position.x, payload.position.y)
                    ? filesRef.value?.currentPath() ?? null
                    : null
            } else if (payload.type === 'drop') {
                const target = dropUploadPath.value
                dropUploadPath.value = null
                if (target && payload.paths.length > 0) {
                    void filesRef.value?.upload(payload.paths)
                }
            } else {
                dropUploadPath.value = null
            }
        })
    })()
})

onBeforeUnmount(() => {
    unlistenDragDrop?.()
})
</script>

<template>
    <div ref="tabRoot" class="terminal-tab-content">
        <SplitContainer
            ref="rootContainer"
            class="split-root"
            :node="tree"
            :active-leaf-id="activeLeafId"
            :tab-active="tabActive"
            :profile="profile"
            @leaf-activated="id => (activeLeafId = id)"
            @leaf-title="setPaneTitle"
            @pane-closed="closePane"
            @leaf-split="(id, direction) => split(direction, id)"
            @leaf-bell="handleLeafBell"
            @tree-updated="updated => (tree = updated)"
        />
        <FilesSidebar
            ref="filesRef"
            v-if="isSshProfile"
            :ssh-id="filesActiveSshId"
            :cwd="filesCwd"
            @navigate="handleFilesNavigate"
            @refresh-cwd="pollFilesCwd"
        />
        <MonitorSidebar v-if="isSshProfile" :profile-id="profile.id" />
        <!-- 拖入系统文件悬停提示：覆盖终端区，松手上传到面板当前路径 -->
        <div v-if="dropUploadPath" class="drop-overlay">
            <div class="drop-hint">{{ t('files.dropHint', { path: dropUploadPath }) }}</div>
        </div>
    </div>
</template>

<style scoped>
.terminal-tab-content {
    height: 100%;
    display: flex;
    position: relative;
}

/* 根分栏容器必须占满可用空间：其内容（terminal-pane）为绝对定位，
   不占流内尺寸，若缺少 flex 尺寸根容器会坍塌为 0 宽度 */
.split-root {
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
}

/* 拖放上传浮层：半透明遮罩 + 居中虚线框提示目标路径；不拦截指针（drop 由 webview 事件处理） */
.drop-overlay {
    align-items: center;
    background: color-mix(in oklch, var(--color-primary) 8%, transparent);
    display: flex;
    inset: 0;
    justify-content: center;
    pointer-events: none;
    position: absolute;
    z-index: 30;
}
.drop-hint {
    border: 1.5px dashed color-mix(in oklch, var(--color-primary) 60%, transparent);
    border-radius: var(--radius);
    color: var(--color-foreground);
    font-family: var(--font-mono);
    font-size: 13px;
    max-width: 70%;
    overflow: hidden;
    padding: 10px 18px;
    text-overflow: ellipsis;
    white-space: nowrap;
}
</style>
