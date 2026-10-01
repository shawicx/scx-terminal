<!--
  @description 设置页左列表通用手风琴分组（本地档案/SSH/快捷命令共用）：单开互斥分段、
                首次渲染自动展开 preferredKey（缺省首段，仅一次）、可折叠组头（箭头/名称/
                计数/徽标/悬停操作钮/手动排序）；成员内容由调用方经默认作用域插槽（data 为原始分段）渲染。
-->
<script setup lang="ts" generic="T">
import { ref, watch } from 'vue'
import { ChevronDown, ChevronRight, ChevronUp, GripVertical, Pencil, X } from 'lucide-vue-next'
import { findNearestSortableGroup, findSortableGroupAtPoint } from './groupDragSort'

/** 手风琴分段：展示字段 + data 原始载荷（成员列表等，交由插槽消费） */
export interface AccordionSection<T> {
    key: string
    title: string
    count?: number
    badge?: string
    /** 自定义组才显示重命名/删除钮（默认分组/未分组段不显示） */
    manageable?: boolean
    /** 真实分组才可手动排序（默认分组/未分组虚拟段固定置顶） */
    sortable?: boolean
    data: T
}

const props = defineProps<{
    sections: AccordionSection<T>[]
    /** 首次自动展开的分段键（不存在时回退首段；仅一次，之后交由用户操作） */
    preferredKey?: string
    renameTitle: string
    deleteTitle: string
    moveUpTitle: string
    moveDownTitle: string
}>()

const emit = defineEmits<{
    (e: 'rename', key: string): void
    (e: 'delete', key: string): void
    (e: 'reorder', sourceKey: string, targetKey: string): void
}>()

/** 当前展开的分段键；空 = 全收起（同时仅一段展开） */
const openKey = ref('')

/** 当前拖拽源 / 高亮落点分组键；空 = 无拖拽态 */
const dragKey = ref('')
const dropKey = ref('')
/** 指针拖拽运行时状态；不用 HTML5 DnD 是因为 Tauri 的原生文件拖放会拦截 dataTransfer */
let dragSource: AccordionSection<T> | null = null
let dragPointerTarget: HTMLElement | null = null
let dragPointerId = -1
let dragStartX = 0
let dragStartY = 0
let dragMoved = false
let suppressHeaderClick = false

/**
 * @description 输出分组拖拽调试日志（仅开发模式，便于定位 Tauri/浏览器事件链差异）
 * @param args 任意调试参数
 * @returns void
 *
 * @example debugGroupDrag('pointerdown', { key: 'g1' })
 *
 */
function debugGroupDrag (...args: unknown[]): void {
    if (import.meta.env.DEV) {
        console.info('[group-drag]', ...args)
    }
}

/**
 * @description 解析当前指针的分组落点：命中组头时直接使用；落在组头间空隙时
 *              回退到几何距离最近的组头（最近头不可排序仍返回 null）
 * @param clientX 指针 X 坐标
 * @param clientY 指针 Y 坐标
 * @returns AccordionSection<T> | null 可排序目标；无有效目标返回 null
 *
 * @example findGroupDropTarget(event.clientX, event.clientY)
 *
 */
function findGroupDropTarget (clientX: number, clientY: number): AccordionSection<T> | null {
    const elements = document.elementsFromPoint(clientX, clientY)
    const direct = findSortableGroupAtPoint(props.sections, clientX, clientY, () => elements)
    if (elements.some(element => element.closest('[data-group-key]'))) {
        return direct
    }
    const headers = [...document.querySelectorAll<HTMLElement>('[data-group-key]')].map(element => {
        const rect = element.getBoundingClientRect()
        return { key: element.dataset.groupKey!, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    })
    return findNearestSortableGroup(props.sections, headers, clientX, clientY)
}

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

/**
 * @description 校验并上抛分组排序请求（仅允许真实分组参与）
 * @param sourceKey 被移动分组键
 * @param targetKey 放置目标分组键
 * @returns void
 *
 * @example requestReorder('g2', 'g1')
 *
 */
function requestReorder (sourceKey: string, targetKey: string): void {
    const source = props.sections.find(section => section.key === sourceKey)
    const target = props.sections.find(section => section.key === targetKey)
    debugGroupDrag('reorder:request', {
        sourceKey,
        targetKey,
        sourceSortable: source?.sortable,
        targetSortable: target?.sortable,
        sections: props.sections.map(section => ({ key: section.key, sortable: section.sortable })),
    })
    if (!source?.sortable || !target?.sortable || sourceKey === targetKey) {
        return
    }
    debugGroupDrag('reorder:emit', { sourceKey, targetKey })
    emit('reorder', sourceKey, targetKey)
}

/**
 * @description 判断分组能否向指定方向移动（相邻真实分组存在才可移动）
 * @param section 目标分段
 * @param direction 移动方向（-1 上移 / 1 下移）
 * @returns boolean 是否存在可交换的相邻分组
 *
 * @example canMove(section, -1)
 *
 */
function canMove (section: AccordionSection<T>, direction: -1 | 1): boolean {
    const keys = props.sections.filter(item => item.sortable).map(item => item.key)
    const index = keys.indexOf(section.key)
    return index !== -1 && index + direction >= 0 && index + direction < keys.length
}

/**
 * @description 通过按钮移动分组到相邻真实分组的位置
 * @param section 目标分段
 * @param direction 移动方向（-1 上移 / 1 下移）
 * @returns void
 *
 * @example moveSection(section, -1)
 *
 */
function moveSection (section: AccordionSection<T>, direction: -1 | 1): void {
    if (!section.sortable || !canMove(section, direction)) {
        return
    }
    const keys = props.sections.filter(item => item.sortable).map(item => item.key)
    requestReorder(section.key, keys[keys.indexOf(section.key) + direction]!)
}

/**
 * @description 以分组手柄为起点启动指针拖拽（Tauri 开启原生拖放时会拦截 HTML5 DnD）
 * @param section 拖拽分段
 * @param event 指针按下事件
 * @returns void
 *
 * @example startGroupDrag(section, event)
 *
 */
function startGroupDrag (section: AccordionSection<T>, event: PointerEvent): void {
    debugGroupDrag('pointerdown', {
        key: section.key,
        sortable: section.sortable,
        button: event.button,
        isPrimary: event.isPrimary,
        pointerId: event.pointerId,
        currentTarget: event.currentTarget instanceof HTMLElement ? event.currentTarget.tagName : null,
    })
    if (!section.sortable || event.button !== 0 || !event.isPrimary) {
        return
    }
    event.preventDefault()
    const currentTarget = event.currentTarget
    if (!(currentTarget instanceof HTMLElement)) {
        return
    }
    debugGroupDrag('drag:start', { key: section.key, pointerId: event.pointerId })
    dragSource = section
    dragPointerTarget = currentTarget
    dragPointerId = event.pointerId
    dragStartX = event.clientX
    dragStartY = event.clientY
    currentTarget.setPointerCapture(event.pointerId)
    window.addEventListener('pointermove', traceGroupDrag)
    window.addEventListener('pointerup', endGroupDrag)
    window.addEventListener('pointercancel', endGroupDrag)
}

/**
 * @description 命中测试当前指针下的目标分组；移动超过阈值后才进入拖拽态
 * @param event 指针移动事件
 * @returns void
 *
 * @example traceGroupDrag(event)
 *
 */
function traceGroupDrag (event: PointerEvent): void {
    if (!dragSource || event.pointerId !== dragPointerId) {
        return
    }
    if (!dragMoved && Math.hypot(event.clientX - dragStartX, event.clientY - dragStartY) < 4) {
        return
    }
    dragMoved = true
    dragKey.value = dragSource.key
    const target = findGroupDropTarget(event.clientX, event.clientY)
    debugGroupDrag('drag:hit-test', {
        sourceKey: dragSource.key,
        targetKey: target?.key ?? null,
        targetSortable: target?.sortable ?? null,
    })
    dropKey.value = target && target.key !== dragSource.key ? target.key : ''
}

/**
 * @description 结束指针拖拽：有效落点时上抛排序请求，随后释放捕获并清理拖拽态
 * @param event 指针抬起/取消事件
 * @returns void
 *
 * @example endGroupDrag(event)
 *
 */
function endGroupDrag (event: PointerEvent): void {
    if (!dragSource || event.pointerId !== dragPointerId) {
        return
    }
    const source = dragSource
    // cleanup 会重置 dragMoved；提交判定必须先保存快照
    const moved = dragMoved
    const target = moved ? findGroupDropTarget(event.clientX, event.clientY) : null
    debugGroupDrag('pointerup', {
        sourceKey: source.key,
        moved: dragMoved,
        targetKey: target?.key ?? null,
        x: event.clientX,
        y: event.clientY,
    })
    cleanupGroupDrag()
    if (moved) {
        // 拖拽结束后的合成 click 不应再触发展开/收起
        suppressHeaderClick = true
        window.setTimeout(() => {
            suppressHeaderClick = false
        })
        if (target && target.key !== source.key) {
            requestReorder(source.key, target.key)
        }
    } else {
        debugGroupDrag('drag:ignored-below-threshold', { key: source.key })
    }
}

/**
 * @description 清理指针捕获、窗口监听与临时拖拽状态
 * @returns void
 *
 * @example cleanupGroupDrag()
 *
 */
function cleanupGroupDrag (): void {
    if (dragPointerTarget?.hasPointerCapture(dragPointerId)) {
        dragPointerTarget.releasePointerCapture(dragPointerId)
    }
    window.removeEventListener('pointermove', traceGroupDrag)
    window.removeEventListener('pointerup', endGroupDrag)
    window.removeEventListener('pointercancel', endGroupDrag)
    dragSource = null
    dragPointerTarget = null
    dragPointerId = -1
    dragMoved = false
    dragKey.value = ''
    dropKey.value = ''
}

/**
 * @description 分组头点击入口：指针拖拽结束后的合成点击会被忽略
 * @param section 目标分段
 * @returns void
 *
 * @example onHeaderClick(section)
 *
 */
function onHeaderClick (section: AccordionSection<T>): void {
    if (suppressHeaderClick) {
        return
    }
    toggleSection(section.key)
}

</script>

<template>
    <template v-for="section in props.sections" :key="section.key">
        <div
            class="group-header"
            :class="{
                'drop-target': !!section.sortable && dropKey === section.key && dragKey !== section.key,
                dragging: dragKey === section.key,
            }"
            :data-group-key="section.key"
            @click="onHeaderClick(section)"
        >
            <ChevronRight :size="14" class="group-chevron" :class="{ open: openKey === section.key }" />
            <span class="group-name">{{ section.title }}</span>
            <span v-if="section.count !== undefined" class="group-count">{{ section.count }}</span>
            <span v-if="section.badge" class="group-badge">{{ section.badge }}</span>
            <span v-if="section.manageable || section.sortable" class="group-actions" @click.stop>
                <span
                    v-if="section.sortable"
                    class="group-action-grip"
                    aria-hidden="true"
                    @pointerdown="startGroupDrag(section, $event)"
                >
                    <GripVertical :size="12" />
                </span>
                <button
                    v-if="section.sortable"
                    type="button"
                    class="group-action"
                    :title="props.moveUpTitle"
                    :aria-label="props.moveUpTitle"
                    :disabled="!canMove(section, -1)"
                    @click.stop="moveSection(section, -1)"
                >
                    <ChevronUp :size="12" />
                </button>
                <button
                    v-if="section.sortable"
                    type="button"
                    class="group-action"
                    :title="props.moveDownTitle"
                    :aria-label="props.moveDownTitle"
                    :disabled="!canMove(section, 1)"
                    @click.stop="moveSection(section, 1)"
                >
                    <ChevronDown :size="12" />
                </button>
                <template v-if="section.manageable">
                    <button type="button" class="group-action" :title="props.renameTitle" @click.stop="emit('rename', section.key)">
                        <Pencil :size="12" />
                    </button>
                    <button type="button" class="group-action" :title="props.deleteTitle" @click.stop="emit('delete', section.key)">
                        <X :size="12" />
                    </button>
                </template>
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

.group-header.drop-target {
    background: var(--color-accent);
    box-shadow: inset 0 0 0 1px var(--color-ring);
}

.group-header.dragging {
    cursor: grabbing;
    opacity: 0.65;
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
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
    margin-left: auto;
    visibility: hidden;
    opacity: 0;
    transition: opacity 0.25s ease, visibility 0.25s ease;
}

.group-header:hover .group-actions,
.group-header:focus-within .group-actions {
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

.group-action:disabled {
    cursor: default;
    opacity: 0.35;
}

.group-action:disabled:hover {
    background: transparent;
    color: var(--color-muted-foreground);
}

.group-action-grip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    flex: none;
    color: var(--color-muted-foreground);
    cursor: grab;
    touch-action: none;
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
