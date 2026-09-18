<!--
  @description SSH 凭据挑战对话框（kbd-interactive 与合成密码请求共用）：按服务器
                prompts 动态渲染输入框——label 为服务器原文提示语（不翻译），
                echo=false 渲染密码框（不回显）、echo=true 渲染明文；name 作为说明块
                标题、instructions 以 pre-line 显示多行原文；单一密码型挑战显示
                「记住密码」勾选（默认勾选）。双入口共用：TerminalPane 与 App 全局。
-->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Dialog from '@/components/ui/Dialog.vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import type { KbdChallenge } from '@/services/ssh'

const props = defineProps<{
    challenge: KbdChallenge
}>()

const emit = defineEmits<{
    (e: 'submit', responses: string[], remember: boolean): void
    (e: 'cancel'): void
}>()

const { t } = useI18n()
const answers = ref<string[]>(props.challenge.prompts.map(() => ''))
const remember = ref(true)
const fieldsEl = ref<HTMLElement>()

/** 单一密码型挑战才显示「记住密码」（多因素/验证码/明文问题永不显示、永不回存） */
const showRemember = computed(() =>
    props.challenge.prompts.length === 1 && !props.challenge.prompts[0].echo)

/**
 * @description 回车行为：最后一个 prompt 的输入框直接提交；中间框回车聚焦下一个输入框
 *              （多因素场景防止以空后续应答提前提交消耗一轮挑战）
 * @param index 当前输入框下标
 * @returns void
 */
function onEnter (index: number): void {
    if (index === props.challenge.prompts.length - 1) {
        submit()
        return
    }
    fieldsEl.value?.querySelectorAll<HTMLInputElement>('input[type="password"], input[type="text"]')[index + 1]?.focus()
}

/**
 * @description 提交应答（不拦截空输入：部分服务器用空回复推进信息轮）
 * @returns void
 */
function submit (): void {
    emit('submit', [...answers.value], remember.value)
}

// 弹窗出现即聚焦首个输入框（经祖先元素查询，Input 未暴露 focus）
onMounted(() => {
    void nextTick(() => fieldsEl.value?.querySelector('input')?.focus())
})
</script>

<template>
    <Dialog :title="t('ssh.kbdTitle')" :width="400" @cancel="emit('cancel')">
        <p v-if="props.challenge.name" class="kbd-name">{{ props.challenge.name }}</p>
        <p v-if="props.challenge.instructions" class="kbd-instructions">{{ props.challenge.instructions }}</p>
        <div ref="fieldsEl" class="kbd-fields">
            <div v-for="(prompt, index) in props.challenge.prompts" :key="index" class="kbd-field">
                <label class="kbd-label" :for="`kbd-input-${index}`">{{ prompt.prompt.trimEnd() }}</label>
                <Input
                    :id="`kbd-input-${index}`"
                    v-model="answers[index]"
                    :type="prompt.echo ? 'text' : 'password'"
                    autocomplete="off"
                    @keydown.enter="onEnter(index)"
                />
            </div>
        </div>
        <label v-if="showRemember" class="kbd-remember">
            <input v-model="remember" type="checkbox" class="kbd-checkbox" />
            {{ t('ssh.kbdRemember') }}
        </label>
        <template #footer>
            <Button variant="outline" size="sm" @click="emit('cancel')">{{ t('ssh.kbdCancel') }}</Button>
            <Button size="sm" @click="submit">{{ t('ssh.kbdSubmit') }}</Button>
        </template>
    </Dialog>
</template>

<style scoped>
.kbd-name {
    margin: 0 0 6px;
    font-weight: 600;
}

.kbd-instructions {
    margin: 0 0 10px;
    color: var(--color-muted-foreground);
    white-space: pre-line;
}

.kbd-field {
    margin-bottom: 10px;
}

.kbd-label {
    display: block;
    margin-bottom: 4px;
    font-size: 12px;
    color: var(--color-muted-foreground);
}

.kbd-remember {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
    font-size: 12px;
    color: var(--color-muted-foreground);
    cursor: pointer;
    user-select: none;
}

.kbd-checkbox {
    accent-color: var(--color-primary, currentColor);
}
</style>
