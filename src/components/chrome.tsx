import { useApp } from '../lib/store'
import { IBars, IBook, ICalendar, IGear, IKeyboard, ISparkle, IWallet } from './icons'

export function TopBar() {
  const { online, syncing, pending, toggleOnline, kbSim, toggleKbSim } = useApp()
  return (
    <header className="topbar">
      <div className="brand">Phrontis <small>MOBILE</small></div>
      <div className="spacer" />
      <button className={'sync-pill' + (online ? '' : ' offline') + (syncing ? ' syncing' : '')} onClick={toggleOnline}>
        <span className="dot" />
        <span>{syncing ? '同步中…' : online ? '已连接电脑' : '离线模式'}</span>
        {pending.length > 0 && <span className="badge">{pending.length}</span>}
      </button>
      {/* 桌面 letterbox 专用：模拟输入法（真机触屏经 CSS 隐藏），验证键盘弹起时贴底控件上提 */}
      <button
        className={'icon-btn kb-sim-btn' + (kbSim ? ' on' : '')}
        onClick={toggleKbSim}
        title="模拟输入法（桌面专用）：验证键盘弹出时输入框上提"
      >
        <IKeyboard size={17} />
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
