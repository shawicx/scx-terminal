<script setup lang="ts">
/**
 * @description 配色方案选择器（设置页「配色方案」分组主体）：搜索 + 首字母分组可折叠列表，
 *              每条目带 Tabby 式预览卡（名称 + 16 色点 + 终端输出预览）；同名自定义配色
 *              优先于内置展示与生效；顶部置顶「跟随系统」条目，点击条目即切换全局配色。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRight, Search } from 'lucide-vue-next'
import Input from '@/components/ui/Input.vue'
import { builtinColorSchemes, mergeColorSchemes, groupColorSchemesByInitial, type TerminalColorScheme } from '@/lib/colorSchemes'

const { t } = useI18n()

const props = defineProps<{
    /** 当前全局配色偏好值（'auto' | 配色名） */
    modelValue: string
    /** 用户自定义配色列表（同名优先于内置） */
    customSchemes: TerminalColorScheme[]
}>()

const emit = defineEmits<{
    (event: 'update:modelValue', value: string): void
}>()

const search = ref('')
/** 展开的首字母分组（内存态不持久化；搜索时命中组强制展开） */
const expanded = ref(new Set<string>())

const customNames = computed(() => new Set(props.customSchemes.map(scheme => scheme.name)))

const groups = computed(() => {
    const keyword = search.value.trim().toLowerCase()
    const merged = mergeColorSchemes(builtinColorSchemes, props.customSchemes)
    const filtered = keyword
        ? merged.filter(scheme => scheme.name.toLowerCase().includes(keyword))
        : merged
    return groupColorSchemesByInitial(filtered)
})

/**
 * @description 分组是否展开：搜索时命中组强制展开（不动 expanded 记忆），否则看记忆集合
 * @param initial 首字母分组键
 * @returns boolean 是否展开渲染
 *
 * @example isGroupOpen('A') // 搜索「ar」时恒为 true
 *
 */
function isGroupOpen (initial: string): boolean {
    if (search.value.trim()) {
        return true
    }
    return expanded.value.has(initial)
}

/**
 * @description 切换分组展开/收起（写入记忆集合，触发 Set 重建以保持响应性）
 * @param initial 首字母分组键
 * @returns void
 *
 */
function toggleGroup (initial: string): void {
    const next = new Set(expanded.value)
    if (next.has(initial)) {
        next.delete(initial)
    } else {
        next.add(initial)
    }
    expanded.value = next
}

/**
 * @description 选中某配色方案（或「跟随系统」），写回全局配色偏好
 * @param name 配色名或 'auto'
 * @returns void
 *
 */
function selectScheme (name: string): void {
    emit('update:modelValue', name)
}
</script>

<template>
    <div class="scheme-picker">
        <div class="scheme-search">
            <Search :size="14" class="scheme-search-icon" />
            <Input v-model="search" class="scheme-search-input" :placeholder="t('settings.searchPlaceholder')" />
        </div>

        <button
            class="scheme-entry scheme-entry-auto"
            :class="{ active: modelValue === 'auto' }"
            @click="selectScheme('auto')"
        >
            <span class="scheme-entry-name">{{ t('settings.colorSchemeAuto') }}</span>
        </button>

        <div v-for="group in groups" :key="group.initial" class="scheme-group">
            <button class="scheme-group-header" @click="toggleGroup(group.initial)">
                <ChevronRight :size="14" class="scheme-chevron" :class="{ open: isGroupOpen(group.initial) }" />
                <span class="scheme-group-initial">{{ group.initial }}</span>
                <span class="scheme-group-count">{{ group.schemes.length }}</span>
            </button>
            <div v-if="isGroupOpen(group.initial)" class="scheme-group-body">
                <button
                    v-for="scheme in group.schemes"
                    :key="scheme.name"
                    class="scheme-entry"
                    :class="{ active: modelValue === scheme.name }"
                    @click="selectScheme(scheme.name)"
                >
                    <div class="scheme-entry-head">
                        <span class="scheme-entry-name" :title="scheme.name">{{ scheme.name }}</span>
                        <span v-if="customNames.has(scheme.name)" class="scheme-entry-tag">{{ t('settings.customTag') }}</span>
                        <span class="scheme-dots">
                            <span
                                v-for="(color, index) in scheme.colors"
                                :key="index"
                                class="scheme-dot"
                                :style="{ background: color }"
                            ></span>
                        </span>
                    </div>
                    <div
                        class="scheme-entry-preview font-mono"
                        :style="{ background: scheme.background, color: scheme.foreground, borderColor: scheme.cursor }"
                    >
                        <span class="scheme-preview-line">
                            <i :style="{ color: scheme.colors[2] }">user@scx</i>:<i :style="{ color: scheme.colors[4] }">~</i>$ ls
                        </span>
                        <span class="scheme-preview-line">
                            <i :style="{ color: scheme.colors[3] }">Documents</i>&nbsp;&nbsp;<i :style="{ color: scheme.colors[6] }">Downloads</i>&nbsp;&nbsp;<i :style="{ color: scheme.colors[8] }">Pictures</i>&nbsp;&nbsp;<i :style="{ color: scheme.colors[4] }">Music</i>
                        </span>
                    </div>
                </button>
            </div>
        </div>

        <p v-if="groups.length === 0" class="scheme-empty">{{ t('settings.colorSchemeEmpty') }}</p>
    </div>
</template>

<style scoped>
.scheme-picker {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-width: 520px;
}

.scheme-search {
    position: relative;
    display: flex;
    align-items: center;
}

.scheme-search-icon {
    position: absolute;
    left: 10px;
    color: var(--color-muted-foreground);
    pointer-events: none;
}

.scheme-search-input {
    padding-left: 30px;
}

.scheme-group-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--color-foreground);
    cursor: default;
    font-size: 12px;
}

.scheme-group-header:hover {
    background: var(--color-accent);
}

.scheme-chevron {
    color: var(--color-muted-foreground);
    transition: transform 0.15s ease;
}

.scheme-chevron.open {
    transform: rotate(90deg);
}

.scheme-group-initial {
    font-weight: 600;
    letter-spacing: 0.04em;
}

.scheme-group-count {
    color: var(--color-muted-foreground);
    font-size: 11px;
}

.scheme-group-body {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px 0 8px 12px;
}

.scheme-entry {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    background: var(--color-card);
    color: var(--color-foreground);
    cursor: default;
    text-align: left;
    transition: border-color 0.12s ease;
}

.scheme-entry:hover {
    border-color: var(--color-ring);
}

.scheme-entry.active {
    border-color: var(--color-primary);
    box-shadow: 0 0 0 1px var(--color-primary);
}

.scheme-entry-auto {
    flex-direction: row;
    align-items: center;
}

.scheme-entry-head {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
}

.scheme-entry-name {
    font-size: 13px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.scheme-entry-tag {
    flex-shrink: 0;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--color-secondary);
    color: var(--color-muted-foreground);
    font-size: 10px;
}

.scheme-dots {
    display: flex;
    gap: 2px;
    margin-left: auto;
    flex-shrink: 0;
}

.scheme-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    border: 1px solid var(--color-border);
}

.scheme-entry-preview {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 10px;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    font-size: 12px;
    line-height: 1.5;
    white-space: nowrap;
    overflow: hidden;
}

.scheme-preview-line i {
    font-style: normal;
}

.scheme-empty {
    color: var(--color-muted-foreground);
    font-size: 12px;
    padding: 8px 0;
}
</style>
