import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { version as pkgVersion } from './package.json'

// server.host: 局域网可访问（手机同 WiFi 直连 dev 服务）
/* 版本单一真相源 = 本文件旁的 package.json：界面版本行由 __APP_VERSION__ 取，
 * Android 的 versionName/versionCode 由 android/app/build.gradle 读同一份派生（抬版只改一处）。 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: true, port: 5173 },
  define: { __APP_VERSION__: JSON.stringify(pkgVersion) },
})
