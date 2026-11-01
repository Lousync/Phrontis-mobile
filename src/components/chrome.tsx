import { useApp } from '../lib/store'
import { IBars, IBook, ICalendar, IGear, IKeyboard, ISparkle, IWallet } from './icons'

export function TopBar() {
  const { online, syncing, pending, paired, toggleOnline, setActiveTab, kbSim, toggleKbSim } = useApp()
  /* 未配对时不谎报「已连接」：胶囊只显示真实状态，点了引导去设置页配对 */
  const label = syncing ? '同步中…' : paired ? (online ? '已连接电脑' : '离线模式') : '未配对'
  const cls = paired ? (online ? '' : ' offline') : ' unpaired'
  return (
    <header className="topbar">
      <div className="brand">Phrontis <small>MOBILE</small></div>
      <div className="spacer" />
      <button
        className={'sync-pill' + cls + (syncing ? ' syncing' : '')}
        onClick={() => { if (paired) toggleOnline(); else setActiveTab('settings') }}
        title={paired ? undefined : '去设置页配对电脑'}
      >
        <span className="dot" />
        <span>{label}</span>
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
