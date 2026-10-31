import { useState } from 'react'
import { ACCOUNTS, CATS_EXPENSE, CATS_INCOME, CAT_COLORS, fmtMoney } from '../../lib/data'
import { useApp } from '../../lib/store'
import { IChevL, IChevR, IPlus, IBackspace } from '../../components/icons'
import { Grip, Sheet } from '../../components/Sheet'

function TxSheet() {
  const { closeSheet, saveTx, toast } = useApp()
  const [type, setType] = useState<'expense' | 'income'>('expense')
  const [amt, setAmt] = useState('0')
  const [cat, setCat] = useState('餐饮')
  const [acc, setAcc] = useState('微信')
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
    saveTx({ type, amount, cat: activeCat, acc })
    closeSheet()
  }

  return (
    <Sheet>
      <Grip />
      <h3>记一笔</h3>
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
      <div className="keypad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'].map(k => (
          <button key={k} onClick={() => press(k)}>{k === 'del' ? <IBackspace /> : k}</button>
        ))}
      </div>
      <div style={{ height: 14 }} />
      <button className="btn-primary" onClick={save}>保存到手机</button>
      <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>保存即入本地账本 · 同步时并入电脑</div>
    </Sheet>
  )
}

export function LedgerPage({ active }: { active: boolean }) {
  const { txs, openSheet } = useApp()
  const exp = txs.filter(t => t.amt < 0).reduce((s, t) => s + t.amt, 0)
  const inc = txs.filter(t => t.amt > 0).reduce((s, t) => s + t.amt, 0)
  const bal = inc + exp

  const groups: Array<{ date: string; items: typeof txs }> = []
  for (const t of txs) {
    let g = groups.find(x => x.date === t.date)
    if (!g) { g = { date: t.date, items: [] }; groups.push(g) }
    g.items.push(t)
  }

  return (
    <section className={'page' + (active ? ' active' : '')}>
      <div className="month-head">
        <button className="month-arrow"><IChevL size={14} /></button>
        <span className="m">2026年10月</span>
        <button className="month-arrow"><IChevR size={14} /></button>
      </div>
      <div className="card stat-row">
        <div className="stat"><div className="lab">支出</div><div className="val">¥{fmtMoney(Math.abs(exp))}</div></div>
        <div className="stat"><div className="lab">收入</div><div className="val income">¥{fmtMoney(inc)}</div></div>
        <div className="stat"><div className="lab">结余</div><div className={'val' + (bal > 0 ? ' income' : '')}>{bal < 0 ? '-¥' : '¥'}{fmtMoney(Math.abs(bal))}</div></div>
      </div>
      {groups.map(g => {
        const sum = g.items.reduce((s, t) => s + t.amt, 0)
        return (
          <div className="day-group" key={g.date}>
            <div className="day-label"><span>{g.date}</span><span>{sum < 0 ? '-' : '+'}¥{fmtMoney(Math.abs(sum))}</span></div>
            <div className="card" style={{ padding: '2px 14px' }}>
              {g.items.map(t => (
                <div className="tx-item" key={t.id}>
                  <div className="tx-ico" style={{ color: CAT_COLORS[t.cat] || '#969696', background: `color-mix(in srgb, ${CAT_COLORS[t.cat] || '#969696'} 13%, transparent)` }}>{t.cat[0]}</div>
                  <div className="tx-body">
                    <div className="tx-name">{t.name}</div>
                    <div className="tx-sub">{t.sub} · {t.acc}</div>
                  </div>
                  <div className={'tx-amt' + (t.amt > 0 ? ' income' : '')}>{t.amt > 0 ? '+' : '-'}¥{fmtMoney(Math.abs(t.amt))}</div>
                </div>
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
