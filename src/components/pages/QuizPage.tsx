import { useMemo, useState } from 'react'
import {
  Button,
  ProgressBar,
  ProgressBarFill,
  ProgressBarTrack,
  ToggleButton,
  ToggleButtonGroup,
} from '@heroui/react'
import { useApp } from '../../lib/store'
import type { QuizRecord } from '../../lib/types'
import { IBack, ICheck } from '../../components/icons'
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

/* HeroUI 试点页：交互控件全部换装 HeroUI v3（Button / ToggleButtonGroup / ProgressBar），
 * 布局容器仍走本项目自研类；CSS 覆盖见 index.css 末尾「HeroUI 试点」块。
 * 守纪：不用 Modal/Drawer/Popover（AGENTS.md 禁底部抽屉），全部形态是页内内联。 */
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

  /* 分类颗粒度：档位筛选（全部/未掌握/顽固≥4/中2-3/轻1）——书架展示与刷题范围都跟着走 */
  const [tier, setTier] = useState<'all' | 'um' | 't4' | 't2' | 't1'>('all')
  const tierOf = (r: QuizRecord) => r.wrongCount >= 4 ? 't4' : r.wrongCount >= 2 ? 't2' : r.wrongCount >= 1 ? 't1' : 't0'
  const filtered = useMemo(() => {
    if (tier === 'all') return quizRecords
    if (tier === 'um') return quizRecords.filter(isUnmastered)
    return quizRecords.filter(r => tierOf(r) === tier)
  }, [quizRecords, tier])

  const books = useMemo(() => {
    const map = new Map<string, QuizRecord[]>()
    for (const r of filtered) {
      const list = map.get(r.pageTitle)
      if (list) list.push(r)
      else map.set(r.pageTitle, [r])
    }
    return [...map.entries()].map(([title, rs]) => ({ title, records: rs }))
  }, [filtered])

  /* 刷题范围：显式传 pool（按书）> 筛选后的未掌握 > 筛选后的全部；已掌握恒移出 */
  const startRun = (scope?: QuizRecord[]) => {
    const base = scope ?? filtered
    let pool = base.filter(isUnmastered)
    if (!pool.length) pool = base.filter(r => !(r.wrongCount > 0 && r.streakCorrect >= 2))
    if (!pool.length) pool = base
    if (!pool.length) return
    setQueue(shuffle(pool))
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

  /* 跳过：不计分不判掌握，直接到下一题；最后一题跳过 = 结束本轮 */
  const skipQ = () => {
    if (idx + 1 >= queue.length) { setMode('shelf'); return }
    setIdx(i => i + 1); setPicked(null); setShortText(''); setRevealed(false); setSelfOk(null)
  }

  /* 刷题态：一题一屏（对照桌面 QuizMode 沉浸式），视觉居中 + 可退出回书架 */
  if (mode === 'run' && cur) {
    return (
      <section className={'page quiz-run' + (active ? ' active' : '')}>
        <div className="quiz-progress">
          <button className="icon-btn" onClick={() => setMode('shelf')} title="退出本轮，返回书架"><IBack /></button>
          <span>第 {idx + 1} / {queue.length} 题</span>
          <ProgressBar aria-label="刷题进度" value={Math.round((idx + 1) / queue.length * 100)} size="sm" className="qp-hbar">
            <ProgressBarTrack>
              <ProgressBarFill />
            </ProgressBarTrack>
          </ProgressBar>
          <span className="qp-score">答对 {score.ok}</span>
        </div>
        <div className="quiz-card">
          <div className="qc-meta">{cur.pageTitle} · 第 {cur.no} 题 · {cur.type === 'short' ? '简答' : '选择'}</div>
          <div className="qc-q">{cur.question}</div>
          {cur.type === 'choice' ? (
            <div className="qc-opts">
              {cur.options.map(o => {
                let cls = 'hq-opt'
                if (revealed) {
                  if (o.key === cur.answer) cls += ' hq-opt--right'
                  else if (o.key === picked) cls += ' hq-opt--wrong'
                  else cls += ' hq-opt--dim'
                }
                return (
                  <Button key={o.key} variant="secondary" fullWidth className={cls} onClick={() => pickChoice(o.key)} isDisabled={revealed}>
                    <span className="k">{o.key}</span>{o.text}
                    {revealed && o.key === cur.answer && <ICheck size={15} />}
                  </Button>
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
              {!revealed && <Button variant="primary" size="sm" onClick={() => setRevealed(true)} isDisabled={!shortText.trim()}>对答案</Button>}
              {revealed && selfOk === null && (
                <div className="qc-self">
                  <div className="qc-ref"><span className="lbl">参考答案</span>{cur.answer}</div>
                  <div className="qc-selfbtns">
                    <Button variant="primary" size="sm" className="hq-btn--ok" onClick={() => { answerQuiz(cur.id, true); setScore(s => ({ ok: s.ok + 1, total: s.total + 1 })); setSelfOk(true) }}>我答对了</Button>
                    <Button variant="danger-soft" size="sm" onClick={() => { answerQuiz(cur.id, false); setScore(s => ({ ok: s.ok, total: s.total + 1 })); setSelfOk(true) }}>我答错了</Button>
                  </div>
                </div>
              )}
            </div>
          )}
          {!revealed && <Button variant="ghost" size="sm" className="hq-skip" onClick={skipQ}>跳过此题</Button>}
          {revealed && cur.type === 'choice' && (
            <div className="qc-exp"><span className="lbl">解析</span>{cur.explanation}</div>
          )}
          {revealed && cur.type === 'short' && selfOk !== null && (
            <div className="qc-exp"><span className="lbl">解析</span>{cur.explanation}</div>
          )}
          {revealed && (cur.type === 'choice' || selfOk !== null) && (
            <Button variant="primary" fullWidth className="qc-next" onClick={nextQ}>{idx + 1 >= queue.length ? '完成本轮' : '下一题'}</Button>
          )}
        </div>
      </section>
    )
  }

  /* 书架态：错题书架（按来源分书 + 错次档位）+ 档位筛选 + 按书/全局刷题 */
  return (
    <section className={'page' + (active ? ' active' : '')}>
      <PageHead title="错题本">
        <Button variant="primary" size="sm" className="quiz-go" onClick={() => startRun()} isDisabled={!filtered.length}>
          刷题 · {filtered.filter(isUnmastered).length || filtered.length} 道
        </Button>
      </PageHead>
      <div className="quiz-stats">
        <div className="qs"><b>{quizRecords.length}</b><span>总题数</span></div>
        <div className="qs warn"><b>{unmastered.length}</b><span>未掌握</span></div>
        <div className="qs ok"><b>{quizRecords.length - unmastered.length}</b><span>已掌握/未错</span></div>
      </div>
      <ToggleButtonGroup
        aria-label="档位筛选"
        size="sm"
        fullWidth
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={new Set([tier])}
        onSelectionChange={keys => { const k = [...keys][0]; if (k) setTier(k as typeof tier) }}
      >
        {[['all', '全部'], ['um', '未掌握'], ['t4', '顽固 ≥4'], ['t2', '中 2-3'], ['t1', '轻 1']].map(([id, label]) => (
          <ToggleButton key={id} id={id}>{label as string}</ToggleButton>
        ))}
      </ToggleButtonGroup>
      {books.map(b => {
        const worst = b.records.reduce((t, r) => Math.max(t, r.wrongCount), 0)
        const tierLabel = worst >= 4 ? '顽固' : worst >= 2 ? '中' : worst >= 1 ? '轻' : '未错'
        const um = b.records.filter(isUnmastered).length
        return (
          <div key={b.title} className="quiz-book">
            <div className="qb-head">
              <span className={'qb-tier t' + (worst >= 4 ? '4' : worst >= 2 ? '2' : worst >= 1 ? '1' : '0')}>{tierLabel}</span>
              <span className="qb-title">{b.title}</span>
              <span className="qb-count">{b.records.length} 题{um ? ` · ${um} 未掌握` : ''}</span>
              <Button variant="secondary" size="sm" onClick={() => startRun(b.records)}>刷此书</Button>
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
