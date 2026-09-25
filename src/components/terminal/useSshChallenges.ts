/**
 * @description SSH 连接挑战弹窗接线（TOFU 指纹确认 + kbd-interactive 凭据）：
 *              SshSession 回调挂起 → 对话框呈现 → 用户应答 resolve（原 TerminalPane 段）。
 */
import { ref } from 'vue'
import type { HostKeyChallenge, KbdChallenge, KbdAnswer } from '@/services/ssh'

/**
 * @description 挑战状态与挂起/应答函数组
 * @returns hostKey/kbd 两组 { challenge, resolve, 回调 }
 *
 * @example const challenges = useSshChallenges()
 *
 */
export function useSshChallenges () {
    // ---- SSH 主机指纹确认（TOFU） ----
    const hostKeyChallenge = ref<HostKeyChallenge | null>(null)
    let hostKeyResolver: ((accepted: boolean) => void) | null = null

    /**
     * @description SSH 首连/指纹失配时的确认回调：挂起等待用户在对话框中接受/拒绝
     * @param challenge 指纹确认请求（指纹/算法/是否失配）
     * @returns Promise<boolean> 是否信任该主机密钥
     *
     * @example await onHostKey({ fingerprint: 'SHA256:xxx', keyType: 'ssh-ed25519', changed: false })
     *
     */
    function onHostKey (challenge: HostKeyChallenge): Promise<boolean> {
        return new Promise(resolve => {
            hostKeyResolver = resolve
            hostKeyChallenge.value = challenge
        })
    }

    function resolveHostKey (accepted: boolean): void {
        hostKeyChallenge.value = null
        hostKeyResolver?.(accepted)
        hostKeyResolver = null
    }

    // ---- SSH 凭据挑战（kbd-interactive / 密码请求） ----
    const kbdChallenge = ref<KbdChallenge | null>(null)
    let kbdResolver: ((answer: KbdAnswer | null) => void) | null = null

    /**
     * @description SSH 认证需要凭据输入时挂起等待对话框应答（多轮挑战重复调用）
     * @param challenge 服务器挑战（name/instructions/prompts）
     * @returns Promise<KbdAnswer | null> 应答；null = 取消
     *
     */
    function onKeyboardInteractive (challenge: KbdChallenge): Promise<KbdAnswer | null> {
        return new Promise(resolve => {
            kbdResolver = resolve
            kbdChallenge.value = challenge
        })
    }

    function resolveKbd (answer: KbdAnswer | null): void {
        kbdChallenge.value = null
        kbdResolver?.(answer)
        kbdResolver = null
    }

    return {
        hostKeyChallenge, onHostKey, resolveHostKey,
        kbdChallenge, onKeyboardInteractive, resolveKbd,
    }
}
