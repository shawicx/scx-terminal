/**
 * @description cd 命令目标路径解析单元测试：绝对/相对/~、引号目标、多命令取
 *              最后一个 cd、不可知形态（变量/通配符/cd -/~user）返回 null。
 */
import { describe, expect, it } from 'vitest'
import { normalizeRemotePath, resolveCdTarget } from './resolveCdTarget'

describe('normalizeRemotePath', () => {
    it('collapses dot segments and parent traversal', () => {
        expect(normalizeRemotePath('/var/log/../lib')).toBe('/var/lib')
        expect(normalizeRemotePath('/a/./b/./c')).toBe('/a/b/c')
        expect(normalizeRemotePath('/a/../../..')).toBe('/')
        expect(normalizeRemotePath('/')).toBe('/')
    })

    it('collapses trailing slashes and duplicate slashes', () => {
        expect(normalizeRemotePath('/var/log/')).toBe('/var/log')
        expect(normalizeRemotePath('//var//log')).toBe('/var/log')
    })
})

describe('resolveCdTarget', () => {
    const home = '/home/scx'

    it('resolves absolute and relative targets against the base', () => {
        expect(resolveCdTarget('cd /var/log', '/tmp', home)).toBe('/var/log')
        expect(resolveCdTarget('cd logs', '/var', home)).toBe('/var/logs')
        expect(resolveCdTarget('cd ../lib', '/var/log', home)).toBe('/var/lib')
        expect(resolveCdTarget('cd ./x/../y', '/var', home)).toBe('/var/y')
    })

    it('resolves home targets (bare cd, ~, ~/sub)', () => {
        expect(resolveCdTarget('cd', '/tmp', home)).toBe(home)
        expect(resolveCdTarget('cd ~', '/tmp', home)).toBe(home)
        expect(resolveCdTarget('cd ~/projects', '/tmp', home)).toBe('/home/scx/projects')
        // home 未知时放弃
        expect(resolveCdTarget('cd', '/tmp', null)).toBeNull()
        expect(resolveCdTarget('cd ~/p', '/tmp', null)).toBeNull()
    })

    it('supports quoted targets containing spaces', () => {
        expect(resolveCdTarget("cd 'my dir'", '/var', home)).toBe('/var/my dir')
        expect(resolveCdTarget('cd "my dir"', '/var', home)).toBe('/var/my dir')
        expect(resolveCdTarget('cd /opt/"my app"', '/var', home)).toBe('/opt/my app')
    })

    it('skips the explicit -- separator (pane navigation form)', () => {
        expect(resolveCdTarget("cd -- '/var/log'", '/tmp', home)).toBe('/var/log')
    })

    it('uses the last cd of a multi-command line', () => {
        expect(resolveCdTarget('cd /a && ls; cd /b', '/tmp', home)).toBe('/b')
        expect(resolveCdTarget('cd /a; cd /b || true', '/tmp', home)).toBe('/b')
    })

    it('ignores lines where cd is not the command', () => {
        expect(resolveCdTarget('ls /var', '/tmp', home)).toBeNull()
        expect(resolveCdTarget('echo cd /var', '/tmp', home)).toBeNull()
        expect(resolveCdTarget('mcd /var', '/tmp', home)).toBeNull()
    })

    it('returns null for unknowable targets instead of guessing', () => {
        expect(resolveCdTarget('cd $HOME', '/tmp', home)).toBeNull()
        expect(resolveCdTarget('cd "$(pwd)"', '/tmp', home)).toBeNull()
        expect(resolveCdTarget('cd -', '/tmp', home)).toBeNull()
        expect(resolveCdTarget('cd ~other', '/tmp', home)).toBeNull()
        expect(resolveCdTarget('cd *', '/tmp', home)).toBeNull()
        expect(resolveCdTarget('cd $1', '/tmp', home)).toBeNull()
    })

    it('returns null for relative targets without a base', () => {
        expect(resolveCdTarget('cd logs', null, home)).toBeNull()
    })
})
