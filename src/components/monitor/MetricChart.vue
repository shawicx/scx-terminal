<!--
  @description 监控指标面积图（手写 SVG，零依赖）：全量渲染传入序列（裁剪由
              store 环形缓冲负责），当前值叠加在右上角；null 按 0 绘制。
-->
<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
    /** 指标名（左上角标签） */
    label: string
    /** 序列（null 首帧占位按 0 绘制） */
    values: Array<number | null>
    /** 线/填充色（CSS 变量名） */
    color?: string
    /** 图高 px */
    height?: number
    /** y 轴上限（缺省 = max(values)*1.1 下限 1） */
    max?: number
    /** 当前值后缀 */
    unit?: string
    /** 当前值自定义格式化（如网络速率自动单位）；提供时优先于 unit 拼接 */
    format?: (v: number) => string
}>(), {
    color: 'var(--color-primary)',
    height: 120,
    max: undefined,
    unit: '%',
    format: undefined,
})

const dataMax = computed(() => Math.max(1, ...props.values.map(v => v ?? 0)) * 1.1)
const chartMax = computed(() => props.max ?? dataMax.value)
const points = computed(() => {
    const vals = props.values
    if (vals.length === 0) {
        return ''
    }
    return vals
        .map((v, i) => {
            const x = vals.length === 1 ? 100 : (i / (vals.length - 1)) * 100
            const y = 100 - Math.min(100, ((v ?? 0) / chartMax.value) * 100)
            return `${x.toFixed(2)},${y.toFixed(2)}`
        })
        .join(' ')
})
const areaPath = computed(() => (points.value ? `M0,100 L${points.value} L100,100 Z` : ''))
const current = computed(() => {
    for (let i = props.values.length - 1; i >= 0; i--) {
        const v = props.values[i]
        if (v !== null && v !== undefined) {
            return v
        }
    }
    return null
})
const currentText = computed(() => {
    if (current.value === null) {
        return '—'
    }
    return props.format ? props.format(current.value) : `${current.value.toFixed(1)}${props.unit}`
})
</script>

<template>
    <div class="metric-chart">
        <div class="metric-chart-head">
            <span class="metric-chart-label">{{ label }}</span>
            <span class="metric-chart-value" :style="{ color }">{{ currentText }}</span>
        </div>
        <svg
            class="metric-chart-svg"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            :style="{ height: height + 'px' }"
        >
            <line v-for="g in [25, 50, 75]" :key="g" class="grid" x1="0" :y1="g" x2="100" :y2="g" />
            <path v-if="areaPath" class="area" :d="areaPath" :style="{ fill: color }" />
            <polyline v-if="points" class="line" :points="points" :style="{ stroke: color }" />
        </svg>
    </div>
</template>

<style scoped>
.metric-chart {
    background: var(--color-card);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    padding: 8px 10px 6px;
    position: relative;
}
.metric-chart-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 4px;
}
.metric-chart-label {
    color: var(--color-muted-foreground);
    font-size: 11px;
}
.metric-chart-value {
    font-family: var(--font-mono);
    font-size: 12px;
}
.metric-chart-svg {
    display: block;
    width: 100%;
}
.grid {
    stroke: var(--color-border);
    stroke-width: 0.4;
    vector-effect: non-scaling-stroke;
}
.area {
    opacity: 0.18;
}
.line {
    fill: none;
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
}
</style>
