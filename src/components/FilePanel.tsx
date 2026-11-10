import { useMemo } from 'react'
import { useApp } from '../lib/store'
import { fileDisplayName, formatBytes, formatFileTime, isNativeFileChannel } from '../lib/fileHandoff'
import { IBack, IFilePdf, IInbox, IUpload } from './icons'
import { FileReturnCard, FileReturnRow } from './FileReturnCard'

/** 文件面板（iPad 内容区 / 手机阅读器覆盖层）：PDF 只做交接，不在应用内渲染 */
export function FilePanel() {
  const {
    selectedFile, closeVaultFile, localFiles, fileBusy, prepareVaultFile, deleteVaultFileLocal,
    fileReturns, pickReturnFile, openFileInbox, filesLoading,
  } = useApp()
  const file = selectedFile
  const fileId = file?.id
  const pending = useMemo(
    () => fileReturns.filter(r => r.fileId === fileId && (r.status === 'ready' || r.status === 'uploading' || r.status === 'queued' || r.status === 'error'))
      .sort((a, b) => b.receivedAt - a.receivedAt),
    [fileReturns, fileId],
  )
  const doneForFile = useMemo(
    () => fileReturns.filter(r => r.fileId === fileId && (r.status === 'done' || r.status === 'ignored'))
      .sort((a, b) => (b.doneAt || b.receivedAt) - (a.doneAt || a.receivedAt)),
    [fileReturns, fileId],
  )
  if (!file) return null

  const local = localFiles[file.id]
  const busy = fileBusy?.id === file.id ? fileBusy : null
  const staging = fileBusy?.kind === 'stage'
  const latestDone = doneForFile.find(r => r.status === 'done')
  const stale = !!local && local.mtimeMs !== file.mtimeMs
  const name = fileDisplayName(file)
  const folder = file.path.split('/').slice(0, -1).join(' / ')

  return (
    <>
      <div className="reader-top">
        <button className="icon-btn" onClick={closeVaultFile} title="返回列表"><IBack /></button>
        <span className="path">{folder || 'vault 根目录'}</span>
        <span className="badge-sync synced">PDF</span>
      </div>
      <div className="reader-body fh-body">
        <div className="fh-col">
          <section className="fh-hero">
            <div className="fh-hero-top">
              <div className="fh-pdf-lg">PDF</div>
              <div className="fh-hero-main">
                <h2 className="fh-name">{name}</h2>
                <div className="fh-path">{file.path}</div>
                <div className="fh-facts">
                  <span className="ph-chip">PDF</span>
                  <span className="ph-chip">{formatBytes(file.sizeBytes)}</span>
                  <span className="ph-chip">修改于 {formatFileTime(file.mtimeMs)}</span>
                  {local
                    ? <span className={'ph-chip ' + (stale ? 'fh-chip warn' : 'fh-chip ok')}>{stale ? '本机副本较旧' : '已下载到 iPad'}</span>
                    : <span className="ph-chip">未下载</span>}
                </div>
              </div>
            </div>

            <div className="fh-actions fh-hero-actions">
              <button className="btn-primary fh-btn" disabled={!!busy || staging}
                onClick={() => void prepareVaultFile(file, 'share')}>
                {busy ? `下载中 ${Math.round(busy.pct)}%` : local ? '用其他应用打开' : '下载并打开'}
              </button>
              <button className="btn-ghost" disabled={!!busy || staging}
                onClick={() => void prepareVaultFile(file, 'download')}>
                {stale ? '下载新版' : '仅下载'}
              </button>
              {local && (
                <button className="btn-ghost fh-danger" disabled={!!busy}
                  onClick={() => void deleteVaultFileLocal(file.id)}>删除本地副本</button>
              )}
            </div>
            {busy && (
              <div className="fh-progress-box">
                <div className="fh-progress-top"><span>正在从电脑下载…</span><span className="fh-pct">{Math.round(busy.pct)}%</span></div>
                <div className="fh-track"><div className="fh-fill" style={{ width: Math.round(busy.pct) + '%' }} /></div>
              </div>
            )}
            <div className="fh-hint">
              {isNativeFileChannel()
                ? '下载后点「用其他应用打开」，在系统分享面板选 Prodrafts；批注完导出 PDF，再分享回 Phrontis。'
                : '浏览器会尝试系统分享（支持时）或直接下载；文件交接的完整链路请在 iPad App 上验收。'}
            </div>
          </section>

          <section className="fh-card">
            <div className="fh-card-head">
              <span><IUpload size={15} /> 回传批注稿</span>
              <button className="fh-link" onClick={() => void pickReturnFile(file.id)} disabled={staging}>
                {staging ? '准备中…' : '选择 PDF'}
              </button>
            </div>
            <div className="fh-hint">
              从「文件」选 Prodrafts 导出的 PDF；也可以直接在 Prodrafts 里用分享面板发给 Phrontis。
              回传只写到 <code>iPad 批注/</code>，电脑上的原文件永不覆盖。
            </div>
            {pending.length > 0 && (
              <div className="fh-return-list">
                {pending.map(r => <FileReturnCard key={r.id} item={r} />)}
              </div>
            )}
            {!pending.length && !latestDone && (
              <div className="fh-empty-line">还没有待回传文件</div>
            )}
          </section>

          {latestDone && !pending.length && (
            <div className="fh-success">
              <span className="fh-success-ic">✓</span>
              <div className="fh-success-main">
                <div className="fh-success-t">已回传电脑</div>
                <div className="fh-success-s">电脑端已保存为 <code>{latestDone.remotePath || latestDone.targetName}</code></div>
              </div>
              <button className="fh-link" onClick={e => openFileInbox(e.currentTarget)}>查看记录</button>
            </div>
          )}

          <section className="fh-card">
            <div className="fh-card-head">
              <span><IInbox size={15} /> 最近回传</span>
              <button className="fh-link" onClick={e => openFileInbox(e.currentTarget)}>全部记录</button>
            </div>
            {doneForFile.length ? (
              <div className="fh-row-list">
                {doneForFile.slice(0, 4).map(r => <FileReturnRow key={r.id} item={r} />)}
              </div>
            ) : (
              <div className="fh-empty-line">这个文件还没有回传记录</div>
            )}
          </section>

          <div className="fh-foot">
            <IFilePdf size={13} />
            <span>v1 只列 PDF；Prodrafts 导出时选「全部导出」，保留页面背景与注解。</span>
            {filesLoading && <span>· 正在刷新目录…</span>}
          </div>
        </div>
      </div>
    </>
  )
}
