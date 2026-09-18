<script setup lang="ts">
/**
 * @description 标题栏：窗口拖拽区（macOS 红绿灯占位）、传输/隧道指示器与设置入口；
 *              标签条内嵌（top 模式，见 TabStrip），tabBarPosition=bottom 时标签条
 *              由 App.vue 渲染在内容区下方、此处不渲染标签。
 */
import { computed } from 'vue'
import { ArrowRightLeft, ArrowUpDown, Settings } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { platform } from '@/lib/platform'
import { useTabsStore } from '@/stores/tabs'
import { useConfigStore } from '@/stores/config'
import { useTransfersStore } from '@/stores/transfers'
import { useForwardingStore } from '@/stores/forwarding'
import { toggleTransferCenter } from '@/services/transferCenter'
import TabStrip from '@/components/titlebar/TabStrip.vue'

const { t } = useI18n()
const store = useTabsStore()
const config = useConfigStore()
const transfersStore = useTransfersStore()
const forwardingStore = useForwardingStore()

const needsTrafficLightSpace = computed(() => platform === 'macos')

/** 标签条内嵌于标题栏（top 模式）；bottom 模式由 App.vue 在内容区下方渲染 */
const tabsInline = computed(() => config.store.appearance.tabBarPosition !== 'bottom')
</script>

<template>
    <div class="title-bar">
        <!-- 双击缩放统一交给 Tauri 原生 drag-region 处理（macOS 在 mouseup 调
             internal_toggle_maximize）；自绑 @dblclick 会造成二次 toggle，窗口
             从最大化双击还原时被竞态弹回最大化 -->
        <div
            v-if="needsTrafficLightSpace"
            class="traffic-light-space"
            data-tauri-drag-region
        ></div>

        <TabStrip v-if="tabsInline" />

        <div class="drag-area" data-tauri-drag-region></div>

        <!-- 传输中心指示器：运行数徽标 + 失败红点，点击唤起传输面板 -->
        <button
            class="titlebar-indicator"
            :class="{ visible: transfersStore.transfers.length > 0 }"
            :title="t('transfer.title')"
            @click="toggleTransferCenter()"
        >
            <ArrowUpDown :size="14" />
            <span v-if="transfersStore.activeTransfers.length > 0" class="indicator-badge">
                {{ transfersStore.activeTransfers.length > 99 ? '99+' : transfersStore.activeTransfers.length }}
            </span>
            <span v-else-if="transfersStore.hasFailure" class="indicator-dot"></span>
        </button>

        <!-- 隧道管理器常驻入口（兼运行指示器）：运行数徽标 + 失败红点 -->
        <button
            class="titlebar-indicator"
            :class="{ visible: forwardingStore.states.length > 0 }"
            :title="t('forward.tabTitle')"
            @click="store.openForwardingTab()"
        >
            <ArrowRightLeft :size="14" />
            <span v-if="forwardingStore.activeStates.length > 0" class="indicator-badge">
                {{ forwardingStore.activeStates.length > 99 ? '99+' : forwardingStore.activeStates.length }}
            </span>
            <span v-else-if="forwardingStore.failedStates.length > 0" class="indicator-dot"></span>
        </button>

        <button class="new-tab-button settings-button" :title="t('commands.openSettings')" @click="store.openSettingsTab()">
            <Settings :size="14" />
        </button>
    </div>
</template>

<style scoped>
.title-bar {
    display: flex;
    align-items: stretch;
    height: 38px;
    flex-shrink: 0;
    background: var(--color-card);
    border-bottom: 1px solid var(--color-border);
    user-select: none;
}

.traffic-light-space {
    width: 76px;
    flex-shrink: 0;
}

.drag-area {
    flex: 1;
}

/* 设置按钮的基样式（与 TabStrip 的「+」同款外观） */
.new-tab-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--color-muted-foreground);
    cursor: default;
    transition: background-color 0.25s ease, color 0.25s ease;
}

.new-tab-button:hover {
    background: var(--color-accent);
    color: var(--color-accent-foreground);
}

.settings-button {
    align-self: center;
    margin-right: 8px;
}

/* 标题栏指示器（传输/隧道）：无任务时仍可见但弱化，有任务徽标/红点时高亮 */
.titlebar-indicator {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    align-self: center;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--color-muted-foreground);
    opacity: 0.5;
    cursor: default;
    transition: background-color 0.25s ease, color 0.25s ease, opacity 0.25s ease;
}

.titlebar-indicator.visible {
    opacity: 1;
}

.titlebar-indicator:hover {
    background: var(--color-accent);
    color: var(--color-accent-foreground);
}

.indicator-badge {
    position: absolute;
    top: -2px;
    right: -2px;
    min-width: 14px;
    height: 14px;
    padding: 0 3px;
    border-radius: 7px;
    background: var(--color-primary);
    color: var(--color-primary-foreground);
    font-size: 9px;
    line-height: 14px;
    text-align: center;
    font-variant-numeric: tabular-nums;
}

.indicator-dot {
    position: absolute;
    top: 1px;
    right: 1px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-destructive);
}
</style>
