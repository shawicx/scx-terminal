/**
 * @description SshSession kbd-interactive 单元测试：挑战事件 → 回调 → respondKbd 回传、
 *              取消语义、认证成功后按「记住」回存（mock SshProxy / setProfilePassword）
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { KbdChallenge } from '@/services/ssh'

const mocks = vi.hoisted(() => {
    return {
        /** start 行为注入点：默认成功 */
        startImpl: async (): Promise<void> => {},
        /** 已注册的 kbdchallenge 处理器（mock 代理转发事件用） */
        challengeHandler: null as ((payload: unknown) => void) | null,
        respondKbd: vi.fn(),
        // 与真实签名一致返回 Promise<void>（实现侧 setProfilePassword(...).catch 依赖 Promise）
        setProfilePassword: vi.fn(async () => {}),
    }
})

vi.mock('@/services/ssh', () => ({
    SshProxy: class {
        subscribe (event: string, handler: (payload?: unknown) => void): void {
            if (event === 'kbdchallenge') {
                mocks.challengeHandler = handler
            }
        }
        async start (): Promise<void> {
            await mocks.startImpl()
        }
        async respondKbd (responses: string[] | null): Promise<void> {
            mocks.respondKbd(responses)
        }
        async confirmHostKey (): Promise<void> {}
        getID (): string { return 'ssh-test' }
        unsubscribeAll (): void {}
        ackData (): void {}
    },
}))

vi.mock('@/services/secrets', () => ({
    setProfilePassword: mocks.setProfilePassword,
}))

import { SshSession } from './sshSession'

/** 冲刷微任务队列：挑战应答异步链与 start 的 resolve 可能交错，断言前统一等待 */
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

const PASSWORD_CHALLENGE: KbdChallenge = {
    name: 'Password authentication',
    instructions: '',
    prompts: [{ prompt: 'Password: ', echo: false }],
}

const MFA_CHALLENGE: KbdChallenge = {
    name: 'Two-factor',
    instructions: 'answer both',
    prompts: [
        { prompt: 'Password: ', echo: false },
        { prompt: 'OTP: ', echo: false },
    ],
}

/** 构造带指定 kbd 回调的 SshSession 测试实例 */
function startSession (onKeyboardInteractive?: (challenge: KbdChallenge) => Promise<{ responses: string[], remember: boolean } | null>): SshSession {
    return new SshSession({ onKeyboardInteractive })
}

const START_OPTIONS = {
    host: 'example.com',
    port: 22,
    user: 'root',
    auth: 'password',
    profileId: 'profile-1',
    keyId: null,
    width: null,
    height: null,
}

describe('SshSession kbd-interactive', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.challengeHandler = null
        mocks.startImpl = async () => {}
    })

    it('forwards challenge to callback and relays answers via respondKbd', async () => {
        const session = startSession(async () => ({ responses: ['hunter2'], remember: false }))
        const startPromise = session.start(START_OPTIONS)
        mocks.challengeHandler!(PASSWORD_CHALLENGE)
        await startPromise
        await flush()
        expect(mocks.respondKbd).toHaveBeenCalledWith(['hunter2'])
    })

    it('relays null (cancel) when callback resolves null', async () => {
        const session = startSession(async () => null)
        const startPromise = session.start(START_OPTIONS)
        mocks.challengeHandler!(PASSWORD_CHALLENGE)
        await startPromise
        await flush()
        expect(mocks.respondKbd).toHaveBeenCalledWith(null)
    })

    it('saves password after success when remember checked on single secret prompt', async () => {
        const session = startSession(async () => ({ responses: ['hunter2'], remember: true }))
        const startPromise = session.start(START_OPTIONS)
        mocks.challengeHandler!(PASSWORD_CHALLENGE)
        await startPromise
        await flush()
        expect(mocks.setProfilePassword).toHaveBeenCalledWith('profile-1', 'hunter2')
    })

    it('never saves for multi-prompt (MFA) challenges', async () => {
        const session = startSession(async () => ({ responses: ['pw', '123456'], remember: true }))
        const startPromise = session.start(START_OPTIONS)
        mocks.challengeHandler!(MFA_CHALLENGE)
        await startPromise
        await flush()
        expect(mocks.setProfilePassword).not.toHaveBeenCalled()
    })

    it('does not save when remember unchecked', async () => {
        const session = startSession(async () => ({ responses: ['hunter2'], remember: false }))
        const startPromise = session.start(START_OPTIONS)
        mocks.challengeHandler!(PASSWORD_CHALLENGE)
        await startPromise
        await flush()
        expect(mocks.setProfilePassword).not.toHaveBeenCalled()
    })

    it('does not save when connection fails after answering', async () => {
        mocks.startImpl = async () => {
            throw new Error('connection refused')
        }
        const session = startSession(async () => ({ responses: ['hunter2'], remember: true }))
        const startPromise = session.start(START_OPTIONS)
        mocks.challengeHandler!(PASSWORD_CHALLENGE)
        await startPromise
        await flush()
        expect(mocks.respondKbd).toHaveBeenCalledWith(['hunter2'])
        expect(mocks.setProfilePassword).not.toHaveBeenCalled()
    })
})
