/* 把前端产物与 Capacitor 配置同步进 android 工程（替代 cap sync 的 update + copy 两步）。
 *
 * 为什么不用 cap sync：
 *   1. 本机 safe-delete 垫片会挡掉它「先删旧 assets 目录」那一步，且失败后不回滚 ——
 *      APK 照样 BUILD SUCCESSFUL，打进去的却是旧前端（实测踩过，从产物上极难发现）。
 *   2. capacitor.config.json 被 android/.gitignore 忽略，属生成物。忘了同步，原生层就读不到
 *      plugins 配置 —— 曾因此 CapacitorHttp 一直是关的，AI 直连在真机上被 CORS 全拦，
 *      而桌面端（Electron 主进程直连）一切正常，排查成本极高。
 *
 * 用法：node scripts/sync-android.mjs（npm run android:apk 已接上）
 */
import fs from 'node:fs'
import { loadConfigFromFile } from 'vite'

const DIST = 'dist'
const DST = 'android/app/src/main/assets/public'
const CFG = 'android/app/src/main/assets/capacitor.config.json'

/* 1) 配置：从 capacitor.config.ts 现算，保证与源码永远一致 */
const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, 'capacitor.config.ts')
if (!loaded) throw new Error('读不到 capacitor.config.ts')
fs.mkdirSync('android/app/src/main/assets', { recursive: true }) // 全新克隆没有此目录（git 不跟踪空目录），直接写 config 会 ENOENT
fs.writeFileSync(CFG, JSON.stringify(loaded.config, null, '\t') + '\n')
console.log('[sync] config →', CFG, JSON.stringify(loaded.config.plugins ?? {}))

/* 2) 产物：以 dist 的资产名单为白名单，删掉旧 hash 再覆盖写
 *    （不能拿 index.html 的引用当白名单：按需 import() 的 chunk 不在 html 里） */
if (!fs.existsSync(DIST + '/assets')) throw new Error('dist 不存在，先跑 vite build')
const keep = new Set(fs.readdirSync(DIST + '/assets'))
let removed = 0
if (fs.existsSync(DST + '/assets')) { // 全新克隆没有旧产物目录，跳过清理（下一步 cpSync 会全量写入）
  for (const f of fs.readdirSync(DST + '/assets')) {
    if (!keep.has(f)) {
      fs.unlinkSync(DST + '/assets/' + f)
      removed++
    }
  }
}
fs.cpSync(DIST, DST, { recursive: true, force: true })
console.log('[sync] assets →', fs.readdirSync(DST + '/assets').join(', '), removed ? `（清掉 ${removed} 个旧文件）` : '')
