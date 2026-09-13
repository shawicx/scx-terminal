<!--
  @description SSH 主机指纹确认对话框（TOFU）：首次连接展示指纹请用户信任；
                指纹与 known_hosts 记录不一致（changed）时以警示色提示中间人风险。
                由 TerminalPane 在收到 ssh:{id}:hostkey 事件时挂起展示。
-->
<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import Dialog from '@/components/ui/Dialog.vue'
import Button from '@/components/ui/Button.vue'
import type { HostKeyChallenge } from '@/services/ssh'

const props = defineProps<{
    challenge: HostKeyChallenge
}>()

const emit = defineEmits<{
    (e: 'accept'): void
    (e: 'reject'): void
}>()

const { t } = useI18n()
</script>

<template>
    <Dialog :title="t('ssh.hostKeyTitle')" :width="420" @cancel="emit('reject')">
        <p v-if="!props.challenge.changed" class="hostkey-line">{{ t('ssh.hostKeyUnknown') }}</p>
        <p v-else class="hostkey-line hostkey-warn">{{ t('ssh.hostKeyChanged') }}</p>
        <div class="hostkey-meta">
            <span class="hostkey-key">{{ t('ssh.hostKeyAlgorithm') }}</span>
            <span class="hostkey-value">{{ props.challenge.keyType }}</span>
        </div>
        <div class="hostkey-meta">
            <span class="hostkey-key">{{ t('ssh.hostKeyFingerprint') }}</span>
            <span class="hostkey-value mono">{{ props.challenge.fingerprint }}</span>
        </div>
        <p v-if="props.challenge.changed" class="hostkey-line hostkey-warn">{{ t('ssh.hostKeyChangedWarn') }}</p>
        <template #footer>
            <Button variant="outline" size="sm" @click="emit('reject')">{{ t('ssh.hostKeyReject') }}</Button>
            <Button size="sm" @click="emit('accept')">{{ t('ssh.hostKeyAccept') }}</Button>
        </template>
    </Dialog>
</template>

<style scoped>
.hostkey-line {
    margin: 0 0 10px;
}

.hostkey-warn {
    color: var(--color-destructive);
}

.hostkey-meta {
    display: flex;
    gap: 10px;
    margin: 4px 0;
    font-size: 12px;
}

.hostkey-key {
    flex-shrink: 0;
    color: var(--color-muted-foreground);
}

.hostkey-value {
    word-break: break-all;
}

.mono {
    font-family: var(--font-mono, monospace);
}
</style>
