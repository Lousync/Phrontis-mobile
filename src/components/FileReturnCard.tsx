import { useEffect, useState } from 'react'
import type { FileReturnItem } from '../lib/types'
import { useApp } from '../lib/store'
import { formatBytes, formatFileTime } from '../lib/fileHandoff'

function StatusChip({ item }: { item: FileReturnItem }) {
  const map: Record<FileReturnItem['status'], { label: string; cls: string }> = {
    ready: { label: '待回传', cls: 'warn' },
    uploading: { label: '上传中', cls: 'mid' },
    queued: { label: '排队中', cls: 'warn' },
    done: { label: '已回传', cls: 'ok' },
    ignored: { label: '已忽略', cls: '' },
    error: { label: '需重试', cls: 'err' },
  }
  const s = map[item.status]
  return <span className={'fh-chip ' + s.cls}>{s.label}</span>
}

/** 单条回传卡（文件面板内联 / 回传收件箱共用）：文件名可就地改，上传后原位显示进度 */
export function FileReturnCard({ item, showSource = true }: { item: FileReturnItem; showSource?: boolean }) {
  const { submitFileReturn, ignoreFileReturn, fileBusy } = useApp()
  const [name, setName] = useState(item.targetName)
  useEffect(() => { setName(item.targetName) }, [item.targetName])
  const busy = item.status === 'uploading'
  const staging = fileBusy?.kind === 'stage'

  return (
    <div className={'fh-return ' + item.status}>
      <div className="fh-return-top">
        <StatusChip item={item} />
        {showSource && <span className="fh-chip">{item.origin === 'share' ? 'Prodrafts 分享' : '从「文件」选择'}</span>}
        <span className="fh-return-time">{formatFileTime(item.receivedAt)}</span>
      </div>

      <div className="fh-return-file">
        <span className="fh-pdf-badge">PDF</span>
        <div className="fh-return-main">
          <div className="fh-return-name">{item.sourceName}</div>
          <div className="fh-return-sub">
            {item.sizeBytes > 0 ? formatBytes(item.sizeBytes) + ' · ' : ''}
            {item.origin === 'share' ? '来自系统分享' : '本机文件'}
          </div>
        </div>
      </div>

      <div className="fh-target">
        <span className="fh-folder">iPad 批注/</span>
        <span>只另存副本，不覆盖原文件</span>
      </div>

      {busy ? (
        <div className="fh-progress-box">
          <div className="fh-progress-top">
            <span>正在上传到电脑…</span>
            <span className="fh-pct">{Math.round(item.progress || 0)}%</span>
          </div>
          <div className="fh-track"><div className="fh-fill" style={{ width: Math.round(item.progress || 0) + '%' }} /></div>
          <div className="fh-hint">{item.targetName}</div>
        </div>
      ) : item.status === 'done' ? (
        <div className="fh-done-line">
          <span>已保存为 <code>{item.remotePath || item.targetName}</code></span>
        </div>
      ) : item.status === 'ignored' ? (
        <div className="fh-hint">已忽略这次回传，电脑上的文件未改动。</div>
      ) : item.status === 'queued' ? (
        <>
          <div className="fh-notice warn">
            <span>电脑当前离线，已加入队列；连接恢复后自动上传。</span>
          </div>
          <div className="fh-actions">
            <button className="btn-primary fh-btn" onClick={() => void submitFileReturn(item.id, name)} disabled={staging}>立即重试</button>
            <button className="btn-ghost" onClick={() => ignoreFileReturn(item.id)}>忽略</button>
          </div>
        </>
      ) : item.status === 'error' ? (
        <>
          <div className="fh-notice err">{item.error || '上传失败，请重试'}</div>
          <div className="fh-actions">
            <button className="btn-primary fh-btn" onClick={() => void submitFileReturn(item.id, name)} disabled={staging}>重试上传</button>
            <button className="btn-ghost" onClick={() => ignoreFileReturn(item.id)}>忽略</button>
          </div>
        </>
      ) : (
        <>
          <label className="fh-field">
            <span>文件名</span>
            <input value={name} onChange={e => setName(e.target.value)} spellCheck={false} disabled={staging} />
          </label>
          <div className="fh-hint">重名会自动加 (2)；(3)…原文件与已有副本都不会被覆盖。</div>
          <div className="fh-actions">
            <button className="btn-primary fh-btn" onClick={() => void submitFileReturn(item.id, name)} disabled={staging}>
              {staging ? '准备文件…' : '开始上传'}
            </button>
            <button className="btn-ghost" onClick={() => ignoreFileReturn(item.id)} disabled={staging}>忽略</button>
          </div>
        </>
      )}
    </div>
  )
}

/** 历史行（收件箱 / 文件面板的最近回传） */
export function FileReturnRow({ item, onRemove }: { item: FileReturnItem; onRemove?: (id: string) => void }) {
  const label = item.status === 'done' ? '已回传' : item.status === 'ignored' ? '已忽略' : item.status === 'queued' ? '排队中' : item.status === 'error' ? '需重试' : '处理中'
  const cls = item.status === 'done' ? 'ok' : item.status === 'ignored' ? '' : item.status === 'error' ? 'err' : 'warn'
  return (
    <div className="fh-row">
      <span className="fh-pdf-badge sm">PDF</span>
      <div className="fh-row-main">
        <div className="fh-row-name">{item.targetName}</div>
        <div className="fh-row-sub">
          {formatFileTime(item.doneAt || item.receivedAt)} · {item.remotePath || (item.status === 'ignored' ? '未上传' : '—')}
        </div>
      </div>
      <span className={'fh-chip ' + cls}>{label}</span>
      {onRemove && item.status !== 'uploading' && (
        <button className="fh-row-x" onClick={() => onRemove(item.id)} title="从记录中移除">×</button>
      )}
    </div>
  )
}
