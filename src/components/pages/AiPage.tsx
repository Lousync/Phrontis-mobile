import { useEffect, useRef, useState } from 'react'
import type { Msg, NoteProposal, Session, TodoProposal, TxProposal } from '../../lib/types'
import { fmtMoney, mdRender, sessGroupKey, TODO_TYPE_LABEL } from '../../lib/data'
import { useApp } from '../../lib/store'
import { ICheck, IHistory, IMic, ISearch, ISend, ISparkle, IPlus, IDots, IStop } from '../icons'
import { Grip, Sheet } from '../Sheet'
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

function MsgView({ m }: { m: Msg }) {
  if (m.role === 'user') return <div className="msg user">{m.text}</div>
  return (
    <div className="msg ai">
      <span dangerouslySetInnerHTML={{ __html: m.text }} />
      {m.card && <ActionCard m={m} />}
      {m.changes && m.changes.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 4 }}>电脑端本次改动</div>
          {m.changes.map((c, i) => (
            <div className="mini-todo" key={i}>
              <span className="mt-dot" style={{ background: 'var(--accent)' }} />
              <span>{c.action} · {c.target}</span>
            </div>
          ))}
        </div>
      )}
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
          <div className="sess-acts">
            <button onClick={() => { if (renameVal.trim()) { renameSession(s.id, renameVal.trim()); setRenameId(null) } }}>保存</button>
            <button onClick={resetModes}>取消</button>
          </div>
        </>
      )
    } else if (s.id === armedId) {
      inner = (
        <>
          <div className="sess-body"><div className="sess-title" style={{ color: 'var(--red)' }}>删除这条会话？</div></div>
          <div className="sess-acts">
            <button className="danger" onClick={() => { setArmedId(null); deleteSession(s.id) }}>删除</button>
            <button onClick={resetModes}>取消</button>
          </div>
        </>
      )
    } else if (s.id === menuId) {
      inner = (
        <>
          <div className="sess-body"><div className="sess-title">{s.title}</div></div>
          <div className="sess-acts">
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
  if (kw.trim()) {
    const hits = sorted.filter(s => s.title.toLowerCase().includes(kw.trim().toLowerCase()))
    body = hits.map(row)
    if (!hits.length) body = <div className="empty">没有匹配的会话</div>
  } else {
    const groups: Array<[string, string]> = [['pin', '置顶'], ['today', '今天'], ['yesterday', '昨天'], ['d7', '7 天内'], ['d30', '30 天内'], ['older', '更早']]
    const parts: React.ReactNode[] = []
    for (const [k, label] of groups) {
      const items = sorted.filter(s => k === 'pin' ? s.pinned : (!s.pinned && sessGroupKey(s.ts) === k))
      if (!items.length) continue
      parts.push(<div className="sess-group-head" key={k}>{label}</div>, ...items.map(row))
    }
    body = parts.length ? parts : <div className="empty">还没有会话</div>
  }

  return (
    <Sheet>
      <Grip />
      <div className="search-box" style={{ marginBottom: 10 }}>
        <ISearch />
        <input value={kw} onChange={e => setKw(e.target.value)} placeholder="搜索历史会话" />
      </div>
      <button className="btn-ghost" style={{ width: '100%', height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 4 }}
        onClick={() => { newSession(); resetModes(); closeSheet(); toast('已新建会话', 'ok') }}>
        <IPlus size={13} />开启新对话
      </button>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>{body}</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 14, lineHeight: 1.6 }}>
        长按会话可置顶 / 重命名 / 删除 · 会话存手机本地，跨端同步放二期
      </div>
    </Sheet>
  )
}

export function AiPage({ active }: { active: boolean }) {
  const { sessions, curSession, streaming, streamText, sendChat, stopStream, aiMode, setAiMode, voicePhase, voiceElapsed, toggleVoice, openSheet } = useApp()
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
        <div className="ai-mode">
          <button className={aiMode === 'direct' ? 'on' : ''} onClick={() => setAiMode('direct')}><span className="mdot" />手机直连</button>
          <button className={aiMode === 'pc' ? 'on pc' : ''} onClick={() => setAiMode('pc')}><span className="mdot" />电脑 AI</button>
        </div>
        <button className="icon-btn" style={{ width: 32, height: 32, flex: 'none' }} onClick={e => openSheet('sessions', e.currentTarget)}><IHistory /></button>
      </PageHead>

      <div className="chat" ref={chatRef}>
        {sess.messages.map(m => <MsgView key={m.id} m={m} />)}
        {streaming && (
          <div className="msg ai">
            <span dangerouslySetInnerHTML={{ __html: mdRender(streamText).replace(/^<p>/, '').replace(/<\/p>$/, '') }} />
            <span className="cursor" />
          </div>
        )}
      </div>

      <div className="composer">
        <div className="input-bar">
          <button className={'mic-btn' + (voicePhase === 'recording' ? ' rec' : '')} onClick={toggleVoice}>{micInner}</button>
          <span className={'voice-bars' + (voicePhase === 'recording' ? ' on' : '')}><i /><i /><i /><i /></span>
          <input value={input} onChange={e => setInput(e.target.value)} disabled={voicePhase !== 'idle'}
            placeholder={placeholder} onKeyDown={e => { if (e.key === 'Enter') doSend() }} />
          {streaming
            ? <button className="send-btn stop" onClick={stopStream} title="停止生成"><IStop size={15} /></button>
            : <button className="send-btn" onClick={doSend} disabled={!input.trim()}><ISend /></button>}
        </div>
      </div>

    </section>
  )
}

