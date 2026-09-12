/**
 * Lightweight fuzzy matcher (subsequence scoring, in the spirit of
 * Tabby's selector): higher score = better match, null = no match.
 */
export function fuzzyMatch (query: string, target: string): number | null {
    if (!query) {
        return 0
    }
    const q = query.toLowerCase()
    const t = target.toLowerCase()

    let score = 0
    let targetIndex = 0
    let previousMatch = -2

    for (const char of q) {
        const found = t.indexOf(char, targetIndex)
        if (found === -1) {
            return null
        }
        // bonus for consecutive characters and word boundaries
        if (found === previousMatch + 1) {
            score += 5
        }
        if (found === 0 || /[\s\-_/]/.test(t[found - 1] ?? '')) {
            score += 8
        }
        score += 1
        previousMatch = found
        targetIndex = found + 1
    }

    // prefer shorter targets
    score -= t.length * 0.1
    return score
}
