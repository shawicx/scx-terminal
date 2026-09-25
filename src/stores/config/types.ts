/**
 * @description 配置域类型契约：档案（local/ssh）、分组（本地/SSH/标签/快捷命令）、
 *              各设置分片与全量快照。与 Rust 侧 ConfigSnapshot/各 Record 的
 *              serde camelCase 形状一一对应。
 */
import type { TerminalColorScheme } from '@/lib/colorSchemes'
import type { PortForwarding } from '@/lib/portForwarding'

/** SSH 认证策略：auto = agent → 私钥（显式或 ~/.ssh/id_*）→ 密码（若配置） */
export type SshAuthMethod = 'auto' | 'agent' | 'publicKey' | 'password'

/** 本地 shell 档案 */
export interface LocalProfile {
    id: string
    type: 'local'
    name: string
    command: string
    args: string[]
    env: Record<string, string>
    cwd: string | null
    /** 档案专属配色名；null 跟随全局 */
    colorScheme: string | null
    loginShell: boolean
    isDefault: boolean
    /** 系统预置档案（随默认分组生成）：不可删除、cwd 只读（见 LocalGroup） */
    builtin: boolean
    /** 所属分组 id（见 LocalGroup）；缺省 = 未分组 */
    groupId?: string
}

/** SSH 远程档案 */
export interface SshProfile {
    id: string
    type: 'ssh'
    name: string
    host: string
    port: number
    user: string
    auth: SshAuthMethod
    /** 密钥链条目 id（加密存 SQLite，见 services/secrets.ts）；null = 不用密钥链 */
    keyId: string | null
    /** 档案专属配色名；null 跟随全局 */
    colorScheme: string | null
    isDefault: boolean
    /** 所属分组 id（见 SshGroup）；缺省 = 默认分组 */
    groupId?: string
    /** 端口转发规则（对标 Tabby：连接后可自动启动；运行态临时转发不落此字段） */
    forwardings?: PortForwarding[]
}

/** 终端配置档案：type 为判别字段（local 本地 shell / ssh 远程连接） */
export type TerminalProfile = LocalProfile | SshProfile

/** 本地档案分组（管理用实体，本地档案以 groupId 单选引用；无引用 = 未分组） */
export interface LocalGroup {
    id: string
    name: string
    /** 系统默认分组（/etc/shells 生成）：不可删除、不可重命名 */
    builtin: boolean
}

/** SSH 档案分组（管理用实体，SSH 档案以 groupId 单选引用；无引用 = 默认分组） */
export interface SshGroup {
    id: string
    name: string
}

/** 标签分组（管理用实体，标签页以 groupId 引用；persistTabs 控制会话恢复是否还原组内标签） */
export interface TabGroup {
    id: string
    name: string
    /** 组色（7 色预设色板色值，与 Rust TabGroupRecord.color 对应）；缺省 = 无色 */
    color?: string
    persistTabs: boolean
    /** UI 折叠态 */
    collapsed?: boolean
}

/** 快捷命令分组（管理用实体，命令以 groupId 单选引用） */
export interface QuickCommandGroup {
    id: string
    name: string
}

/** 快捷命令：command 支持 {{参数}} 占位符（Warp Workflow 式），autoRun 控制写入后是否补换行执行 */
export interface QuickCommand {
    id: string
    name: string
    command: string
    /** 所属分组 id；缺省 = 未分组 */
    groupId?: string
    autoRun: boolean
}

export interface TerminalConfig {
    font: string
    fontSize: number
    linePadding: number
    lineHeightAdjustment: number
    cursor: 'block' | 'bar' | 'underline'
    cursorBlink: boolean
    altIsMeta: boolean
    scrollbackLines: number
    wordSeparator: string
    drawBoldTextInBrightColors: boolean
    fontWeight: 'normal' | 'bold' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900'
    fontWeightBold: 'normal' | 'bold' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900'
    minimumContrastRatio: number
    copyOnSelect: boolean
    paletteGenerate: boolean
    paletteHarmonious: boolean
    backspace: 'ctrl-h' | 'ctrl-?' | 'delete' | 'backspace'
    inputNewlines: null | 'cr' | 'lf' | 'crlf' | 'implicit_cr' | 'implicit_lf'
    outputNewlines: null | 'cr' | 'lf' | 'crlf' | 'implicit_cr' | 'implicit_lf'
    /** 以登录 shell 启动（-l，加载 ~/.zprofile 等登录配置），对齐 Tabby/Terminal.app */
    loginShell: boolean
    /** 输入建议（自动补全） */
    suggestions: {
        enabled: boolean
        trigger: 'auto' | 'manual'
        delay: number
        sources: { history: boolean, quickCommands: boolean, paths: boolean }
    }
}

export interface AppearanceConfig {
    /** 'auto' 跟随系统；'dark'/'light' 为旧值（映射默认深/浅配色）；其余为内置配色名 */
    colorScheme: string
    tabBarPosition: 'top' | 'bottom'
    theme: 'default-dark' | 'default-light' | 'auto'
    language: 'auto' | 'zh-CN' | 'en'
    /** 终端背景图片（app-data/backgrounds/ 内文件名）；null = 未设置 */
    backgroundImage: string | null
    /** 终端背景色不透明度（0.05–1，越低背景图越显） */
    backgroundOpacity: number
    /** 背景图片填充方式 */
    backgroundFit: 'cover' | 'contain' | 'tile'
    /** 后台标签响铃时发送系统通知 */
    bellNotifications: boolean
}

/** 高级配置：调试诊断等非视觉开关 */
export interface AdvancedConfig {
    /** 调试日志：开启后前后端诊断行写入 app-data/logs/scx-terminal.log，启动自动打开 DevTools */
    debugEnabled: boolean
}

/** 最近 SSH 连接记录（profileId → 最后一次连接的 epoch 毫秒；仅 SSH 档案记录） */
export type RecentsConfig = Record<string, number>

/** SSH 终端页监控侧栏（全局一份：展开态与栏宽；档案级差异不支持） */
export interface MonitorConfig {
    /** 侧栏是否展开（收起时右侧仅留展开把手） */
    open: boolean
    /** 展开时的栏宽 px（260–480） */
    width: number
}

/** hotkey id -> list of sequences, each sequence a list of keystrokes */
export type HotkeysConfig = Record<string, string[][]>

export interface ConfigStore {
    terminal: TerminalConfig
    appearance: AppearanceConfig
    advanced: AdvancedConfig
    recents: RecentsConfig
    monitor: MonitorConfig
    hotkeys: HotkeysConfig
    profiles: TerminalProfile[]
    /** 本地档案分组（本地档案以 groupId 引用） */
    localGroups: LocalGroup[]
    /** SSH 档案分组（SSH 档案以 groupId 引用） */
    sshGroups: SshGroup[]
    /** 标签分组（标签页以 groupId 引用） */
    tabGroups: TabGroup[]
    /** 用户自定义配色方案（名称与内置重复时优先于内置生效） */
    colorSchemes: TerminalColorScheme[]
    quickCommands: QuickCommand[]
    quickCommandGroups: QuickCommandGroup[]
}

/** config_load 返回的库内快照（仅含已持久化的键，缺省由默认值兜底） */
export interface ConfigSnapshot {
    terminal?: Partial<TerminalConfig>
    appearance?: Partial<AppearanceConfig>
    advanced?: Partial<AdvancedConfig>
    recents?: RecentsConfig
    monitor?: Partial<MonitorConfig>
    hotkeys?: HotkeysConfig
    profiles?: TerminalProfile[]
    localGroups?: LocalGroup[]
    sshGroups?: SshGroup[]
    tabGroups?: TabGroup[]
    colorSchemes?: TerminalColorScheme[]
    quickCommands?: QuickCommand[]
    quickCommandGroups?: QuickCommandGroup[]
}
