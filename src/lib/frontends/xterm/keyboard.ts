/**
 * @description xterm 键盘事件处理链：备用屏方向键透传、Ctrl-//Ctrl-@ 显式编码、
 *              热键状态机喂入与 Linux IME 放行（原 XTermFrontend 构造器内的闭包）。
 */
import { encodeUTF8 } from '@/lib/utils/bytes'
import { isIMETextKey } from './support'

/** 热键状态机接口（结构兼容 services/hotkeys 的 HotkeysManager） */
interface HotkeyTarget {
    pushKeyEvent (name: 'keydown' | 'keyup', event: KeyboardEvent): void
    matchActiveHotkey (state: boolean): unknown
}

/** keyboardEventHandler 的依赖集（由前端实例注入，保持纯函数可测） */
export interface KeyboardHandlerDeps {
    isAlternateScreenActive (): boolean
    /** 输入字节流出口 */
    input: { next: (bytes: Uint8Array) => void }
    hotkeys: HotkeyTarget | undefined
}

/**
 * @description 构造键盘事件处理器：返回 true = xterm 继续默认处理，false = 已消费拦截
 * @param deps 前端依赖（备用屏态/输入流/热键表）
 * @returns (name: 'keydown'|'keyup', event: KeyboardEvent) => boolean
 *
 */
export function createKeyboardEventHandler (deps: KeyboardHandlerDeps) {
    return (name: string, event: KeyboardEvent): boolean => {
        if (deps.isAlternateScreenActive()) {
            let modifiers = 0
            modifiers += event.ctrlKey ? 1 : 0
            modifiers += event.altKey ? 1 : 0
            modifiers += event.shiftKey ? 1 : 0
            modifiers += event.metaKey ? 1 : 0
            if (event.key.startsWith('Arrow') && modifiers === 1) {
                return true
            }
        }

        // Ctrl-/
        if (event.type === 'keydown' && event.key === '/' && event.ctrlKey) {
            deps.input.next(encodeUTF8('\u001f'))
            return false
        }

        // Ctrl-@
        if (event.type === 'keydown' && event.key === '@' && event.ctrlKey) {
            deps.input.next(encodeUTF8('\u0000'))
            return false
        }

        const hotkeys = deps.hotkeys
        if (hotkeys) {
            hotkeys.pushKeyEvent(name as 'keydown' | 'keyup', event)
            let ret = true
            if (hotkeys.matchActiveHotkey(true) !== null) {
                event.stopPropagation()
                event.preventDefault()
                ret = false
            }
            return ret
        }
        return true
    }
}

/** createKeyGate 的依赖集 */
export interface KeyGateDeps {
    platform: string
    handle: (name: string, event: KeyboardEvent) => boolean
}

/**
 * @description xterm attachCustomKeyEventHandler 的门函数：粘贴归应用层、Meta+方向键
 *              放行 macOS 桌面、keypress 不进热键状态机（WKWebView 会补发 meta keypress，
 *              二次喂入会重复匹配 ⌘T）、Linux IME 标点键放行
 * @param deps 平台与底层键盘处理链
 * @returns (event: KeyboardEvent) => boolean
 *
 */
export function createKeyGate (deps: KeyGateDeps) {
    return (event: KeyboardEvent): boolean => {
        // let the app-level paste handling own Cmd/Ctrl+V
        if (
            event.getModifierState('Meta') && event.key.toLowerCase() === 'v' ||
            event.key === 'Insert' && event.shiftKey
        ) {
            event.preventDefault()
            return false
        }
        if (event.getModifierState('Meta') && event.key.startsWith('Arrow')) {
            return false
        }

        // xterm 对 keydown、keyup、keypress 都会回调本 handler。keypress 不得进热键
        // 状态机：部分 WKWebView 环境（如 CI 构建的发布包）会对 ⌘ 组合键在 keydown
        // 之外补发 keypress，若被当作 keydown 二次喂入，会与刚被 macOS 合成 keyup
        // 清空的状态机再次匹配出同一热键（⌘T 一次按键开出两个标签）。xterm 对带
        // meta 的 keypress 本就不产生输入，直接放行即可
        if (event.type === 'keypress') {
            return true
        }

        // 必须透传真实事件类型，否则 keyup 被当作 keydown 二次喂入热键机会重复匹配
        const handled = deps.handle(event.type === 'keyup' ? 'keyup' : 'keydown', event)
        if (!handled) {
            return false
        }

        if (deps.platform === 'linux' && isIMETextKey(event)) {
            return false
        }

        return handled
    }
}
