<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronUp, ChevronDown, X } from 'lucide-vue-next'
import { LocalSession } from '@/lib/sessions/localSession'
import { XTermWebGLFrontend } from '@/lib/frontends/xtermFrontend'
import { createFrontendContext, readClipboardText } from '@/lib/frontendContext'
import { defaultShell } from '@/services/shells'
import { encodeUTF8 } from '@/lib/utils/bytes'
import { useConfigStore } from '@/stores/config'
import { useThemeStore } from '@/stores/theme'

const props = defineProps<{
    active: boolean
}>()

const emit = defineEmits<{
    (e: 'title', title: string): void
    (e: 'closed'): void
}>()

const { t } = useI18n()
const host = ref<HTMLElement>()
const mountError = ref('')
let session: LocalSession | null = null
let frontend: XTermWebGLFrontend | null = null
let disposed = false

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

defineExpose({
    focus: () => frontend?.focus(),
    copy: () => frontend?.copySelection(),
    paste: async () => {
        const text = await readClipboardText()
        if (text) {
            session?.feedFromTerminal(encodeUTF8(text.replace(/\r\n/g, '\n')))
        }
    },
    clear: () => frontend?.clear(),
    find: () => openSearch(),
})

// live-apply config changes (font, colors, scrollback, …)
const configStore = useConfigStore()
watch(() => configStore.store, () => {
    frontend?.configure({ terminalColorScheme: null })
}, { deep: true })

// re-apply the terminal palette when the app theme (or OS scheme) changes
const themeStore = useThemeStore()
watch(() => themeStore.epoch, () => {
    frontend?.configure({ terminalColorScheme: null })
})

const searchNoResults = computed(() => searchOpen.value && !!searchQuery.value && searchResultCount.value === 0)

onMounted(async () => {
    try {
        const context = createFrontendContext()
        session = new LocalSession()
        frontend = new XTermWebGLFrontend(context)
        frontend.configure({ terminalColorScheme: null })

        await frontend.attach(host.value!, { terminalColorScheme: null })
        if (disposed) {
            return
        }

        frontend.input$.subscribe(data => session!.feedFromTerminal(data))
        session.output$.subscribe(data => void frontend!.write(data))
        frontend.resize$.subscribe(({ columns, rows }) => session!.resize(columns, rows))
        frontend.title$.subscribe(title => emit('title', title))
        frontend.bell$.subscribe(() => frontend!.visualBell())
        session.destroyed$.subscribe(() => emit('closed'))

        const shell = await defaultShell()
        if (disposed) {
            return
        }
        await session.start({
            command: shell.command,
            args: shell.args,
            env: {},
            cwd: null,
            width: null,
            height: null,
        })
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
    <div class="terminal-pane">
        <div ref="host" class="terminal-host"></div>
        <div v-if="mountError" class="mount-error">{{ mountError }}</div>
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
