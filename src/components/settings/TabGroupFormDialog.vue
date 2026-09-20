<!--
  @description 标签分组表单弹窗（设置页新建/编辑共用）：名称必填输入、7 色可选色点
                （再点已选色取消）、持久化开关；打开时按 editing 预填并聚焦名称框，
                确认经 submit 事件回传字段值，由调用方写回 store。
-->
<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@/components/ui/Button.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Switch from '@/components/ui/Switch.vue'
import type { TabGroup } from '@/stores/config'
import { TAB_COLORS } from '@/lib/tabColors'

const props = defineProps<{
    /** 弹窗开合（v-model:open） */
    open: boolean
    /** 编辑中的分组；null = 新建 */
    editing: TabGroup | null
    /** 弹窗标题（调用方按新建/编辑传文案） */
    title: string
}>()

const emit = defineEmits<{
    (e: 'update:open', open: boolean): void
    (e: 'submit', value: { name: string, color: string | undefined, persistTabs: boolean }): void
}>()

const { t } = useI18n()

const form = ref({
    name: '',
    color: undefined as string | undefined,
    persistTabs: false,
})

/** 打开时按 editing 载入草稿并聚焦名称框 */
watch(() => props.open, open => {
    if (!open) {
        return
    }
    form.value = {
        name: props.editing?.name ?? '',
        color: props.editing?.color,
        persistTabs: props.editing?.persistTabs ?? false,
    }
    void nextTick(() => nameInputEl.value?.$el?.focus())
})

/** 名称输入框组件（单根透传，经 $el 取原生元素聚焦） */
const nameInputEl = ref<{ $el: HTMLInputElement } | null>(null)

function cancel (): void {
    emit('update:open', false)
}

/**
 * @description 提交表单：名称去空白后非空才回传（确认按钮同步禁用，此处兜底）
 * @returns void
 *
 */
function commit (): void {
    const name = form.value.name.trim()
    if (!name) {
        return
    }
    emit('update:open', false)
    emit('submit', { name, color: form.value.color, persistTabs: form.value.persistTabs })
}
</script>

<template>
    <Dialog v-if="props.open" :title="props.title" :width="400" @cancel="cancel">
        <div class="tab-group-form">
            <div class="form-row">
                <Label>{{ t('settings.groupNameLabel') }}</Label>
                <Input
                    ref="nameInputEl"
                    v-model="form.name"
                    class="flex-1"
                    @keydown.enter.prevent="commit"
                />
            </div>
            <div class="form-row">
                <Label>{{ t('settings.tabGroupColor') }}</Label>
                <span class="color-options">
                    <button
                        v-for="item in TAB_COLORS"
                        :key="item.color"
                        class="color-dot"
                        :class="{ selected: form.color === item.color }"
                        :style="{ background: item.color }"
                        :title="t(`tab.colorNames.${item.name}`)"
                        @click="form.color = form.color === item.color ? undefined : item.color"
                    ></button>
                </span>
            </div>
            <div class="form-row">
                <Label>{{ t('settings.tabGroupsPersist') }}</Label>
                <Switch v-model="form.persistTabs" />
            </div>
        </div>
        <template #footer>
            <Button variant="outline" size="sm" @click="cancel">{{ t('settings.cancel') }}</Button>
            <Button size="sm" :disabled="!form.name.trim()" @click="commit">{{ t('settings.confirm') }}</Button>
        </template>
    </Dialog>
</template>

<style scoped>
.tab-group-form {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.form-row {
    display: flex;
    align-items: center;
    gap: 12px;
}

.form-row > :first-child {
    width: 96px;
    flex-shrink: 0;
    text-align: right;
}

.color-options {
    display: inline-flex;
    align-items: center;
    gap: 8px;
}

.color-dot {
    width: 14px;
    height: 14px;
    padding: 0;
    border: none;
    border-radius: 50%;
    flex-shrink: 0;
    cursor: default;
    transition: box-shadow 0.2s ease, transform 0.2s ease;
}

.color-dot:hover {
    transform: scale(1.15);
}

.color-dot.selected {
    box-shadow: 0 0 0 2px var(--color-background), 0 0 0 4px var(--color-foreground);
}
</style>
