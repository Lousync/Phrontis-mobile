import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { useApp } from '../lib/store'
import { IBook, ICalendar, IChevL, IGear, ISparkle, IWallet } from './icons'

/* 底栏 5 目的地（M3 ≤5 规范）：用量是低频查看页，降级为「设置 → 工具」二级入口 */
const TABS: Array<{ id: string; label: string; icon: (p: { size?: number }) => React.ReactElement }> = [
  { id: 'ai', label: 'AI', icon: ISparkle },
  { id: 'schedule', label: '日程', icon: ICalendar },
  { id: 'ledger', label: '记账', icon: IWallet },
  { id: 'notes', label: '笔记', icon: IBook },
  { id: 'settings', label: '设置', icon: IGear },
]

/** 页面大标题（含非页签页：用量走二级入口，小顶栏同样要显示它的名字） */
const PAGE_TITLES: Record<string, string> = {
  ai: 'AI 助手', schedule: '日程', ledger: '记账', notes: '笔记', quiz: '错题本', usage: 'AI 用量', settings: '设置',
}

/** 标题下元信息行（备忘录式）：同步状态进排版，不再做漂浮胶囊；异常态变色 */
export function SyncMeta() {
  const { online, syncing, pending, paired, lastSync, setActiveTab } = useApp()
  if (syncing) return <div className="c-meta"><span className="c-mdot sync" />正在对账…</div>
  if (!paired) return (
    <button className="c-meta unp" onClick={e => setActiveTab('settings', e.currentTarget)} title="去设置页配对电脑">
      <span className="c-mdot" />未配对电脑 · 点此去设置
    </button>
  )
  if (!online) return <div className="c-meta off"><span className="c-mdot" />电脑离线 · 数据照常记在本机</div>
  if (pending.length) return <div className="c-meta warn"><span className="c-mdot" />待同步 {pending.length} 条 · 联网后自动重试</div>
  return <div className="c-meta"><span className="c-mdot" />已连接 {paired.pcName} · 上次同步 {lastSync}</div>
}

/**
 * 大标题页头（定稿 C，参考苹果备忘录）：标题行 + 可选行内控件，元信息行自动换到标题下。
 * onBack：二级页面（用量）返回上一页。
 */
export function PageHead({ title, sub, children, onBack }: {
  title: ReactNode
  sub?: ReactNode
  children?: ReactNode
  onBack?: () => void
}) {
  return (
    <div className="pg-head">
      {onBack && <button className="icon-btn pg-back" onClick={onBack} title="返回设置"><IChevL size={17} /></button>}
      <span className="t">{title}</span>
      {sub != null && <span className="sub">{sub}</span>}
      {children}
      <SyncMeta />
    </div>
  )
}

/**
 * 壳层 chrome：收拢顶栏（滚动 >46px 淡入）+ 常驻浮坞（5 页签）+ 桌面键盘模拟按钮。
 * 浮坞不再随滚动收缩（2026-11-06 用户拍板）：收缩后只剩当前页一个胶囊，底部反而空出一大片，
 * 且「下滚收起 / 上滑展开」的操作预期很难猜。现在恒定展开，5 个页签一直在。
 * 滚动监听走捕获：scroll 不冒泡，一个监听器接住所有页面/聊天区的滚动，只认当前激活页。
 */
export function ShellChrome() {
  const { activeTab, setActiveTab } = useApp()
  const barRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const onScroll = (e: Event) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      const isActivePage = t.classList.contains('page') && t.classList.contains('active')
      /* AI 页的滚动区是内层 .chat（composer 常驻），也参与顶栏淡入 */
      if (!isActivePage && !t.classList.contains('chat')) return
      if (isActivePage) barRef.current?.classList.toggle('on', t.scrollTop > 46)
    }
    document.addEventListener('scroll', onScroll, true)
    return () => document.removeEventListener('scroll', onScroll, true)
  }, [])

  /* 切页复位：新页从顶部开始，收拢态不跟随 */
  useEffect(() => {
    barRef.current?.classList.remove('on')
  }, [activeTab])

  return (
    <>
      <header ref={barRef} className="c-bar"><span className="c-t">{PAGE_TITLES[activeTab] ?? ''}</span></header>
      <nav className="dock" aria-label="主导航">
        {TABS.map(t => (
          <button
            key={t.id}
            className={activeTab === t.id ? 'on' : ''}
            onClick={e => {
              if (activeTab === t.id) return
              setActiveTab(t.id, e.currentTarget)
            }}
          >
            <t.icon />
            <span className="dk-lb">{t.label}</span>
          </button>
        ))}
      </nav>
    </>
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
