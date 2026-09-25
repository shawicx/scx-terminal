<!--
  @description 设置·终端页：字体/光标/交互/兼容性/输入建议五个分组卡片，
              全部直写 config store.terminal（响应式 diff flush 持久化）。
-->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Switch from '@/components/ui/Switch.vue'
import Slider from '@/components/ui/Slider.vue'
import Select from '@/components/ui/Select.vue'
import SearchableSelect from '@/components/ui/SearchableSelect.vue'
import { useConfigStore } from '@/stores/config'
import { listSystemFonts } from '@/services/fonts'
import { clearHistory } from '@/services/history'
import type { NewlineMode } from '@/lib/middleware/streamProcessing'

const { t } = useI18n()
const config = useConfigStore()
const store = config.store

// ---- font picker ----
const systemFonts = ref<string[]>([])

onMounted(async () => {
    systemFonts.value = await listSystemFonts()
})

const fontOptions = computed(() => [
    { value: 'monospace', label: 'monospace' },
    ...systemFonts.value.map(font => ({ value: font, label: font })),
])

/** 字重下拉：常规/加粗 + CSS 数值档（xterm 透传给字体渲染） */
const fontWeightOptions = computed(() => [
    { value: 'normal', label: t('settings.weightNormal') },
    { value: 'bold', label: t('settings.weightBold') },
    ...(['100', '200', '300', '400', '500', '600', '700', '800', '900'] as const)
        .map(weight => ({ value: weight, label: weight })),
])

const cursorOptions = computed(() => [
    { value: 'block', label: t('settings.cursorStyleBlock') },
    { value: 'bar', label: t('settings.cursorStyleBar') },
    { value: 'underline', label: t('settings.cursorStyleUnderline') },
])

const backspaceOptions = computed(() => [
    { value: 'backspace', label: t('settings.backspaceDefault') },
    { value: 'ctrl-h', label: t('settings.backspaceCtrlH') },
    { value: 'ctrl-?', label: t('settings.backspaceCtrlQ') },
    { value: 'delete', label: t('settings.backspaceDelete') },
])

const newlineOptions = computed(() => [
    { value: 'auto', label: t('settings.newlinesAuto') },
    { value: 'cr', label: t('settings.newlinesCr') },
    { value: 'lf', label: t('settings.newlinesLf') },
    { value: 'crlf', label: t('settings.newlinesCrlf') },
    { value: 'implicit_cr', label: t('settings.newlinesImplicitCr') },
    { value: 'implicit_lf', label: t('settings.newlinesImplicitLf') },
])

const suggestionsTriggerOptions = computed(() => [
    { value: 'auto', label: t('settings.suggestionsTriggerAuto') },
    { value: 'manual', label: t('settings.suggestionsTriggerManual') },
])

/**
 * @description 清空全部命令历史并刷新内存索引（设置页入口）
 * @returns Promise<void>
 *
 * @example await onClearHistory()
 *
 */
async function onClearHistory (): Promise<void> {
    await clearHistory()
}

/**
 * @description 换行转换配置的双向绑定：配置值为 null 表示不转换，UI 用 'auto' 占位
 * @param key 配置键（'inputNewlines' | 'outputNewlines'）
 * @returns WritableComputed<string, void> 以字符串值驱动的双向绑定
 *
 * @example newlineModel('inputNewlines').value = 'auto' // store.terminal.inputNewlines = null
 *
 */
function newlineModel (key: 'inputNewlines' | 'outputNewlines') {
    return computed({
        get: () => store.terminal[key] ?? 'auto',
        set: (value: string) => {
            store.terminal[key] = (value === 'auto' ? null : value) as NewlineMode
        },
    })
}

const inputNewlinesModel = newlineModel('inputNewlines')
const outputNewlinesModel = newlineModel('outputNewlines')
</script>

<template>
    <div class="settings-page">
    <h2>{{ t('settings.terminal') }}</h2>

    <div class="settings-section">
        <h3 class="settings-section-title">{{ t('settings.sectionFontDisplay') }}</h3>
        <div class="settings-card">
            <div class="settings-card-row stacked">
                <div class="settings-row-head">
                    <Label>{{ t('settings.fontSize') }}</Label>
                    <span class="value-hint">{{ store.terminal.fontSize }}</span>
                </div>
                <Slider v-model="store.terminal.fontSize" :min="8" :max="32" :step="1" />
            </div>
            <div class="settings-card-row">
                <Label>{{ t('settings.fontFamily') }}</Label>
                <!-- list_fonts 不可用时回退自由文本输入 -->
                <SearchableSelect
                    v-if="systemFonts.length > 0"
                    v-model="store.terminal.font"
                    :options="fontOptions"
                    class="w-60"
                    :placeholder="t('settings.searchPlaceholder')"
                />
                <Input v-else v-model="store.terminal.font" placeholder="monospace" class="w-60" />
            </div>
            <div class="settings-card-row">
                <Label>{{ t('settings.fontWeight') }}</Label>
                <Select v-model="store.terminal.fontWeight" :options="fontWeightOptions" class="w-44" />
            </div>
            <div class="settings-card-row">
                <Label>{{ t('settings.fontWeightBold') }}</Label>
                <Select v-model="store.terminal.fontWeightBold" :options="fontWeightOptions" class="w-44" />
            </div>
            <div class="settings-card-row stacked">
                <div class="settings-row-head">
                    <Label>{{ t('settings.linePadding') }}</Label>
                    <span class="value-hint">{{ store.terminal.linePadding }}</span>
                </div>
                <Slider v-model="store.terminal.linePadding" :min="0" :max="8" :step="1" />
            </div>
            <div class="settings-card-row stacked">
                <div class="settings-row-head">
                    <Label>{{ t('settings.minimumContrast') }}</Label>
                    <span class="value-hint">{{ store.terminal.minimumContrastRatio }}</span>
                </div>
                <Slider v-model="store.terminal.minimumContrastRatio" :min="1" :max="7" :step="0.5" />
            </div>
            <div class="settings-card-row">
                <Label>{{ t('settings.boldInBright') }}</Label>
                <Switch v-model="store.terminal.drawBoldTextInBrightColors" />
            </div>
            <div class="settings-card-row">
                <Label>{{ t('settings.paletteGenerate') }}</Label>
                <Switch v-model="store.terminal.paletteGenerate" />
            </div>
            <div class="settings-card-row">
                <Label>{{ t('settings.paletteHarmonious') }}</Label>
                <Switch v-model="store.terminal.paletteHarmonious" :disabled="!store.terminal.paletteGenerate" />
            </div>
        </div>
    </div>

    <div class="settings-section">
        <h3 class="settings-section-title">{{ t('settings.sectionCursor') }}</h3>
        <div class="settings-card">
            <div class="settings-card-row">
                <Label>{{ t('settings.cursorStyle') }}</Label>
                <Select v-model="store.terminal.cursor" :options="cursorOptions" class="w-44" />
            </div>
            <div class="settings-card-row">
                <Label>{{ t('settings.cursorBlink') }}</Label>
                <Switch v-model="store.terminal.cursorBlink" />
            </div>
        </div>
    </div>

    <div class="settings-section">
        <h3 class="settings-section-title">{{ t('settings.sectionInteraction') }}</h3>
        <div class="settings-card">
            <div class="settings-card-row">
                <Label>{{ t('settings.scrollback') }}</Label>
                <Input v-model.number="store.terminal.scrollbackLines" type="number" class="w-44" />
            </div>
            <div class="settings-card-row">
                <Label>{{ t('settings.copyOnSelect') }}</Label>
                <Switch v-model="store.terminal.copyOnSelect" />
            </div>
            <div class="settings-card-row">
                <Label>{{ t('settings.altIsMeta') }}</Label>
                <Switch v-model="store.terminal.altIsMeta" />
            </div>
            <div class="settings-card-row">
                <Label>{{ t('settings.wordSeparator') }}</Label>
                <Input v-model="store.terminal.wordSeparator" class="w-44" />
            </div>
        </div>
    </div>

    <div class="settings-section">
        <h3 class="settings-section-title">{{ t('settings.sectionCompatibility') }}</h3>
        <p class="settings-section-hint">{{ t('settings.middlewareHint') }}</p>
        <div class="settings-card">
            <div class="settings-card-row">
                <Label>{{ t('settings.backspace') }}</Label>
                <Select v-model="store.terminal.backspace" :options="backspaceOptions" class="w-44" />
            </div>
            <div class="settings-card-row">
                <Label>{{ t('settings.inputNewlines') }}</Label>
                <Select v-model="inputNewlinesModel" :options="newlineOptions" class="w-44" />
            </div>
            <div class="settings-card-row">
                <Label>{{ t('settings.outputNewlines') }}</Label>
                <Select v-model="outputNewlinesModel" :options="newlineOptions" class="w-44" />
            </div>
        </div>
    </div>

    <div class="settings-section">
        <h3 class="settings-section-title">{{ t('settings.suggestionsTitle') }}</h3>
        <div class="settings-card">
            <div class="settings-card-row">
                <Label>{{ t('settings.suggestionsEnabled') }}</Label>
                <Switch v-model="store.terminal.suggestions.enabled" />
            </div>
            <div class="settings-card-row">
                <Label>{{ t('settings.suggestionsTrigger') }}</Label>
                <Select v-model="store.terminal.suggestions.trigger" :options="suggestionsTriggerOptions" class="w-44" />
            </div>
            <div class="settings-card-row stacked">
                <div class="settings-row-head">
                    <Label>{{ t('settings.suggestionsDelay') }}</Label>
                    <span class="value-hint">{{ store.terminal.suggestions.delay }}</span>
                </div>
                <Slider v-model="store.terminal.suggestions.delay" :min="100" :max="1000" :step="50" />
            </div>
            <div class="settings-card-row">
                <Label>{{ t('settings.suggestionsSourceHistory') }}</Label>
                <Switch v-model="store.terminal.suggestions.sources.history" />
            </div>
            <div class="settings-card-row">
                <Label>{{ t('settings.suggestionsSourceQuickCommands') }}</Label>
                <Switch v-model="store.terminal.suggestions.sources.quickCommands" />
            </div>
            <div class="settings-card-row">
                <Label>{{ t('settings.suggestionsSourcePaths') }}</Label>
                <Switch v-model="store.terminal.suggestions.sources.paths" />
            </div>
            <div class="settings-card-row">
                <Label>{{ t('settings.suggestionsHistoryLabel') }}</Label>
                <Button variant="outline" size="sm" @click="onClearHistory">{{ t('settings.clear') }}</Button>
            </div>
        </div>
    </div>
    </div>
</template>
