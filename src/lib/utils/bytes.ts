/** Byte-level helpers replacing Node's Buffer for the browser/webview. */

export function concatBytes (chunks: Uint8Array[]): Uint8Array {
    let length = 0
    for (const chunk of chunks) {
        length += chunk.length
    }
    const result = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
        result.set(chunk, offset)
        offset += chunk.length
    }
    return result
}

export function indexOfBytes (data: Uint8Array, pattern: Uint8Array, fromIndex: number): number {
    if (pattern.length === 0) {
        return fromIndex
    }
    const limit = data.length - pattern.length
    for (let i = Math.max(0, fromIndex); i <= limit; i++) {
        let matched = true
        for (let j = 0; j < pattern.length; j++) {
            if (data[i + j] !== pattern[j]) {
                matched = false
                break
            }
        }
        if (matched) {
            return i
        }
    }
    return -1
}

export function subarray (data: Uint8Array, start: number, end?: number): Uint8Array {
    return data.subarray(start, end)
}

const utf8Decoder = new TextDecoder('utf-8')

/** Decode with replacement characters for invalid sequences (terminal-tolerant). */
export function decodeUTF8 (data: Uint8Array): string {
    return utf8Decoder.decode(data)
}

const utf8Encoder = new TextEncoder()

export function encodeUTF8 (text: string): Uint8Array {
    return utf8Encoder.encode(text)
}

export function bytesFromBase64 (text: string): Uint8Array {
    const binary = atob(text)
    const result = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
        result[i] = binary.charCodeAt(i)
    }
    return result
}

/** Replaces all occurrences of a byte pattern (e.g. newline conversion). */
export function replaceBytes (data: Uint8Array, from: number[], to: number[]): Uint8Array {
    if (!from.length) {
        return data
    }
    const chunks: Uint8Array[] = []
    let offset = 0
    outer:
    for (let i = 0; i <= data.length - from.length; i++) {
        for (let j = 0; j < from.length; j++) {
            if (data[i + j] !== from[j]) {
                continue outer
            }
        }
        chunks.push(data.subarray(offset, i), new Uint8Array(to))
        offset = i + from.length
        i += from.length - 1
    }
    if (!chunks.length) {
        return data
    }
    chunks.push(data.subarray(offset))
    return concatBytes(chunks)
}
