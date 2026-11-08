import { dayIso } from './data'

/**
 * AI 用量埋点（v1：只统计「手机直连」的真实调用）。
 *
 * 数据来源：chatOnce 每次成功的 chat.completions 响应里的 usage 字段
 * （OpenAI 兼容端点都带 prompt_tokens / completion_tokens）。流式未用——chatOnce 是非流式。
 * 「电脑 AI」代理模式的消耗记在电脑端 usage 模块，待协议同步进来（二期）。
 *
 * 存储：pm.usage = { days: UsageDay[] }，按天聚合 + 24 小时桶 + 按模型拆分，保留 90 天。
 * 费用为估算值：按厂商公开牌价的 ¥/1M tokens 简单线性（缓存命中/阶梯价未计），
 * 不认识的模型只记 tokens 不计费用。
 */

export interface UsageModelStat { model: string; tokens: number; inTok: number; outTok: number; cost: number; reqs: number }
export interface UsageDay {
  iso: string
  tokens: number; inTok: number; outTok: number; cost: number; reqs: number
  hours: number[]            // 24 桶：各小时 tokens（今日趋势用）
  byModel: UsageModelStat[]
}

const K = 'pm.usage'
const MAX_DAYS = 90

/** ¥ / 1M tokens（估算口径）。命中即计费，未命中的模型费用记 0 */
const RATES: Array<{ re: RegExp; inRate: number; outRate: number }> = [
  { re: /deepseek/i, inRate: 2, outRate: 8 },
  { re: /glm/i, inRate: 8, outRate: 24 },
]

function estimateCost(model: string, inTok: number, outTok: number): number {
  const r = RATES.find(x => x.re.test(model))
  if (!r) return 0
  return (inTok * r.inRate + outTok * r.outRate) / 1e6
}

function load(): UsageDay[] {
  try {
    const v = JSON.parse(localStorage.getItem(K) || '')
    if (Array.isArray(v?.days)) return v.days as UsageDay[]
  } catch { /* 首次/损坏 → 空表 */ }
  return []
}

function save(days: UsageDay[]) {
  if (days.length > MAX_DAYS) days.splice(0, days.length - MAX_DAYS)
  localStorage.setItem(K, JSON.stringify({ days }))
}

/** 记一笔成功调用（usage 缺字段按 0 处理；调用方拿不到 usage 就不要调） */
export function recordUsage(model: string, inTok: number, outTok: number): void {
  if (!inTok && !outTok) return
  const days = load()
  const iso = dayIso(0)
  let day = days.find(d => d.iso === iso)
  if (!day) {
    day = { iso, tokens: 0, inTok: 0, outTok: 0, cost: 0, reqs: 0, hours: Array(24).fill(0), byModel: [] }
    days.push(day)
  }
  const cost = estimateCost(model, inTok, outTok)
  day.inTok += inTok
  day.outTok += outTok
  day.tokens += inTok + outTok
  day.cost += cost
  day.reqs++
  day.hours[new Date().getHours()] += inTok + outTok
  let m = day.byModel.find(x => x.model === model)
  if (!m) {
    m = { model, tokens: 0, inTok: 0, outTok: 0, cost: 0, reqs: 0 }
    day.byModel.push(m)
  }
  m.inTok += inTok; m.outTok += outTok; m.tokens += inTok + outTok; m.cost += cost; m.reqs++
  save(days)
}

export type UsageWindow = 'd1' | 'd7' | 'd30'

export interface UsageView {
  sum: { tokens: number; inTok: number; outTok: number; cost: number; reqs: number }
  models: UsageModelStat[]
  bars: Array<{ label: string; tokens: number }>
  xLabels: string[]
}

/** 读一个窗口的聚合视图（d1=今日按小时；d7/d30=按天） */
export function readUsage(win: UsageWindow): UsageView {
  const days = load()
  const n = win === 'd1' ? 1 : win === 'd7' ? 7 : 30
  const picked = days.slice(-n)
  const mergeModels = (acc: Map<string, UsageModelStat>, list: UsageModelStat[]) => {
    for (const m of list) {
      const t = acc.get(m.model) || { model: m.model, tokens: 0, inTok: 0, outTok: 0, cost: 0, reqs: 0 }
      t.inTok += m.inTok; t.outTok += m.outTok; t.tokens += m.tokens; t.cost += m.cost; t.reqs += m.reqs
      acc.set(m.model, t)
    }
  }
  const sum = { tokens: 0, inTok: 0, outTok: 0, cost: 0, reqs: 0 }
  const modelAcc = new Map<string, UsageModelStat>()
  for (const d of picked) {
    sum.tokens += d.tokens; sum.inTok += d.inTok; sum.outTok += d.outTok; sum.cost += d.cost; sum.reqs += d.reqs
    mergeModels(modelAcc, d.byModel)
  }

  let bars: Array<{ label: string; tokens: number }>
  let xLabels: string[]
  if (win === 'd1') {
    const day = picked[picked.length - 1]
    const hours = day?.hours ?? Array(24).fill(0)
    bars = hours.map((t, i) => ({ label: i + '时', tokens: t }))
    xLabels = ['0时', '6时', '12时', '18时', '23时']
  } else {
    bars = picked.map(d => ({ label: d.iso, tokens: d.tokens }))
    xLabels = n === 7
      ? [picked[0]?.iso, picked[3]?.iso, picked[6]?.iso].filter(Boolean) as string[]
      : [picked[0]?.iso, picked[10]?.iso, picked[20]?.iso, picked[29]?.iso].filter(Boolean) as string[]
  }
  return {
    sum,
    models: [...modelAcc.values()].sort((a, b) => b.tokens - a.tokens),
    bars, xLabels,
  }
}
