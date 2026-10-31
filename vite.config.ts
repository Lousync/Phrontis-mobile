import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// server.host: 局域网可访问（手机同 WiFi 直连 dev 服务）
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: true, port: 5173 },
})
