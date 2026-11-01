import { useRef, useState } from 'react'
import type { Tx } from '../../lib/types'
import {
  ACCOUNTS, CATS_EXPENSE, CATS_INCOME, CAT_COLORS, TODAY, fmtMoney,
  groupEntriesByDay, monthLabel, monthOf, monthShift, monthStats, txDisplay, txToDisplay,
} from '../../lib/data'
import { useApp } from '../../lib/store'
import { IChevL, IChevR, IPlus, IBackspace } from '../../components/icons'
import { Grip, Sheet } from '../../components/Sheet'

/** 记一笔 / 改一笔 双模式：tx-edit 打开时从 store.editTxId 钉住的条目预填 */
function TxSheet() {
  const { closeSheet, saveTx, updateTx, toast, sheet, editTxId, entries } = useApp()
  const editing = sheet === 'tx-edit' ? entries.find(e => e.id === editTxId) ?? null : null
  const [type, setType] = useState<'expense' | 'income'>(editing?.data.type ?? 'expense')
  const [amt, setAmt] = useState(editing ? String(editing.data.amount) : '0')
  const [cat, setCat] = useState(editing?.data.category ?? '餐饮')
  const [acc, setAcc] = useState(editing?.data.payment ?? '微信')
  const [name, setName] = useState(editing?.data.merchant ?? '')
  const cats = type === 'expense' ? CATS_EXPENSE : CATS_INCOME
  const activeCat = cats.includes(cat) ? cat : cats[0]

  const press = (k: string) => {
    if (k === 'del') setAmt(v => (v.length > 1 ? v.slice(0, -1) : '0'))
    else if (k === '.') setAmt(v => (v.includes('.') ? v : v + '.'))
    else setAmt(v => (v === '0' ? k : (v.replace('.', '').length < 8 ? v + k : v)))
  }
  const save = () => {
    const amount = parseFloat(amt) || 0
    if (amount <= 0) { toast('金额还没填', 'warn'); return }
    if (editing) updateTx(editing.id, { type, amount, cat: activeCat, acc, merchant: name.trim() })
    else saveTx({ type, amount, cat: activeCat, acc, merchant: name.trim() })
    closeSheet()
  }

  return (
    <Sheet>
      <Grip />
      <h3>{editing ? '改一笔' : '记一笔'}</h3>
      <div className="seg">
        <button className={type === 'expense' ? 'on' : ''} onClick={() => setType('expense')}>支出</button>
        <button className={type === 'income' ? 'on' : ''} onClick={() => setType('income')}>收入</button>
      </div>
      <div className="amt-display"><span className="cur">¥</span><span className="num">{(parseFloat(amt) || 0).toFixed(2)}</span></div>
      <div className="chip-row">
        {cats.map(c => <button key={c} className={'chip' + (c === activeCat ? ' on' : '')} onClick={() => setCat(c)}>{c}</button>)}
      </div>
      <div className="chip-row">
        {ACCOUNTS.map(a => <button key={a} className={'chip' + (a === acc ? ' on' : '')} onClick={() => setAcc(a)}>{a}</button>)}
      </div>
      <div className="field">
        <label>名目（可选）</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder={activeCat} />
      </div>
      <div className="keypad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'].map(k => (
          <button key={k} onClick={() => press(k)}>{k === 'del' ? <IBackspace /> : k}</button>
        ))}
      </div>
      <div style={{ height: 14 }} />
      <button className="btn-primary" onClick={save}>{editing ? '保存修改' : '保存到手机'}</button>
      <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>
        {editing ? '改完待同步 · 与电脑按「最新改动为准」合并' : '保存即入本地账本 · 同步时并入电脑'}
      </div>
    </Sheet>
  )
}

/** 单条流水：点按进改账抽屉；长按（550ms）/右键呼出行内删除确认（点按会被长按吞掉） */
function TxRow({ t, confirming, onAsk, onConfirm, onCancel, onEdit }: {
  t: Tx
  confirming: boolean
  onAsk: (id: string) => void
  onConfirm: (id: string) => void
  onCancel: () => void
  onEdit: (id: string) => void
}) {
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const consumed = useRef(false)
  const cancelPress = () => { if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null } }
  const armPress = () => {
    cancelPress()
    consumed.current = false
    pressTimer.current = setTimeout(() => { pressTimer.current = null; consumed.current = true; onAsk(t.id) }, 550)
  }
  const color = CAT_COLORS[t.cat] || '#969696'
  return (
    <div
      className="tx-item"
      onPointerDown={armPress}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onPointerMove={cancelPress}
      onContextMenu={e => { e.preventDefault(); consumed.current = true; onAsk(t.id) }}
      onClick={() => { if (!consumed.current && !confirming) onEdit(t.id) }}
    >
      <div className="tx-ico" style={{ color, background: `color-mix(in srgb, ${color} 13%, transparent)` }}>{t.cat[0]}</div>
      <div className="tx-body">
        {confirming ? (
          <div className="del-confirm">
            <span className="dc-q">删除「{t.name}」？</span>
            <button className="dc-btn dc-yes" onClick={() => onConfirm(t.id)}>删除</button>
            <button className="dc-btn dc-no" onClick={onCancel}>取消</button>
          </div>
        ) : (
          <>
            <div className="tx-name">{t.name}</div>
            <div className="tx-sub">{t.sub} · {t.acc}</div>
          </>
        )}
      </div>
      <div className={'tx-amt' + (t.amt > 0 ? ' income' : '')}>{t.amt > 0 ? '+' : '-'}¥{fmtMoney(Math.abs(t.amt))}</div>
    </div>
  )
}

export function LedgerPage({ active }: { active: boolean }) {
  const { entries, openTxEdit, deleteTx, openSheet } = useApp()
  const [month, setMonth] = useState(() => monthOf(TODAY))
  const [delId, setDelId] = useState<string | null>(null)
  const stats = monthStats(entries, month)
  const groups = groupEntriesByDay(entries, month)

  return (
    <section className={'page' + (active ? ' active' : '')}>
      <div className="month-head">
        <button className="month-arrow" onClick={() => setMonth(m => monthShift(m, -1))}><IChevL size={14} /></button>
        <span className="m">{monthLabel(month)}</span>
        <button className="month-arrow" onClick={() => setMonth(m => monthShift(m, 1))}><IChevR size={14} /></button>
      </div>
      <div className="card stat-row">
        <div className="stat"><div className="lab">支出</div><div className="val">¥{fmtMoney(stats.expense)}</div></div>
        <div className="stat"><div className="lab">收入</div><div className="val income">¥{fmtMoney(stats.income)}</div></div>
        <div className="stat"><div className="lab">结余</div><div className={'val' + (stats.balance > 0 ? ' income' : '')}>{stats.balance < 0 ? '-¥' : '¥'}{fmtMoney(Math.abs(stats.balance))}</div></div>
      </div>
      {groups.length === 0 && <div className="empty">这个月没有记账</div>}
      {groups.map(g => {
        const sum = g.entries.reduce((s, e) => s + (e.data.type === 'expense' ? -e.data.amount : e.data.amount), 0)
        return (
          <div className="day-group" key={g.date}>
            <div className="day-label"><span>{txDisplay(g.date, '').date}</span><span>{sum < 0 ? '-' : '+'}¥{fmtMoney(Math.abs(sum))}</span></div>
            <div className="card" style={{ padding: '2px 14px' }}>
              {g.entries.map(e => (
                <TxRow
                  key={e.id}
                  t={txToDisplay(e)}
                  confirming={delId === e.id}
                  onAsk={setDelId}
                  onConfirm={id => { deleteTx(id); setDelId(null) }}
                  onCancel={() => setDelId(null)}
                  onEdit={openTxEdit}
                />
              ))}
            </div>
          </div>
        )
      })}
      <button className="fab" onClick={() => openSheet('tx')}><IPlus size={22} /></button>
    </section>
  )
}

export { TxSheet }
