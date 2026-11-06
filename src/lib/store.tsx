import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { ReactNode } from 'react'
import type { AiChatMsg, AiConfig, AiMode, Card, CardKind, Folder, Habit, LedgerEntry, LedgerSyncData, Msg, NoteProposal, PairedDevice, PhoneNote, Session, SheetId, SchedView, ThemeName, Todo, TodoProposal, Tx, TxProposal, VoicePhase } from './types'
import { THEME_IDS } from './types'
import { seedFolders, seedHabits, seedSessions, seedTodos, seedEntries, TODAY, VOICE_PHRASES, welcomeText, dayIso, fmtMoney, monthOf, monthStats, txToDisplay } from './data'
import {
  AiStopped, buildNoteData, buildScheduleData, enqueueOp, getPaired, getQueue, loadJson, pairWith as pairRequest,
  pcChat, probeOnline, removeFromQueue, saveJson, syncNow, unpair as unpairDevice, uuid,
  type RemoteLedgerItem, type RemoteScheduleItem,
} from './sync'
import { AI_MAX_ROUNDS, aiConfigReady, chatOnce, loadAiConfig, parseToolArgs, saveAiConfig } from './ai'
import { AI_TOOLS, buildSystemPrompt, validateLedgerAdd, validateNoteCreate, validateTodoAdd, type ToolResult } from './aiTools'

export interface ToastItem { id: number; msg: string; type: 'ok' | 'warn' | 'info' }

let seq = 100
const nextId = (p: string) => p + (++seq)

/** 本地持久化键（pm. 前缀，SQLite 评估时整体搬运） */
const K_TODOS = 'pm.todos'
/** v0.3 起账本存同步形态（pm.txs 是旧版展示形态键，弃用不迁移——当时只有演示数据） */
const K_LEDGER = 'pm.ledger'
const K_NOTES = 'pm.notes'
const K_THEME = 'pm.theme'

/** 手机笔记种子（首次启动；上行走 notes 域进电脑收件箱） */
const seedPhoneNotes: PhoneNote[] = [
  { id: 'p1', title: '咖啡馆随想', body: '手机版的记账要不要支持语音快速记？先想想。', synced: false },
]

/** 在途删除操作的条目 id：远端回流时跳过这些 id（本地已删，等队列 push 落墓碑） */
function queuedDeleteIds(): Set<string> {
  return new Set(getQueue().filter(op => (op.data as { deleted?: boolean }).deleted === true).map(op => op.id))
}

interface Store {
  /* 全局 */
  theme: ThemeName
  setTheme: (t: ThemeName) => void
  toast: (msg: string, type?: ToastItem['type']) => void
  toasts: ToastItem[]
  sheet: SheetId
  openSheet: (id: Exclude<SheetId, null>, from?: HTMLElement | null) => void
  closeSheet: () => void
  /** 当前抽屉的触发元素（FAB / 行 / 按钮）：抽屉以它为圆心圆形扩散展开 */
  sheetOrigin: HTMLElement | null
  activeTab: string
  /** Tab 切换：从触发元素中心圆形铺开（View Transitions；不支持或减动效 → 瞬时切换） */
  setActiveTab: (t: string, from?: HTMLElement | null) => void
  /** 桌面 letterbox 专用：模拟输入法占位（真机顶栏无此按钮，恒为 false） */
  kbSim: boolean
  toggleKbSim: () => void
  /** 系统输入法展开中（input/textarea 聚焦即视同键盘弹出；真机键盘模型的状态源） */
  kbOpen: boolean

  /* 平板侧栏收纳（仅平板壳消费；手机壳不渲染侧栏） */
  sideCollapsed: boolean
  toggleSide: () => void

  /* 同步 */
  online: boolean
  syncing: boolean
  syncPct: number
  pending: Array<{ label: string; opId?: string }>
  lastSync: string
  paired: PairedDevice | null
  toggleOnline: () => void
  runSync: () => void
  markPending: (label: string, opId?: string) => void
  pairWith: (input: string, code: string) => Promise<void>
  unpair: () => void

  /* 日程 */
  schedView: SchedView
  setSchedView: (v: SchedView) => void
  selDate: string
  setSelDate: (d: string) => void
  todos: Todo[]
  toggleTodo: (id: string) => void
  addTodo: (input: { title: string; type: Todo['type']; time: string; date?: string }) => void
  deleteTodo: (id: string) => void
  habits: Habit[]
  toggleHabit: (id: string) => void

  /* 记账 */
  /** 账本本地真相（同步形态；编辑/删除/对账都基于它） */
  entries: LedgerEntry[]
  /** 展示形态派生（LedgerPage 渲染用） */
  txs: Tx[]
  saveTx: (input: { type: 'expense' | 'income'; amount: number; cat: string; acc: string; merchant?: string; date?: string }) => void
  updateTx: (id: string, input: { type: 'expense' | 'income'; amount: number; cat: string; acc: string; merchant?: string; date?: string }) => void
  deleteTx: (id: string) => void
  /** 「改一笔」抽屉的目标条目 */
  editTxId: string | null
  openTxEdit: (id: string, from?: HTMLElement | null) => void

  /* 笔记 */
  folders: Folder[]
  toggleFolder: (index: number) => void
  markCached: (title: string) => void
  phoneNotes: PhoneNote[]
  addPhoneNote: (title: string, body: string) => void

  /* AI */
  aiMode: AiMode
  setAiMode: (m: AiMode) => void
  /** 直连档模型配置（pm.aiConfig，Key 只在本机） */
  aiConfig: AiConfig
  updateAiConfig: (cfg: AiConfig) => void
  sessions: Session[]
  curSession: string
  newSession: () => void
  switchSession: (id: string) => void
  deleteSession: (id: string) => void
  renameSession: (id: string, title: string) => void
  togglePin: (id: string) => void
  streaming: boolean
  streamText: string
  sendChat: (text: string) => void
  /** 用户停止当前生成：在途请求中断；打字机阶段立即落完整消息 */
  stopStream: () => void
  confirmCard: (msgId: string, kind: CardKind) => void
  dismissCard: (msgId: string) => void

  /* 语音 */
  voicePhase: VoicePhase
  voiceElapsed: number
  toggleVoice: () => void
}

const Ctx = createContext<Store | null>(null)

export function useApp(): Store {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp must be used within AppProvider')
  return v
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(() => {
    const saved = loadJson<ThemeName>(K_THEME, 'dark')
    return THEME_IDS.includes(saved) ? saved : 'dark'
  })
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [sheet, setSheet] = useState<SheetId>(null)
  const [sheetOrigin, setSheetOrigin] = useState<HTMLElement | null>(null)
  const [activeTab, setActiveTabState] = useState('ai')
  const activeTabRef = useRef(activeTab); activeTabRef.current = activeTab
  const [kbSim, setKbSim] = useState(false)
  const [kbOpen, setKbOpen] = useState(false)

  const [online, setOnline] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncPct, setSyncPct] = useState(0)
  const [pending, setPending] = useState<Array<{ label: string; opId?: string }>>([])
  const [lastSync, setLastSync] = useState('今天 09:12')
  const [paired, setPaired] = useState<PairedDevice | null>(() => getPaired())

  const [schedView, setSchedView] = useState<SchedView>('list')
  const [selDate, setSelDate] = useState(TODAY)
  /* 日程/待办落本地存储（M2a）：重启不丢；首次启动播种子（真实「今天」锚点），之后以存量为准 */
  const [todos, setTodos] = useState<Todo[]>(() => loadJson<Todo[]>(K_TODOS, seedTodos))
  const [habits, setHabits] = useState<Habit[]>(() => seedHabits())

  /* 账本本地真相 = 同步形态（M2b）；展示形态派生 */
  const [entries, setEntries] = useState<LedgerEntry[]>(() => loadJson<LedgerEntry[]>(K_LEDGER, seedEntries))
  const txs = useMemo(() => entries.map(txToDisplay), [entries])

  /* 平板侧栏收纳：rail(64px 图标) ⇄ 展开(232px)，落 localStorage 重启保持 */
  const [sideCollapsed, setSideCollapsed] = useState(() => localStorage.getItem('tb.sideCollapsed') === '1')
  const toggleSide = useCallback(() => {
    setSideCollapsed(v => {
      localStorage.setItem('tb.sideCollapsed', v ? '0' : '1')
      return !v
    })
  }, [])

  useEffect(() => { saveJson(K_TODOS, todos) }, [todos])
  useEffect(() => { saveJson(K_LEDGER, entries) }, [entries])

  const [folders, setFolders] = useState<Folder[]>(seedFolders)
  const [phoneNotes, setPhoneNotes] = useState<PhoneNote[]>(() => loadJson<PhoneNote[]>(K_NOTES, seedPhoneNotes))
  useEffect(() => { saveJson(K_NOTES, phoneNotes) }, [phoneNotes])

  const [aiMode, setAiMode] = useState<AiMode>('direct')
  const [aiConfig, setAiConfigState] = useState<AiConfig>(() => loadAiConfig())
  const [sessions, setSessions] = useState<Session[]>(seedSessions)
  const [curSession, setCurSession] = useState('s1')
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')

  const [voicePhase, setVoicePhase] = useState<VoicePhase>('idle')
  const [voiceElapsed, setVoiceElapsed] = useState(0)
  const voiceToasted = useRef(false)
  const voiceIdx = useRef(0)
  const voiceTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const voiceElapsedRef = useRef(0)
  const streamTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  /* 停止生成：在途 fetch 的中断源 + 打字机阶段的完整消息（停止时立即落盘） */
  const abortRef = useRef<AbortController | null>(null)
  const revealRef = useRef<{ full: string; done: (finalText: string) => void } | null>(null)

  /* 最新状态镜像：供定时器/异步回调读取，避免陈旧闭包 */
  const onlineRef = useRef(online); onlineRef.current = online
  const syncingRef = useRef(syncing); syncingRef.current = syncing
  const pendingRef = useRef(pending); pendingRef.current = pending
  const sessionsRef = useRef(sessions); sessionsRef.current = sessions
  const curSessionRef = useRef(curSession); curSessionRef.current = curSession
  const streamingRef = useRef(streaming); streamingRef.current = streaming
  const entriesRef = useRef(entries); entriesRef.current = entries
  const todosRef = useRef(todos); todosRef.current = todos
  const phoneNotesRef = useRef(phoneNotes); phoneNotesRef.current = phoneNotes
  const aiConfigRef = useRef(aiConfig); aiConfigRef.current = aiConfig
  const aiModeRef = useRef(aiMode); aiModeRef.current = aiMode
  const pairedRef = useRef(paired); pairedRef.current = paired
  const runSyncRef = useRef<() => void>(() => {})

  useEffect(() => { document.documentElement.dataset.theme = theme; saveJson(K_THEME, theme) }, [theme])

  const toast = useCallback((msg: string, type: ToastItem['type'] = 'info') => {
    const id = Date.now() + Math.random()
    setToasts(t => [...t, { id, msg, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2400)
  }, [])

  const setTheme = useCallback((t: ThemeName) => setThemeState(t), [])
  const openSheet = useCallback((id: Exclude<SheetId, null>, from?: HTMLElement | null) => {
    setSheetOrigin(from ?? null)
    setSheet(id)
  }, [])
  const closeSheet = useCallback(() => { setSheet(null); setSheetOrigin(null) }, [])
  const toggleKbSim = useCallback(() => setKbSim(s => !s), [])

  /* Tab 切换 = 从按点圆形铺开：旧帧定格为底、新页经 clip-path 圆铺满（260ms）。
     View Transitions 需要 WebView 111+；不支持或系统减动效 → 瞬时切换 */
  const setActiveTab = useCallback((t: string, from?: HTMLElement | null) => {
    if (t === activeTabRef.current) return
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (typeof doc.startViewTransition !== 'function' || reduce) {
      setActiveTabState(t)
      return
    }
    const vt = doc.startViewTransition(() => { flushSync(() => setActiveTabState(t)) })
    void vt.ready.then(() => {
      const w = document.documentElement.clientWidth
      const h = document.documentElement.clientHeight
      const b = from?.getBoundingClientRect()
      const x = b ? b.left + b.width / 2 : w / 2
      const y = b ? b.top + b.height / 2 : h - 64
      const r = Math.hypot(Math.max(x, w - x), Math.max(y, h - y)) + 20
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 260, easing: 'cubic-bezier(.23,1,.32,1)', pseudoElement: '::view-transition-new(root)' },
      )
    }).catch(() => { /* 转场被跳过（如连续快速切换）：无需动画 */ })
  }, [])

  /* 「改一笔」抽屉：打开前先钉住目标条目（TxSheet 挂载时读取），从触发行圆形展开 */
  const [editTxId, setEditTxId] = useState<string | null>(null)
  const openTxEdit = useCallback((id: string, from?: HTMLElement | null) => {
    setEditTxId(id)
    setSheetOrigin(from ?? null)
    setSheet('tx-edit')
  }, [])

  /* 系统键盘探测：文本输入聚焦 ≈ 键盘弹出（自定义数字键盘是 button，不触发，符合预期）。
     真机上配合 viewport 的 resizes-content：键盘收缩布局视口 + kb-open 隐藏底栏 = 原生键盘模型。
     抽屉内的聚焦输入框还要「停靠」：抽屉 bottom 下沉（纯布局属性，动画走 bottom 通道），
     让键盘上沿正好贴住输入框下沿——输入框以下的部分滑进键盘底下被盖住。
     offsetTop 是布局距离，不受抽屉滑入动画的 transform 影响。 */
  useEffect(() => {
    const isText = (t: EventTarget | null) => t instanceof HTMLElement && t.matches('input, textarea')
    const dock = (el: HTMLElement) => {
      const sheet = el.closest('.sheet')
      if (!(sheet instanceof HTMLElement)) return
      const gap = 12
      const dist = sheet.offsetHeight - (el.offsetTop + el.offsetHeight)
      sheet.style.bottom = -Math.max(0, dist - gap) + 'px'
    }
    const undock = (el: HTMLElement) => {
      const sheet = el.closest('.sheet')
      if (sheet instanceof HTMLElement) sheet.style.bottom = ''
    }
    const onIn = (e: FocusEvent) => {
      if (!isText(e.target)) return
      setKbOpen(true)
      const el = e.target as HTMLElement
      requestAnimationFrame(() => dock(el))
    }
    const onOut = (e: FocusEvent) => {
      if (!isText(e.target)) return
      setKbOpen(false)
      undock(e.target as HTMLElement)
    }
    /* 真机键盘弹出/收起会改布局视口：重算当前聚焦输入框的停靠量 */
    const recompute = () => {
      const ae = document.activeElement
      if (ae instanceof HTMLElement && isText(ae)) dock(ae)
    }
    window.visualViewport?.addEventListener('resize', recompute)
    document.addEventListener('focusin', onIn)
    document.addEventListener('focusout', onOut)
    return () => {
      window.visualViewport?.removeEventListener('resize', recompute)
      document.removeEventListener('focusin', onIn)
      document.removeEventListener('focusout', onOut)
    }
  }, [])

  const markPending = useCallback((label: string, opId?: string) => {
    setPending(p => [...p, opId ? { label, opId } : { label }])
  }, [])

  /* 电脑下行的记账条目按 id 幂等并入本地账本（自己的上行被原样带回时 = 无操作；
     在途删除的 id 跳过——本地已删，等队列 push 落墓碑）；展示顺序 = updatedAt 倒序 */
  const applyRemoteLedger = useCallback((remote: RemoteLedgerItem[]) => {
    if (!remote.length) return
    const delIds = queuedDeleteIds()
    setEntries(list => {
      const byId = new Map(list.map(e => [e.id, e]))
      for (const r of remote) {
        if (delIds.has(r.id)) continue
        byId.set(r.id, { id: r.id, updatedAt: r.updatedAt, data: r.data })
      }
      return [...byId.values()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    })
  }, [])

  /* 电脑下行的日程条目幂等并入本地（含子任务行：只用于聚合计数，不独立展示） */
  const applyRemoteSchedule = useCallback((remote: RemoteScheduleItem[]) => {
    if (!remote.length) return
    const delIds = queuedDeleteIds()
    setTodos(list => {
      let next = [...list]
      for (const r of remote) {
        if (delIds.has(r.id)) continue
        const d = r.data
        const prev = next.find(t => t.id === r.id)
        const item: Todo = {
          id: r.id, date: d.date, title: d.title, type: d.type,
          time: d.time, tag: prev?.tag || '电脑', done: d.done,
          sched: d.schedStart != null ? { s: d.schedStart, e: d.schedEnd ?? d.schedStart } : undefined,
          parentId: d.parentId,
        }
        next = next.filter(t => t.id !== r.id)
        next.push(item)
      }
      /* 子任务聚合计数：有实际子行的父条目刷新 subDone/subTotal（种子演示计数没有实际子行，保留） */
      const agg = new Map<string, { total: number; done: number }>()
      for (const t of next) {
        if (!t.parentId) continue
        const c = agg.get(t.parentId) || { total: 0, done: 0 }
        c.total++
        if (t.done) c.done++
        agg.set(t.parentId, c)
      }
      return next.map(t => {
        const c = agg.get(t.id)
        return c ? { ...t, subTotal: c.total, subDone: c.done } : t
      })
    })
  }, [])

  /* 墓碑下行：本地删除 + 丢弃这些 id 的在途队列操作（幂等） */
  const applyTombstones = useCallback((removedIds: string[]) => {
    if (!removedIds.length) return
    const gone = new Set(removedIds)
    setTodos(list => list.filter(t => !gone.has(t.id)))
    setEntries(list => list.filter(e => !gone.has(e.id)))
    removeFromQueue(removedIds)
  }, [])

  const runSync = useCallback(() => {
    void (async () => {
      if (syncingRef.current) return
      if (!getPaired()) { toast('先到「设置」配对电脑，才能同步', 'warn'); return }
      if (!onlineRef.current) { toast('电脑不在线，同步搁置', 'warn'); return }
      /* 真实对账（push 队列 + pull 双域增量 + 墓碑） */
      if (getQueue().length === 0 && pendingRef.current.length === 0) { toast('没有待同步的变更', 'info'); return }
      setSyncing(true)
      setSyncPct(8)
      try {
        const out = await syncNow(pct => setSyncPct(pct))
        applyRemoteLedger(out.remoteLedger)
        applyRemoteSchedule(out.remoteSchedule)
        applyTombstones(out.removedIds)
        const handled = new Set(out.handledIds)
        setPending(list => list.filter(x => !x.opId || !handled.has(x.opId)))
        // notes 域出队 → 对应手机笔记标记已同步（op.id = 笔记 id）
        if (out.handledIds.length) {
          setPhoneNotes(list => list.map(x => handled.has(x.id) ? { ...x, synced: true } : x))
        }
        setSyncing(false)
        setSyncPct(0)
        const now = new Date()
        setLastSync('今天 ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0'))
        const parts: string[] = []
        if (out.applied) parts.push('上行 ' + out.applied + ' 条')
        if (out.conflicts) parts.push(out.conflicts + ' 条以电脑为准')
        if (out.pulled) parts.push('下行 ' + out.pulled + ' 条')
        if (out.removedIds.length) parts.push('删除 ' + out.removedIds.length + ' 条')
        toast(parts.length ? '已同步：' + parts.join(' · ') : '与电脑已是对账状态', 'ok')
      } catch (e) {
        setSyncing(false)
        setSyncPct(0)
        toast(e instanceof Error ? e.message : '同步失败', 'warn')
      }
    })()
  }, [toast, applyRemoteLedger, applyRemoteSchedule, applyTombstones])

  const toggleOnline = useCallback(() => {
    void (async () => {
      const device = getPaired()
      if (!device) { toast('先到「设置」配对电脑，才能连接', 'warn'); return }
      if (onlineRef.current) {
        setOnline(false)
        toast('已切到离线 · 数据照常记在手机', 'warn')
        return
      }
      toast('正在连接 ' + device.pcName + '…', 'info')
      const ok = await probeOnline()
      setOnline(ok)
      if (ok) {
        toast('已连上 ' + device.pcName, 'ok')
        if (getQueue().length) setTimeout(() => void runSyncRef.current(), 400)
      } else {
        toast('连不上电脑：确认同一网络、电脑端服务已开启', 'warn')
      }
    })()
  }, [toast])

  /* ---------- 配对 ---------- */

  const pairWith = useCallback(async (input: string, code: string) => {
    try {
      const device = await pairRequest(input, code, 'Phrontis 手机')
      setPaired(device)
      toast('已配对 ' + device.pcName + ' · 开始首次对账', 'ok')
      const ok = await probeOnline()
      setOnline(ok)
      if (ok) setTimeout(() => void runSyncRef.current(), 500)
    } catch (e) {
      toast(e instanceof Error ? e.message : '配对失败', 'warn')
    }
  }, [toast])

  const unpair = useCallback(() => {
    unpairDevice()
    setPaired(null)
    setOnline(true)
    toast('已解除配对，数据保留在手机', 'ok')
  }, [toast])

  /* 直连档 AI 配置：pm.aiConfig，Key 只在本机（不上行、不进同步队列） */
  const updateAiConfig = useCallback((cfg: AiConfig) => {
    setAiConfigState(cfg)
    saveAiConfig(cfg)
  }, [])

  /* 已配对：启动即探测电脑，在线且有积压就自动对账 */
  useEffect(() => {
    if (!getPaired()) return
    void probeOnline().then(ok => {
      setOnline(ok)
      if (ok && getQueue().length) setTimeout(() => void runSyncRef.current(), 800)
    })
  }, [])
  runSyncRef.current = runSync

  /* ---------- 日程（v1.1：真实条目 + schedule 域上行） ---------- */

  const toggleTodo = useCallback((id: string) => {
    const t = todos.find(x => x.id === id)
    if (!t) return
    const next: Todo = { ...t, done: !t.done }
    setTodos(list => list.map(x => x.id === id ? next : x))
    // 上行最新状态；enqueueOp 按条目 id 去重 → 同一条目的连续切换只留最新一条
    enqueueOp({
      id, domain: 'schedule', updatedAt: new Date().toISOString(),
      data: buildScheduleData(next),
      label: (next.done ? '完成' : '撤销') + '：' + t.title,
    })
    markPending((next.done ? '完成' : '撤销') + '：' + t.title, id)
  }, [todos, markPending])

  const addTodo = useCallback((input: { title: string; type: Todo['type']; time: string; date?: string }) => {
    const d = input.date || selDate
    const id = uuid()
    const item: Todo = { id, date: d, title: input.title, type: input.type, time: input.time, tag: '手机', done: false, parentId: null }
    const label = '待办「' + input.title + '」' + (d === TODAY ? '' : '（' + d + '）')
    enqueueOp({ id, domain: 'schedule', updatedAt: new Date().toISOString(), data: buildScheduleData(item), label })
    setTodos(list => [...list, item])
    markPending(label, id)
    toast('已加待办 · 待同步', 'ok')
  }, [selDate, markPending, toast])

  const deleteTodo = useCallback((id: string) => {
    const t = todos.find(x => x.id === id)
    if (!t) return
    setTodos(list => list.filter(x => x.id !== id))
    // 墓碑上行（v1.1）：data {deleted:true}；若该条目还有在途 upsert，按 id 去重后被删除取代
    enqueueOp({ id, domain: 'schedule', updatedAt: new Date().toISOString(), data: { deleted: true }, label: '删除：' + t.title })
    markPending('删除：' + t.title, id)
    toast('已删除 · 待同步进电脑', 'ok')
  }, [todos, markPending, toast])

  /* 打卡只记本地（打卡暂不参与同步，不入队列、不挂待同步徽标——挂了也永远等不到出队） */
  const toggleHabit = useCallback((id: string) => {
    const h = habits.find(x => x.id === id)
    if (!h) return
    const todayIdx = (new Date().getDay() + 6) % 7
    const wasDone = !!h.hist[todayIdx]
    const hist = [...h.hist]; hist[todayIdx] = wasDone ? 0 : 1
    const weekDone = hist.slice(0, todayIdx + 1).reduce((s, v) => s + v, 0)
    let streak = 0
    for (let i = wasDone ? todayIdx : todayIdx - 1; i >= 0 && hist[i]; i--) streak++
    setHabits(list => list.map(x => x.id === id ? { ...x, hist, weekDone, streak } : x))
    if (!wasDone) toast('打卡成功', 'ok')
  }, [habits, toast])

  /* ---------- 记账（M2b：本地真相 = 同步形态，增改删都走同一条上行路径） ---------- */

  const saveTx = useCallback((input: { type: 'expense' | 'income'; amount: number; cat: string; acc: string; merchant?: string; date?: string }) => {
    const isExp = input.type === 'expense'
    /* 条目 UUID 在生成时定死并终身不变：本地展示与上行同步共用同一 id */
    const id = uuid()
    const nowD = new Date()
    const nowIso = nowD.toISOString()
    const pad2 = (n: number) => String(n).padStart(2, '0')
    const todayIso = nowD.getFullYear() + '-' + pad2(nowD.getMonth() + 1) + '-' + pad2(nowD.getDate())
    /* 日期可选（补记昨天的饭钱）；time 恒为记录时刻 */
    const dateIso = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : todayIso
    const time = pad2(nowD.getHours()) + ':' + pad2(nowD.getMinutes())
    const data: LedgerSyncData = {
      date: dateIso, time, type: input.type, amount: input.amount,
      category: input.cat, payment: input.acc, merchant: input.merchant || input.cat, note: '',
    }
    const label = (isExp ? '支出' : '收入') + ' ¥' + fmtMoney(input.amount) + ' · ' + input.cat + (dateIso === todayIso ? '' : '（' + dateIso + '）')
    enqueueOp({ id, domain: 'ledger', updatedAt: nowIso, data, label })
    setEntries(list => [{ id, updatedAt: nowIso, data }, ...list])
    markPending(label, id)
    toast('已记一笔 · 待同步进电脑', 'ok')
  }, [markPending, toast])

  /** 改账：时间保留原值，日期/可变字段可改；updatedAt 推进走同一条 LWW 时线 */
  const updateTx = useCallback((id: string, input: { type: 'expense' | 'income'; amount: number; cat: string; acc: string; merchant?: string; date?: string }) => {
    const prev = entries.find(x => x.id === id)
    if (!prev) return
    const nowIso = new Date().toISOString()
    const data: LedgerSyncData = {
      ...prev.data,
      ...(input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? { date: input.date } : {}),
      type: input.type, amount: input.amount,
      category: input.cat, payment: input.acc, merchant: input.merchant || input.cat,
    }
    const label = '改账：' + (data.merchant || data.category) + ' ¥' + fmtMoney(input.amount)
    enqueueOp({ id, domain: 'ledger', updatedAt: nowIso, data, label })
    setEntries(list => list.map(x => x.id === id ? { id, updatedAt: nowIso, data } : x))
    markPending(label, id)
    toast('已改账 · 待同步', 'ok')
  }, [entries, markPending, toast])

  /** 删账：墓碑上行（v1.1）；若该条目还有在途 upsert，按 id 去重后被删除取代 */
  const deleteTx = useCallback((id: string) => {
    const e = entries.find(x => x.id === id)
    if (!e) return
    setEntries(list => list.filter(x => x.id !== id))
    enqueueOp({ id, domain: 'ledger', updatedAt: new Date().toISOString(), data: { deleted: true }, label: '删除：' + (e.data.merchant || e.data.category) })
    markPending('删除：' + (e.data.merchant || e.data.category), id)
    toast('已删除 · 待同步进电脑', 'ok')
  }, [entries, markPending, toast])

  /* ---------- 笔记 ---------- */

  const toggleFolder = useCallback((index: number) => {
    setFolders(list => list.map((f, i) => i === index ? { ...f, open: !f.open } : f))
  }, [])

  const markCached = useCallback((title: string) => {
    setFolders(list => list.map(f => ({ ...f, files: f.files.map(x => x.title === title ? { ...x, cached: true } : x) })))
  }, [])

  /* 手机笔记上行（v1.2 notes 域）：id 即条目 UUID，桌面按它落 md（收件箱 + tags「手机」） */
  const addPhoneNote = useCallback((title: string, body: string) => {
    const id = uuid()
    const label = '笔记「' + title.slice(0, 20) + '」'
    enqueueOp({ id, domain: 'notes', updatedAt: new Date().toISOString(), data: buildNoteData(title, body), label })
    setPhoneNotes(list => [{ id, title, body, synced: false }, ...list])
    markPending(label, id)
  }, [markPending])

  /* ---------- AI ---------- */

  const newSession = useCallback(() => {
    const s: Session = { id: nextId('s'), title: '新会话', ts: Date.now(), pinned: false, messages: [{ id: nextId('m'), role: 'ai', text: welcomeText() }] }
    setSessions(list => [...list, s])
    setCurSession(s.id)
  }, [])

  const switchSession = useCallback((id: string) => {
    setCurSession(id)
  }, [])

  const deleteSession = useCallback((id: string) => {
    const rest = sessionsRef.current.filter(s => s.id !== id)
    if (id === curSessionRef.current) {
      const next = [...rest].sort((a, b) => b.ts - a.ts)[0]
      if (next) {
        setCurSession(next.id)
      } else {
        const s: Session = { id: nextId('s'), title: '新会话', ts: Date.now(), pinned: false, messages: [{ id: nextId('m'), role: 'ai', text: welcomeText() }] }
        rest.push(s)
        setCurSession(s.id)
      }
    }
    setSessions(rest)
    toast('会话已删除', 'ok')
  }, [toast])

  const renameSession = useCallback((id: string, title: string) => {
    setSessions(list => list.map(s => s.id === id ? { ...s, title } : s))
    toast('已重命名', 'ok')
  }, [toast])

  const togglePin = useCallback((id: string) => {
    const s = sessionsRef.current.find(x => x.id === id)
    if (!s) return
    setSessions(list => list.map(x => x.id === id ? { ...x, pinned: !x.pinned } : x))
    toast(s.pinned ? '已取消置顶' : '已置顶', 'ok')
  }, [toast])

  const pushAiMsg = useCallback((msg: Omit<Msg, 'id'>) => {
    const sid = curSessionRef.current
    setSessions(list => list.map(s => s.id === sid ? { ...s, ts: Date.now(), messages: [...s.messages, { ...msg, id: nextId('m') }] } : s))
  }, [])

  const route = useCallback((text: string): { reply: string; card?: Card; list?: Todo[]; noteCapture?: string } => {
    if (/记一笔|午饭/.test(text)) {
      /* 演示卡也带真实提案数据：确认后走同一条 saveTx 真写入（原先没带 data，确认按钮是空操作） */
      return { reply: '好的，帮你整理成一笔支出，确认后保存到手机账本，下次同步进电脑：', card: { kind: 'tx', data: { type: 'expense', amount: 30, category: '餐饮', account: '微信', merchant: '午饭' } } }
    }
    if (/改到|明晚|改期/.test(text)) {
      return { reply: '找到这条日程了，时间帮你改好，确认后生效并进同步队列：', card: { kind: 'move' } }
    }
    if (/安排|日程|今天/.test(text)) {
      const todays = todos.filter(t => t.date === TODAY)
      return { reply: '看了下你今天的日程，共 ' + todays.length + ' 条：', list: todays }
    }
    if (/想法|原型/.test(text)) {
      const captured = text.replace(/^记个想法[:：]?\s*/, '') || '（无正文）'
      return { reply: '已经帮你记到手机笔记里了：「' + captured + '」。同步后可以在电脑端继续整理。', noteCapture: captured }
    }
    return {
      reply: '收到。这里是原型的占位回复 —— 正式版会调用你在设置里配置的模型（现在是' + (aiMode === 'direct' ? '手机直连' : '电脑代理') + '模式），并可以带着工具直接操作你的记账、日程和笔记。',
    }
  }, [todos, aiMode])

  /* 直连档工具执行器：读直查本地状态；写只产出提案（确认卡），绝不在这里落库 */
  const executeTool = (name: string, args: Record<string, unknown>): ToolResult => {
    const no = (msg: string): ToolResult => ({ ok: false, forModel: msg })
    switch (name) {
      case 'now_time': {
        const d = new Date()
        const p2 = (n: number) => String(n).padStart(2, '0')
        return {
          ok: true,
          forModel: JSON.stringify({
            date: TODAY,
            time: p2(d.getHours()) + ':' + p2(d.getMinutes()),
            weekday: '日一二三四五六'[d.getDay()],
          }),
        }
      }
      case 'ledger_query': {
        const sorted = [...entriesRef.current].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        if (args.scope === 'month') {
          const ym = monthOf(TODAY)
          const st = monthStats(entriesRef.current, ym)
          return { ok: true, forModel: JSON.stringify({ month: ym, expense: st.expense, income: st.income, balance: st.balance }) }
        }
        const in7 = sorted.filter(e => e.data.date >= dayIso(-7))
        return {
          ok: true,
          forModel: JSON.stringify({
            week7: {
              expense: in7.filter(e => e.data.type === 'expense').reduce((s, e) => s + e.data.amount, 0),
              income: in7.filter(e => e.data.type === 'income').reduce((s, e) => s + e.data.amount, 0),
            },
            recent: sorted.slice(0, 10).map(e => ({ date: e.data.date, type: e.data.type, amount: e.data.amount, category: e.data.category, merchant: e.data.merchant })),
          }),
        }
      }
      case 'todo_query': {
        const date = typeof args.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.date) ? args.date : TODAY
        const items = todosRef.current.filter(t => t.date === date && !t.parentId)
        return {
          ok: true,
          forModel: JSON.stringify({ date, count: items.length, items: items.map(t => ({ title: t.title, type: t.type, done: t.done, time: t.time })) }),
        }
      }
      case 'ledger_add': {
        const p = validateLedgerAdd(args)
        if (typeof p === 'string') return no(p)
        return {
          ok: true,
          forModel: '已生成记账确认卡（' + (p.type === 'expense' ? '支出' : '收入') + ' ¥' + p.amount + ' · ' + p.category + '）。等用户确认，不要重复调用。',
          proposal: { kind: 'tx', data: p },
        }
      }
      case 'todo_add': {
        const p = validateTodoAdd(args, TODAY)
        if (typeof p === 'string') return no(p)
        return { ok: true, forModel: '已生成待办确认卡（' + p.title + ' @ ' + p.date + '）。等用户确认。', proposal: { kind: 'todo', data: p } }
      }
      case 'note_create': {
        const p = validateNoteCreate(args)
        if (typeof p === 'string') return no(p)
        return { ok: true, forModel: '已生成笔记确认卡。等用户确认后上行电脑收件箱。', proposal: { kind: 'note', data: p } }
      }
      case 'notes_list': {
        const items = phoneNotesRef.current.map(x => ({ title: x.title, synced: x.synced }))
        return { ok: true, forModel: JSON.stringify({ count: items.length, items: items.slice(0, 20) }) }
      }
      default:
        return no('未知工具：' + name)
    }
  }

  /* 打字机呈现（网络层非流式，观感流式）：完成后把最终消息挂进会话。
     revealRef 记着完整消息与落盘回调——用户点停止时立即落完整消息，不丢回复 */
  const startReveal = (full: string, done: (finalText: string) => void) => {
    setStreaming(true)
    revealRef.current = { full, done }
    let i = 0
    streamTimer.current = setInterval(() => {
      i = Math.min(full.length, i + 2 + Math.floor(Math.random() * 3))
      setStreamText(full.slice(0, i))
      if (i >= full.length) {
        if (streamTimer.current) clearInterval(streamTimer.current)
        streamTimer.current = null
        setStreaming(false)
        setStreamText('')
        revealRef.current = null
        done(full)
      }
    }, 24)
  }

  /* 停止生成：在途请求中断（store 的 async catch 里静默收尾）；
     已进入打字机阶段则立即落完整消息；两者都没有时只复位状态 */
  const stopStream = useCallback(() => {
    abortRef.current?.abort()
    if (streamTimer.current) { clearInterval(streamTimer.current); streamTimer.current = null }
    const rv = revealRef.current
    if (rv) {
      revealRef.current = null
      setStreaming(false)
      setStreamText('')
      rv.done(rv.full)
      return
    }
    if (streamingRef.current) { setStreaming(false); setStreamText('') }
  }, [])

  /* 直连档真实工具循环（M4a）：上限 AI_MAX_ROUNDS 轮；写工具产出确认卡后停轮等确认 */
  const runDirectAgent = (userText: string) => {
    const cfg = aiConfigRef.current
    const sid = curSessionRef.current
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setStreaming(true)
    setStreamText('正在思考')
    void (async () => {
      try {
        const history: AiChatMsg[] = [{ role: 'system', content: buildSystemPrompt(TODAY, pairedRef.current?.pcName ?? null) }]
        const sess = sessionsRef.current.find(s => s.id === sid)
        for (const m of (sess?.messages ?? []).slice(-12)) {
          history.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text })
        }
        history.push({ role: 'user', content: userText })
        let card: Card | undefined
        let rounds = 0
        let finalText = ''
        while (rounds < AI_MAX_ROUNDS) {
          rounds++
          const reply = await chatOnce(cfg, history, AI_TOOLS, 60_000, ctrl.signal, sid)
          if (!reply.toolCalls.length) { finalText = reply.content; break }
          history.push({ role: 'assistant', content: reply.content, tool_calls: reply.toolCalls })
          let proposed = false
          for (const tc of reply.toolCalls) {
            const result = executeTool(tc.function.name, parseToolArgs(tc.function.arguments))
            history.push({ role: 'tool', tool_call_id: tc.id, content: result.forModel })
            if (result.proposal) {
              card = { kind: result.proposal.kind, data: result.proposal.data }
              proposed = true
            }
          }
          if (proposed) {
            // 确认卡已出：停轮等用户确认，不再让模型继续烧 token
            finalText = reply.content || '整理好了，确认后就生效。'
            break
          }
        }
        if (!finalText) finalText = rounds >= AI_MAX_ROUNDS ? '工具轮次用尽了，先到这里——换个问法再试试。' : '（模型没有返回内容）'
        startReveal(finalText, f => { pushAiMsg({ role: 'ai', text: f, card }) })
        abortRef.current = null
      } catch (e) {
        abortRef.current = null
        setStreaming(false)
        setStreamText('')
        if (e instanceof AiStopped) { toast('已停止生成', 'info'); return }
        const msg = e instanceof Error ? e.message : 'AI 请求失败'
        toast(msg, 'warn')
        pushAiMsg({ role: 'ai', text: '没连上模型：' + msg })
      }
    })()
  }

  /* 电脑档（M4b）：对话中继到桌面完整 agentService，写入直接在电脑真相源执行。
     手机会话 ↔ 桌面会话映射由 pcChat 内部维护（桌面删了会话自动续新） */
  const runPcAgent = (userText: string) => {
    const sid = curSessionRef.current
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setStreaming(true)
    setStreamText('电脑处理中…')
    void (async () => {
      try {
        const r = await pcChat(sid, userText, ctrl.signal)
        startReveal(r.reply || '（电脑没有返回内容）', f => {
          pushAiMsg({ role: 'ai', text: f, changes: r.changes.length ? r.changes : undefined })
        })
        abortRef.current = null
      } catch (e) {
        abortRef.current = null
        setStreaming(false)
        setStreamText('')
        if (e instanceof AiStopped) { toast('已停止生成（电脑那一轮会继续跑完）', 'info'); return }
        const msg = e instanceof Error ? e.message : '电脑档请求失败'
        toast(msg, 'warn')
        pushAiMsg({ role: 'ai', text: '电脑档没跑成：' + msg })
      }
    })()
  }

  const sendChat = useCallback((text: string) => {
    if (streamingRef.current) return
    const trimmed = text.trim()
    if (!trimmed) return
    const sid = curSessionRef.current
    setSessions(list => list.map(s => {
      if (s.id !== sid) return s
      const title = s.title === '新会话' ? trimmed.slice(0, 14) : s.title
      return { ...s, title, ts: Date.now(), messages: [...s.messages, { id: nextId('m'), role: 'user', text: trimmed }] }
    }))

    /* 电脑档：真实中继（桌面完整 agentService，同 Key / 全库工具） */
    if (aiModeRef.current === 'pc') {
      if (!pairedRef.current) {
        startReveal('电脑档需要先配对电脑——到「设置」完成配对，或先用手机直连档。', final => {
          pushAiMsg({ role: 'ai', text: final })
        })
        return
      }
      runPcAgent(trimmed)
      return
    }

    /* 直连档已配置 → 真实工具循环 */
    if (aiConfigReady(aiConfigRef.current)) {
      runDirectAgent(trimmed)
      return
    }

    /* 未配置 → 演示通路（脚本行为保留），附配置指引 */
    const r = route(trimmed)
    const hint = '\n\n演示回复——到「设置 → AI 模型」配好 Key，我就能真的帮你记账、查日程。'
    startReveal(r.reply + hint, final => {
      pushAiMsg({ role: 'ai', text: final, card: r.card, list: r.list })
      if (r.noteCapture) {
        setTimeout(() => addPhoneNote('手机原型讨论', r.noteCapture!), 600)
      }
    })
  }, [route, pushAiMsg, addPhoneNote])

  const updateMsg = useCallback((msgId: string, fn: (m: Msg) => Msg) => {
    const sid = curSessionRef.current
    setSessions(list => list.map(s => s.id === sid
      ? { ...s, messages: s.messages.map(m => m.id === msgId ? fn(m) : m) }
      : s))
  }, [])

  /* 确认卡 → 真实写入：走与 UI 按钮同一条路径（saveTx / addTodo / addPhoneNote），
     写入即进同步队列；未确认的卡什么都不发生 */
  const confirmCard = useCallback((msgId: string, kind: CardKind) => {
    const sid = curSessionRef.current
    const msg = sessionsRef.current.find(s => s.id === sid)?.messages.find(m => m.id === msgId)
    const data = msg?.card?.data
    if (kind === 'tx' && data && 'amount' in data) {
      const p = data as TxProposal
      saveTx({ type: p.type, amount: p.amount, cat: p.category, acc: p.account, merchant: p.merchant })
    } else if (kind === 'todo' && data && 'title' in data && 'date' in data) {
      const p = data as TodoProposal
      addTodo({ title: p.title, type: p.type, time: '', date: p.date })
    } else if (kind === 'note' && data && 'body' in data) {
      const p = data as NoteProposal
      addPhoneNote(p.title || '闪念', p.body)
    } else if (kind === 'move') {
      /* 演示卡（未配置 AI 时的脚本行为）：也走真实写入路径——原先只删本地不进队列，同步会把跑步条目原样带回来 */
      deleteTodo('t3')
      addTodo({ title: '跑步 30 分钟', type: 'daily', time: '19:30', date: dayIso(1) })
    }
    updateMsg(msgId, m => ({ ...m, card: m.card ? { ...m.card, confirmed: true } : m.card }))
  }, [saveTx, addTodo, deleteTodo, addPhoneNote, updateMsg])

  const dismissCard = useCallback((msgId: string) => {
    updateMsg(msgId, m => ({ ...m, card: undefined }))
    pushAiMsg({ role: 'ai', text: '好，你想怎么调整？直接打字告诉我就行。' })
  }, [updateMsg, pushAiMsg])

  /* ---------- 语音 ---------- */

  const stopVoice = useCallback((finish: boolean) => {
    if (voiceTimer.current) { clearInterval(voiceTimer.current); voiceTimer.current = null }
    if (!finish) { setVoicePhase('idle'); return }
    setVoicePhase('transcribing')
    setTimeout(() => {
      const phrase = VOICE_PHRASES[voiceIdx.current % VOICE_PHRASES.length]
      voiceIdx.current++
      setVoicePhase('idle')
      if (!streamingRef.current) {
        if (!voiceToasted.current) { toast('已转写 · 短句直接发送', 'info'); voiceToasted.current = true }
        sendChat(phrase)
      }
    }, 1100)
  }, [toast, sendChat])

  const toggleVoice = useCallback(() => {
    if (voicePhase === 'transcribing') return
    if (voicePhase === 'recording') { stopVoice(true); return }
    setVoicePhase('recording')
    voiceElapsedRef.current = 0
    setVoiceElapsed(0)
    voiceTimer.current = setInterval(() => {
      voiceElapsedRef.current++
      setVoiceElapsed(voiceElapsedRef.current)
      if (voiceElapsedRef.current >= 8) stopVoice(true)
    }, 1000)
  }, [voicePhase, stopVoice])

  const value: Store = {
    theme, setTheme, toast, toasts, sheet, openSheet, closeSheet, sheetOrigin, activeTab, setActiveTab, kbSim, toggleKbSim, kbOpen,
    sideCollapsed, toggleSide,
    online, syncing, syncPct, pending, lastSync, paired, toggleOnline, runSync, markPending, pairWith, unpair,
    schedView, setSchedView, selDate, setSelDate, todos, toggleTodo, addTodo, deleteTodo, habits, toggleHabit,
    entries, txs, saveTx, updateTx, deleteTx, editTxId, openTxEdit,
    folders, toggleFolder, markCached, phoneNotes, addPhoneNote,
    aiMode, setAiMode, aiConfig, updateAiConfig, sessions, curSession, newSession, switchSession, deleteSession, renameSession, togglePin,
    streaming, streamText, sendChat, stopStream, confirmCard, dismissCard,
    voicePhase, voiceElapsed, toggleVoice,
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
