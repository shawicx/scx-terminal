/**
 * @description 背景图片应用服务单测：mock invoke 与 URL/document（node 环境），
 *              断言 CSS 变量写入、objectURL 替换 revoke、读失败降级。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'
import { backgroundPreviewUrl, setBackgroundFit, setBackgroundImageFile } from './backgroundImage'

const mockInvoke = vi.mocked(invoke)

/** CSS 变量记录（假 document.documentElement.style） */
const cssVars = new Map<string, string>()
/** 已 revoke 的 objectURL 记录 */
const revokedUrls: string[] = []

beforeEach(async () => {
    mockInvoke.mockReset()
    cssVars.clear()
    revokedUrls.length = 0
    vi.stubGlobal('document', {
        documentElement: { style: { setProperty: (name: string, value: string) => cssVars.set(name, value) } },
    })
    let seq = 0
    URL.createObjectURL = vi.fn(() => `blob:mock-${++seq}`)
    URL.revokeObjectURL = vi.fn((url: string) => { revokedUrls.push(url) })
    // 清上一测试遗留的模块级 objectURL（其 revoke 记录随后一并丢弃）
    await setBackgroundImageFile(null)
    revokedUrls.length = 0
})

describe('setBackgroundImageFile', () => {
    it('clears the css var and preview for null without invoking', async () => {
        await setBackgroundImageFile(null)
        expect(mockInvoke).not.toHaveBeenCalled()
        expect(cssVars.get('--term-bg-image')).toBe('none')
        expect(backgroundPreviewUrl.value).toBeNull()
    })

    it('loads bytes, creates an object url and writes the css var', async () => {
        mockInvoke.mockResolvedValue([1, 2, 3, 4])
        await setBackgroundImageFile('background.png')
        expect(mockInvoke).toHaveBeenCalledWith('background_image_load')
        expect(cssVars.get('--term-bg-image')).toBe('url(blob:mock-1)')
        expect(backgroundPreviewUrl.value).toBe('blob:mock-1')
    })

    it('revokes the previous object url when replaced', async () => {
        mockInvoke.mockResolvedValue([1])
        await setBackgroundImageFile('background.png')
        await setBackgroundImageFile('background.png')
        expect(revokedUrls).toEqual(['blob:mock-1'])
        expect(cssVars.get('--term-bg-image')).toBe('url(blob:mock-2)')
    })

    it('falls back to none when the file is missing (load returns null)', async () => {
        mockInvoke.mockResolvedValue(null)
        await setBackgroundImageFile('background.png')
        expect(cssVars.get('--term-bg-image')).toBe('none')
        expect(backgroundPreviewUrl.value).toBeNull()
    })

    it('falls back to none when invoke rejects', async () => {
        mockInvoke.mockRejectedValue(new Error('boom'))
        await setBackgroundImageFile('background.png')
        expect(cssVars.get('--term-bg-image')).toBe('none')
        expect(backgroundPreviewUrl.value).toBeNull()
    })
})

describe('setBackgroundFit', () => {
    it('writes the three fit css vars', () => {
        setBackgroundFit('tile')
        expect(cssVars.get('--term-bg-size')).toBe('auto')
        expect(cssVars.get('--term-bg-repeat')).toBe('repeat')
        expect(cssVars.get('--term-bg-position')).toBe('left top')
    })
})
