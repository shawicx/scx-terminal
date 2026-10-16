/**
 * @description 全局 message 提示（Ant Design message 风格）：模块级单例状态 + 类型化
 *              API（success/error/info/warning），由 MessageHost 组件挂载渲染。
 *              任意组件/服务直接 import message 调用，无需 provide/inject 传递。
 */
import { ref } from 'vue'

/** 提示种类（决定图标与配色） */
export type MessageKind = 'success' | 'error' | 'info' | 'warning'

/** 单条提示（host 渲染单元） */
export interface MessageItem {
    id: number
    kind: MessageKind
    text: string
}

/** 全局提示栈（新提示追加尾部，自然堆叠展示） */
const items = ref<MessageItem[]>([])

/** 自增序号（条目 key 与关闭定位） */
let sequence = 0

/**
 * @description 手动关闭指定条目（host 点击关闭走这里）
 * @param id 条目 id
 * @returns void
 *
 * @example dismiss(id)
 *
 */
function dismiss (id: number): void {
    const index = items.value.findIndex(item => item.id === id)
    if (index !== -1) {
        items.value.splice(index, 1)
    }
}

/**
 * @description 弹出一条全局提示并按 duration 自动关闭（≤0 表示常驻，需点击关闭）
 * @param kind 提示种类
 * @param text 提示文案
 * @param duration 自动关闭毫秒数（默认 3000）
 * @returns number 条目 id（可用于手动关闭）
 *
 * @example show('success', '连接成功')
 *
 */
function show (kind: MessageKind, text: string, duration = 3000): number {
    const id = ++sequence
    items.value.push({ id, kind, text })
    if (duration > 0) {
        window.setTimeout(() => dismiss(id), duration)
    }
    return id
}

/** 类型化 API：供各处以 message.success(...) 等形式调用 */
export const message = {
    /**
     * @description 成功提示
     * @param text 文案
     * @param duration 自动关闭毫秒数
     * @returns number 条目 id
     */
    success: (text: string, duration?: number) => show('success', text, duration),
    /**
     * @description 错误提示
     * @param text 文案
     * @param duration 自动关闭毫秒数
     * @returns number 条目 id
     */
    error: (text: string, duration?: number) => show('error', text, duration),
    /**
     * @description 信息提示
     * @param text 文案
     * @param duration 自动关闭毫秒数
     * @returns number 条目 id
     */
    info: (text: string, duration?: number) => show('info', text, duration),
    /**
     * @description 警告提示
     * @param text 文案
     * @param duration 自动关闭毫秒数
     * @returns number 条目 id
     */
    warning: (text: string, duration?: number) => show('warning', text, duration),
}

/** host 组件专用的状态访问（渲染栈 + 手动关闭） */
export function useMessageItems (): { items: typeof items, dismiss: typeof dismiss } {
    return { items, dismiss }
}
