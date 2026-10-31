import { useEffect, useRef, useState } from 'react'
import type { Msg, Session } from '../../lib/types'
import { mdRender, sessGroupKey } from '../../lib/data'
import { useApp } from '../../lib/store'
import { ICheck, IHistory, IMic, ISearch, ISend, ISparkle, IPlus, IDots } from '../icons'
import { Grip, Sheet } from '../Sheet'

const TODO_DOT: Record<string, string> = { deadline: 'var(--red)', plan: 'var(--blue)', daily: 'var(--green)' }

function ActionCard({ m }: { m: Msg }) {
  const { confirmCard, dismissCard } = useApp()
  if (!m.card) return null
  const confirmed = !!m.card.confirmed
  const isTx = m.card.kind === 'tx'
  return (
    <div className={'action-card' + (confirmed ? ' confirmed' : '')}>
      <div className="ac-head"><ISparkle size={12} />AI 操作 · {isTx ? '记账' : '改日程'}</div>
      {isTx ? (
        <>
          <div className="ac-row"><span className="ac-amt">¥30.00</span><span className="ac-meta">支出 · 餐饮 · 午饭</span></div>
          <div className="ac-row" style={{ marginTop: 4 }}><span className="ac-meta">账户：微信 · 今天</span></div>
        </>
      ) : (
        <>
          <div className="ac-row"><span className="ac-amt" style={{ fontSize: 17 }}>跑步 30 分钟</span><span className="ac-meta">今天 19:00</span></div>
          <div className="ac-row" style={{ marginTop: 4 }}><span className="ac-meta">改为</span><span className="ac-meta" style={{ color: 'var(--accent-hover)', fontWeight: 600 }}>明天 19:30</span></div>
        </>
      )}
      {!confirmed && (
        <div className="ac-btns">
          <button className="ok" onClick={() => confirmCard(m.id, m.card!.kind)}>{isTx ? '确认入账' : '确认改期'}</button>
          <button className="no" onClick={() => dismissCard(m.id)}>改一改</button>
        </div>
      )}
      {confirmed && <div className="ac-state"><ICheck size={12} />{isTx ? '已入账' : '已改期'} · 待同步进电脑</div>}
    </div>
  )
}

function MsgView({ m }: { m: Msg }) {
  if (m.role === 'user') return <div className="msg user">{m.text}</div>
  return (
    <div className="msg ai">
      <span dangerouslySetInnerHTML={{ __html: m.text }} />
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
          <div style={{ fontSize: 13, marginTop: 6 }}>晚上 19:00 还有跑步，加油。</div>
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
  const { sessions, curSession, streaming, streamText, sendChat, aiMode, setAiMode, voicePhase, voiceElapsed, toggleVoice, openSheet } = useApp()
  const [input, setInput] = useState('')
  const sess = sessions.find(s => s.id === curSession) ?? sessions[0]
  const chatRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight })
  }, [sess.messages.length, streamText])

  const doSend = () => { if (!streaming && input.trim()) { sendChat(input); setInput('') } }

  const micInner = voicePhase === 'transcribing'
    ? <span className="spin" />
    : <IMic />
  const placeholder = voicePhase === 'recording'
    ? '录音中… 00:0' + voiceElapsed
    : voicePhase === 'transcribing' ? '正在识别…' : '问点什么…'

  return (
    <section className={'page' + (active ? ' active' : '')}>
      <div className="ai-head">
        <span className="t">AI 助手</span>
        <div className="ai-mode">
          <button className={aiMode === 'direct' ? 'on' : ''} onClick={() => setAiMode('direct')}><span className="mdot" />手机直连</button>
          <button className={aiMode === 'pc' ? 'on pc' : ''} onClick={() => setAiMode('pc')}><span className="mdot" />电脑 AI</button>
        </div>
        <button className="icon-btn" style={{ width: 32, height: 32, flex: 'none' }} onClick={() => openSheet('sessions')}><IHistory /></button>
      </div>

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
          <button className="send-btn" onClick={doSend} disabled={streaming}><ISend /></button>
        </div>
      </div>

    </section>
  )
}

