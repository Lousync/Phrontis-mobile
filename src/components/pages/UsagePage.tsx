import { useMemo, useState } from 'react'
import { fmtCost, fmtK } from '../../lib/data'
import { readUsage, type UsageWindow } from '../../lib/usage'
import { useApp } from '../../lib/store'
import { PageHead } from '../../components/chrome'

/**
 * AI 用量面板：真实埋点数据（lib/usage.ts，AI 直连调用的 usage 记录），无数据时如实空态。
 * 手机 = 设置 → 工具 → AI 用量 二级页（本组件带返回头）；平板 = 设置域「AI 用量」分类（UsagePanel 内嵌）。
 * 窗口口径：今日=按小时；近 7/30 天=按天。费用为估算值（lib/usage.ts 牌价表）。
 */
export function UsagePanel() {
  const [win, setWin] = useState<UsageWindow>('d1')
  const r = useMemo(() => readUsage(win), [win])

  const max = Math.max(...r.bars.map(b => b.tokens), 1)
  const hotIdx = r.bars.reduce((mi, b, i) => (b.tokens > r.bars[mi].tokens ? i : mi), 0)
  const outTok = r.models.reduce((s, m) => s + m.outTok, 0)
  const leadModel = r.models[0]

  return (
    <>
      <div className="ph-card stat-row" style={{ padding: '12px 14px' }}>
        <div className="stat">
          <div className="lab">Tokens</div>
          <div className="val" style={{ fontSize: 17 }}>{fmtK(r.sum.tokens)}</div>
          <div className="lab" style={{ marginTop: 2 }}>输入 {fmtK(r.sum.inTok)} · 输出 {fmtK(outTok)}</div>
        </div>
        <div className="stat">
          <div className="lab">花费</div>
          <div className="val" style={{ fontSize: 17 }}>{fmtCost(r.sum.cost)}</div>
          <div className="lab" style={{ marginTop: 2 }}>估算值</div>
        </div>
        <div className="stat">
          <div className="lab">请求</div>
          <div className="val" style={{ fontSize: 17 }}>{r.sum.reqs}</div>
        </div>
      </div>

      <div className="ph-card">
        <div className="seg" style={{ marginBottom: 10 }}>
          {(['d1', 'd7', 'd30'] as UsageWindow[]).map(w => (
            <button key={w} className={win === w ? 'on' : ''} onClick={() => setWin(w)}>
              {w === 'd1' ? '今日' : w === 'd7' ? '近 7 天' : '近 30 天'}
            </button>
          ))}
        </div>
        {r.sum.tokens > 0 ? (
          <>
            <div className="ubar-wrap">
              {r.bars.map((b, i) => (
                <div key={i} className={'ubar' + (i === hotIdx ? ' hot' : '')}
                  style={{ height: Math.max(2, b.tokens / max * 88) }} />
              ))}
            </div>
            <div className="ubar-x">{r.xLabels.map(x => <span key={x}>{x}</span>)}</div>
          </>
        ) : (
          <div className="empty empty-box">
            还没有用量记录 —— 和 AI 对话后，这里会出现趋势、按模型拆分与估算费用
          </div>
        )}
      </div>

      {r.models.length > 0 && (
        <div>
          <div className="set-label">按模型</div>
          <div className="ph-card" style={{ padding: '2px 14px' }}>
            {r.models.map(m => (
              <div className="um-row" key={m.model}>
                <span className="um-name mono">{m.model}</span>
                {/* 一图一强调：用量最大的模型吃 accent，其余中性阶（unslop 口径） */}
                <span className="um-bar"><span className="fill" style={{
                  width: (r.sum.tokens ? m.tokens / r.sum.tokens * 100 : 0) + '%',
                  background: m.model === leadModel?.model ? 'var(--accent)' : 'var(--border)',
                }} /></span>
                <span className="um-nums">{fmtK(m.tokens)} · {fmtCost(m.cost)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

/** 手机端二级页（设置 → 工具 → AI 用量）；平板走设置域「AI 用量」分类内嵌 UsagePanel */
export function UsagePage({ active }: { active: boolean }) {
  const { setActiveTab } = useApp()

  return (
    <section className={'page' + (active ? ' active' : '')}>
      <PageHead title="AI 用量" onBack={() => setActiveTab('settings')} />
      <UsagePanel />
    </section>
  )
}
