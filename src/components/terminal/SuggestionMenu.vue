<script setup lang="ts">
/**
 * @description 终端建议菜单：光标下方的 overlay 列表（历史/快捷命令/路径），受控组件——
 *              状态与键盘全部由 SuggestionsController 持有，组件只渲染；空间不足时向上翻转。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Folder, History as HistoryIcon, Star } from 'lucide-vue-next'
import type { Suggestion } from '@/lib/suggestions/types'

const props = defineProps<{
    items: Suggestion[]
    selectedIndex: number
    left: number
    top: number
    hostHeight: number
    maxWidth: number
}>()

const emit = defineEmits<{
    (e: 'select', index: number): void
}>()

const { t } = useI18n()

const ROW_HEIGHT = 26
const MAX_VISIBLE_ROWS = 8

/** 屏幕放不下时向上翻转（估算高度：可见行数 + 内边距） */
const flipUp = computed(() => props.top + Math.min(props.items.length, MAX_VISIBLE_ROWS) * ROW_HEIGHT + 16 > props.hostHeight)

/** 定位样式：左边界不超过宿主宽度 40%，翻转时改用 bottom 锚定在光标行上方 */
const menuStyle = computed(() => ({
    left: `${Math.min(props.left, Math.max(props.maxWidth * 0.4, 0))}px`,
    top: flipUp.value ? undefined : `${props.top}px`,
    bottom: flipUp.value ? `${props.hostHeight - props.top + ROW_HEIGHT}px` : undefined,
    maxWidth: `${props.maxWidth}px`,
}))

/**
 * @description 建议类型对应的图标组件
 * @param kind 建议类型（history/quickCommand/path）
 * @returns typeof HistoryIcon | typeof Star | typeof Folder 图标组件
 *
 * @example iconFor('history') // HistoryIcon
 *
 */
function iconFor (kind: Suggestion['kind']) {
    return kind === 'history' ? HistoryIcon : kind === 'quickCommand' ? Star : Folder
}
</script>

<template>
    <div v-if="items.length" class="suggestion-menu" :style="menuStyle">
        <div
            v-for="(item, index) in items"
            :key="`${item.kind}:${item.label}:${index}`"
            class="suggestion-item"
            :class="{ selected: index === selectedIndex }"
            @mousedown.prevent
            @click="emit('select', index)"
        >
            <component :is="iconFor(item.kind)" :size="13" class="suggestion-icon" />
            <span class="suggestion-label">{{ item.label }}</span>
            <span v-if="item.detail" class="suggestion-detail">{{ item.detail }}</span>
        </div>
        <div class="suggestion-hint">{{ t('terminal.suggestionHint') }}</div>
    </div>
</template>

<style scoped>
.suggestion-menu {
    position: absolute;
    z-index: var(--z-suggestion-menu);
    display: flex;
    flex-direction: column;
    padding: 4px;
    background: var(--color-popover);
    color: var(--color-popover-foreground);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    max-height: 224px;
    overflow-y: auto;
    font-size: 12px;
    animation: 0.1s cubic-bezier(0, 0, 0.2, 1) searchFadeIn;
}

.suggestion-item {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 8px;
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
}

.suggestion-item.selected {
    background: var(--color-accent);
    color: var(--color-accent-foreground);
}

.suggestion-icon {
    flex: none;
    opacity: 0.7;
}

.suggestion-label {
    overflow: hidden;
    text-overflow: ellipsis;
}

.suggestion-detail {
    margin-left: auto;
    flex: none;
    font-size: 11px;
    color: var(--color-muted-foreground);
}

.suggestion-hint {
    padding: 4px 8px 2px;
    font-size: 11px;
    color: var(--color-muted-foreground);
    border-top: 1px solid var(--color-border);
    margin-top: 2px;
}

/* searchFadeIn 定义在 TerminalPane（scoped）作用域外不可见，此处复制同名定义 */
@keyframes searchFadeIn {
    from {
        opacity: 0;
        transform: translateY(-4px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}
</style>
