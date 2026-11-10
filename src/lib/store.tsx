import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { ReactNode } from 'react'
import type { AppPrefs, AiChatMsg, AiConfig, Card, CardKind, Folder, Habit, HabitRecordSyncData, HabitSyncData, LedgerEntry, LedgerSyncData, Msg, NoteCache, NoteProposal, NoteTreePage, PairedDevice, PhoneNote, QuizAddProposal, QuizDelProposal, QuizNoteProposal, QuizRecord, QuizSpec, Session, SheetId, SchedView, ThemeName, Todo, TodoProposal, Tx, TxProposal, VoicePhase } from './types'
import { THEME_IDS } from './types'
import { TODAY, VOICE_PHRASES, welcomeText, dayIso, fmtMoney, isoOf, monthOf, monthStats, txToDisplay, weekOf } from './data'
import {
  AiStopped, AuthError, buildHabitData, buildHabitRecordData, buildNoteData, buildScheduleData, commitPullCursor, enqueueOp, getDeviceName, getLastSync, getPaired, getQueue, habitLww, habitRecordId, loadJson, nextProbeDelayMs,
  noteLww, pairWith as pairRequest, parseHabitRecordId, pingDevice, pingPaired, pullOnce, removeFromQueue, resetSyncCursor, saveJson, savePaired, syncNow, unpair as unpairDevice, uuid,
  RtDriver, type RemoteHabitItem, type RemoteLedgerItem, type RemoteNoteItem, type RemoteScheduleItem, type RemoteTombstone, type RtMode,
} from './sync'
import { AI_MAX_ROUNDS, aiConfigReady, chatOnce, loadAiConfig, parseToolArgs, saveAiConfig } from './ai'
import { AI_TOOLS, buildSystemPrompt, quizQueryForModel, quizStatsForModel, validateLedgerAdd, validateNoteCreate, validateQuizAdd, validateQuizDel, validateQuizNote, validateTodoAdd, type ToolResult } from './aiTools'
import { fetchNoteContent, fetchNoteTree, loadNoteCache, loadNoteTree, saveNoteCache, saveNoteTree } from './sync'
import { initNotifPermission, rescheduleReminders, requestNotifPermission, type NotifPerm } from './notify'
import { setUpdateFoundNotifier, updateStartupCheck } from './update'

export interface ToastItem { id: number; msg: string; type: 'ok' | 'warn' | 'info' }

/** 连接四态（WP4 连接监督器）：online 在线 / offline 离线（自动重连中）/ auth 令牌失效（需重新配对）/ paused 手动暂停 */
export type ConnState = 'online' | 'offline' | 'auth' | 'paused'

/** 设置页分区（平板侧栏分类导航用；手机单页滚动全展示——usage 分区仅平板渲染，手机走工具二级页） */
export type SettingsSec = 'sync' | 'tools' | 'ai' | 'usage' | 'appearance' | 'about'
/** 分类清单单一真相源：TabletChrome 侧栏与 SettingsPage 的 data-sec 都从这里对齐（加分类两处同步加） */
export const SETTINGS_SECS: Array<{ id: SettingsSec; label: string }> = [
  { id: 'sync', label: '同步' },
  { id: 'ai', label: 'AI 模型' },
  { id: 'usage', label: 'AI 用量' },
  { id: 'tools', label: '工具' },
  { id: 'appearance', label: '外观' },
  { id: 'about', label: '关于' },
]

/** 仓库阅读选区（侧栏树点开的笔记）；kind='phone' 时带 phoneId——阅读器右上角的笔据此切「编辑当前」 */
export type VaultReader = { title: string; path: string; kind: 'vault' | 'phone'; phoneId?: string }
/** 选择同步范围：文件夹路径 + 单篇 id（localStorage 持久化） */
export type SyncSel = { dirs: string[]; ids: string[] }

let seq = 100
const nextId = (p: string) => p + (++seq)

/** 打卡习惯卡片色板：按创建序轮转，新习惯不重色 */
const HABIT_COLORS = ['#4d6bfe', '#178343', '#c0392b', '#7c5cd6', '#b07a18', '#0f766e']

/** 本地持久化键（pm. 前缀，SQLite 评估时整体搬运） */
const K_TODOS = 'pm.todos'
/** v0.3 起账本存同步形态（pm.txs 是旧版展示形态键，弃用不迁移——当时只有演示数据） */
const K_LEDGER = 'pm.ledger'
/** 打卡习惯（本地数据，暂不参与同步） */
const K_HABITS = 'pm.habits'
const K_NOTES = 'pm.notes'
const K_QUIZ = 'pm.quiz'
const K_SYNC_SEL = 'pm.noteSyncSel'
const K_THEME = 'pm.theme'
/** 用户偏好单键（pm.settings）：新增偏好字段只要进 DEFAULT_PREFS，旧数据浅合并自动兜底，免迁移 */
const K_PREFS = 'pm.settings'
const DEFAULT_PREFS: AppPrefs = { themeAuto: false, remindLead: 0, offlineUse: false }

function loadPrefs(): AppPrefs {
  return { ...DEFAULT_PREFS, ...loadJson<Partial<AppPrefs>>(K_PREFS, {}) }
}

/** 全新会话：仅一条欢迎语（时段问候），不注入任何演示历史 */
const freshSession = (): Session => ({
  id: nextId('s'), title: '新会话', ts: Date.now(), pinned: false,
  messages: [{ id: nextId('m'), role: 'ai', text: welcomeText() }],
})

/** 在途删除操作的条目 id：远端回流时跳过这些 id（本地已删，等队列 push 落墓碑） */
function queuedDeleteIds(): Set<string> {
  return new Set(getQueue().filter(op => (op.data as { deleted?: boolean }).deleted === true).map(op => op.id))
}

/** v1.8：由 records（date → 最后变更 ISO）派生当前周 hist / weekDone / streak。
 *  hist 只是 UI 缓存，真实记录以 records 为准；streak 可跨周。 */
function deriveHabit(h: Habit): Habit {
  const records = h.records || {}
  const week = weekOf(0)
  const hist = week.map(d => records[d.iso] ? 1 : 0)
  const todayIdx = (new Date().getDay() + 6) % 7
  const weekDone = hist.slice(0, todayIdx + 1).reduce((s: number, v) => s + v, 0)
  let streak = 0
  const d = new Date()
  if (!records[isoOf(d)]) d.setDate(d.getDate() - 1)
  while (records[isoOf(d)]) { streak++; d.setDate(d.getDate() - 1) }
  return { ...h, hist, weekDone, streak }
}

/** v1.8 旧数据迁移：只有 hist 没有 records 的习惯，把当前周的 hist 回填成 records。
 *  返回 migrated = 有需要上行的旧打卡（调用方入队，桌面才会收到）。 */
function migrateHabit(h: Habit): { habit: Habit; migrated: boolean } {
  if (h.records) return { habit: deriveHabit(h), migrated: false }
  const records: Record<string, string> = {}
  const at = h.updatedAt || '1970-01-01T00:00:00.000Z'
  weekOf(0).forEach((d, i) => { if (h.hist?.[i]) records[d.iso] = at })
  return { habit: deriveHabit({ ...h, updatedAt: at, records }), migrated: Object.keys(records).length > 0 }
}

interface Store {
  /* 全局 */
  theme: ThemeName
  setTheme: (t: ThemeName) => void
  /** 用户偏好（pm.settings 单键，见 DEFAULT_PREFS） */
  prefs: AppPrefs
  setPref: <K extends keyof AppPrefs>(k: K, v: AppPrefs[K]) => void
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
  /** 连接四态（conn==='online' 时 online 恒 true）：auth 需重新配对，offline 自动重连中，paused 离线使用（不同步电脑） */
  conn: ConnState
  /** 立即重探一次（「重新连接」按钮） */
  reconnectNow: () => void
  /** 地址修复：用现有令牌 ping 通才改 baseUrl（电脑换 IP/网段后一键恢复） */
  repairAddress: (baseUrl: string) => Promise<boolean>
  syncing: boolean
  syncPct: number
  /** v1.7 实时同步三态：hang=实时（挂起中）/ poll=轮询 30s（旧桌面）/ off=离线待同步 */
  syncMode: RtMode
  pending: Array<{ label: string; opId?: string }>
  lastSync: string
  paired: PairedDevice | null
  runSync: () => void
  /** 全量重新对账：清空三域游标后从电脑重拉（本地数据为空/换仓/重配对后的修复入口） */
  fullResync: () => void
  markPending: (label: string, opId?: string) => void
  pairWith: (input: string, code: string) => Promise<void>
  adoptPaired: (device: PairedDevice) => Promise<void>
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
  /** 打卡习惯：增改删（本地数据不入同步）；openHabitForm 无 id = 新增，带 id = 编辑 */
  addHabit: (input: { name: string; target: number; remind?: number }) => void
  updateHabit: (id: string, patch: { name?: string; target?: number; remind?: number | null }) => void
  deleteHabit: (id: string) => void
  editHabitId: string | null
  openHabitForm: (id?: string, from?: HTMLElement | null) => void

  /* 笔记 */
  folders: Folder[]
  toggleFolder: (index: number) => void
  markCached: (title: string) => void
  phoneNotes: PhoneNote[]
  addPhoneNote: (title: string, body: string) => void
  /** 备忘录式即建即编：本地建空笔记返回 id（不入同步队列，退出编辑时统一入队/丢弃） */
  createPhoneNote: () => string
  /** 编辑中实时更新本地内容（列表首行标题跟手；内容随时落 localStorage 防丢） */
  updatePhoneNote: (id: string, title: string, body: string) => void
  /** 空笔记丢弃：本地移除，不入队列不产生垃圾 */
  /** v1.6：删除手机笔记 = 墓碑上行（桌面同删设备文件夹里的文件）；原 discardPhoneNote 已被它取代 */
  deletePhoneNote: (id: string) => void
  /** 编辑完成：内容入上行队列（op id = 笔记 uuid，与 v1.2 notes 域契约一致） */
  syncPhoneNote: (id: string, title: string, body: string) => void

  /* 仓库笔记树域（design.md §10.1：平板侧栏托管树与选择同步，手机端同源复用） */
  vaultKw: string
  setVaultKw: (v: string) => void
  vaultTree: { fetchedAt: number; pages: NoteTreePage[] }
  vaultLoading: boolean
  vaultExpanded: Record<string, boolean>
  toggleVaultExpand: (path: string) => void
  vaultCache: NoteCache
  vaultReader: VaultReader | null
  setVaultReader: (r: VaultReader | null) => void
  vaultBody: string
  setVaultBody: (body: string) => void
  /** cached=与目录一致；stale=离线回落旧版缓存（联网对账后自动刷新）；loading/error 同名 */
  vaultState: 'cached' | 'loading' | 'error' | 'stale'
  syncSel: SyncSel
  toggleSyncDir: (path: string) => void
  toggleSyncNote: (id: string) => void
  noteInSync: (page: NoteTreePage) => boolean
  fetchVaultTree: () => void
  openVaultNote: (page: NoteTreePage) => void
  openPhoneNote: (id: string) => void

  /* 刷题（桌面 quiz 模块移动子集；真相源暂为本地，协议 v1.3 接桌面 quiz 域） */
  quizRecords: QuizRecord[]
  answerQuiz: (id: string, correct: boolean) => void
  /** 阅读器题卡作答：按 文档+题号 upsert 错题记录（首答建档，重答累计 streak/错次） */
  upsertQuizAnswer: (pageId: string, pageTitle: string, spec: QuizSpec, correct: boolean) => void
  /* AI 错题工具落库（确认卡后调用） */
  addQuizRecord: (p: QuizAddProposal) => void
  setQuizNote: (p: QuizNoteProposal) => void
  deleteQuizRecord: (p: QuizDelProposal) => void

  /* AI */
  /** 模型配置（pm.aiConfig，Key 只在本机） */
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
  /** 流式阶段：wait=网络往返中（UI 渲染流光提示） reveal=逐字呈现中（正文+光标） */
  streamPhase: 'wait' | 'reveal' | null
  sendChat: (text: string) => void
  /** 用户停止当前生成：在途请求中断；打字机阶段立即落完整消息 */
  stopStream: () => void
  confirmCard: (msgId: string, kind: CardKind) => void
  dismissCard: (msgId: string) => void

  /* 语音 */
  voicePhase: VoicePhase
  voiceElapsed: number
  toggleVoice: () => void

  /* 本地通知（日程提醒；浏览器 dev 恒为 unsupported） */
  notifPerm: NotifPerm
  requestNotifPerm: () => Promise<NotifPerm>

  /* 平板设置域：settingsSec=当前分类（分类隔离渲染，见 SettingsPage.showSec） */
  settingsSec: SettingsSec
  setSettingsSec: (s: SettingsSec) => void
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
  const [prefs, setPrefsState] = useState<AppPrefs>(loadPrefs)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [sheet, setSheet] = useState<SheetId>(null)
  const [sheetOrigin, setSheetOrigin] = useState<HTMLElement | null>(null)
  /* 启动页：默认笔记区（2026-11-08 拍板：不做设置项，直接定死） */
  const [activeTab, setActiveTabState] = useState('notes')
  const activeTabRef = useRef(activeTab); activeTabRef.current = activeTab
  const [kbSim, setKbSim] = useState(false)
  const [kbOpen, setKbOpen] = useState(false)

  /* 连接四态（WP4 监督器的被控状态）；online 为派生兼容值（chrome 状态条等旧 UI 继续用）。
     冷启动直接按离线使用偏好落 paused，避免先渲染一帧「已连接」 */
  const [conn, setConn] = useState<ConnState>(() => (prefs.offlineUse ? 'paused' : 'online'))
  const online = conn === 'online'
  const [syncing, setSyncing] = useState(false)
  const [syncPct, setSyncPct] = useState(0)
  const [syncMode, setSyncMode] = useState<RtMode>('off')
  const [pending, setPending] = useState<Array<{ label: string; opId?: string }>>([])
  const [lastSync, setLastSync] = useState('今天 09:12')
  const [paired, setPaired] = useState<PairedDevice | null>(() => getPaired())

  const [schedView, setSchedView] = useState<SchedView>('list')
  const [selDate, setSelDate] = useState(TODAY)
  /* 日程/待办落本地存储（M2a）：重启不丢；干净启动，数据由用户与同步产生 */
  const [todos, setTodos] = useState<Todo[]>(() => loadJson<Todo[]>(K_TODOS, []))
  const [habits, setHabits] = useState<Habit[]>(() => {
    const loaded = loadJson<Habit[]>(K_HABITS, [])
    const nowIso = new Date().toISOString()
    const out: Habit[] = []
    for (const h of loaded) {
      const m = migrateHabit(h)
      const legacy = !h.updatedAt || h.updatedAt.startsWith('1970-')
      if (legacy) {
        m.habit.updatedAt = nowIso
        enqueueOp({ id: m.habit.id, domain: 'habit', updatedAt: nowIso, data: buildHabitData(m.habit), label: '习惯「' + m.habit.name + '」' })
      }
      out.push(m.habit)
      if (m.migrated) {
        for (const date of Object.keys(m.habit.records || {})) {
          enqueueOp({
            id: habitRecordId(m.habit.id, date),
            domain: 'habit',
            updatedAt: m.habit.records![date],
            data: buildHabitRecordData(m.habit.id, date),
            label: '打卡：' + m.habit.name,
          })
        }
      }
    }
    return out
  })

  /* 账本本地真相 = 同步形态（M2b）；展示形态派生 */
  const [entries, setEntries] = useState<LedgerEntry[]>(() => loadJson<LedgerEntry[]>(K_LEDGER, []))
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
  useEffect(() => { saveJson(K_HABITS, habits) }, [habits])
  useEffect(() => { saveJson(K_LEDGER, entries) }, [entries])

  const [folders, setFolders] = useState<Folder[]>([])
  /* v1.6 起 PhoneNote 带 updatedAt（LWW 依据）：旧落盘数据缺字段，读时回填纪元值（首次编辑即变新） */
  const [phoneNotes, setPhoneNotes] = useState<PhoneNote[]>(() =>
    loadJson<Partial<PhoneNote>[]>(K_NOTES, []).map(n => ({
      id: String(n.id ?? ''), title: String(n.title ?? ''), body: String(n.body ?? ''),
      synced: !!n.synced, updatedAt: String(n.updatedAt ?? '1970-01-01T00:00:00.000Z'),
    })).filter(n => n.id))
  useEffect(() => { saveJson(K_NOTES, phoneNotes) }, [phoneNotes])

  /* ---------- 仓库笔记树域（§10.1） ---------- */
  const [vaultKw, setVaultKw] = useState('')
  const [vaultTree, setVaultTree] = useState(() => loadNoteTree())
  const [vaultLoading, setVaultLoading] = useState(false)
  const [vaultExpanded, setVaultExpanded] = useState<Record<string, boolean>>({})
  const [vaultCache, setVaultCache] = useState<NoteCache>(() => loadNoteCache())
  const [vaultReader, setVaultReader] = useState<VaultReader | null>(null)
  const [vaultBody, setVaultBody] = useState('')
  const [vaultState, setVaultState] = useState<'cached' | 'loading' | 'error' | 'stale'>('cached')
  const [syncSel, setSyncSel] = useState<SyncSel>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(K_SYNC_SEL) || '')
      if (v && Array.isArray(v.dirs) && Array.isArray(v.ids)) return v
    } catch { /* 首次/损坏 → 默认 */ }
    return { dirs: [], ids: [] }
  })
  useEffect(() => { localStorage.setItem(K_SYNC_SEL, JSON.stringify(syncSel)) }, [syncSel])

  const [aiConfig, setAiConfigState] = useState<AiConfig>(() => loadAiConfig())
  /* 会话不再注入演示历史：初始只有一个带欢迎语的新会话；删空后 deleteSession 会再建 */
  const [sessions, setSessions] = useState<Session[]>(() => [freshSession()])
  const [curSession, setCurSession] = useState(() => sessions[0].id)
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [streamPhase, setStreamPhase] = useState<'wait' | 'reveal' | null>(null)

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
  const connRef = useRef(conn); connRef.current = conn
  const onlineRef = useRef(online); onlineRef.current = online
  const offlineUseRef = useRef(prefs.offlineUse); offlineUseRef.current = prefs.offlineUse
  const syncingRef = useRef(syncing); syncingRef.current = syncing
  const pendingRef = useRef(pending); pendingRef.current = pending
  const sessionsRef = useRef(sessions); sessionsRef.current = sessions
  const curSessionRef = useRef(curSession); curSessionRef.current = curSession
  const streamingRef = useRef(streaming); streamingRef.current = streaming
  const entriesRef = useRef(entries); entriesRef.current = entries
  const todosRef = useRef(todos); todosRef.current = todos
  const habitsRef = useRef(habits); habitsRef.current = habits
  const phoneNotesRef = useRef(phoneNotes); phoneNotesRef.current = phoneNotes
  const aiConfigRef = useRef(aiConfig); aiConfigRef.current = aiConfig
  const pairedRef = useRef(paired); pairedRef.current = paired
  const prefsRef = useRef(prefs); prefsRef.current = prefs
  const vaultTreeRef = useRef(vaultTree); vaultTreeRef.current = vaultTree
  const syncSelRef = useRef(syncSel); syncSelRef.current = syncSel
  const vaultCacheRef = useRef(vaultCache); vaultCacheRef.current = vaultCache
  const vaultReaderRef = useRef(vaultReader); vaultReaderRef.current = vaultReader
  const vaultStateRef = useRef(vaultState); vaultStateRef.current = vaultState
  const runSyncRef = useRef<() => void>(() => {})
  const reconcileQuietRef = useRef<() => void>(() => {})
  const reconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* 跟随系统深浅色（pm.settings.themeAuto）：开=按系统深浅映射 dark/light（七主题里只有这两套有系统语义）；
     关=回落手动主题。effTheme 只驱动 data-theme；手动选择仍存 pm.theme——自动模式不覆盖用户的手动选择 */
  const [sysDark, setSysDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const fn = (e: MediaQueryListEvent) => setSysDark(e.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])
  const effTheme: ThemeName = prefs.themeAuto ? (sysDark ? 'dark' : 'light') : theme
  useEffect(() => { document.documentElement.dataset.theme = effTheme }, [effTheme])

  const setPref = useCallback(<K extends keyof AppPrefs>(k: K, v: AppPrefs[K]) => {
    setPrefsState(p => ({ ...p, [k]: v }))
  }, [])
  useEffect(() => { saveJson(K_PREFS, prefs) }, [prefs])

  const toast = useCallback((msg: string, type: ToastItem['type'] = 'info') => {
    const id = Date.now() + Math.random()
    setToasts(t => [...t, { id, msg, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2400)
  }, [])

  const setTheme = useCallback((t: ThemeName) => { setThemeState(t); saveJson(K_THEME, t) }, [])
  const openSheet = useCallback((id: Exclude<SheetId, null>, from?: HTMLElement | null) => {
    setSheetOrigin(from ?? null)
    setSheet(id)
  }, [])
  const closeSheet = useCallback(() => { setSheet(null); setSheetOrigin(null) }, [])
  const toggleKbSim = useCallback(() => setKbSim(s => !s), [])

  /* Tab 切换 = 从按点圆形铺开：旧帧定格为底、新页经 clip-path 圆铺满（260ms）。
     View Transitions 需要 WebView 111+；不支持或系统减动效 → 瞬时切换 */
  const setActiveTab = useCallback((t: string, from?: HTMLElement | null) => {
    /* 换区导航 = 收回任何挡在内容区上的全屏子页。平板 A+F 停靠后子页只盖内容区、
       侧栏可点，但不关子页的话切页发生在子页底下，看起来像「无法跳转」；
       手机子页盖整窗、导航本来就点不到，这个状态泄漏此前暴露不出来。
       同区再点也收回（侧栏点当前区 = 回区根）。已空时 setState 原地 bailout，无开销 */
    setSheet(null)
    setSheetOrigin(null)
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

  /* 「习惯」子页：无 id = 新增，带 id = 编辑（HabitForm 挂载时读 editHabitId），从触发点圆形展开 */
  const [editHabitId, setEditHabitId] = useState<string | null>(null)
  const openHabitForm = useCallback((id?: string, from?: HTMLElement | null) => {
    setEditHabitId(id ?? null)
    setSheetOrigin(from ?? null)
    setSheet('habit')
  }, [])

  /* ---- 系统键盘适配（2026-11-06 重做，修「输入框被键盘遮住」）----
   * 旧实现假设 adjustResize 会把窗口压到键盘上方，于是把抽屉 bottom 设成负值「下沉」，
   * 让输入框贴住键盘上沿。但 targetSdk 35 = Android 15 起强制 edge-to-edge：
   * 窗口不再随键盘收缩，键盘浮在内容之上，100dvh 不变 → 下沉反而把抽屉推进键盘底下，
   * 所有带输入框的抽屉都变成「看不见 / 输入框被遮」。
   *
   * 新模型：用 visualViewport 量出键盘实际占掉的高度，写进 --kb-real，壳层高度扣掉它
   * （见 index.css 的 .app）。等价于在 CSS 层重建 adjustResize，抽屉 / 浮坞 / FAB / toast
   * 这些绝对定位的贴底元素随壳整体上移。
   * adjustResize 真生效时（iOS、老 Android）clientHeight 已缩到键盘上方，差值算出来是 0，不重复扣。
   */
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    let raf = 0
    const apply = () => {
      raf = 0
      /* 基准取 documentElement.clientHeight（与 100dvh 同源），不用 innerHeight：
       * 部分 WebView 上 innerHeight 已扣键盘，会让差值恒为 0、适配静默失效。 */
      const layoutH = document.documentElement.clientHeight || window.innerHeight
      const kb = Math.max(0, Math.round(layoutH - vv.height - vv.offsetTop))
      document.documentElement.style.setProperty('--kb-real', kb + 'px')
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(apply) }
    vv.addEventListener('resize', schedule)
    vv.addEventListener('scroll', schedule) /* 键盘推挤页面时 offsetTop 变，需重算 */
    apply()
    return () => {
      if (raf) cancelAnimationFrame(raf)
      vv.removeEventListener('resize', schedule)
      vv.removeEventListener('scroll', schedule)
      document.documentElement.style.removeProperty('--kb-real')
    }
  }, [])

  /* 文本输入聚焦 ≈ 键盘弹出（自定义数字键盘是 button，不触发，符合预期）。
   * kb-open 只负责隐藏浮坞（原生键盘模型）；不再移动抽屉本身 ——
   * 抽屉已随壳上移，这里只补「抽屉自身溢出时输入框没滚进可见区」这一种情况。 */
  useEffect(() => {
    const isText = (t: EventTarget | null) => t instanceof HTMLElement && t.matches('input, textarea')
    let timer = 0
    const reveal = (el: HTMLElement) => {
      const vv = window.visualViewport
      /* 原生注入的键盘高度也要扣：WebView 的 visualViewport 不随输入法收缩（见 MainActivity），
       * 只看它会把「其实已被键盘盖住」误判成「可见」而完全不滚动。 */
      const nativeKb = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--kb-native'),
      ) || 0
      const visibleBottom = (vv ? vv.offsetTop + vv.height : window.innerHeight) - nativeKb
      const r = el.getBoundingClientRect()
      if (r.bottom > visibleBottom - 16) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
    const onIn = (e: FocusEvent) => {
      if (!isText(e.target)) return
      setKbOpen(true)
      const el = e.target as HTMLElement
      /* 键盘动画约 250ms：rAF 那次覆盖「本来就可见」，超时那次等键盘让出空间后补滚 */
      requestAnimationFrame(() => reveal(el))
      clearTimeout(timer)
      timer = window.setTimeout(() => reveal(el), 320)
    }
    const onOut = (e: FocusEvent) => {
      if (!isText(e.target)) return
      setKbOpen(false)
    }
    document.addEventListener('focusin', onIn)
    document.addEventListener('focusout', onOut)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('focusin', onIn)
      document.removeEventListener('focusout', onOut)
    }
  }, [])

  const markPending = useCallback((label: string, opId?: string) => {
    setPending(p => [...p, opId ? { label, opId } : { label }])
    if (!getPaired() || document.hidden) return
    /* v1.7：本地写操作 → 防抖立即对账（reconcileQuiet 先顶掉在途挂起，push+pull 后重建循环）；
       离线时改为戳连接监督器（3s 防抖——每个字符都 ping 一次是灾难） */
    if (onlineRef.current) {
      if (reconcileTimerRef.current) clearTimeout(reconcileTimerRef.current)
      reconcileTimerRef.current = setTimeout(() => {
        reconcileTimerRef.current = null
        reconcileQuietRef.current()
      }, 800)
    } else {
      supervisorPokeRef.current?.(3000)
    }
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

  /* v1.8：桌面下行的习惯定义 + 打卡记录 → LWW 合并进本地。
     定义先于记录处理（记录需要 habit 存在）；本地新 → 重新入队自愈；在途取消打卡的 id 跳过。 */
  const applyRemoteHabits = useCallback((remote: RemoteHabitItem[]) => {
    if (!remote.length) return
    const delIds = queuedDeleteIds()
    const nowIso = new Date().toISOString()
    const byId = new Map(habitsRef.current.map(h => [h.id, { ...h }]))
    for (const id of delIds) byId.delete(id)
    const takeIds: string[] = []

    for (const r of remote) {
      if (!r || typeof r.id !== 'string' || !r.data || r.data.kind !== 'habit') continue
      if (delIds.has(r.id)) continue
      const d = r.data as HabitSyncData
      const prev = byId.get(r.id)
      if (!prev) {
        const next: Habit = {
          id: r.id, name: d.name, char: [...d.name][0] ?? '习', color: d.color,
          weekDone: 0, target: d.target, streak: 0, hist: [0, 0, 0, 0, 0, 0, 0],
          remind: d.remind ?? undefined, archived: d.archived, updatedAt: r.updatedAt, records: {},
        }
        byId.set(r.id, deriveHabit(next))
        takeIds.push(r.id)
        continue
      }
      if (habitLww(prev.updatedAt, r.updatedAt) === 'local') {
        enqueueOp({ id: prev.id, domain: 'habit', updatedAt: prev.updatedAt || nowIso, data: buildHabitData(prev), label: '习惯「' + prev.name + '」' })
        markPending('习惯「' + prev.name + '」', prev.id)
        continue
      }
      const next: Habit = {
        ...prev,
        name: d.name, char: [...d.name][0] ?? prev.char, color: d.color,
        target: d.target, remind: d.remind ?? undefined, archived: d.archived,
        updatedAt: r.updatedAt,
      }
      byId.set(r.id, deriveHabit(next))
      takeIds.push(r.id)
    }

    for (const r of remote) {
      if (!r || typeof r.id !== 'string' || !r.data || r.data.kind !== 'record') continue
      const d = r.data as HabitRecordSyncData
      if (delIds.has(r.id)) continue
      const h = byId.get(d.habitId)
      if (!h) continue
      const localAt = h.records?.[d.date]
      if (habitLww(localAt, r.updatedAt) === 'local') {
        enqueueOp({ id: r.id, domain: 'habit', updatedAt: localAt || nowIso, data: buildHabitRecordData(d.habitId, d.date), label: '打卡：' + h.name })
        markPending('打卡：' + h.name, r.id)
        continue
      }
      const records = { ...(h.records || {}), [d.date]: r.updatedAt }
      byId.set(d.habitId, deriveHabit({ ...h, records }))
      takeIds.push(r.id)
    }

    if (takeIds.length) removeFromQueue(takeIds)
    setHabits([...byId.values()])
  }, [markPending])

  /* v1.6 U 盘模式：桌面在设备文件夹里的笔记增改 → LWW 合并进手机笔记列表。
     远端新 = 覆盖本地（synced 置真——桌面文件就是已同步态）；本地新 = 保留并把本地版重新入队上行（自愈）。
     在途删除的 id 跳过（用户刚删的笔记不被桌面旧版本复活）；远端赢的丢弃该 id 在途旧版 op。 */
  const applyRemoteNotes = useCallback((remote: RemoteNoteItem[]) => {
    if (!remote.length) return
    const delIds = queuedDeleteIds()
    const nowIso = new Date().toISOString()
    const take: Array<{ id: string; title: string; body: string; updatedAt: string }> = []
    for (const r of remote) {
      if (!r || typeof r.id !== 'string' || delIds.has(r.id)) continue
      const prev = phoneNotesRef.current.find(n => n.id === r.id)
      const remoteUpdatedAt = String(r.updatedAt || '')
      if (noteLww(prev?.updatedAt, remoteUpdatedAt) === 'local') {
        if (prev) {
          enqueueOp({ id: r.id, domain: 'notes', updatedAt: nowIso, data: buildNoteData(prev.title, prev.body), label: '笔记「' + prev.title.slice(0, 20) + '」' })
          markPending('笔记「' + prev.title.slice(0, 20) + '」', r.id)
        }
        continue
      }
      take.push({ id: r.id, ...buildNoteData(String(r.data?.title ?? ''), String(r.data?.body ?? '')), updatedAt: remoteUpdatedAt })
    }
    if (!take.length) return
    setPhoneNotes(list => {
      const next = list.filter(n => !take.some(u => u.id === n.id))
      next.unshift(...take.map(u => ({ id: u.id, title: u.title, body: u.body, synced: true, updatedAt: u.updatedAt })))
      return next
    })
    removeFromQueue(take.map(u => u.id))
  }, [markPending])

  /* 墓碑下行：非 habit 域按 id 从三域删除；habit 域按 domain 分派（定义/记录），
     本地更新的记录/定义 → 自愈重推，不删。 */
  const applyTombstones = useCallback((tombstones: RemoteTombstone[]) => {
    if (!tombstones.length) return
    const gone = new Set(tombstones.filter(t => t.domain !== 'habit').map(t => String(t.id)))
    if (gone.size) {
      setTodos(list => list.filter(t => !gone.has(t.id)))
      setEntries(list => list.filter(e => !gone.has(e.id)))
      setPhoneNotes(list => list.filter(n => !gone.has(n.id)))
    }

    const habitTombstones = tombstones.filter(t => t.domain === 'habit')
    const tombstoneWins: string[] = []
    if (habitTombstones.length) {
      const byId = new Map(habitsRef.current.map(h => [h.id, { ...h }]))
      for (const t of habitTombstones) {
        const rec = parseHabitRecordId(t.id)
        if (rec) {
          const h = byId.get(rec.habitId)
          if (!h) { tombstoneWins.push(t.id); continue }
          const localAt = h.records?.[rec.date]
          if (localAt && habitLww(localAt, t.deletedAt) === 'local') {
            enqueueOp({ id: t.id, domain: 'habit', updatedAt: localAt, data: buildHabitRecordData(rec.habitId, rec.date), label: '打卡：' + h.name })
            markPending('打卡：' + h.name, t.id)
            continue
          }
          const records = { ...(h.records || {}) }
          delete records[rec.date]
          byId.set(rec.habitId, deriveHabit({ ...h, records }))
          tombstoneWins.push(t.id)
          continue
        }
        const h = byId.get(t.id)
        if (!h) { tombstoneWins.push(t.id); continue }
        if (h.updatedAt && habitLww(h.updatedAt, t.deletedAt) === 'local') {
          enqueueOp({ id: h.id, domain: 'habit', updatedAt: h.updatedAt, data: buildHabitData(h), label: '习惯「' + h.name + '」' })
          markPending('习惯「' + h.name + '」', h.id)
          continue
        }
        byId.delete(t.id)
        tombstoneWins.push(t.id)
      }
      setHabits([...byId.values()])
    }

    const removeIds = [...new Set([...gone, ...tombstoneWins])]
    if (removeIds.length) removeFromQueue(removeIds)
  }, [markPending])

  /* 自动对账成功也要更新「上次同步」——此前只有手动 runSync 会写，状态行长期停在旧时间，
     看起来像「一直没同步」。 */
  const touchLastSync = useCallback(() => {
    const now = new Date()
    setLastSync('今天 ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0'))
  }, [])

  /* 本次启动是否已经做过「本地日程为空 → 重置 schedule 游标」的自愈。只做一次：
     用户主动删空日程时不会每轮对账都全量重拉。 */
  const autoResyncedRef = useRef(false)

  /* ---------- v1.7 实时同步：挂起循环驱动器（前台常挂 pull；合并走既有 applyRemote*，零改动） ---------- */
  const rtRef = useRef<RtDriver | null>(null)
  if (!rtRef.current) {
    const d = new RtDriver({
      pullOnce: o => pullOnce(o),
      apply: out => {
        applyRemoteLedger(out.remoteLedger)
        applyRemoteSchedule(out.remoteSchedule)
        applyRemoteNotes(out.remoteNotes)
        applyRemoteHabits(out.remoteHabits)
        applyTombstones(out.removedTombstones)
      },
      /* 游标提交收口（WP6.3）：pullOnce 不再自行落盘，应用完成后这里统一提交 */
      commit: out => { commitPullCursor(out); touchLastSync() },
      onError: e => {
        if (e instanceof AuthError) {
          setConn('auth')
          supervisorStopRef.current?.()
          return
        }
        /* 挂起循环网络失败只戳监督器复探，不直接改 conn：
           弱网下单次长轮询超时很常见，直接落 offline 会让页头「已连接 ↔ 电脑离线」闪烁
           （2026-11-10 热点场景反馈）。是否真离线交给监督器按连续失败次数裁定。 */
        supervisorPokeRef.current?.()
      },
    })
    d.onMode = m => { setSyncMode(m) }
    rtRef.current = d
  }

  const runSync = useCallback(() => {
    void (async () => {
      if (syncingRef.current) return
      if (!getPaired()) { toast('先到「设置」配对电脑，才能同步', 'warn'); return }
      /* 离线使用中（paused）：立即同步仍是用户显式动作，放行为一次性对账——conn 保持 paused，
         也不重建挂起循环（off 为真时下面两处 maybeStart 全部跳过） */
      const off = offlineUseRef.current
      /* 离线/失效不再直接搁置：先 ping 一次给机会（auth 引导重新配对，offline 提示后自动重连）；
         离线使用中跳过 pre-ping（conn 不许离开 paused），可达性交给 syncNow 的网络错误提示 */
      if (!off && !onlineRef.current) {
        const r = await pingPaired()
        if (r.state === 'auth') { setConn('auth'); toast('电脑不再认识这台设备，请重新配对', 'warn'); return }
        if (r.state !== 'online') { toast('连不上电脑：确认同一网络、电脑端服务已开启（会自动重试）', 'warn'); return }
        setConn('online')
      }
      /* v1.7：对账前先停挂起循环（顶掉在途，避免双 pull 并发），收尾重建 */
      rtRef.current?.stop()
      /* 真实对账（push 队列 + pull 三域增量 + 墓碑）。
         注意：队列为空也必须 pull——「立即同步」此前在无待上行时直接 return，用户点了等于什么都没做，
         正好掩盖「游标已推到现在、本地却没数据」的问题（2026-11-09 实锤）。 */
      if (!autoResyncedRef.current && todosRef.current.length === 0 && getLastSync().schedule > 0) {
        autoResyncedRef.current = true
        resetSyncCursor('schedule')
      }
      setSyncing(true)
      setSyncPct(8)
      try {
        const out = await syncNow(pct => setSyncPct(pct))
        applyRemoteLedger(out.remoteLedger)
        applyRemoteSchedule(out.remoteSchedule)
        applyRemoteNotes(out.remoteNotes)
        applyRemoteHabits(out.remoteHabits)
        applyTombstones(out.removedTombstones)
        commitPullCursor(out)
        const handled = new Set(out.handledIds)
        setPending(list => list.filter(x => !x.opId || !handled.has(x.opId)))
        // notes 域出队 → 对应手机笔记标记已同步（op.id = 笔记 id）
        if (out.handledIds.length) {
          setPhoneNotes(list => list.map(x => handled.has(x.id) ? { ...x, synced: true } : x))
        }
        setSyncing(false)
        setSyncPct(0)
        touchLastSync()
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
      } finally {
        if (!offlineUseRef.current) rtRef.current?.maybeStart()
      }
    })()
  }, [toast, applyRemoteLedger, applyRemoteSchedule, applyRemoteNotes, applyRemoteHabits, applyTombstones, touchLastSync])

  /* 全量重新对账：清空三域游标 → push 积压 + pull 全量 → 应用。
     用于「本地为空但游标已推到现在」/ 换仓 / 重配对后的修复；不清本地数据与队列（push 会先上行）。 */
  const fullResync = useCallback(() => {
    void (async () => {
      if (syncingRef.current) return
      if (!getPaired()) { toast('先到「设置」配对电脑，才能同步', 'warn'); return }
      const off = offlineUseRef.current
      if (!off && !onlineRef.current) {
        const r = await pingPaired()
        if (r.state === 'auth') { setConn('auth'); toast('电脑不再认识这台设备，请重新配对', 'warn'); return }
        if (r.state !== 'online') { toast('连不上电脑：确认同一网络、电脑端服务已开启', 'warn'); return }
        setConn('online')
      }
      rtRef.current?.stop()
      resetSyncCursor()
      setSyncing(true)
      setSyncPct(8)
      try {
        const out = await syncNow(pct => setSyncPct(pct))
        applyRemoteLedger(out.remoteLedger)
        applyRemoteSchedule(out.remoteSchedule)
        applyRemoteNotes(out.remoteNotes)
        applyRemoteHabits(out.remoteHabits)
        applyTombstones(out.removedTombstones)
        commitPullCursor(out)
        touchLastSync()
        const handled = new Set(out.handledIds)
        setPending(list => list.filter(x => !x.opId || !handled.has(x.opId)))
        if (out.handledIds.length) {
          setPhoneNotes(list => list.map(x => handled.has(x.id) ? { ...x, synced: true } : x))
        }
        setSyncing(false)
        setSyncPct(0)
        toast('全量对账完成：日程 ' + out.remoteSchedule.length + ' 条 · 记账 ' + out.remoteLedger.length + ' 条 · 笔记 ' + out.remoteNotes.length + ' 条 · 打卡 ' + out.remoteHabits.length + ' 条', 'ok')
      } catch (e) {
        setSyncing(false)
        setSyncPct(0)
        toast(e instanceof Error ? e.message : '全量对账失败', 'warn')
      } finally {
        if (!offlineUseRef.current) rtRef.current?.maybeStart()
      }
    })()
  }, [toast, applyRemoteLedger, applyRemoteSchedule, applyRemoteNotes, applyRemoteHabits, applyTombstones, touchLastSync])

  /* 启动自愈：本地日程为空但游标已推到现在 → 自动全量重拉一次（本次启动只做一次）。
     覆盖「手机已连接实时但日程模块全空」的场景，用户不必先找到按钮。延迟 800ms 让配对/网络就绪。 */
  useEffect(() => {
    if (!paired || offlineUseRef.current || autoResyncedRef.current) return
    if (todos.length > 0 || getLastSync().schedule <= 0) return
    const t = setTimeout(() => {
      if (autoResyncedRef.current) return
      autoResyncedRef.current = true
      fullResync()
    }, 800)
    return () => clearTimeout(t)
  }, [paired, todos.length, fullResync])

  /* v1.7 静默对账：写操作防抖 / 回前台的「立即拉平」——停循环（顶掉在途）→ push+pull → 重建循环。
     无 toast（区别于手动 runSync）；失败静默，离线由循环退避接手。
     离线使用总闸在入口单点收口：一切自动对账路径（写防抖、监督器恢复）统一进这里，
     防抖在途时开了总闸也不许发出流量、不许在收尾重建挂起循环 */
  const reconcileQuiet = useCallback(() => {
    if (offlineUseRef.current) return
    void (async () => {
      if (syncingRef.current) return
      if (!getPaired()) return
      /* 自愈：本地日程为空但游标已推到现在 → 本次启动只重置一次 schedule 游标，从 0 重拉。
         2026-11-09 实锤：手机「已连接 · 实时」但日程模块全空，游标却已是今天。 */
      if (!autoResyncedRef.current && todosRef.current.length === 0 && getLastSync().schedule > 0) {
        autoResyncedRef.current = true
        resetSyncCursor('schedule')
      }
      rtRef.current?.stop()
      try {
        const out = await syncNow()
        applyRemoteLedger(out.remoteLedger)
        applyRemoteSchedule(out.remoteSchedule)
        applyRemoteNotes(out.remoteNotes)
        applyRemoteHabits(out.remoteHabits)
        applyTombstones(out.removedTombstones)
        commitPullCursor(out)
        touchLastSync()
        const handled = new Set(out.handledIds)
        setPending(list => list.filter(x => !x.opId || !handled.has(x.opId)))
        if (out.handledIds.length) {
          setPhoneNotes(list => list.map(x => handled.has(x.id) ? { ...x, synced: true } : x))
        }
      } catch { /* 静默：断网 / 桌面重启由循环退避接手 */ }
      rtRef.current?.maybeStart()
    })()
  }, [applyRemoteLedger, applyRemoteSchedule, applyRemoteNotes, applyRemoteHabits, applyTombstones, touchLastSync])

  /* ---------- 连接监督器（WP4）：配对即运行，conn 四态单一真相 ----------
   * online → 60s keepalive（自愈检测）；offline → 1/2/5/10/15s 退避重探；auth → 停（UI 引导重新配对）。
   * 回前台 / 离线时本地写（防抖）→ poke 立即探测。RtDriver 的 off 不再驱动 conn（挂起循环失败经 onError 上报）。 */
  const KEEPALIVE_MS = 60_000
  const supervisorRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; fails: number; stopped: boolean; gen: number }>({ timer: null, fails: 0, stopped: true, gen: 0 })
  const pingingRef = useRef(false)
  const pokePendingRef = useRef(false)
  const pokeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 供先定义的回调（markPending / RtDriver.onError）反向调用——真正的实现在下方 */
  const supervisorPokeRef = useRef<((debounceMs?: number) => void) | null>(null)
  const supervisorStopRef = useRef<(() => void) | null>(null)

  const supervisorStop = useCallback(() => {
    const s = supervisorRef.current
    s.stopped = true
    s.gen++
    if (s.timer) clearTimeout(s.timer)
    s.timer = null
  }, [])
  supervisorStopRef.current = supervisorStop

  const supervisorTick = useCallback(async () => {
    const s = supervisorRef.current
    const gen = s.gen
    if (s.stopped || pingingRef.current) return
    /* 本次探测已消费掉触发它的 poke；探测期间再收到的 poke 会重新置位，
       由本发收尾时的「立即续探」接管——避免一次 poke 连打两发 ping。 */
    pokePendingRef.current = false
    pingingRef.current = true
    let r: Awaited<ReturnType<typeof pingPaired>>
    try { r = await pingPaired() } finally { pingingRef.current = false }
    if (s.stopped || gen !== s.gen) return
    if (r.state === 'online') {
      const was = connRef.current
      s.fails = 0
      setConn('online')
      /* 恢复在线（含启动首探）：拉平积压（reconcileQuiet 收尾自会重建挂起循环）；
         已在线的 keepalive 只确保循环在，不打断在途挂起 */
      if (was !== 'online') reconcileQuietRef.current()
      else rtRef.current?.maybeStart()
      s.timer = setTimeout(() => { s.timer = null; void supervisorTick() }, KEEPALIVE_MS)
    } else if (r.state === 'auth') {
      setConn('auth')
      rtRef.current?.stop() /* 令牌失效：循环停，红条引导重新配对；adoptPaired 后监督器重启 */
    } else {
      s.fails++
      /* 抖动保护（2026-11-10 用户反馈）：热点 / 弱网下单次 ping 失败很可能只是瞬时丢包，
         直接落 offline 会让状态行「亮一下灭一下」。连续 2 次失败才显示离线；
         第一次失败保持原状态，1s 后立刻复探。恢复时 fails 归零、立即回 online。 */
      if (s.fails >= 2) setConn('offline')
      s.timer = setTimeout(() => { s.timer = null; void supervisorTick() }, nextProbeDelayMs(s.fails))
    }
    /* 探测期间收到 poke：立即重探一次（不叠加并发——pingingRef 已放行） */
    if (!s.stopped && pokePendingRef.current) {
      pokePendingRef.current = false
      void supervisorTick()
    }
  }, [])

  const supervisorPoke = useCallback((debounceMs = 0) => {
    const s = supervisorRef.current
    if (s.stopped) return
    if (debounceMs > 0) {
      if (pokeDebounceRef.current) return /* 已有防抖在排队 */
      pokeDebounceRef.current = setTimeout(() => {
        pokeDebounceRef.current = null
        supervisorPoke(0)
      }, debounceMs)
      return
    }
    pokePendingRef.current = true
    if (pingingRef.current) return /* 在途：tick 收尾看到 pokePending 会立即续跑 */
    if (s.timer) clearTimeout(s.timer)
    void supervisorTick()
  }, [supervisorTick])
  supervisorPokeRef.current = supervisorPoke

  const supervisorStart = useCallback(() => {
    supervisorStop()
    const s = supervisorRef.current
    s.stopped = false
    s.gen++
    s.fails = 0
    void supervisorTick()
  }, [supervisorStop, supervisorTick])

  /* 配对即进监督器（auth/offline 转变不需要重启——tick 内自管）；解除配对/离线使用时停。
     离线使用是总闸：开 → 监督器与挂起循环全停、conn 落 paused（不再自动重连，数据只记本机）；
     关 + 已配对 → 监督器拉起恢复自动重连。显式连接类操作（pairWith/adoptPaired/reconnectNow）
     走 setPref 退出离线使用，统一汇入这条 effect，不各自私自起监督器 */
  useEffect(() => {
    if (prefs.offlineUse) {
      supervisorStop()
      rtRef.current?.stop()
      if (paired) setConn('paused')
      return
    }
    if (!paired) { supervisorStop(); return }
    supervisorStart()
    return () => supervisorStop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paired, prefs.offlineUse])

  /** 「重新连接」：立即探测一次（监督器停着时也拉起）；离线使用中 = 显式连接意图，自动退出该模式 */
  const reconnectNow = useCallback(() => {
    if (!getPaired()) { toast('先到「设置」配对电脑，才能连接', 'warn'); return }
    if (offlineUseRef.current) {
      setPref('offlineUse', false)
      toast('已退出离线使用 · 正在连接 ' + (getPaired()?.pcName || '电脑') + '…', 'info')
      return
    }
    if (supervisorRef.current.stopped) supervisorStart()
    supervisorPoke()
    toast('正在连接 ' + (getPaired()?.pcName || '电脑') + '…', 'info')
  }, [toast, supervisorStart, supervisorPoke, setPref])

  /** 地址修复（WP5）：发现到候选后用现有令牌试连，ping 通才替换 baseUrl（本地数据不动） */
  const repairAddress = useCallback(async (baseUrl: string): Promise<boolean> => {
    const cur = getPaired()
    if (!cur) return false
    const r = await pingDevice(baseUrl, cur.token)
    if (r.state !== 'online') {
      if (r.state === 'auth') toast('找到了电脑但令牌已失效，请重新配对', 'warn')
      else toast('这个地址连不上', 'warn')
      return false
    }
    const next: PairedDevice = { ...cur, baseUrl }
    savePaired(next)
    setPaired(next)
    toast('已改连 ' + baseUrl.replace('http://', ''), 'ok')
    return true
  }, [toast])

  /* ---------- 配对 ---------- */

  const pairWith = useCallback(async (input: string, code: string) => {
    try {
      const device = await pairRequest(input, code, getDeviceName())
      setPaired(device)
      /* 配对成功 = 显式连接意图：离线使用中自动退出，避免「刚配对完却永远 paused」。
         offlineUseRef 仍持旧值（ref 随下一次渲染才刷新），正好用于本次 toast 文案 */
      const back = offlineUseRef.current ? ' · 已退出离线使用' : ''
      if (offlineUseRef.current) setPref('offlineUse', false)
      toast('已配对 ' + device.pcName + ' · 开始首次对账' + back, 'ok')
      /* 监督器随 paired 变更自动起跑（首探确认后接首次对账）；这里不等探测，500ms 后直接对一次 */
      setTimeout(() => reconcileQuietRef.current(), 500)
    } catch (e) {
      toast(e instanceof Error ? e.message : '配对失败', 'warn')
    }
  }, [toast, setPref])

  /** v1.5 请求式配对：pollPair 已落盘令牌，这里同步内存态并接上首次对账 */
  const adoptPaired = useCallback(async (device: PairedDevice) => {
    setPaired(device)
    /* 同 pairWith：配对成功自动退出离线使用 */
    const back = offlineUseRef.current ? ' · 已退出离线使用' : ''
    if (offlineUseRef.current) setPref('offlineUse', false)
    toast('已配对 ' + device.pcName + ' · 开始首次对账' + back, 'ok')
    /* 监督器随 paired 变更自动起跑；首次对账不等探测 */
    setTimeout(() => reconcileQuietRef.current(), 500)
  }, [toast, setPref])

  const unpair = useCallback(() => {
    rtRef.current?.stop()
    supervisorStopRef.current?.()
    unpairDevice()
    setPaired(null)
    setConn('online')
    toast('已解除配对，数据保留在手机', 'ok')
  }, [toast])

  /* 直连档 AI 配置：pm.aiConfig，Key 只在本机（不上行、不进同步队列） */
  const updateAiConfig = useCallback((cfg: AiConfig) => {
    setAiConfigState(cfg)
    saveAiConfig(cfg)
  }, [])

  runSyncRef.current = runSync
  reconcileQuietRef.current = reconcileQuiet

  /* v1.7 前后台（电池硬要求）：退后台暂停挂起循环（取消在途——后台 fetch 被冻结行为不可控）；
     回前台无条件戳监督器（不看旧 online——WP4：电脑后开/换 IP 的场景旧值恒 false 会永远离线），
     监督器首探在线 → reconcileQuiet 拉平积压 → 重建挂起循环。
     离线使用中不戳（总闸 effect 已全停，回前台也不许自动重连） */
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        rtRef.current?.stop()
      } else {
        if (!offlineUseRef.current) supervisorPokeRef.current?.()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

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

  /* 打卡（v1.8 起参与同步）：records 是真相，hist/weekDone/streak 由 deriveHabit 派生；
     每次勾选/取消都入 habit 队列（记录 upsert / 墓碑），markPending 触发对账。 */
  const toggleHabit = useCallback((id: string) => {
    const h = habits.find(x => x.id === id)
    if (!h) return
    const date = dayIso(0)
    const nowIso = new Date().toISOString()
    const wasDone = !!h.records?.[date]
    const records = { ...(h.records || {}) }
    if (wasDone) delete records[date]
    else records[date] = nowIso
    const next = deriveHabit({ ...h, records })
    setHabits(list => list.map(x => x.id === id ? next : x))
    const rid = habitRecordId(id, date)
    if (wasDone) {
      enqueueOp({ id: rid, domain: 'habit', updatedAt: nowIso, data: { deleted: true }, label: '取消打卡：' + h.name })
      markPending('取消打卡：' + h.name, rid)
    } else {
      enqueueOp({ id: rid, domain: 'habit', updatedAt: nowIso, data: buildHabitRecordData(id, date), label: '打卡：' + h.name })
      markPending('打卡：' + h.name, rid)
      toast('打卡成功', 'ok')
    }
  }, [habits, markPending, toast])

  /* 习惯增改删（v1.8 起入同步队列）：定义走 habit 域，删除走墓碑；records 由 toggleHabit 维护。
     char（首字）与 color（色板轮转）自动派生，表单只问名称 / 周目标 / 提醒时间。 */
  const addHabit = useCallback((input: { name: string; target: number; remind?: number }) => {
    const name = input.name.trim()
    if (!name) return
    const nowIso = new Date().toISOString()
    const id = uuid()
    const habit: Habit = {
      id, name, char: [...name][0] ?? '习', color: HABIT_COLORS[habits.length % HABIT_COLORS.length],
      weekDone: 0, target: Math.min(7, Math.max(1, Math.round(input.target) || 7)), streak: 0,
      hist: [0, 0, 0, 0, 0, 0, 0], ...(input.remind != null ? { remind: input.remind } : {}),
      updatedAt: nowIso, records: {}, archived: false,
    }
    setHabits(list => [...list, habit])
    enqueueOp({ id, domain: 'habit', updatedAt: nowIso, data: buildHabitData(habit), label: '习惯「' + name + '」' })
    markPending('习惯「' + name + '」', id)
    toast(input.remind != null ? '已添加习惯 · 到点提醒打卡' : '已添加习惯', 'ok')
  }, [habits.length, markPending, toast])

  const updateHabit = useCallback((id: string, patch: { name?: string; target?: number; remind?: number | null }) => {
    const h = habitsRef.current.find(x => x.id === id)
    if (!h) return
    const nowIso = new Date().toISOString()
    const next: Habit = { ...h }
    if (patch.name != null && patch.name.trim()) { next.name = patch.name.trim(); next.char = [...patch.name.trim()][0] ?? h.char }
    if (patch.target != null) next.target = Math.min(7, Math.max(1, Math.round(patch.target)))
    if (patch.remind === null) delete next.remind
    else if (patch.remind != null) next.remind = patch.remind
    next.updatedAt = nowIso
    const derived = deriveHabit(next)
    setHabits(list => list.map(x => x.id === id ? derived : x))
    enqueueOp({ id, domain: 'habit', updatedAt: nowIso, data: buildHabitData(derived), label: '习惯「' + derived.name + '」' })
    markPending('习惯「' + derived.name + '」', id)
    toast('已保存', 'ok')
  }, [markPending, toast])

  const deleteHabit = useCallback((id: string) => {
    const h = habitsRef.current.find(x => x.id === id)
    const nowIso = new Date().toISOString()
    setHabits(list => list.filter(x => x.id !== id))
    enqueueOp({ id, domain: 'habit', updatedAt: nowIso, data: { deleted: true }, label: '删除习惯：' + (h?.name || '') })
    markPending('删除习惯：' + (h?.name || ''), id)
    toast('已删除习惯', 'ok')
  }, [markPending, toast])

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
    setPhoneNotes(list => [{ id, title, body, synced: false, updatedAt: new Date().toISOString() }, ...list])
    markPending(label, id)
  }, [markPending])

  /* 备忘录式即建即编（平板拍板，弃抽屉表单）：新建=本地空笔记直接进编辑器，
   * 首行即标题、编辑实时落本地（localStorage 兜底防丢），退出时统一入队/丢弃 */
  const createPhoneNote = useCallback(() => {
    const id = uuid()
    setPhoneNotes(list => [{ id, title: '', body: '', synced: false, updatedAt: new Date().toISOString() }, ...list])
    return id
  }, [])
  const updatePhoneNote = useCallback((id: string, title: string, body: string) => {
    setPhoneNotes(list => list.map(n => n.id === id ? { ...n, title, body, synced: false, updatedAt: new Date().toISOString() } : n))
  }, [])
  /* v1.6 U 盘模式：删除 = 墓碑上行（桌面删设备文件夹里的文件）；桌面没见过这个 id 就忽略，
     所以「新建后没写内容直接丢」也走这里，只是多一条无害墓碑。清空标题保存 = 删除这篇笔记。 */
  const deletePhoneNote = useCallback((id: string) => {
    enqueueOp({ id, domain: 'notes', updatedAt: new Date().toISOString(), data: { deleted: true }, label: '删除笔记' })
    setPhoneNotes(list => list.filter(n => n.id !== id))
    markPending('删除笔记', id)
  }, [markPending])
  const syncPhoneNote = useCallback((id: string, title: string, body: string) => {
    const label = '笔记「' + (title || '无标题').slice(0, 20) + '」'
    enqueueOp({ id, domain: 'notes', updatedAt: new Date().toISOString(), data: buildNoteData(title, body), label })
    markPending(label, id)
  }, [markPending])

  /* ---------- 仓库笔记树域（侧栏托管，§10.1） ---------- */
  const noteInSync = useCallback((page: NoteTreePage) => {
    const sel = syncSelRef.current
    return sel.ids.includes(page.id) ||
      page.path.split('/').slice(0, -1).some((_, i, arr) => sel.dirs.includes(arr.slice(0, i + 1).join('/')))
  }, [])

  const toggleSyncDir = useCallback((path: string) => setSyncSel(s => ({
    ...s,
    dirs: s.dirs.includes(path) ? s.dirs.filter(d => d !== path) : [...s.dirs, path],
  })), [])
  const toggleSyncNote = useCallback((id: string) => setSyncSel(s => ({
    ...s,
    ids: s.ids.includes(id) ? s.ids.filter(i => i !== id) : [...s.ids, id],
  })), [])
  const toggleVaultExpand = useCallback((path: string) => {
    setVaultExpanded(m => ({ ...m, [path]: !m[path] }))
  }, [])

  const fetchVaultTree = useCallback(() => {
    setVaultLoading(true)
    fetchNoteTree()
      .then(pages => {
        saveNoteTree(pages)
        setVaultTree({ fetchedAt: Date.now(), pages })
      })
      .catch((e: Error) => toast(e.message, 'warn'))
      .finally(() => setVaultLoading(false))
  }, [toast])

  /** 打开电脑笔记：缓存与目录版本一致（mtimeMs 对账）→ 直接读；否则在线拉取并落缓存 */
  const openVaultNote = useCallback((page: NoteTreePage) => {
    const hit = vaultCacheRef.current[page.id]
    const fresh = !!hit && hit.mtimeMs === page.mtimeMs
    setVaultReader({ title: page.title, path: page.path, kind: 'vault' })
    if (fresh) {
      setVaultBody(hit.body)
      setVaultState('cached')
      return
    }
    setVaultBody('')
    setVaultState('loading')
    fetchNoteContent(page.id)
      .then(c => {
        setVaultBody(c.body)
        setVaultState('cached')
        setVaultCache(prev => {
          const next = { ...prev, [page.id]: { title: page.title, body: c.body, mtimeMs: page.mtimeMs, at: Date.now() } }
          saveNoteCache(next)
          return next
        })
      })
      .catch((e: Error) => {
        /* 离线/伴侣不可达 → 有旧缓存就回落显示旧版（stale），联网对账后自动刷新；完全没缓存才报错 */
        if (hit) {
          setVaultBody(hit.body)
          setVaultState('stale')
          toast('离线，显示旧版缓存', 'info')
        } else {
          setVaultState('error')
          toast(e.message, 'warn')
        }
      })
  }, [toast])

  const openPhoneNote = useCallback((id: string) => {
    const hit = phoneNotesRef.current.find(x => x.id === id)
    if (!hit) return
    setVaultReader({ title: hit.title, path: '手机笔记 / ' + hit.title, kind: 'phone', phoneId: hit.id })
    setVaultBody('# ' + hit.title + '\n\n' + hit.body)
    setVaultState('cached')
  }, [])

  /* 进笔记页且已配对 → 自动拉目录树；离线使用中不拉（否则进页必弹「目录拉取超时」，
     笔记页恰是默认启动页）——离线看缓存，顶部手动刷新按钮仍在（显式动作照常报错） */
  useEffect(() => {
    if (activeTab !== 'notes' || !paired || prefs.offlineUse) return
    fetchVaultTree()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, paired, prefs.offlineUse])

  /* 选择同步增量对账：60s 一轮 + 进页/选区变化即触发（mtimeMs 变了才重拉，在线时选中内容自动保持最新） */
  const vaultRefreshingRef = useRef(false)
  const vaultRefreshRef = useRef<() => void>(() => {})
  vaultRefreshRef.current = () => {
    if (vaultRefreshingRef.current || !pairedRef.current) return
    const targets = vaultTreeRef.current.pages
      .filter(noteInSync)
      .filter(p => { const hit = vaultCacheRef.current[p.id]; return !hit || hit.mtimeMs !== p.mtimeMs })
    if (!targets.length) return
    vaultRefreshingRef.current = true
    ;(async () => {
      for (const p of targets) {
        try {
          const c = await fetchNoteContent(p.id)
          setVaultCache(prev => {
            const next = { ...prev, [p.id]: { title: p.title, body: c.body, mtimeMs: p.mtimeMs, at: Date.now() } }
            saveNoteCache(next)
            return next
          })
          /* 正在读的笔记若处于旧版回落态：原地刷新成新版（离线→联网闭环） */
          if (vaultReaderRef.current?.path === p.path && vaultStateRef.current === 'stale') {
            setVaultBody(c.body)
            setVaultState('cached')
          }
        } catch { /* 静默：下一轮对账再试 */ }
      }
      vaultRefreshingRef.current = false
    })()
  }
  useEffect(() => {
    if (activeTab !== 'notes' || !paired || prefs.offlineUse) return
    vaultRefreshRef.current()
    const t = setInterval(() => vaultRefreshRef.current(), 60_000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, paired, vaultTree, syncSel, prefs.offlineUse])

  /* ---------- 刷题（桌面 quiz 模块移动子集） ----------
   * 掌握判定对齐桌面：连续答对 ≥2 自动移出错题本（streak 累加），答错清零回流。
   * 作答即时落本地（pm.quiz）；回流桌面待协议 v1.3 quiz 域。 */
  const [quizRecords, setQuizRecords] = useState<QuizRecord[]>(() => loadJson<QuizRecord[]>(K_QUIZ, []))
  useEffect(() => { saveJson(K_QUIZ, quizRecords) }, [quizRecords])
  const quizRecordsRef = useRef(quizRecords); quizRecordsRef.current = quizRecords
  const answerQuiz = useCallback((id: string, correct: boolean) => {
    setQuizRecords(list => list.map(r => r.id !== id ? r : {
      ...r,
      correctCount: r.correctCount + (correct ? 1 : 0),
      wrongCount: r.wrongCount + (correct ? 0 : 1),
      streakCorrect: correct ? r.streakCorrect + 1 : 0,
      lastResult: correct ? 'correct' : 'wrong',
      updatedAt: Date.now(),
    }))
  }, [])

  /* AI 错题工具的落库三件套（确认卡确认后走这里，与 UI 同一条写入路径） */
  const addQuizRecord = useCallback((p: QuizAddProposal) => {
    const book = quizRecordsRef.current.filter(r => r.pageTitle === p.pageTitle)
    const nextNo = book.reduce((m, r) => Math.max(m, r.no), 0) + 1
    setQuizRecords(list => [{
      id: uuid(), pageId: 'ai', pageTitle: p.pageTitle, no: nextNo,
      type: p.type, question: p.question, options: p.options, answer: p.answer, explanation: p.explanation,
      wrongCount: 0, correctCount: 0, streakCorrect: 0, lastResult: '', updatedAt: Date.now(),
    }, ...list])
  }, [])
  const setQuizNote = useCallback((p: QuizNoteProposal) => {
    setQuizRecords(list => list.map(r => r.pageTitle === p.pageTitle && r.no === p.no ? { ...r, note: p.note, updatedAt: Date.now() } : r))
  }, [])
  const deleteQuizRecord = useCallback((p: QuizDelProposal) => {
    setQuizRecords(list => list.filter(r => !(r.pageTitle === p.pageTitle && r.no === p.no)))
  }, [])
  const upsertQuizAnswer = useCallback((pageId: string, pageTitle: string, spec: QuizSpec, correct: boolean) => {
    setQuizRecords(list => {
      const hit = list.find(r => r.pageId === pageId && r.pageTitle === pageTitle && r.no === spec.no)
      if (hit) {
        return list.map(r => r.id !== hit.id ? r : {
          ...r,
          correctCount: r.correctCount + (correct ? 1 : 0),
          wrongCount: r.wrongCount + (correct ? 0 : 1),
          streakCorrect: correct ? r.streakCorrect + 1 : 0,
          lastResult: correct ? 'correct' : 'wrong',
          updatedAt: Date.now(),
        })
      }
      return [{
        id: uuid(),
        pageId, pageTitle, no: spec.no,
        type: spec.type || 'choice',
        question: spec.question,
        options: spec.options,
        answer: spec.answer,
        explanation: spec.explanation,
        wrongCount: correct ? 0 : 1,
        correctCount: correct ? 1 : 0,
        streakCorrect: correct ? 1 : 0,
        lastResult: correct ? 'correct' : 'wrong',
        updatedAt: Date.now(),
      }, ...list]
    })
  }, [])

  /* ---------- AI ---------- */

  const newSession = useCallback(() => {
    const s = freshSession()
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
        const s = freshSession()
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
      reply: '收到。这里是原型的占位回复 —— 正式版会调用你在设置里配置的模型，并可以带着工具直接操作你的记账、日程和笔记。',
    }
  }, [todos])

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
      case 'quiz_query': {
        return { ok: true, forModel: quizQueryForModel(quizRecordsRef.current, args) }
      }
      case 'quiz_stats': {
        return { ok: true, forModel: quizStatsForModel(quizRecordsRef.current) }
      }
      case 'quiz_add': {
        const p = validateQuizAdd(args)
        if (typeof p === 'string') return no(p)
        const n = quizRecordsRef.current.filter(r => r.pageTitle === p.pageTitle).length
        return {
          ok: true,
          forModel: '已生成出题确认卡（' + p.pageTitle + ' · 第 ' + (n + 1) + ' 题）。等用户确认入库，不要重复调用。',
          proposal: { kind: 'quiz', data: p },
        }
      }
      case 'quiz_note': {
        const p = validateQuizNote(args)
        if (typeof p === 'string') return no(p)
        return { ok: true, forModel: '已生成错题备注确认卡。等用户确认。', proposal: { kind: 'quiz-note', data: p } }
      }
      case 'quiz_del': {
        const p = validateQuizDel(args)
        if (typeof p === 'string') return no(p)
        return { ok: true, forModel: '已生成移出确认卡。等用户确认。', proposal: { kind: 'quiz-del', data: p } }
      }
      default:
        return no('未知工具：' + name)
    }
  }

  /* 打字机呈现 v2（2026-11-08 拍板「标点节奏」，prototype/ai-typewriter.html 体验后定稿）：
     24ms 一跳、每跳 5~6 字（累加器取整保均值），标点后微顿——，、；：停 3 跳，。！？…与换行停 7 跳，
     「字快句缓」约 200 字/秒，长答案不拖场。漂移补偿：宿主把 setTimeout 拉长时按实际耗时放大步长
     保住字/秒（真机前台 dt≈24ms 即 scale=1，纯设计节奏；IAB 调试宿主 visible 也钳 ~1s/跳，靠它不龟速）。
     revealRef 记着完整消息与落盘回调——停止/点正文时立即落完整消息，不丢回复 */
  const startReveal = (full: string, done: (finalText: string) => void) => {
    setStreaming(true)
    setStreamPhase('reveal')
    revealRef.current = { full, done }
    const pauseOf = (ch: string) =>
      '，、；：'.includes(ch) ? 3 : ('。！？…\n'.includes(ch) ? 7 : 0)
    let i = 0
    let acc = 0
    let pauseLeft = 0
    let lastT = 0
    const step = () => {
      if (!revealRef.current) return   // 被停止接管（stopStream 已收尾落盘）
      const now = performance.now()
      const dt = lastT ? now - lastT : 24
      lastT = now
      if (pauseLeft > 0) { pauseLeft--; streamTimer.current = setTimeout(step, 24); return }
      const scale = Math.min(6, Math.max(1, dt / 24))
      acc += (5 + Math.floor(Math.random() * 2)) * scale
      const n = Math.floor(acc)
      if (n > 0) {
        acc -= n
        i = Math.min(full.length, i + n)
        pauseLeft = pauseOf(full[i - 1])
        setStreamText(full.slice(0, i))
      }
      if (i >= full.length) {
        revealRef.current = null
        setStreaming(false)
        setStreamPhase(null)
        setStreamText('')
        done(full)
        return
      }
      streamTimer.current = setTimeout(step, 24)
    }
    streamTimer.current = setTimeout(step, 24)
  }

  /* 停止生成：在途请求中断（store 的 async catch 里静默收尾）；
     已进入打字机阶段则立即落完整消息；两者都没有时只复位状态 */
  const stopStream = useCallback(() => {
    abortRef.current?.abort()
    if (streamTimer.current) { clearTimeout(streamTimer.current); streamTimer.current = null }
    const rv = revealRef.current
    if (rv) {
      revealRef.current = null
      setStreaming(false)
      setStreamPhase(null)
      setStreamText('')
      rv.done(rv.full)
      return
    }
    if (streamingRef.current) { setStreaming(false); setStreamPhase(null); setStreamText('') }
  }, [])

  /* 直连档真实工具循环（M4a）：上限 AI_MAX_ROUNDS 轮；写工具产出确认卡后停轮等确认 */
  const runDirectAgent = (userText: string) => {
    const cfg = aiConfigRef.current
    const sid = curSessionRef.current
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setStreaming(true)
    setStreamPhase('wait')
    setStreamText('')
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
        /* 轮数上限可由用户在 AI 配置的高级里设置（2026-11-08 拍板）；未设置 = AI_MAX_ROUNDS 默认 */
        const maxRounds = Math.min(24, Math.max(1, Math.round(cfg.maxRounds ?? AI_MAX_ROUNDS)))
        /* 思考痕迹：多轮工具循环里每轮 reasoning 各存一段，落库时拼成一条折叠区（与桌面按轮分段的观感一致） */
        const reasons: string[] = []
        while (rounds < maxRounds) {
          rounds++
          /* 多轮工具链把进度透出在占位文案里——长任务全程一条静态「正在思考」会让用户以为卡死 */
          setStreamText(rounds === 1 ? '正在思考' : '正在思考 · 工具第 ' + rounds + '/' + maxRounds + ' 轮')
          const reply = await chatOnce(cfg, history, AI_TOOLS, 60_000, ctrl.signal, sid)
          if (reply.reasoning) reasons.push(reply.reasoning)
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
        if (!finalText) finalText = rounds >= maxRounds ? '工具轮次用尽了（本次上限 ' + maxRounds + ' 轮）——大任务拆成几步说，或到「设置 → AI 模型 → 高级」调高轮数。' : '（模型没有返回内容）'
        const reason = reasons.length ? reasons.join('\n\n') : undefined
        startReveal(finalText, f => { pushAiMsg({ role: 'ai', text: f, card, reason }) })
        abortRef.current = null
      } catch (e) {
        abortRef.current = null
        setStreaming(false)
        setStreamPhase(null)
        setStreamText('')
        if (e instanceof AiStopped) { toast('已停止生成', 'info'); return }
        const msg = e instanceof Error ? e.message : 'AI 请求失败'
        toast(msg, 'warn')
        pushAiMsg({ role: 'ai', text: '没连上模型：' + msg })
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

    /* 已配置 → 真实工具循环 */
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
    } else if (kind === 'quiz' && data && 'question' in data) {
      addQuizRecord(data as QuizAddProposal)
    } else if (kind === 'quiz-note' && data && 'note' in data) {
      setQuizNote(data as QuizNoteProposal)
    } else if (kind === 'quiz-del' && data && 'no' in data) {
      deleteQuizRecord(data as QuizDelProposal)
    } else if (kind === 'move') {
      /* 演示卡（未配置 AI 时的脚本行为）：也走真实写入路径——原先只删本地不进队列，同步会把跑步条目原样带回来 */
      deleteTodo('t3')
      addTodo({ title: '跑步 30 分钟', type: 'daily', time: '19:30', date: dayIso(1) })
    }
    updateMsg(msgId, m => ({ ...m, card: m.card ? { ...m.card, confirmed: true } : m.card }))
  }, [saveTx, addTodo, deleteTodo, addPhoneNote, addQuizRecord, setQuizNote, deleteQuizRecord, updateMsg])

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

  /* ---- 本地通知（日程提醒）：启动申请一次权限；待办随动重排（浏览器 dev 全 no-op） ---- */
  const [notifPerm, setNotifPerm] = useState<NotifPerm>('unsupported')
  /* 设置分区导航（平板侧栏分类直达） */
  const [settingsSec, setSettingsSec] = useState<SettingsSec>('sync')
  useEffect(() => {
    void (async () => {
      const perm = await initNotifPermission()
      setNotifPerm(perm)
      if (perm === 'granted') await rescheduleReminders(todos, habits.filter(h => !h.archived), prefsRef.current.remindLead)
    })()
    // 只在启动跑一次：todos 后续变更由下方随动 effect 接管
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { void rescheduleReminders(todos, habits.filter(h => !h.archived), prefs.remindLead) }, [todos, habits, prefs.remindLead])

  /* ---- 应用内更新（docs/design.md §7.1）：启动静默检查（≥24h 节流，模块内自带）；
        发现新版 toast 一次指路设置-关于，状态本体走 lib/update 的独立订阅（不走本 Context，
        进度事件 200ms 一跳不该牵动全部常挂页面） ---- */
  useEffect(() => {
    setUpdateFoundNotifier(ver => toast(`发现新版本 v${ver}，见设置 → 关于`, 'info'))
    updateStartupCheck()
  }, [toast])
  const requestNotifPerm = useCallback(async () => {
    const perm = await requestNotifPermission()
    setNotifPerm(perm)
    if (perm === 'granted') await rescheduleReminders(todos, habits.filter(h => !h.archived), prefs.remindLead)
    return perm
  }, [todos, habits, prefs.remindLead])

  const value: Store = {
    theme, setTheme, prefs, setPref, toast, toasts, sheet, openSheet, closeSheet, sheetOrigin, activeTab, setActiveTab, kbSim, toggleKbSim, kbOpen,
    sideCollapsed, toggleSide,
    online, conn, reconnectNow, repairAddress, syncing, syncPct, syncMode, pending, lastSync, paired, runSync, fullResync, markPending, pairWith, adoptPaired, unpair,
    schedView, setSchedView, selDate, setSelDate, todos, toggleTodo, addTodo, deleteTodo, habits, toggleHabit, addHabit, updateHabit, deleteHabit, editHabitId, openHabitForm,
    entries, txs, saveTx, updateTx, deleteTx, editTxId, openTxEdit,
    folders, toggleFolder, markCached, phoneNotes, addPhoneNote,
    createPhoneNote, updatePhoneNote, deletePhoneNote, syncPhoneNote,
    vaultKw, setVaultKw, vaultTree, vaultLoading, vaultExpanded, toggleVaultExpand, vaultCache,
    vaultReader, setVaultReader, vaultBody, setVaultBody, vaultState, syncSel, toggleSyncDir, toggleSyncNote,
    noteInSync, fetchVaultTree, openVaultNote, openPhoneNote,
    quizRecords, answerQuiz, upsertQuizAnswer,
    addQuizRecord, setQuizNote, deleteQuizRecord,
    aiConfig, updateAiConfig, sessions, curSession, newSession, switchSession, deleteSession, renameSession, togglePin,
    streaming, streamText, streamPhase, sendChat, stopStream, confirmCard, dismissCard,
    voicePhase, voiceElapsed, toggleVoice,
    notifPerm, requestNotifPerm,
    settingsSec, setSettingsSec,
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
