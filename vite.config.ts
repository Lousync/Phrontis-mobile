import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// server.host: 局域网可访问（手机同 WiFi 直连 dev 服务）
// 显式设置 fs.allow 会覆盖默认值，worktree 根目录自身也要放行，否则根页面就 403
const ROOT = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    // 平板开发线独立端口：5173 留给主树开发线
    port: 5180,
    // node_modules 是指向主仓（Phrontis-mobile）的 junction，vite dev 按 realpath
    // 判定模块来源，真身在 worktree 之外 → 不放行静态资源会 403。
    // 普通 checkout 下 realpath 即自身路径，此配置零副作用，合并回主线无需回退。
    fs: { allow: [ROOT, realpathSync(new URL('./node_modules', import.meta.url))] },
  },
  // 与主树 dev server 共用同一个 junction node_modules，dep 预构建缓存分目录，
  // 避免两条并行开发线互相触发 re-optimize 打架（合并回主线时此项按需回收）
  cacheDir: 'node_modules/.vite-tablet',
})
