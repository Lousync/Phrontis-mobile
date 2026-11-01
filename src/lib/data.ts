import type { Folder, Habit, Session, Todo, Tx } from './types'

/* ---- 日期锚点：真实「今天」（M2a 起日程接真实数据，不再是固定演示锚点 2026-10-31） ---- */

export const isoOf = (d: Date): string =>
  d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')

/** 今天 ±n 天的 ISO 日期 */
export function dayIso(offset = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return isoOf(d)
}

/** 某日的「M月D日」展示（种子数据用） */
const mdOf = (offset = 0): string => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return (d.getMonth() + 1) + '月' + d.getDate() + '日'
}

export const TODAY = dayIso(0)

/** 本周条：周一起的 7 天（与桌面周日程口径一致） */
export const WEEK = (() => {
  const now = new Date()
  const monday = new Date(now)
  monday.setDate(now.getDate() - (now.getDay() === 0 ? 7 : now.getDay()) + 1)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return { iso: isoOf(d), wd: '一二三四五六日'[i], n: d.getDate() }
  })
})()

export const CAT_COLORS: Record<string, string> = {
  餐饮: '#e2a336', 交通: '#3794ff', 购物: '#b180d7', 娱乐: '#f14c4c',
  学习: '#007acc', 日用: '#89d185', 医疗: '#4ec9b0', 其他: '#969696',
  工资: '#89d185', 稿费: '#e2a336', 理财: '#b180d7', 红包: '#f14c4c',
}
export const CATS_EXPENSE = ['餐饮', '交通', '购物', '娱乐', '学习', '日用', '医疗', '其他']
export const CATS_INCOME = ['工资', '稿费', '理财', '红包', '其他']
export const ACCOUNTS = ['微信', '支付宝', '现金', '银行卡']

export const WELCOME =
  '晚上好。手机端就我一个 AI，<b>记账、改日程、写笔记都找我</b> —— 点左下角麦克风说一句，或直接打字。连上电脑后切「电脑 AI」，升级成带全库工具的完整助手。'

export const VOICE_PHRASES = ['帮我记一笔午饭三十块', '把跑步改到明晚七点半', '记个想法：语音输入手感不错']

export const TODO_TYPE_LABEL: Record<string, string> = { deadline: '截止', plan: '计划', daily: '日常' }

export const seedTodos: Todo[] = [
  { id: 't1', date: TODAY, title: '交周报', type: 'deadline', time: '09:30', tag: '工作', done: true, sched: { s: 570, e: 610 } },
  { id: 't2', date: TODAY, title: 'Phrontis 手机版原型讨论', type: 'plan', time: '14:00', tag: '项目', done: false, sched: { s: 840, e: 930 }, subDone: 1, subTotal: 3 },
  { id: 't3', date: TODAY, title: '跑步 30 分钟', type: 'daily', time: '19:00', tag: '健康', done: false, sched: { s: 1140, e: 1170 } },
  { id: 't4', date: TODAY, title: '回复合作邮件', type: 'plan', time: '', tag: '工作', done: false },
  { id: 't5', date: TODAY, title: '回顾与明日规划', type: 'daily', time: '21:30', tag: '成长', done: false, sched: { s: 1290, e: 1320 } },
  { id: 't6', date: dayIso(1), title: '准备周一的周报框架', type: 'plan', time: '10:00', tag: '工作', done: false, sched: { s: 600, e: 660 } },
  { id: 't7', date: dayIso(1), title: '给妈妈打电话', type: 'daily', time: '20:00', tag: '家庭', done: false },
  { id: 't8', date: dayIso(-1), title: '项目周会', type: 'plan', time: '16:00', tag: '项目', done: true, sched: { s: 960, e: 1005 } },
  { id: 't9', date: dayIso(-1), title: '买生日礼物', type: 'deadline', time: '18:00', tag: '生活', done: true },
]

export const seedHabits: Habit[] = [
  { id: 'h1', name: '跑步 30 分钟', char: '跑', color: '#89d185', weekDone: 3, target: 5, streak: 6, hist: [1, 1, 0, 1, 1, 0] },
  { id: 'h2', name: '阅读 30 分钟', char: '读', color: '#3794ff', weekDone: 4, target: 7, streak: 12, hist: [1, 1, 1, 0, 1, 0] },
  { id: 'h3', name: '背单词 50 个', char: '词', color: '#cca700', weekDone: 2, target: 5, streak: 2, hist: [1, 0, 1, 0, 0, 0] },
]

export const seedTxs: Tx[] = [
  { id: 'x1', date: '今天', sub: mdOf(0) + ' · 12:02', name: '午餐 · 公司食堂', cat: '餐饮', amt: -28, acc: '微信' },
  { id: 'x2', date: '今天', sub: mdOf(0) + ' · 09:05', name: '地铁', cat: '交通', amt: -4, acc: '交通卡' },
  { id: 'x3', date: '昨天', sub: mdOf(-1) + ' · 15:40', name: '瑞幸咖啡', cat: '餐饮', amt: -15, acc: '微信' },
  { id: 'x4', date: '昨天', sub: mdOf(-1) + ' · 19:22', name: '超市日用品', cat: '日用', amt: -56, acc: '支付宝' },
  { id: 'x5', date: mdOf(-3), sub: mdOf(-3), name: '十月稿费', cat: '稿费', amt: 800, acc: '银行卡' },
]

export const seedFolders: Folder[] = [
  {
    name: '学习', open: true, files: [
      { title: 'AI教学模块笔记', cached: true, path: '学习 / AI教学模块笔记', md: '# AI教学模块笔记\n\n## 出题闭环\n\n组卷落成知识库 `.md`，页内每题一个 quiz 围栏，答错自动回流错题本。\n\n- 题号必须重排 1..N\n- snapshot.no 是原页序号\n\n> 交接要点：左栏段分组与输入区胶囊已随 3.15.1 落地。' },
      { title: '线性代数 · 特征值', cached: true, path: '学习 / 线性代数 · 特征值', md: '# 线性代数 · 特征值\n\n## 定义\n\n若 `Av = λv`，则 v 是 A 的特征向量，λ 是对应特征值。\n\n## 几何意义\n\n- 特征向量：变换下方向不变的向量\n- 特征值：该方向被拉伸的倍数' },
    ],
  },
  {
    name: '项目', open: false, files: [
      { title: 'Phrontis 手机版方案', cached: false, path: '项目 / Phrontis 手机版方案', md: '# Phrontis 手机版方案\n\n## 架构\n\n- 本地优先：手机自带 SQLite，离线全功能\n- 域级同步：按条目 UUID 合并，新增直接并入，修改「新改的赢」\n- AI 两档：手机直连 / 电脑代理\n\n## 里程碑\n\n1. 配对 + 同步基建\n2. 记账 / 日程双端\n3. 笔记缓存 + 手机笔记\n4. AI 两档\n5. 通知与打包' },
    ],
  },
  {
    name: '日记', open: false, files: [
      { title: '十月小结', cached: false, path: '日记 / 十月小结', md: '# 十月小结\n\n这个月把 3.15 的 AI 教学收尾了，开始想手机版的事。' },
    ],
  },
]

export const seedSessions: Session[] = [
  { id: 's1', title: '新会话', ts: Date.now(), pinned: false, messages: [{ id: 'm1', role: 'ai', text: WELCOME }] },
  {
    id: 's2', title: '语音输入方案讨论', ts: Date.now() - 86400000, pinned: true, messages: [
      { id: 'm2', role: 'user', text: '语音输入走云端还是本地？' },
      { id: 'm3', role: 'ai', text: '手机端建议云端直连：硅基流动的 SenseVoiceSmall 免费、中文优化，走你自己的 Key 费用为零。本地引擎要背 200MB 模型，在手机上不值得。' },
    ],
  },
  {
    id: 's3', title: '午饭 45 记一下', ts: Date.now() - 3 * 86400000, pinned: false, messages: [
      { id: 'm4', role: 'user', text: '记一下今天的午饭 45' },
      { id: 'm5', role: 'ai', text: '已入账：支出 ¥45.00 · 餐饮 · 午饭（微信）。这句是历史会话的演示。' },
    ],
  },
  {
    id: 's4', title: 'AI 教学出题脚本', ts: Date.now() - 12 * 86400000, pinned: false, messages: [
      { id: 'm6', role: 'user', text: '出题脚本的题号怎么重排？' },
      { id: 'm7', role: 'ai', text: '题号必须重排 1..N —— snapshot.no 是原页序号，沿用会把错题记到别的题上。' },
    ],
  },
  {
    id: 's5', title: '九月复盘与下月计划', ts: Date.now() - 45 * 86400000, pinned: false, messages: [
      { id: 'm8', role: 'user', text: '帮我复盘一下九月' },
      { id: 'm9', role: 'ai', text: '好的，从日程和打卡数据看，九月的节奏是……（历史会话演示）' },
    ],
  },
]

/* 用量演示数据（确定性种子）：工作日多、周末少、近月爬坡；口径对齐桌面 usage 模块 */
export interface UsageDay { iso: string; tokens: number; cost: number; reqs: number; byModel: Array<{ id: string; label: string; tokens: number; cost: number; out: number }> }
export const USAGE_MODELS = [
  { id: 'deepseek-chat', label: 'DeepSeek V3', rate: 0.0000042, share: 0.68 },
  { id: 'glm-4.6', label: 'GLM-4.6', rate: 0.000021, share: 0.32 },
]

export const usageData = (() => {
  let seed = 20261031
  const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647 }
  const now = new Date()
  const days: UsageDay[] = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now); d.setDate(now.getDate() - i)
    const weekend = d.getDay() === 0 || d.getDay() === 6
    const ramp = 0.55 + (29 - i) / 29 * 0.6
    const tokens = Math.round((weekend ? 5200 : 13800) * ramp * (0.55 + rnd() * 0.9))
    const outShare = 0.34 + rnd() * 0.1
    const byModel = USAGE_MODELS.map(m => {
      const t = Math.round(tokens * m.share * (0.9 + rnd() * 0.2))
      return { id: m.id, label: m.label, tokens: t, cost: t * m.rate, out: Math.round(t * outShare) }
    })
    days.push({
      iso: (d.getMonth() + 1) + '-' + d.getDate(),
      tokens: byModel.reduce((s, x) => s + x.tokens, 0),
      cost: byModel.reduce((s, x) => s + x.cost, 0),
      reqs: Math.round(tokens / 900 + rnd() * 8),
      byModel,
    })
  }
  const weights = [0, 0, 0, 0, 0, 0, 1, 3, 6, 9, 11, 10, 7, 6, 8, 10, 9, 6, 5, 6, 9, 11, 6, 2]
  const wSum = weights.reduce((a, b) => a + b, 0)
  const hours = weights.map(w => {
    const t = Math.round(days[29].tokens * w / wSum * (0.85 + rnd() * 0.3))
    return { tokens: t, reqs: Math.round(t / 900) }
  })
  return { days, hours }
})()

/* ================= 纯函数工具 ================= */

export function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function mdRender(src: string): string {
  const lines = esc(src).split('\n')
  let html = '', inCode = false, inList = false
  const closeList = () => { if (inList) { html += '</ul>'; inList = false } }
  for (const ln of lines) {
    if (ln.startsWith('```')) { closeList(); if (inCode) { html += '</code></pre>'; inCode = false } else { html += '<pre><code>'; inCode = true } continue }
    if (inCode) { html += ln + '\n'; continue }
    if (/^###\s/.test(ln)) { closeList(); html += '<h2>' + ln.slice(4) + '</h2>' }
    else if (/^##\s/.test(ln)) { closeList(); html += '<h2>' + ln.slice(3) + '</h2>' }
    else if (/^#\s/.test(ln)) { closeList(); html += '<h1>' + ln.slice(2) + '</h1>' }
    else if (/^>\s?/.test(ln)) { closeList(); html += '<blockquote>' + ln.replace(/^>\s?/, '') + '</blockquote>' }
    else if (/^[-*]\s/.test(ln)) { if (!inList) { html += '<ul>'; inList = true } html += '<li>' + ln.slice(2) + '</li>' }
    else if (/^\d+\.\s/.test(ln)) { if (!inList) { html += '<ul>'; inList = true } html += '<li>' + ln.replace(/^\d+\.\s/, '') + '</li>' }
    else if (ln.trim() === '') { closeList() }
    else { closeList(); html += '<p>' + ln + '</p>' }
  }
  closeList(); if (inCode) html += '</code></pre>'
  return html.replace(/```/g, '').replace(/`([^`]+)`/g, '<code>$1</code>')
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
