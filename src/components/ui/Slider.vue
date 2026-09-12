<script setup lang="ts">
import { SliderRoot, SliderTrack, SliderRange, SliderThumb } from 'reka-ui'
import { cn } from '@/lib/utils'

const model = defineModel<number>({ default: 0 })

// reka-ui's SliderRoot works with array models; wrap the scalar for a nicer API
function onModelUpdate (value: number[] | undefined): void {
    model.value = value?.[0] ?? model.value
}

const props = defineProps<{
    min?: number
    max?: number
    step?: number
}>()
</script>

<template>
    <SliderRoot
        :model-value="[model]"
        @update:model-value="onModelUpdate"
        class="relative flex w-full touch-none select-none items-center h-5"
        :min="props.min ?? 0"
        :max="props.max ?? 100"
        :step="props.step ?? 1"
    >
        <SliderTrack class="relative h-1 w-full grow overflow-hidden rounded-full bg-muted">
            <SliderRange class="absolute h-full bg-primary" />
        </SliderTrack>
        <SliderThumb
            :class="cn('block h-4 w-4 rounded-full border border-primary/50 bg-background shadow transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-grab active:cursor-grabbing')"
        />
    </SliderRoot>
</template>
