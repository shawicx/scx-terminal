<!--
  @description 通用可搜索下拉选择组件：输入框即搜索框（聚焦后输入过滤选项），
                适合大选项集（配色全集 / 系统字体列表）；键盘 ↑↓ 高亮、Enter 选中、Esc 关闭
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronDown } from 'lucide-vue-next'

export interface SearchableSelectOption {
    value: string
    label: string
    /** 选项标记（如"自定义"），显示在标签右侧 */
    hint?: string
}

const props = defineProps<{
    modelValue: string
    options: SearchableSelectOption[]
    placeholder?: string
}>()

const emit = defineEmits<{
    (e: 'update:modelValue', value: string): void
}>()

const open = ref(false)
const search = ref('')
const highlightedIndex = ref(0)
const rootEl = ref<HTMLElement>()

const selectedOption = computed(() => props.options.find(option => option.value === props.modelValue))

const filteredOptions = computed(() => {
    const query = search.value.trim().toLowerCase()
    if (!query) {
        return props.options
    }
    return props.options.filter(option =>
        option.label.toLowerCase().includes(query) ||
        option.value.toLowerCase().includes(query))
})

watch(filteredOptions, options => {
    highlightedIndex.value = Math.min(highlightedIndex.value, Math.max(options.length - 1, 0))
})

/**
 * @description 打开下拉：清空搜索词以展示全部选项，高亮当前选中项并滚动到可见位置
 * @returns void
 *
 */
function openList (): void {
    open.value = true
    search.value = ''
    highlightedIndex.value = Math.max(props.options.findIndex(option => option.value === props.modelValue), 0)
    scrollToHighlighted()
}

/**
 * @description 提交选择并收起下拉
 * @param value 选项值
 * @returns void
 *
 */
function select (value: string): void {
    emit('update:modelValue', value)
    open.value = false
    search.value = selectedOption.value?.label ?? value
    rootEl.value?.querySelector('input')?.blur()
}

/**
 * @description 关闭下拉并还原显示当前选中项
 * @returns void
 *
 */
function closeList (): void {
    open.value = false
    search.value = selectedOption.value?.label ?? ''
}

function onKeydown (event: KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
        event.preventDefault()
        if (!open.value) {
            openList()
            return
        }
        highlightedIndex.value = Math.min(highlightedIndex.value + 1, filteredOptions.value.length - 1)
        scrollToHighlighted()
    } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        highlightedIndex.value = Math.max(highlightedIndex.value - 1, 0)
        scrollToHighlighted()
    } else if (event.key === 'Enter') {
        event.preventDefault()
        const option = filteredOptions.value[highlightedIndex.value]
        if (option) {
            select(option.value)
        }
    } else if (event.key === 'Escape') {
        event.preventDefault()
        closeList()
        rootEl.value?.querySelector('input')?.blur()
    }
}

/**
 * @description 滚动列表使高亮项可见
 * @returns void
 *
 */
function scrollToHighlighted (): void {
    requestAnimationFrame(() => {
        rootEl.value?.querySelector('.searchable-option.highlighted')?.scrollIntoView({ block: 'nearest' })
    })
}

function onDocumentMousedown (event: MouseEvent): void {
    if (open.value && rootEl.value && !rootEl.value.contains(event.target as Node)) {
        closeList()
    }
}

onMounted(() => {
    document.addEventListener('mousedown', onDocumentMousedown)
})

onBeforeUnmount(() => {
    document.removeEventListener('mousedown', onDocumentMousedown)
})

// 初始显示当前选中项
watch(selectedOption, option => {
    if (!open.value) {
        search.value = option?.label ?? ''
    }
}, { immediate: true })
</script>

<template>
    <div ref="rootEl" class="searchable-select" :class="$attrs.class ?? ''">
        <input
            class="searchable-input"
            :placeholder="props.placeholder ?? ''"
            :value="open ? search : (selectedOption?.label ?? '')"
            spellcheck="false"
            @focus="openList"
            @input="search = ($event.target as HTMLInputElement).value; highlightedIndex = 0"
            @keydown="onKeydown"
        />
        <ChevronDown class="searchable-chevron" :size="14" />
        <div v-if="open" class="searchable-list">
            <div
                v-for="(option, index) in filteredOptions"
                :key="option.value"
                class="searchable-option"
                :class="{ highlighted: index === highlightedIndex, selected: option.value === props.modelValue }"
                @mousedown.prevent="select(option.value)"
                @mousemove="highlightedIndex = index"
            >
                <span class="searchable-option-label">{{ option.label }}</span>
                <span v-if="option.hint" class="searchable-option-hint">{{ option.hint }}</span>
            </div>
            <div v-if="filteredOptions.length === 0" class="searchable-empty">—</div>
        </div>
    </div>
</template>

<style scoped>
.searchable-select {
    position: relative;
    display: inline-flex;
    align-items: center;
}

.searchable-input {
    width: 100%;
    height: 36px;
    padding: 0 26px 0 10px;
    border: 1px solid var(--color-input);
    border-radius: 6px;
    background: transparent;
    color: var(--color-foreground);
    font-size: 14px;
    outline: none;
    cursor: default;
}

.searchable-input:focus {
    border-color: var(--color-ring);
    box-shadow: 0 0 0 1px var(--color-ring);
}

.searchable-chevron {
    position: absolute;
    right: 8px;
    pointer-events: none;
    color: var(--color-muted-foreground);
}

.searchable-list {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    z-index: var(--z-menu);
    max-height: 256px;
    overflow-y: auto;
    padding: 4px;
    background: var(--color-popover);
    color: var(--color-popover-foreground);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}

.searchable-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 13px;
    cursor: default;
}

.searchable-option.highlighted {
    background: var(--color-accent);
}

.searchable-option.selected {
    color: var(--color-primary);
    font-weight: 600;
}

.searchable-option-label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.searchable-option-hint {
    flex-shrink: 0;
    padding: 0 5px;
    border-radius: 4px;
    background: var(--color-primary);
    color: var(--color-primary-foreground);
    font-size: 11px;
    line-height: 16px;
}

.searchable-empty {
    padding: 8px;
    text-align: center;
    color: var(--color-muted-foreground);
    font-size: 13px;
}
</style>
