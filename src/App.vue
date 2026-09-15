<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { watch } from 'vue'
import { useI18n } from 'vue-i18n'
import TitleBar from '@/components/titlebar/TitleBar.vue'
import TerminalTabContent from '@/components/terminal/TerminalTabContent.vue'
import SettingsView from '@/components/settings/SettingsView.vue'
import CommandPalette from '@/components/palette/CommandPalette.vue'
import QuickCommandPalette from '@/components/palette/QuickCommandPalette.vue'
import { useTabsStore } from '@/stores/tabs'
import { useConfigStore } from '@/stores/config'
import { useCommands } from '@/services/commands'
import { hotkeys } from '@/services/hotkeysSingleton'

const store = useTabsStore()
const config = useConfigStore()
const { registerDefaults, registerProfileCommands, registerQuickCommandCommands, bindHotkeys } = useCommands()
const { locale } = useI18n()

function isEditableTarget (target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
        return false
    }
    return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' ||
        target.isContentEditable
}

function onKeydown (event: KeyboardEvent): void {
    if (!isEditableTarget(event.target)) {
        hotkeys.pushKeyEvent('keydown', event)
    }
}

function onKeyup (event: KeyboardEvent): void {
    if (!isEditableTarget(event.target)) {
        hotkeys.pushKeyEvent('keyup', event)
    }
}

onMounted(() => {
    if (store.tabs.length === 0) {
        store.openTerminalTab()
    }

    registerDefaults()
    registerProfileCommands(config.store.profiles)
    registerQuickCommandCommands(config.store.quickCommands)
    bindHotkeys()

    document.addEventListener('keydown', onKeydown)
    document.addEventListener('keyup', onKeyup)
})

onBeforeUnmount(() => {
    document.removeEventListener('keydown', onKeydown)
    document.removeEventListener('keyup', onKeyup)
})

// 档案增删改后同步命令面板里的"按档案新建标签"命令
watch(() => config.store.profiles, profiles => {
    registerProfileCommands(profiles)
}, { deep: true })

// 快捷命令增删改后同步命令面板里的对应条目
watch(() => config.store.quickCommands, quickCommands => {
    registerQuickCommandCommands(quickCommands)
}, { deep: true })

// follow the configured UI language ('auto' follows the OS)
watch(() => config.store.appearance.language, language => {
    if (language === 'zh-CN' || language === 'en') {
        locale.value = language
    } else {
        locale.value = navigator.language.startsWith('zh') ? 'zh-CN' : 'en'
    }
}, { immediate: true })
</script>

<template>
    <div class="app-shell">
        <TitleBar />
        <div class="tab-content">
            <div
                v-for="tab in store.tabs"
                :key="tab.id"
                v-show="tab.id === store.activeId"
                class="tab-pane"
            >
                <TerminalTabContent
                    v-if="tab.type === 'terminal'"
                    :tab-id="tab.id"
                    :tab-active="tab.id === store.activeId"
                    :profile-id="tab.profileId"
                />
                <SettingsView v-else />
            </div>
        </div>
        <CommandPalette />
        <QuickCommandPalette />
    </div>
</template>

<style scoped>
.app-shell {
    height: 100vh;
    display: flex;
    flex-direction: column;
    animation: 0.5s ease-out fadeIn;
}

.tab-content {
    flex: 1;
    min-height: 0;
    position: relative;
}

.tab-pane {
    position: absolute;
    inset: 0;
}

@keyframes fadeIn {
    from {
        opacity: 0;
    }
    to {
        opacity: 1;
    }
}
</style>
