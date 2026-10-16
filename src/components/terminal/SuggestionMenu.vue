<script setup lang="ts">
/**
 * @description 终端建议菜单：光标下方的 overlay 列表（历史/快捷命令/工作流/路径），
 *              受控组件——状态与键盘全部由 SuggestionsController 持有，组件只渲染；
 *              空间不足时向上翻转；鼠标悬停经 hover 事件交回控制器跟随选中。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Folder, History as HistoryIcon, Star, Workflow as WorkflowIcon } from 'lucide-vue-next'
import type { Suggestion } from '@/lib/suggestions/types'
import { panelEnter } from '@/lib/motion'

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
    (e: 'hover', index: number): void
}>()

const { t } = useI18n()

const menuEl = ref<HTMLDivElement>()

// 仅在菜单从无到有浮现时入场（打字过滤不重播，保持跟手）
watch(() => props.items.length, (length, previous) => {
    if (length > 0 && previous === 0) {
        void nextTick(() => {
            if (menuEl.value) {
                panelEnter(menuEl.value, { from: 'bottom' })
            }
        })
    }
})

const ROW_HEIGHT = 28
const MAX_VISIBLE_ROWS = 8

/** 翻转估算附加高度：底部键盘提示行 + 容器内边距与描边 */
const FLIP_EXTRA = 36

/** 屏幕放不下时向上翻转（估算高度：可见行数 + hint/内边距） */
const flipUp = computed(() => props.top + Math.min(props.items.length, MAX_VISIBLE_ROWS) * ROW_HEIGHT + FLIP_EXTRA > props.hostHeight)

/** 定位样式：左边界不超过宿主宽度 40%，翻转时改用 bottom 锚定在光标行上方 */
const menuStyle = computed(() => ({
    left: `${Math.min(props.left, Math.max(props.maxWidth * 0.4, 0))}px`,
    top: flipUp.value ? undefined : `${props.top}px`,
    bottom: flipUp.value ? `${props.hostHeight - props.top + ROW_HEIGHT}px` : undefined,
    maxWidth: `${props.maxWidth}px`,
}))

// 键盘上下移动时选中项保持在列表可视区内（nearest 只滚动列表层）
watch(() => props.selectedIndex, () => {
    menuEl.value?.querySelector('.suggestion-item.selected')?.scrollIntoView({ block: 'nearest' })
})

/**
 * @description 建议类型对应的图标组件
 * @param kind 建议类型（history/quickCommand/path/workflow）
 * @returns 图标组件
 *
 * @example iconFor('history') // HistoryIcon
 *
 */
function iconFor (kind: Suggestion['kind']) {
    return kind === 'history' ? HistoryIcon : kind === 'quickCommand' ? Star : kind === 'workflow' ? WorkflowIcon : Folder
}
</script>

<template>
    <div v-if="items.length" ref="menuEl" class="suggestion-menu" :style="menuStyle">
        <div class="suggestion-list">
            <div
                v-for="(item, index) in items"
                :key="`${item.kind}:${item.label}:${index}`"
                class="suggestion-item"
                :class="{ selected: index === selectedIndex }"
                @mousedown.prevent
                @mousemove="emit('hover', index)"
                @click="emit('select', index)"
            >
                <component :is="iconFor(item.kind)" :size="13" class="suggestion-icon" :class="item.kind" />
                <span class="suggestion-label">{{ item.label }}</span>
                <span v-if="item.detail" class="suggestion-detail">{{ item.detail }}</span>
            </div>
        </div>
        <div class="suggestion-hint">{{ t('terminal.suggestionHint') }}</div>
    </div>
</template>

<style scoped>
/* 毛玻璃浮层：与命令面板/message 同质感（popover 88% + blur，blur 失效时接近实色） */
.suggestion-menu {
    position: absolute;
    z-index: var(--z-suggestion-menu);
    display: flex;
    flex-direction: column;
    padding: 4px;
    background: color-mix(in oklch, var(--color-popover) 88%, transparent);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    color: var(--color-popover-foreground);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.32);
    font-size: 12px;
}

/* 滚动收敛在列表层：底部键盘提示固定在列表下方，不随条目滚动 */
.suggestion-list {
    display: flex;
    flex-direction: column;
    max-height: 224px;
    overflow-y: auto;
    overscroll-behavior: contain;
}

.suggestion-item {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 28px;
    padding: 0 9px;
    border-radius: 6px;
    cursor: pointer;
    white-space: nowrap;
    transition: background-color 0.12s ease;
}

/* 选中（含悬停跟随回写的选中）：primary 混色底，文字/图标不换色 */
.suggestion-item.selected {
    background: color-mix(in oklch, var(--color-primary) 14%, transparent);
}

.suggestion-icon {
    flex: none;
    opacity: 0.75;
}

.suggestion-item.selected .suggestion-icon {
    opacity: 1;
}

/* 来源语义色：历史灰蓝 / 快捷命令琥珀 / 工作流主题色 / 路径蓝 */
.suggestion-icon.history {
    color: oklch(0.7 0.06 250);
}

.suggestion-icon.quickCommand {
    color: oklch(0.78 0.14 80);
}

.suggestion-icon.workflow {
    color: var(--color-primary);
}

.suggestion-icon.path {
    color: oklch(0.72 0.12 240);
}

/* 命令文本等宽（终端语境），超长省略 */
.suggestion-label {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--font-mono);
}

/* 来源徽标（快捷命令分组名）：小 tag，限宽省略不挤压命令文本 */
.suggestion-detail {
    margin-left: auto;
    flex: none;
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 0 7px;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    font-size: 10px;
    line-height: 16px;
    color: var(--color-muted-foreground);
}

.suggestion-hint {
    flex: none;
    padding: 5px 9px 3px;
    font-size: 11px;
    color: var(--color-muted-foreground);
    border-top: 1px solid var(--color-border);
    margin-top: 3px;
}
</style>
