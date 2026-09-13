<!--
  @description 通用下拉菜单组件（reka-ui DropdownMenu 封装），与 ContextMenu 同一套菜单项模型；
                供标题栏「+」等点击式菜单使用，选择结果以 select(key) 事件回传
-->
<script setup lang="ts">
import {
    DropdownMenuRoot,
    DropdownMenuTrigger,
    DropdownMenuPortal,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
} from 'reka-ui'
import { cn } from '@/lib/utils'
import type { ContextMenuItemSpec } from '@/components/ui/ContextMenu.vue'

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
    <DropdownMenuRoot @update:open="open => emit('open', open)">
        <DropdownMenuTrigger as-child>
            <slot />
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
            <DropdownMenuContent
                align="start"
                :side-offset="4"
                :class="cn('z-50 min-w-[10rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95', $attrs.class ?? '')"
            >
                <template v-for="item in props.items" :key="item.key">
                    <DropdownMenuSeparator v-if="item.separatorBefore" class="-mx-1 my-1 h-px bg-border" />
                    <DropdownMenuItem
                        :disabled="item.disabled"
                        :class="cn(
                            'relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
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
                    </DropdownMenuItem>
                </template>
            </DropdownMenuContent>
        </DropdownMenuPortal>
    </DropdownMenuRoot>
</template>
