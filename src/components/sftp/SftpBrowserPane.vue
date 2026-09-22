<!--
  @description SFTP 双栏浏览的单栏组件（side=local/remote）：工具栏（Home/前进后退/刷新/面包屑/
              隐藏文件开关）、列排序、多选（⌘/⇧）、双击进入目录或传输文件、右键菜单
              （传输/重命名/删除/Finder 显示/复制路径）、行拖拽源（阈值后交父组件接管）。
              目录列举经注入的 lister；远端文件操作经注入的 ops（local 侧为 null）。
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronLeft, ChevronRight, Eye, EyeOff, File as FileIcon, Folder, FolderPlus, Home, RefreshCw } from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import ContextMenu, { type ContextMenuItemSpec } from '@/components/ui/ContextMenu.vue'
import Dialog from '@/components/ui/Dialog.vue'
import { writeClipboardText } from '@/lib/frontendContext'
import { formatBytes } from '@/lib/sftpTransferMath'
import {
    breadcrumbSegments,
    joinPanePath,
    parentPanePath,
    sortPaneEntries,
    type PaneEntry,
    type SortDir,
    type SortKey,
} from '@/lib/sftpPane'

/** 远端文件操作注入（local 侧不传） */
export interface PaneOps {
    rename (from: string, to: string): Promise<void>
    mkdir (path: string): Promise<void>
    removeEntry (entry: PaneEntry): Promise<void>
}

const props = defineProps<{
    side: 'local' | 'remote'
    /** 主目录（Home 按钮目标；远端=canonicalize('.')，本地=$HOME） */
    homePath: string
    /** 目录列举适配器（父组件绑定 sftp 会话 / fs_browse_dir） */
    lister: (path: string) => Promise<PaneEntry[]>
    /** 远端文件操作；local 侧为 null（只浏览/传输/Finder 显示） */
    ops?: PaneOps | null
    /** 禁用（连接建立前/断开后）：遮罩 + 阻断交互 */
    disabled?: boolean
    /** 拖拽落点高亮（父组件拖拽会话驱动） */
    dropActive?: boolean
    dropDirPath?: string | null
}>()

const emit = defineEmits<{
    (e: 'transfer', entries: PaneEntry[], targetDir?: string): void
    (e: 'pathChange', path: string): void
    (e: 'rowDragstart', entries: PaneEntry[], event: PointerEvent): void
}>()

const { t } = useI18n()
const rootEl = ref<HTMLElement>()

// ---- 导航状态：路径 / 历史（前进后退） / 加载 ----
const path = ref('')
const entries = ref<PaneEntry[]>([])
const loading = ref(false)
const error = ref('')
const history = ref<string[]>([])
const historyIndex = ref(-1)
let loadSeq = 0

/** 面包屑分段（根 + 每级目录） */
const crumbs = computed(() => breadcrumbSegments(path.value || props.homePath || '/'))

/**
 * @description 加载目录：序号防串（快速导航时旧响应不得覆盖新目录）
 * @param dir 目录绝对路径
 * @param push 是否压入导航历史（后退/前进不压）
 * @returns Promise<void>
 *
 */
async function loadDir (dir: string, push = true): Promise<void> {
    const seq = ++loadSeq
    loading.value = true
    error.value = ''
    try {
        const list = await props.lister(dir)
        if (seq !== loadSeq) {
            return
        }
        entries.value = list
        path.value = dir
        selected.value.clear()
        anchorPath.value = null
        if (push) {
            history.value = [...history.value.slice(0, historyIndex.value + 1), dir]
            historyIndex.value = history.value.length - 1
        }
        emit('pathChange', dir)
    } catch (e) {
        if (seq !== loadSeq) {
            return
        }
        error.value = String(e instanceof Error ? e.message : e)
    } finally {
        if (seq === loadSeq) {
            loading.value = false
        }
    }
}

function navigate (dir: string): void {
    if (dir !== path.value || error.value) {
        void loadDir(dir)
    } else {
        void loadDir(dir, false)
    }
}

function goHome (): void {
    if (props.homePath) {
        navigate(props.homePath)
    }
}

function goBack (): void {
    if (historyIndex.value > 0) {
        historyIndex.value -= 1
        void loadDir(history.value[historyIndex.value]!, false)
    }
}

function goForward (): void {
    if (historyIndex.value < history.value.length - 1) {
        historyIndex.value += 1
        void loadDir(history.value[historyIndex.value]!, false)
    }
}

function refresh (): void {
    void loadDir(path.value, false)
}

// ---- 面包屑编辑：点击路径区转输入框，Enter 跳转 / Esc 取消 ----
const editing = ref(false)
const draft = ref('')

function startEdit (): void {
    draft.value = path.value
    editing.value = true
}

function commitEdit (): void {
    if (!editing.value) {
        return
    }
    editing.value = false
    const target = draft.value.trim()
    if (target && target !== path.value) {
        navigate(target)
    }
}

function cancelEdit (): void {
    editing.value = false
}

// ---- 排序 / 隐藏文件 ----
const sortKey = ref<SortKey>('name')
const sortDir = ref<SortDir>('asc')
const showHidden = ref(false)

/** 展示条目：隐藏文件过滤 + 排序（目录恒前） */
const visibleEntries = computed(() => {
    const filtered = showHidden.value
        ? entries.value
        : entries.value.filter(entry => !entry.name.startsWith('.'))
    return sortPaneEntries(filtered, sortKey.value, sortDir.value)
})

function toggleSort (key: SortKey): void {
    if (sortKey.value === key) {
        sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
    } else {
        sortKey.value = key
        sortDir.value = key === 'name' ? 'asc' : 'desc'
    }
}

function sortIndicator (key: SortKey): string {
    if (sortKey.value !== key) {
        return ''
    }
    return sortDir.value === 'asc' ? '↑' : '↓'
}

// ---- 选择（单击 / ⌘ 单击 / ⇃ 范围） ----
const selected = ref(new Set<string>())
const anchorPath = ref<string | null>(null)
let suppressClick = false

function onRowClick (entry: PaneEntry, event: MouseEvent): void {
    if (suppressClick) {
        suppressClick = false
        return
    }
    if (event.metaKey || event.ctrlKey) {
        if (selected.value.has(entry.path)) {
            selected.value.delete(entry.path)
        } else {
            selected.value.add(entry.path)
        }
        anchorPath.value = entry.path
    } else if (event.shiftKey && anchorPath.value) {
        const paths = visibleEntries.value.map(item => item.path)
        const from = paths.indexOf(anchorPath.value)
        const to = paths.indexOf(entry.path)
        if (from >= 0 && to >= 0) {
            const [lo, hi] = from <= to ? [from, to] : [to, from]
            selected.value = new Set(paths.slice(lo, hi + 1))
        }
    } else {
        selected.value = new Set([entry.path])
        anchorPath.value = entry.path
    }
}

/** 双击：目录进入；文件 = 传输到对侧栏当前目录（Termius "Copy to target directory" 心智） */
function onRowDblClick (entry: PaneEntry): void {
    if (entry.isDir) {
        navigate(entry.path)
    } else {
        emit('transfer', [entry])
    }
}

/**
 * @description 行按下：位移超过阈值视为拖拽启动——携带选中集合（按下的行未选中则单拖），
 *              交父组件接管（ghost/落点判定/放下传输）；未达阈值则正常走点击
 * @param entry 按下的条目
 * @param event 指针事件
 * @returns void
 *
 */
function onRowPointerDown (entry: PaneEntry, event: PointerEvent): void {
    if (event.button !== 0) {
        return
    }
    const startX = event.clientX
    const startY = event.clientY
    const onMove = (move: PointerEvent): void => {
        if (Math.hypot(move.clientX - startX, move.clientY - startY) > 6) {
            cleanup()
            suppressClick = true
            const dragging = selected.value.has(entry.path)
                ? visibleEntries.value.filter(item => selected.value.has(item.path))
                : [entry]
            emit('rowDragstart', dragging, move)
        }
    }
    const onUp = (): void => cleanup()
    const cleanup = (): void => {
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
}

// ---- 右键菜单 / 工具栏操作 ----
const selectedEntries = computed(() => visibleEntries.value.filter(entry => selected.value.has(entry.path)))

function menuItemsFor (entry: PaneEntry): ContextMenuItemSpec[] {
    const many = selectedEntries.value.length > 1 && selected.value.has(entry.path)
    const items: ContextMenuItemSpec[] = [
        {
            key: 'transfer',
            label: props.side === 'remote'
                ? t('sftp.transferToLocal')
                : t('sftp.transferToRemote'),
        },
    ]
    if (props.side === 'local') {
        items.push({ key: 'reveal', label: t('sftp.revealInFinder') })
    } else if (props.ops && !many) {
        items.push(
            { key: 'rename', label: t('sftp.rename') },
            { key: 'delete', label: t('sftp.delete'), danger: true, separatorBefore: true },
        )
    }
    items.push({ key: 'copy-path', label: t('sftp.copyPath') })
    return items
}

async function onMenuSelect (entry: PaneEntry, key: string): Promise<void> {
    const targets = selected.value.has(entry.path) ? selectedEntries.value : [entry]
    if (key === 'transfer') {
        emit('transfer', targets)
    } else if (key === 'reveal') {
        const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
        void revealItemInDir(entry.path).catch(() => {})
    } else if (key === 'rename') {
        promptRename(entry)
    } else if (key === 'delete') {
        await removeEntries(targets)
    } else if (key === 'copy-path') {
        void writeClipboardText(targets.map(item => item.path).join('\n'))
    }
}

// ---- 新建目录 / 重命名弹窗（失败保留输入，修复旧面板丢输入问题） ----
const prompt = ref<{ kind: 'mkdir' } | { kind: 'rename', entry: PaneEntry } | null>(null)
const promptValue = ref('')
const promptError = ref('')

const promptTitle = computed(() => prompt.value?.kind === 'rename' ? t('sftp.rename') : t('sftp.newDir'))
const promptPlaceholder = computed(() => prompt.value?.kind === 'rename' ? t('sftp.renamePrompt') : t('sftp.newDirPrompt'))

function setPromptInput (el: unknown): void {
    if (el) {
        (el as HTMLInputElement).focus()
    }
}

function promptNewDir (): void {
    prompt.value = { kind: 'mkdir' }
    promptValue.value = ''
    promptError.value = ''
}

function promptRename (entry: PaneEntry): void {
    prompt.value = { kind: 'rename', entry }
    promptValue.value = entry.name
    promptError.value = ''
}

async function commitPrompt (): Promise<void> {
    const current = prompt.value
    if (!current || !props.ops) {
        return
    }
    const name = promptValue.value.trim()
    if (!name || (current.kind === 'rename' && name === current.entry.name)) {
        prompt.value = null
        return
    }
    promptError.value = ''
    try {
        if (current.kind === 'mkdir') {
            await props.ops.mkdir(joinPanePath(path.value, name))
        } else {
            await props.ops.rename(current.entry.path, joinPanePath(path.value, name))
        }
        prompt.value = null
        await loadDir(path.value, false)
    } catch (e) {
        // 失败保留弹窗与用户输入（旧面板先关后 await 会丢输入）
        promptError.value = String(e instanceof Error ? e.message : e)
    }
}

async function removeEntries (targets: PaneEntry[]): Promise<void> {
    if (!props.ops || targets.length === 0) {
        return
    }
    const { confirm } = await import('@tauri-apps/plugin-dialog')
    const message = targets.length === 1
        ? t('sftp.deleteConfirm', { name: targets[0]!.name })
        : t('sftp.deleteConfirmMany', { count: targets.length })
    if (!(await confirm(message))) {
        return
    }
    error.value = ''
    try {
        for (const entry of targets) {
            await props.ops.removeEntry(entry)
        }
        await loadDir(path.value, false)
    } catch (e) {
        error.value = String(e instanceof Error ? e.message : e)
    }
}

// ---- 展示辅助 ----
function formatSize (size: number | null): string {
    return size === null ? '—' : formatBytes(size)
}

function formatTime (mtimeMs: number | null): string {
    if (!mtimeMs) {
        return '—'
    }
    return new Date(mtimeMs).toLocaleString(undefined, {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
    })
}

const selectedCountLabel = computed(() => selected.value.size > 1
    ? t('sftp.selectedCount', { count: selected.value.size })
    : '')

const parentHint = computed(() => (path.value && path.value !== '/' ? parentPanePath(path.value) : ''))

defineExpose({
    currentPath: () => path.value,
    refresh,
    setPath: (next: string) => {
        void loadDir(next)
    },
    entriesSnapshot: () => visibleEntries.value,
    rootElement: () => rootEl.value,
})
</script>

<template>
    <section
        ref="rootEl"
        class="sftp-pane"
        :class="{ disabled: props.disabled, 'drop-active': props.dropActive }"
        :data-side="props.side"
    >
        <div class="pane-toolbar">
            <Button variant="ghost" size="icon" class="h-7 w-7" :title="t('sftp.home')" :disabled="!props.homePath" @click="goHome">
                <Home :size="14" />
            </Button>
            <Button variant="ghost" size="icon" class="h-7 w-7" :title="t('sftp.back')" :disabled="historyIndex <= 0" @click="goBack">
                <ChevronLeft :size="14" />
            </Button>
            <Button variant="ghost" size="icon" class="h-7 w-7" :title="t('sftp.forward')" :disabled="historyIndex >= history.length - 1" @click="goForward">
                <ChevronRight :size="14" />
            </Button>
            <Button variant="ghost" size="icon" class="h-7 w-7" :title="t('sftp.refresh')" @click="refresh">
                <RefreshCw :size="14" />
            </Button>
            <div v-if="!editing" class="pane-path" :title="path" @click="startEdit">
                <template v-for="(crumb, index) in crumbs" :key="crumb.path">
                    <span v-if="index > 0" class="crumb-sep">/</span>
                    <button class="crumb" :class="{ last: index === crumbs.length - 1 }" @click.stop="navigate(crumb.path)">
                        {{ crumb.label }}
                    </button>
                </template>
            </div>
            <input
                v-else
                v-model="draft"
                class="pane-path-input"
                spellcheck="false"
                @keydown.enter.prevent="commitEdit"
                @keydown.esc.prevent="cancelEdit"
                @blur="commitEdit"
            />
            <Button
                variant="ghost"
                size="icon"
                class="h-7 w-7"
                :title="t('sftp.toggleHidden')"
                @click="showHidden = !showHidden"
            >
                <EyeOff v-if="showHidden" :size="14" />
                <Eye v-else :size="14" />
            </Button>
            <Button
                v-if="props.side === 'remote' && props.ops"
                variant="ghost"
                size="icon"
                class="h-7 w-7"
                :title="t('sftp.newDir')"
                @click="promptNewDir"
            >
                <FolderPlus :size="14" />
            </Button>
        </div>

        <div class="pane-header-row">
            <button class="col col-name" @click="toggleSort('name')">
                {{ t('sftp.colName') }}<span class="sort-ind">{{ sortIndicator('name') }}</span>
            </button>
            <button class="col col-size" @click="toggleSort('size')">
                {{ t('sftp.colSize') }}<span class="sort-ind">{{ sortIndicator('size') }}</span>
            </button>
            <button class="col col-time" @click="toggleSort('mtime')">
                {{ t('sftp.colModified') }}<span class="sort-ind">{{ sortIndicator('mtime') }}</span>
            </button>
        </div>

        <p v-if="error" class="pane-error">{{ error }}</p>

        <div class="pane-list">
            <p v-if="loading" class="pane-hint">{{ t('sftp.loading') }}</p>
            <p v-else-if="visibleEntries.length === 0" class="pane-hint">{{ t('sftp.empty') }}</p>
            <ContextMenu
                v-for="entry in visibleEntries"
                v-else
                :key="entry.path"
                :items="menuItemsFor(entry)"
                @select="key => onMenuSelect(entry, key)"
            >
                <div
                    class="pane-entry"
                    :class="{
                        selected: selected.has(entry.path),
                        'drop-target': props.dropDirPath === entry.path,
                    }"
                    :data-drop-dir="entry.isDir ? entry.path : undefined"
                    :title="parentHint && entry.isDir === false ? entry.path : entry.name"
                    @click="onRowClick(entry, $event)"
                    @dblclick="onRowDblClick(entry)"
                    @pointerdown="onRowPointerDown(entry, $event)"
                >
                    <Folder v-if="entry.isDir" class="entry-icon dir" :size="14" />
                    <FileIcon v-else class="entry-icon" :size="14" />
                    <span class="entry-name">{{ entry.name }}</span>
                    <span class="entry-meta entry-size">{{ entry.isDir ? '—' : formatSize(entry.size) }}</span>
                    <span class="entry-meta entry-time">{{ formatTime(entry.mtimeMs) }}</span>
                </div>
            </ContextMenu>
        </div>

        <div v-if="selectedCountLabel" class="pane-status">{{ selectedCountLabel }}</div>

        <div v-if="props.disabled" class="pane-disabled-overlay">{{ t('sftp.connecting') }}</div>

        <Dialog v-if="prompt" :title="promptTitle" :width="380" @cancel="prompt = null">
            <input
                :ref="setPromptInput"
                v-model="promptValue"
                class="pane-prompt-input"
                spellcheck="false"
                :placeholder="promptPlaceholder"
                @keydown.enter.prevent="commitPrompt"
            />
            <p v-if="promptError" class="pane-prompt-error">{{ promptError }}</p>
            <template #footer>
                <Button variant="outline" size="sm" @click="prompt = null">{{ t('sftp.cancel') }}</Button>
                <Button size="sm" @click="commitPrompt">{{ t('sftp.confirm') }}</Button>
            </template>
        </Dialog>
    </section>
</template>

<script lang="ts">
export default { name: 'SftpBrowserPane' }
</script>

<style scoped>
.sftp-pane {
    position: relative;
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: var(--color-background);
}

.sftp-pane + .sftp-pane {
    border-left: 1px solid var(--color-border);
}

.sftp-pane.disabled {
    pointer-events: none;
    opacity: 0.55;
}

/* 拖拽落点高亮（父组件拖拽会话驱动） */
.sftp-pane.drop-active {
    box-shadow: inset 0 0 0 2px var(--color-ring);
}

.pane-toolbar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--color-border);
}

.pane-path {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 1px;
    height: 26px;
    padding: 0 6px;
    border: 1px solid transparent;
    border-radius: 6px;
    overflow: hidden;
    cursor: pointer;
    cursor: text;
}

.pane-path:hover {
    border-color: var(--color-input);
}

.crumb {
    border: none;
    padding: 0 2px;
    background: transparent;
    color: var(--color-muted-foreground);
    font-size: 12px;
    font-family: var(--font-mono);
    white-space: nowrap;
    cursor: pointer;
    transition: color 0.25s ease;
}

.crumb:hover {
    color: var(--color-foreground);
    text-decoration: underline;
}

.crumb.last {
    color: var(--color-foreground);
    font-weight: 600;
}

.crumb-sep {
    color: var(--color-muted-foreground);
    font-size: 11px;
    flex-shrink: 0;
}

.pane-path-input {
    flex: 1 1 0;
    min-width: 0;
    height: 26px;
    padding: 0 8px;
    border: 1px solid var(--color-ring);
    border-radius: 6px;
    background: transparent;
    color: var(--color-foreground);
    font-family: var(--font-mono);
    font-size: 12px;
    outline: none;
    box-shadow: 0 0 0 1px var(--color-ring);
}

.pane-header-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 10px;
    border-bottom: 1px solid var(--color-border);
    user-select: none;
}

.col {
    border: none;
    padding: 0;
    background: transparent;
    color: var(--color-muted-foreground);
    font-size: 11px;
    cursor: pointer;
    transition: color 0.25s ease;
}

.col:hover {
    color: var(--color-foreground);
}

.sort-ind {
    display: inline-block;
    width: 12px;
    margin-left: 2px;
    text-align: center;
}

.col-name {
    flex: 1 1 0;
    min-width: 0;
    text-align: left;
}

.col-size {
    width: 64px;
    text-align: right;
}

.col-time {
    width: 118px;
    text-align: right;
}

.pane-error {
    margin: 0;
    padding: 6px 10px;
    font-size: 12px;
    color: var(--color-destructive);
    border-bottom: 1px solid var(--color-border);
    word-break: break-all;
}

.pane-list {
    flex: 1 1 0;
    min-height: 0;
    overflow-y: auto;
}

.pane-hint {
    margin: 0;
    padding: 16px 10px;
    text-align: center;
    font-size: 12px;
    color: var(--color-muted-foreground);
}

.pane-entry {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
    user-select: none;
}

.pane-entry:hover {
    background: var(--color-accent);
}

.pane-entry.selected {
    background: color-mix(in oklch, var(--color-primary) 14%, transparent);
}

.pane-entry.drop-target {
    outline: 1px solid var(--color-ring);
    outline-offset: -1px;
    background: color-mix(in oklch, var(--color-primary) 10%, transparent);
}

.entry-icon {
    flex-shrink: 0;
    color: var(--color-muted-foreground);
}

.entry-icon.dir {
    color: var(--color-primary);
}

.entry-name {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.entry-meta {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--color-muted-foreground);
    font-variant-numeric: tabular-nums;
}

.entry-size {
    width: 56px;
    text-align: right;
}

.entry-time {
    width: 112px;
    text-align: right;
}

.pane-status {
    padding: 2px 10px;
    border-top: 1px solid var(--color-border);
    font-size: 11px;
    color: var(--color-muted-foreground);
}

.pane-disabled-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    color: var(--color-muted-foreground);
    background: color-mix(in oklch, var(--color-background) 60%, transparent);
}

.pane-prompt-input {
    width: 100%;
    box-sizing: border-box;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--color-input);
    border-radius: 6px;
    background: transparent;
    color: var(--color-foreground);
    font-family: var(--font-mono);
    font-size: 13px;
    outline: none;
}

.pane-prompt-input:focus {
    border-color: var(--color-ring);
    box-shadow: 0 0 0 1px var(--color-ring);
}

.pane-prompt-error {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--color-destructive);
    word-break: break-all;
}
</style>
