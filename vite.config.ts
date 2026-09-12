/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

const host = process.env.TAURI_ENV_HOST

export default defineConfig({
    plugins: [vue(), tailwindcss()],
    resolve: {
        alias: {
            '@': resolve(import.meta.dirname, 'src'),
        },
    },
    clearScreen: false,
    server: {
        port: 1420,
        strictPort: true,
        host: host || false,
        hmr: host
            ? { protocol: 'ws', host, port: 1421 }
            : undefined,
        watch: { ignored: ['**/src-tauri/**', '**/legacy/**'] },
    },
    envPrefix: ['VITE_', 'TAURI_ENV_'],
    build: {
        target: 'es2022',
        minify: !process.env.TAURI_ENV_DEBUG ? 'oxc' : false,
        sourcemap: !!process.env.TAURI_ENV_DEBUG,
    },
    test: {
        include: ['src/**/*.test.ts'],
        environment: 'node',
    },
})
