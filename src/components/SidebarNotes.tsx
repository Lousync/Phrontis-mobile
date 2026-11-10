import { useMemo } from 'react'
import type { ReactNode } from 'react'
import type { NoteTreePage } from '../lib/types'
import { buildTree, type NoteDir } from '../lib/notesTree'
import { useApp } from '../lib/store'
import { fileDisplayName } from '../lib/fileHandoff'
import { ICheck, IChevR, IFolder, IInbox, IPlus, IPen, ISearch } from './icons'

/* 侧栏笔记域内容（design.md §10.1）：搜索框 + 配对状态行 + 仓库文件树 + 手机笔记组。
 * 树状态在 store vault 域（与内容区阅读器共享）；搜索命中分支自动展开。 */
export function SidebarNotes() {
  const {
    paired, vaultKw, setVaultKw, vaultTree, vaultLoading, vaultExpanded, toggleVaultExpand,
    vaultCache, vaultReader, syncSel, toggleSyncDir, toggleSyncNote, noteInSync,
    fetchVaultTree, openVaultNote, openPhoneNote, phoneNotes,
    fileTree, filesLoading, filesSupported, selectedFileId, openVaultFile, fetchVaultFiles,
    localFiles, fileReturns, fileReturnBadge, openFileInbox,
  } = useApp()

  const kwTrim = vaultKw.trim()
  const treeRoot = useMemo(() => buildTree(vaultTree.pages), [vaultTree])
  const fileRoot = useMemo(() => buildTree(fileTree.files.map(f => ({
    id: f.id,
    title: fileDisplayName(f),
    path: f.path,
    categoryId: null,
    mtimeMs: f.mtimeMs,
    sizeBytes: f.sizeBytes,
  }))), [fileTree])
  const pendingFileIds = useMemo(() => new Set(
    fileReturns
      .filter(r => r.fileId && (r.status === 'ready' || r.status === 'uploading' || r.status === 'queued' || r.status === 'error'))
      .map(r => r.fileId as string),
  ), [fileReturns])
  const fileById = useMemo(() => new Map(fileTree.files.map(f => [f.id, f])), [fileTree])
  const selCount = useMemo(() => vaultTree.pages.filter(noteInSync).length, [vaultTree, noteInSync])
  const isFresh = (p: NoteTreePage) => {
    const hit = vaultCache[p.id]
    return !!hit && hit.mtimeMs === p.mtimeMs
  }

  const SyncToggle = ({ on, onToggle }: { on: boolean; onToggle: () => void }) => (
    <button
      className={'icon-btn vt-toggle' + (on ? ' on' : '')}
      title={on ? '移出同步范围' : '加入同步范围'}
      onClick={e => { e.stopPropagation(); onToggle() }}
    >
      {on ? <ICheck size={14} /> : <IPlus size={14} />}
    </button>
  )

  /* 目录 count：递归文件数（直属 files 常为 0，只显示直属数不友好） */
  const countDeep = (d: NoteDir): number => d.files.length + d.dirs.reduce((t, x) => t + countDeep(x), 0)

  const renderDir = (node: NoteDir, depth: number): ReactNode => {
    const kwFiles = kwTrim ? node.files.filter(x => x.title.includes(kwTrim)) : node.files
    const subDirs = kwTrim ? node.dirs.filter(hasMatch) : node.dirs
    if (kwTrim && !kwFiles.length && !subDirs.length) return null
    const open = !!vaultExpanded[node.path] || !!kwTrim || depth === 0
    return (
      <div key={node.path || '__root__'}>
        {depth > 0 && (
          <div
            className="vt-row dir"
            style={{ paddingLeft: 4 + depth * 14 }}
            onClick={() => toggleVaultExpand(node.path)}
          >
            <span className={'chev' + (open ? ' on' : '')}><IChevR size={12} /></span>
            <IFolder size={14} style={{ color: 'var(--accent-hover)' }} />
            <span className="vt-name">{node.name}</span>
            <span className="count">{countDeep(node)}</span>
            <SyncToggle on={syncSel.dirs.includes(node.path)} onToggle={() => toggleSyncDir(node.path)} />
          </div>
        )}
        {open && (
          <div>
            {subDirs.map(d => renderDir(d, depth + 1))}
            {kwFiles.map(x => (
              <div
                key={x.id}
                className={'vt-row file' + (vaultReader?.path === x.path ? ' on' : '')}
                style={{ paddingLeft: 4 + (depth + 1) * 14 }}
                onClick={() => openVaultNote(x)}
              >
                <span className={'c ' + (isFresh(x) ? 'cached' : 'uncached')} />
                <span className="vt-name">{x.title}</span>
                <SyncToggle on={noteInSync(x)} onToggle={() => toggleSyncNote(x.id)} />
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }
  /* 搜索过滤辅助：目录分支下（含孙级）是否有匹配文件 */
  const hasMatch = (d: NoteDir): boolean =>
    d.files.some(x => x.title.includes(kwTrim)) || d.dirs.some(hasMatch)

  /* PDF 交接树：与笔记树同构，但行尾状态是「已下载 / 待回传」而非同步勾选 */
  const renderFileDir = (node: NoteDir, depth: number): ReactNode => {
    const kwFiles = kwTrim ? node.files.filter(x => x.title.includes(kwTrim)) : node.files
    const subDirs = kwTrim ? node.dirs.filter(hasFileMatch) : node.dirs
    if (kwTrim && !kwFiles.length && !subDirs.length) return null
    const open = !!vaultExpanded[node.path] || !!kwTrim || depth === 0
    return (
      <div key={'f:' + (node.path || '__root__')}>
        {depth > 0 && (
          <div className="vt-row dir" style={{ paddingLeft: 4 + depth * 14 }}
            onClick={() => toggleVaultExpand(node.path)}>
            <span className={'chev' + (open ? ' on' : '')}><IChevR size={12} /></span>
            <IFolder size={14} style={{ color: 'var(--accent-hover)' }} />
            <span className="vt-name">{node.name}</span>
            <span className="count">{countDeep(node)}</span>
          </div>
        )}
        {open && (
          <div>
            {subDirs.map(d => renderFileDir(d, depth + 1))}
            {kwFiles.map(x => {
              const pending = pendingFileIds.has(x.id)
              const local = !!localFiles[x.id]
              return (
                <div key={x.id}
                  className={'vt-row file' + (selectedFileId === x.id ? ' on' : '')}
                  style={{ paddingLeft: 4 + (depth + 1) * 14 }}
                  title={x.path}
                  onClick={() => { const f = fileById.get(x.id); if (f) openVaultFile(f) }}>
                  <span className="fh-pdf-mini">PDF</span>
                  <span className="vt-name">{x.title}</span>
                  {pending
                    ? <span className="fh-dot warn" title="有待回传文件" />
                    : local
                      ? <span className="fh-dot ok" title="已下载到 iPad" />
                      : <span className="fh-dot idle" title="未下载" />}
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }
  const hasFileMatch = (d: NoteDir): boolean =>
    d.files.some(x => x.title.includes(kwTrim)) || d.dirs.some(hasFileMatch)

  return (
    <div className="tb-domain-body">
      <div className="search-box tb-search">
        <ISearch size={13} />
        <input value={vaultKw} onChange={e => setVaultKw(e.target.value)} placeholder="搜索笔记 / PDF" />
      </div>
      <button className="vault-line" onClick={fetchVaultTree} disabled={!paired || vaultLoading}
        title={paired ? '重新拉取电脑笔记目录' : undefined}>
        <span className="ldot" />
        {paired
          ? (vaultLoading
            ? '正在拉取目录…'
            : '已连接 ' + paired.pcName + ' · 全仓 ' + vaultTree.pages.length + ' 篇 · 已选同步 ' + selCount + ' 篇（点击刷新）')
          : '未配对电脑 · 配对后可看仓库笔记'}
      </button>
      <div className="tb-tree">
        {renderDir(treeRoot, 0)}
        {paired && !vaultLoading && !vaultTree.pages.length && (
          fileTree.files.length
            ? <div className="fh-side-empty">仓库没有可读的 md 笔记</div>
            : <div className="tb-tree-empty">仓库没有可读的 md 笔记（或目录还没拉到）</div>
        )}
        {/* PDF 交接区（§2.3）：只列 PDF；旧桌面 404 时给一次可重试的提示，不反复打扰 */}
        {(paired || fileTree.files.length > 0) && filesSupported !== false && (
          <div className="tb-phone-sec fh-side-sec">
            <div className="dom-title">
              PDF 交接
              <span className="more">{filesLoading ? '刷新中…' : fileTree.files.length + ' 个 · 只读'}</span>
            </div>
            {fileTree.files.length
              ? renderFileDir(fileRoot, 0)
              : <div className="fh-side-empty">电脑里没有可交接的 PDF（或目录还没拉到）</div>}
          </div>
        )}
        {paired && filesSupported === false && (
          <button className="fh-unsupported" onClick={() => fetchVaultFiles(false)}>
            文件交接未启用 · 点此重试
          </button>
        )}
        {/* 手机笔记组：平板侧栏的只读入口（上行同步进电脑收件箱） */}
        {phoneNotes.filter(x => !kwTrim || x.title.includes(kwTrim)).length > 0 && (
          <div className="tb-phone-sec">
            <div className="dom-title">手机笔记 <span className="more">上行进电脑收件箱</span></div>
            {phoneNotes
              .filter(x => !kwTrim || x.title.includes(kwTrim))
              .map(x => (
                <div
                  key={x.id}
                  className={'vt-row file' + (vaultReader?.title === x.title ? ' on' : '')}
                  style={{ paddingLeft: 4 }}
                  onClick={() => openPhoneNote(x.id)}
                >
                  <span className={'c ' + (x.synced ? 'cached' : 'pending')} />
                  <span className="vt-name">{x.title}</span>
                  <span className={'badge-sync ' + (x.synced ? 'synced' : 'pending')}>{x.synced ? '已同步' : '待同步'}</span>
                </div>
              ))}
          </div>
        )}
      </div>
      <button className="fh-inbox-entry" onClick={e => openFileInbox(e.currentTarget)}>
        <IInbox size={14} />
        <span>回传收件箱</span>
        {fileReturnBadge > 0 && <span className="fh-badge">{fileReturnBadge}</span>}
      </button>
    </div>
  )
}
