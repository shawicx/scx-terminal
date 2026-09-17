<!--
  @description 通用轻量模态对话框：Teleport 到 body 的遮罩层 + 居中面板，
                Esc 关闭（触发 cancel 事件）；内容经插槽自定义。
                自绘实现（与 CommandPalette 同思路），不引入 reka-ui dialog。
-->
<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'

const props = defineProps<{
    /** 标题 */
    title: string
    /** 面板宽度（px） */
    width?: number
}>()

const emit = defineEmits<{
    (e: 'cancel'): void
}>()

function onKeydown (event: KeyboardEvent): void {
    if (event.key === 'Escape') {
        event.preventDefault()
        emit('cancel')
    }
}

onMounted(() => {
    document.addEventListener('keydown', onKeydown, true)
})

onBeforeUnmount(() => {
    document.removeEventListener('keydown', onKeydown, true)
})
</script>

<template>
    <Teleport to="body">
        <div class="dialog-overlay" @mousedown.self="emit('cancel')">
            <div class="dialog-panel" :style="props.width ? { width: `${props.width}px` } : undefined" role="dialog" :aria-label="props.title">
                <h3 class="dialog-title">{{ props.title }}</h3>
                <div class="dialog-body">
                    <slot />
                </div>
                <div class="dialog-footer">
                    <slot name="footer" />
                </div>
            </div>
        </div>
    </Teleport>
</template>

<style scoped>
.dialog-overlay {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.4);
    animation: 0.125s ease-out dialogFadeIn;
}

.dialog-panel {
    max-width: calc(100vw - 48px);
    padding: 16px 18px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-popover);
    color: var(--color-popover-foreground);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    animation: 0.125s cubic-bezier(0, 0, 0.2, 1) dialogZoomIn;
}

.dialog-title {
    margin: 0 0 10px;
    font-size: 14px;
    font-weight: 600;
}

.dialog-body {
    font-size: 13px;
    line-height: 1.6;
}

.dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 14px;
}

@keyframes dialogFadeIn {
    from {
        opacity: 0;
    }
    to {
        opacity: 1;
    }
}

@keyframes dialogZoomIn {
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
