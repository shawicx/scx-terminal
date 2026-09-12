export type HostPlatform = 'macos' | 'windows' | 'linux'

export function detectPlatform (): HostPlatform {
    const ua = navigator.userAgent
    if (ua.includes('Windows')) {
        return 'windows'
    }
    if (ua.includes('Mac') || ua.includes('Darwin')) {
        return 'macos'
    }
    return 'linux'
}

export const platform: HostPlatform = detectPlatform()
