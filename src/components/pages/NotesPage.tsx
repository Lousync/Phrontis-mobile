import { useEffect, useState } from 'react'
import { mdRender } from '../../lib/data'
import { useApp } from '../../lib/store'
import { IBack, IChevR, IFolder, IPen, ISearch } from '../../components/icons'
import { Grip, Sheet } from '../../components/Sheet'

function NoteSheet() {
  const { closeSheet, addPhoneNote, markPending, toast } = useApp()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const save = () => {
    if (!title.trim()) { toast('先起个标题', 'warn'); return }
    addPhoneNote(title.trim(), body.trim() || '（无正文）')
    markPending('笔记「' + title.trim() + '」')
    toast('已存入手机笔记 · 待上行', 'ok')
    closeSheet()
  }
  return (
    <Sheet>
      <Grip />
      <h3>新建笔记</h3>
      <div className="field"><label>标题</label><input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="想到什么记什么" onKeyDown={e => { if (e.key === 'Enter') save() }} /></div>
      <div className="field"><textarea rows={6} value={body} onChange={e => setBody(e.target.value)} placeholder="正文支持 Markdown…" /></div>
      <button className="btn-primary" onClick={save}>保存到手机</button>
      <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>将作为普通 .md 笔记上行并入仓库</div>
    </Sheet>
  )
}

export function NotesPage({ active }: { active: boolean }) {
  const { folders, toggleFolder, phoneNotes, openSheet, markCached, toast } = useApp()
  const [kw, setKw] = useState('')
  const [reader, setReader] = useState<{ title: string; kind: 'vault' | 'phone' } | null>(null)

  /* 未缓存笔记打开 700ms 后转为已缓存（模拟按需下载） */
  useEffect(() => {
    if (!reader || reader.kind !== 'vault') return
    const file = folders.flatMap(f => f.files).find(x => x.title === reader.title)
    if (file && !file.cached) {
      const t = setTimeout(() => markCached(reader.title), 700)
      return () => clearTimeout(t)
    }
  }, [reader, folders, markCached])

  const kwTrim = kw.trim()
  const openFile = (title: string, kind: 'vault' | 'phone') => setReader({ title, kind })

  let readerMd = ''
  let readerPath = ''
  let readerCached = true
  if (reader) {
    if (reader.kind === 'vault') {
      for (const f of folders) {
        const hit = f.files.find(x => x.title === reader.title)
        if (hit) { readerMd = hit.md; readerPath = hit.path; readerCached = hit.cached; break }
      }
    } else {
      const hit = phoneNotes.find(x => x.title === reader.title)
      if (hit) { readerMd = '# ' + hit.title + '\n\n' + hit.body; readerPath = '手机笔记 / ' + hit.title }
    }
  }

  return (
    <section className={'page' + (active ? ' active' : '')}>
      <div className="search-box">
        <ISearch />
        <input value={kw} onChange={e => setKw(e.target.value)} placeholder="搜索笔记标题" />
      </div>
      <div className="vault-line"><span className="ldot" />已连接仓库「Phrontis」 · 增量缓存</div>

      {folders.map((f, i) => {
        const files = f.files.filter(x => !kwTrim || x.title.includes(kwTrim))
        if (kwTrim && files.length === 0) return null
        return (
          <div key={f.name} className={'folder' + (f.open || kwTrim ? ' open' : '')}>
            <div className="folder-head" onClick={() => toggleFolder(i)}>
              <IFolder style={{ color: 'var(--accent-hover)' }} />
              {f.name}
              <span className="chev"><IChevR /></span>
            </div>
            <div className="folder-files">
              {files.map(x => (
                <div key={x.title} className="file-row" onClick={() => openFile(x.title, 'vault')}>
                  <span className={'c ' + (x.cached ? 'cached' : 'uncached')} />
                  {x.title}
                  <span className="arrow"><IChevR /></span>
                </div>
              ))}
              {!files.length && <div className="empty" style={{ padding: '16px 0' }}>无匹配笔记</div>}
            </div>
          </div>
        )
      })}

      <div className="sec-title" style={{ marginTop: 6 }}>手机笔记 <span className="more">上行同步进仓库</span></div>
      <div className="folder phone-notes">
        <div className="folder-head" style={{ pointerEvents: 'none' }}>
          <IPen size={15} style={{ color: 'var(--amber)' }} />
          手机创建
        </div>
        <div className="folder-files" style={{ display: 'block', borderTop: '1px solid var(--border-soft)' }}>
          {phoneNotes
            .filter(x => !kwTrim || x.title.includes(kwTrim))
            .map(x => (
              <div key={x.id} className="file-row" onClick={() => openFile(x.title, 'phone')}>
                <span className={'c ' + (x.synced ? 'cached' : 'pending')} />
                {x.title}
                <span className={'badge-sync ' + (x.synced ? 'synced' : 'pending')}>{x.synced ? '已同步' : '待同步'}</span>
              </div>
            ))}
          {!phoneNotes.filter(x => !kwTrim || x.title.includes(kwTrim)).length && <div className="empty" style={{ padding: '16px 0' }}>还没有手机笔记</div>}
        </div>
      </div>

      <button className="fab" onClick={() => openSheet('note')}><IPen /></button>

      <div className={'reader' + (reader ? ' open' : '')}>
        <div className="reader-top">
          <button className="icon-btn" onClick={() => setReader(null)}><IBack /></button>
          <span className="path">{readerPath}</span>
          <span className={'badge-sync ' + (readerCached ? 'synced' : 'pending')} style={{ marginLeft: 'auto' }}>
            {readerCached ? '已缓存' : '未缓存 · 下载中…'}
          </span>
        </div>
        <div className="reader-body"><div className="md" dangerouslySetInnerHTML={{ __html: mdRender(readerMd) }} /></div>
        <div className="reader-foot">
          <span className="note">手机端 v1 只读已有笔记，编辑回电脑进行</span>
          <button className="btn-ghost" onClick={() => toast('v1 范围：已有笔记在手机只读，编辑回电脑', 'info')}>编辑</button>
        </div>
      </div>
    </section>
  )
}

export { NoteSheet }
