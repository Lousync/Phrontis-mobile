import { useEffect, useRef, useState } from 'react'
import { ToggleButton, ToggleButtonGroup } from '@heroui/react'
import type { Habit, SchedView, Todo, TodoType } from '../../lib/types'
import { TODO_TYPE_LABEL, TODAY, dayIso, fmtMin, weekOf } from '../../lib/data'
import { burstAt } from '../../lib/fx'
import { useApp } from '../../lib/store'
import { useFormFactor } from '../../lib/useFormFactor'
import { IBell, ICheck, IChevL, IChevR, IDots, IPlus } from '../../components/icons'
import { FullPage, FullPageHead } from '../../components/FullPage'
import { PageHead } from '../../components/chrome'

/** 两笔对勾（逐段绘制用），待办与打卡共用 */
function CheckDraw({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size}>
      <path className="ck1" d="M5 12.5l4.5 4.5" />
      <path className="ck2" d="M9.5 17L19 7.5" />
    </svg>
  )
}

function TodoItem({ t, confirming, onAsk, onConfirm, onCancel }: {
  t: Todo
  confirming: boolean
  onAsk: (id: string) => void
  onConfirm: (id: string) => void
  onCancel: () => void
}) {
  const { toggleTodo } = useApp()
  /* 长按呼出删除确认（pointer 手势；滚动产生的 move 会自动取消，不误触） */
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const checkRef = useRef<HTMLButtonElement>(null)
  const armPress = () => {
    cancelPress()
    pressTimer.current = setTimeout(() => {
      pressTimer.current = null
      if (navigator.vibrate) navigator.vibrate(10)
      onAsk(t.id)
    }, 550)
  }
  const cancelPress = () => { if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null } }
  return (
    <div
      className={'todo-item' + (t.done ? ' done' : '')}
      onPointerDown={armPress}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onPointerMove={cancelPress}
      onContextMenu={e => { e.preventDefault(); onAsk(t.id) }}
    >
      <button
        ref={checkRef}
        className="todo-check"
        onClick={() => {
          /* 完成反馈组合拳：对勾逐笔绘制（CSS）+ 粒子迸发；撤销只反向绘制 */
          if (!t.done) burstAt(checkRef.current)
          toggleTodo(t.id)
        }}
      >
        <CheckDraw />
      </button>
      <div className="todo-body">
        {confirming ? (
          <div className="del-confirm">
            <span className="dc-q">删除「{t.title}」？</span>
            <button className="dc-btn dc-yes" onClick={() => onConfirm(t.id)}>删除</button>
            <button className="dc-btn dc-no" onClick={onCancel}>取消</button>
          </div>
        ) : (
          <>
            <div className="todo-title">{t.title}</div>
            <div className="todo-meta">
              <span className={'ph-tag ' + t.type}>{TODO_TYPE_LABEL[t.type]}</span>
              {/* 排期区间已带出开始时间时不再重复一个裸时间芯片（unslop 布局去重） */}
              {t.time && !(t.sched && fmtMin(t.sched.s) === t.time) && <span>{t.time}</span>}
              {t.sched && <span className="sched-chip">{fmtMin(t.sched.s)}–{fmtMin(t.sched.e)}</span>}
              {t.subTotal ? <span className="sub-chip"><ICheck size={11} /> {t.subDone}/{t.subTotal}</span> : null}
              <span>{t.tag}</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function renderTodoList(dayTodos: Todo[], delId: string | null, ask: (id: string) => void, confirm: (id: string) => void, cancel: () => void) {
  const top = dayTodos.filter(t => !t.parentId)
  const pending = top.filter(t => !t.done)
  const done = top.filter(t => t.done)
  const groups: Array<[TodoType, string, string]> = [['deadline', '截止', 'gc-deadline'], ['plan', '计划', 'gc-plan'], ['daily', '日常', 'gc-daily']]
  let html: React.ReactNode[] = []
  for (const [type, label, cls] of groups) {
    const items = pending.filter(t => t.type === type)
    if (!items.length) continue
    html.push(
      <div className="group-wrap" key={type}>
        <div className="group-head"><span className={'gn ' + cls}>{label}</span><span className="gline" /><span>{items.length}</span></div>
        <div className="ph-card" style={{ padding: '2px 14px' }}>
          {items.map(t => <TodoItem key={t.id} t={t} confirming={delId === t.id} onAsk={ask} onConfirm={confirm} onCancel={cancel} />)}
        </div>
      </div>,
    )
  }
  if (done.length) {
    html = html.concat(
      <div className="group-wrap" key="done">
        <div className="group-head"><span className="gn" style={{ color: 'var(--text-muted)' }}>已完成</span><span className="gline" /><span>{done.length}</span></div>
        <div className="ph-card" style={{ padding: '2px 14px' }}>
          {done.map(t => <TodoItem key={t.id} t={t} confirming={delId === t.id} onAsk={ask} onConfirm={confirm} onCancel={cancel} />)}
        </div>
      </div>,
    )
  }
  return html.length ? html : <div className="empty empty-spring">这一天没有待办</div>
}

function DayGrid({ dayTodos }: { dayTodos: Todo[] }) {
  const { toast } = useApp()
  const START = 8 * 60, END = 23 * 60, H = 46
  const blocks = dayTodos.filter(t => t.sched && !t.parentId)
  const hours: number[] = []
  for (let m = START; m <= END; m += 60) hours.push(m)
  const colorOf = (t: Todo) => t.type === 'deadline' ? 'var(--red)' : t.type === 'daily' ? 'var(--green)' : 'var(--blue)'
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const showNow = dayTodos.length > 0 && nowMin >= START && nowMin <= END && dayTodos.some(t => t.date === TODAY)
  return (
    <div className="day-grid" style={{ height: ((END - START) / 60) * H + 14 }}>
      {hours.map((m, i) => {
        const top = ((m - START) / 60) * H + 12
        /* 小时线逐段画出：横向 staggered */
        const delay = { animationDelay: i * 28 + 'ms' }
        return (
          <div key={m}>
            <div className="hour-row" style={{ top, ...delay }} />
            <div className="hour-label" style={{ top, ...delay }}>{fmtMin(m)}</div>
          </div>
        )
      })}
      {blocks.map((t, i) => {
        const top = ((t.sched!.s - START) / 60) * H + 12
        const h = Math.max(28, ((t.sched!.e - t.sched!.s) / 60) * H - 4)
        const c = colorOf(t)
        return (
          <div key={t.id} className={'gblock' + (t.done ? ' done' : '')}
            style={{ top, height: h, borderLeftColor: c, background: `color-mix(in srgb, ${c} 13%, transparent)`, animationDelay: 240 + i * 45 + 'ms' }}
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
  const { toggleHabit, openHabitForm } = useApp()
  const btnRef = useRef<HTMLButtonElement>(null)
  /* 今天按真实星期几定位（hist 是周一…周日索引）——旧实现硬编码 hist[5]，一周里 6 天都看错 */
  const todayIdx = (new Date().getDay() + 6) % 7
  const doneToday = !!h.hist[todayIdx]
  const pct = Math.min(100, h.weekDone / h.target * 100)
  const WD = ['一', '二', '三', '四', '五', '六', '日']
  return (
    <div className="ph-card habit-card" style={{ ['--hc' as string]: h.color }}>
      <div className="habit-top">
        <div className="habit-dot" style={{ background: `color-mix(in srgb, ${h.color} 15%, transparent)`, color: h.color }}>{h.char}</div>
        <div className="habit-name">{h.name}</div>
        {h.remind != null && <span className="habit-remind"><IBell size={11} />每天 {fmtMin(h.remind)}</span>}
        <div className="habit-streak">连续 {h.streak} 天</div>
        <button className="habit-edit" aria-label="编辑习惯" onClick={e => { e.stopPropagation(); openHabitForm(h.id, e.currentTarget) }}>
          <IDots size={14} />
        </button>
      </div>
      <div className="hdots">
        {WD.map((wd, i) => {
          const cls = i > todayIdx ? 'future' : i === todayIdx ? (doneToday ? 'today-done' : 'today-pending') : (h.hist[i] ? 'done' : '')
          return <div key={wd} className={'hday ' + cls}><div className="hl">{wd}</div><div className="hdot" /></div>
        })}
      </div>
      <div className="habit-foot">
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)', flex: 'none' }}>本周 {h.weekDone}/{h.target}</span>
        <div className="habit-prog"><span className="fill" style={{ width: pct + '%', background: h.color }} /></div>
        <button
          ref={btnRef}
          className={'habit-btn' + (doneToday ? ' done' : '')}
          onClick={() => { if (!doneToday) burstAt(btnRef.current); toggleHabit(h.id) }}
        >
          <CheckDraw size={15} />
        </button>
      </div>
    </div>
  )
}

function TodoSheet({ selDate }: { selDate: string }) {
  const { closeSheet, addTodo } = useApp()
  const [title, setTitle] = useState('')
  const [type, setType] = useState<TodoType>('plan')
  const [time, setTime] = useState('')
  const [date, setDate] = useState(selDate)
  const save = () => {
    if (!title.trim()) return
    addTodo({ title: title.trim(), type, time, date })
    closeSheet()
  }
  return (
    <FullPage>
      <FullPageHead title="添加待办" />
      <div className="fp-body">
      <div className="field"><label>标题</label><input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="要做什么？" onKeyDown={e => { if (e.key === 'Enter') save() }} /></div>
      <ToggleButtonGroup
        aria-label="待办类型"
        size="sm"
        fullWidth
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={new Set([type])}
        onSelectionChange={keys => { const k = [...keys][0]; if (k) setType(k as TodoType) }}
        style={{ marginBottom: 14 }}
      >
        {(['plan', 'deadline', 'daily'] as TodoType[]).map(t => (
          <ToggleButton key={t} id={t}>{TODO_TYPE_LABEL[t]}</ToggleButton>
        ))}
      </ToggleButtonGroup>
      <div className="field"><label>日期</label><input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
      <div className="field"><label>时间（可选）</label><input type="time" value={time} onChange={e => setTime(e.target.value)} /></div>
      <button className="btn-primary" onClick={save}>保存到手机</button>
      </div>
    </FullPage>
  )
}

/**
 * 习惯增改子页（2026-11-08 打卡提醒落地）：无 editHabitId = 新增；带 id = 编辑（含行内删除确认）。
 * 提醒时间用原生 <input type=time>（WebView 弹系统时间选择器），留空 = 不提醒；
 * 到点排本地通知（原生壳内），当天已打卡的槽在重排时丢弃，不会「打完卡还催」。
 */
function HabitForm() {
  const { closeSheet, habits, editHabitId, addHabit, updateHabit, deleteHabit } = useApp()
  const editing = editHabitId ? habits.find(h => h.id === editHabitId) : undefined
  const [name, setName] = useState(editing?.name ?? '')
  const [target, setTarget] = useState(String(editing?.target ?? 7))
  const [remind, setRemind] = useState(editing?.remind != null ? fmtMin(editing.remind) : '')
  const [delConfirm, setDelConfirm] = useState(false)
  const save = () => {
    if (!name.trim()) return
    let remindMin: number | undefined
    const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(remind.trim())
    if (m) remindMin = Number(m[1]) * 60 + Number(m[2])
    if (editing) updateHabit(editing.id, { name, target: Number(target), remind: remindMin ?? null })
    else addHabit({ name, target: Number(target) || 7, remind: remindMin })
    closeSheet()
  }
  return (
    <FullPage>
      <FullPageHead title={editing ? '编辑习惯' : '添加习惯'} />
      <div className="fp-body">
        <div className="field"><label>名称</label><input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="比如：背单词" onKeyDown={e => { if (e.key === 'Enter') save() }} /></div>
        <div className="field"><label>每周目标（天）</label><input className="mono" type="number" inputMode="numeric" min={1} max={7} value={target} onChange={e => setTarget(e.target.value)} /></div>
        <div className="field">
          <label>每天提醒（可选）</label>
          <div className="remind-row">
            <input type="time" value={remind} onChange={e => setRemind(e.target.value)} />
            {remind && <button className="btn-ghost" onClick={() => setRemind('')}>清除</button>}
          </div>
          <div className="model-cnt">到点发本地通知提醒打卡；当天已打卡就不再提醒。通知权限在「设置 → 工具」查看。</div>
        </div>
        {editing && (
          <div className="field" style={{ marginTop: 6 }}>
            {!delConfirm ? (
              <button className="btn-ghost del-habit-btn" onClick={() => setDelConfirm(true)}>删除这个习惯</button>
            ) : (
              <div className="del-confirm">
                <span className="dc-q">删除「{editing.name}」？打卡历史一并清除。</span>
                <button className="dc-btn dc-yes" onClick={() => { deleteHabit(editing.id); closeSheet() }}>删除</button>
                <button className="dc-btn dc-no" onClick={() => setDelConfirm(false)}>取消</button>
              </div>
            )}
          </div>
        )}
        <button className="btn-primary" onClick={save}>{editing ? '保存' : '保存到手机'}</button>
      </div>
    </FullPage>
  )
}

/* 平板快捷添加面板（真机反馈 2026-11-06：通栏输入条改按钮 + 就地浮起，内联展开非抽屉）。
 * 日期随当前选中日；Enter 添加 / Esc 收起 / 点外部收起。 */
function QuickTodoAdd({ selDate, onClose }: { selDate: string; onClose: () => void }) {
  const { addTodo, toast } = useApp()
  const [title, setTitle] = useState('')
  const [type, setType] = useState<TodoType>('plan')
  const [time, setTime] = useState('')
  const save = () => {
    if (!title.trim()) { toast('先写要做什么', 'warn'); return }
    addTodo({ title: title.trim(), type, time, date: selDate })
    onClose()
  }
  /* 点面板与圆钮之外收起 */
  useEffect(() => {
    const h = (e: PointerEvent) => {
      const t = e.target as HTMLElement
      if (!t.closest('.tb-quick-add') && !t.closest('.tb-add')) onClose()
    }
    document.addEventListener('pointerdown', h)
    return () => document.removeEventListener('pointerdown', h)
  }, [onClose])
  return (
    <div className="tb-quick-add">
      <div className="qa-row">
        <input
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="要做什么？"
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onClose() }}
        />
        <button className="btn-primary qa-go" onClick={save}>添加</button>
      </div>
      <ToggleButtonGroup
        aria-label="待办类型"
        size="sm"
        fullWidth
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={new Set([type])}
        onSelectionChange={keys => { const k = [...keys][0]; if (k) setType(k as TodoType) }}
        style={{ marginBottom: 14 }}
      >
        {(['plan', 'deadline', 'daily'] as TodoType[]).map(t => (
          <ToggleButton key={t} id={t}>{TODO_TYPE_LABEL[t]}</ToggleButton>
        ))}
      </ToggleButtonGroup>
      <div className="qa-row">
        <input type="time" value={time} onChange={e => setTime(e.target.value)} />
        <span className="qa-hint">记到 {selDate === TODAY ? '今天' : selDate} · Enter 添加</span>
      </div>
    </div>
  )
}

export function SchedulePage({ active }: { active: boolean }) {
  const { todos, habits, selDate, setSelDate, schedView, setSchedView, openSheet, deleteTodo, openHabitForm, paired, fullResync } = useApp()
  const tablet = useFormFactor() === 'tablet'
  const [delId, setDelId] = useState<string | null>(null)
  const [quickAdd, setQuickAdd] = useState(false)
  const [weekOff, setWeekOff] = useState(0)
  const dayTodos = todos.filter(t => t.date === selDate)
  const visibleHabits = habits.filter(h => !h.archived)
  const totalN = dayTodos.filter(t => !t.parentId).length
  const doneN = dayTodos.filter(t => t.done && !t.parentId).length
  const full = totalN > 0 && doneN === totalN
  const frac = totalN ? doneN / totalN : 0
  const week = weekOf(weekOff)
  /* 日期头按真实日期渲染；星期从 selDate 自身算——翻周后选中日不在当前周条里 */
  const selD = new Date(selDate + 'T00:00:00')
  const wd = '一二三四五六日'[(selD.getDay() + 6) % 7]
  const dn = (selD.getMonth() + 1) + '月' + selD.getDate() + '日'
  const rel = selDate === TODAY ? ' · 今天' : selDate === dayIso(1) ? ' · 明天' : ''

  return (
    <section className={'page' + (active ? ' active' : '') + (full ? ' all-done' : '')}>
      <PageHead title={dn} sub={'周' + wd + rel}>
        <span className={'todo-ring' + (full ? ' full' : '')}>
          <svg width={30} height={30}>
            <circle className="rbg" cx={15} cy={15} r={12} />
            <circle className="rfg" cx={15} cy={15} r={12} style={{ strokeDashoffset: 75.4 * (1 - frac) }} />
          </svg>
          <span className="rtx">
            <span className="roll">
              <span className="roll-col" style={{ transform: `translateY(-${doneN * 12}px)` }}>
                {Array.from({ length: totalN + 1 }, (_, i) => <b key={i}>{i}</b>)}
              </span>
            </span>
            /{totalN}
          </span>
        </span>
      </PageHead>
      <div className={'progress-track' + (full ? ' ok' : '')}><div className="progress-fill" style={{ width: frac * 100 + '%' }} /></div>

      <div className="week-strip">
        <button className="month-arrow wk-arrow" title="上一周" onClick={() => setWeekOff(o => o - 1)}><IChevL size={13} /></button>
        {week.map(x => {
          const cls = ['wday', x.iso === selDate ? 'sel' : '', x.iso < TODAY ? 'past' : '', x.iso === TODAY ? 'today-mark' : '', todos.some(t => t.date === x.iso) ? 'has' : ''].join(' ')
          return (
            <button key={x.iso} className={cls} onClick={() => setSelDate(x.iso)}>
              <div className="wd">{x.wd}</div><div className="dn">{x.n}</div><div className="dd" />
            </button>
          )
        })}
        <button className="month-arrow wk-arrow" title="下一周" onClick={() => setWeekOff(o => o + 1)}><IChevR size={13} /></button>
      </div>
      {weekOff !== 0 && (
        <button className="today-jump" onClick={() => { setWeekOff(0); setSelDate(TODAY) }}>回到今天</button>
      )}

      <ToggleButtonGroup
        aria-label="视图切换"
        size="sm"
        fullWidth
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={new Set([schedView])}
        onSelectionChange={keys => { const k = [...keys][0]; if (k) setSchedView(k as SchedView) }}
      >
        {([['list', '待办'], ['grid', '排期'], ['habit', '打卡']] as const).map(([v, label]) => (
          <ToggleButton key={v} id={v}>{label}</ToggleButton>
        ))}
      </ToggleButtonGroup>

      {schedView === 'list' && renderTodoList(
        dayTodos,
        delId,
        id => setDelId(id),
        id => { deleteTodo(id); setDelId(null) },
        () => setDelId(null),
      )}
      {schedView === 'list' && todos.length === 0 && paired && (
        <div className="ph-card" style={{ padding: 14, marginTop: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>手机本地还没有日程</div>
          <div className="model-cnt" style={{ marginTop: 4 }}>
            可能上次同步的游标已经推到电脑时间之后，更旧的条目就拉不回来了。点下面从电脑全量重拉一次。
          </div>
          <button className="btn-primary" style={{ marginTop: 10 }} onClick={fullResync}>从电脑全量拉取</button>
        </div>
      )}
      {schedView === 'grid' && <DayGrid key={selDate} dayTodos={dayTodos} />}
      {schedView === 'habit' && (visibleHabits.length
        ? visibleHabits.map(h => <HabitCard key={h.id} h={h} />)
        : <div className="empty empty-spring">还没有打卡习惯</div>)}

      {schedView === 'list' && !tablet && (
        <button className="add-bar" onClick={e => openSheet('todo', e.currentTarget)}>
          <IPlus />添加待办
        </button>
      )}
      {schedView === 'habit' && !tablet && (
        <button className="add-bar" onClick={e => openHabitForm(undefined, e.currentTarget)}>
          <IPlus />添加习惯
        </button>
      )}
      {schedView === 'habit' && tablet && (
        <button className="tb-add" onClick={e => openHabitForm(undefined, e.currentTarget)} title="添加习惯">
          <IPlus size={20} />
        </button>
      )}
      {schedView === 'list' && tablet && (
        <>
          {quickAdd && <QuickTodoAdd selDate={selDate} onClose={() => setQuickAdd(false)} />}
          <button
            className={'tb-add' + (quickAdd ? ' open' : '')}
            onClick={() => setQuickAdd(v => !v)}
            title={quickAdd ? '收起' : '新建待办'}
          >
            <IPlus size={20} />
          </button>
        </>
      )}
    </section>
  )
}

export { TodoSheet, HabitForm }
