import { useState } from 'react'
import type { Habit, Todo, TodoType } from '../../lib/types'
import { TODO_TYPE_LABEL, TODAY, WEEK, fmtMin } from '../../lib/data'
import { useApp } from '../../lib/store'
import { ICheck, IPlus } from '../../components/icons'
import { Grip, Sheet } from '../../components/Sheet'

function TodoItem({ t }: { t: Todo }) {
  const { toggleTodo } = useApp()
  return (
    <div className={'todo-item' + (t.done ? ' done' : '')}>
      <button className="todo-check" onClick={() => toggleTodo(t.id)}><ICheck /></button>
      <div className="todo-body">
        <div className="todo-title">{t.title}</div>
        <div className="todo-meta">
          <span className={'tag ' + t.type}>{TODO_TYPE_LABEL[t.type]}</span>
          {t.time && <span>{t.time}</span>}
          {t.sched && <span className="sched-chip">{fmtMin(t.sched.s)}–{fmtMin(t.sched.e)}</span>}
          {t.subTotal ? <span className="sub-chip">☑ {t.subDone}/{t.subTotal}</span> : null}
          <span>{t.tag}</span>
        </div>
      </div>
    </div>
  )
}

function renderTodoList(dayTodos: Todo[]) {
  const pending = dayTodos.filter(t => !t.done)
  const done = dayTodos.filter(t => t.done)
  const groups: Array<[TodoType, string, string]> = [['deadline', '截止', 'gc-deadline'], ['plan', '计划', 'gc-plan'], ['daily', '日常', 'gc-daily']]
  let html: React.ReactNode[] = []
  for (const [type, label, cls] of groups) {
    const items = pending.filter(t => t.type === type)
    if (!items.length) continue
    html.push(
      <div className="group-wrap" key={type}>
        <div className="group-head"><span className={'gn ' + cls}>{label}</span><span className="gline" /><span>{items.length}</span></div>
        <div className="card" style={{ padding: '2px 14px' }}>{items.map(t => <TodoItem key={t.id} t={t} />)}</div>
      </div>,
    )
  }
  if (done.length) {
    html = html.concat(
      <div className="group-wrap" key="done">
        <div className="group-head"><span className="gn" style={{ color: 'var(--text-muted)' }}>已完成</span><span className="gline" /><span>{done.length}</span></div>
        <div className="card" style={{ padding: '2px 14px' }}>{done.map(t => <TodoItem key={t.id} t={t} />)}</div>
      </div>,
    )
  }
  return html.length ? html : <div className="empty">这一天没有待办</div>
}

function DayGrid({ dayTodos }: { dayTodos: Todo[] }) {
  const { toast } = useApp()
  const START = 8 * 60, END = 23 * 60, H = 46
  const blocks = dayTodos.filter(t => t.sched)
  const hours: number[] = []
  for (let m = START; m <= END; m += 60) hours.push(m)
  const colorOf = (t: Todo) => t.type === 'deadline' ? 'var(--red)' : t.type === 'daily' ? 'var(--green)' : 'var(--blue)'
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const showNow = dayTodos.length > 0 && nowMin >= START && nowMin <= END && dayTodos.some(t => t.date === TODAY)
  return (
    <div className="day-grid" style={{ height: ((END - START) / 60) * H + 14 }}>
      {hours.map(m => {
        const top = ((m - START) / 60) * H + 12
        return (
          <div key={m}>
            <div className="hour-row" style={{ top }} />
            <div className="hour-label" style={{ top }}>{fmtMin(m)}</div>
          </div>
        )
      })}
      {blocks.map(t => {
        const top = ((t.sched!.s - START) / 60) * H + 12
        const h = Math.max(28, ((t.sched!.e - t.sched!.s) / 60) * H - 4)
        const c = colorOf(t)
        return (
          <div key={t.id} className={'gblock' + (t.done ? ' done' : '')}
            style={{ top, height: h, borderLeftColor: c, background: `color-mix(in srgb, ${c} 13%, transparent)` }}
            onClick={() => toast(t.title + ' ' + fmtMin(t.sched!.s) + '–' + fmtMin(t.sched!.e), 'info')}>
            <span className="gt">{t.title}</span>
            <span className="gm" style={{ color: c }}>{fmtMin(t.sched!.s)}–{fmtMin(t.sched!.e)}{t.done ? ' · 已完成' : ''}</span>
          </div>
        )
      })}
      {showNow && <div className="now-line" style={{ top: ((nowMin - START) / 60) * H + 12 }} />}
      {!blocks.length && <div className="empty" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>这一天没有排期</div>}
    </div>
  )
}

function HabitCard({ h }: { h: Habit }) {
  const { toggleHabit } = useApp()
  const doneToday = !!h.hist[5]
  const pct = Math.min(100, h.weekDone / h.target * 100)
  const WD = ['一', '二', '三', '四', '五', '六', '日']
  return (
    <div className="card habit-card" style={{ ['--hc' as string]: h.color }}>
      <div className="habit-top">
        <div className="habit-dot" style={{ background: `color-mix(in srgb, ${h.color} 15%, transparent)`, color: h.color }}>{h.char}</div>
        <div className="habit-name">{h.name}</div>
        <div className="habit-streak">连续 {h.streak} 天</div>
      </div>
      <div className="hdots">
        {WD.map((wd, i) => {
          const cls = i === 6 ? 'future' : i === 5 ? (doneToday ? 'today-done' : 'today-pending') : (h.hist[i] ? 'done' : '')
          return <div key={wd} className={'hday ' + cls}><div className="hl">{wd}</div><div className="hdot" /></div>
        })}
      </div>
      <div className="habit-foot">
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)', flex: 'none' }}>本周 {h.weekDone}/{h.target}</span>
        <div className="habit-prog"><span className="fill" style={{ width: pct + '%', background: h.color }} /></div>
        <button className={'habit-btn' + (doneToday ? ' done' : '')} onClick={() => toggleHabit(h.id)}><ICheck size={14} /></button>
      </div>
    </div>
  )
}

function TodoSheet() {
  const { closeSheet, addTodo } = useApp()
  const [title, setTitle] = useState('')
  const [type, setType] = useState<TodoType>('plan')
  const [time, setTime] = useState('')
  const save = () => {
    if (!title.trim()) return
    addTodo({ title: title.trim(), type, time })
    closeSheet()
  }
  return (
    <Sheet>
      <Grip />
      <h3>添加待办</h3>
      <div className="field"><label>标题</label><input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="要做什么？" onKeyDown={e => { if (e.key === 'Enter') save() }} /></div>
      <div className="seg">
        {(['plan', 'deadline', 'daily'] as TodoType[]).map(t => (
          <button key={t} className={type === t ? 'on' : ''} onClick={() => setType(t)}>{TODO_TYPE_LABEL[t]}</button>
        ))}
      </div>
      <div className="field"><label>时间（可选）</label><input type="time" value={time} onChange={e => setTime(e.target.value)} /></div>
      <button className="btn-primary" onClick={save}>保存到手机</button>
    </Sheet>
  )
}

export function SchedulePage({ active }: { active: boolean }) {
  const { todos, habits, selDate, setSelDate, schedView, setSchedView, openSheet } = useApp()
  const dayTodos = todos.filter(t => t.date === selDate)
  const doneN = dayTodos.filter(t => t.done).length
  const w = WEEK.find(x => x.iso === selDate)!
  const dn = selDate === TODAY ? '10月31日' : w.n + '月' + w.n + '日'
  const rel = selDate === TODAY ? ' · 今天' : selDate === '2026-11-01' ? ' · 明天' : ''

  return (
    <section className={'page' + (active ? ' active' : '')}>
      <div className="date-head">
        <span className="d">{dn}</span><span className="w">周{w.wd}{rel}</span>
        <span className="progress">{dayTodos.length ? '已完成 ' + doneN + '/' + dayTodos.length : ''}</span>
      </div>
      <div className="progress-track"><div className="progress-fill" style={{ width: (dayTodos.length ? doneN / dayTodos.length * 100 : 0) + '%' }} /></div>

      <div className="week-strip">
        {WEEK.map(x => {
          const cls = ['wday', x.iso === selDate ? 'sel' : '', x.iso < TODAY ? 'past' : '', x.iso === TODAY ? 'today-mark' : '', todos.some(t => t.date === x.iso) ? 'has' : ''].join(' ')
          return (
            <button key={x.iso} className={cls} onClick={() => setSelDate(x.iso)}>
              <div className="wd">{x.wd}</div><div className="dn">{x.n}</div><div className="dd" />
            </button>
          )
        })}
      </div>

      <div className="view-seg">
        {(['list', 'grid', 'habit'] as const).map(v => (
          <button key={v} className={schedView === v ? 'on' : ''} onClick={() => setSchedView(v)}>
            {v === 'list' ? '待办' : v === 'grid' ? '排期' : '打卡'}
          </button>
        ))}
      </div>

      {schedView === 'list' && renderTodoList(dayTodos)}
      {schedView === 'grid' && <DayGrid dayTodos={dayTodos} />}
      {schedView === 'habit' && habits.map(h => <HabitCard key={h.id} h={h} />)}

      {schedView === 'list' && (
        <button className="add-bar" onClick={() => openSheet('todo')}>
          <IPlus />添加待办
        </button>
      )}
    </section>
  )
}

export { TodoSheet }
