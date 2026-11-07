import { useApp } from '../lib/store'
import { SidebarNotes } from './SidebarNotes'
import { fmtMoney, TODAY } from '../lib/data'
import { IBook, ICalendar, IChevL, IChevR, IGear, IQuiz, IPin, ISparkle, IWallet } from './icons'

/* 平板侧栏 v3（design.md §10.1）：域切换条 + 上下文内容独占。
 * 顶部一行域图标把导航压到 ~44px，侧栏主体全给当前域内容（笔记=文件树、AI=会话列表…）。
 * rail 收纳态域条转纵排图标列（rail 即域切换的纵排）。同步状态行收进设置页。 */
const DOMAINS: Array<{ id: string; title: string; icon: (p: { size?: number }) => React.ReactElement }> = [
  { id: 'notes', title: '笔记 · 阅读', icon: IBook },
  { id: 'ai', title: 'AI 助手', icon: ISparkle },
  { id: 'quiz', title: '错题本', icon: IQuiz },
  { id: 'schedule', title: '日程', icon: ICalendar },
  { id: 'ledger', title: '记账', icon: IWallet },
]

export function TabletChrome() {
  const {
    activeTab, setActiveTab, sideCollapsed, toggleSide,
    sessions, curSession, switchSession, quizRecords, todos, txs,
  } = useApp()
  const side = sideCollapsed ? ' min' : ''

  /* AI 域：会话列表（桌面同构：置顶在前，时间倒序） */
  const sortedSessions = [...sessions].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.ts - a.ts)
  /* 错题本域：书架（按来源分书，档位=最高错次） */
  const books = new Map<string, { count: number; unmastered: number; worst: number }>()
  for (const r of quizRecords) {
    const b = books.get(r.pageTitle) || { count: 0, unmastered: 0, worst: 0 }
    b.count++
    if (r.wrongCount > 0 && r.streakCorrect < 2) b.unmastered++
    b.worst = Math.max(b.worst, r.wrongCount)
    books.set(r.pageTitle, b)
  }
  /* 日程域：今日待办（未完成在前） */
  const todayTodos = todos.filter(t => t.date === TODAY).sort((a, b) => Number(a.done) - Number(b.done))
  /* 记账域：最近流水 */
  const recentTxs = [...txs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6)

  return (
    <aside className={'tb-side' + side}>
      <div className="side-top">
        <button className="tb-fold" onClick={toggleSide} title={sideCollapsed ? '展开侧栏' : '收起侧栏'}>
          {sideCollapsed ? <IChevR size={15} /> : <IChevL size={15} />}
        </button>
        <div className="tb-seg" role="tablist" aria-label="域切换">
          {DOMAINS.map(d => (
            <button
              key={d.id}
              className={'tb-seg-i' + (activeTab === d.id ? ' on' : '')}
              title={d.title}
              onClick={e => setActiveTab(d.id, e.currentTarget)}
            >
              <d.icon size={16} />
            </button>
          ))}
        </div>
      </div>

      {/* 域内容：独占侧栏主体，只有当前域渲染（rail 态整体隐藏） */}
      {!sideCollapsed && (
        <div className="tb-domain">
          {activeTab === 'notes' && <SidebarNotes />}
          {activeTab === 'ai' && (
            <div className="tb-domain-body">
              <div className="dom-title">会话 <span className="more">{sessions.length} 条 · 点击切换</span></div>
              <div className="tb-tree">
                {sortedSessions.map(s => (
                  <button key={s.id} className={'tb-row' + (curSession === s.id ? ' on' : '')} onClick={() => switchSession(s.id)}>
                    <span className="tb-row-t">{s.pinned && <IPin size={11} style={{ verticalAlign: '-1.5px', marginRight: 3 }} />}{s.title}</span>
                    <span className="tb-row-v">{new Date(s.ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</span>
                  </button>
                ))}
                {!sessions.length && <div className="tb-tree-empty">还没有会话</div>}
              </div>
            </div>
          )}
          {activeTab === 'quiz' && (
            <div className="tb-domain-body">
              <div className="dom-title">错题书架 <span className="more">{books.size} 本 · 点击进错题本</span></div>
              <div className="tb-tree">
                {[...books.entries()].map(([title, b]) => (
                  <button key={title} className="tb-row" onClick={e => setActiveTab('quiz', e.currentTarget)}>
                    <span className="tb-row-t">{title}</span>
                    <span className={'ph-tag ' + (b.worst >= 4 ? 'warn' : b.worst >= 2 ? 'mid' : 'ok')}>
                      {b.worst >= 4 ? '顽固' : b.worst >= 2 ? '中' : b.worst >= 1 ? '轻' : '未错'}
                    </span>
                    <span className="tb-row-v">{b.unmastered}/{b.count}</span>
                  </button>
                ))}
                {!books.size && <div className="tb-tree-empty">还没有错题——读带题卡的文档，作答后自动归档</div>}
              </div>
            </div>
          )}
          {activeTab === 'schedule' && (
            <div className="tb-domain-body">
              <div className="dom-title">今天 <span className="more">{todayTodos.filter(t => !t.done).length} 项待办 · 点击进日程</span></div>
              <div className="tb-tree">
                {todayTodos.map(t => (
                  <button key={t.id} className="tb-row" onClick={e => setActiveTab('schedule', e.currentTarget)}>
                    <span className={'ph-tag ' + (t.done ? 'ok' : '')}>{t.done ? '完成' : t.time}</span>
                    <span className="tb-row-t">{t.title}</span>
                  </button>
                ))}
                {!todayTodos.length && <div className="tb-tree-empty">今天还没有安排</div>}
              </div>
            </div>
          )}
          {activeTab === 'ledger' && (
            <div className="tb-domain-body">
              <div className="dom-title">最近流水 <span className="more">点击进记账</span></div>
              <div className="tb-tree">
                {recentTxs.map(t => (
                  <button key={t.id} className="tb-row" onClick={e => setActiveTab('ledger', e.currentTarget)}>
                    <span className="tb-row-t">{t.name}</span>
                    <span className="tb-row-v">¥{fmtMoney(t.amt)}</span>
                  </button>
                ))}
                {!recentTxs.length && <div className="tb-tree-empty">还没有流水</div>}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="tb-foot">
        <button
          className={'tb-item' + (activeTab === 'settings' ? ' on' : '')}
          title="设置"
          onClick={e => setActiveTab('settings', e.currentTarget)}
        >
          <IGear size={18} />
          <span className="tb-lb">设置</span>
        </button>
      </div>
    </aside>
  )
}
