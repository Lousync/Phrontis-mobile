/**
 * 手机伴侣同步引擎（M1）。
 *
 * 协议冻结口径：docs/design.md §2.1（与桌面端
 * E:\Projects\KnowledgeRecorder\electron\lib\phoneCompanion\protocol.ts 同源，
 * 两仓独立持有一份，各自契约脚本锁行为：scripts/verify-sync.mjs）。
 *
 * M1 存储用 localStorage（等价 Preferences 形态），M2 评估 SQLite 迁移；
 * 所有键带 pm. 前缀，迁移时整体搬运。
 */
import type { LedgerSyncData, PairedDevice, QueueOp } from './types'

const K_DEVICE_ID = 'pm.deviceId'
const K_PAIRED = 'pm.companion'
const K_QUEUE = 'pm.queue'
const K_LAST_SYNC = 'pm.lastSync'

function lsGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch { return fallback }
}

function lsSet(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* 隐私模式等，静默 */ }
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

export function getLastSync(): { ledger: number } {
  return lsGet<{ ledger: number }>(K_LAST_SYNC, { ledger: 0 })
}

function setLastSync(domain: 'ledger', ms: number): void {
  lsSet(K_LAST_SYNC, { ...getLastSync(), [domain]: ms })
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

export interface SyncOutcome {
  /** 出队的条目数（applied + conflict） */
  handled: number
  /** 出队条目的 id（调用方据此清待同步徽标） */
  handledIds: string[]
  /** 其中真正写入服务端的条数 */
  applied: number
  /** 服务端更新的条数（本地以服务端版本为准） */
  conflicts: number
  /** 从电脑拉回的条数 */
  pulled: number
  /** 拉回的记账条目（调用方按 id 幂等合并进本地列表） */
  remote: RemoteLedgerItem[]
}

/**
 * 对账一轮：push 待同步队列 → pull 记账增量。
 * 有冲突时本轮游标回退为 0 全量对一次（记账条目量级小，收敛优先）；
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

  // ---- push ----
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
      // unsupported-domain 的留在队列（M2 加域后自然消化），其余出队
      if (op && r.reason !== 'unsupported-domain') doneIds.push(r.id)
    }
    removeFromQueue(doneIds)
    if (typeof pushRes.serverTime === 'number') setLastSync('ledger', pushRes.serverTime)
  }
  onPhase?.(60)

  // ---- pull（有冲突 → 全量对一次，保证收敛）----
  const since = conflicts > 0 ? 0 : getLastSync().ledger
  const pullRes = await req('/api/sync/pull', { since: { ledger: since } }) as {
    changes?: { ledger?: RemoteLedgerItem[] }
    cursor?: { ledger?: number }
  }
  const remote = Array.isArray(pullRes.changes?.ledger) ? pullRes.changes!.ledger! : []
  if (typeof pullRes.cursor?.ledger === 'number') setLastSync('ledger', pullRes.cursor.ledger)
  onPhase?.(100)

  return { handled: doneIds.length, handledIds: doneIds, applied, conflicts, pulled: remote.length, remote }
}
