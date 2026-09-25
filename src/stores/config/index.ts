/**
 * @description 配置 store 桶模块：对外保持 `@/stores/config` 的完整公开面不变
 *              （类型 / 默认值与纯函数 / flush 引擎 / store 本体统一再导出）。
 */
export * from './types'
export * from './defaults'
export * from './flush'
export * from './store'
