<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useConfigStore } from '@/stores/config'
import { useCommands, paletteOpen } from '@/services/commands'
import { hotkeys } from '@/services/hotkeysSingleton'
import { metaKeyName } from '@/lib/hotkeys/hotkeys'
import { fuzzyMatch } from '@/lib/utils/fuzzy'

const { t } = useI18n()
const { sortedCommands } = useCommands()
const config = useConfigStore()

const query = ref('')
const selectedIndex = ref(0)
const inputEl = ref<HTMLInputElement>()

interface PaletteItem {
    id: string
    label: string
    hotkey: string
    handler: () => void
}

const items = computed<PaletteItem[]>(() => {
    return sortedCommands.value
        .map(command => ({
            id: command.id,
            label: command.label(),
            hotkey: command.hotkeyId
                ? (config.store.hotkeys[command.hotkeyId] ?? [])
                    .map(sequence => sequence.join('-'))
                    .join(', ')
                : '',
            handler: command.handler,
        }))
        .filter(item => fuzzyMatch(query.value, item.label) !== null)
        .sort((a, b) => (fuzzyMatch(query.value, b.label) ?? 0) - (fuzzyMatch(query.value, a.label) ?? 0))
})

watch(items, () => {
    selectedIndex.value = 0
})

function open (): void {
    paletteOpen.value = true
    hotkeys.disable()
    setTimeout(() => inputEl.value?.focus())
}

function close (): void {
    paletteOpen.value = false
    query.value = ''
    hotkeys.enable()
}

function pick (index: number): void {
    const item = items.value[index]
    if (item) {
        close()
        item.handler()
    }
}

function onInputKeydown (event: KeyboardEvent): void {
    if (event.key === 'Escape') {
        event.preventDefault()
        close()
    } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        selectedIndex.value = Math.min(selectedIndex.value + 1, items.value.length - 1)
    } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
    } else if (event.key === 'Enter') {
        event.preventDefault()
        pick(selectedIndex.value)
    } else if (event.key.toLowerCase() === 'p' && (event.metaKey || event.ctrlKey) && event.shiftKey) {
        // toggle closed with the same combo that opened it
        event.preventDefault()
        close()
    }
}

function displayHotkey (hotkey: string): string {
    if (!hotkey) {
        return ''
    }
    return metaKeyName === '⌘' ? hotkey : hotkey
}

watch(paletteOpen, value => {
    if (value) {
        open()
    } else {
        hotkeys.enable()
    }
})

onMounted(() => window.addEventListener('resize', close))
onBeforeUnmount(() => window.removeEventListener('resize', close))
</script>

<template>
    <Teleport to="body">
        <div v-if="paletteOpen" class="palette-backdrop" @mousedown.self="close">
            <div class="palette">
                <input
                    ref="inputEl"
                    v-model="query"
                    class="palette-input"
                    :placeholder="t('palette.placeholder')"
                    @keydown="onInputKeydown"
                />
                <div class="palette-list">
                    <button
                        v-for="(item, index) in items"
                        :key="item.id"
                        class="palette-item"
                        :class="{ selected: index === selectedIndex }"
                        @click="pick(index)"
                        @mousemove="selectedIndex = index"
                    >
                        <span class="palette-item-label">{{ item.label }}</span>
                        <span class="palette-item-hotkey">{{ displayHotkey(item.hotkey) }}</span>
                    </button>
                    <div v-if="items.length === 0" class="palette-empty">
                        {{ t('palette.noResults') }}
                    </div>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<style scoped>
.palette-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(0, 0, 0, 0.35);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 12vh;
    animation: 0.125s ease-out paletteFadeIn;
}

.palette {
    width: 520px;
    max-width: 90vw;
    background: var(--color-popover);
    color: var(--color-popover-foreground);
    border: 1px solid var(--color-border);
    border-radius: 10px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
    overflow: hidden;
    animation: 0.125s cubic-bezier(0, 0, 0.2, 1) paletteZoomIn;
}

.palette-input {
    width: 100%;
    box-sizing: border-box;
    padding: 12px 14px;
    border: none;
    border-bottom: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-foreground);
    font-size: 14px;
    outline: none;
}

.palette-input::placeholder {
    color: var(--color-muted-foreground);
}

.palette-list {
    max-height: 320px;
    overflow-y: auto;
    padding: 6px;
}

.palette-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    padding: 8px 10px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--color-foreground);
    font-size: 13px;
    text-align: left;
    cursor: default;
    transition: background 0.1s ease;
}

.palette-item.selected {
    background: var(--color-accent);
}

.palette-item-hotkey {
    color: var(--color-muted-foreground);
    font-size: 11px;
    font-family: monospace;
    flex-shrink: 0;
}

.palette-empty {
    padding: 16px;
    text-align: center;
    color: var(--color-muted-foreground);
    font-size: 13px;
}

@keyframes paletteFadeIn {
    from {
        opacity: 0;
    }
    to {
        opacity: 1;
    }
}

@keyframes paletteZoomIn {
    from {
        transform: scale(0.96);
        opacity: 0.4;
    }
    to {
        transform: scale(1);
        opacity: 1;
    }
}
</style>
