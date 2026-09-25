<!--
  @description 设置·快捷键页：命令绑定列表 + 点击录制（全局按键流订阅，
              Escape 取消 / Backspace 清除 / 其余写入单键序列）。
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Label from '@/components/ui/Label.vue'
import { useConfigStore } from '@/stores/config'
import { useCommands } from '@/services/commands'
import { hotkeys } from '@/services/hotkeysSingleton'
import { formatKeystrokeForDisplay } from '@/lib/hotkeys/hotkeys'

const { t } = useI18n()
const config = useConfigStore()
const store = config.store

const { sortedCommands } = useCommands()
const hotkeyCommands = computed(() => sortedCommands.value.filter(command => command.hotkeyId))
const recordingHotkeyId = ref<string | null>(null)

function bindingFor (hotkeyId: string): string {
    return (store.hotkeys[hotkeyId] ?? [])
        .map(sequence => sequence.map(formatKeystrokeForDisplay).join(' '))
        .join(', ')
}

function startRecording (hotkeyId: string): void {
    recordingHotkeyId.value = hotkeyId
}

function onKeystroke (keystroke: string): void {
    const hotkeyId = recordingHotkeyId.value
    if (!hotkeyId) {
        return
    }
    recordingHotkeyId.value = null
    if (keystroke === 'Escape') {
        return
    }
    if (keystroke === 'Backspace' || keystroke === 'Delete') {
        delete store.hotkeys[hotkeyId]
        return
    }
    store.hotkeys[hotkeyId] = [[keystroke]]
}

onMounted(() => {
    const sub = hotkeys.keystroke$.subscribe(onKeystroke)
    onBeforeUnmount(() => sub.unsubscribe())
})
</script>

<template>
    <div class="settings-page">
    <h2>{{ t('settings.hotkeys') }}</h2>
    <p class="hint">{{ t('settings.hotkeysHint') }}</p>
    <div class="settings-section">
        <div class="settings-card">
            <div
                v-for="command in hotkeyCommands"
                :key="command.id"
                class="settings-card-row"
            >
                <Label>{{ command.label() }}</Label>
                <button
                    class="hotkey-binding"
                    :class="{ recording: recordingHotkeyId === command.hotkeyId }"
                    @click="startRecording(command.hotkeyId!)"
                >
                    {{ recordingHotkeyId === command.hotkeyId ? '…' : (bindingFor(command.hotkeyId!) || '—') }}
                </button>
            </div>
        </div>
    </div>
    </div>
</template>

<style scoped>
.hotkey-binding {
    min-width: 120px;
    padding: 4px 10px;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: var(--color-secondary);
    color: var(--color-foreground);
    font-family: var(--font-mono);
    font-size: 12px;
    text-align: center;
    cursor: pointer;
    transition: border-color 0.25s ease;
}

.hotkey-binding:hover {
    border-color: var(--color-ring);
}

.hotkey-binding.recording {
    border-color: var(--color-primary);
    color: var(--color-primary);
    animation: 1s ease-in-out infinite recordPulse;
}

@keyframes recordPulse {
    0%, 100% {
        opacity: 1;
    }
    50% {
        opacity: 0.5;
    }
}
</style>
