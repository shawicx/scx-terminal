/**
 * @description 自定义 CSS 注入器：把 appearance.customCss 维护到唯一的
 *              <style id="app-custom-css"> 节点（空白内容移除节点），供外观
 *              设置实时预览与应用启动恢复。textContent 赋值不经 HTML 解析。
 */

const STYLE_ID = 'app-custom-css'

/**
 * @description 应用（或清除）自定义 CSS：内容为空白时移除注入节点
 * @param css 自定义样式文本
 * @returns void
 *
 * @example applyCustomCss('.tab-bar { font-size: 12px }')
 *
 */
export function applyCustomCss (css: string): void {
    let element = document.getElementById(STYLE_ID) as HTMLStyleElement | null
    if (!css.trim()) {
        element?.remove()
        return
    }
    if (!element) {
        element = document.createElement('style')
        element.id = STYLE_ID
        document.head.appendChild(element)
    }
    element.textContent = css
}
