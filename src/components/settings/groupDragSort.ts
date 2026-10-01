/**
 * @description 分组指针拖拽的纯计算工具：从指针命中的元素反查分组头，
 *              供 Tauri 场景替代会被原生文件拖放拦截的 HTML5 Drag & Drop。
 */

/** 参与命中反查的分组分段结构 */
export interface SortableGroupSection {
    key: string
    sortable?: boolean
}

/**
 * @description 按指针坐标反查命中的可排序分组：优先取 elementsFromPoint 顺序中
 *              最近的 `[data-group-key]` 头，虚拟/不可排序段返回 null
 * @param sections 全部分组分段
 * @param clientX 指针 X 坐标
 * @param clientY 指针 Y 坐标
 * @param elementsFromPoint 浏览器命中测试函数（注入便于纯函数测试）
 * @returns SortableGroupSection | null 命中的可排序分段；无命中或不可排序返回 null
 *
 * @example findSortableGroupAtPoint(sections, event.clientX, event.clientY, (x, y) => document.elementsFromPoint(x, y))
 *
 */
export function findSortableGroupAtPoint<T extends SortableGroupSection> (
    sections: T[],
    clientX: number,
    clientY: number,
    elementsFromPoint: (x: number, y: number) => Element[],
): T | null {
    for (const element of elementsFromPoint(clientX, clientY)) {
        const groupKey = element.closest<HTMLElement>('[data-group-key]')?.dataset.groupKey
        if (!groupKey) {
            continue
        }
        const section = sections.find(item => item.key === groupKey)
        return section?.sortable ? section : null
    }
    return null
}

/**
 * @description 按几何距离回退命中最近的分组头：指针落在组头之间空隙时也能排序；
 *              最近头不可排序（如默认/未分组）时返回 null
 * @param sections 全部分组分段
 * @param headers 当前渲染的分组头中心点
 * @param clientX 指针 X 坐标
 * @param clientY 指针 Y 坐标
 * @returns SortableGroupSection | null 最近的可排序分段；最近头不可排序返回 null
 *
 * @example findNearestSortableGroup(sections, [{ key: 'g1', x: 100, y: 120 }], 90, 150)
 *
 */
export function findNearestSortableGroup<T extends SortableGroupSection> (
    sections: T[],
    headers: Array<{ key: string, x: number, y: number }>,
    clientX: number,
    clientY: number,
): T | null {
    let nearest: { section: T, distance: number } | null = null
    for (const header of headers) {
        const section = sections.find(item => item.key === header.key)
        if (!section) {
            continue
        }
        const distance = Math.hypot(header.x - clientX, header.y - clientY)
        if (!nearest || distance < nearest.distance) {
            nearest = { section, distance }
        }
    }
    return nearest?.section.sortable ? nearest.section : null
}
