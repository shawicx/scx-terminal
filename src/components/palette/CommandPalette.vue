<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useConfigStore } from '@/stores/config'
import { useCommands, paletteOpen } from '@/services/commands'
import { hotkeys } from '@/services/hotkeysSingleton'
import { formatKeystrokeForDisplay } from '@/lib/hotkeys/hotkeys'
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
                    .map(sequence => sequence.map(formatKeystrokeForDisplay).join(' '))
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
    // 热键恢复统一由 watch(paletteOpen → false) 负责：close 与 watch 各 enable 一次
    // 会让 disabledLevel 计数每轮开-关净减 1，归零判断失效后热键永久不可用
    paletteOpen.value = false
    query.value = ''
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
                        <span class="palette-item-hotkey">{{ item.hotkey }}</span>
                    </button>
                    <div v-if="items.length === 0" class="palette-empty">
                        {{ t('palette.noResults') }}
                    </div>
                </div>
            </div>
        </div>
    </Teleport>
</template>
<!-- 共用样式（遮罩/面板/输入框/条目/动画）见 src/assets/styles/palette.css -->
