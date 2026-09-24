<!--
  @description 设置页左列表通用手风琴分组（本地档案/SSH/快捷命令共用）：单开互斥分段、
                首次渲染自动展开 preferredKey（缺省首段，仅一次）、可折叠组头（箭头/名称/
                计数/徽标/悬停操作钮）；成员内容由调用方经默认作用域插槽（data 为原始分段）渲染。
-->
<script setup lang="ts" generic="T">
import { ref, watch } from 'vue'
import { ChevronRight, Pencil, X } from 'lucide-vue-next'

/** 手风琴分段：展示字段 + data 原始载荷（成员列表等，交由插槽消费） */
export interface AccordionSection<T> {
    key: string
    title: string
    count?: number
    badge?: string
    /** 自定义组才显示重命名/删除钮（默认分组/未分组段不显示） */
    manageable?: boolean
    data: T
}

const props = defineProps<{
    sections: AccordionSection<T>[]
    /** 首次自动展开的分段键（不存在时回退首段；仅一次，之后交由用户操作） */
    preferredKey?: string
    renameTitle: string
    deleteTitle: string
}>()

const emit = defineEmits<{
    (e: 'rename', key: string): void
    (e: 'delete', key: string): void
}>()

/** 当前展开的分段键；空 = 全收起（同时仅一段展开） */
const openKey = ref('')

/** 首段是否已自动展开过（仅一次） */
let autoOpened = false

// 首次出现分段时自动展开 preferredKey 所在段（兜底首段）
watch(() => props.sections, sections => {
    if (autoOpened || sections.length === 0) {
        return
    }
    autoOpened = true
    openKey.value = sections.some(section => section.key === props.preferredKey)
        ? props.preferredKey!
        : sections[0]!.key
}, { immediate: true })

/**
 * @description 手风琴切换：点击已展开段收起（全收起状态），点击其余段则展开该段并收起其他段
 * @param key 分段键
 * @returns void
 *
 * @example toggleSection('localgroup-zsh')
 *
 */
function toggleSection (key: string): void {
    openKey.value = openKey.value === key ? '' : key
}
</script>

<template>
    <template v-for="section in props.sections" :key="section.key">
        <div class="group-header" @click="toggleSection(section.key)">
            <ChevronRight :size="14" class="group-chevron" :class="{ open: openKey === section.key }" />
            <span class="group-name">{{ section.title }}</span>
            <span v-if="section.count !== undefined" class="group-count">{{ section.count }}</span>
            <span v-if="section.badge" class="group-badge">{{ section.badge }}</span>
            <span v-if="section.manageable" class="group-actions" @click.stop>
                <button class="group-action" :title="props.renameTitle" @click.stop="emit('rename', section.key)">
                    <Pencil :size="12" />
                </button>
                <button class="group-action" :title="props.deleteTitle" @click.stop="emit('delete', section.key)">
                    <X :size="12" />
                </button>
            </span>
        </div>
        <div class="group-body" :class="{ collapsed: openKey !== section.key }">
            <div class="group-body-inner">
                <slot :data="section.data" />
            </div>
        </div>
    </template>
</template>

<style scoped>
/* 可折叠组头：图标/名称/计数/徽标皆为直接子项垂直居中，动作钮右贴；
   垂直 padding 对称避免 hover 背景内内容偏移，顶距用 margin 补 */
.group-header {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 6px;
    padding: 6px 8px;
    margin-top: 6px;
    border-radius: 6px;
    cursor: pointer;
    user-select: none;
    transition: background-color 0.15s ease;
}

.group-header:hover {
    background: var(--color-accent);
}

.group-chevron {
    flex: none;
    color: var(--color-muted-foreground);
    transition: transform 0.15s ease;
}

.group-chevron.open {
    transform: rotate(90deg);
}

.group-name {
    min-width: 0;
    flex: 0 1 auto;
    font-size: 12px;
    font-weight: 600;
    line-height: 22px;
    color: var(--color-foreground);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.group-count {
    flex: none;
    font-size: 11px;
    font-weight: 400;
    color: var(--color-muted-foreground);
}

.group-badge {
    flex-shrink: 0;
    padding: 0 5px;
    border-radius: 4px;
    background: var(--color-primary);
    color: var(--color-primary-foreground);
    font-size: 11px;
    line-height: 18px;
}

/* 隐藏但保留占位避免行高变化；悬停组头时浮现（对齐 SettingsView 原 qc-group-actions） */
.group-actions {
    display: inline-flex;
    gap: 2px;
    flex-shrink: 0;
    margin-left: auto;
    visibility: hidden;
    opacity: 0;
    transition: opacity 0.25s ease, visibility 0.25s ease;
}

.group-header:hover .group-actions {
    visibility: visible;
    opacity: 1;
}

.group-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--color-muted-foreground);
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease;
}

.group-action:hover {
    background: var(--color-accent);
    color: var(--color-accent-foreground);
}

/* 收展过渡：grid 行高 0fr↔1fr 平滑动画（无需 JS 量高）；收起时内容淡出且
   visibility 随过渡结束时翻转（离散插值），折叠项不可聚焦。
   内层为 flex 列（对齐 detail-list），成员按钮恢复全宽拉伸 */
.group-body {
    display: grid;
    grid-template-rows: 1fr;
    transition: grid-template-rows 0.18s ease, visibility 0.18s;
}

.group-body.collapsed {
    grid-template-rows: 0fr;
    visibility: hidden;
}

.group-body-inner {
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: hidden;
    min-height: 0;
    transition: opacity 0.15s ease;
}

.group-body.collapsed .group-body-inner {
    opacity: 0;
}
</style>
