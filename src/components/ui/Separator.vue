<script setup lang="ts">
import { Separator } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps<{
    orientation?: 'horizontal' | 'vertical'
}>()
</script>

<template>
    <Separator
        :orientation="props.orientation ?? 'horizontal'"
        :class="cn('shrink-0 bg-border', props.orientation === 'vertical' ? 'w-px h-full' : 'h-px w-full', $attrs.class ?? '')"
    />
</template>
