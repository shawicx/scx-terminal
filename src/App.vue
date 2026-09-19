<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { watch } from 'vue'
import { useI18n } from 'vue-i18n'
import TitleBar from '@/components/titlebar/TitleBar.vue'
import TabStrip from '@/components/titlebar/TabStrip.vue'
import TerminalTabContent from '@/components/terminal/TerminalTabContent.vue'
import SettingsView from '@/components/settings/SettingsView.vue'
import SftpTabContent from '@/components/sftp/SftpTabContent.vue'
import ForwardingTabContent from '@/components/forwarding/ForwardingTabContent.vue'
import HostKeyDialog from '@/components/terminal/HostKeyDialog.vue'
import CredentialDialog from '@/components/terminal/CredentialDialog.vue'
import TransferPopover from '@/components/sftp/TransferPopover.vue'
import CommandPalette from '@/components/palette/CommandPalette.vue'
import QuickCommandPalette from '@/components/palette/QuickCommandPalette.vue'
import { useTabsStore } from '@/stores/tabs'
import { useConfigStore } from '@/stores/config'
import { useTransfersStore } from '@/stores/transfers'
import { useForwardingStore } from '@/stores/forwarding'
import { useCommands } from '@/services/commands'
import { hotkeys } from '@/services/hotkeysSingleton'
import { hkLog } from '@/services/hkDebug'
import { pendingHostKey, resolvePendingHostKey, pendingKbdChallenge, resolvePendingKbd } from '@/services/sshConnections'
import { setBackgroundFit, setBackgroundImageFile } from '@/services/backgroundImage'

const store = useTabsStore()
const config = useConfigStore()
const transfersStore = useTransfersStore()
const forwardingStore = useForwardingStore()
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
    hkLog(`doc keydown key=${event.key} code=${event.code} repeat=${event.repeat} target=${event.target instanceof HTMLElement ? `${event.target.tagName}.${event.target.className}` : String(event.target)} active=${document.activeElement instanceof HTMLElement ? `${document.activeElement.tagName}.${document.activeElement.className}` : String(document.activeElement)} skipped=${isEditableTarget(event.target)} ts=${event.timeStamp}`)
    if (!isEditableTarget(event.target)) {
        hotkeys.pushKeyEvent('keydown', event)
    }
}

function onKeyup (event: KeyboardEvent): void {
    hkLog(`doc keyup key=${event.key} code=${event.code} target=${event.target instanceof HTMLElement ? `${event.target.tagName}.${event.target.className}` : String(event.target)} skipped=${isEditableTarget(event.target)} ts=${event.timeStamp}`)
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
    void transfersStore.init()
    void forwardingStore.init()

    document.addEventListener('keydown', onKeydown)
    document.addEventListener('keyup', onKeyup)

    // 终端背景图：config 已在 main.ts bootstrap 先行加载，此处直接应用
    void setBackgroundImageFile(config.store.appearance.backgroundImage)
    setBackgroundFit(config.store.appearance.backgroundFit)
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

// 标签栏位置（bottom 时标题栏不再内嵌标签条，由下方独立标签条接管）
const tabBarBottom = computed(() => config.store.appearance.tabBarPosition === 'bottom')

// follow the configured UI language ('auto' follows the OS)
watch(() => config.store.appearance.language, language => {
    if (language === 'zh-CN' || language === 'en') {
        locale.value = language
    } else {
        locale.value = navigator.language.startsWith('zh') ? 'zh-CN' : 'en'
    }
}, { immediate: true })

// 终端背景图：文件变更重载（读 app-data bytes 转 blob URL）；填充方式纯 CSS 变量写入
watch(() => config.store.appearance.backgroundImage, fileName => {
    void setBackgroundImageFile(fileName)
})

watch(() => config.store.appearance.backgroundFit, fit => {
    setBackgroundFit(fit)
})
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
                <SftpTabContent
                    v-else-if="tab.type === 'sftp'"
                    :tab-id="tab.id"
                    :profile-id="tab.profileId!"
                />
                <ForwardingTabContent
                    v-else-if="tab.type === 'forwarding'"
                    :tab-id="tab.id"
                />
                <SettingsView v-else />
            </div>
        </div>
        <TabStrip v-if="tabBarBottom" position="bottom" />
        <CommandPalette />
        <QuickCommandPalette />
        <TransferPopover />
        <HostKeyDialog
            v-if="pendingHostKey"
            :challenge="pendingHostKey"
            @accept="resolvePendingHostKey(true)"
            @reject="resolvePendingHostKey(false)"
        />
        <CredentialDialog
            v-if="pendingKbdChallenge"
            :challenge="pendingKbdChallenge"
            @submit="(responses: string[], remember: boolean) => resolvePendingKbd({ responses, remember })"
            @cancel="resolvePendingKbd(null)"
        />
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
