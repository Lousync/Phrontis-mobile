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

export type CardKind = 'tx' | 'todo' | 'note' | 'move'

/* AI 确认卡提案（写工具不落库，确认后走与 UI 按钮同一条写入路径） */
export interface TxProposal { type: 'expense' | 'income'; amount: number; category: string; account: string; merchant: string }
export interface TodoProposal { title: string; type: TodoType; date: string }
export interface NoteProposal { title: string; body: string }
export type ProposalData = TxProposal | TodoProposal | NoteProposal

export interface Card {
  kind: CardKind
  confirmed?: boolean
  /** 提案数据（演示卡 move 可无 data） */
  data?: ProposalData
}

export interface Msg {
  id: string
  role: 'user' | 'ai'
  text: string
  card?: Card
  list?: Todo[]
  /** 电脑档：桌面端本轮真实写改动（changes 清单展示） */
  changes?: Array<{ tool: string; action: string; target: string }>
}

export interface Session {
  id: string
  title: string
  ts: number
  pinned: boolean
  messages: Msg[]
}

/** 主题：内置深浅两套 + 移植桌面「主题合集」插件的 5 套（OpenCode 终端灰 / 四季包，色值出自该插件 plugin.json） */
export const THEME_IDS = ['dark', 'light', 'opencode', 'spring', 'summer', 'autumn', 'winter'] as const
export type ThemeName = (typeof THEME_IDS)[number]
export type SheetId = 'tx' | 'tx-edit' | 'todo' | 'note' | 'sessions' | 'ai-config' | 'theme' | 'scan' | null

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

/** 账本本地真相 = 同步形态条目（M2b）：编辑/删除需要完整负载可还原；
 *  展示形态（Tx）渲染时由 txToDisplay 派生，不再单独持久化 */
export interface LedgerEntry {
  id: string
  /** 本地最近一次变更时刻（ISO）；上行 LWW 与冲突收敛依据 */
  updatedAt: string
  data: LedgerSyncData
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

/** 笔记域负载（协议 v1.2：手机闪念上行，无条件应用；title 可空） */
export interface NoteSyncData {
  title: string
  body: string
}

/** 删除同步（墓碑 v1.1）上行负载 */
export interface TombstoneData {
  deleted: true
}

export type SyncPayload = LedgerSyncData | ScheduleSyncData | NoteSyncData | TombstoneData

/** 待同步队列条目（v1.2 起 ledger + schedule + notes 三域，删除为墓碑负载） */
export interface QueueOp {
  /** 与条目 UUID 相同，服务端据此保 id upsert；删除时亦为该条目 UUID */
  id: string
  domain: 'ledger' | 'schedule' | 'notes'
  updatedAt: string
  data: SyncPayload
  /** UI 展示用（待同步徽标文案） */
  label: string
}

/* ---------- 电脑笔记只读缓存（v1.2 内容 API） ---------- */

/** 目录树平表条目（GET /api/notes/tree 的 page） */
export interface NoteTreePage {
  id: string
  title: string
  /** 仓库内相对路径（服务端保证只含 doc 类 md） */
  path: string
  categoryId: string | null
  mtimeMs: number
  sizeBytes: number
}

/** 正文缓存条目（pm.noteCache；mtimeMs 与 tree 对账判定绿点/空心点） */
export interface NoteCacheEntry {
  title: string
  body: string
  mtimeMs: number
  /** 缓存时间（LRU 逐出依据） */
  at: number
}

export type NoteCache = Record<string, NoteCacheEntry>

/* ---------- AI 直连档（M4a，OpenAI 兼容） ---------- */

export type AiProvider = 'deepseek' | 'qwen' | 'doubao' | 'kimi' | 'glm' | 'opencode' | 'ollama' | 'custom'

/** AI 配置（pm.aiConfig；Key 只在手机本地，不上行） */
export interface AiConfig {
  provider: AiProvider
  /** 空串 = 用提供商预设地址（custom 必填） */
  baseUrl: string
  apiKey: string
  model: string
  /** 用户自定义请求头（高级项，JSON 解析后落盘；与预设自带头合并，用户优先） */
  headers?: Record<string, string>
}

/** OpenAI 兼容 tool_calls 元素 */
export interface AiToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface AiToolDef {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export interface AiChatMsg {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: AiToolCall[]
  tool_call_id?: string
}
export type AiMode = 'direct' | 'pc'
export type VoicePhase = 'idle' | 'recording' | 'transcribing'
export type SchedView = 'list' | 'grid' | 'habit'
