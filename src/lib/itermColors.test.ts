/**
 * @description iTerm2 .itermcolors 解析器单元测试：正常文件、缺字段回退、非法内容
 */
import { describe, expect, it } from 'vitest'
import { parseItermColorsFile } from './itermColors'

function colorDict (r: number, g: number, b: number): string {
    return `<dict>
        <key>Alpha Component</key><real>1</real>
        <key>Blue Component</key><real>${b}</real>
        <key>Color Space</key><string>sRGB</string>
        <key>Green Component</key><real>${g}</real>
        <key>Red Component</key><real>${r}</real>
    </dict>`
}

function plist (body: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${body}
</dict>
</plist>`
}

const sample = plist(`
    <key>Ansi 0 Color</key>${colorDict(0, 0, 0)}
    <key>Ansi 1 Color</key>${colorDict(1, 0, 0)}
    <key>Background Color</key>${colorDict(0.1, 0.2, 0.3)}
    <key>Foreground Color</key>${colorDict(0.9, 0.9, 0.9)}
    <key>Cursor Color</key>${colorDict(0.5, 0.5, 0.5)}
`)

describe('parseItermColorsFile', () => {
    it('parses ansi colors and special keys from a real-shaped plist', () => {
        const scheme = parseItermColorsFile(sample, 'My Theme')
        expect(scheme.name).toBe('My Theme')
        expect(scheme.colors[0]).toBe('#000000')
        expect(scheme.colors[1]).toBe('#ff0000')
        expect(scheme.background).toBe('#1a334d')
        expect(scheme.foreground).toBe('#e6e6e6')
        expect(scheme.cursor).toBe('#808080')
    })

    it('falls back to defaults for missing entries', () => {
        const scheme = parseItermColorsFile(sample, 'My Theme')
        // 未提供的 Ansi 2..15 回退默认深色值；选区缺省为 undefined（xterm 自行兜底）
        expect(scheme.colors[2]).toBe('#b1e969')
        expect(scheme.selection).toBeUndefined()
        expect(scheme.cursorAccent).toBeUndefined()
    })

    it('clamps out-of-range float components', () => {
        const scheme = parseItermColorsFile(plist(`<key>Background Color</key>${colorDict(2, -1, 0.5)}`), 'Clamped')
        expect(scheme.background).toBe('#ff0080')
    })

    it('rejects non-plist content and files without color entries', () => {
        expect(() => parseItermColorsFile('not xml at all', 'X')).toThrow()
        expect(() => parseItermColorsFile('<dict><key>Foo</key><integer>1</integer></dict>', 'X')).toThrow()
        // 分量缺失的颜色字典被跳过，全部缺失则视为无有效条目
        expect(() => parseItermColorsFile('<dict><key>Background Color</key><dict><key>Red Component</key><real>1</real></dict></dict>', 'X')).toThrow()
    })
})
