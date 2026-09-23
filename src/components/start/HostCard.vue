<!--
  @description 连接中心主机卡片：档案名 + user@host + 连接状态点；单击整卡开终端，
              悬停浮现 SFTP/隧道/编辑次级动作（状态色为语义色，不随主题 token 漂移）。
-->
<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeftRight, ArrowUpDown, Pencil } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import type { SshProfile } from '@/stores/config'
import { useTabsStore } from '@/stores/tabs'

const props = defineProps<{
    profile: SshProfile
    status: 'idle' | 'connecting' | 'connected' | 'failed'
    error?: string
}>()

const { t } = useI18n()
const tabs = useTabsStore()

const endpoint = computed(() => props.profile.port === 22
    ? `${props.profile.user}@${props.profile.host}`
    : `${props.profile.user}@${props.profile.host}:${props.profile.port}`)
</script>

<template>
    <div
        class="host-card"
        :title="status === 'failed' ? (error ?? '') : undefined"
        @click="tabs.openTerminalTab(profile.id)"
    >
        <div class="host-card-head">
            <span class="host-name">{{ profile.name }}</span>
            <span class="status-dot" :class="status" />
        </div>
        <div class="host-endpoint">{{ endpoint }}</div>
        <div class="host-actions" @click.stop>
            <Button variant="ghost" size="icon" class="h-7 w-7" :title="t('start.actionSftp')" @click="tabs.openSftpTab(profile.id)">
                <ArrowUpDown class="h-5 w-5" />
            </Button>
            <Button variant="ghost" size="icon" class="h-7 w-7" :title="t('start.actionTunnel')" @click="tabs.openForwardingTab()">
                <ArrowLeftRight class="h-5 w-5" />
            </Button>
            <Button variant="ghost" size="icon" class="h-7 w-7" :title="t('start.actionEdit')" @click="tabs.openSettingsTab('ssh')">
                <Pencil class="h-5 w-5" />
            </Button>
        </div>
    </div>
</template>

<style scoped>
.host-card {
    background: var(--color-card);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    padding: 10px 12px;
    cursor: pointer;
    transition: border-color 0.15s ease;
}
.host-card:hover {
    border-color: color-mix(in oklch, var(--color-primary) 45%, transparent);
}
.host-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}
.host-name {
    color: var(--color-foreground);
    font-weight: 600;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.host-endpoint {
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 11px;
    margin-top: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.host-actions {
    display: flex;
    gap: 2px;
    margin-top: 8px;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.15s ease, visibility 0.15s ease;
}
.host-card:hover .host-actions {
    opacity: 1;
    visibility: visible;
}
.status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex: none;
}
.status-dot.idle { background: var(--color-muted-foreground); opacity: 0.5; }
.status-dot.connected { background: oklch(0.77 0.15 152); }
.status-dot.connecting { background: var(--color-primary); animation: status-pulse 1.2s ease-in-out infinite; }
.status-dot.failed { background: var(--color-destructive); }
@keyframes status-pulse {
    0%, 100% { box-shadow: 0 0 0 0 color-mix(in oklch, var(--color-primary) 35%, transparent); }
    50% { box-shadow: 0 0 0 4px color-mix(in oklch, var(--color-primary) 35%, transparent); }
}
</style>
