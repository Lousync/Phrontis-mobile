import { useState } from 'react'
import type { QuizRecord, QuizSpec } from '../lib/types'
import { useApp } from '../lib/store'
import { ICheck } from './icons'

/* md 阅读器的 quiz 围栏题卡（对照桌面 MarkdownPreview 的题卡渲染）：
 * 读文档过程中就地作答，判分 + 解析 + 错题回流（按 文档+题号 upsert，掌握判定与桌面同规）。 */
export function QuizCard({ spec, pageId, pageTitle, record }: {
  spec: QuizSpec
  pageId: string
  pageTitle: string
  record?: QuizRecord
}) {
  const { upsertQuizAnswer } = useApp()
  const [picked, setPicked] = useState<string | null>(null)
  const [shortText, setShortText] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [selfOk, setSelfOk] = useState<boolean | null>(null)
  const correct = picked === spec.answer

  const judge = (ok: boolean) => {
    setRevealed(true)
    upsertQuizAnswer(pageId, pageTitle, spec, ok)
  }

  const mastered = record ? record.wrongCount > 0 && record.streakCorrect >= 2 : null

  return (
    <div className="quiz-card qc-inline">
      <div className="qc-meta">
        第 {spec.no} 题 · {spec.type === 'short' ? '简答' : '选择'}
        {mastered !== null && <span className={'badge-sync ' + (mastered ? 'synced' : 'pending')}>{mastered ? '已掌握' : `错 ${record?.wrongCount} 次`}</span>}
      </div>
      <div className="qc-q">{spec.question}</div>
      {spec.type === 'choice' ? (
        <div className="qc-opts">
          {spec.options.map(o => {
            let cls = 'qc-opt'
            if (revealed) {
              if (o.key === spec.answer) cls += ' right'
              else if (o.key === picked) cls += ' wrong'
            }
            return (
              <button key={o.key} className={cls} onClick={() => { setPicked(o.key); judge(o.key === spec.answer) }} disabled={revealed}>
                <span className="k">{o.key}</span>{o.text}
                {revealed && o.key === spec.answer && <ICheck size={15} />}
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
              <div className="qc-ref"><span className="lbl">参考答案</span>{spec.referenceAnswer || spec.answer}</div>
              <div className="qc-selfbtns">
                <button className="btn-ok" onClick={() => { setSelfOk(true); judge(true) }}>我答对了</button>
                <button className="btn-bad" onClick={() => { setSelfOk(false); judge(false) }}>我答错了</button>
              </div>
            </div>
          )}
        </div>
      )}
      {revealed && spec.explanation && (
        <div className="qc-exp"><span className="lbl">解析</span>{spec.explanation}</div>
      )}
    </div>
  )
}
