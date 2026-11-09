/**
 * 应用内更新（2026-11-09，docs/design.md §7.1 冻结设计的 JS 半边）——移植桌面
 * Phrontis/src/lib/updateStore.ts（状态机/文案）+ electron/lib/updateService.ts（检查/镜像链）。
 * 原生半边（字节下载/校验/拉安装器）在 PhrontisUpdater.java，本模块只做编排。
 *
 * 检查链路：GET releases?per_page=30 过滤 `-mobile` tag（不能 releases/latest——与桌面混排，§7.1）
 *   → 两件套之二 mobile-latest.json 走镜像候选拉取（version/sha256/size/notes 的权威来源）
 *   → 与 __APP_VERSION__ semver 对比（与 Android versionName 同源自 package.json，等价 §7.1
 *   所说「Capacitor App 插件取 versionName」，免新增依赖）。
 * 下载链路：镜像候选链（用户镜像 → 备用节点 → 直连）由 JS 算好整体传给原生插件，
 *   原生逐候选「下载 → size/sha256 双校验」，坏包自动换下一候选；断点续传在原生。
 *
 * 状态订阅用 useSyncExternalStore（全仓先例，约定偏差已记录 design.md 修订表）：
 * 进度事件 200ms 一跳，走 store.tsx 的 Context 会牵动全部常挂页面重渲染，
 * 此 hook 只重渲染订阅组件（桌面版同构已验证）。
 */
import { useSyncExternalStore } from 'react'
import { Capacitor, registerPlugin } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { loadJson, saveJson } from './sync'

/* ---- 原生插件（仅 Android 注册，见 PhrontisUpdater.java） ---- */

interface PhrontisUpdaterPlugin {
  download(opts: { urls: string[]; name: string; expectedSize?: number; sha256?: string }): Promise<{
    success: boolean
    path?: string
    size?: number
    metaMissing?: boolean
    paused?: boolean
    cancelled?: boolean
    reason?: string
    message?: string
  }>
  pauseDownload(): Promise<{ ok: boolean; message?: string }>
  cancelDownload(): Promise<{ ok: boolean; removedPartial?: boolean }>
  canInstall(): Promise<{ granted: boolean; sdkInt?: number }>
  openInstallPermSettings(): Promise<{ success: boolean; message?: string }>
  install(opts: { path: string }): Promise<{ success: boolean; message?: string }>
  openReleasePage(opts: { url: string }): Promise<{ success: boolean; message?: string }>
  addListener(eventName: string, cb: (data: never) => void): Promise<PluginListenerHandle> & PluginListenerHandle
}
const PhrontisUpdater = registerPlugin<PhrontisUpdaterPlugin>('PhrontisUpdater')

/* ---- 常量：发布仓与镜像链（§7.1 冻结 + 桌面实测清单） ---- */

const REPO = 'Lousync/Phrontis'
const API_RELEASES = `https://api.github.com/repos/${REPO}/releases`
const RELEASES_PAGE = `https://github.com/${REPO}/releases`

/**
 * 镜像默认值（与桌面 updateService.ts 一致）。从未配置过 → 默认走镜像；
 * 用户显式置空 = 强制直连。gh-proxy 协议：https://镜像/https://github.com/...
 */
const DEFAULT_UPDATE_MIRROR = 'https://gh-proxy.com'

/**
 * 已知可用的 ghproxy 节点（下载速度与缓存健康度不定，作为用户镜像之后的兜底候选）。
 * 桌面 2026-09-15 移除 `cdn.gh-proxy.com`：实测对同一资产 206 响应头后 0 字节即 terminated
 * （坏节点），留在候选里只会每次白等一轮再换通道。ghfast.top 为本机 git 实际在用的镜像，一并列入快捷填充。
 */
const FALLBACK_MIRRORS = ['https://gh-proxy.com', 'https://gh.dpik.top']

/** 设置页「常用」快捷填充 chips */
export const QUICK_MIRRORS = ['https://gh-proxy.com', 'https://gh.dpik.top', 'https://ghfast.top']

const native = () => Capacitor.isNativePlatform()
/** 应用内更新仅 Android 原生壳可用（插件只注册在 Android；web dev / iOS 一律 no-op） */
export const updateSupported = (): boolean => native() && Capacitor.getPlatform() === 'android'

/* ---- 持久化：镜像配置 + 静默检查节流（pm.update，仿 ai.ts 的 K_AI_CONFIG 模式） ---- */

const K_UPDATE = 'pm.update'
interface UpdatePrefs {
  /** 用户显式配置的镜像前缀；undefined = 从未配置（用默认镜像），'' = 直连 */
  mirror?: string
  /** 上次启动静默检查完成时刻（§7.1：≥24h 节流） */
  lastSilentCheckAt?: number
}

function readPrefs(): UpdatePrefs {
  return loadJson<UpdatePrefs>(K_UPDATE, {})
}

function writePrefs(patch: Partial<UpdatePrefs>): void {
  saveJson(K_UPDATE, { ...readPrefs(), ...patch })
}

/** 设置页输入框的显示值：从未配置过 → 显示默认镜像（桌面同款：输入框里直接可见） */
export function getMirrorInput(): string {
  const m = readPrefs().mirror
  return m === undefined ? DEFAULT_UPDATE_MIRROR : m
}

export function setMirrorInput(v: string): void {
  writePrefs({ mirror: v.trim() })
}

/** 规范化用户配置的镜像前缀：非法返回 null（空串 = 直连） */
function resolveMirror(): string | null {
  const raw = readPrefs().mirror
  let s: string
  if (raw === undefined) s = DEFAULT_UPDATE_MIRROR
  else {
    s = String(raw).trim().replace(/\/+$/, '')
    if (!s) return null
  }
  if (!/^https:\/\/[\w.-]+(:\d+)?$/.test(s)) return null
  return s
}

/** 镜像切换检测的基准值（'' = 直连）；归一化 null 与 '' 同口径 */
function mirrorKey(): string {
  return resolveMirror() ?? ''
}

/** 由 GitHub 白名单 URL 构造下载候选：[用户镜像, 备用镜像..., 直连]——镜像在前保速度，直连兜底保可用 */
function downloadCandidates(url: string): string[] {
  const mirror = resolveMirror()
  const list: string[] = []
  if (mirror) list.push(`${mirror}/${url}`)
  for (const m of FALLBACK_MIRRORS) {
    if (m !== mirror) list.push(`${m}/${url}`)
  }
  list.push(url)
  return list
}

/* ---- 版本对比（移植桌面 updateService.ts isNewer） ---- */

function normalizeVersion(v: string): number[] {
  const cleaned = v.trim().replace(/^v/i, '').split('-')[0]
  return cleaned.split('.').map(n => parseInt(n, 10) || 0)
}

function isNewer(latest: string, current: string): boolean {
  const a = normalizeVersion(latest)
  const b = normalizeVersion(current)
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false
  }
  return false
}

/* ---- 检查：releases 过滤 -mobile → 两件套 manifest ---- */

export interface UpdateAsset {
  name: string
  url: string
  size: number
  /** mobile-latest.json 提供的期望校验和（十六进制），空 = 仅 size 校验兜底 */
  sha256: string
}

export interface UpdateCheckResult {
  ok: boolean
  hasUpdate: boolean
  currentVersion: string
  latestVersion: string
  releaseUrl: string
  notes: string
  asset: UpdateAsset | null
  message?: string
}

interface MobileManifest {
  version?: string
  apk?: string
  sha256?: string
  size?: number
  notes?: string
  mobileCommit?: string
  publishedAt?: string
}

async function fetchJson(url: string, timeoutMs = 12000): Promise<unknown> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/vnd.github+json' } })
    if (!r.ok) throw new Error(`GitHub API 返回 HTTP ${r.status}`)
    return await r.json()
  } finally {
    clearTimeout(timer)
  }
}

/** manifest 走镜像候选拉取（与 APK 同目录，镜像通道同样可用）；text/html = 镜像错误页，换下一候选 */
async function fetchManifest(assetUrl: string): Promise<MobileManifest> {
  for (const candidate of downloadCandidates(assetUrl)) {
    try {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), 10000)
      let r: Response
      try {
        r = await fetch(candidate, { signal: ctl.signal })
      } finally {
        clearTimeout(timer)
      }
      if (!r.ok) continue
      if (/text\/html/i.test(r.headers.get('content-type') || '')) continue
      const m = (await r.json()) as MobileManifest
      if (m && typeof m.version === 'string' && typeof m.apk === 'string') return m
    } catch { /* 换下一候选 */ }
  }
  throw new Error('mobile-latest.json 不可达（发布侧两件套可能不全）')
}

async function checkForUpdate(): Promise<UpdateCheckResult> {
  const currentVersion = __APP_VERSION__
  try {
    const rels = await fetchJson(`${API_RELEASES}?per_page=30`)
    if (!Array.isArray(rels)) throw new Error('GitHub API 返回异常')
    /* releases 按创建时间倒序，第一个 -mobile tag 即手机线最新 */
    const rel = (rels as Array<Record<string, unknown>>).find(
      r => typeof r?.tag_name === 'string' && String(r.tag_name).toLowerCase().endsWith('-mobile'),
    )
    if (!rel) {
      /* 还没有过手机版发布：不是错误，视为已是最新 */
      return { ok: true, hasUpdate: false, currentVersion, latestVersion: '', releaseUrl: RELEASES_PAGE, notes: '', asset: null }
    }
    const latestVersion = String(rel.tag_name).replace(/^v/i, '').replace(/-mobile$/i, '')
    if (!latestVersion) throw new Error('未找到版本号')
    const mrel = (rel.assets as Array<Record<string, unknown>> | undefined)?.find(a => a?.name === 'mobile-latest.json')
    if (!mrel?.browser_download_url) throw new Error('mobile-latest.json 缺失（发布侧两件套不全）')
    const manifest = await fetchManifest(String(mrel.browser_download_url))
    const apkAsset = (rel.assets as Array<Record<string, unknown>>).find(a => a?.name === manifest.apk)
    if (!apkAsset?.browser_download_url) throw new Error(`APK 资产 ${manifest.apk} 缺失`)
    const asset: UpdateAsset = {
      name: String(manifest.apk),
      url: String(apkAsset.browser_download_url),
      size: Number(manifest.size) || Number(apkAsset.size) || 0,
      sha256: String(manifest.sha256 || ''),
    }
    return {
      ok: true,
      hasUpdate: isNewer(latestVersion, currentVersion),
      currentVersion,
      latestVersion: String(manifest.version || latestVersion),
      releaseUrl: String(rel.html_url || RELEASES_PAGE),
      notes: String(manifest.notes || rel.body || ''),
      asset,
    }
  } catch (e) {
    return {
      ok: false,
      hasUpdate: false,
      currentVersion,
      latestVersion: '',
      releaseUrl: RELEASES_PAGE,
      notes: '',
      asset: null,
      message: e instanceof Error ? e.message : String(e),
    }
  }
}

/* ---- 全局状态机（移植桌面 updateStore.ts；模块级可变状态 + useSyncExternalStore） ---- */

export type UpdatePhase =
  | 'idle'        // 未检查
  | 'checking'    // 检查中
  | 'uptodate'    // 已是最新
  | 'available'   // 有新版本
  | 'downloading' // 下载中
  | 'paused'      // 暂停(断点保留)
  | 'downloaded'  // 下载完成,待安装
  | 'error'       // 检查/下载失败(见 reason)

export type UpdateFailReason =
  | 'size-mismatch' | 'sha256-mismatch' | 'network' | 'stalled' | 'channel-all-failed' | 'cancelled' | 'unknown'

/**
 * 下载子阶段（原生 updStage 事件推送）——专治「进度无变化时的无声空窗」：
 * verifying = 流已收完、正在比对校验和；switching = 上一通道无响应,正在换镜像。
 */
export type UpdateDownloadStage = 'downloading' | 'verifying' | 'switching'

export interface UpdateCheckInfo {
  currentVersion: string
  latestVersion: string
  releaseUrl: string
  notes: string
  asset: UpdateAsset
}

export interface UpdateSnapshot {
  phase: UpdatePhase
  check: UpdateCheckInfo | null
  progress: { percent: number; receivedBytes: number; totalBytes: number }
  stage: UpdateDownloadStage
  error: string
  reason: UpdateFailReason
  /** manifest 缺 sha256（发布侧两件套不全），仅剩 size 校验兜底 */
  metaMissing: boolean
  downloadedPath: string
}

// ---- 可变状态(仅本模块可写) ----
let phase: UpdatePhase = 'idle'
let check: UpdateCheckInfo | null = null
let progress = { percent: 0, receivedBytes: 0, totalBytes: 0 }
let stage: UpdateDownloadStage = 'downloading'
let error = ''
let reason: UpdateFailReason = 'unknown'
let metaMissing = false
let downloadedPath = ''

let snap: UpdateSnapshot = buildSnapshot()
const listeners = new Set<() => void>()

function buildSnapshot(): UpdateSnapshot {
  return { phase, check, progress, stage, error, reason, metaMissing, downloadedPath }
}

function emit(): void {
  snap = buildSnapshot()
  for (const l of listeners) l()
}

function set(patch: Partial<{
  phase: UpdatePhase
  check: UpdateCheckInfo | null
  progress: typeof progress
  stage: UpdateDownloadStage
  error: string
  reason: UpdateFailReason
  metaMissing: boolean
  downloadedPath: string
}>): void {
  if (patch.phase !== undefined) phase = patch.phase
  if (patch.check !== undefined) check = patch.check
  if (patch.progress !== undefined) progress = patch.progress
  if (patch.stage !== undefined) stage = patch.stage
  if (patch.error !== undefined) error = patch.error
  if (patch.reason !== undefined) reason = patch.reason
  if (patch.metaMissing !== undefined) metaMissing = patch.metaMissing
  if (patch.downloadedPath !== undefined) downloadedPath = patch.downloadedPath
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function getSnapshot(): UpdateSnapshot {
  return snap
}

/** React 订阅入口：const upd = useUpdateState()（只重渲染订阅组件，不牵动全局 Context） */
export function useUpdateState(): UpdateSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot)
}

/** 失败分类：'integrity' → 换镜像/重新下载；'network' → 重试；其余展示原始 message */
export function updateFailKind(r: UpdateFailReason): 'integrity' | 'network' | 'neutral' {
  if (r === 'size-mismatch' || r === 'sha256-mismatch') return 'integrity'
  if (r === 'network' || r === 'channel-all-failed' || r === 'stalled') return 'network'
  return 'neutral'
}

/** 失败态展示文案(按 reason 结构化,不让用户猜;移植桌面,sha512 字样改 sha256) */
export function updateFailMessage(s: UpdateSnapshot): string {
  switch (s.reason) {
    case 'size-mismatch': return '下载内容校验失败:文件大小不符,服务器文件可能未传完整'
    case 'sha256-mismatch': return '下载内容校验失败:SHA256 校验不符,镜像可能返回了坏字节'
    case 'network': return '网络连接失败,请检查网络或更换下载镜像'
    // stalled = 通道挂着不停也不回,15s 窗口内零新字节;已自动换过通道,全部失败才会走到这里
    case 'stalled': return '下载通道长时间无响应(可能被限速或中途静默),已尝试更换镜像;可重试或在设置里更换下载镜像'
    case 'channel-all-failed': return '所有下载通道均失败,请检查网络或更换下载镜像'
    default: return s.error || '下载失败'
  }
}

/** 下载中「非进度类」提示文案 —— downloading 返回 null(此时按常规进度条渲染) */
export function updateStageText(stage: UpdateDownloadStage): string | null {
  if (stage === 'verifying') return '校验中…'
  if (stage === 'switching') return '通道无响应,正在切换镜像…'
  return null
}

// ---- 进度事件:全局只订阅一次(移植 bindProgressOnce) ----
let progressBound = false
function bindProgressOnce(): void {
  if (progressBound || !updateSupported()) return
  progressBound = true
  PhrontisUpdater.addListener('updProgress', p => {
    const d = p as unknown as { percent: number; receivedBytes: number; totalBytes: number }
    progress = { percent: d.percent, receivedBytes: d.receivedBytes, totalBytes: d.totalBytes }
    if (phase === 'downloading') emit()
  })
  // 阶段事件与进度同源、只订阅一次;相同阶段直接丢弃(原生每个候选都会重发 downloading)
  PhrontisUpdater.addListener('updStage', s => {
    const d = s as unknown as { stage: UpdateDownloadStage }
    if (d.stage === stage) return
    stage = d.stage
    if (phase === 'downloading') emit()
  })
}

// ---- 动作 ----

/** 手动检查(设置页「检查更新」) */
export async function updateCheck(): Promise<void> {
  bindProgressOnce()
  if (!updateSupported()) return
  set({ phase: 'checking', error: '', reason: 'unknown' })
  const r = await checkForUpdate()
  if (!r.ok) {
    set({ phase: 'error', error: r.message || '检查失败,请检查网络', reason: 'network', check: null })
    return
  }
  if (r.hasUpdate && r.asset) {
    set({
      phase: 'available',
      check: { currentVersion: r.currentVersion, latestVersion: r.latestVersion, releaseUrl: r.releaseUrl, notes: r.notes, asset: r.asset },
      error: '', metaMissing: false, progress: { percent: 0, receivedBytes: 0, totalBytes: r.asset.size },
    })
  } else {
    set({ phase: 'uptodate', error: '' })
  }
}

/** 镜像热切换(桌面 MIRROR_CHANGED 的 JS 侧等价):下载中每 2s 比对基准,
 * 用户改了镜像设置 → 调插件暂停(断点保留) → 外层循环按新镜像重算候选续传 */
let mirrorTimer: number | null = null
let mirrorSwapped = false
function armMirrorWatcher(baseline: string): void {
  disarmMirrorWatcher()
  mirrorSwapped = false
  mirrorTimer = window.setInterval(() => {
    if (!mirrorSwapped && mirrorKey() !== baseline) {
      mirrorSwapped = true
      void PhrontisUpdater.pauseDownload().catch(() => { /* 下载 promise 自会以 paused 收尾 */ })
    }
  }, 2000)
}

function disarmMirrorWatcher(): void {
  if (mirrorTimer !== null) {
    clearInterval(mirrorTimer)
    mirrorTimer = null
  }
}

/** 下载(available/paused → downloading;断点续传由原生负责) */
export async function updateDownload(): Promise<void> {
  bindProgressOnce()
  if (!updateSupported() || !check?.asset || phase === 'downloading') return
  set({
    phase: 'downloading', stage: 'downloading', error: '', reason: 'unknown', metaMissing: false,
    progress: { percent: 0, receivedBytes: 0, totalBytes: check.asset.size },
  })
  /* 镜像热切换重开循环,上限 5 次(移植桌面 restarts 上限,防反复自杀) */
  let restarts = 0
  while (true) {
    const baseline = mirrorKey()
    armMirrorWatcher(baseline)
    let r: Awaited<ReturnType<PhrontisUpdaterPlugin['download']>>
    try {
      r = await PhrontisUpdater.download({
        urls: downloadCandidates(check.asset.url),
        name: check.asset.name,
        expectedSize: check.asset.size,
        sha256: check.asset.sha256,
      })
    } catch (e) {
      r = { success: false, reason: 'network', message: e instanceof Error ? e.message : String(e) }
    }
    disarmMirrorWatcher()
    if (r.success && r.path) {
      set({
        phase: 'downloaded', stage: 'downloading', downloadedPath: r.path,
        metaMissing: !!r.metaMissing,
        progress: { percent: 100, receivedBytes: r.size ?? check.asset.size, totalBytes: check.asset.size },
      })
      return
    }
    if (r.paused) {
      if (mirrorSwapped && restarts < 5) {
        /* 换镜像纠错:断点保留,按新镜像重算候选列表继续下 */
        restarts++
        set({ stage: 'switching' })
        continue
      }
      set({ phase: 'paused' }) // 进度与阶段保留在暂停时的值(继续下载时由原生重新推 downloading)
      return
    }
    if (r.cancelled) {
      set({ phase: 'available', stage: 'downloading', progress: { percent: 0, receivedBytes: 0, totalBytes: check.asset.size } })
      return
    }
    set({
      phase: 'error', stage: 'downloading', error: r.message || '下载失败',
      reason: (r.reason as UpdateFailReason) || 'unknown',
      progress: { percent: 0, receivedBytes: 0, totalBytes: check.asset.size },
    })
    return
  }
}

/** 暂停(下载 promise 将以 paused 结束,由 updateDownload 收尾) */
export async function updatePause(): Promise<void> {
  if (!updateSupported()) return
  await PhrontisUpdater.pauseDownload().catch(() => { /* no-op */ })
}

/** 取消(清除断点,回到 available) */
export async function updateCancel(): Promise<void> {
  if (!updateSupported()) return
  await PhrontisUpdater.cancelDownload().catch(() => { /* no-op */ })
  // phase 修正由 updateDownload 的 cancelled 分支完成;无进行中下载时在此兜底
  if (phase === 'downloading' || phase === 'paused') {
    set({ phase: 'available', stage: 'downloading', progress: { percent: 0, receivedBytes: 0, totalBytes: check?.asset?.size || 0 } })
  }
}

/** 拉起系统安装器(最后一步必须用户点「安装」——Android 侧载无静默安装,§7.1) */
export async function updateInstall(): Promise<void> {
  if (!updateSupported() || !downloadedPath) return
  try {
    const r = await PhrontisUpdater.install({ path: downloadedPath })
    if (!r.success) set({ phase: 'error', error: r.message || '启动安装器失败', reason: 'unknown' })
    // 成功 → 安装器接管,应用退后台;装完回来由插件 load() 的清理 marker 收尾,无需变更状态
  } catch (e) {
    set({ phase: 'error', error: e instanceof Error ? e.message : '启动安装器失败', reason: 'unknown' })
  }
}

/** 「允许安装未知应用」授权态(设置页引导行用) */
export async function installPermGranted(): Promise<boolean> {
  if (!updateSupported()) return false
  try {
    const r = await PhrontisUpdater.canInstall()
    return !!r.granted
  } catch {
    return false
  }
}

export async function openInstallPermSettings(): Promise<{ success: boolean; message?: string }> {
  if (!updateSupported()) return { success: false, message: '仅 Android 应用内可用' }
  return PhrontisUpdater.openInstallPermSettings()
}

export async function openReleasePage(url: string): Promise<void> {
  if (!updateSupported()) return
  await PhrontisUpdater.openReleasePage({ url }).catch(() => { /* 兜底路失败即失败 */ })
}

// ---- 启动静默检查(移植桌面 updateStartupCheck + §7.1 的 24h 节流) ----

/** 发现新版的回调:由 AppProvider 注入 toast(本模块不依赖全局 Context) */
let foundNotifier: ((version: string) => void) | null = null
export function setUpdateFoundNotifier(cb: (version: string) => void): void {
  foundNotifier = cb
}

/** ≥24h 节流(§7.1):24h 内的启动不再发任何请求 */
const SILENT_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

/**
 * 启动静默检查:延迟 6s 不与启动初始化抢网络,失败按 10s 间隔重试 3 次后彻底静默
 * (不进 error 态,避免网络抖动打扰用户);完成(含最终放弃)记 pm.update.lastSilentCheckAt。
 * 全局只执行一次,重复调用是幂等 no-op。web/iOS 直接不跑。
 */
let startupStarted = false
export function updateStartupCheck(): void {
  if (startupStarted) return
  startupStarted = true
  if (!updateSupported()) return
  if (Date.now() - (readPrefs().lastSilentCheckAt ?? 0) < SILENT_CHECK_INTERVAL_MS) return
  let attempt = 0
  const run = async (): Promise<void> => {
    bindProgressOnce()
    // 用户已手动触发下载/安装 → 不再静默检查,避免覆盖进行中的状态
    if (phase === 'downloading' || phase === 'paused' || phase === 'downloaded') return
    try {
      const r = await checkForUpdate()
      writePrefs({ lastSilentCheckAt: Date.now() })
      if (r.ok && r.hasUpdate && r.asset) {
        set({
          phase: 'available',
          check: { currentVersion: r.currentVersion, latestVersion: r.latestVersion, releaseUrl: r.releaseUrl, notes: r.notes, asset: r.asset },
          progress: { percent: 0, receivedBytes: 0, totalBytes: r.asset.size },
        })
        foundNotifier?.(r.latestVersion)
        return
      }
      if (r.ok) return // 已是最新:静默,不打扰
    } catch { /* fallthrough */ }
    if (attempt < 3) {
      attempt++
      window.setTimeout(run, 10000)
    } else {
      writePrefs({ lastSilentCheckAt: Date.now() }) // 彻底放弃也计入节流,别天天白试
    }
  }
  window.setTimeout(run, 6000)
}
