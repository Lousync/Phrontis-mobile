export type TodoType = 'deadline' | 'plan' | 'daily'

export interface Todo {
  id: string
  date: string
  title: string
  type: TodoType
  time: string
  tag: string
  done: boolean
  sched?: { s: number; e: number }
  subDone?: number
  subTotal?: number
  /** 父条目 UUID（子任务行；手机侧只读：仅用于聚合计数，不独立展示/编辑） */
  parentId?: string | null
}

export interface Habit {
  id: string
  name: string
  char: string
  color: string
  weekDone: number
  target: number
  streak: number
  hist: number[]
}

export interface Tx {
  id: string
  date: string
  sub: string
  name: string
  cat: string
  amt: number
  acc: string
}

export interface NoteFile {
  title: string
  path: string
  cached: boolean
  md: string
}

export interface Folder {
  name: string
  open: boolean
  files: NoteFile[]
}

export interface PhoneNote {
  id: string
  title: string
  body: string
  synced: boolean
}

export type CardKind = 'tx' | 'move'

export interface Msg {
  id: string
  role: 'user' | 'ai'
  text: string
  card?: { kind: CardKind; confirmed?: boolean }
  list?: Todo[]
}

export interface Session {
  id: string
  title: string
  ts: number
  pinned: boolean
  messages: Msg[]
}

export type ThemeName = 'dark' | 'light'
export type SheetId = 'tx' | 'todo' | 'note' | 'sessions' | null

/* ---------- 同步（M1，协议 docs/design.md §2.1） ---------- */

/** 已配对的电脑（手机侧本地真相，存 localStorage） */
export interface PairedDevice {
  baseUrl: string
  token: string
  pcName: string
  deviceId: string
  pairedAt: number
}

/** 记账域上行负载（桌面 TransactionRow 子集；source 由服务端补 'phone'） */
export interface LedgerSyncData {
  date: string
  time: string
  type: 'expense' | 'income'
  amount: number
  category: string
  payment: string
  merchant: string
  note: string
}

/** 日程域负载（协议 v1.1，与桌面 protocol.ScheduleItemData 同源；口径见 docs/design.md §2.1） */
export interface ScheduleSyncData {
  date: string
  title: string
  type: TodoType
  /** 'HH:MM'，'' = 无 */
  time: string
  done: boolean
  parentId: string | null
  /** 当天分钟数；null = 未排期 */
  schedStart: number | null
  schedEnd: number | null
}

/** 删除同步（墓碑 v1.1）上行负载 */
export interface TombstoneData {
  deleted: true
}

export type SyncPayload = LedgerSyncData | ScheduleSyncData | TombstoneData

/** 待同步队列条目（v1.1 起 ledger + schedule 两域，删除为墓碑负载） */
export interface QueueOp {
  /** 与条目 UUID 相同，服务端据此保 id upsert；删除时亦为该条目 UUID */
  id: string
  domain: 'ledger' | 'schedule'
  updatedAt: string
  data: SyncPayload
  /** UI 展示用（待同步徽标文案） */
  label: string
}
export type AiMode = 'direct' | 'pc'
export type VoicePhase = 'idle' | 'recording' | 'transcribing'
export type SchedView = 'list' | 'grid' | 'habit'
