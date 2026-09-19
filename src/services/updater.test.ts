/**
 * @description 自动更新服务单测：mock updater/process 插件，断言检查三条路径
 *              （无更新/有更新/失败）与安装流程（进度回调、失败不重启）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Update } from '@tauri-apps/plugin-updater'

const updaterMocks = vi.hoisted(() => ({
    check: vi.fn(),
    relaunch: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-updater', () => ({ check: updaterMocks.check }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: updaterMocks.relaunch }))

import { checkForUpdate, installUpdate } from './updater'

beforeEach(() => {
    updaterMocks.check.mockReset()
    updaterMocks.relaunch.mockReset()
})

function fakeUpdate (): Update {
    return {
        downloadAndInstall: vi.fn(),
    } as unknown as Update
}

describe('checkForUpdate', () => {
    it('returns null when no update is available', async () => {
        updaterMocks.check.mockResolvedValue(null)
        await expect(checkForUpdate()).resolves.toBeNull()
    })

    it('returns the pending update when one is available', async () => {
        const update = fakeUpdate()
        updaterMocks.check.mockResolvedValue(update)
        await expect(checkForUpdate()).resolves.toBe(update)
    })

    it('propagates check failures to the caller', async () => {
        updaterMocks.check.mockRejectedValue(new Error('network down'))
        await expect(checkForUpdate()).rejects.toThrow('network down')
    })
})

describe('installUpdate', () => {
    it('downloads, reports accumulated progress and relaunches', async () => {
        const update = fakeUpdate()
        const onProgress = vi.fn()
        vi.mocked(update.downloadAndInstall).mockImplementation(async (onEvent?: (event: never) => void) => {
            onEvent?.({ event: 'Started', data: { contentLength: 1000 } } as never)
            onEvent?.({ event: 'Progress', data: { chunkLength: 400 } } as never)
            onEvent?.({ event: 'Progress', data: { chunkLength: 300 } } as never)
        })

        await installUpdate(update, onProgress)

        expect(onProgress.mock.calls.map(call => call[0])).toEqual([
            { total: 1000, received: 0, percent: 0 },
            { total: 1000, received: 400, percent: 40 },
            { total: 1000, received: 700, percent: 70 },
        ])
        expect(updaterMocks.relaunch).toHaveBeenCalledOnce()
    })

    it('reports received bytes without percent when total is unknown', async () => {
        const update = fakeUpdate()
        const onProgress = vi.fn()
        vi.mocked(update.downloadAndInstall).mockImplementation(async (onEvent?: (event: never) => void) => {
            onEvent?.({ event: 'Started', data: {} } as never)
            onEvent?.({ event: 'Progress', data: { chunkLength: 512 } } as never)
        })

        await installUpdate(update, onProgress)

        expect(onProgress).toHaveBeenLastCalledWith({ total: null, received: 512, percent: null })
    })

    it('does not relaunch when the download fails', async () => {
        const update = fakeUpdate()
        vi.mocked(update.downloadAndInstall).mockRejectedValue(new Error('checksum mismatch'))

        await expect(installUpdate(update)).rejects.toThrow('checksum mismatch')
        expect(updaterMocks.relaunch).not.toHaveBeenCalled()
    })
})
