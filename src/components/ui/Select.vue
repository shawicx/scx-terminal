<!--
  @description 通用下拉选择（reka-ui Select 封装）：选项 value 为空字符串时在组件内部
                映射为哨兵值——reka-ui SelectItem 禁止 value=''（空串在 SelectRoot 上
                表示清空选择/显示占位符），否则 setup 阶段直接 throw。
-->
<script setup lang="ts">
import { computed } from 'vue'
import {
    SelectRoot,
    SelectTrigger,
    SelectValue,
    SelectPortal,
    SelectContent,
    SelectViewport,
    SelectItem,
    SelectItemText,
    SelectItemIndicator,
} from 'reka-ui'
import { ChevronDown, Check } from 'lucide-vue-next'
import { cn } from '@/lib/utils'

export interface SelectOption {
    value: string
    label: string
}

/** 空字符串选项的内部替身（「跟随全局/未分组/不用密钥链」等），对外模型仍用 '' */
const EMPTY_VALUE = '__scx__empty__'

const model = defineModel<string>({ default: '' })

const props = defineProps<{
    options: SelectOption[]
    placeholder?: string
}>()

const internalOptions = computed(() =>
    props.options.map(option => (option.value === '' ? { ...option, value: EMPTY_VALUE } : option)))

const internalModel = computed<string>({
    get: () => (model.value === '' ? EMPTY_VALUE : model.value),
    set: value => {
        model.value = value === EMPTY_VALUE ? '' : value
    },
})
</script>

<template>
    <SelectRoot v-model="internalModel">
        <SelectTrigger
            :class="cn('flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:truncate cursor-pointer', $attrs.class ?? '')"
        >
            <SelectValue :placeholder="props.placeholder ?? ''" />
            <ChevronDown class="h-4 w-4 opacity-50 shrink-0" />
        </SelectTrigger>
        <SelectPortal>
            <SelectContent
                position="popper"
                class="relative max-h-96 min-w-[8rem] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
                :style="{ zIndex: 'var(--z-menu-over-modal)' }"
            >
                <SelectViewport class="p-1">
                    <SelectItem
                        v-for="option in internalOptions"
                        :key="option.value"
                        :value="option.value"
                        class="relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                    >
                        <span class="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
                            <SelectItemIndicator>
                                <Check class="h-4 w-4" />
                            </SelectItemIndicator>
                        </span>
                        <SelectItemText>
                            {{ option.label }}
                        </SelectItemText>
                    </SelectItem>
                </SelectViewport>
            </SelectContent>
        </SelectPortal>
    </SelectRoot>
</template>
