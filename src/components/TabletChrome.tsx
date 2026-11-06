import type { ReactElement } from 'react'
import { useApp } from '../lib/store'
import { SyncMeta } from './chrome'
import { IBook, ICalendar, IGear, ISparkle, IWallet } from './icons'

/* 平板侧栏（T0，design.md §10）：阅读优先——笔记升到首位，AI/日程/记账收进侧栏。
 * 用量保持「设置 → 工具」二级入口不进侧栏（低频页）；设置沉底。 */
const NAV: Array<{ id: string; label: string; icon: (p: { size?: number }) => ReactElement }> = [
  { id: 'notes', label: '笔记 · 阅读', icon: IBook },
  { id: 'ai', label: 'AI 助手', icon: ISparkle },
  { id: 'schedule', label: '日程', icon: ICalendar },
  { id: 'ledger', label: '记账', icon: IWallet },
]

/** 平板壳左栏：品牌 + 一级导航 + 底部（同步状态 + 设置）。与 .pages 构成 flex row。 */
export function TabletChrome() {
  const { activeTab, setActiveTab } = useApp()
  return (
    <aside className="tb-side">
      <div className="tb-brand">
        <span className="tb-dot" />
        Phrontis
      </div>
      <nav className="tb-nav" aria-label="主导航">
        {NAV.map(t => (
          <button
            key={t.id}
            className={'tb-item' + (activeTab === t.id ? ' on' : '')}
            onClick={e => setActiveTab(t.id, e.currentTarget)}
          >
            <t.icon size={18} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      <div className="tb-foot">
        <SyncMeta />
        <button
          className={'tb-item' + (activeTab === 'settings' ? ' on' : '')}
          onClick={e => setActiveTab('settings', e.currentTarget)}
        >
          <IGear size={18} />
          <span>设置</span>
        </button>
      </div>
    </aside>
  )
}
