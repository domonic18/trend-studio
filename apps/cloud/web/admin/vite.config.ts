import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const apiTarget = process.env.ADMIN_DEV_API ?? 'http://127.0.0.1:3939'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/admin/',
  plugins: [react()],
  resolve: {
    // 渲染组件包与学员端共用，react 实例必须唯一，否则 hooks 失效。
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: fileURLToPath(new URL('../../dist/admin', import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
          antd: ['antd'],
          icons: ['@ant-design/icons'],
          markdown: ['react-markdown', 'remark-gfm'],
          media: ['hls.js'],
        },
      },
    },
  },
  server: {
    port: 5173,
    fs: {
      // 渲染组件包（packages/widgets）在仓库根，超出 admin 子树，需要放开到仓库根。
      allow: [fileURLToPath(new URL('../..', import.meta.url))],
    },
    proxy: {
      '/v1': { target: apiTarget, changeOrigin: true },
    },
  },
})
