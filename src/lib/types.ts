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
export type SheetId = 'tx' | 'todo' | 'note' | 'qr' | 'sessions' | null
export type AiMode = 'direct' | 'pc'
export type VoicePhase = 'idle' | 'recording' | 'transcribing'
export type SchedView = 'list' | 'grid' | 'habit'
