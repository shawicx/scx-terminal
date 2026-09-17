<script setup lang="ts">
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

const model = defineModel<string>({ default: '' })

const props = defineProps<{
    options: SelectOption[]
    placeholder?: string
}>()
</script>

<template>
    <SelectRoot v-model="model">
        <SelectTrigger
            :class="cn('flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:truncate cursor-default', $attrs.class ?? '')"
        >
            <SelectValue :placeholder="props.placeholder ?? ''" />
            <ChevronDown class="h-4 w-4 opacity-50 shrink-0" />
        </SelectTrigger>
        <SelectPortal>
            <SelectContent
                position="popper"
                class="relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
            >
                <SelectViewport class="p-1">
                    <SelectItem
                        v-for="option in props.options"
                        :key="option.value"
                        :value="option.value"
                        class="relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
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
