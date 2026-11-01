import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.lousync.phrontis',
  appName: 'Phrontis',
  webDir: 'dist',
  /* 出网走原生 HTTP 桥（设计拍板 M4a）：window.fetch 全量补丁到原生层，绕开 WebView CORS ——
   * 等价于桌面「主进程 fetch」的架构位置；opencode 会话头等自定义头在真机上才发得出去。
   * 浏览器 dev/smoke 不受此配置影响（桥不存在，仍是普通 fetch，跨域被拦属预期降级路径）。 */
  plugins: {
    CapacitorHttp: { enabled: true },
  },
}

export default config
