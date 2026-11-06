import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.lousync.phrontis',
  appName: 'Phrontis',
  webDir: 'dist',
  android: {
    /* ★ 让 WebView 铺满全屏，由前端读原生注入的 --safe-top / --safe-bottom 自己留白。
     * Capacitor 默认（auto/force）会给 WebView 设 systemBars 的 margins，状态栏那条区域
     * 由 Activity 的 windowBackground 填充 —— 而本项目有 7 套主题，原生主题色不可能跟着变，
     * 视觉上就是「顶部那条跟界面不是一个软件」。铺满后状态栏区由页面自己绘制，天然跟随主题。 */
    adjustMarginsForEdgeToEdge: 'disable',
  },
  /* 出网走原生 HTTP 桥（设计拍板 M4a）：window.fetch 全量补丁到原生层，绕开 WebView CORS ——
   * 等价于桌面「主进程 fetch」的架构位置；opencode 会话头等自定义头在真机上才发得出去。
   * 浏览器 dev/smoke 不受此配置影响（桥不存在，仍是普通 fetch，跨域被拦属预期降级路径）。
   * ⚠ 这份配置会被写进 android/app/src/main/assets/capacitor.config.json（git 忽略的生成物），
   *   必须用 npm run android:apk（内部调 scripts/sync-android.mjs）打包，否则原生读不到。 */
  plugins: {
    CapacitorHttp: { enabled: true },
  },
}

export default config
