import { useEffect, useRef, useState } from 'react'
import type { Msg, NoteProposal, QuizAddProposal, QuizDelProposal, QuizNoteProposal, Session, TodoProposal, TxProposal } from '../../lib/types'
import { fmtMoney, mdRender, sessGroupKey, TODO_TYPE_LABEL } from '../../lib/data'
import { useApp } from '../../lib/store'
import { ICheck, IHistory, IMic, ISearch, ISend, ISparkle, IPlus, IDots, IStop, IChevR } from '../icons'
import { FullPage, FullPageHead } from '../FullPage'
import { PageHead } from '../chrome'

const TODO_DOT: Record<string, string> = { deadline: 'var(--red)', plan: 'var(--blue)', daily: 'var(--green)' }

/** AI 确认卡：tx/todo/note 用真实提案数据；move 是未配置 AI 时的演示卡 */
function ActionCard({ m }: { m: Msg }) {
  const { confirmCard, dismissCard } = useApp()
  const c = m.card
  if (!c) return null
  const confirmed = !!c.confirmed
  const d = c.data
  const head = c.kind === 'tx' ? 'AI 操作 · 记账'
    : c.kind === 'todo' ? 'AI 操作 · 加待办'
    : c.kind === 'note' ? 'AI 操作 · 记笔记'
    : c.kind === 'quiz' ? 'AI 操作 · 出题入库'
    : c.kind === 'quiz-note' ? 'AI 操作 · 错题备注'
    : c.kind === 'quiz-del' ? 'AI 操作 · 移出错题'
    : 'AI 操作 · 改日程'
  let okLabel = '确认'
  let doneLabel = '已完成'
  let body: React.ReactNode
  if (c.kind === 'tx' && d && 'amount' in d) {
    const p = d as TxProposal
    okLabel = '确认入账'
    doneLabel = '已入账'
    body = (
      <>
        <div className="ac-row"><span className="ac-amt">¥{fmtMoney(p.amount)}</span><span className="ac-meta">{p.type === 'expense' ? '支出' : '收入'} · {p.category} · {p.merchant}</span></div>
        <div className="ac-row" style={{ marginTop: 4 }}><span className="ac-meta">账户：{p.account} · 今天</span></div>
      </>
    )
  } else if (c.kind === 'todo' && d && 'title' in d) {
    const p = d as TodoProposal
    okLabel = '确认添加'
    doneLabel = '已添加'
    body = (
      <>
        <div className="ac-row"><span className="ac-amt" style={{ fontSize: 17 }}>{p.title}</span><span className="ac-meta">{p.date}</span></div>
        <div className="ac-row" style={{ marginTop: 4 }}><span className="ac-meta">类型：{TODO_TYPE_LABEL[p.type]}</span></div>
      </>
    )
  } else if (c.kind === 'quiz' && d && 'question' in d) {
    const p = d as QuizAddProposal
    okLabel = '确认入库'
    doneLabel = '已入库'
    body = (
      <>
        <div className="ac-row"><span className="ac-amt" style={{ fontSize: 16 }}>{p.question}</span></div>
        <div className="ac-row" style={{ marginTop: 4 }}>
          <span className="ac-meta">
            {p.pageTitle} · {p.type === 'short' ? '简答' : '选择题 ' + p.options.map(o => o.key).join('/') } · 答案 {p.answer}
          </span>
        </div>
        {p.explanation && <div className="ac-row" style={{ marginTop: 4 }}><span className="ac-meta">解析：{p.explanation.slice(0, 120)}</span></div>}
      </>
    )
  } else if (c.kind === 'quiz-note' && d && 'note' in d) {
    const p = d as QuizNoteProposal
    okLabel = '确认备注'
    doneLabel = '已备注'
    body = (
      <>
        <div className="ac-row"><span className="ac-amt" style={{ fontSize: 16 }}>{p.pageTitle} · 第 {p.no} 题</span></div>
        <div className="ac-row" style={{ marginTop: 4 }}><span className="ac-meta" style={{ whiteSpace: 'pre-wrap' }}>{p.note}</span></div>
      </>
    )
  } else if (c.kind === 'quiz-del' && d && 'no' in d) {
    const p = d as QuizDelProposal
    okLabel = '确认移出'
    doneLabel = '已移出'
    body = (
      <>
        <div className="ac-row"><span className="ac-amt" style={{ fontSize: 16 }}>{p.pageTitle} · 第 {p.no} 题</span></div>
        <div className="ac-row" style={{ marginTop: 4 }}><span className="ac-meta">移出错题本（记录删除，不可恢复）</span></div>
      </>
    )
  } else if (c.kind === 'note' && d && 'body' in d) {
    const p = d as NoteProposal
    okLabel = '确认上行'
    doneLabel = '已上行'
    body = (
      <>
        <div className="ac-row"><span className="ac-amt" style={{ fontSize: 17 }}>{p.title || '（无标题闪念）'}</span></div>
        <div className="ac-row" style={{ marginTop: 4 }}><span className="ac-meta" style={{ whiteSpace: 'pre-wrap' }}>{p.body.slice(0, 140)}</span></div>
      </>
    )
  } else {
    okLabel = '确认改期'
    doneLabel = '已改期'
    body = (
      <>
        <div className="ac-row"><span className="ac-amt" style={{ fontSize: 17 }}>跑步 30 分钟</span><span className="ac-meta">今天 19:00</span></div>
        <div className="ac-row" style={{ marginTop: 4 }}><span className="ac-meta">改为</span><span className="ac-meta" style={{ color: 'var(--accent-hover)', fontWeight: 600 }}>明天 19:30</span></div>
      </>
    )
  }
  return (
    <div className={'action-card' + (confirmed ? ' confirmed' : '')}>
      <div className="ac-head"><ISparkle size={12} />{head}</div>
      {body}
      {!confirmed && (
        <div className="ac-btns">
          <button className="ok" onClick={() => confirmCard(m.id, c.kind)}>{okLabel}</button>
          <button className="no" onClick={() => dismissCard(m.id)}>改一改</button>
        </div>
      )}
      {confirmed && <div className="ac-state"><ICheck size={12} />{doneLabel} · 待同步进电脑</div>}
    </div>
  )
}

/**
 * 思考痕迹：一行折叠 + 左细线展开体（观感对齐桌面 `.kb-think`）。
 * 只在手机直连档、且模型确实返回了 reasoning 时出现；默认收起——思考不是答案，不该抢正文。
 * 展开是页内内联展开，不弹层（符合项目 UI 规范）。
 */
function ThinkBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={'think' + (open ? ' open' : '')}>
      <button className="think-head" onClick={() => setOpen(v => !v)}>
        <IChevR size={11} />
        思考过程
        <span className="think-meta">{text.length} 字</span>
      </button>
      {open && <div className="think-body">{text}</div>}
    </div>
  )
}

function MsgView({ m }: { m: Msg }) {
  if (m.role === 'user') return <div className="msg user">{m.text}</div>
  return (
    <div className="msg ai">
      {m.reason && <ThinkBlock text={m.reason} />}
      {/* 2026-11-06：此前直接 innerHTML 塞原文，**加粗** / 列表 / 代码块全是字面量；
          统一走 mdRender（与流式同一渲染器），并套 .md 复用笔记阅读器的排版 */}
      <div className="md" dangerouslySetInnerHTML={{ __html: mdRender(m.text) }} />
      {m.card && <ActionCard m={m} />}
      {m.list && m.list.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {m.list.map(t => (
            <div className="mini-todo" key={t.id}>
              <span className="mt-dot" style={{ background: TODO_DOT[t.type] }} />
              <span style={t.done ? { textDecoration: 'line-through', color: 'var(--text-muted)' } : undefined}>{t.title}</span>
              <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 11.5 }}>{t.time}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function SessionSheet() {
  const { sessions, curSession, closeSheet, newSession, switchSession, deleteSession, renameSession, togglePin, toast, streaming } = useApp()
  const [kw, setKw] = useState('')
  const [menuId, setMenuId] = useState<string | null>(null)
  const [renameId, setRenameId] = useState<string | null>(null)
  const [armedId, setArmedId] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const lpTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lpFired = useRef(false)

  const resetModes = () => { setMenuId(null); setRenameId(null); setArmedId(null) }

  const startLp = (id: string) => {
    lpFired.current = false
    lpTimer.current = setTimeout(() => {
      lpTimer.current = null
      lpFired.current = true
      setRenameId(null); setArmedId(null)
      setMenuId(id)
      if (navigator.vibrate) navigator.vibrate(10)
    }, 480)
  }
  const cancelLp = () => { if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null } }

  const rowClick = (id: string) => {
    if (lpFired.current) { lpFired.current = false; return }
    if (menuId || renameId || armedId) { resetModes(); return }
    if (streaming) { toast('AI 正在回复，稍等再切', 'warn'); return }
    if (id !== curSession) { switchSession(id); closeSheet() }
  }

  const sorted = [...sessions].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.ts - a.ts)
  const row = (s: Session) => {
    let inner
    if (s.id === renameId) {
      inner = (
        <>
          <input className="sess-input" autoFocus value={renameVal}
            onChange={e => setRenameVal(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && renameVal.trim()) { renameSession(s.id, renameVal.trim()); setRenameId(null) } }} />
          {/* 操作条必须断冒泡：click 冒泡进行的 rowClick 会用本次渲染的旧闭包看到 menuId 仍为真，
              走 resetModes() 把按钮刚 setState 的 renameId/armedId 抹掉——表现为「按钮全失灵」（2026-11-08 实测复现） */}
          <div className="sess-acts" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
            <button onClick={() => { if (renameVal.trim()) { renameSession(s.id, renameVal.trim()); setRenameId(null) } }}>保存</button>
            <button onClick={resetModes}>取消</button>
          </div>
        </>
      )
    } else if (s.id === armedId) {
      inner = (
        <>
          <div className="sess-body"><div className="sess-title" style={{ color: 'var(--red)' }}>删除这条会话？</div></div>
          <div className="sess-acts" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
            <button className="danger" onClick={() => { setArmedId(null); deleteSession(s.id) }}>删除</button>
            <button onClick={resetModes}>取消</button>
          </div>
        </>
      )
    } else if (s.id === menuId) {
      inner = (
        <>
          <div className="sess-body"><div className="sess-title">{s.title}</div></div>
          <div className="sess-acts" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
            <button onClick={() => { togglePin(s.id); setMenuId(null) }}>{s.pinned ? '取消置顶' : '置顶'}</button>
            <button onClick={() => { setRenameVal(s.title); setRenameId(s.id); setMenuId(null) }}>重命名</button>
            <button className="danger" onClick={() => { setArmedId(s.id); setMenuId(null) }}>删除</button>
          </div>
        </>
      )
    } else {
      inner = (
        <>
          <div className="sess-body"><div className="sess-title">{s.title}</div></div>
          <button className="sess-more" onClick={e => { e.stopPropagation(); setRenameId(null); setArmedId(null); setMenuId(s.id) }}><IDots /></button>
        </>
      )
    }
    return (
      <div key={s.id} className={'sess-row' + (s.id === curSession ? ' cur' : '')}
        onPointerDown={() => startLp(s.id)} onPointerUp={cancelLp} onPointerMove={cancelLp}
        onClick={() => rowClick(s.id)}>
        {inner}
      </div>
    )
  }

  let body
  let listEmpty = false
  if (kw.trim()) {
    const hits = sorted.filter(s => s.title.toLowerCase().includes(kw.trim().toLowerCase()))
    body = hits.map(row)
    listEmpty = !hits.length
    if (listEmpty) body = <div className="empty">没有匹配的会话</div>
  } else {
    const groups: Array<[string, string]> = [['pin', '置顶'], ['today', '今天'], ['yesterday', '昨天'], ['d7', '7 天内'], ['d30', '30 天内'], ['older', '更早']]
    const parts: React.ReactNode[] = []
    for (const [k, label] of groups) {
      const items = sorted.filter(s => k === 'pin' ? s.pinned : (!s.pinned && sessGroupKey(s.ts) === k))
      if (!items.length) continue
      parts.push(<div className="sess-group-head" key={k}>{label}</div>, ...items.map(row))
    }
    listEmpty = !parts.length
    body = parts.length ? parts : <div className="empty">还没有会话</div>
  }

  return (
    <FullPage>
      <FullPageHead title="会话记录" />
      <div className="fp-body flex">
      <div className="search-box" style={{ marginBottom: 10 }}>
        <ISearch />
        <input value={kw} onChange={e => setKw(e.target.value)} placeholder="搜索历史会话" />
      </div>
      <button className="btn-ghost" style={{ width: '100%', height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 4 }}
        onClick={() => { newSession(); resetModes(); closeSheet(); toast('已新建会话', 'ok') }}>
        <IPlus size={13} />开启新对话
      </button>
      {/* 空态时整组（提示 + 用法脚注）垂直居中；有会话时列表顶格，脚注跟在末尾 */}
      <div className={'sess-list' + (listEmpty ? ' center' : '')}>
        {body}
        <div className="sess-foot">长按会话可置顶 / 重命名 / 删除 · 会话存手机本地，跨端同步放二期</div>
      </div>
      </div>
    </FullPage>
  )
}

export function AiPage({ active }: { active: boolean }) {
  const { sessions, curSession, streaming, streamText, sendChat, stopStream, voicePhase, voiceElapsed, toggleVoice, openSheet } = useApp()
  const [input, setInput] = useState('')
  const sess = sessions.find(s => s.id === curSession) ?? sessions[0]
  const chatRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight })
  }, [sess.messages.length, streamText, curSession])

  const doSend = () => { if (!streaming && input.trim()) { sendChat(input); setInput('') } }

  const micInner = voicePhase === 'transcribing'
    ? <span className="spin" />
    : <IMic />
  const placeholder = voicePhase === 'recording'
    ? '录音中… 00:0' + voiceElapsed
    : voicePhase === 'transcribing' ? '正在识别…' : '问点什么…'

  return (
    <section className={'page' + (active ? ' active' : '')}>
      <PageHead title="AI 助手">
        <button className="icon-btn" style={{ width: 32, height: 32, flex: 'none' }} onClick={e => openSheet('sessions', e.currentTarget)}><IHistory /></button>
      </PageHead>

      <div className="chat" ref={chatRef}>
        {sess.messages.map(m => <MsgView key={m.id} m={m} />)}
        {streaming && (
          <div className="msg ai streaming">
            <div className="md" dangerouslySetInnerHTML={{ __html: mdRender(streamText).replace(/^<p>/, '').replace(/<\/p>$/, '') }} />
          </div>
        )}
      </div>

      <div className="composer">
        <div className="input-bar">
          {/* 三个按钮都用 onMouseDown preventDefault：不让它们抢走 input 的焦点。
              否则点发送 → input 失焦 → 键盘收起 → 壳变高、页面底部留白从 10px 恢复成 96px，
              整条输入栏在「按下」和「抬起」之间下移近百像素，pointerup 落到别处，
              click 不成立 —— 用户实测的「输入框消失、再点一次才发出去」就是这个。
              用 onMouseDown 而非 onPointerDown：前者不会吞掉 click（iOS 上有过坑）。 */}
          <button className={'mic-btn' + (voicePhase === 'recording' ? ' rec' : '')}
            onMouseDown={e => e.preventDefault()} onClick={toggleVoice}>{micInner}</button>
          <span className={'voice-bars' + (voicePhase === 'recording' ? ' on' : '')}><i /><i /><i /><i /></span>
          <input value={input} onChange={e => setInput(e.target.value)} disabled={voicePhase !== 'idle'}
            placeholder={placeholder} onKeyDown={e => { if (e.key === 'Enter') doSend() }} />
          {streaming
            ? <button className="send-btn stop" onMouseDown={e => e.preventDefault()} onClick={stopStream} title="停止生成"><IStop size={15} /></button>
            : <button className="send-btn" onMouseDown={e => e.preventDefault()} onClick={doSend} disabled={!input.trim()}><ISend /></button>}
        </div>
      </div>

    </section>
  )
}

