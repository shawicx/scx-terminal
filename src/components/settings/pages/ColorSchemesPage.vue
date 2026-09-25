<!--
  @description 设置·自定义配色页：配色选择器 + 自定义配色编辑（iTerm2 导入、
              特殊槽位与 16 色 ANSI 槽位取色/HEX 输入、实时预览）。
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, Trash2, Upload } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import ColorSchemePicker from '@/components/settings/ColorSchemePicker.vue'
import { useConfigStore } from '@/stores/config'
import { defaultDarkColorScheme, type TerminalColorScheme } from '@/lib/colorSchemes'
import { parseItermColorsFile } from '@/lib/itermColors'
import { confirmAction } from '@/components/settings/useConfirmAction'

const { t } = useI18n()
const config = useConfigStore()
const store = config.store

type SchemeColorKey = 'foreground' | 'background' | 'cursor' | 'cursorAccent' | 'selection' | 'selectionForeground'

const customSchemes = computed(() => store.colorSchemes)
const selectedCustomIndex = ref(0)
const selectedCustom = computed<TerminalColorScheme | null>(() => customSchemes.value[selectedCustomIndex.value] ?? null)
const importError = ref('')

const specialSlots = computed<{ key: SchemeColorKey, label: string }[]>(() => [
    { key: 'foreground', label: t('settings.schemeColorForeground') },
    { key: 'background', label: t('settings.schemeColorBackground') },
    { key: 'cursor', label: t('settings.schemeColorCursor') },
    { key: 'cursorAccent', label: t('settings.schemeColorCursorAccent') },
    { key: 'selection', label: t('settings.schemeColorSelection') },
    { key: 'selectionForeground', label: t('settings.schemeColorSelectionForeground') },
])

/** 16 个 ANSI 槽位的 i18n key（黑红绿黄蓝洋红青白 × 常规/亮色） */
const ANSI_COLOR_KEYS = [
    'colorBlack', 'colorRed', 'colorGreen', 'colorYellow', 'colorBlue', 'colorMagenta', 'colorCyan', 'colorWhite',
    'colorBrightBlack', 'colorBrightRed', 'colorBrightGreen', 'colorBrightYellow', 'colorBrightBlue', 'colorBrightMagenta', 'colorBrightCyan', 'colorBrightWhite',
] as const

const ansiSlots = computed(() => ANSI_COLOR_KEYS.map((key, index) => ({
    key: index,
    label: t(`settings.${key}`),
})))

/**
 * @description 读取槽位颜色（可缺省字段回退前景色以便 color input 显示）
 * @param scheme 配色对象
 * @param key 槽位键
 * @returns string #rrggbb 形式颜色
 *
 */
function schemeSlotColor (scheme: TerminalColorScheme, key: SchemeColorKey): string {
    return (scheme[key] ?? scheme.foreground).slice(0, 7)
}

/**
 * @description 写入槽位颜色；若现有值带 alpha 后缀（#rrggbbaa）则保留
 * @param scheme 配色对象
 * @param key 槽位键
 * @param hex #rrggbb 颜色
 * @returns void
 *
 */
function setSchemeSlotColor (scheme: TerminalColorScheme, key: SchemeColorKey, hex: string): void {
    const current = scheme[key] ?? ''
    const alpha = current.length === 9 ? current.slice(7) : ''
    scheme[key] = `${hex}${alpha}`
}

/**
 * @description 以名称写入槽位颜色（hex 文本输入），非法值忽略
 * @param scheme 配色对象
 * @param key 槽位键
 * @param text 用户输入的 hex 文本
 * @returns void
 *
 */
function setSchemeSlotColorText (scheme: TerminalColorScheme, key: SchemeColorKey, text: string): void {
    const value = text.trim().toLowerCase()
    if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(value)) {
        scheme[key] = value
    }
}

/**
 * @description 以文本写入 16 色 ANSI 槽位（hex 文本输入），非法值忽略
 * @param scheme 配色对象
 * @param index ANSI 槽位下标（0-15）
 * @param text 用户输入的 hex 文本
 * @returns void
 *
 */
function setAnsiColorText (scheme: TerminalColorScheme, index: number, text: string): void {
    const value = text.trim().toLowerCase()
    if (/^#[0-9a-f]{6}$/.test(value)) {
        scheme.colors[index] = value
    }
}

/**
 * @description 新建自定义配色（克隆 Tabby Default）并进入编辑
 * @returns void
 *
 */
function newCustomScheme (): void {
    const base = toRawScheme(defaultDarkColorScheme)
    base.name = `${t('settings.customSchemes')} ${customSchemes.value.length + 1}`
    store.colorSchemes.push(base)
    selectedCustomIndex.value = store.colorSchemes.length - 1
}

/**
 * @description 深拷贝配色对象（structuredClone 需要纯对象，去掉响应式代理）
 * @param scheme 源配色
 * @returns TerminalColorScheme 拷贝
 *
 */
function toRawScheme (scheme: TerminalColorScheme): TerminalColorScheme {
    return JSON.parse(JSON.stringify(scheme)) as TerminalColorScheme
}

/**
 * @description 删除自定义配色并收敛选中索引
 * @param index 列表索引
 * @returns void
 *
 */
function deleteCustomScheme (index: number): void {
    store.colorSchemes.splice(index, 1)
    if (selectedCustomIndex.value >= store.colorSchemes.length) {
        selectedCustomIndex.value = Math.max(store.colorSchemes.length - 1, 0)
    }
}

/**
 * @description 删除自定义配色（经确认弹窗）
 * @param name 配色名称
 * @param index 自定义配色列表索引
 * @returns void
 *
 */
function confirmDeleteCustomScheme (name: string, index: number): void {
    confirmAction(t('settings.deleteConfirmBody', { name }), () => deleteCustomScheme(index))
}

/**
 * @description 处理 iTerm2 配色文件选择：解析后加入自定义配色并选中
 * @param event 文件 input 的 change 事件
 * @returns void
 *
 */
function onImportFile (event: Event): void {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) {
        return
    }
    void file.text().then(text => {
        const name = file.name.replace(/\.itermcolors$/i, '')
        const scheme = parseItermColorsFile(text, name)
        importError.value = ''
        store.colorSchemes.push(scheme)
        selectedCustomIndex.value = store.colorSchemes.length - 1
    }).catch(() => {
        importError.value = t('settings.importFailed')
    })
}
</script>

<template>
    <div class="settings-page">
    <h2>{{ t('settings.colorSchemesPage') }}</h2>
    <ColorSchemePicker v-model="store.appearance.colorScheme" :custom-schemes="store.colorSchemes" />
    <div class="settings-section">
        <div class="settings-section-head">
            <h3 class="settings-section-title">{{ t('settings.customSchemes') }}</h3>
            <div class="settings-section-actions">
                <Button variant="outline" size="sm" @click="newCustomScheme">
                    <Plus :size="14" />
                    {{ t('settings.customSchemeNew') }}
                </Button>
                <label class="import-label">
                    <span class="import-trigger">
                        <Upload :size="14" />
                        {{ t('settings.customSchemeImport') }}
                    </span>
                    <input type="file" accept=".itermcolors" hidden @change="onImportFile" />
                </label>
            </div>
        </div>
        <p v-if="importError" class="import-error">{{ importError }}</p>
        <p v-if="customSchemes.length === 0" class="hint">{{ t('settings.customSchemeEmpty') }}</p>
        <template v-else>
            <div class="custom-scheme-chips">
                <button
                    v-for="(scheme, index) in customSchemes"
                    :key="index"
                    class="custom-scheme-chip"
                    :class="{ active: index === selectedCustomIndex }"
                    @click="selectedCustomIndex = index"
                >
                    {{ scheme.name }}
                </button>
            </div>
            <div v-if="selectedCustom" class="settings-card">
                <div class="settings-card-row">
                    <Label>{{ t('settings.profileName') }}</Label>
                    <Input v-model="selectedCustom.name" class="w-60" />
                </div>
                <div class="settings-card-row stacked">
                    <Label>{{ t('settings.schemePreviewLabel') }}</Label>
                    <div
                        class="scheme-preview"
                        :style="{
                            background: selectedCustom.background,
                            color: selectedCustom.foreground,
                            borderColor: selectedCustom.cursor,
                        }"
                    >
                        <span>AaBb 命令输出 <b>bold</b> <i>italic</i> → $</span>
                        <span class="scheme-preview-colors">
                            <span
                                v-for="(color, index) in selectedCustom.colors"
                                :key="index"
                                class="scheme-preview-swatch"
                                :style="{ background: color }"
                            ></span>
                        </span>
                    </div>
                </div>
                <div class="settings-card-row stacked">
                    <Label>{{ t('settings.schemeSlotsLabel') }}</Label>
                    <div class="scheme-slots">
                        <div v-for="slot in specialSlots" :key="slot.key" class="scheme-slot">
                            <Label class="scheme-slot-label">{{ slot.label }}</Label>
                            <input
                                type="color"
                                class="scheme-color-input"
                                :value="schemeSlotColor(selectedCustom, slot.key)"
                                @input="setSchemeSlotColor(selectedCustom, slot.key, ($event.target as HTMLInputElement).value)"
                            />
                            <input
                                class="scheme-hex-input"
                                :value="selectedCustom[slot.key] ?? ''"
                                @change="setSchemeSlotColorText(selectedCustom, slot.key, ($event.target as HTMLInputElement).value)"
                            />
                        </div>
                        <div v-for="slot in ansiSlots" :key="`ansi-${slot.key}`" class="scheme-slot">
                            <Label class="scheme-slot-label">{{ slot.label }}</Label>
                            <input
                                type="color"
                                class="scheme-color-input"
                                :value="selectedCustom.colors[slot.key]!"
                                @input="selectedCustom.colors[slot.key] = ($event.target as HTMLInputElement).value"
                            />
                            <input
                                class="scheme-hex-input"
                                :value="selectedCustom.colors[slot.key]!"
                                @change="setAnsiColorText(selectedCustom, slot.key, ($event.target as HTMLInputElement).value)"
                            />
                        </div>
                    </div>
                </div>
                <div class="settings-card-row actions">
                    <Button variant="destructive-outline" size="sm" @click="confirmDeleteCustomScheme(selectedCustom.name, selectedCustomIndex)">
                        <Trash2 :size="14" />
                        {{ t('settings.customSchemeDelete') }}
                    </Button>
                </div>
            </div>
        </template>
    </div>
    </div>
</template>

<style scoped>
.custom-scheme-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 12px;
}

.custom-scheme-chip {
    padding: 3px 10px;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    background: transparent;
    color: var(--color-muted-foreground);
    font-size: 12px;
    cursor: pointer;
    transition: color 0.25s ease, border-color 0.25s ease, background-color 0.25s ease;
}

.custom-scheme-chip:hover {
    color: var(--color-foreground);
    border-color: var(--color-ring);
}

.custom-scheme-chip.active {
    background: var(--color-accent);
    border-color: var(--color-ring);
    color: var(--color-foreground);
}

.scheme-preview {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    font-family: var(--font-mono);
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
}

.scheme-preview-colors {
    display: inline-flex;
    gap: 3px;
}

.scheme-preview-swatch {
    width: 14px;
    height: 14px;
    border-radius: 3px;
    border: 1px solid var(--color-border);
}

.scheme-slots {
    display: grid;
    grid-template-columns: repeat(2, minmax(220px, 1fr));
    gap: 6px 16px;
}

.scheme-slot {
    display: flex;
    align-items: center;
    gap: 8px;
}

.scheme-slot-label {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.scheme-color-input {
    width: 28px;
    height: 22px;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    background: transparent;
    cursor: pointer;
}

.scheme-hex-input {
    width: 84px;
    height: 22px;
    padding: 0 6px;
    border: 1px solid var(--color-input);
    border-radius: 4px;
    background: transparent;
    color: var(--color-foreground);
    font-family: var(--font-mono);
    font-size: 12px;
    outline: none;
}
</style>
