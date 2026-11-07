import type { LedgerEntry, Tx } from './types'

/* ---- 日期锚点：真实「今天」（M2a 起日程接真实数据，不再是固定演示锚点 2026-10-31） ---- */

export const isoOf = (d: Date): string =>
  d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')

/** 今天 ±n 天的 ISO 日期 */
export function dayIso(offset = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return isoOf(d)
}

/** 某日的「M月D日」展示 */
export const mdOf = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00')
  return (d.getMonth() + 1) + '月' + d.getDate() + '日'
}

export const TODAY = dayIso(0)

/** 任意一周的 7 天（offset=0 本周，1 下周，-1 上周；周一起，与桌面周日程口径一致） */
export function weekOf(offset = 0): Array<{ iso: string; wd: string; n: number }> {
  const now = new Date()
  const monday = new Date(now)
  monday.setDate(now.getDate() - (now.getDay() === 0 ? 7 : now.getDay()) + 1 + offset * 7)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return { iso: isoOf(d), wd: '一二三四五六日'[i], n: d.getDate() }
  })
}

/** 本周条（weekOf(0) 的别名，旧引用兼容） */
export const WEEK = weekOf(0)

export const CAT_COLORS: Record<string, string> = {
  餐饮: '#e2a336', 交通: '#3794ff', 购物: '#b180d7', 娱乐: '#f14c4c',
  学习: '#007acc', 日用: '#89d185', 医疗: '#4ec9b0', 其他: '#969696',
  工资: '#89d185', 稿费: '#e2a336', 理财: '#b180d7', 红包: '#f14c4c',
}
export const CATS_EXPENSE = ['餐饮', '交通', '购物', '娱乐', '学习', '日用', '医疗', '其他']
export const CATS_INCOME = ['工资', '稿费', '理财', '红包', '其他']
export const ACCOUNTS = ['微信', '支付宝', '现金', '银行卡']

/** 新会话欢迎语：按时段问候（原先是写死的「晚上好」） */
export function welcomeText(): string {
  const h = new Date().getHours()
  const g = h < 5 ? '夜深了' : h < 11 ? '早上好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好'
  return g + '。手机端就我一个 AI，<b>记账、改日程、写笔记都找我</b> —— 点左下角麦克风说一句，或直接打字。连上电脑后切「电脑 AI」，升级成带全库工具的完整助手。'
}

export const VOICE_PHRASES = ['帮我记一笔午饭三十块', '把跑步改到明晚七点半', '记个想法：语音输入手感不错']

export const TODO_TYPE_LABEL: Record<string, string> = { deadline: '截止', plan: '计划', daily: '日常' }

/* ================= 纯函数工具 ================= */

export function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/* ---------- Markdown 渲染：marked(GFM) + DOMPurify ----------
 * 自研行级渲染器语法覆盖太窄（表格/粗斜体/任务列表/图片/链接/嵌套列表全缺），
 * 换开源成熟方案：marked 负责完整 GFM 语法，DOMPurify 消毒防 XSS（dangerouslySetInnerHTML）。
 * breaks=true 对齐旧行为（单换行即换行，中文笔记与 AI 聊天输出友好）。 */
import { marked } from 'marked'
import DOMPurify from 'dompurify'

marked.setOptions({ gfm: true, breaks: true })

export function mdRender(src: string): string {
  /* Node 契约环境（verify-markdown.mjs）无 window：消毒只在浏览器运行时生效，契约只验语法语义 */
  return typeof window !== 'undefined' ? DOMPurify.sanitize(marked.parse(src, { async: false })) : marked.parse(src, { async: false })
}

export const fmtMoney = (n: number) => n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const fmtMin = (m: number) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')

/** 真实日期（同步回来的条目）→ 流水展示分组（今天/昨天/M月D日）与副标题 */
export function txDisplay(dateIso: string, time: string): { date: string; sub: string } {
  const d = new Date(dateIso + 'T00:00:00')
  const md = (d.getMonth() + 1) + '月' + d.getDate() + '日'
  const iso = (x: Date) => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0')
  const now = new Date()
  const y = new Date(now); y.setDate(now.getDate() - 1)
  const date = dateIso === iso(now) ? '今天' : dateIso === iso(y) ? '昨天' : md
  return { date, sub: time ? md + ' · ' + time : md }
}

/* ---- 账本派生与月视图（M2b，纯函数；契约脚本直测） ---- */

/** 同步形态条目 → 流水展示行（唯一派生出口，编辑/删除后的重画都走这里） */
export function txToDisplay(e: LedgerEntry): Tx {
  const disp = txDisplay(e.data.date, e.data.time)
  return {
    id: e.id,
    date: disp.date,
    sub: disp.sub,
    name: e.data.merchant || e.data.category,
    cat: e.data.category,
    amt: e.data.type === 'expense' ? -e.data.amount : e.data.amount,
    acc: e.data.payment || '其他',
  }
}

/** 'YYYY-MM-DD' → 'YYYY-MM'（异常日期返回 ''，调用方按不属于任何月处理） */
export function monthOf(dateIso: string): string {
  return /^\d{4}-\d{2}/.test(dateIso) ? dateIso.slice(0, 7) : ''
}

/** 月份平移：'2026-11' ± n（跨年自动进退位） */
export function monthShift(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number)
  if (!Number.isFinite(y) || !Number.isFinite(m)) return ym
  const d = new Date(y, m - 1 + delta, 1)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return y + '年' + m + '月'
}

export interface MonthStats { expense: number; income: number; balance: number }

/** 某月收支统计（transfer 类手机端不产生；统计只认 expense/income） */
export function monthStats(entries: LedgerEntry[], ym: string): MonthStats {
  let expense = 0, income = 0
  for (const e of entries) {
    if (monthOf(e.data.date) !== ym) continue
    if (e.data.type === 'expense') expense += e.data.amount
    else income += e.data.amount
  }
  return { expense, income, balance: income - expense }
}

/** 某月条目按日分组：新日在前，组内按 updatedAt 倒序（同日内后记的在上） */
export function groupEntriesByDay(entries: LedgerEntry[], ym: string): Array<{ date: string; entries: LedgerEntry[] }> {
  const inMonth = entries
    .filter(e => monthOf(e.data.date) === ym)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  const groups: Array<{ date: string; entries: LedgerEntry[] }> = []
  for (const e of inMonth) {
    let g = groups.find(x => x.date === e.data.date)
    if (!g) { g = { date: e.data.date, entries: [] }; groups.push(g) }
    g.entries.push(e)
  }
  return groups
}

export function fmtK(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + ' 万'
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(n)
}
export function fmtCost(n: number): string { return '¥' + n.toFixed(n < 10 ? 2 : 1) }

/* DeepSeek 式会话时间分组 */
export function sessGroupKey(ts: number): 'today' | 'yesterday' | 'd7' | 'd30' | 'older' {
  const start = new Date(); start.setHours(0, 0, 0, 0)
  const t0 = start.getTime()
  if (ts >= t0) return 'today'
  if (ts >= t0 - 86400000) return 'yesterday'
  if (ts >= t0 - 7 * 86400000) return 'd7'
  if (ts >= t0 - 30 * 86400000) return 'd30'
  return 'older'
}

/* 伪 QR 码绘制已随 M1 真实配对移除（配对改为设置页输入地址 + 配对码，扫码随 M6 APK 接入） */
