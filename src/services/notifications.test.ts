/**
 * @description 响铃系统通知服务单测：mock notification 插件，断言设置开关、
 *              同标签 5s 节流与权限拒绝静默降级。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const notificationMocks = vi.hoisted(() => ({
    isPermissionGranted: vi.fn(),
    requestPermission: vi.fn(),
    sendNotification: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-notification', () => notificationMocks)

import { useConfigStore } from '@/stores/config'
import { ensureNotificationPermission, sendBellNotification } from './notifications'

beforeEach(() => {
    setActivePinia(createPinia())
    notificationMocks.isPermissionGranted.mockReset().mockResolvedValue(true)
    notificationMocks.requestPermission.mockReset().mockResolvedValue('granted')
    notificationMocks.sendNotification.mockReset()
})

afterEach(() => {
    vi.useRealTimers()
})

describe('sendBellNotification', () => {
    it('sends a notification titled with the tab name', async () => {
        await sendBellNotification('tab-send', 'zsh — dev', 'terminal bell')
        expect(notificationMocks.sendNotification).toHaveBeenCalledOnce()
        expect(notificationMocks.sendNotification).toHaveBeenCalledWith(expect.objectContaining({ title: 'zsh — dev', body: 'terminal bell' }))
    })

    it('does not send when bell notifications are disabled in settings', async () => {
        useConfigStore().store.appearance.bellNotifications = false
        await sendBellNotification('tab-disabled', 'zsh')
        expect(notificationMocks.sendNotification).not.toHaveBeenCalled()
    })

    it('throttles repeat bells from the same tab within 5s', async () => {
        await sendBellNotification('tab-throttle', 'build')
        await sendBellNotification('tab-throttle', 'build')
        expect(notificationMocks.sendNotification).toHaveBeenCalledOnce()
    })

    it('does not throttle different tabs', async () => {
        await sendBellNotification('tab-a', 'a')
        await sendBellNotification('tab-b', 'b')
        expect(notificationMocks.sendNotification).toHaveBeenCalledTimes(2)
    })

    it('sends again after the throttle window passes', async () => {
        vi.useFakeTimers()
        await sendBellNotification('tab-window', 'build')
        vi.setSystemTime(Date.now() + 5000)
        await sendBellNotification('tab-window', 'build')
        expect(notificationMocks.sendNotification).toHaveBeenCalledTimes(2)
    })

    it('degrades silently when permission is denied', async () => {
        notificationMocks.isPermissionGranted.mockResolvedValue(false)
        notificationMocks.requestPermission.mockResolvedValue('denied')
        await expect(sendBellNotification('tab-denied', 'build')).resolves.toBeUndefined()
        expect(notificationMocks.sendNotification).not.toHaveBeenCalled()
    })
})

describe('ensureNotificationPermission', () => {
    it('returns true without requesting when already granted', async () => {
        notificationMocks.isPermissionGranted.mockResolvedValue(true)
        await expect(ensureNotificationPermission()).resolves.toBe(true)
        expect(notificationMocks.requestPermission).not.toHaveBeenCalled()
    })

    it('requests and reports granted when not yet granted', async () => {
        notificationMocks.isPermissionGranted.mockResolvedValue(false)
        notificationMocks.requestPermission.mockResolvedValue('granted')
        await expect(ensureNotificationPermission()).resolves.toBe(true)
        expect(notificationMocks.requestPermission).toHaveBeenCalledOnce()
    })
})
