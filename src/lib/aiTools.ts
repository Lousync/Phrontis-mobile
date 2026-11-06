/**
 * 手机直连档轻量工具集（M4a，design.md §3 纪律）。
 *
 * 读工具直执行（本地数据即时返回）；写工具**绝不落库** —— 校验参数后返回提案，
 * 渲染成确认卡，用户确认后走与 UI 按钮同一条写入路径（saveTx / addTodo / addPhoneNote）。
 * 纪律：AI 说记好了 = 真的记了；未确认 = 什么都没发生。
 * schema 每个 ≤400 字符（成本纪律）；本文件保持纯函数（Node 可直跑，契约脚本直测）。
 */
import type { AiToolDef, NoteProposal, QuizAddProposal, QuizDelProposal, QuizNoteProposal, QuizRecord, TodoProposal, TodoType, TxProposal } from './types'

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
  {
    type: 'function',
    function: {
      name: 'quiz_query',
      description: '查错题本。可按来源书名/掌握状态/最少错次过滤，返回题干摘要与错次。回答「操作系统还剩几道没掌握」「顽固错题有哪些」用这个。',
      parameters: {
        type: 'object',
        properties: {
          book: { type: 'string', description: '来源笔记/试卷名，模糊包含匹配，缺省全部' },
          mastery: { type: 'string', enum: ['unmastered', 'mastered', 'all'], description: '缺省 unmastered' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'quiz_stats',
      description: '错题本统计：总数/未掌握/已掌握、按来源书的分布、错次档位。用户问整体情况用它。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'quiz_add',
      description: '出一道新题入错题本（来源填笔记/试卷名），出确认卡等确认。给某篇笔记配练习、扩展题库用它。',
      parameters: {
        type: 'object',
        properties: {
          pageTitle: { type: 'string', description: '来源名，同名的归同一本书' },
          type: { type: 'string', enum: ['choice', 'short'] },
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' }, description: '仅选择题：选项文本数组，按 A/B/C 配 key' },
          answer: { type: 'string', description: '选择题=正确选项的字母；简答题=参考答案' },
          explanation: { type: 'string', description: '解析' },
        },
        required: ['pageTitle', 'type', 'question', 'answer'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'quiz_note',
      description: '给一道已有错题加备注/口诀（按来源名+题号定位），出确认卡。',
      parameters: {
        type: 'object',
        properties: {
          pageTitle: { type: 'string' },
          no: { type: 'number', description: '题号' },
          note: { type: 'string' },
        },
        required: ['pageTitle', 'no', 'note'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'quiz_del',
      description: '把一道题移出错题本（按来源名+题号定位，用于清理已掌握/重复题），出确认卡。移动端掌握判定：连续答对 2 次自动移出，一般无需手动删。',
      parameters: {
        type: 'object',
        properties: {
          pageTitle: { type: 'string' },
          no: { type: 'number' },
        },
        required: ['pageTitle', 'no'],
      },
    },
  },
]

export interface ToolResult {
  ok: boolean
  /** 给模型看的返回文本（短，成本纪律） */
  forModel: string
  /** 写工具的提案（渲染确认卡用） */
  proposal?: { kind: 'tx' | 'todo' | 'note' | 'quiz' | 'quiz-note' | 'quiz-del'; data: TxProposal | TodoProposal | NoteProposal | QuizAddProposal | QuizNoteProposal | QuizDelProposal }
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

/* ---- 刷题工具（读=纯函数直出；写=确认卡） ---- */

export function validateQuizAdd(args: Record<string, unknown>): QuizAddProposal | string {
  const pageTitle = String(args.pageTitle ?? '').trim().slice(0, 80) || 'AI 出题'
  const type = args.type === 'short' ? 'short' : 'choice'
  const question = String(args.question ?? '').trim().slice(0, 500)
  if (!question) return 'question 不能为空'
  const explanation = String(args.explanation ?? '').trim().slice(0, 1000)
  if (type === 'choice') {
    const raw = Array.isArray(args.options) ? args.options : []
    const options = raw.map((t, i) => ({ key: String.fromCharCode(65 + i), text: String(t).trim().slice(0, 200) })).filter(o => o.text)
    if (options.length < 2) return '选择题至少要 2 个选项'
    const answer = String(args.answer ?? '').trim().toUpperCase().slice(0, 1)
    if (!options.some(o => o.key === answer)) return 'answer 必须是选项字母（如 A）'
    return { pageTitle, type, question, options, answer, explanation }
  }
  const answer = String(args.answer ?? '').trim().slice(0, 800)
  if (!answer) return '简答题必须给参考答案'
  return { pageTitle, type, question, options: [], answer, explanation }
}

export function validateQuizNote(args: Record<string, unknown>): QuizNoteProposal | string {
  const pageTitle = String(args.pageTitle ?? '').trim().slice(0, 80)
  const no = Number(args.no)
  const note = String(args.note ?? '').trim().slice(0, 500)
  if (!pageTitle) return 'pageTitle 不能为空'
  if (!Number.isInteger(no) || no < 1) return 'no 必须是正整数题号'
  if (!note) return 'note 不能为空'
  return { pageTitle, no, note }
}

export function validateQuizDel(args: Record<string, unknown>): QuizDelProposal | string {
  const pageTitle = String(args.pageTitle ?? '').trim().slice(0, 80)
  const no = Number(args.no)
  if (!pageTitle) return 'pageTitle 不能为空'
  if (!Number.isInteger(no) || no < 1) return 'no 必须是正整数题号'
  return { pageTitle, no }
}

/** 掌握判定（与桌面同规）：错过且连续答对 <2 = 未掌握 */
export const quizUnmastered = (r: QuizRecord) => r.wrongCount > 0 && r.streakCorrect < 2

/** quiz_query 纯函数：过滤 + 摘要（契约直测） */
export function quizQueryForModel(records: QuizRecord[], args: Record<string, unknown>): string {
  const book = String(args.book ?? '').trim()
  const mastery = args.mastery === 'mastered' || args.mastery === 'all' ? args.mastery : 'unmastered'
  let list = records
  if (book) list = list.filter(r => r.pageTitle.includes(book))
  if (mastery === 'unmastered') list = list.filter(quizUnmastered)
  if (mastery === 'mastered') list = list.filter(r => !quizUnmastered(r))
  return JSON.stringify({
    count: list.length,
    items: list.slice(0, 15).map(r => ({
      book: r.pageTitle, no: r.no, type: r.type,
      question: r.question.slice(0, 60), wrong: r.wrongCount, streak: r.streakCorrect, note: r.note || undefined,
    })),
  })
}

/** quiz_stats 纯函数（契约直测） */
export function quizStatsForModel(records: QuizRecord[]): string {
  const un = records.filter(quizUnmastered)
  const byBook: Record<string, { total: number; unmastered: number }> = {}
  for (const r of records) {
    const b = byBook[r.pageTitle] || (byBook[r.pageTitle] = { total: 0, unmastered: 0 })
    b.total++
    if (quizUnmastered(r)) b.unmastered++
  }
  return JSON.stringify({ total: records.length, unmastered: un.length, masteredOrClean: records.length - un.length, byBook })
}

/** 系统提示：注入真实今天日期 + 写入纪律（纯函数，契约直测） */
export function buildSystemPrompt(todayIso: string, pcName: string | null): string {
  return [
    '你是 Phrontis 移动端的 AI 助手：记账、日程、闪念笔记 + 错题本/刷题（学习域）。',
    '今天是 ' + todayIso + '。涉及「今天/明天」等相对日期时先调用 now_time 确认。',
    pcName ? '用户已配对电脑「' + pcName + '」，记的数据会同步过去。' : '用户尚未配对电脑，数据只在本机。',
    '规则：',
    '- 查数据用读工具，回答要短、直接给结论，不复述原始 JSON。',
    '- 记账/加待办/记笔记/出题入库/错题备注/移出错题必须调用写工具生成确认卡，用户确认后才生效；确认前不要说「已经记好了」。',
    '- 错题本术语：来源名 = 「书」；未掌握 = 错过且连续答对少于 2 次；连续答对 2 次自动移出错题本，用户要清理时优先提醒这个规则。',
    '- 出题（quiz_add）要给解析；同一来源名会归入同一本书，用户说「给 XX 笔记配几道题」就保持 pageTitle 一致。',
    '- 确认卡生成后用一句话说明确认后会发生什么，然后结束，不要再调用工具。',
    '- 电脑端全库检索等能力当前不可用，不要承诺。',
  ].join('\n')
}
