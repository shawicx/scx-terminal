<!--
  @description 设置·外观页：语言 / 标签栏位置 / 终端背景图（选择·清除·不透明度·
              填充方式）/ 响铃通知。
-->
<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { invoke } from '@tauri-apps/api/core'
import Button from '@/components/ui/Button.vue'
import Label from '@/components/ui/Label.vue'
import Switch from '@/components/ui/Switch.vue'
import Slider from '@/components/ui/Slider.vue'
import Select from '@/components/ui/Select.vue'
import { useConfigStore } from '@/stores/config'
import { backgroundPreviewUrl, setBackgroundImageFile } from '@/services/backgroundImage'

const { t } = useI18n()
const config = useConfigStore()
const store = config.store

const languageOptions = computed(() => [
    { value: 'auto', label: t('settings.languageAuto') },
    { value: 'zh-CN', label: '简体中文' },
    { value: 'en', label: 'English' },
])

const tabBarPositionOptions = computed(() => [
    { value: 'top', label: t('settings.tabBarTop') },
    { value: 'bottom', label: t('settings.tabBarBottom') },
])

const backgroundFitOptions = computed(() => [
    { value: 'cover', label: t('settings.fitCover') },
    { value: 'contain', label: t('settings.fitContain') },
    { value: 'tile', label: t('settings.fitTile') },
])

/**
 * @description 选择本地图片为终端背景：dialog 原生选图 → Rust 校验并复制进
 *              app-data/backgrounds/ → 文件名写配置（App 层 watch 触发应用）
 * @returns Promise<void>
 *
 */
async function chooseBackgroundImage (): Promise<void> {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const picked = await open({
        multiple: false,
        filters: [{ name: t('settings.backgroundImage'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
    })
    if (typeof picked !== 'string') {
        return
    }
    try {
        const name = await invoke<string | null>('background_image_set', { path: picked })
        store.appearance.backgroundImage = name ?? null
        // 同扩展名换图时文件名不变，App.vue 的 watch 因值相等短路不触发，需显式重载新图
        if (name) {
            await setBackgroundImageFile(name)
        }
    } catch (error) {
        console.warn('failed to set background image', error)
    }
}

/**
 * @description 清除终端背景：删 app-data 内图片文件并置空配置
 * @returns Promise<void>
 *
 */
async function clearBackgroundImage (): Promise<void> {
    await invoke('background_image_set', { path: null })
    store.appearance.backgroundImage = null
}
</script>

<template>
    <div class="settings-page">
    <h2>{{ t('settings.appearance') }}</h2>
    <div class="settings-section">
        <div class="settings-card">
            <div class="settings-card-row">
                <Label>{{ t('settings.language') }}</Label>
                <Select v-model="store.appearance.language" :options="languageOptions" class="w-44" />
            </div>
            <div class="settings-card-row">
                <Label>{{ t('settings.tabBarPosition') }}</Label>
                <Select v-model="store.appearance.tabBarPosition" :options="tabBarPositionOptions" class="w-44" />
            </div>
        </div>
    </div>
    <div class="settings-section">
        <div class="settings-card">
            <div class="settings-card-row">
                <Label>{{ t('settings.backgroundImage') }}</Label>
                <div class="background-image-row">
                    <div
                        v-if="backgroundPreviewUrl"
                        class="background-image-preview"
                        :style="{ backgroundImage: `url(${backgroundPreviewUrl})` }"
                    ></div>
                    <Button variant="outline" size="sm" @click="chooseBackgroundImage">
                        {{ t('settings.backgroundImageChoose') }}
                    </Button>
                    <Button
                        v-if="store.appearance.backgroundImage"
                        variant="outline"
                        size="sm"
                        @click="clearBackgroundImage"
                    >
                        {{ t('settings.backgroundImageClear') }}
                    </Button>
                </div>
            </div>
            <div class="settings-card-row stacked">
                <div class="settings-row-head">
                    <Label>{{ t('settings.backgroundImageOpacity') }}</Label>
                    <span class="value-hint">{{ Math.round(store.appearance.backgroundOpacity * 100) }}%</span>
                </div>
                <Slider v-model="store.appearance.backgroundOpacity" :min="0.05" :max="1" :step="0.05" />
            </div>
            <div class="settings-card-row">
                <Label>{{ t('settings.backgroundImageFit') }}</Label>
                <Select v-model="store.appearance.backgroundFit" :options="backgroundFitOptions" class="w-44" />
            </div>
        </div>
    </div>
    <div class="settings-section">
        <h3 class="settings-section-title">{{ t('settings.notifications') }}</h3>
        <div class="settings-card">
            <div class="settings-card-row">
                <Label>{{ t('settings.bellNotifications') }}</Label>
                <Switch v-model="store.appearance.bellNotifications" />
            </div>
        </div>
    </div>
    </div>
</template>

<style scoped>
/* 背景图片行：缩略预览 + 选择/清除按钮 */
.background-image-row {
    display: flex;
    align-items: center;
    gap: 8px;
}

.background-image-preview {
    width: 40px;
    height: 26px;
    border-radius: 4px;
    border: 1px solid var(--color-border);
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
    flex-shrink: 0;
}
</style>
