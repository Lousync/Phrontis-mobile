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

/** 待同步队列条目（M1 只进 ledger 域） */
export interface QueueOp {
  /** 与条目 UUID 相同，服务端据此保 id upsert */
  id: string
  domain: 'ledger'
  updatedAt: string
  data: LedgerSyncData
  /** UI 展示用（待同步徽标文案） */
  label: string
}
export type AiMode = 'direct' | 'pc'
export type VoicePhase = 'idle' | 'recording' | 'transcribing'
export type SchedView = 'list' | 'grid' | 'habit'
