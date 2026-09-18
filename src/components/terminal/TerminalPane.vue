<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronUp, ChevronDown, X } from 'lucide-vue-next'
import { BaseSession } from '@/lib/sessions/baseSession'
import { createSessionForProfile } from '@/lib/sessions'
import { SshSession } from '@/lib/sessions/sshSession'
import { XTermWebGLFrontend } from '@/lib/frontends/xtermFrontend'
import { createFrontendContext, readClipboardText, writeClipboardText } from '@/lib/frontendContext'
import { resolveColorScheme } from '@/lib/colorSchemes'
import type { TerminalProfile, SshProfile } from '@/stores/config'
import { encodeUTF8 } from '@/lib/utils/bytes'
import ContextMenu, { type ContextMenuItemSpec } from '@/components/ui/ContextMenu.vue'
import Button from '@/components/ui/Button.vue'
import HostKeyDialog from '@/components/terminal/HostKeyDialog.vue'
import ForwardPanel from '@/components/terminal/ForwardPanel.vue'
import type { HostKeyChallenge } from '@/services/ssh'
import { autoStartRules, ruleToSpec } from '@/lib/portForwarding'
import { startForward } from '@/services/forward'
import { registerPaneSession, unregisterPaneSession } from '@/services/sshConnections'
import { useTabsStore } from '@/stores/tabs'
import { useConfigStore } from '@/stores/config'
import { useThemeStore } from '@/stores/theme'
import SuggestionMenu from '@/components/terminal/SuggestionMenu.vue'
import { SuggestionsController, type SuggestionsUiState } from '@/lib/suggestions/controller'
import type { QuickCommandSource } from '@/lib/suggestions/suggestionEngine'
import { importShellHistoryForProfile } from '@/services/history'
import { listLocalDir, SshPathLister } from '@/services/pathCompletion'
import { openQuickCommandPalette } from '@/services/quickCommandPalette'

const props = defineProps<{
    active: boolean
    profile: TerminalProfile
    /** 继承的初始工作目录（新标签/分屏来自源窗格会话）；档案显式 cwd 优先于它 */
    initialCwd?: string | null
}>()

const emit = defineEmits<{
    (e: 'title', title: string): void
    (e: 'closed'): void
    (e: 'requestSplit', direction: 'right' | 'down'): void
}>()

const { t } = useI18n()
const tabsStore = useTabsStore()
const paneRoot = ref<HTMLElement>()
const mountError = ref('')
let session: BaseSession | null = null
let frontend: XTermWebGLFrontend | null = null
    let disposed = false
    /** 已登记进连接注册表的会话 id（destroyed$ 注销用） */
    let registeredSshId: string | null = null

// ---- 端口转发面板（SSH 档案专属）：右键菜单/expose 开关，随窗格销毁清理 ----
const forwardOpen = ref(false)
const sshSessionId = computed(() => (session instanceof SshSession ? session.sshSessionId : null))

// ---- SSH 主机指纹确认（TOFU）：SshSession 回调 → 对话框 → resolve 应答 ----
const hostKeyChallenge = ref<HostKeyChallenge | null>(null)
let hostKeyResolver: ((accepted: boolean) => void) | null = null

/**
 * @description SSH 首连/指纹失配时的确认回调：挂起等待用户在对话框中接受/拒绝
 * @param challenge 指纹确认请求（指纹/算法/是否失配）
 * @returns Promise<boolean> 是否信任该主机密钥
 *
 * @example await onHostKey({ fingerprint: 'SHA256:xxx', keyType: 'ssh-ed25519', changed: false })
 *
 */
function onHostKey (challenge: HostKeyChallenge): Promise<boolean> {
    return new Promise(resolve => {
        hostKeyResolver = resolve
        hostKeyChallenge.value = challenge
    })
}

function resolveHostKey (accepted: boolean): void {
    hostKeyChallenge.value = null
    hostKeyResolver?.(accepted)
    hostKeyResolver = null
}

/**
 * @description 解析 xterm 宿主元素。不能用模板 ref：宿主 div 位于 ContextMenu 插槽内，
 *              reka-ui 的 as-child 触发器（Slot.js）会删除插槽根元素的 ref 属性，
 *              因此挂载后改由窗格根元素向下查询获取
 * @returns HTMLElement 宿主元素
 *
 * @example resolveHostElement() // <div class="terminal-host">
 *
 */
function resolveHostElement (): HTMLElement {
    const host = paneRoot.value?.querySelector<HTMLElement>('.terminal-host')
    if (!host) {
        throw new Error('terminal host element not found')
    }
    return host
}

// ---- search overlay ----
const searchOpen = ref(false)
const searchQuery = ref('')
const searchResultCount = ref(0)
const searchInputEl = ref<HTMLInputElement>()

function openSearch (): void {
    searchOpen.value = true
    setTimeout(() => searchInputEl.value?.focus())
}

function closeSearch (): void {
    searchOpen.value = false
    frontend?.cancelSearch()
}

function runSearch (forward: boolean): void {
    if (!frontend || !searchQuery.value) {
        searchResultCount.value = 0
        return
    }
    const state = forward
        ? frontend.findNext(searchQuery.value, { incremental: true })
        : frontend.findPrevious(searchQuery.value)
    searchResultCount.value = state.resultCount
}

function onSearchKeydown (event: KeyboardEvent): void {
    if (event.key === 'Escape') {
        event.preventDefault()
        closeSearch()
    } else if (event.key === 'Enter') {
        event.preventDefault()
        runSearch(!event.shiftKey)
    }
}

// ---- 输入建议（自动补全）：controller 每窗格一个，随会话销毁 ----
const suggestionState = ref<SuggestionsUiState>({ open: false, items: [], selectedIndex: 0 })
const suggestionAnchor = ref<{ left: number, top: number, hostHeight: number, maxWidth: number }>({ left: 0, top: 0, hostHeight: 0, maxWidth: 0 })
let suggestions: SuggestionsController | null = null
let sshPathLister: SshPathLister | null = null
// setupSuggestions 时保存的宿主元素引用：onBeforeUnmount 里组件卸载后 resolveHostElement 可能拿不到，
// add/remove 事件监听共用同一引用保证对称
let suggestionHostEl: HTMLElement | null = null

/**
 * @description 历史分桶键：本地按档案、SSH 按主机（同源优先、全局兜底的「源」）
 */
function historySourceKey (): string {
    if (props.profile.type === 'ssh') {
        return `ssh:${props.profile.user}@${props.profile.host}:${props.profile.port}`
    }
    return `local:${props.profile.id}`
}

/** 建议运行配置（每次评估现读，配置变更即时生效） */
function suggestionsConfig () {
    const conf = configStore.store.terminal.suggestions
    return {
        enabled: conf?.enabled ?? true,
        trigger: conf?.trigger ?? 'auto',
        delay: conf?.delay ?? 200,
        sources: conf?.sources ?? { history: true, quickCommands: true, paths: true },
    }
}

/** 创建本窗格的建议控制器，并保存宿主元素引用供事件监听 add/remove 共用 */
function setupSuggestions (): void {
    suggestionHostEl = resolveHostElement()
    suggestions = new SuggestionsController({
        config: suggestionsConfig,
        isAlternateScreen: () => frontend?.isAlternateScreenActive() ?? false,
        isFocusedPane: () => props.active,
        readLine: () => frontend?.readLogicalLineNow() ?? null,
        readLineAbove: up => frontend?.readLogicalLineAbove(up) ?? null,
        readCursorPrefix: () => frontend?.readCursorPrefix() ?? null,
        anchorRect: () => frontend?.getSuggestionAnchorRect() ?? null,
        sourceKey: historySourceKey,
        cwd: async () => session?.getWorkingDirectory() ?? null,
        sshId: () => (session instanceof SshSession ? session.sshSessionId : null),
        listDir: async dir => {
            if (session instanceof SshSession && session.sshSessionId) {
                sshPathLister ??= new SshPathLister(session.sshSessionId)
                return sshPathLister.list(dir)
            }
            return listLocalDir(dir)
        },
        quickCommands: (): QuickCommandSource[] => configStore.store.quickCommands.map(qc => ({
            id: qc.id,
            name: qc.name,
            command: qc.command,
            groupName: configStore.store.quickCommandGroups.find(group => group.id === qc.groupId)?.name ?? null,
        })),
        sendInput: text => session?.feedFromTerminal(encodeUTF8(text)),
        openQuickCommandForm: quickCommandId => openQuickCommandPalette(quickCommandId),
        onState: state => {
            suggestionState.value = state
            if (state.open) {
                const rect = frontend?.getSuggestionAnchorRect()
                if (rect) {
                    suggestionAnchor.value = { left: rect.left, top: rect.top, hostHeight: rect.hostHeight, maxWidth: rect.hostWidth * 0.6 }
                }
            }
        },
    })
}

/** host capture keydown：菜单打开时拦截导航键（先于 xterm textarea，不进热键状态机） */
function onHostKeydownCapture (event: KeyboardEvent): void {
    if (suggestionState.value.open && suggestions?.handleKeydown(event)) {
        event.preventDefault()
        event.stopPropagation()
    }
}

/** 菜单条目点击回调：接受选中项（补全不执行） */
function onSuggestionSelect (index: number): void {
    suggestions?.acceptAt(index, false)
}

/**
 * @description 从剪贴板读取文本并写入当前会话（粘贴）
 * @returns Promise<void>
 *
 */
async function pasteFromClipboard (): Promise<void> {
    const text = await readClipboardText()
    if (text) {
        suggestions?.close(false)
        session?.feedFromTerminal(encodeUTF8(text.replace(/\r\n/g, '\n')))
    }
}

/**
 * @description 向本窗格会话写入一段文本（快捷命令用）：走 feedFromTerminal 复用输入中间件
 *              （换行转换/退格映射），本地与 SSH 会话同接口；写入后聚焦终端
 * @param text 待写入的文本（多行原样保留）
 * @param execute 是否在文本末尾补换行立即执行（快捷命令的 autoRun）
 * @returns void
 *
 * @example paneRef.value?.sendText('git status', true)
 *
 */
function sendText (text: string, execute = false): void {
    const normalized = text.replace(/\r\n/g, '\n')
    session?.feedFromTerminal(encodeUTF8(execute ? normalized + '\n' : normalized))
    frontend?.focus()
}

/**
 * @description 查询本窗格会话的当前工作目录（OSC 上报优先，进程探测兜底）
 * @returns Promise<string | null> 目录绝对路径或 null（会话未启动/已退出）
 *
 * @example await paneRef.value?.getWorkingDirectory()
 *
 */
async function getWorkingDirectory (): Promise<string | null> {
    if (!session) {
        return null
    }
    return session.getWorkingDirectory()
}

defineExpose({
    focus: () => frontend?.focus(),
    copy: () => frontend?.copySelection(),
    paste: () => pasteFromClipboard(),
    clear: () => frontend?.clear(),
    find: () => openSearch(),
    triggerSuggestions: () => suggestions?.triggerManually(),
    getWorkingDirectory,
    sendText,
    openSftpTab: () => {
        if (props.profile.type === 'ssh') {
            tabsStore.openSftpTab(props.profile.id)
        }
    },
    toggleForward: () => {
        if (props.profile.type === 'ssh') {
            forwardOpen.value = !forwardOpen.value
        }
    },
})

// ---- context menu ----
const menuHasSelection = ref(false)

/**
 * @description 右键菜单打开时刷新选区状态（用于"复制"项的禁用判定）
 * @param open 菜单是否打开
 * @returns void
 *
 */
function onMenuOpen (open: boolean): void {
    if (open) {
        menuHasSelection.value = !!frontend?.getSelection()
    }
}

const menuItems = computed<ContextMenuItemSpec[]>(() => [
    { key: 'copy', label: t('commands.copy'), disabled: !menuHasSelection.value },
    { key: 'paste', label: t('commands.paste') },
    { key: 'select-all', label: t('commands.selectAll') },
    { key: 'clear', label: t('commands.clear'), separatorBefore: true },
    { key: 'find', label: t('commands.find') },
    ...(props.profile.type === 'ssh'
        ? [
            { key: 'sftp', label: t('sftp.menuToggle'), separatorBefore: true },
            { key: 'forward', label: t('forward.menuToggle') },
        ]
        : []),    { key: 'split-right', label: t('commands.splitRight'), separatorBefore: true },
    { key: 'split-down', label: t('commands.splitDown') },
    { key: 'close-pane', label: t('commands.closePane'), danger: true },
])

/**
 * @description 处理终端右键菜单选择，动作复用窗格既有能力
 * @param key 菜单项 key
 * @returns void
 *
 */
function onMenuSelect (key: string): void {
    switch (key) {
        case 'copy':
            frontend?.copySelection()
            break
        case 'paste':
            void pasteFromClipboard()
            break
        case 'select-all':
            frontend?.selectAll()
            break
        case 'clear':
            frontend?.clear()
            break
        case 'find':
            openSearch()
            break
        case 'split-right':
            emit('requestSplit', 'right')
            break
        case 'split-down':
            emit('requestSplit', 'down')
            break
        case 'sftp':
            tabsStore.openSftpTab(props.profile.id)
            break
        case 'forward':
            forwardOpen.value = !forwardOpen.value
            break
        case 'close-pane':
            emit('closed')
            break
    }
}

// live-apply config changes (font, colors, scrollback, …)
const configStore = useConfigStore()

// 档案专属配色：档案指定配色名时解析后经 terminalColorScheme 通道下发，null 跟随全局
const paneColorScheme = computed(() => props.profile.colorScheme
    ? resolveColorScheme(
        props.profile.colorScheme,
        window.matchMedia('(prefers-color-scheme: light)').matches,
        configStore.store.colorSchemes,
    )
    : null)

watch(() => configStore.store, () => {
    frontend?.configure({ terminalColorScheme: paneColorScheme.value })
}, { deep: true })

// re-apply the terminal palette when the app theme (or OS scheme) changes
const themeStore = useThemeStore()
watch(() => themeStore.epoch, () => {
    frontend?.configure({ terminalColorScheme: paneColorScheme.value })
})

const searchNoResults = computed(() => searchOpen.value && !!searchQuery.value && searchResultCount.value === 0)

/**
 * @description SSH 会话建立成功后启动档案上 autoStart 的转发规则（失败仅告警：
 *              面板中的手动启动会呈现具体错误；重试启动/重连会再次触发）
 * @param sshId SSH 会话 id
 * @param profile SSH 档案（读取 forwardings）
 * @returns Promise<void>
 *
 */
async function startAutoForwards (sshId: string, profile: SshProfile): Promise<void> {
    for (const rule of autoStartRules(profile)) {
        try {
            await startForward(ruleToSpec(sshId, rule))
        } catch (error) {
            console.warn('auto-start forward failed', rule.id, error)
        }
    }
}

/**
 * @description 创建会话与前端并挂载到宿主元素（onMounted 与重试共用）
 * @returns Promise<void>
 *
 */
async function start (): Promise<void> {
    try {
        const context = createFrontendContext()
        // 中间件配置在会话构造期读取（退格/换行/OSC 52），配置变更对新窗格生效
        session = createSessionForProfile(props.profile, {
            setClipboard: writeClipboardText,
            backspace: configStore.store.terminal.backspace,
            inputNewlines: configStore.store.terminal.inputNewlines,
            outputNewlines: configStore.store.terminal.outputNewlines,
            onHostKey,
        })
        frontend = new XTermWebGLFrontend(context)
        frontend.configure({ terminalColorScheme: paneColorScheme.value })

        await frontend.attach(resolveHostElement(), { terminalColorScheme: paneColorScheme.value })
        if (disposed) {
            return
        }

        frontend.input$.subscribe(data => {
            suggestions?.notifyInput(data)
            session!.feedFromTerminal(data)
        })
        session.output$.subscribe(data => {
            void frontend!.write(data)
            suggestions?.notifyOutput()
        })
        frontend.resize$.subscribe(({ columns, rows }) => session!.resize(columns, rows))
        frontend.title$.subscribe(title => emit('title', title))
        frontend.bell$.subscribe(() => frontend!.visualBell())
        session.destroyed$.subscribe(() => {
            // 注销注册表中的窗格连接（SFTP 标签等消费者据此感知并转后台连接）
            if (registeredSshId) {
                unregisterPaneSession(props.profile.id, registeredSshId)
                registeredSshId = null
            }
            forwardOpen.value = false
            emit('closed')
        })

        if (disposed) {
            return
        }
        // 启动参数按档案类型组装：local 走 shell 命令（登录 shell 追加 -l，
        // 初始目录 = 档案 cwd > 继承 cwd > HOME 兜底）；ssh 走远端连接
        // （russh：连接/认证/PTY 由 Rust 完成，cwd 继承对远端无意义、忽略）
        if (props.profile.type === 'ssh') {
            await session.start({
                host: props.profile.host,
                port: props.profile.port,
                user: props.profile.user,
                auth: props.profile.auth,
                profileId: props.profile.id,
                keyId: props.profile.keyId,
                width: null,
                height: null,
            })
            // 连接建立后启动档案 autoStart 转发（会话 id 此刻可用）
            if (session instanceof SshSession && session.sshSessionId) {
                registeredSshId = session.sshSessionId
                registerPaneSession(props.profile.id, session.sshSessionId)
                void startAutoForwards(session.sshSessionId, props.profile)
            }
        } else {
            await session.start({
                command: props.profile.command,
                args: props.profile.loginShell ? [...props.profile.args, '-l'] : props.profile.args,
                env: { ...props.profile.env },
                cwd: props.profile.cwd ?? props.initialCwd ?? null,
                width: null,
                height: null,
            })
        }
        session.releaseInitialDataBuffer()
        // 防御性对齐：attach 期间 fit 的时序异常可能让 spawn 用上过时尺寸（本地与
        // SSH 会话均可能出现 COLUMNS ≠ 实际渲染列数），spawn 完成后立即以 xterm
        // 实际尺寸补一次 resize——不一致会破坏 zsh PROMPT_SP 补行等行宽敏感行为
        const { columns, rows } = frontend.getSize()
        session.resize(columns, rows)
        setupSuggestions()
        suggestionHostEl?.addEventListener('keydown', onHostKeydownCapture, true)
        // PromptTracker 以 awaitingPromptLearn 启动：先排一次静默，让首个提示符在任何输出前被学习
        suggestions?.notifyOutput()
        // 本地档案首次使用时导入 shell history 冷启动（幂等，fire-and-forget）
        void importShellHistoryForProfile(props.profile)
        if (props.active) {
            frontend.focus()
        }
    } catch (error) {
        // attach/start 失败时 input$ 订阅不会建立——必须把错误暴露出来，
        // 否则是一个不可输入且无任何提示的空白面板
        console.error('terminal pane failed to start', error)
        mountError.value = String(error instanceof Error ? error.message : error)
    }
}

/**
 * @description 启动失败后重试：清理半初始化的会话/前端/建议控制器后重新走 start
 * @returns Promise<void>
 *
 * @example 点击窗格错误浮层中的「重试」按钮
 *
 */
async function retryStart (): Promise<void> {
    mountError.value = ''
    suggestionHostEl?.removeEventListener('keydown', onHostKeydownCapture, true)
    suggestionHostEl = null
    suggestions?.destroy()
    suggestions = null
    void sshPathLister?.close()
    sshPathLister = null
    frontend?.destroy()
    frontend = null
    void session?.destroy()
    session = null
    await start()
}

onMounted(() => {
    void start()
})

// re-focus and repair the renderer when the tab becomes visible again
watch(() => props.active, active => {
    if (!active) {
        suggestions?.close(false)
    }
    if (active && frontend) {
        frontend.reactivate()
        frontend.focus()
    }
})

onBeforeUnmount(() => {
    disposed = true
    void session?.destroy()
    suggestionHostEl?.removeEventListener('keydown', onHostKeydownCapture, true)
    suggestionHostEl = null
    suggestions?.destroy()
    suggestions = null
    void sshPathLister?.close()
    sshPathLister = null
    frontend?.destroy()
    session = null
    frontend = null
})
</script>

<template>
    <div ref="paneRoot" class="terminal-pane">
        <ContextMenu :items="menuItems" @open="onMenuOpen" @select="onMenuSelect">
            <div class="terminal-host" :class="{ 'with-forward': forwardOpen }"></div>
        </ContextMenu>
        <ForwardPanel
            v-if="forwardOpen && props.profile.type === 'ssh' && sshSessionId"
            :ssh-id="sshSessionId"
            :profile="props.profile"
            @close="forwardOpen = false"
        />
        <div v-if="mountError" class="mount-error">
            <span class="mount-error-text">{{ mountError }}</span>
            <Button variant="outline" size="sm" @click="retryStart">{{ t('terminal.retry') }}</Button>
        </div>
        <HostKeyDialog
            v-if="hostKeyChallenge"
            :challenge="hostKeyChallenge"
            @accept="resolveHostKey(true)"
            @reject="resolveHostKey(false)"
        />
        <div v-if="searchOpen" class="search-bar">
            <input
                ref="searchInputEl"
                v-model="searchQuery"
                class="search-input"
                :placeholder="t('search.placeholder')"
                @input="runSearch(true)"
                @keydown="onSearchKeydown"
            />
            <span v-if="searchNoResults" class="search-status">{{ t('search.noResults') }}</span>
            <button class="search-button" @click="runSearch(false)"><ChevronUp :size="13" /></button>
            <button class="search-button" @click="runSearch(true)"><ChevronDown :size="13" /></button>
            <button class="search-button" @click="closeSearch"><X :size="13" /></button>
        </div>
        <SuggestionMenu
            v-if="suggestionState.open"
            :items="suggestionState.items"
            :selected-index="suggestionState.selectedIndex"
            :left="suggestionAnchor.left"
            :top="suggestionAnchor.top"
            :host-height="suggestionAnchor.hostHeight"
            :max-width="suggestionAnchor.maxWidth"
            @select="onSuggestionSelect"
        />
    </div>
</template>

<style scoped>
.terminal-pane {
    position: absolute;
    inset: 0;
}

.terminal-host {
    position: absolute;
    inset: 0;
}

/* 端口转发面板开启时收缩终端区域（xterm 的 ResizeObserver 自动 refit）；
   min() 与 ForwardPanel 面板宽度保持同一表达式，窄窗格下两侧按比例分摊 */
.terminal-host.with-forward {
    inset: 0 min(400px, 60%) 0 0;
}

.mount-error {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 16px;
    background: var(--color-background);
    color: var(--color-destructive);
    font-size: 13px;
    text-align: center;
    white-space: pre-wrap;
}

.mount-error-text {
    max-width: 560px;
    word-break: break-all;
}

.search-bar {
    position: absolute;
    top: 6px;
    right: 18px;
    z-index: var(--z-pane-overlay);
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px;
    background: var(--color-popover);
    color: var(--color-popover-foreground);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    animation: 0.125s cubic-bezier(0, 0, 0.2, 1) searchFadeIn;
}

.search-input {
    width: 180px;
    border: none;
    outline: none;
    background: transparent;
    color: inherit;
    font-size: 12px;
}

.search-status {
    color: var(--color-muted-foreground);
    font-size: 11px;
    white-space: nowrap;
}

.search-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--color-muted-foreground);
    cursor: default;
    transition: background-color 0.25s ease, color 0.25s ease;
}

.search-button:hover {
    background: var(--color-accent);
    color: var(--color-accent-foreground);
}

@keyframes searchFadeIn {
    from {
        opacity: 0;
        transform: translateY(-4px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}
</style>
