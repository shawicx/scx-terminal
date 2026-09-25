<!--
  @description 设置页外壳：左侧导航 + 页面切换容器（11 个页组件互斥挂载）；
              跨页共享的删除确认弹窗与分组名称弹窗在此统一渲染。
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Terminal, Palette, Keyboard, Info, KeyRound, HardDriveDownload, Zap, Globe, Server, SquareTerminal, Layers } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import TerminalPage from '@/components/settings/pages/TerminalPage.vue'
import LocalProfilesPage from '@/components/settings/pages/LocalProfilesPage.vue'
import SshPage from '@/components/settings/pages/SshPage.vue'
import QuickCommandsPage from '@/components/settings/pages/QuickCommandsPage.vue'
import KeysPage from '@/components/settings/pages/KeysPage.vue'
import AppearancePage from '@/components/settings/pages/AppearancePage.vue'
import ColorSchemesPage from '@/components/settings/pages/ColorSchemesPage.vue'
import HotkeysPage from '@/components/settings/pages/HotkeysPage.vue'
import TabGroupsPage from '@/components/settings/pages/TabGroupsPage.vue'
import BackupPage from '@/components/settings/pages/BackupPage.vue'
import AboutPage from '@/components/settings/pages/AboutPage.vue'
import type { SettingsPageId } from '@/stores/tabs'
import { dismissConfirm, runConfirmed, useConfirmState } from '@/components/settings/useConfirmAction'
import { useGroupNameDialog } from '@/components/settings/useGroupNameDialog'

const { t } = useI18n()

const props = defineProps<{ initialPage?: SettingsPageId }>()

const page = ref<SettingsPageId>(props.initialPage ?? 'profiles')

const pages = computed(() => [
    { id: 'profiles' as const, label: t('settings.localTerminalPage'), icon: SquareTerminal },
    { id: 'ssh' as const, label: t('settings.sshPage'), icon: Server },
    { id: 'quickCommands' as const, label: t('settings.quickCommands'), icon: Zap },
    { id: 'keys' as const, label: t('settings.keychainPage'), icon: KeyRound },
    { id: 'terminal' as const, label: t('settings.terminal'), icon: Terminal },
    { id: 'appearance' as const, label: t('settings.appearance'), icon: Globe },
    { id: 'colorSchemes' as const, label: t('settings.colorSchemesPage'), icon: Palette },
    { id: 'hotkeys' as const, label: t('settings.hotkeys'), icon: Keyboard },
    { id: 'tabGroups' as const, label: t('settings.tabGroupsPage'), icon: Layers },
    { id: 'backup' as const, label: t('settings.backupPage'), icon: HardDriveDownload },
    { id: 'about' as const, label: t('settings.about'), icon: Info },
])

const confirmState = useConfirmState()

const { groupNameDialog, groupNameDialogTitle, commitGroupNameDialog } = useGroupNameDialog()
</script>

<template>
    <div class="settings-view">
        <aside class="settings-nav">
            <button
                v-for="p in pages"
                :key="p.id"
                class="settings-nav-item"
                :class="{ active: page === p.id }"
                @click="page = p.id"
            >
                <component :is="p.icon" :size="15" />
                <span>{{ p.label }}</span>
            </button>
        </aside>

        <div class="settings-content">
            <Transition name="page-fade" mode="out-in">
            <LocalProfilesPage v-if="page === 'profiles'" key="profiles" />
            <SshPage v-else-if="page === 'ssh'" key="ssh" />
            <QuickCommandsPage v-else-if="page === 'quickCommands'" key="quickCommands" />
            <KeysPage v-else-if="page === 'keys'" key="keys" />
            <TerminalPage v-else-if="page === 'terminal'" key="terminal" />
            <AppearancePage v-else-if="page === 'appearance'" key="appearance" />
            <ColorSchemesPage v-else-if="page === 'colorSchemes'" key="colorSchemes" />
            <HotkeysPage v-else-if="page === 'hotkeys'" key="hotkeys" />
            <TabGroupsPage v-else-if="page === 'tabGroups'" key="tabGroups" />
            <BackupPage v-else-if="page === 'backup'" key="backup" />
            <AboutPage v-else key="about" />
            </Transition>
        </div>

        <Dialog v-if="confirmState" :title="t('settings.deleteConfirmTitle')" :width="380" @cancel="dismissConfirm">
            <p class="confirm-text">{{ confirmState.message }}</p>
            <template #footer>
                <Button variant="outline" size="sm" @click="dismissConfirm">{{ t('settings.cancel') }}</Button>
                <Button variant="destructive" size="sm" @click="runConfirmed">{{ t('settings.deleteConfirmButton') }}</Button>
            </template>
        </Dialog>

        <Dialog v-if="groupNameDialog" :title="groupNameDialogTitle" :width="380" @cancel="groupNameDialog = null">
            <div class="group-name-form">
                <Label>{{ t('settings.groupNameLabel') }}</Label>
                <Input v-model="groupNameDialog.draft" @keydown.enter.prevent="commitGroupNameDialog" />
            </div>
            <template #footer>
                <Button variant="outline" size="sm" @click="groupNameDialog = null">{{ t('settings.cancel') }}</Button>
                <Button size="sm" :disabled="!groupNameDialog.draft.trim()" @click="commitGroupNameDialog">{{ t('settings.confirm') }}</Button>
            </template>
        </Dialog>
    </div>
</template>

<style>
/* 设置域共享类（settings-* 骨架 / 主从布局 / 档案列表项）：多页组件共用，
   子组件 scoped 样式无法继承父级，此处全局引入一次 */
@import './settings-shared.css';
</style>

<style scoped>
.settings-view {
    height: 100%;
    display: flex;
    background: var(--color-background);
    color: var(--color-foreground);
    animation: 0.5s ease-out fadeIn;
}

.settings-nav {
    width: 180px;
    padding: 16px 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    border-right: 1px solid var(--color-border);
    flex-shrink: 0;
}

.settings-nav-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--color-muted-foreground);
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    transition: background-color 0.25s ease, color 0.25s ease;
}

.settings-nav-item:hover {
    background: var(--color-accent);
    color: var(--color-accent-foreground);
}

/* 选中态用 primary 混色，与悬停态（accent）明确区分 */
.settings-nav-item.active {
    background: color-mix(in oklch, var(--color-primary) 14%, transparent);
    color: var(--color-foreground);
}

.settings-content {
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px;
    min-width: 0;
}

.confirm-text {
    margin: 0;
    word-break: break-all;
}

/* 分组名称弹窗（SSH/快捷命令/本地档案共用） */
.group-name-form {
    display: flex;
    flex-direction: column;
    gap: 8px;
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
