import { invoke } from '@tauri-apps/api/core'

export interface Shell {
    id: string
    name: string
    command: string
    args: string[]
    default: boolean
}

export async function listShells (): Promise<Shell[]> {
    return invoke<Shell[]>('list_shells')
}

export async function defaultShell (): Promise<Shell> {
    const shells = await listShells()
    return shells.find(shell => shell.default) ?? shells[0]!
}
