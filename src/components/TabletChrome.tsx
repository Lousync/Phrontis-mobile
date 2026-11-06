import { useApp } from '../lib/store'
import { SyncMeta } from './chrome'
import { IBook, ICalendar, IChevL, IChevR, IGear, IQuiz, ISparkle, IWallet } from './icons'

/* 平板侧栏（design.md §10，T1.5 改版）：恒定两栏布局的左栏。
 * 可收纳：rail(64px 纯图标) ⇄ 展开(232px 图标+文字)，状态落 localStorage。
 * 无品牌标题（用户拍板：左上角软件名没必要）；笔记·阅读居首位，刷题随其后（阅读域）；
 * 用量保持二级入口不进侧栏。 */
const NAV: Array<{ id: string; label: string; icon: (p: { size?: number }) => React.ReactElement }> = [
  { id: 'notes', label: '笔记 · 阅读', icon: IBook },
  { id: 'quiz', label: '刷题', icon: IQuiz },
  { id: 'ai', label: 'AI 助手', icon: ISparkle },
  { id: 'schedule', label: '日程', icon: ICalendar },
  { id: 'ledger', label: '记账', icon: IWallet },
]

export function TabletChrome() {
  const { activeTab, setActiveTab, sideCollapsed, toggleSide } = useApp()
  return (
    <aside className={'tb-side' + (sideCollapsed ? ' min' : '')}>
      <button className="tb-fold" onClick={toggleSide} title={sideCollapsed ? '展开侧栏' : '收起侧栏'}>
        {sideCollapsed ? <IChevR size={16} /> : <IChevL size={16} />}
        {!sideCollapsed && <span>收起</span>}
      </button>
      <nav className="tb-nav" aria-label="主导航">
        {NAV.map(t => (
          <button
            key={t.id}
            className={'tb-item' + (activeTab === t.id ? ' on' : '')}
            title={sideCollapsed ? t.label : undefined}
            onClick={e => setActiveTab(t.id, e.currentTarget)}
          >
            <t.icon size={18} />
            <span className="tb-lb">{t.label}</span>
          </button>
        ))}
      </nav>
      <div className="tb-foot">
        {!sideCollapsed && <SyncMeta />}
        <button
          className={'tb-item' + (activeTab === 'settings' ? ' on' : '')}
          title={sideCollapsed ? '设置' : undefined}
          onClick={e => setActiveTab('settings', e.currentTarget)}
        >
          <IGear size={18} />
          <span className="tb-lb">设置</span>
        </button>
      </div>
    </aside>
  )
}
