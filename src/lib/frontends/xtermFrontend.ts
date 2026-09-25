/**
 * @description 兼容旧路径的桶模块：实现移入 xterm/ 子目录后，`@/lib/frontends/xtermFrontend`
 *              的导入路径继续可用。
 */
export { XTermFrontend, XTermWebGLFrontend } from './xterm/frontend'
