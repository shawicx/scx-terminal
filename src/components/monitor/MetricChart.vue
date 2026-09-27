<!--
  @description 监控指标面积图（手写 SVG，零依赖）：全量渲染传入序列（裁剪由
              store 环形缓冲负责），当前值叠加在右上角；null 按 0 绘制。
              GSAP：采样更新经数值插值补间（曲线连续流动、当前值滚动、
              y 轴自适应缩放平滑）；首次出线自左向右画出；每次采样面积轻微脉动。
              视觉：纵向渐变面积 + 细线 sparkline，可选 sub 副信息行（如内存
              已用/总量），渐变 id 按实例唯一避免多图串色。
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { gsap, tweenNumericArray, prefersReducedMotion } from '@/lib/motion'

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
    /** 副信息行（图下小字，如内存已用/总量） */
    sub?: string
}>(), {
    color: 'var(--color-primary)',
    height: 120,
    max: undefined,
    unit: '%',
    format: undefined,
    sub: undefined,
})

/** 实例唯一渐变 id：多图共存时各引用自己的 defs */
const uid = `metric-chart-grad-${Math.random().toString(36).slice(2, 9)}`

/** 展示序列：采样到达时从当前展示值向新值补间（曲线流动的载体）；null 按 0 绘制（原语义） */
const displayValues = ref<number[]>(props.values.map(v => v ?? 0))
/** 当前值（最后非 null 样本）独立补间：数字滚动且保留断流时的最后已知值 */
const displayCurrent = ref<number | null>(lastNonNull(props.values))
let sampleTween: ReturnType<typeof tweenNumericArray> | null = null
let currentTween: gsap.core.Tween | null = null
let drawn = false

const lineEl = ref<SVGPolylineElement>()
const areaEl = ref<SVGPathElement>()

/**
 * @description 序列中最后一个非 null 值（无则 null）
 * @param values 原始序列
 * @returns number | null
 *
 */
function lastNonNull (values: Array<number | null>): number | null {
    for (let i = values.length - 1; i >= 0; i--) {
        if (values[i] !== null && values[i] !== undefined) {
            return values[i]
        }
    }
    return null
}

watch(() => props.values, to => {
    const target = to.map(v => v ?? 0)
    if (prefersReducedMotion() || !to.length) {
        sampleTween?.kill()
        currentTween?.kill()
        sampleTween = null
        currentTween = null
        displayValues.value = target
        displayCurrent.value = lastNonNull(to)
        return
    }
    // 新采样从当前展示值起跳，曲线不闪跳
    sampleTween?.kill()
    sampleTween = tweenNumericArray(displayValues.value, target, values => {
        displayValues.value = values
    })
    const targetCurrent = lastNonNull(to)
    if (targetCurrent !== null) {
        const from = displayCurrent.value ?? targetCurrent
        currentTween?.kill()
        const proxy = { v: from }
        currentTween = gsap.to(proxy, {
            v: targetCurrent,
            duration: 0.5,
            ease: 'power1.out',
            onUpdate: () => {
                displayCurrent.value = proxy.v
            },
        })
    }
    pulseArea()
})

const dataMax = computed(() => Math.max(1, ...displayValues.value) * 1.1)
const chartMax = computed(() => props.max ?? dataMax.value)
const points = computed(() => {
    const vals = displayValues.value
    if (vals.length === 0) {
        return ''
    }
    return vals
        .map((v, i) => {
            const x = vals.length === 1 ? 100 : (i / (vals.length - 1)) * 100
            const y = 100 - Math.min(100, (v / chartMax.value) * 100)
            return `${x.toFixed(2)},${y.toFixed(2)}`
        })
        .join(' ')
})
const areaPath = computed(() => (points.value ? `M0,100 L${points.value} L100,100 Z` : ''))

/** 当前值取补间中的展示值：数字随采样滚动 */
const currentText = computed(() => {
    if (displayCurrent.value === null) {
        return '—'
    }
    return props.format ? props.format(displayCurrent.value) : `${displayCurrent.value.toFixed(1)}${props.unit}`
})

/**
 * @description 首次出线自左向右画出（stroke-dashoffset），仅执行一次
 * @returns void
 *
 */
function drawLineOnce (): void {
    if (drawn || prefersReducedMotion()) {
        drawn = true
        return
    }
    const line = lineEl.value
    if (!line) {
        return
    }
    drawn = true
    const length = line.getTotalLength()
    gsap.fromTo(line,
        { strokeDasharray: length, strokeDashoffset: length },
        { strokeDashoffset: 0, duration: 0.6, ease: 'power2.out', clearProps: 'strokeDasharray,strokeDashoffset' })
}

/**
 * @description 采样脉动：渐变面积整体透明度轻微起伏后回落（保持克制）
 * @returns void
 *
 */
function pulseArea (): void {
    const area = areaEl.value
    if (!area || prefersReducedMotion()) {
        return
    }
    gsap.fromTo(area,
        { opacity: 0.72 },
        { opacity: 1, duration: 0.2, yoyo: true, repeat: 1, ease: 'power1.inOut', clearProps: 'opacity' })
}

watch(() => !!points.value, has => {
    if (has) {
        drawLineOnce()
    }
})

onBeforeUnmount(() => {
    sampleTween?.kill()
    currentTween?.kill()
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
            <defs>
                <linearGradient :id="uid" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" :style="{ stopColor: color, stopOpacity: 0.32 }" />
                    <stop offset="100%" :style="{ stopColor: color, stopOpacity: 0.02 }" />
                </linearGradient>
            </defs>
            <line v-for="g in [25, 50, 75]" :key="g" class="grid" x1="0" :y1="g" x2="100" :y2="g" />
            <path v-if="areaPath" ref="areaEl" class="area" :d="areaPath" :fill="`url(#${uid})`" />
            <polyline v-if="points" ref="lineEl" class="line" :points="points" :style="{ stroke: color }" />
        </svg>
        <div v-if="sub" class="metric-chart-sub">{{ sub }}</div>
    </div>
</template>

<style scoped>
.metric-chart {
    background: var(--color-card);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    padding: 8px 10px 7px;
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
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.04em;
    overflow: hidden;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
}
.metric-chart-value {
    font-family: var(--font-mono);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    margin-left: 8px;
}
.metric-chart-svg {
    display: block;
    width: 100%;
}
.grid {
    opacity: 0.55;
    stroke: var(--color-border);
    stroke-width: 0.4;
    vector-effect: non-scaling-stroke;
}
.area {
    opacity: 1;
}
.line {
    fill: none;
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
}
.metric-chart-sub {
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 10px;
    margin-top: 4px;
    text-align: right;
}
</style>
