import { useMemo, useState } from 'react'
import { USAGE_MODELS, fmtCost, fmtK, usageData } from '../../lib/data'
import { useApp } from '../../lib/store'

type Win = 'd1' | 'd7' | 'd30'

function rangeOf(win: Win) {
  if (win === 'd1') {
    const d = usageData.days[29]
    return {
      bars: usageData.hours.map((h, i) => ({ label: i + '时', tokens: h.tokens })),
      sum: d,
      models: d.byModel,
      xLabels: ['0时', '6时', '12时', '18时', '23时'],
    }
  }
  const n = win === 'd7' ? 7 : 30
  const ds = usageData.days.slice(-n)
  const sum = {
    tokens: ds.reduce((s, x) => s + x.tokens, 0),
    cost: ds.reduce((s, x) => s + x.cost, 0),
    reqs: ds.reduce((s, x) => s + x.reqs, 0),
  }
  const models = USAGE_MODELS.map(m => {
    const pick = (x: typeof ds[number]) => x.byModel.find(b => b.id === m.id) ?? { tokens: 0, cost: 0, out: 0 }
    return {
      id: m.id, label: m.label,
      tokens: ds.reduce((s, x) => s + pick(x).tokens, 0),
      cost: ds.reduce((s, x) => s + pick(x).cost, 0),
      out: ds.reduce((s, x) => s + pick(x).out, 0),
    }
  })
  return {
    bars: ds.map(x => ({ label: x.iso, tokens: x.tokens })),
    sum, models,
    xLabels: n === 7 ? [ds[0].iso, ds[3].iso, ds[6].iso] : [ds[0].iso, ds[10].iso, ds[20].iso, ds[29].iso],
  }
}

export function UsagePage({ active }: { active: boolean }) {
  const { toast } = useApp()
  const [win, setWin] = useState<Win>('d1')
  const r = useMemo(() => rangeOf(win), [win])

  const max = Math.max(...r.bars.map(b => b.tokens), 1)
  const hotIdx = r.bars.reduce((mi, b, i) => (b.tokens > r.bars[mi].tokens ? i : mi), 0)
  const outTok = r.models.reduce((s, m) => s + m.out, 0)

  return (
    <section className={'page' + (active ? ' active' : '')}>
      <div className="ai-head">
        <span className="t">AI 用量</span>
        <div className="seg" style={{ width: 200, margin: '0 0 0 auto' }}>
          {(['d1', 'd7', 'd30'] as Win[]).map(w => (
            <button key={w} className={win === w ? 'on' : ''} onClick={() => setWin(w)}>
              {w === 'd1' ? '今日' : w === 'd7' ? '近 7 天' : '近 30 天'}
            </button>
          ))}
        </div>
      </div>

      <div className="card stat-row" style={{ padding: '12px 14px' }}>
        <div className="stat">
          <div className="lab">Tokens</div>
          <div className="val" style={{ fontSize: 17 }}>{fmtK(r.sum.tokens)}</div>
          <div className="lab" style={{ marginTop: 2 }}>输入 {fmtK(r.sum.tokens - outTok)} · 输出 {fmtK(outTok)}</div>
        </div>
        <div className="stat"><div className="lab">花费</div><div className="val" style={{ fontSize: 17 }}>{fmtCost(r.sum.cost)}</div></div>
        <div className="stat"><div className="lab">请求</div><div className="val" style={{ fontSize: 17 }}>{r.sum.reqs}</div></div>
      </div>

      <div className="card">
        <div className="sec-title">趋势 <span className="more">点柱看单日</span></div>
        <div className="ubar-wrap">
          {r.bars.map((b, i) => (
            <div key={i} className={'ubar' + (i === hotIdx ? ' hot' : '')}
              style={{ height: Math.max(2, b.tokens / max * 88) }}
              onClick={() => toast(b.label + ' · ' + b.tokens + ' tokens', 'info')} />
          ))}
        </div>
        <div className="ubar-x">{r.xLabels.map(x => <span key={x}>{x}</span>)}</div>
      </div>

      <div>
        <div className="set-label">按模型</div>
        <div className="card" style={{ padding: '2px 14px' }}>
          {r.models.map(m => (
            <div className="um-row" key={m.id}>
              <span className="um-name">{m.label}</span>
              <span className="um-bar"><span className="fill" style={{ width: (r.sum.tokens ? m.tokens / r.sum.tokens * 100 : 0) + '%', background: m.id === 'deepseek-chat' ? 'var(--accent)' : '#b180d7' }} /></span>
              <span className="um-nums">{fmtK(m.tokens)} · {fmtCost(m.cost)}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="set-label">账户额度</div>
        <div className="card" style={{ padding: '2px 14px' }}>
          <div className="uq-row">
            <span className="uq-name">智谱 GLM 包月</span>
            <span className="uq-bar"><span className="fill" style={{ width: '62%', background: 'var(--accent)' }} /></span>
            <span className="uq-txt">2000万 · 已用 62%</span>
          </div>
          <div className="uq-row">
            <span className="uq-name">DeepSeek 余额</span>
            <span className="uq-bar"><span className="fill" style={{ width: '27%', background: 'var(--green)' }} /></span>
            <span className="uq-txt">余额 ¥27.40</span>
          </div>
          <div className="uq-row warn">
            <span className="uq-name">硅基流动（转写）</span>
            <span className="uq-bar"><span className="fill" style={{ width: '86%', background: 'var(--amber)' }} /></span>
            <span className="uq-txt">¥10.00 · 剩 14%</span>
          </div>
        </div>
      </div>
    </section>
  )
}
