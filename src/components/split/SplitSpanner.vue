<script setup lang="ts">
/**
 * Draggable divider between two split panes. Adjusts the flex shares of the
 * adjacent children while dragging (pointer events), with Tabby-style
 * 0.125s transitions suppressed during the drag itself.
 */
const props = defineProps<{
    orientation: 'h' | 'v'
}>()

const emit = defineEmits<{
    (e: 'resize', delta: number): void
}>()

let dragging = false

function onPointerDown (event: PointerEvent) {
    dragging = true
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onPointerMove (event: PointerEvent) {
    if (dragging) {
        const delta = props.orientation === 'h' ? event.movementX : event.movementY
        emit('resize', delta)
    }
}

function onPointerUp (event: PointerEvent) {
    dragging = false
    try {
        ;(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
    } catch {
        // pointer already released
    }
}
</script>

<template>
    <div
        class="split-spanner"
        :class="orientation"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
    ></div>
</template>

<style scoped>
.split-spanner {
    flex-shrink: 0;
    z-index: var(--z-split-spanner);
    transition: background 0.125s ease;
}

.split-spanner.h {
    width: 5px;
    cursor: col-resize;
    margin: 0 -1px;
}

.split-spanner.v {
    height: 5px;
    cursor: row-resize;
    margin: -1px 0;
}

.split-spanner:hover,
.split-spanner:active {
    background: var(--color-primary);
}
</style>
