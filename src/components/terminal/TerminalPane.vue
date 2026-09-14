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
import type { TerminalProfile } from '@/stores/config'
import { encodeUTF8 } from '@/lib/utils/bytes'
import ContextMenu, { type ContextMenuItemSpec } from '@/components/ui/ContextMenu.vue'
import HostKeyDialog from '@/components/terminal/HostKeyDialog.vue'
import SftpPanel from '@/components/terminal/SftpPanel.vue'
import type { HostKeyChallenge } from '@/services/ssh'
import { useConfigStore } from '@/stores/config'
import { useThemeStore } from '@/stores/theme'

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
const paneRoot = ref<HTMLElement>()
const mountError = ref('')
let session: BaseSession | null = null
let frontend: XTermWebGLFrontend | null = null
let disposed = false

// ---- SFTP 文件面板（SSH 档案专属）：右键菜单/expose 开关，随窗格销毁清理 ----
const sftpOpen = ref(false)
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

/**
 * @description 从剪贴板读取文本并写入当前会话（粘贴）
 * @returns Promise<void>
 *
 */
async function pasteFromClipboard (): Promise<void> {
    const text = await readClipboardText()
    if (text) {
        session?.feedFromTerminal(encodeUTF8(text.replace(/\r\n/g, '\n')))
    }
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
    getWorkingDirectory,
    toggleSftp: () => {
        if (props.profile.type === 'ssh') {
            sftpOpen.value = !sftpOpen.value
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
        ? [{ key: 'sftp', label: t('sftp.menuToggle'), separatorBefore: true }]
        : []),
    { key: 'split-right', label: t('commands.splitRight'), separatorBefore: true },
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
            sftpOpen.value = !sftpOpen.value
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

onMounted(async () => {
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

        frontend.input$.subscribe(data => session!.feedFromTerminal(data))
        session.output$.subscribe(data => void frontend!.write(data))
        frontend.resize$.subscribe(({ columns, rows }) => session!.resize(columns, rows))
        frontend.title$.subscribe(title => emit('title', title))
        frontend.bell$.subscribe(() => frontend!.visualBell())
        session.destroyed$.subscribe(() => {
            sftpOpen.value = false
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
        if (props.active) {
            frontend.focus()
        }
    } catch (error) {
        // attach/start 失败时 input$ 订阅不会建立——必须把错误暴露出来，
        // 否则是一个不可输入且无任何提示的空白面板
        console.error('terminal pane failed to start', error)
        mountError.value = String(error instanceof Error ? error.message : error)
    }
})

// re-focus and repair the renderer when the tab becomes visible again
watch(() => props.active, active => {
    if (active && frontend) {
        frontend.reactivate()
        frontend.focus()
    }
})

onBeforeUnmount(() => {
    disposed = true
    void session?.destroy()
    frontend?.destroy()
    session = null
    frontend = null
})
</script>

<template>
    <div ref="paneRoot" class="terminal-pane">
        <ContextMenu :items="menuItems" @open="onMenuOpen" @select="onMenuSelect">
            <div class="terminal-host" :class="{ 'with-sftp': sftpOpen }"></div>
        </ContextMenu>
        <SftpPanel
            v-if="sftpOpen && props.profile.type === 'ssh' && sshSessionId"
            :ssh-id="sshSessionId"
            @close="sftpOpen = false"
        />
        <div v-if="mountError" class="mount-error">{{ mountError }}</div>
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

/* SFTP 面板开启时收缩终端区域（xterm 的 ResizeObserver 自动 refit） */
.terminal-host.with-sftp {
    inset: 0 400px 0 0;
}

.mount-error {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: var(--color-background);
    color: var(--color-destructive);
    font-size: 13px;
    text-align: center;
    white-space: pre-wrap;
}

.search-bar {
    position: absolute;
    top: 6px;
    right: 18px;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px;
    background: var(--color-popover);
    color: var(--color-popover-foreground);
    border: 1px solid var(--color-border);
    border-radius: 8px;
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
    transition: all 0.25s ease;
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
