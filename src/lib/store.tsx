import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { AiMode, Folder, Habit, LedgerSyncData, Msg, PairedDevice, PhoneNote, Session, SheetId, SchedView, ThemeName, Todo, Tx, VoicePhase } from './types'
import { seedFolders, seedHabits, seedSessions, seedTodos, seedTxs, TODAY, VOICE_PHRASES, WELCOME, fmtMoney, txDisplay } from './data'
import { enqueueOp, getPaired, getQueue, pairWith as pairRequest, probeOnline, syncNow, unpair as unpairDevice, uuid, type RemoteLedgerItem } from './sync'

export interface ToastItem { id: number; msg: string; type: 'ok' | 'warn' | 'info' }
export type Card = { kind: 'tx' | 'move'; confirmed?: boolean }

let seq = 100
const nextId = (p: string) => p + (++seq)

interface Store {
  /* 全局 */
  theme: ThemeName
  setTheme: (t: ThemeName) => void
  toast: (msg: string, type?: ToastItem['type']) => void
  toasts: ToastItem[]
  sheet: SheetId
  openSheet: (id: Exclude<SheetId, null>) => void
  closeSheet: () => void
  activeTab: string
  setActiveTab: (t: string) => void

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
  addTodo: (input: { title: string; type: Todo['type']; time: string }) => void
  habits: Habit[]
  toggleHabit: (id: string) => void

  /* 记账 */
  txs: Tx[]
  saveTx: (input: { type: 'expense' | 'income'; amount: number; cat: string; acc: string }) => void

  /* 笔记 */
  folders: Folder[]
  toggleFolder: (index: number) => void
  markCached: (title: string) => void
  phoneNotes: PhoneNote[]
  addPhoneNote: (title: string, body: string) => void

  /* AI */
  aiMode: AiMode
  setAiMode: (m: AiMode) => void
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
  confirmCard: (msgId: string, kind: 'tx' | 'move') => void
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
  const [theme, setThemeState] = useState<ThemeName>('dark')
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [sheet, setSheet] = useState<SheetId>(null)
  const [activeTab, setActiveTab] = useState('ai')

  const [online, setOnline] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncPct, setSyncPct] = useState(0)
  const [pending, setPending] = useState<Array<{ label: string; opId?: string }>>([])
  const [lastSync, setLastSync] = useState('今天 09:12')
  const [paired, setPaired] = useState<PairedDevice | null>(() => getPaired())

  const [schedView, setSchedView] = useState<SchedView>('list')
  const [selDate, setSelDate] = useState(TODAY)
  const [todos, setTodos] = useState<Todo[]>(seedTodos)
  const [habits, setHabits] = useState<Habit[]>(seedHabits)

  const [txs, setTxs] = useState<Tx[]>(seedTxs)

  const [folders, setFolders] = useState<Folder[]>(seedFolders)
  const [phoneNotes, setPhoneNotes] = useState<PhoneNote[]>([
    { id: 'p1', title: '咖啡馆随想', body: '手机版的记账要不要支持语音快速记？先想想。', synced: false },
  ])

  const [aiMode, setAiMode] = useState<AiMode>('direct')
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

  /* 最新状态镜像：供定时器/异步回调读取，避免陈旧闭包 */
  const onlineRef = useRef(online); onlineRef.current = online
  const syncingRef = useRef(syncing); syncingRef.current = syncing
  const pendingRef = useRef(pending); pendingRef.current = pending
  const sessionsRef = useRef(sessions); sessionsRef.current = sessions
  const curSessionRef = useRef(curSession); curSessionRef.current = curSession
  const streamingRef = useRef(streaming); streamingRef.current = streaming
  const runSyncRef = useRef<() => void>(() => {})

  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])

  const toast = useCallback((msg: string, type: ToastItem['type'] = 'info') => {
    const id = Date.now() + Math.random()
    setToasts(t => [...t, { id, msg, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2400)
  }, [])

  const setTheme = useCallback((t: ThemeName) => setThemeState(t), [])
  const openSheet = useCallback((id: Exclude<SheetId, null>) => setSheet(id), [])
  const closeSheet = useCallback(() => setSheet(null), [])

  const markPending = useCallback((label: string, opId?: string) => {
    setPending(p => [...p, opId ? { label, opId } : { label }])
  }, [])

  /* 电脑下行的记账条目按 id 幂等并入本地流水（自己的上行被原样带回时 = 无操作） */
  const applyRemoteLedger = useCallback((remote: RemoteLedgerItem[]) => {
    if (!remote.length) return
    setTxs(list => {
      const byId = new Map(list.map(t => [t.id, t]))
      const known = new Set(list.map(t => t.id))
      for (const r of remote) {
        const d = r.data
        const disp = txDisplay(d.date, d.time)
        byId.set(r.id, {
          id: r.id, date: disp.date, sub: disp.sub,
          name: d.merchant || d.category, cat: d.category,
          amt: d.type === 'expense' ? -d.amount : d.amount, acc: d.payment || '其他',
        })
      }
      const fresh: Tx[] = []
      const kept: Tx[] = []
      for (const t of byId.values()) (known.has(t.id) ? kept : fresh).push(t)
      return [...fresh.reverse(), ...kept]
    })
  }, [])

  const runSync = useCallback(() => {
    void (async () => {
      if (syncingRef.current) return
      const device = getPaired()
      if (!device || !onlineRef.current) {
        /* 未配对 / 离线 → 原型演示通路（数据只动本地展示） */
        if (!onlineRef.current) { toast('电脑不在线，同步搁置', 'warn'); return }
        const n = pendingRef.current.length
        if (n === 0) { toast('没有待同步的变更', 'info'); return }
        setSyncing(true)
        let pct = 0
        const timer = setInterval(() => {
          pct = Math.min(100, pct + 14 + Math.random() * 16)
          setSyncPct(pct)
          if (pct >= 100) {
            clearInterval(timer)
            setTimeout(() => {
              setPending([])
              setSyncing(false)
              setSyncPct(0)
              setLastSync('刚刚')
              setPhoneNotes(list => list.map(x => ({ ...x, synced: true })))
              toast('已同步 ' + n + ' 条变更到电脑', 'ok')
            }, 250)
          }
        }, 200)
        return
      }
      /* 已配对 → 真实对账（push 队列 + pull 记账增量） */
      if (getQueue().length === 0 && pendingRef.current.length === 0) { toast('没有待同步的变更', 'info'); return }
      setSyncing(true)
      setSyncPct(8)
      try {
        const out = await syncNow(pct => setSyncPct(pct))
        applyRemoteLedger(out.remote)
        const handled = new Set(out.handledIds)
        setPending(list => list.filter(x => !x.opId || !handled.has(x.opId)))
        setSyncing(false)
        setSyncPct(0)
        const now = new Date()
        setLastSync('今天 ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0'))
        const parts: string[] = []
        if (out.applied) parts.push('上行 ' + out.applied + ' 条')
        if (out.conflicts) parts.push(out.conflicts + ' 条以电脑为准')
        if (out.pulled) parts.push('下行 ' + out.pulled + ' 条')
        const remain = getQueue().length
        const remainNote = remain ? '（' + remain + ' 条日程变更待 M2 接入）' : ''
        toast(parts.length ? '已同步：' + parts.join(' · ') + remainNote : '与电脑已是对账状态' + remainNote, 'ok')
      } catch (e) {
        setSyncing(false)
        setSyncPct(0)
        toast(e instanceof Error ? e.message : '同步失败', 'warn')
      }
    })()
  }, [toast, applyRemoteLedger])

  const toggleOnline = useCallback(() => {
    void (async () => {
      const device = getPaired()
      if (!device) {
        /* 原型演示通路 */
        const next = !onlineRef.current
        setOnline(next)
        if (next) {
          toast('已连上 Phrontis-PC', 'ok')
          if (pendingRef.current.length) setTimeout(() => void runSyncRef.current(), 900)
        } else {
          toast('已切到离线 · 数据照常记在手机', 'warn')
        }
        return
      }
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

  /* 已配对：启动即探测电脑，在线且有积压就自动对账 */
  useEffect(() => {
    if (!getPaired()) return
    void probeOnline().then(ok => {
      setOnline(ok)
      if (ok && getQueue().length) setTimeout(() => void runSyncRef.current(), 800)
    })
  }, [])
  runSyncRef.current = runSync

  /* ---------- 日程 ---------- */

  const toggleTodo = useCallback((id: string) => {
    setTodos(list => list.map(t => {
      if (t.id !== id) return t
      return { ...t, done: !t.done }
    }))
    const t = todos.find(x => x.id === id)
    if (t) markPending((t.done ? '撤销' : '完成') + '：' + t.title)
  }, [todos, markPending])

  const addTodo = useCallback((input: { title: string; type: Todo['type']; time: string }) => {
    setTodos(list => [...list, { id: nextId('t'), date: selDate, title: input.title, type: input.type, time: input.time, tag: '手机', done: false }])
    markPending('待办「' + input.title + '」' + (selDate === TODAY ? '' : '（11月1日）'))
    toast('已加待办 · 待同步', 'ok')
  }, [selDate, markPending, toast])

  const toggleHabit = useCallback((id: string) => {
    const h = habits.find(x => x.id === id)
    if (!h) return
    const wasDone = !!h.hist[5]
    const hist = [...h.hist]; hist[5] = wasDone ? 0 : 1
    setHabits(list => list.map(x => x.id === id ? { ...x, hist, weekDone: x.weekDone + (wasDone ? -1 : 1), streak: x.streak + (wasDone ? -1 : 1) } : x))
    if (!wasDone) { markPending('打卡：' + h.name); toast('打卡成功 · 待同步', 'ok') }
  }, [habits, markPending, toast])

  /* ---------- 记账 ---------- */

  const saveTx = useCallback((input: { type: 'expense' | 'income'; amount: number; cat: string; acc: string }) => {
    const isExp = input.type === 'expense'
    /* 条目 UUID 在生成时定死并终身不变：本地展示与上行同步共用同一 id */
    const id = uuid()
    const nowD = new Date()
    const pad2 = (n: number) => String(n).padStart(2, '0')
    const dateIso = nowD.getFullYear() + '-' + pad2(nowD.getMonth() + 1) + '-' + pad2(nowD.getDate())
    const time = pad2(nowD.getHours()) + ':' + pad2(nowD.getMinutes())
    const data: LedgerSyncData = {
      date: dateIso, time, type: input.type, amount: input.amount,
      category: input.cat, payment: input.acc, merchant: input.cat, note: '',
    }
    const label = (isExp ? '支出' : '收入') + ' ¥' + fmtMoney(input.amount) + ' · ' + input.cat
    enqueueOp({ id, domain: 'ledger', updatedAt: nowD.toISOString(), data, label })
    const disp = txDisplay(dateIso, time)
    setTxs(list => [{ id, date: disp.date, sub: disp.sub, name: input.cat, cat: input.cat, amt: isExp ? -input.amount : input.amount, acc: input.acc }, ...list])
    markPending(label, id)
    toast('已记一笔 · 待同步进电脑', 'ok')
  }, [markPending, toast])

  /* ---------- 笔记 ---------- */

  const toggleFolder = useCallback((index: number) => {
    setFolders(list => list.map((f, i) => i === index ? { ...f, open: !f.open } : f))
  }, [])

  const markCached = useCallback((title: string) => {
    setFolders(list => list.map(f => ({ ...f, files: f.files.map(x => x.title === title ? { ...x, cached: true } : x) })))
  }, [])

  const addPhoneNote = useCallback((title: string, body: string) => {
    setPhoneNotes(list => [{ id: nextId('p'), title, body, synced: false }, ...list])
  }, [])

  /* ---------- AI ---------- */

  const newSession = useCallback(() => {
    const s: Session = { id: nextId('s'), title: '新会话', ts: Date.now(), pinned: false, messages: [{ id: nextId('m'), role: 'ai', text: WELCOME }] }
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
        const s: Session = { id: nextId('s'), title: '新会话', ts: Date.now(), pinned: false, messages: [{ id: nextId('m'), role: 'ai', text: WELCOME }] }
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
      return { reply: '好的，帮你整理成一笔支出，确认后保存到手机账本，下次同步进电脑：', card: { kind: 'tx' } }
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
    const r = route(trimmed)
    setStreaming(true)
    let i = 0
    streamTimer.current = setInterval(() => {
      i = Math.min(r.reply.length, i + 2 + Math.floor(Math.random() * 3))
      setStreamText(r.reply.slice(0, i))
      if (i >= r.reply.length) {
        if (streamTimer.current) clearInterval(streamTimer.current)
        setStreaming(false)
        setStreamText('')
        pushAiMsg({ role: 'ai', text: r.reply, card: r.card, list: r.list })
        if (r.noteCapture) {
          setTimeout(() => {
            addPhoneNote('手机原型讨论', r.noteCapture!)
            markPending('笔记「手机原型讨论」')
          }, 600)
        }
      }
    }, 24)
  }, [route, pushAiMsg, addPhoneNote, markPending])

  const updateMsg = useCallback((msgId: string, fn: (m: Msg) => Msg) => {
    const sid = curSessionRef.current
    setSessions(list => list.map(s => s.id === sid
      ? { ...s, messages: s.messages.map(m => m.id === msgId ? fn(m) : m) }
      : s))
  }, [])

  const confirmCard = useCallback((msgId: string, kind: 'tx' | 'move') => {
    if (kind === 'tx') {
      setTxs(list => [{ id: nextId('x'), date: '今天', sub: '10月31日 · 刚刚', name: '午饭 · AI 代记', cat: '餐饮', amt: -30, acc: '微信' }, ...list])
      markPending('AI 代记 · 支出 ¥30.00')
      toast('已入账 · 待同步', 'ok')
    } else {
      setTodos(list => list.filter(t => t.id !== 't3'))
      markPending('改期：跑步 30 分钟 → 明天 19:30')
      toast('已改期 · 待同步', 'ok')
    }
    updateMsg(msgId, m => ({ ...m, card: m.card ? { ...m.card, confirmed: true } : m.card }))
  }, [markPending, toast, updateMsg])

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
    theme, setTheme, toast, toasts, sheet, openSheet, closeSheet, activeTab, setActiveTab,
    online, syncing, syncPct, pending, lastSync, paired, toggleOnline, runSync, markPending, pairWith, unpair,
    schedView, setSchedView, selDate, setSelDate, todos, toggleTodo, addTodo, habits, toggleHabit,
    txs, saveTx,
    folders, toggleFolder, markCached, phoneNotes, addPhoneNote,
    aiMode, setAiMode, sessions, curSession, newSession, switchSession, deleteSession, renameSession, togglePin,
    streaming, streamText, sendChat, confirmCard, dismissCard,
    voicePhase, voiceElapsed, toggleVoice,
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
