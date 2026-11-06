import { useMemo, useState } from 'react'
import { useApp } from '../../lib/store'
import type { QuizRecord } from '../../lib/types'
import { ICheck } from '../../components/icons'
import { PageHead } from '../../components/chrome'

/* 掌握判定对齐桌面：错过且连续答对 <2 = 未掌握；错次档位：顽固 ≥4 / 中 2-3 / 轻 1 */
const isUnmastered = (r: QuizRecord) => r.wrongCount > 0 && r.streakCorrect < 2
const tierOf = (r: QuizRecord) => r.wrongCount >= 4 ? '顽固' : r.wrongCount >= 2 ? '中' : r.wrongCount >= 1 ? '轻' : ''

const shuffle = (arr: QuizRecord[]) => {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function QuizPage({ active }: { active: boolean }) {
  const { quizRecords, answerQuiz } = useApp()
  const [mode, setMode] = useState<'shelf' | 'run'>('shelf')
  const [queue, setQueue] = useState<QuizRecord[]>([])
  const [idx, setIdx] = useState(0)
  const [picked, setPicked] = useState<string | null>(null)
  const [shortText, setShortText] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [selfOk, setSelfOk] = useState<boolean | null>(null)
  const [score, setScore] = useState({ ok: 0, total: 0 })

  const unmastered = useMemo(() => quizRecords.filter(isUnmastered), [quizRecords])
  const books = useMemo(() => {
    const map = new Map<string, QuizRecord[]>()
    for (const r of quizRecords) {
      const list = map.get(r.pageTitle)
      if (list) list.push(r)
      else map.set(r.pageTitle, [r])
    }
    return [...map.entries()].map(([title, rs]) => ({ title, records: rs }))
  }, [quizRecords])

  const startRun = () => {
    const pool = shuffle(quizRecords.filter(r => !(r.wrongCount > 0 && r.streakCorrect >= 2))) // 已掌握的移出本轮
    if (!pool.length) return
    setQueue(pool)
    setIdx(0); setPicked(null); setShortText(''); setRevealed(false); setSelfOk(null)
    setScore({ ok: 0, total: 0 })
    setMode('run')
  }

  const cur = queue[idx]

  const judge = (correct: boolean) => {
    if (!cur || revealed) return
    answerQuiz(cur.id, correct)
    setScore(s => ({ ok: s.ok + (correct ? 1 : 0), total: s.total + 1 }))
    setRevealed(true)
  }

  const pickChoice = (key: string) => {
    if (!cur || revealed) return
    setPicked(key)
    judge(key === cur.answer)
  }

  const nextQ = () => {
    if (idx + 1 >= queue.length) { setMode('shelf'); return }
    setIdx(i => i + 1); setPicked(null); setShortText(''); setRevealed(false); setSelfOk(null)
  }

  /* 刷题态：一题一屏（对照桌面 QuizMode 沉浸式） */
  if (mode === 'run' && cur) {
    return (
      <section className={'page' + (active ? ' active' : '')}>
        <div className="quiz-progress">
          <span>第 {idx + 1} / {queue.length} 题</span>
          <div className="qp-bar"><div style={{ width: ((idx + 1) / queue.length * 100) + '%' }} /></div>
          <span className="qp-score">答对 {score.ok}</span>
        </div>
        <div className="quiz-card">
          <div className="qc-meta">{cur.pageTitle} · 第 {cur.no} 题 · {cur.type === 'short' ? '简答' : '选择'}</div>
          <div className="qc-q">{cur.question}</div>
          {cur.type === 'choice' ? (
            <div className="qc-opts">
              {cur.options.map(o => {
                let cls = 'qc-opt'
                if (revealed) {
                  if (o.key === cur.answer) cls += ' right'
                  else if (o.key === picked) cls += ' wrong'
                } else cls += ''
                return (
                  <button key={o.key} className={cls} onClick={() => pickChoice(o.key)} disabled={revealed}>
                    <span className="k">{o.key}</span>{o.text}
                    {revealed && o.key === cur.answer && <ICheck size={15} />}
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="qc-short">
              <textarea
                value={shortText}
                onChange={e => setShortText(e.target.value)}
                placeholder="写下你的答案…（写完点「对答案」）"
                disabled={revealed}
              />
              {!revealed && <button className="btn-primary" onClick={() => setRevealed(true)} disabled={!shortText.trim()}>对答案</button>}
              {revealed && selfOk === null && (
                <div className="qc-self">
                  <div className="qc-ref"><span className="lbl">参考答案</span>{cur.answer}</div>
                  <div className="qc-selfbtns">
                    <button className="btn-ok" onClick={() => { answerQuiz(cur.id, true); setScore(s => ({ ok: s.ok + 1, total: s.total + 1 })); setSelfOk(true) }}>我答对了</button>
                    <button className="btn-bad" onClick={() => { answerQuiz(cur.id, false); setScore(s => ({ ok: s.ok, total: s.total + 1 })); setSelfOk(true) }}>我答错了</button>
                  </div>
                </div>
              )}
            </div>
          )}
          {revealed && cur.type === 'choice' && (
            <div className="qc-exp"><span className="lbl">解析</span>{cur.explanation}</div>
          )}
          {revealed && cur.type === 'short' && selfOk !== null && (
            <div className="qc-exp"><span className="lbl">解析</span>{cur.explanation}</div>
          )}
          {revealed && (cur.type === 'choice' || selfOk !== null) && (
            <button className="btn-primary qc-next" onClick={nextQ}>{idx + 1 >= queue.length ? '完成本轮' : '下一题'}</button>
          )}
        </div>
      </section>
    )
  }

  /* 书架态：错题书架（按来源分书 + 错次档位）+ 统计 + 开始刷题 */
  return (
    <section className={'page' + (active ? ' active' : '')}>
      <PageHead title="错题本">
        {unmastered.length > 0 && <button className="btn-primary quiz-go" onClick={startRun}>开始刷题 · {unmastered.length} 道未掌握</button>}
      </PageHead>
      <div className="quiz-stats">
        <div className="qs"><b>{quizRecords.length}</b><span>总题数</span></div>
        <div className="qs warn"><b>{unmastered.length}</b><span>未掌握</span></div>
        <div className="qs ok"><b>{quizRecords.length - unmastered.length}</b><span>已掌握/未错</span></div>
      </div>
      {books.map(b => {
        const worst = b.records.reduce((t, r) => Math.max(t, r.wrongCount), 0)
        const tier = worst >= 4 ? '顽固' : worst >= 2 ? '中' : worst >= 1 ? '轻' : '未错'
        const um = b.records.filter(isUnmastered).length
        return (
          <div key={b.title} className="quiz-book">
            <div className="qb-head">
              <span className={'qb-tier t' + (worst >= 4 ? '4' : worst >= 2 ? '2' : worst >= 1 ? '1' : '0')}>{tier}</span>
              <span className="qb-title">{b.title}</span>
              <span className="qb-count">{b.records.length} 题{um ? ` · ${um} 未掌握` : ''}</span>
            </div>
            <div className="qb-list">
              {b.records.map(r => (
                <div key={r.id} className={'qb-row' + (isUnmastered(r) ? ' um' : '')}>
                  <span className="qb-no">{r.no}</span>
                  <span className="qb-q">{r.question}</span>
                  <span className="qb-m">{r.wrongCount > 0 ? `错 ${r.wrongCount}` : '未错'}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
      {!quizRecords.length && <div className="empty" style={{ padding: '24px 0' }}>还没有错题记录——读带 quiz 题卡的文档，作答后自动归档到这里</div>}
    </section>
  )
}
