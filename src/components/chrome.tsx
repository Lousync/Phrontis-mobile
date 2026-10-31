import { useApp } from '../lib/store'
import { IBars, IBook, ICalendar, IGear, ISparkle, IWallet } from './icons'

export function TopBar() {
  const { online, syncing, pending, toggleOnline } = useApp()
  return (
    <header className="topbar">
      <div className="brand">Phrontis <small>MOBILE</small></div>
      <div className="spacer" />
      <button className={'sync-pill' + (online ? '' : ' offline') + (syncing ? ' syncing' : '')} onClick={toggleOnline}>
        <span className="dot" />
        <span>{syncing ? '同步中…' : online ? '已连接电脑' : '离线模式'}</span>
        {pending.length > 0 && <span className="badge">{pending.length}</span>}
      </button>
    </header>
  )
}

const TABS: Array<{ id: string; label: string; icon: (p: { size?: number }) => React.ReactElement }> = [
  { id: 'ai', label: 'AI', icon: ISparkle },
  { id: 'schedule', label: '日程', icon: ICalendar },
  { id: 'ledger', label: '记账', icon: IWallet },
  { id: 'notes', label: '笔记', icon: IBook },
  { id: 'usage', label: '用量', icon: IBars },
  { id: 'settings', label: '设置', icon: IGear },
]

export function TabBar() {
  const { activeTab, setActiveTab } = useApp()
  return (
    <nav className="tabbar">
      {TABS.map(t => (
        <button key={t.id} className={activeTab === t.id ? 'active' : ''} onClick={() => setActiveTab(t.id)}>
          <t.icon />
          {t.label}
        </button>
      ))}
    </nav>
  )
}

export function Toasts() {
  const { toasts } = useApp()
  return (
    <div className="toast-wrap">
      {toasts.map(t => (
        <div key={t.id} className={'toast ' + t.type}>
          <span className="tdot" />
          {t.msg}
        </div>
      ))}
    </div>
  )
}
