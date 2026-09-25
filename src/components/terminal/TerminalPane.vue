<script setup lang="ts">
/**
 * @description 终端窗格：会话+前端装配与生命周期（启动/重试/激活重聚焦）、右键菜单、
 *              搜索条、输入建议、SSH 挑战弹窗、转发面板与背景洗色。各关注点的状态机
 *              在 useXxx composable 中，本组件只做装配与生命周期编排。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { platform } from '@/lib/platform'
import { ChevronUp, ChevronDown, X } from 'lucide-vue-next'
import { BaseSession } from '@/lib/sessions/baseSession'
import { createSessionForProfile } from '@/lib/sessions'
import { SshSession } from '@/lib/sessions/sshSession'
import { XTermWebGLFrontend } from '@/lib/frontends/xtermFrontend'
import { createFrontendContext, readClipboardText, writeClipboardText } from '@/lib/frontendContext'
import { encodeUTF8 } from '@/lib/utils/bytes'
import ContextMenu from '@/components/ui/ContextMenu.vue'
import Button from '@/components/ui/Button.vue'
import HostKeyDialog from '@/components/terminal/HostKeyDialog.vue'
import CredentialDialog from '@/components/terminal/CredentialDialog.vue'
import ForwardPanel from '@/components/terminal/ForwardPanel.vue'
import SuggestionMenu from '@/components/terminal/SuggestionMenu.vue'
import { startAutoForwardRules } from '@/services/forward'
import { registerPaneSession, unregisterPaneSession } from '@/services/sshConnections'
import { importShellHistoryForProfile } from '@/services/history'
import { useTabsStore } from '@/stores/tabs'
import { useConfigStore } from '@/stores/config'
import { useThemeStore } from '@/stores/theme'
import type { TerminalProfile } from '@/stores/config'
import { useSshChallenges } from './useSshChallenges'
import { useTerminalSearch } from './useTerminalSearch'
import { usePaneSuggestions } from './usePaneSuggestions'
import { usePaneTheme } from './usePaneTheme'
import { usePaneMenu } from './usePaneMenu'

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
    (e: 'bell'): void
}>()

const { t } = useI18n()
const tabsStore = useTabsStore()
const configStore = useConfigStore()
const themeStore = useThemeStore()
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

// ---- SSH 挑战弹窗（TOFU 指纹 / kbd-interactive 凭据） ----
const {
    hostKeyChallenge, onHostKey, resolveHostKey,
    kbdChallenge, onKeyboardInteractive, resolveKbd,
} = useSshChallenges()

// ---- 搜索条 ----
const {
    searchOpen, searchQuery, setSearchInput, searchNoResults,
    openSearch, closeSearch, runSearch, onSearchKeydown, onSearchKeydownCapture, deactivate: deactivateSearch,
} = useTerminalSearch(() => frontend)

// ---- 输入建议 ----
const {
    suggestionState, suggestionAnchor, refreshAnchor, onSuggestionSelect,
    setup: setupSuggestions, teardown: teardownSuggestions,
    notifyInput, notifyOutput, notifyDirectRecord, close: closeSuggestions, triggerManually,
} = usePaneSuggestions({
    profile: () => props.profile,
    active: () => props.active,
    frontend: () => frontend,
    session: () => session,
    config: () => configStore.store,
    resolveHost: resolveHostElement,
})

// ---- 窗格主题（档案配色 + 背景洗色） ----
const { paneColorScheme, terminalBgWash } = usePaneTheme({
    profileColorScheme: () => props.profile.colorScheme,
    config: () => configStore.store,
})

// live-apply config changes (font, colors, scrollback, …)
watch(() => configStore.store, () => {
    frontend?.configure({ terminalColorScheme: paneColorScheme.value })
}, { deep: true })

// re-apply the terminal palette when the app theme (or OS scheme) changes
watch(() => themeStore.epoch, () => {
    frontend?.configure({ terminalColorScheme: paneColorScheme.value })
})

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

// ---- 右键菜单 ----
const { menuItems, onMenuOpen, onMenuSelect } = usePaneMenu({
    t,
    isSsh: () => props.profile.type === 'ssh',
    hasSelection: () => !!frontend?.getSelection(),
    actions: {
        copy: () => frontend?.copySelection(),
        paste: () => void pasteFromClipboard(),
        selectAll: () => frontend?.selectAll(),
        clear: () => frontend?.clear(),
        find: () => openSearch(),
        openSftp: () => tabsStore.openSftpTab(props.profile.id),
        toggleForward: () => { forwardOpen.value = !forwardOpen.value },
        splitRight: () => emit('requestSplit', 'right'),
        splitDown: () => emit('requestSplit', 'down'),
        closePane: () => emit('closed'),
    },
})

/**
 * @description 从剪贴板读取文本并写入当前会话（粘贴）
 * @returns Promise<void>
 *
 */
async function pasteFromClipboard (): Promise<void> {
    const text = await readClipboardText()
    if (text) {
        closeSuggestions(false)
        const normalized = text.replace(/\r\n/g, '\n')
        session?.feedFromTerminal(encodeUTF8(normalized))
        // 含换行的粘贴会直接执行：绕过 input$ 的命令经源文本直录历史
        if (/\r|\n/.test(normalized)) {
            notifyDirectRecord(normalized)
        }
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
    // autoRun 或自带换行 = 命令直接执行：同粘贴路径直录历史
    if (execute || /\r|\n/.test(normalized)) {
        notifyDirectRecord(normalized)
    }
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
    triggerSuggestions: () => triggerManually(),
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
            onKeyboardInteractive,
        })
        frontend = new XTermWebGLFrontend(context)
        frontend.configure({ terminalColorScheme: paneColorScheme.value })

        await frontend.attach(resolveHostElement(), { terminalColorScheme: paneColorScheme.value })
        if (disposed) {
            return
        }

        frontend.input$.subscribe(data => {
            notifyInput(data)
            session!.feedFromTerminal(data)
        })
        session.output$.subscribe(data => {
            void frontend!.write(data)
            notifyOutput()
        })
        frontend.resize$.subscribe(({ columns, rows }) => {
            session!.resize(columns, rows)
            // 菜单 open 时随 refit 重锚定：resize 后软换行/单元格尺寸变化，旧像素位置已失效
            if (suggestionState.value.open) {
                refreshAnchor()
            }
        })
        frontend.title$.subscribe(title => emit('title', title))
        frontend.bell$.subscribe(() => {
            frontend!.visualBell()
            // 冒泡给所属标签（后台标签据此打未读标记 + 发系统通知）
            emit('bell')
        })
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
            // 连接尝试已终结（成功/失败）：关闭可能残留的凭据弹窗；
            // 晚到的提交经 respondKbd 找不到 waiter 静默返回（同 hostkey 语义）
            if (kbdChallenge.value) {
                resolveKbd(null)
            }
            // 连接建立后启动档案 autoStart 转发（会话 id 此刻可用）
            if (session instanceof SshSession && session.sshSessionId) {
                registeredSshId = session.sshSessionId
                registerPaneSession(props.profile.id, session.sshSessionId)
                void startAutoForwardRules(session.sshSessionId, props.profile)
            }
        } else {
            await session.start({
                command: props.profile.command,
                // -l 是 POSIX 登录 shell 语义；Windows PowerShell 不识别该参数，直接跳过
                args: props.profile.loginShell && platform !== 'windows' ? [...props.profile.args, '-l'] : props.profile.args,
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
        // PromptTracker 以 awaitingPromptLearn 启动：先排一次静默，让首个提示符在任何输出前被学习
        notifyOutput()
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
    teardownSuggestions()
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
        closeSuggestions(false)
        deactivateSearch()
    }
    if (active && frontend) {
        // 窗格隐藏期间改过的字体/字号此时才测得到（display:none 下测量取 0×0 沿用旧值）
        frontend.remeasureFont()
        frontend.reactivate()
        frontend.focus()
    }
})

onBeforeUnmount(() => {
    disposed = true
    void session?.destroy()
    teardownSuggestions()
    frontend?.destroy()
    session = null
    frontend = null
})
</script>

<template>
    <div ref="paneRoot" class="terminal-pane" @keydown.capture="onSearchKeydownCapture">
        <ContextMenu :items="menuItems" @open="onMenuOpen" @select="onMenuSelect">
            <div class="terminal-host" :class="{ 'with-forward': forwardOpen }">
                <!-- 终端背景图层：图片 + 铺满宿主的半透明洗色（渐变层），消费全局
                     --term-bg-image/size/repeat/position 与窗格级 --term-bg-wash，
                     置于 xterm 之下（DOM 序即层序） -->
                <div class="terminal-bg" aria-hidden="true" :style="{ '--term-bg-wash': terminalBgWash }"></div>
            </div>
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
        <CredentialDialog
            v-if="kbdChallenge"
            :challenge="kbdChallenge"
            @submit="(responses: string[], remember: boolean) => resolveKbd({ responses, remember })"
            @cancel="resolveKbd(null)"
        />
        <div v-if="searchOpen" class="search-bar">
            <input
                :ref="setSearchInput"
                v-model="searchQuery"
                class="search-input"
                :placeholder="t('search.placeholder')"
                :aria-label="t('search.placeholder')"
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

<style scoped src="./TerminalPane.css"></style>
