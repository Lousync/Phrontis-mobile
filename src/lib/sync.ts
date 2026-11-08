/**
 * 手机伴侣同步引擎（M1 配对/队列，v1.1 双域 + 墓碑）。
 *
 * 协议冻结口径：docs/design.md §2.1（与桌面端
 * E:\Projects\KnowledgeRecorder\electron\lib\phoneCompanion\protocol.ts 同源，
 * 两仓独立持有一份，各自契约脚本锁行为：scripts/verify-sync.mjs）。
 *
 * v1.1（M2a）：schedule 域上线；删除走墓碑（data:{deleted:true}）；
 * 游标只在 pull 完成后推进（M1 在 push 时推进，会漏拉电脑侧早于本次 push 的变更——已修正）。
 * v1.6（2026-11-08）：notes 域升级为双向（U 盘模式）——桌面把设备文件夹里的增删改
 * 经 pull 下行（changes.notes + tombstones domain='notes'），手机 LWW 合并；
 * 旧桌面不回 notes 域 → 空数组、游标不动，向后完全兼容。协议见 docs/design.md §2.1。
 * v1.7（2026-11-08）：实时同步（C 长轮询）——pull 加可选 wait（挂起到有变更/超时），
 * 响应 waitSupported 为探测位（旧桌面没有 → 退回 30s 轮询）；RtDriver 前台常挂挂起循环，
 * 失败退避 1/2/5/10/30s 封顶。协议见 docs/design.md §2.1 v1.7 节。
 *
 * M1 存储用 localStorage（等价 Preferences 形态），M2b 评估 SQLite 迁移；
 * 所有键带 pm. 前缀，迁移时整体搬运。
 */
import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core'
import type { LedgerSyncData, NoteCache, NoteSyncData, NoteTreePage, PairedDevice, QueueOp, ScheduleSyncData, Todo } from './types'

/* 组播发现插件（仅 Android 注册，见 PhrontisDiscover.java；iOS/web 无实现 → 走扫段回退）。
 * selfIp/selfPrefix = 原生自知出口 IP 与 /24 前缀；selfPrefixes = 全部可用私有网段
 * （热点 AP 的段排最前，蜂窝接口已过滤）——热点场景下扫自己网段全靠它。 */
interface PhrontisDiscoverPlugin {
  discover(opts: { timeoutMs?: number }): Promise<{
    found: Array<{ baseUrl: string; pcName: string; protocol: number; canRequest: boolean }>
    selfIp?: string
    selfPrefix?: string
    selfPrefixes?: string[]
  }>
}
const PhrontisDiscover = registerPlugin<PhrontisDiscoverPlugin>('PhrontisDiscover')

const K_DEVICE_ID = 'pm.deviceId'
const K_PAIRED = 'pm.companion'
const K_QUEUE = 'pm.queue'
const K_LAST_SYNC = 'pm.lastSync'
const K_NOTE_TREE = 'pm.noteTree'
const K_NOTE_CACHE = 'pm.noteCache'

function lsGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch { return fallback }
}

function lsSet(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* 隐私模式等，静默 */ }
}

/** 通用本地持久化（pm. 前缀随键走）：store 用它落 todos/txs；SQLite 评估（M2b）时整体搬运 */
export function loadJson<T>(key: string, fallback: T): T {
  return lsGet<T>(key, fallback)
}

export function saveJson(key: string, value: unknown): void {
  lsSet(key, value)
}

/** UUID：http 局域网地址下 crypto.randomUUID 不可用（非安全上下文），自备 v4 兜底 */
export function uuid(): string {
  const c = globalThis.crypto
  if (typeof c?.randomUUID === 'function') {
    try { return c.randomUUID() } catch { /* 落到手动实现 */ }
  }
  const b = new Uint8Array(16)
  if (typeof c?.getRandomValues === 'function') c.getRandomValues(b)
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20)
}

const K_DEVICE_NAME = 'pm.deviceName'

/** 上报给桌面的设备名（v1.6 U 盘模式：桌面按它建「移动端/<设备名>/」文件夹）。
 * 默认 Phrontis 手机；同名设备的防撞由桌面处理（追加 deviceId 短后缀），手机端不感知。 */
export function getDeviceName(): string {
  return lsGet<string>(K_DEVICE_NAME, '') || 'Phrontis 手机'
}

export function setDeviceName(name: string): void {
  lsSet(K_DEVICE_NAME, String(name || '').trim().slice(0, 24))
}

function deviceId(): string {
  let id = lsGet<string>(K_DEVICE_ID, '')
  if (!id) {
    id = uuid()
    lsSet(K_DEVICE_ID, id)
  }
  return id
}

/** 与桌面 protocol.parsePairInput 同款语义：完整配对链接 或 host:port + 配对码 */
export function parsePairInput(text: string, codeFallback: string): { host: string; code: string } | null {
  const t = String(text || '').trim()
  if (!t) return null
  const hashAt = t.indexOf('#')
  const codeFromHash = hashAt >= 0 ? t.slice(hashAt + 1).trim() : ''
  let host = hashAt >= 0 ? t.slice(0, hashAt) : t
  host = host.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim()
  if (!/^[a-zA-Z0-9.\-]+:\d{2,5}$/.test(host)) return null
  const code = codeFromHash || String(codeFallback || '').trim()
  return /^\d{6,10}$/.test(code) ? { host, code } : null
}

/* ================= 配对 ================= */

export function getPaired(): PairedDevice | null {
  return lsGet<PairedDevice | null>(K_PAIRED, null)
}

/** 配对：POST /api/pair（配对码换长期令牌）。失败抛 Error（文案可直接 toast） */
export async function pairWith(input: string, code: string, deviceName: string): Promise<PairedDevice> {
  const parsed = parsePairInput(input, code)
  if (!parsed) throw new Error('地址格式不对：形如 192.168.1.5:8770，或直接粘贴电脑端整条配对链接')
  const base = 'http://' + parsed.host
  let body: { ok?: boolean; error?: string; deviceToken?: string; pc?: { name?: string } }
  try {
    const r = await lanRequest(base + '/api/pair', {
      method: 'POST',
      body: { code: parsed.code, deviceName },
      timeoutMs: 6000,
    })
    body = r.data as typeof body
    if (r.status < 200 || r.status >= 300 || !body?.ok || !body.deviceToken) {
      throw new Error(body?.error || '配对被拒绝（' + r.status + '）')
    }
  } catch (e) {
    if (e instanceof Error && /超时|aborted|abort/i.test(e.message)) throw new Error('连接超时：确认手机与电脑在同一网络，且电脑端服务已开启')
    if (e instanceof Error && /fetch|network|ERR_/i.test(e.message)) throw new Error('连不上电脑：检查地址、同一网络与防火墙')
    throw e instanceof Error ? e : new Error('配对失败')
  }
  const device: PairedDevice = {
    baseUrl: base,
    token: body.deviceToken!,
    pcName: body.pc?.name || '我的电脑',
    deviceId: deviceId(),
    pairedAt: Date.now(),
  }
  lsSet(K_PAIRED, device)
  rememberScanPrefix(parsed.host)
  const port = Number(parsed.host.split(':')[1])
  if (Number.isFinite(port)) rememberScanPort(port)
  return device
}

export function unpair(): void {
  try { localStorage.removeItem(K_PAIRED) } catch { /* 忽略 */ }
}

/** 已配对设备的持久化（地址修复：电脑换 IP/网段后仅替换 baseUrl，令牌保留） */
export function savePaired(device: PairedDevice): void {
  lsSet(K_PAIRED, device)
}

/* ================= 配对 v1.5：局域网发现 + 桌面确认 ================= */

/** 发现命中的电脑（手机扫段后由 /api/discover 回） */
export interface DiscoveredPc {
  baseUrl: string
  pcName: string
  protocol: number
  /** 电脑是否支持请求式配对（false → 只能走 8 位配对码） */
  canRequest: boolean
}

const K_SCAN_PREFIX = 'pm.lastScanPrefix'
const K_SCAN_PORT = 'pm.lastScanPort'

/** 热点/常见网段经验清单。2026-11-08 补热点系：Android 热点 192.168.43（旧版）/ 随机段（新 ROM 由
 *  selfPrefixes 覆盖）、Windows ICS 192.168.137、旧热点 192.168.42/49、Linux 热点 10.42.0。 */
export const COMMON_PREFIXES = [
  '192.168.43', '192.168.137', '192.168.42', '192.168.49',
  '192.168.1', '192.168.0', '192.168.31', '192.168.3', '192.168.2', '192.168.50',
  '10.0.0', '10.0.1', '10.42.0', '172.20.10',
]

/**
 * 扫描前缀合并（纯函数，契约直测）：原生自知网段（热点 AP/Wi-Fi 段，排最前）→ 记忆段 → 经验清单。
 * CGNAT（100.64/10，蜂窝流量出口）整段跳过——那是运营商大网，扫 254 个地址既不可能命中也白耗电。
 */
export function mergeScanPrefixes(input: {
  selfPrefixes?: Array<string | null | undefined>
  remembered?: string | null
  common?: Array<string | null | undefined>
}): string[] {
  const valid = (p: unknown): p is string =>
    typeof p === 'string' && /^\d{1,3}(\.\d{1,3}){2}$/.test(p) && p.split('.').every(x => Number(x) <= 255)
  const isCgnat = (p: string): boolean => {
    const [a, b] = p.split('.').map(Number)
    return a === 100 && b >= 64 && b <= 127
  }
  const self = (input.selfPrefixes ?? []).filter(valid).filter(p => !isCgnat(p))
  const remembered = valid(input.remembered) ? [input.remembered] : []
  const common = (input.common ?? []).filter(valid)
  return [...new Set([...self, ...remembered, ...common])]
}

function scanPrefixes(): string[] {
  /* 记忆的网段不限经验清单——电脑可能活在任何 /24（rememberScanPrefix 自举）；
     只做格式守卫，合法就参与合并（下次搜索优先扫它） */
  const last = lsGet<string>(K_SCAN_PREFIX, '')
  return mergeScanPrefixes({ remembered: last, common: COMMON_PREFIXES })
}

/** 扫描端口：上次命中端口排最前（桌面端口漂移后仍可秒回），冻结默认 8770 殿后；上限 5 个防扫爆 */
function scanPorts(): number[] {
  const last = lsGet<number>(K_SCAN_PORT, 0)
  const base = [8770, 8771, 8772, 8773]
  return Number.isFinite(last) && last > 0 ? [...new Set([last, ...base])].slice(0, 5) : base
}

/** 手动 IP / 扫码配对成功后记住该网段：下次「搜索电脑」直接首扫这一段——
 *  电脑可能活在经验清单外的网段（2026-11-08 实测 10.116.216.x 全网段扫不到），
 *  只要成功连过一次（配对/扫码），发现就能自举到正确网段 */
export function rememberScanPrefix(host: string): void {
  const ip = host.split(':')[0]
  const m = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/.exec(ip)
  if (m) lsSet(K_SCAN_PREFIX, m[1])
}

/** 记住命中端口（桌面被占回退 8771+ 时扫段仍秒回）；组播应答自带 port，不受此限 */
export function rememberScanPort(port: number): void {
  if (Number.isFinite(port) && port > 0) lsSet(K_SCAN_PORT, Math.round(port))
}

/** 源提示：PWA 页面若直接从电脑的 IP 加载（如局域网 dev / 部署站），主机名就是电脑本身——零配置最先探它。
 * localhost（127.0.0.1 同理）也保留为提示：桌面浏览器 dev 时电脑伴侣就在本机，
 * 页面在 localhost:5180 而伴侣在 localhost:8770，不探就永远扫不到（2026-11-08 实测）。
 * APK 内 location.hostname 同为 localhost，多探一次 600ms 无副作用。 */
function originHintHost(): string | null {
  const h = window.location.hostname
  if (!h) return null
  if (h === '127.0.0.1') return 'localhost'
  return h
}

/** 局域网伴侣请求的统一底层（发现 / 配对 / 轮询 / 同步全部走它）。
 *  原生端显式走 CapacitorHttp 插件——不能用补丁版 window.fetch：CapacitorHttp 开启后 fetch 被接管到原生，
 *  但补丁不传 connectTimeout/readTimeout（HttpURLConnection 默认 0 = 无限等）且忽略 AbortController，
 *  任何普通 fetch 在真机上都是「可能无限转圈」的假超时（2026-11-08 native-bridge.js 实锤）。
 *  显式调用的 connectTimeout/readTimeout 是真·原生超时，到点任务即回收。
 *  扫段发现 48 并发 × 9 段 × 254 台曾把 iOS CFNetwork 打到 ENOMEM（2026-11-08 iPad 实测），
 *  并发预算由调用方控制（discoverCompanions worker 数）。web dev 无原生桥，回落普通 fetch + AbortController。
 *  返回 status 供 401/离线区分；HTTP 层错误不在此抛（调用方按 status 分诊）。 */
interface LanRequestOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  headers?: Record<string, string>
  /** 读超时（也是 web 端总超时） */
  timeoutMs: number
  /** 连接超时（原生独享；缺省 = timeoutMs）。长轮询给小连接超时 + 大读超时 */
  connectTimeoutMs?: number
}
async function lanRequest(url: string, opts: LanRequestOptions): Promise<{ status: number; data: unknown }> {
  if (!Capacitor.isNativePlatform()) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs)
    try {
      const res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers: opts.headers ?? (opts.body ? { 'content-type': 'application/json' } : undefined),
        body: opts.body != null ? JSON.stringify(opts.body) : undefined,
        signal: ctrl.signal,
      })
      const data: unknown = await res.json().catch(() => ({}))
      return { status: res.status, data }
    } finally {
      clearTimeout(timer)
    }
  }
  const r = await CapacitorHttp.request({
    url,
    method: opts.method ?? 'GET',
    headers: opts.headers ?? (opts.body ? { 'content-type': 'application/json' } : undefined),
    data: opts.body != null ? (opts.body as Record<string, unknown>) : undefined,
    connectTimeout: opts.connectTimeoutMs ?? opts.timeoutMs,
    readTimeout: opts.timeoutMs,
  })
  let data: unknown = r.data
  if (typeof data === 'string') { try { data = JSON.parse(data) } catch { /* 非 JSON 当空体 */ } }
  return { status: r.status, data }
}

/** 探一个 host:port：/api/discover 通且 ok 才算命中；超时/被拒/跨域一律当没有 */
async function probePort(host: string, port: number, timeoutMs: number): Promise<DiscoveredPc | null> {
  try {
    const { status, data } = await lanRequest('http://' + host + ':' + port + '/api/discover', { timeoutMs })
    if (status < 200 || status >= 300) return null
    const body = data as { ok?: boolean; protocol?: number; pc?: { name?: string }; pairing?: string[] }
    if (!body?.ok) return null
    return {
      baseUrl: 'http://' + host + ':' + port,
      pcName: body.pc?.name || '我的电脑',
      protocol: body.protocol || 1,
      canRequest: Array.isArray(body.pairing) && body.pairing.includes('request'),
    }
  } catch {
    return null
  }
}

/** 探一台的全部扫描端口（源提示专用——它就是电脑本身，逐口试） */
async function probeHost(host: string, timeoutMs: number): Promise<DiscoveredPc | null> {
  for (const port of scanPorts()) {
    const hit = await probePort(host, port, timeoutMs)
    if (hit) return hit
  }
  return null
}

export interface DiscoverProgress { scanned: number; total: number; found: DiscoveredPc[] }

/**
 * 发现电脑（三层递进，借鉴 LocalSend 的 UDP 组播发现 + 自知网段扫段）：
 *   ① 源提示：页面源即电脑 IP 的场景（dev/部署站）零配置秒回；
 *   ② 组播（Android 原生插件 PhrontisDiscover，注册顺序修好后才真正可用）：双组喊一声、桌面单播应答，
 *      同时取回 selfPrefixes（热点 AP/Wi-Fi 段，蜂窝接口已过滤）；
 *   ③ 扫段回退：mergeScanPrefixes 合并网段（自知段 → 记忆段 → 经验清单含热点段）逐段并发探
 *      /api/discover（端口 = 记忆端口 + 8770-8773）；全局 deadline 兜底 + 首命中即停调度，
 *      iOS 并发 6（URLSession 短请求风暴会 ENOMEM，见 lanRequest 注释），Android 24。
 * 返回 diag 供「没搜到」提示展示——报障带数据（本机段/扫了多少），不再盲猜。
 */
export async function discoverCompanions(opts: {
  timeoutMs?: number
  concurrency?: number
  deadlineMs?: number
  onProgress?: (p: DiscoverProgress) => void
  signal?: AbortSignal
} = {}): Promise<{ found: DiscoveredPc[]; diag: string }> {
  const timeoutMs = opts.timeoutMs ?? 350
  const deadlineMs = opts.deadlineMs ?? 15_000
  const hint = originHintHost()
  if (hint) {
    const hit = await probeHost(hint, 600)
    if (hit) return { found: [hit], diag: '源提示命中' }
  }
  let mcastNote = ''
  let selfPrefixes: string[] = []
  if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('PhrontisDiscover')) {
    try {
      const r = await PhrontisDiscover.discover({ timeoutMs: 900 })
      const found = (r.found ?? []).map(f => ({ baseUrl: f.baseUrl, pcName: f.pcName, protocol: f.protocol, canRequest: !!f.canRequest }))
      if (found.length) {
        const m = /^http:\/\/(\d{1,3}(?:\.\d{1,3}){2}):(\d+)$/.exec(found[0].baseUrl)
        if (m) { lsSet(K_SCAN_PREFIX, m[1]); rememberScanPort(Number(m[2])) }
        return { found, diag: `组播命中 ${found.length} 台` }
      }
      /* 组播零应答 ≠ 白跑：自知网段照拿——扫自己网段是唯一不依赖组播的发现路（LocalSend 式第二条腿） */
      selfPrefixes = (r.selfPrefixes?.length ? r.selfPrefixes : r.selfPrefix ? [r.selfPrefix] : []).filter(Boolean)
      mcastNote = '组播无应答'
    } catch {
      mcastNote = '组播不可用'
    }
  }
  /* 每 worker 双探（host+port 各一目标）：worker 数对半折，在途请求数与单端口时代持平（iOS ENOMEM 红线不动） */
  const concurrency = opts.concurrency ?? (Capacitor.getPlatform() === 'ios' ? 6 : 24)
  const prefixes = mergeScanPrefixes({ selfPrefixes, remembered: lsGet<string>(K_SCAN_PREFIX, ''), common: COMMON_PREFIXES })
  const ports = scanPorts()
  const found: DiscoveredPc[] = []
  let cursor = 0
  let scanned = 0
  const total = prefixes.length * 254 * ports.length
  const deadline = Date.now() + deadlineMs
  let stopped = opts.signal?.aborted ?? false
  const progress = () => opts.onProgress?.({ scanned, total, found: [...found] })
  progress()
  const workers = Array.from({ length: Math.min(concurrency, total) }, async () => {
    while (!stopped) {
      const i = cursor++
      if (i >= total || Date.now() > deadline) return
      /* 目标顺序 = 逐段全扫（自知/记忆段优先吃满并发），段内 host 1-254 × 端口交错 */
      const host = prefixes[Math.floor(i / (254 * ports.length)) % prefixes.length] + '.' + (Math.floor(i / ports.length) % 254 + 1)
      const port = ports[i % ports.length]
      const hit = await probePort(host, port, timeoutMs)
      scanned++
      if (hit && !found.some(f => f.baseUrl === hit.baseUrl)) {
        found.push(hit)
        if (found.length === 1) stopped = true /* 首命中即停调度：在途的收尾后返回，不再空烧 */
      }
      progress()
    }
  })
  await Promise.all(workers)
  if (found.length) {
    const m = /^http:\/\/(\d{1,3}(?:\.\d{1,3}){2}):(\d+)$/.exec(found[0].baseUrl)
    if (m) { lsSet(K_SCAN_PREFIX, m[1]); rememberScanPort(Number(m[2])) }
    return { found, diag: `${mcastNote ? mcastNote + ' · ' : ''}扫段命中（${found[0].baseUrl.replace('http://', '')}，扫了 ${scanned} 个地址）` }
  }
  return {
    found,
    diag: `${mcastNote ? mcastNote + ' · ' : ''}已扫 ${scanned}/${total}（本机段 ${selfPrefixes[0] || '拿不到'}）`,
  }
}

/** 发起配对请求：电脑弹确认框，同屏显示 4 位码（手机与电脑一致才允许） */
export async function requestPair(baseUrl: string, name: string): Promise<{ requestId: string; code: string; expiresAt: number }> {
  const { status, data } = await lanRequest(baseUrl + '/api/pair/request', {
    method: 'POST',
    body: { deviceName: name },
    timeoutMs: 6000,
  })
  const body = data as { ok?: boolean; error?: string; requestId?: string; code?: string; expiresAt?: number }
  if (status < 200 || status >= 300 || !body?.ok || !body.requestId || !body.code) {
    throw new Error(body?.error || '电脑端没有响应配对请求（' + status + '）')
  }
  return { requestId: body.requestId, code: body.code, expiresAt: body.expiresAt || Date.now() + 180_000 }
}

export type PairPollStatus = 'pending' | 'approved' | 'rejected' | 'expired'

/** 轮询结果；approved 时顺带落盘长期令牌（与旧路 pairWith 同一条存储） */
export async function pollPair(baseUrl: string, requestId: string): Promise<{ status: PairPollStatus; device?: PairedDevice }> {
  const { status, data } = await lanRequest(baseUrl + '/api/pair/status?id=' + encodeURIComponent(requestId), { timeoutMs: 5000 })
  const body = data as {
    ok?: boolean; status?: PairPollStatus; deviceToken?: string; pc?: { name?: string }; error?: string
  }
  if (status < 200 || status >= 300 || !body?.ok || !body.status) throw new Error(body?.error || '查询配对状态失败')
  if (body.status === 'approved' && body.deviceToken) {
    const device: PairedDevice = {
      baseUrl,
      token: body.deviceToken,
      pcName: body.pc?.name || '我的电脑',
      deviceId: deviceId(),
      pairedAt: Date.now(),
    }
    lsSet(K_PAIRED, device)
    rememberScanPrefix(baseUrl.replace(/^https?:\/\//, ''))
    return { status: 'approved', device }
  }
  return { status: body.status }
}

/* ================= 待同步队列 ================= */

export function getQueue(): QueueOp[] {
  return lsGet<QueueOp[]>(K_QUEUE, [])
}

export function enqueueOp(op: QueueOp): void {
  const list = getQueue().filter(x => x.id !== op.id)
  list.push(op)
  lsSet(K_QUEUE, list)
}

/** 同步完成后移除已处理条目（applied 与 conflict 都算处理完：后者以服务端为准） */
export function removeFromQueue(ids: string[]): void {
  if (!ids.length) return
  const drop = new Set(ids)
  lsSet(K_QUEUE, getQueue().filter(op => !drop.has(op.id)))
}

export interface LastSyncCursor { ledger: number; schedule: number; notes: number }

export function getLastSync(): LastSyncCursor {
  const raw = lsGet<Partial<LastSyncCursor>>(K_LAST_SYNC, {})
  return { ledger: Number(raw.ledger) || 0, schedule: Number(raw.schedule) || 0, notes: Number(raw.notes) || 0 }
}

function setLastSync(domain: 'ledger' | 'schedule' | 'notes', ms: number): void {
  lsSet(K_LAST_SYNC, { ...getLastSync(), [domain]: ms })
}

/* ================= notes 域负载构建（纯函数，契约脚本直测） ================= */

/** 手机闪念 → notes 域负载（v1.2）。标题截 120、正文截 10 万，与桌面 normalizeNoteData 同口径 */
export function buildNoteData(title: string, body: string): NoteSyncData {
  return { title: title.trim().slice(0, 120), body: String(body || '').slice(0, 100_000) }
}

/* ---- v1.6 笔记 U 盘模式：下行负载与 LWW（纯函数，契约脚本直测） ---- */

/** 桌面下行的笔记变更（设备文件夹内桌面侧的增改；删除走 tombstones，domain='notes'） */
export interface RemoteNoteItem {
  id: string
  updatedAt: string
  data: { title: string; body: string }
}

/**
 * 笔记 LWW 裁决：updatedAt（ISO）新者赢。两侧都缺时间按旧处理（pull 版让位本地）；
 * 相等视为远端赢（同刻无法分先后，取桌面版收敛——与 ledger「conflict 以服务端为准」同精神）。
 */
export function noteLww(localUpdatedAt: string | undefined, remoteUpdatedAt: string): 'local' | 'remote' {
  const l = Date.parse(localUpdatedAt || '')
  const r = Date.parse(remoteUpdatedAt || '')
  if (!Number.isFinite(r)) return 'local'
  if (!Number.isFinite(l)) return 'remote'
  return r >= l ? 'remote' : 'local'
}

/* ================= 电脑笔记内容缓存（v1.2 内容 API） ================= */

/** 缓存总量上限（字符近似字节数）：SQLite/IndexedDB 评估推迟到真实触顶（design.md M3 拍板） */
const NOTE_CACHE_MAX_CHARS = 1_500_000

export function loadNoteTree(): { fetchedAt: number; pages: NoteTreePage[] } {
  return loadJson<{ fetchedAt: number; pages: NoteTreePage[] }>(K_NOTE_TREE, { fetchedAt: 0, pages: [] })
}

export function saveNoteTree(pages: NoteTreePage[]): void {
  saveJson(K_NOTE_TREE, { fetchedAt: Date.now(), pages })
}

export function loadNoteCache(): NoteCache {
  return loadJson<NoteCache>(K_NOTE_CACHE, {})
}

export function saveNoteCache(cache: NoteCache): void {
  saveJson(K_NOTE_CACHE, pruneNoteCache(cache))
}

/** 缓存超限 LRU 逐出（纯函数，契约直测）：按缓存时间最旧先丢，直到总量 ≤ maxChars */
export function pruneNoteCache(cache: NoteCache, maxChars = NOTE_CACHE_MAX_CHARS): NoteCache {
  const items = Object.entries(cache)
  const sizeOf = (v: { title: string; body: string }) => v.title.length + v.body.length
  let total = items.reduce((s, [, v]) => s + sizeOf(v), 0)
  if (total <= maxChars) return cache
  const keep = new Map(items)
  for (const [k, v] of items.slice().sort((a, b) => a[1].at - b[1].at)) {
    if (total <= maxChars) break
    total -= sizeOf(v)
    keep.delete(k)
  }
  return Object.fromEntries(keep)
}

/** 拉目录树（GET /api/notes/tree，带令牌）。失败抛 Error（文案可 toast） */
export async function fetchNoteTree(timeoutMs = 8000): Promise<NoteTreePage[]> {
  const p = getPaired()
  if (!p) throw new Error('尚未配对电脑')
  const r = await lanRequest(p.baseUrl + '/api/notes/tree', {
    headers: { authorization: 'Bearer ' + p.token },
    timeoutMs,
    connectTimeoutMs: 3000,
  }).catch(() => { throw new Error('目录拉取超时：确认电脑在线且服务已开启') })
  const json = r.data as { ok?: boolean; pages?: NoteTreePage[]; error?: string }
  if (r.status < 200 || r.status >= 300 || !json?.ok || !Array.isArray(json.pages)) {
    throw new Error(json?.error || '目录拉取失败（' + r.status + '）')
  }
  return json.pages.filter(x => x && typeof x.id === 'string')
}

/** 按 id 拉正文（GET /api/notes/content?id=，服务端解析路径）。404 → 明确文案 */
export async function fetchNoteContent(id: string, timeoutMs = 8000): Promise<{ title: string; updatedAt: string; body: string }> {
  const p = getPaired()
  if (!p) throw new Error('尚未配对电脑')
  const r = await lanRequest(p.baseUrl + '/api/notes/content?id=' + encodeURIComponent(id), {
    headers: { authorization: 'Bearer ' + p.token },
    timeoutMs,
    connectTimeoutMs: 3000,
  }).catch(() => { throw new Error('正文拉取超时：确认电脑在线且服务已开启') })
  const json = r.data as { ok?: boolean; title?: string; updatedAt?: string; body?: string; error?: string }
  if (r.status === 404) throw new Error('笔记在电脑端不存在（可能已被删除或归档）')
  if (r.status < 200 || r.status >= 300 || !json?.ok || typeof json.body !== 'string') {
    throw new Error(json?.error || '正文拉取失败（' + r.status + '）')
  }
  return { title: json.title || '', updatedAt: json.updatedAt || '', body: json.body }
}

/* ================= schedule 域负载构建（纯函数，契约脚本直测） ================= */

/** 手机 Todo → schedule 域负载。done 由调用方先改好对象；time 非 HH:MM 形态视为无 */
export function buildScheduleData(
  t: Pick<Todo, 'date' | 'title' | 'type' | 'time' | 'done' | 'parentId' | 'sched'>,
): ScheduleSyncData {
  return {
    date: t.date,
    title: t.title,
    type: t.type,
    time: /^\d{1,2}:\d{2}/.test(t.time) ? t.time.slice(0, 5) : '',
    done: t.done,
    parentId: t.parentId ?? null,
    schedStart: t.sched ? t.sched.s : null,
    schedEnd: t.sched ? t.sched.e : null,
  }
}

/** 用户主动停止生成（区别于超时/网络失败的 Error，store 里静默收尾不报错） */
export class AiStopped extends Error {
  constructor() { super('stopped') }
}

/* ================= 连接探测与同步 ================= */

/** 令牌失效（401）：与「离线」是两回事——离线等重连，auth 必须重新配对。监督器/UI 据此分诊 */
export class AuthError extends Error {
  readonly status: number
  constructor(message = '电脑不再认识这台设备，请重新配对') {
    super(message)
    this.name = 'AuthError'
    this.status = 401
  }
}

export type PingResult = { state: 'online' } | { state: 'offline'; error?: string } | { state: 'auth' }

/** 电脑是否在线（GET /api/ping 带令牌）：200=online / 401=auth / 其余与网络错误=offline。
 *  指定 baseUrl+token 可探「换地址后的同一台电脑」（地址修复用），缺省探当前配对设备。 */
export async function pingDevice(baseUrl: string, token: string, timeoutMs = 2500): Promise<PingResult> {
  try {
    const { status } = await lanRequest(baseUrl + '/api/ping', {
      headers: { authorization: 'Bearer ' + token },
      timeoutMs,
      connectTimeoutMs: Math.min(timeoutMs, 2500),
    })
    if (status >= 200 && status < 300) return { state: 'online' }
    if (status === 401) return { state: 'auth' }
    return { state: 'offline', error: 'HTTP ' + status }
  } catch (e) {
    return { state: 'offline', error: e instanceof Error ? e.message : '网络失败' }
  }
}

/** 当前配对设备的连通探测（连接监督器的心跳） */
export async function pingPaired(timeoutMs = 2500): Promise<PingResult> {
  const p = getPaired()
  if (!p) return { state: 'offline', error: '尚未配对' }
  return pingDevice(p.baseUrl, p.token, timeoutMs)
}

/** 兼容旧调用的布尔探活（内部走 pingPaired 三态） */
export async function probeOnline(timeoutMs = 2500): Promise<boolean> {
  return (await pingPaired(timeoutMs)).state === 'online'
}

export interface RemoteLedgerItem {
  id: string
  updatedAt: string
  data: LedgerSyncData
}

export interface RemoteScheduleItem {
  id: string
  updatedAt: string
  data: ScheduleSyncData
}

/** 服务端下行的墓碑（deletedAt > min(各域游标)；手机按 id 幂等应用） */
export interface RemoteTombstone {
  domain: string
  id: string
  deletedAt: string
}

export interface SyncOutcome {
  /** 出队的条目数（applied + conflict） */
  handled: number
  /** 出队条目的 id（调用方据此清待同步徽标） */
  handledIds: string[]
  /** 其中真正写入服务端的条数 */
  applied: number
  /** 服务端更新的条数（本地以服务端版本为准） */
  conflicts: number
  /** 从电脑拉回的条数（两域合计） */
  pulled: number
  /** 拉回的记账条目（调用方按 id 幂等合并进本地列表） */
  remoteLedger: RemoteLedgerItem[]
  /** 拉回的日程条目（含子任务行，调用方聚合计数展示） */
  remoteSchedule: RemoteScheduleItem[]
  /** 拉回的笔记变更（v1.6 U 盘模式：桌面端在设备文件夹里的增改，调用方 LWW 合并） */
  remoteNotes: RemoteNoteItem[]
  /** 墓碑下行的条目 id（调用方从本地删除，并丢弃这些 id 的在途队列操作） */
  removedIds: string[]
  /** 响应游标快照（WP6.3）：应用完成后由调用方 commitPullCursor 提交 */
  cursor: LastSyncCursor
}

/* ================= v1.7 实时同步：挂起 pull + 循环驱动器（时机逻辑可注入，契约直测） ================= */

/** 挂起 pull 上限（毫秒）。桌面侧同值封顶（主仓方案 §2.3-3），避开中间层空闲超时 */
export const RT_WAIT_MS = 25000
/** 旧桌面（响应无 waitSupported）退回的定时轮询间隔 */
export const RT_POLL_MS = 30000

/** 指数退避（纯函数，契约直测）：第 n 次连续失败的等待毫秒——1s / 2s / 5s / 10s，n ≥ 5 恒 30s 封顶 */
export function nextBackoffMs(failCount: number): number {
  const seq = [1000, 2000, 5000, 10000, 30000]
  const i = Math.min(Math.max(Math.round(failCount), 1), seq.length) - 1
  return seq[i]
}

/** 连接监督器重探退避（纯函数，契约直测）：1s / 2s / 5s / 10s，n ≥ 5 恒 15s 封顶——
 *  比同步退避短（监督器只发 ping，代价小，热点场景电脑晚连几秒就该跟上） */
export function nextProbeDelayMs(failCount: number): number {
  const seq = [1000, 2000, 5000, 10000, 15000]
  const i = Math.min(Math.max(Math.round(failCount), 1), seq.length) - 1
  return seq[i]
}

/** pull 下行结果（v1.7 自 syncNow 拆出单点化；游标推进也在这里完成） */
export interface RtPullOutcome {
  /** 本请求确实被挂起处理过（桌面 v1.7+ 才有；缺省 = 对端旧桌面，调用方退回轮询） */
  waitSupported: boolean
  remoteLedger: RemoteLedgerItem[]
  remoteSchedule: RemoteScheduleItem[]
  remoteNotes: RemoteNoteItem[]
  removedIds: string[]
}

/** pull 下行结果（v1.7 自 syncNow 拆出单点化）。cursor = 响应游标快照：
 *  2026-11-08 起不再在 pullOnce 内落盘——迟到响应判废后游标已推进过会漏数据（WP6.3），
 *  改由调用方在「代数校验通过 + 应用数据」后调 commitPullCursor 提交。 */
export interface RtPullOutcome {
  /** 本请求确实被挂起处理过（桌面 v1.7+ 才有；缺省 = 对端旧桌面，调用方退回轮询） */
  waitSupported: boolean
  remoteLedger: RemoteLedgerItem[]
  remoteSchedule: RemoteScheduleItem[]
  remoteNotes: RemoteNoteItem[]
  removedIds: string[]
  cursor: LastSyncCursor
}

/** 提交 pull 游标（应用方专用）：RtDriver 代数校验通过 / syncNow 应用完成后调用 */
export function commitPullCursor(out: Pick<RtPullOutcome, 'cursor'>): void {
  setLastSync('ledger', out.cursor.ledger)
  setLastSync('schedule', out.cursor.schedule)
  setLastSync('notes', out.cursor.notes)
}

/**
 * 单次 pull：since 取本地游标（或调用方覆写——push 冲突后全量重对）。
 * waitMs > 0 = v1.7 挂起 pull（请求体才带 wait 字段；轮询模式不带，对旧桌面语义与 v1.6 全同）。
 * 游标不在这里落盘（见 RtPullOutcome.cursor）；401 抛 AuthError 供监督器分诊。
 * 超时：挂起请求 waitMs + 10s 余量，普通 pull 10s；外部 signal（RtDriver 换代顶掉）联动取消。
 */
export async function pullOnce(opts: { waitMs?: number; signal?: AbortSignal; sinceOverride?: { ledger: number; schedule: number; notes: number } } = {}): Promise<RtPullOutcome> {
  const p = getPaired()
  if (!p) throw new Error('尚未配对电脑')
  const waitMs = Math.max(0, Math.min(RT_WAIT_MS, Math.round(opts.waitMs ?? 0)))
  const timeoutMs = waitMs > 0 ? waitMs + 10_000 : 10_000
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const onOuter = () => ctrl.abort()
  opts.signal?.addEventListener('abort', onOuter, { once: true })
  try {
    const cur = getLastSync()
    const since = opts.sinceOverride ?? { ledger: cur.ledger, schedule: cur.schedule, notes: cur.notes }
    const r = await lanRequest(p.baseUrl + '/api/sync/pull', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + p.token },
      body: waitMs > 0 ? { since, wait: waitMs } : { since },
      timeoutMs,
      connectTimeoutMs: 5000,
    })
    const json = r.data as {
      ok?: boolean; error?: string
      changes?: { ledger?: RemoteLedgerItem[]; schedule?: RemoteScheduleItem[]; notes?: RemoteNoteItem[] }
      tombstones?: RemoteTombstone[]
      cursor?: { ledger?: number; schedule?: number; notes?: number }
      waitSupported?: boolean
    }
    if (r.status < 200 || r.status >= 300 || !json?.ok) {
      if (r.status === 401) throw new AuthError()
      throw new Error(json?.error || '同步被拒绝（' + r.status + '）')
    }
    const cursor: LastSyncCursor = {
      ledger: typeof json.cursor?.ledger === 'number' ? json.cursor.ledger : cur.ledger,
      schedule: typeof json.cursor?.schedule === 'number' ? json.cursor.schedule : cur.schedule,
      notes: typeof json.cursor?.notes === 'number' ? json.cursor.notes : cur.notes,
    }
    return {
      waitSupported: json.waitSupported === true,
      remoteLedger: Array.isArray(json.changes?.ledger) ? json.changes!.ledger! : [],
      remoteSchedule: Array.isArray(json.changes?.schedule) ? json.changes!.schedule! : [],
      /* v1.6 起桌面可回 notes 域（U 盘模式）；旧桌面（v1.5-）不回 → 空数组、notes 游标不动，完全兼容 */
      remoteNotes: Array.isArray(json.changes?.notes) ? json.changes!.notes! : [],
      removedIds: Array.isArray(json.tombstones) ? json.tombstones.map(t => String(t.id)).filter(Boolean) : [],
      cursor,
    }
  } catch (e) {
    if (e instanceof AuthError) throw e
    if (e instanceof DOMException && e.name === 'AbortError') throw new Error('同步超时：电脑响应太慢或网络不稳')
    throw e instanceof Error ? e : new Error('同步失败')
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onOuter)
  }
}

export type RtMode = 'off' | 'hang' | 'poll'

export interface RtDeps {
  /** 发起一次 pull（waitMs 由驱动器按模式给 RT_WAIT_MS 或 0；signal 用于换代顶掉） */
  pullOnce: (opts: { waitMs: number; signal: AbortSignal }) => Promise<RtPullOutcome>
  /** 应用下行变更（store 接 applyRemote* + 墓碑；驱动器不碰存储与游标） */
  apply: (out: RtPullOutcome) => void
  /** 提交游标（应用完成后调用；WP6.3 游标提交时机修复——pullOnce 不再自行落盘） */
  commit?: (out: RtPullOutcome) => void
  /** 错误上抛（auth → 停循环交监督器；网络错误 → 退避继续。不再静默吞 401） */
  onError?: (err: unknown) => void
  /** 可注入睡眠（契约脚本记录毫秒并即时返回，测时机不测真实等待） */
  sleep?: (ms: number) => Promise<void>
}

/**
 * 实时同步驱动器（v1.7）：前台 + 配对 + 在线时维持「挂起 pull 循环」。
 * - hang：响应带 waitSupported → 应用后立即挂下一发（<1s 实时）；
 * - poll：响应无 waitSupported（旧桌面）→ 30s 定时轮询，代内不再探测；
 * - off：未运行 / 失败退避中（UI「离线待同步」）。
 * 并发不变式：任一时刻至多一个 pull 在途——stop()/start() 先换代再 abort，
 * 迟到的响应按代数判废（不应用；游标未推进，重建方的 pull 会重拉，安全）。
 */
export class RtDriver {
  mode: RtMode = 'off'
  /** 模式变更回调（store 接 UI 三态文案 + 连接态回写） */
  onMode?: (m: RtMode) => void
  private deps: RtDeps
  private readonly sleepFn: (ms: number) => Promise<void>
  private gen = 0
  private stopped = true
  private inFlight: AbortController | null = null

  constructor(deps: RtDeps) {
    this.deps = deps
    this.sleepFn = deps.sleep ?? (ms => new Promise(r => setTimeout(r, ms)))
  }

  private setMode(m: RtMode): void {
    if (this.mode !== m) { this.mode = m; this.onMode?.(m) }
  }

  private alive(gen: number): boolean { return !this.stopped && this.gen === gen }

  /** 启动/重建循环：先顶掉在途（换代），再挂第一发 */
  start(): void {
    this.cancelInFlight()
    this.gen++
    this.stopped = false
    void this.loop(this.gen)
  }

  /** 仅在未运行时启动（不打断在途挂起——runSync 收尾重建走这里，避免无谓顶掉） */
  maybeStart(): void {
    if (this.stopped) this.start()
  }

  /** 停止：换代 + 取消在途（迟到响应判废）。退后台 / 取消配对 / 手动离线 / 对账前调用 */
  stop(): void {
    this.stopped = true
    this.gen++
    this.cancelInFlight()
    this.setMode('off')
  }

  private cancelInFlight(): void {
    this.inFlight?.abort()
    this.inFlight = null
  }

  private async loop(gen: number): Promise<void> {
    let fails = 0
    let wait = true // 代内首轮必带 wait（探测位）；退回轮询后不再探测，回前台重建时自然重探
    while (this.alive(gen)) {
      let out: RtPullOutcome
      try {
        const ctrl = new AbortController()
        this.inFlight = ctrl
        out = await this.deps.pullOnce({ waitMs: wait ? RT_WAIT_MS : 0, signal: ctrl.signal })
        this.inFlight = null
      } catch (e) {
        this.inFlight = null
        if (!this.alive(gen)) return // 被换代顶掉：对账/新循环已接管，静默退出
        this.deps.onError?.(e)
        if (e instanceof AuthError) return // 令牌失效：循环停，交给监督器/UI 走重新配对
        fails++
        this.setMode('off') // 离线待同步
        await this.sleepFn(nextBackoffMs(fails))
        continue
      }
      if (!this.alive(gen)) return // 迟到响应：判废丢弃，不应用不推进（游标也没提交——WP6.3）
      this.deps.apply(out)
      this.deps.commit?.(out)
      if (out.waitSupported) {
        fails = 0
        wait = true
        this.setMode('hang') // 实时：无睡眠，立即挂下一发
      } else {
        wait = false
        this.setMode('poll') // 旧桌面：30s 定时轮询
        await this.sleepFn(RT_POLL_MS)
      }
    }
  }
}

/**
 * 对账一轮：push 待同步队列（两域混批，服务端按 change.domain 分派）→ pull 双域增量 + 墓碑。
 * 游标只在 pull 响应后推进（v1.1）；有冲突时该轮游标回 0 全量对一次（收敛优先）；
 * 自己推上去的条目会被 pull 原样带回，按 id 幂等合并。
 */
export async function syncNow(onPhase?: (pct: number) => void): Promise<SyncOutcome> {
  const p = getPaired()
  if (!p) throw new Error('尚未配对电脑')
  const auth = { 'content-type': 'application/json', authorization: 'Bearer ' + p.token }
  const req = async (path: string, body: unknown): Promise<Record<string, unknown>> => {
    const r = await lanRequest(p.baseUrl + path, { method: 'POST', headers: auth, body, timeoutMs: 10_000, connectTimeoutMs: 5000 })
    const json = r.data as Record<string, unknown>
    if (r.status < 200 || r.status >= 300 || !json?.ok) {
      if (r.status === 401) throw new AuthError()
      throw new Error((json?.error as string) || '同步被拒绝（' + r.status + '）')
    }
    return json
  }

  onPhase?.(15)

  // ---- push（游标不动：见文件头 v1.1 说明） ----
  let applied = 0, conflicts = 0
  const queue = getQueue()
  const changes = queue.map(op => ({ domain: op.domain, id: op.id, updatedAt: op.updatedAt, data: op.data }))
  const doneIds: string[] = []
  if (changes.length) {
    const pushRes = await req('/api/sync/push', { deviceId: p.deviceId, changes }) as {
      results?: Array<{ id: string; applied?: boolean; conflict?: boolean; reason?: string }>
      serverTime?: number
    }
    const results = Array.isArray(pushRes.results) ? pushRes.results : []
    for (const r of results) {
      if (r.applied) applied++
      else if (r.conflict) conflicts++
      const op = queue.find(x => x.id === r.id)
      // unsupported-domain 的留在队列（M3 notes 加域后自然消化），其余出队
      if (op && r.reason !== 'unsupported-domain') doneIds.push(r.id)
    }
    removeFromQueue(doneIds)
  }
  onPhase?.(60)

  // ---- pull（v1.7 起走 pullOnce 单点化；有冲突 → 全量对一次，保证收敛） ----
  const pullOut = await pullOnce({
    sinceOverride: conflicts > 0 ? { ledger: 0, schedule: 0, notes: 0 } : undefined,
  })
  onPhase?.(100)

  return {
    handled: doneIds.length,
    handledIds: doneIds,
    applied,
    conflicts,
    pulled: pullOut.remoteLedger.length + pullOut.remoteSchedule.length + pullOut.remoteNotes.length,
    ...pullOut,
  }
}
