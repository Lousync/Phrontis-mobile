/**
 * 手机直连档轻量工具集（M4a，design.md §3 纪律）。
 *
 * 读工具直执行（本地数据即时返回）；写工具**绝不落库** —— 校验参数后返回提案，
 * 渲染成确认卡，用户确认后走与 UI 按钮同一条写入路径（saveTx / addTodo / addPhoneNote）。
 * 纪律：AI 说记好了 = 真的记了；未确认 = 什么都没发生。
 * schema 每个 ≤400 字符（成本纪律）；本文件保持纯函数（Node 可直跑，契约脚本直测）。
 */
import type { AiToolDef, NoteProposal, TodoProposal, TodoType, TxProposal } from './types'

export const AI_TOOLS: AiToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'now_time',
      description: '获取当前本地日期时间。用户说「今天/明天/昨晚」等相对时间时先调用它定位。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ledger_query',
      description: '查记账。scope=recent 返回最近 10 条流水 + 近 7 天收支汇总；scope=month 返回本月支出/收入/结余。',
      parameters: {
        type: 'object',
        properties: { scope: { type: 'string', enum: ['recent', 'month'], description: '缺省 recent' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ledger_add',
      description: '记一笔账，出确认卡等用户确认，不直接写入。',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['expense', 'income'] },
          amount: { type: 'number', description: '正数，元' },
          category: { type: 'string' },
          account: { type: 'string', description: '缺省微信' },
          merchant: { type: 'string', description: '名目，缺省同分类' },
        },
        required: ['type', 'amount'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'todo_query',
      description: '查某天待办（缺省今天）。返回标题/类型/完成状态/时段。',
      parameters: {
        type: 'object',
        properties: { date: { type: 'string', description: 'YYYY-MM-DD，缺省今天' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'todo_add',
      description: '加一条待办，出确认卡等用户确认。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          type: { type: 'string', enum: ['plan', 'deadline', 'daily'], description: '缺省 plan' },
          date: { type: 'string', description: 'YYYY-MM-DD，缺省今天' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'note_create',
      description: '记一条手机笔记（闪念），出确认卡，确认后上行电脑收件箱。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          body: { type: 'string', description: '正文，支持 Markdown' },
        },
        required: ['body'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'notes_list',
      description: '列出手机笔记（标题 + 同步状态），供用户问「我记过什么」。',
      parameters: { type: 'object', properties: {} },
    },
  },
]

export interface ToolResult {
  ok: boolean
  /** 给模型看的返回文本（短，成本纪律） */
  forModel: string
  /** 写工具的提案（渲染确认卡用） */
  proposal?: { kind: 'tx' | 'todo' | 'note'; data: TxProposal | TodoProposal | NoteProposal }
}

const err = (msg: string): ToolResult => ({ ok: false, forModel: msg })

/* ---- 参数校验（纯函数，契约脚本直测；返回 string = 错误文案） ---- */

export function validateLedgerAdd(args: Record<string, unknown>): TxProposal | string {
  const type = args.type === 'income' ? 'income' : args.type === 'expense' ? 'expense' : ''
  if (!type) return 'type 必须是 expense 或 income'
  const amount = Math.round(Number(args.amount) * 100) / 100
  if (!Number.isFinite(amount) || amount <= 0) return 'amount 必须是正数（元）'
  const category = String(args.category ?? '').trim().slice(0, 60) || '其他'
  const account = String(args.account ?? '').trim().slice(0, 60) || '微信'
  const merchant = String(args.merchant ?? '').trim().slice(0, 200) || category
  return { type, amount, category, account, merchant }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function validateTodoAdd(args: Record<string, unknown>, todayIso: string): TodoProposal | string {
  const title = String(args.title ?? '').trim().slice(0, 120)
  if (!title) return 'title 不能为空'
  const type: TodoType = args.type === 'deadline' || args.type === 'daily' ? args.type : 'plan'
  const rawDate = String(args.date ?? '').trim()
  const date = rawDate || todayIso
  if (!DATE_RE.test(date)) return 'date 格式必须是 YYYY-MM-DD'
  return { title, type, date }
}

export function validateNoteCreate(args: Record<string, unknown>): NoteProposal | string {
  const title = String(args.title ?? '').trim().slice(0, 120)
  const body = String(args.body ?? '').slice(0, 100_000)
  if (!title && !body.trim()) return '标题与正文不能都为空'
  return { title, body }
}

/** 系统提示：注入真实今天日期 + 写入纪律（纯函数，契约直测） */
export function buildSystemPrompt(todayIso: string, pcName: string | null): string {
  return [
    '你是 Phrontis 手机端的轻量 AI 助手，帮用户记账、看日程、记闪念。',
    '今天是 ' + todayIso + '。涉及「今天/明天」等相对日期时先调用 now_time 确认。',
    pcName ? '用户已配对电脑「' + pcName + '」，手机记的数据会同步过去。' : '用户尚未配对电脑，数据只在本机。',
    '规则：',
    '- 查数据用读工具，回答要短、直接给结论，不复述原始 JSON。',
    '- 记账/加待办/记笔记必须调用写工具生成确认卡，用户确认后才生效；在确认之前不要说「已经记好了」。',
    '- 确认卡生成后用一句话说明确认后会发生什么，然后结束，不要再调用工具。',
    '- 电脑端全库检索等能力当前不可用，不要承诺。',
  ].join('\n')
}
