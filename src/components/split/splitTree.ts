import { nanoid } from 'nanoid'

export type SplitOrientation = 'h' | 'v'

export interface SplitLeaf {
    id: string
    type: 'leaf'
}

export interface SplitBranch {
    id: string
    type: 'branch'
    orientation: SplitOrientation
    /** flex share of each child; only relative values matter */
    ratios: number[]
    children: SplitNode[]
}

export type SplitNode = SplitLeaf | SplitBranch

export function makeLeaf (): SplitLeaf {
    return { id: nanoid(), type: 'leaf' }
}

export function makeBranch (orientation: SplitOrientation, children: SplitNode[]): SplitBranch {
    return {
        id: nanoid(),
        type: 'branch',
        orientation,
        children,
        ratios: children.map(() => 1),
    }
}

/** depth-first list of all leaves, in visual order */
export function listLeaves (node: SplitNode): SplitLeaf[] {
    if (node.type === 'leaf') {
        return [node]
    }
    return node.children.flatMap(listLeaves)
}

export function findLeaf (node: SplitNode, id: string): SplitLeaf | null {
    if (node.type === 'leaf') {
        return node.id === id ? node : null
    }
    for (const child of node.children) {
        const found = findLeaf(child, id)
        if (found) {
            return found
        }
    }
    return null
}

interface ParentRef {
    parent: SplitBranch
    index: number
}

function findParent (node: SplitNode, childId: string): ParentRef | null {
    if (node.type === 'leaf') {
        return null
    }
    for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i]!
        if (child.id === childId) {
            return { parent: node, index: i }
        }
        const found = findParent(child, childId)
        if (found) {
            return found
        }
    }
    return null
}

function cloneTree (node: SplitNode): SplitNode {
    if (node.type === 'leaf') {
        return { ...node }
    }
    return {
        ...node,
        children: node.children.map(cloneTree),
        ratios: [...node.ratios],
    }
}

/**
 * Splits the leaf `leafId` in the given direction by wrapping it into a new
 * branch. Returns a new tree (immutably) and the id of the new leaf.
 */
export function splitLeaf (root: SplitNode, leafId: string, direction: 'right' | 'down'): { tree: SplitNode; newLeafId: string } | null {
    const tree = cloneTree(root)
    const ref = findParent(tree, leafId)
    const newLeaf = makeLeaf()

    const orientation: SplitOrientation = direction === 'right' ? 'h' : 'v'
    if (!ref) {
        // splitting the root leaf: wrap the whole tree
        if (tree.type !== 'leaf' || tree.id !== leafId) {
            return null
        }
        return {
            tree: makeBranch(orientation, [tree, newLeaf]),
            newLeafId: newLeaf.id,
        }
    }

    const target = ref.parent.children[ref.index]!
    const branch = makeBranch(orientation, [target, newLeaf])
    ref.parent.children[ref.index] = branch
    ref.parent.ratios[ref.index] = Math.max(1, ref.parent.ratios[ref.index]!)
    return { tree, newLeafId: newLeaf.id }
}

/**
 * Removes a leaf; prunes branches that end up with a single child (replacing
 * them with that child) or none (dropping them). Returns null when the tree
 * would become empty.
 */
export function removeLeaf (root: SplitNode, leafId: string): SplitNode | null {
    if (root.type === 'leaf') {
        return root.id === leafId ? null : root
    }

    const tree = cloneTree(root)
    const ref = findParent(tree, leafId)
    if (!ref) {
        return tree
    }

    ref.parent.children.splice(ref.index, 1)
    ref.parent.ratios.splice(ref.index, 1)

    if (ref.parent.children.length === 0) {
        return null
    }
    return prune(tree) ?? tree
}

function prune (node: SplitNode): SplitNode | null {
    if (node.type === 'leaf') {
        return node
    }
    const kept: SplitNode[] = []
    const ratios: number[] = []
    for (let i = 0; i < node.children.length; i++) {
        const pruned = prune(node.children[i]!)
        if (pruned) {
            kept.push(pruned)
            ratios.push(node.ratios[i] ?? 1)
        }
    }
    if (kept.length === 0) {
        return null
    }
    if (kept.length === 1) {
        return kept[0]!
    }
    node.children = kept
    node.ratios = ratios
    return node
}

/** Adjusts the flex share of two adjacent children (spanner drag). */
export function resizeChildren (root: SplitNode, branchId: string, index: number, firstShare: number, secondShare: number): SplitNode {
    const tree = cloneTree(root)
    const branch = findBranch(tree, branchId)
    if (!branch || index < 0 || index + 1 >= branch.children.length) {
        return root
    }
    branch.ratios[index] = Math.max(0.1, firstShare)
    branch.ratios[index + 1] = Math.max(0.1, secondShare)
    return tree
}

function findBranch (node: SplitNode, id: string): SplitBranch | null {
    if (node.type === 'leaf') {
        return null
    }
    if (node.id === id) {
        return node
    }
    for (const child of node.children) {
        const found = findBranch(child, id)
        if (found) {
            return found
        }
    }
    return null
}

/** Next/previous leaf in visual order, for keyboard pane navigation. */
export function neighborLeaf (root: SplitNode, currentId: string, delta: 1 | -1): SplitLeaf | null {
    const leaves = listLeaves(root)
    const index = leaves.findIndex(l => l.id === currentId)
    if (index === -1) {
        return null
    }
    return leaves[index + delta] ?? null
}
