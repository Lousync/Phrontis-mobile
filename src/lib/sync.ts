/**
 * 手机伴侣同步引擎（M1 配对/队列，v1.1 双域 + 墓碑）。
 *
 * 协议冻结口径：docs/design.md §2.1（与桌面端
 * E:\Projects\KnowledgeRecorder\electron\lib\phoneCompanion\protocol.ts 同源，
 * 两仓独立持有一份，各自契约脚本锁行为：scripts/verify-sync.mjs）。
 *
 * v1.1（M2a）：schedule 域上线；删除走墓碑（data:{deleted:true}）；
 * 游标只在 pull 完成后推进（M1 在 push 时推进，会漏拉电脑侧早于本次 push 的变更——已修正）。
 *
 * M1 存储用 localStorage（等价 Preferences 形态），M2b 评估 SQLite 迁移；
 * 所有键带 pm. 前缀，迁移时整体搬运。
 */
import type { LedgerSyncData, NoteCache, NoteSyncData, NoteTreePage, PairedDevice, QueueOp, ScheduleSyncData, Todo } from './types'

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
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 6000)
  try {
    const res = await fetch(base + '/api/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: parsed.code, deviceName }),
      signal: ctrl.signal,
    })
    const body = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; deviceToken?: string; pc?: { name?: string } }
    if (!res.ok || !body.ok || !body.deviceToken) {
      throw new Error(body.error || '配对被拒绝（' + res.status + '）')
    }
    const device: PairedDevice = {
      baseUrl: base,
      token: body.deviceToken,
      pcName: body.pc?.name || '我的电脑',
      deviceId: deviceId(),
      pairedAt: Date.now(),
    }
    lsSet(K_PAIRED, device)
    return device
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new Error('连接超时：确认手机与电脑在同一网络，且电脑端服务已开启')
    if (e instanceof Error && e.message.includes('fetch')) throw new Error('连不上电脑：检查地址、同一网络与防火墙')
    throw e instanceof Error ? e : new Error('配对失败')
  } finally {
    clearTimeout(timer)
  }
}

export function unpair(): void {
  try { localStorage.removeItem(K_PAIRED) } catch { /* 忽略 */ }
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

/**
 * WebView 拿不到本机 IP（无原生桥），只能按经验网段枚举；上次命中的网段排最前（下次秒回）。
 * 常见家用网段：192.168.1（多数光猫）/ .0（老路由）/ .31（小米）/ .3（华为）/ .50（TP-Link 默认）
 * + 10.0.0 / 10.0.1（公司网）+ 172.20.10.1（iPhone 热点）。
 */
const COMMON_PREFIXES = ['192.168.1', '192.168.0', '192.168.31', '192.168.3', '192.168.2', '192.168.50', '10.0.0', '10.0.1', '172.20.10']

function scanPrefixes(): string[] {
  const last = lsGet<string>(K_SCAN_PREFIX, '')
  if (!last || !COMMON_PREFIXES.includes(last)) return COMMON_PREFIXES
  return [last, ...COMMON_PREFIXES.filter(p => p !== last)]
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

/** 探一台：/api/discover 通且 ok 才算命中；超时/被拒/跨域一律当没有 */
async function probeHost(host: string, timeoutMs: number): Promise<DiscoveredPc | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch('http://' + host + ':8770/api/discover', { signal: ctrl.signal })
    if (!res.ok) return null
    const body = await res.json() as { ok?: boolean; protocol?: number; pc?: { name?: string }; pairing?: string[] }
    if (!body.ok) return null
    return {
      baseUrl: 'http://' + host + ':8770',
      pcName: body.pc?.name || '我的电脑',
      protocol: body.protocol || 1,
      canRequest: Array.isArray(body.pairing) && body.pairing.includes('request'),
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 扫段发现：按网段顺序，每段并发探 .1–.254，命中即记住该段并停止。
 * 单段 254 台 ÷ 48 并发 × 350ms ≈ 2s；最常见的 192.168.1 排第一，通常一两秒出结果。
 * 只探 8770 默认端口（电脑端换端口时退回手动配对）。
 */
export async function discoverCompanions(opts: { timeoutMs?: number; concurrency?: number } = {}): Promise<DiscoveredPc[]> {
  const timeoutMs = opts.timeoutMs ?? 350
  const concurrency = opts.concurrency ?? 48
  const found: DiscoveredPc[] = []
  /* 源提示最先探：页面源即电脑 IP 的场景（dev/部署站）零配置秒回，扫不到经验网段外的情况 */
  const hint = originHintHost()
  if (hint) {
    const hit = await probeHost(hint, 600)
    if (hit) return [hit]
  }
  for (const prefix of scanPrefixes()) {
    const hosts = Array.from({ length: 254 }, (_, i) => prefix + '.' + (i + 1))
    let cursor = 0
    const workers = Array.from({ length: concurrency }, async () => {
      while (cursor < hosts.length) {
        const host = hosts[cursor++]
        const hit = await probeHost(host, timeoutMs)
        if (hit && !found.some(f => f.baseUrl === hit.baseUrl)) found.push(hit)
      }
    })
    await Promise.all(workers)
    if (found.length) {
      lsSet(K_SCAN_PREFIX, prefix)
      break
    }
  }
  return found
}

/** 发起配对请求：电脑弹确认框，同屏显示 4 位码（手机与电脑一致才允许） */
export async function requestPair(baseUrl: string, name: string): Promise<{ requestId: string; code: string; expiresAt: number }> {
  const res = await fetch(baseUrl + '/api/pair/request', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceName: name }),
  })
  const body = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; requestId?: string; code?: string; expiresAt?: number }
  if (!res.ok || !body.ok || !body.requestId || !body.code) {
    throw new Error(body.error || '电脑端没有响应配对请求（' + res.status + '）')
  }
  return { requestId: body.requestId, code: body.code, expiresAt: body.expiresAt || Date.now() + 180_000 }
}

export type PairPollStatus = 'pending' | 'approved' | 'rejected' | 'expired'

/** 轮询结果；approved 时顺带落盘长期令牌（与旧路 pairWith 同一条存储） */
export async function pollPair(baseUrl: string, requestId: string): Promise<{ status: PairPollStatus; device?: PairedDevice }> {
  const res = await fetch(baseUrl + '/api/pair/status?id=' + encodeURIComponent(requestId))
  const body = await res.json().catch(() => ({})) as {
    ok?: boolean; status?: PairPollStatus; deviceToken?: string; pc?: { name?: string }; error?: string
  }
  if (!res.ok || !body.ok || !body.status) throw new Error(body.error || '查询配对状态失败')
  if (body.status === 'approved' && body.deviceToken) {
    const device: PairedDevice = {
      baseUrl,
      token: body.deviceToken,
      pcName: body.pc?.name || '我的电脑',
      deviceId: deviceId(),
      pairedAt: Date.now(),
    }
    lsSet(K_PAIRED, device)
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

export interface LastSyncCursor { ledger: number; schedule: number }

export function getLastSync(): LastSyncCursor {
  const raw = lsGet<Partial<LastSyncCursor>>(K_LAST_SYNC, {})
  return { ledger: Number(raw.ledger) || 0, schedule: Number(raw.schedule) || 0 }
}

function setLastSync(domain: 'ledger' | 'schedule', ms: number): void {
  lsSet(K_LAST_SYNC, { ...getLastSync(), [domain]: ms })
}

/* ================= notes 域负载构建（纯函数，契约脚本直测） ================= */

/** 手机闪念 → notes 域负载（v1.2）。标题截 120、正文截 10 万，与桌面 normalizeNoteData 同口径 */
export function buildNoteData(title: string, body: string): NoteSyncData {
  return { title: title.trim().slice(0, 120), body: String(body || '').slice(0, 100_000) }
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
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(p.baseUrl + '/api/notes/tree', { headers: { authorization: 'Bearer ' + p.token }, signal: ctrl.signal })
    const json = await res.json().catch(() => ({})) as { ok?: boolean; pages?: NoteTreePage[]; error?: string }
    if (!res.ok || !json.ok || !Array.isArray(json.pages)) throw new Error(json.error || '目录拉取失败（' + res.status + '）')
    return json.pages.filter(x => x && typeof x.id === 'string')
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new Error('目录拉取超时：确认电脑在线且服务已开启')
    throw e instanceof Error ? e : new Error('目录拉取失败')
  } finally {
    clearTimeout(timer)
  }
}

/** 按 id 拉正文（GET /api/notes/content?id=，服务端解析路径）。404 → 明确文案 */
export async function fetchNoteContent(id: string, timeoutMs = 8000): Promise<{ title: string; updatedAt: string; body: string }> {
  const p = getPaired()
  if (!p) throw new Error('尚未配对电脑')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(p.baseUrl + '/api/notes/content?id=' + encodeURIComponent(id), {
      headers: { authorization: 'Bearer ' + p.token },
      signal: ctrl.signal,
    })
    const json = await res.json().catch(() => ({})) as { ok?: boolean; title?: string; updatedAt?: string; body?: string; error?: string }
    if (res.status === 404) throw new Error('笔记在电脑端不存在（可能已被删除或归档）')
    if (!res.ok || !json.ok || typeof json.body !== 'string') throw new Error(json.error || '正文拉取失败（' + res.status + '）')
    return { title: json.title || '', updatedAt: json.updatedAt || '', body: json.body }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new Error('正文拉取超时：确认电脑在线且服务已开启')
    throw e instanceof Error ? e : new Error('正文拉取失败')
  } finally {
    clearTimeout(timer)
  }
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

/** 电脑是否在线（GET /api/ping 带令牌） */
export async function probeOnline(timeoutMs = 2500): Promise<boolean> {
  const p = getPaired()
  if (!p) return false
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(p.baseUrl + '/api/ping', {
      headers: { authorization: 'Bearer ' + p.token },
      signal: ctrl.signal,
    })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
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
  /** 墓碑下行的条目 id（调用方从本地删除，并丢弃这些 id 的在途队列操作） */
  removedIds: string[]
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
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10000)
    try {
      const res = await fetch(p.baseUrl + path, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify(body),
        signal: ctrl.signal,
      })
      const json = await res.json().catch(() => ({})) as Record<string, unknown>
      if (!res.ok || !json.ok) {
        const msg = (json.error as string) || '同步被拒绝（' + res.status + '）'
        if (res.status === 401) throw new Error('电脑不再认识这台设备，请重新配对')
        throw new Error(msg)
      }
      return json
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw new Error('同步超时：电脑响应太慢或网络不稳')
      throw e instanceof Error ? e : new Error('同步失败')
    } finally {
      clearTimeout(timer)
    }
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

  // ---- pull（有冲突 → 全量对一次，保证收敛；游标以 pull 响应 cursor 为准） ----
  const cursors = getLastSync()
  const since = {
    ledger: conflicts > 0 ? 0 : cursors.ledger,
    schedule: conflicts > 0 ? 0 : cursors.schedule,
  }
  const pullRes = await req('/api/sync/pull', { since }) as {
    changes?: { ledger?: RemoteLedgerItem[]; schedule?: RemoteScheduleItem[] }
    tombstones?: RemoteTombstone[]
    cursor?: { ledger?: number; schedule?: number }
  }
  const remoteLedger = Array.isArray(pullRes.changes?.ledger) ? pullRes.changes!.ledger! : []
  const remoteSchedule = Array.isArray(pullRes.changes?.schedule) ? pullRes.changes!.schedule! : []
  const removedIds = Array.isArray(pullRes.tombstones) ? pullRes.tombstones.map(t => String(t.id)).filter(Boolean) : []
  if (typeof pullRes.cursor?.ledger === 'number') setLastSync('ledger', pullRes.cursor.ledger)
  if (typeof pullRes.cursor?.schedule === 'number') setLastSync('schedule', pullRes.cursor.schedule)
  onPhase?.(100)

  return {
    handled: doneIds.length,
    handledIds: doneIds,
    applied,
    conflicts,
    pulled: remoteLedger.length + remoteSchedule.length,
    remoteLedger,
    remoteSchedule,
    removedIds,
  }
}
