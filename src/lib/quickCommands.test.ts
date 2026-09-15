import { describe, expect, it } from 'vitest'
import { groupQuickCommandSections, parseQuickCommandParams, previewQuickCommand, renderQuickCommand } from './quickCommands'

describe('parseQuickCommandParams', () => {
    it('按出现顺序提取参数', () => {
        expect(parseQuickCommandParams('kubectl logs {{pod}} -n {{namespace}}')).toEqual(['pod', 'namespace'])
    })

    it('重复参数去重且保持首次出现顺序', () => {
        expect(parseQuickCommandParams('git checkout {{branch}} && git push origin {{branch}}')).toEqual(['branch'])
    })

    it('占位符前后容忍空白', () => {
        expect(parseQuickCommandParams('echo {{  name  }}')).toEqual(['name'])
    })

    it('参数名限 [\\w-]，花括号内其他字符不匹配', () => {
        expect(parseQuickCommandParams('echo {{a b}} {{c.d}} {{ok}}')).toEqual(['ok'])
    })

    it('无占位符与空串返回空数组', () => {
        expect(parseQuickCommandParams('ls -la')).toEqual([])
        expect(parseQuickCommandParams('')).toEqual([])
    })

    it('中文参数名不被识别（当前语法仅 ASCII）', () => {
        expect(parseQuickCommandParams('git checkout {{分支}}')).toEqual([])
    })
})

describe('renderQuickCommand', () => {
    it('替换全部占位符', () => {
        expect(renderQuickCommand('ssh {{user}}@{{host}}', { user: 'root', host: '1.2.3.4' })).toBe('ssh root@1.2.3.4')
    })

    it('未填参数替换为空串', () => {
        expect(renderQuickCommand('ssh {{user}}@{{host}}', { user: 'root' })).toBe('ssh root@')
    })

    it('替换值中的 $ 序列原样保留（不被当作特殊替换模式）', () => {
        expect(renderQuickCommand('echo {{v}}', { v: '$& $1 $$' })).toBe('echo $& $1 $$')
    })

    it('多行模板原样保留换行', () => {
        expect(renderQuickCommand('git add -A\ngit commit -m {{msg}}', { msg: 'x' })).toBe('git add -A\ngit commit -m x')
    })

    it('同一参数多次出现全部替换', () => {
        expect(renderQuickCommand('{{a}} && {{a}}', { a: 'ls' })).toBe('ls && ls')
    })
})

describe('previewQuickCommand', () => {
    it('折叠空白为单行', () => {
        expect(previewQuickCommand('git add -A\ngit commit')).toBe('git add -A git commit')
    })

    it('超长截断并加省略号', () => {
        expect(previewQuickCommand('a'.repeat(80), 10)).toBe('a'.repeat(9) + '…')
    })
})

describe('groupQuickCommandSections', () => {
    const groups = [
        { id: 'g2', name: 'Zeta' },
        { id: 'g1', name: 'Alpha' },
    ]
    const commands = [
        { id: 'a', groupId: 'g1' },
        { id: 'b', groupId: 'g2' },
        { id: 'c' },
        { id: 'd', groupId: 'missing' },
    ]

    it('未分组置顶无标题，分组按组名排序', () => {
        const sections = groupQuickCommandSections(commands, groups)
        expect(sections.map(s => s.title)).toEqual([null, 'Alpha', 'Zeta'])
        expect(sections[0]!.items.map(i => i.id)).toEqual(['c'])
        expect(sections[1]!.items.map(i => i.id)).toEqual(['a'])
    })

    it('保留空分组（渲染层自行隐藏）', () => {
        const sections = groupQuickCommandSections([], groups)
        expect(sections.map(s => s.title)).toEqual(['Alpha', 'Zeta'])
        expect(sections[0]!.items).toEqual([])
    })

    it('引用不存在分组的命令不归入任何段', () => {
        const sections = groupQuickCommandSections(commands, groups)
        expect(sections.flatMap(s => s.items.map(i => i.id))).not.toContain('d')
    })
})
