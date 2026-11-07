import { fmtCost, fmtK } from '../../lib/data'
import { useApp } from '../../lib/store'
import { PageHead } from '../../components/chrome'

/**
 * AI 用量页 v1：用量埋点尚未接线（桌面 usage 模块同口径接入协议后才有了真实数据源），
 * 在此之前如实展示零值 + 空态——不再放确定性生成的演示数据（2026-11-07 拍板去除演示数据）。
 * 结构骨架（统计行 / 趋势 / 按模型）保留，接线后直接回填。
 */
export function UsagePage({ active }: { active: boolean }) {
  const { setActiveTab } = useApp()

  return (
    <section className={'page' + (active ? ' active' : '')}>
      <PageHead title="AI 用量" onBack={() => setActiveTab('settings')} />

      <div className="ph-card stat-row" style={{ padding: '12px 14px' }}>
        <div className="stat">
          <div className="lab">Tokens</div>
          <div className="val" style={{ fontSize: 17 }}>{fmtK(0)}</div>
        </div>
        <div className="stat">
          <div className="lab">花费</div>
          <div className="val" style={{ fontSize: 17 }}>{fmtCost(0)}</div>
        </div>
        <div className="stat">
          <div className="lab">请求</div>
          <div className="val" style={{ fontSize: 17 }}>0</div>
        </div>
      </div>

      <div className="ph-card">
        <div className="sec-title">趋势 <span className="more">按小时 · 按模型</span></div>
        <div className="empty" style={{ padding: '28px 0' }}>
          还没有用量记录 —— 和 AI 对话后，这里会出现趋势、按模型拆分与额度
        </div>
      </div>
    </section>
  )
}
