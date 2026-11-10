import { useMemo } from 'react'
import { useApp } from '../lib/store'
import { FullPage, FullPageHead } from './FullPage'
import { FileReturnCard, FileReturnRow } from './FileReturnCard'
import { IInbox, IPlus } from './icons'

/** 回传收件箱（全屏子页，停靠内容区；多文件 + 历史，禁止 bottom sheet） */
export function FileInbox() {
  const { fileReturns, pickReturnFile, fileBusy, removeFileReturn, filesLoading } = useApp()
  const active = useMemo(
    () => fileReturns.filter(r => r.status === 'ready' || r.status === 'uploading' || r.status === 'queued' || r.status === 'error')
      .sort((a, b) => b.receivedAt - a.receivedAt),
    [fileReturns],
  )
  const history = useMemo(
    () => fileReturns.filter(r => r.status === 'done' || r.status === 'ignored')
      .sort((a, b) => (b.doneAt || b.receivedAt) - (a.doneAt || a.receivedAt)),
    [fileReturns],
  )
  const staging = fileBusy?.kind === 'stage'
  const empty = !active.length && !history.length

  return (
    <FullPage>
      <FullPageHead title="回传收件箱">
        <button className="fh-head-act" onClick={() => void pickReturnFile()} disabled={staging}>
          <IPlus size={14} />{staging ? '准备中…' : '选择 PDF'}
        </button>
      </FullPageHead>
      <div className={'fp-body fh-body' + (empty ? ' flex' : '')}>
        {empty ? (
          <div className="empty-spring fh-empty">
            <div>
              <div className="fh-empty-ic"><IInbox size={24} /></div>
              <div className="fh-empty-t">暂无待回传文件</div>
              <div className="fh-empty-s">
                Prodrafts 导出 PDF 后分享回 Phrontis，或点右上角从「文件」选择。
              </div>
              <button className="btn-primary fh-btn" onClick={() => void pickReturnFile()} disabled={staging}>选择 PDF 回传</button>
            </div>
          </div>
        ) : (
          <div className="fh-col">
            <div className="fh-sect">
              <span>待回传</span>
              <span className="fh-sect-n">{active.length} 个</span>
            </div>
            {active.length ? (
              <div className="fh-return-list">
                {active.map(r => <FileReturnCard key={r.id} item={r} />)}
              </div>
            ) : (
              <div className="fh-empty-line">没有待回传文件</div>
            )}

            <div className="fh-sect" style={{ marginTop: 26 }}>
              <span>最近回传</span>
              <span className="fh-sect-n">{history.length} 条</span>
            </div>
            {history.length ? (
              <div className="fh-card fh-history">
                {history.map(r => (
                  <FileReturnRow key={r.id} item={r} onRemove={removeFileReturn} />
                ))}
              </div>
            ) : (
              <div className="fh-empty-line">还没有回传记录</div>
            )}

            <div className="fh-foot">
              <span>回传只写到 <code>iPad 批注/</code>；电脑上的原文件不改动。重名自动加 (2)。</span>
              {filesLoading && <span>· 正在刷新文件目录…</span>}
            </div>
          </div>
        )}
      </div>
    </FullPage>
  )
}
