import { useRef, useState } from 'react'
import { ToggleButton, ToggleButtonGroup } from '@heroui/react'
import type { Tx } from '../../lib/types'
import {
  ACCOUNTS, CATS_EXPENSE, CATS_INCOME, catColorOf, chipListWith, TODAY, fmtMoney,
  groupEntriesByDay, monthLabel, monthOf, monthShift, monthStats, txDisplay, txToDisplay,
} from '../../lib/data'
import { useApp } from '../../lib/store'
import { IChevL, IChevR, IPlus, IBackspace } from '../../components/icons'
import { FullPage, FullPageHead } from '../../components/FullPage'
import { PageHead } from '../../components/chrome'

/** 记一笔 / 改一笔 双模式：tx-edit 打开时从 store.editTxId 钉住的条目预填 */
function TxSheet() {
  const { closeSheet, saveTx, updateTx, toast, sheet, editTxId, entries } = useApp()
  const editing = sheet === 'tx-edit' ? entries.find(e => e.id === editTxId) ?? null : null
  const [type, setType] = useState<'expense' | 'income'>(editing?.data.type ?? 'expense')
  const [amt, setAmt] = useState(editing ? String(editing.data.amount) : '0')
  const [cat, setCat] = useState(editing?.data.category ?? '餐饮')
  const [acc, setAcc] = useState(editing?.data.payment ?? '微信')
  const [name, setName] = useState(editing?.data.merchant ?? '')
  const [date, setDate] = useState(editing?.data.date ?? TODAY)
  /* 电脑拉回的分类/账户可能不在手机内置清单里：原样保留为首位 chip，保存原样带回
   * （此前 activeCat 回落清单首项——编辑「居住」条目保存会被静默改成「餐饮」，数据破坏） */
  const cats = chipListWith(type === 'expense' ? CATS_EXPENSE : CATS_INCOME, cat)
  const accs = chipListWith(ACCOUNTS, acc)

  const press = (k: string) => {
    if (k === 'del') setAmt(v => (v.length > 1 ? v.slice(0, -1) : '0'))
    else if (k === '.') setAmt(v => (v.includes('.') ? v : v + '.'))
    else setAmt(v => {
      if (v === '0') return k
      if (v.includes('.')) return v.split('.')[1].length < 2 ? v + k : v
      return v.length < 8 ? v + k : v
    })
  }
  const save = () => {
    const amount = parseFloat(amt) || 0
    if (amount <= 0) { toast('金额还没填', 'warn'); return }
    if (editing) updateTx(editing.id, { type, amount, cat, acc, merchant: name.trim(), date })
    else saveTx({ type, amount, cat, acc, merchant: name.trim(), date })
    closeSheet()
  }

  return (
    <FullPage>
      <FullPageHead title={editing ? '改一笔' : '记一笔'} />
      <div className="fp-body">
      <ToggleButtonGroup
        aria-label="收支类型"
        size="sm"
        fullWidth
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={new Set([type])}
        onSelectionChange={keys => { const k = [...keys][0]; if (k) setType(k as 'expense' | 'income') }}
        style={{ marginBottom: 14 }}
      >
        <ToggleButton id="expense">支出</ToggleButton>
        <ToggleButton id="income">收入</ToggleButton>
      </ToggleButtonGroup>
      <div className="amt-display"><span className="cur">¥</span><span className="num">{(parseFloat(amt) || 0).toFixed(2)}</span></div>
      <div className="field"><label>日期（可补记）</label><input type="date" value={date} max={TODAY} onChange={e => setDate(e.target.value)} /></div>
      <div className="chip-row">
        {cats.map(c => <button key={c} className={'ph-chip' + (c === cat ? ' on' : '')} onClick={() => setCat(c)}>{c}</button>)}
      </div>
      <div className="chip-row">
        {accs.map(a => <button key={a} className={'ph-chip' + (a === acc ? ' on' : '')} onClick={() => setAcc(a)}>{a}</button>)}
      </div>
      <div className="field">
        <label>名目（可选）</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder={cat} />
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
      </div>
    </FullPage>
  )
}

/** 单条流水：点按进改账抽屉（从触发行圆形展开）；长按（550ms）/右键呼出行内删除确认 */
function TxRow({ t, confirming, onAsk, onConfirm, onCancel, onEdit }: {
  t: Tx
  confirming: boolean
  onAsk: (id: string) => void
  onConfirm: (id: string) => void
  onCancel: () => void
  onEdit: (id: string, from?: HTMLElement | null) => void
}) {
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const consumed = useRef(false)
  const cancelPress = () => { if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null } }
  const armPress = () => {
    cancelPress()
    consumed.current = false
    pressTimer.current = setTimeout(() => {
      pressTimer.current = null
      consumed.current = true
      if (navigator.vibrate) navigator.vibrate(10)
      onAsk(t.id)
    }, 550)
  }
  const color = catColorOf(t.cat)
  return (
    <div
      className="tx-item"
      onPointerDown={armPress}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onPointerMove={cancelPress}
      onContextMenu={e => { e.preventDefault(); consumed.current = true; onAsk(t.id) }}
      onClick={e => { if (!consumed.current && !confirming) onEdit(t.id, e.currentTarget) }}
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
      <PageHead title={monthLabel(month)}>
        <span className="month-arrows">
          <button className="month-arrow" title="上一月" onClick={() => setMonth(m => monthShift(m, -1))}><IChevL size={14} /></button>
          <button className="month-arrow" title="下一月" onClick={() => setMonth(m => monthShift(m, 1))}><IChevR size={14} /></button>
        </span>
      </PageHead>
      <div className="ph-card stat-row">
        <div className="stat"><div className="lab">支出</div><div className="val">¥{fmtMoney(stats.expense)}</div></div>
        <div className="stat"><div className="lab">收入</div><div className="val income">¥{fmtMoney(stats.income)}</div></div>
        <div className="stat"><div className="lab">结余</div><div className={'val' + (stats.balance > 0 ? ' income' : '')}>{stats.balance < 0 ? '-¥' : '¥'}{fmtMoney(Math.abs(stats.balance))}</div></div>
      </div>
      {groups.length === 0 && <div className="empty empty-spring">这个月没有记账</div>}
      {groups.map(g => {
        const sum = g.entries.reduce((s, e) => s + (e.data.type === 'expense' ? -e.data.amount : e.data.amount), 0)
        return (
          <div className="day-group" key={g.date}>
            <div className="day-label"><span>{txDisplay(g.date, '').date}</span><span>{sum < 0 ? '-' : '+'}¥{fmtMoney(Math.abs(sum))}</span></div>
            <div className="ph-card" style={{ padding: '2px 14px' }}>
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
      <button className="fab" onClick={e => openSheet('tx', e.currentTarget)}><IPlus size={22} /></button>
    </section>
  )
}

export { TxSheet }
