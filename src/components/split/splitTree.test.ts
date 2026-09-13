import { describe, expect, it } from 'vitest'
import {
    findLeaf,
    listLeaves,
    makeBranch,
    makeLeaf,
    neighborLeaf,
    removeLeaf,
    resizeChildren,
    splitLeaf,
} from './splitTree'

describe('split tree', () => {
    it('splits a root leaf into a branch', () => {
        const root = makeLeaf()
        const { tree, newLeafId } = splitLeaf(root, root.id, 'right')!
        expect(tree.type).toBe('branch')
        if (tree.type !== 'branch') {
            return
        }
        expect(tree.orientation).toBe('h')
        expect(tree.children.map(c => c.id)).toEqual([root.id, newLeafId])
        expect(listLeaves(tree).map(l => l.id)).toEqual([root.id, newLeafId])
    })

    it('carries inherited cwd on the new leaf only', () => {
        const root = makeLeaf()
        const { tree, newLeafId } = splitLeaf(root, root.id, 'right', '/tmp')!
        expect(findLeaf(tree, newLeafId)?.cwd).toBe('/tmp')
        expect(findLeaf(tree, root.id)?.cwd).toBeUndefined()
    })

    it('makeLeaf keeps cwd optional', () => {
        expect(makeLeaf().cwd).toBeUndefined()
        expect(makeLeaf('/tmp').cwd).toBe('/tmp')
    })

    it('splits a nested leaf without disturbing siblings', () => {
        const a = makeLeaf()
        const b = makeLeaf()
        const root = makeBranch('h', [a, b])
        const { tree, newLeafId } = splitLeaf(root, b.id, 'down')!
        expect(listLeaves(tree).map(l => l.id)).toEqual([a.id, b.id, newLeafId])
        // b is now wrapped in a vertical branch
        const bBranch = tree.type === 'branch' ? tree.children[1] : null
        expect(bBranch?.type).toBe('branch')
        expect(bBranch && bBranch.type === 'branch' ? bBranch.orientation : null).toBe('v')
    })

    it('removing a leaf prunes single-child branches', () => {
        const a = makeLeaf()
        const b = makeLeaf()
        const root = makeBranch('h', [a, b])
        const { tree, newLeafId } = splitLeaf(root, b.id, 'down')!
        // tree: h[ a, v[ b, new ] ]
        const afterRemove = removeLeaf(tree, newLeafId)!
        // v[ b ] collapses back to b
        expect(listLeaves(afterRemove).map(l => l.id)).toEqual([a.id, b.id])
        expect(afterRemove.type).toBe('branch')
        if (afterRemove.type === 'branch') {
            expect(afterRemove.children[1]!.id).toBe(b.id)
        }
    })

    it('removing the last leaf yields null', () => {
        const root = makeLeaf()
        expect(removeLeaf(root, root.id)).toBeNull()
    })

    it('resize adjusts adjacent shares with a floor', () => {
        const root = makeBranch('h', [makeLeaf(), makeLeaf()])
        const resized = resizeChildren(root, root.id, 0, 3, -5)
        expect(resized.type === 'branch' && resized.ratios[0]).toBe(3)
        expect(resized.type === 'branch' && resized.ratios[1]).toBe(0.1)
    })

    it('finds neighbor leaves in visual order', () => {
        const a = makeLeaf()
        const b = makeLeaf()
        const c = makeLeaf()
        const root = makeBranch('h', [a, makeBranch('v', [b, c])])
        expect(neighborLeaf(root, b.id, 1)!.id).toBe(c.id)
        expect(neighborLeaf(root, a.id, 1)!.id).toBe(b.id)
        expect(neighborLeaf(root, a.id, -1)).toBeNull()
        expect(neighborLeaf(root, c.id, 1)).toBeNull()
    })
})
