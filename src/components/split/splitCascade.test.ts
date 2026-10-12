/**
 * @description 分屏级联回归测试：嵌套分屏时目标窗格组件会被卸载重建，修复前的
 *              TerminalPane 在卸载时 emit('closed') 会触发 closePane 把刚分好的树
 *              剪掉（新窗格闪现后消失，永远无法超过 2 栏）。本测试固定该行为：
 *              连续分屏后窗格数必须递增且保持。
 */
// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'

// 模拟 TerminalPane：存活期间会话自然退出（点击模拟）emit('closed') → closePane；
// 分屏换位导致的卸载不发 closed（真实组件由 TerminalPane 的 disposed 守卫保证）
vi.mock('@/components/terminal/TerminalPane.vue', () => ({
    default: defineComponent({
        emits: ['requestSplit', 'closed', 'title', 'bell'],
        setup (_, { emit }) {
            return () => h('div', {
                class: 'mock-pane',
                onClick: () => emit('closed'),
            })
        },
    }),
}))

import SplitContainer from './SplitContainer.vue'
import {
    listLeaves,
    makeLeaf,
    splitLeaf,
    removeLeaf,
    type SplitNode,
} from './splitTree'

const profile = { id: 'p1', type: 'local' } as never

/** 复刻 TerminalTabContent 接线的测试宿主 */
const Harness = defineComponent({
    setup (_, { expose }) {
        const tree = ref<SplitNode>(makeLeaf())
        const activeLeafId = ref(listLeaves(tree.value)[0]!.id)

        function closePane (id: string) {
            if (tree.value.type === 'leaf') {
                return
            }
            const updated = removeLeaf(tree.value, id)
            if (updated) {
                tree.value = updated
                activeLeafId.value = listLeaves(updated)[0]!.id
            }
        }

        function split (direction: 'right' | 'down', leafId?: string) {
            const source = leafId ?? activeLeafId.value
            const result = splitLeaf(tree.value, source, direction)
            if (result) {
                tree.value = result.tree
                activeLeafId.value = result.newLeafId
            }
        }

        expose({ split, leafCount: () => listLeaves(tree.value).length })
        return () => h(SplitContainer, {
            node: tree.value,
            activeLeafId: activeLeafId.value,
            tabActive: true,
            profile,
            onLeafActivated: (id: string) => (activeLeafId.value = id),
            onPaneClosed: closePane,
            onLeafSplit: (id: string, direction: 'right' | 'down') => split(direction, id),
        })
    },
})

describe('nested split cascade', () => {
    async function mountHarness () {
        const host = document.createElement('div')
        document.body.appendChild(host)
        const app = createApp(Harness)
        const instance = app.mount(host) as unknown as { split: Function, leafCount: () => number }
        return { app, instance }
    }

    it('keeps 3 panes after a nested split', async () => {
        const { app, instance } = await mountHarness()

        instance.split('right')
        await nextTick()
        expect(instance.leafCount()).toBe(2)

        instance.split('down') // 对活动叶（嵌套叶）再分
        await nextTick()
        await nextTick()
        expect(instance.leafCount()).toBe(3)

        app.unmount()
    })

    it('keeps 4 panes across repeated alternating splits', async () => {
        const { app, instance } = await mountHarness()

        instance.split('right')
        await nextTick()
        instance.split('down')
        await nextTick()
        instance.split('right')
        await nextTick()
        await nextTick()
        expect(instance.leafCount()).toBe(4)

        app.unmount()
    })

    it('closes a single pane when its session exits naturally', async () => {
        const { app, instance } = await mountHarness()

        instance.split('right')
        await nextTick()
        instance.split('down')
        await nextTick()
        expect(instance.leafCount()).toBe(3)

        // 模拟某个窗格 shell 自然退出（存活窗格 emit closed）
        host_click_pane(0)
        await nextTick()
        await nextTick()
        expect(instance.leafCount()).toBe(2)

        app.unmount()
    })

    /** 点击第 index 个窗格（触发 stub 的 closed） */
    function host_click_pane (index: number) {
        const panes = document.querySelectorAll('.mock-pane')
        ;(panes[index] as HTMLElement).click()
    }
})
