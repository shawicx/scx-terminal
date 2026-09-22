<!--
  @description 通用右键菜单组件（reka-ui ContextMenu 封装），供终端窗格、标签栏等共用；
                菜单项通过 items 传入，选择结果以 select(key) 事件回传
-->
<script setup lang="ts">
import {
    ContextMenuRoot,
    ContextMenuTrigger,
    ContextMenuPortal,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
} from 'reka-ui'
import { cn } from '@/lib/utils'

export interface ContextMenuItemSpec {
    key: string
    label: string
    disabled?: boolean
    /** 危险操作（如关闭），渲染为警示色 */
    danger?: boolean
    /** 在该项前插入分隔线 */
    separatorBefore?: boolean
    /** 色块标记（颜色选择场景），值为 CSS 颜色 */
    swatch?: string
}

defineOptions({ inheritAttrs: false })

const props = defineProps<{
    items: ContextMenuItemSpec[]
}>()

const emit = defineEmits<{
    (e: 'select', key: string): void
    (e: 'open', isOpen: boolean): void
}>()
</script>

<template>
    <ContextMenuRoot @update:open="open => emit('open', open)">
        <ContextMenuTrigger as-child>
            <slot />
        </ContextMenuTrigger>
        <ContextMenuPortal>
            <ContextMenuContent
                :class="cn('min-w-[10rem] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95', $attrs.class ?? '')"
                :style="{ zIndex: 'var(--z-menu-over-modal)' }"
            >
                <template v-for="item in props.items" :key="item.key">
                    <ContextMenuSeparator v-if="item.separatorBefore" class="-mx-1 my-1 h-px bg-border" />
                    <ContextMenuItem
                        :disabled="item.disabled"
                        :class="cn(
                            'relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
                            item.danger ? 'text-destructive' : '',
                        )"
                        @select="emit('select', item.key)"
                    >
                        <span
                            v-if="item.swatch"
                            class="h-3 w-3 shrink-0 rounded-full border border-border"
                            :style="{ background: item.swatch }"
                        ></span>
                        <span class="flex-1 truncate">{{ item.label }}</span>
                    </ContextMenuItem>
                </template>
            </ContextMenuContent>
        </ContextMenuPortal>
    </ContextMenuRoot>
</template>
