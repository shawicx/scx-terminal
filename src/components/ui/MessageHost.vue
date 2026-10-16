<!--
  @description 全局 message 提示宿主（Ant Design message 风格）：固定于视口顶部居中、
              多条垂直堆叠，逐条图标 + 文案，到时自动淡出，点击可立即关闭。
              状态源自 message.ts 模块单例，App 根挂载一次即可全局生效。
-->
<script setup lang="ts">
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-vue-next'
import { useMessageItems } from '@/components/ui/message'

const { items, dismiss } = useMessageItems()

/** 各种类别对应的图标组件 */
const kindIcons = {
    success: CheckCircle2,
    error: XCircle,
    info: Info,
    warning: AlertTriangle,
} as const
</script>

<template>
    <div class="message-host" role="status" aria-live="polite">
        <TransitionGroup name="message" tag="div" class="message-stack">
            <button
                v-for="item in items"
                :key="item.id"
                type="button"
                class="message-item"
                :class="item.kind"
                @click="dismiss(item.id)"
            >
                <component :is="kindIcons[item.kind]" :size="15" class="message-icon" />
                <span class="message-text">{{ item.text }}</span>
            </button>
        </TransitionGroup>
    </div>
</template>

<style scoped>
/* 顶部居中堆叠浮层：层级取菜单盖弹窗档（须盖过 Dialog z-100），不拦截周围交互 */
.message-host {
    position: fixed;
    top: 14px;
    left: 0;
    right: 0;
    z-index: var(--z-menu-over-modal);
    display: flex;
    justify-content: center;
    pointer-events: none;
}

/* 跟随终端字号整体缩放（复用 tab-pane--ui-scaled 的 --ui-zoom 机制）；
   origin 取 top center：缩放以视口中线对齐，堆叠仍居中 */
.message-stack {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    transform: scale(var(--ui-zoom, 1));
    transform-origin: top center;
}

.message-item {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: min(420px, 80vw);
    padding: 8px 14px;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    background: var(--color-popover);
    color: var(--color-popover-foreground);
    font-size: 13px;
    line-height: 1.4;
    text-align: left;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.22);
    cursor: pointer;
    pointer-events: auto;
}

.message-text {
    word-break: break-all;
}

/* 类别仅着色图标（对齐 Ant message 的克制配色），文案保持前景色 */
.message-icon {
    flex-shrink: 0;
}

.message-item.success .message-icon {
    color: oklch(0.72 0.17 149);
}

.message-item.error .message-icon {
    color: var(--color-destructive);
}

.message-item.warning .message-icon {
    color: oklch(0.8 0.15 80);
}

.message-item.info .message-icon {
    color: var(--color-primary);
}

/* 进出场：顶部滑入淡入 / 上滑淡出（对齐 Ant message 的 motion） */
.message-enter-active,
.message-leave-active {
    transition: opacity 0.2s ease, transform 0.2s ease;
}

.message-enter-from {
    opacity: 0;
    transform: translateY(-10px);
}

.message-leave-to {
    opacity: 0;
    transform: translateY(-6px);
}

/* 条目离场后其余条目平滑上移补位（TransitionGroup move 类） */
.message-move {
    transition: transform 0.2s ease;
}
</style>
