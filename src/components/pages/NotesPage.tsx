import { useEffect, useMemo, useState } from 'react'
import type { NoteCache, NoteTreePage } from '../../lib/types'
import { mdRender } from '../../lib/data'
import { useApp } from '../../lib/store'
import {
  fetchNoteContent, fetchNoteTree, loadNoteCache, loadNoteTree, saveNoteCache, saveNoteTree,
} from '../../lib/sync'
import { IBack, IChevR, IFolder, IPen, ISearch } from '../../components/icons'
import { Grip, Sheet } from '../../components/Sheet'

function NoteSheet() {
  const { closeSheet, addPhoneNote, toast } = useApp()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const save = () => {
    if (!title.trim()) { toast('先起个标题', 'warn'); return }
    addPhoneNote(title.trim(), body.trim() || '（无正文）')
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
      <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>将作为普通 .md 笔记上行并入电脑收件箱</div>
    </Sheet>
  )
}

/** 电脑笔记目录树：按 path 顶层目录分组（.knowbase/ 内 → 收件箱），根级散页归「根目录」 */
function buildFolders(pages: NoteTreePage[]): Array<{ name: string; pages: NoteTreePage[] }> {
  const groups = new Map<string, NoteTreePage[]>()
  for (const p of pages) {
    const seg = p.path.split('/')
    const top = seg.length > 1 ? (seg[0].startsWith('.') ? '收件箱' : seg[0]) : '根目录'
    const list = groups.get(top)
    if (list) list.push(p)
    else groups.set(top, [p])
  }
  return [...groups.entries()]
    .map(([name, ps]) => ({ name, pages: ps.slice().sort((a, b) => a.title.localeCompare(b.title)) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
}

export function NotesPage({ active }: { active: boolean }) {
  const { phoneNotes, openSheet, toast, paired } = useApp()
  const [kw, setKw] = useState('')
  const [tree, setTree] = useState(() => loadNoteTree())
  const [loadingTree, setLoadingTree] = useState(false)
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({})
  const [cache, setCache] = useState<NoteCache>(() => loadNoteCache())
  const [reader, setReader] = useState<{ title: string; path: string; kind: 'vault' | 'phone' } | null>(null)
  const [readerBody, setReaderBody] = useState('')
  const [readerState, setReaderState] = useState<'cached' | 'loading' | 'error'>('cached')

  /* 进入本页且已配对 → 自动拉目录树（失败退回本地缓存树 + toast） */
  useEffect(() => {
    if (!active || !paired) return
    let cancelled = false
    setLoadingTree(true)
    fetchNoteTree()
      .then(pages => {
        if (cancelled) return
        saveNoteTree(pages)
        setTree({ fetchedAt: Date.now(), pages })
      })
      .catch((e: Error) => { if (!cancelled) toast(e.message, 'warn') })
      .finally(() => { if (!cancelled) setLoadingTree(false) })
    return () => { cancelled = true }
  }, [active, paired, toast])

  const folders = useMemo(() => buildFolders(tree.pages), [tree])
  const kwTrim = kw.trim()

  /** 打开电脑笔记：缓存且与 tree 版本一致（mtimeMs 对账）→ 直接读；否则在线拉取并落缓存 */
  const openVaultNote = (page: NoteTreePage) => {
    const hit = cache[page.id]
    const fresh = hit && hit.mtimeMs === page.mtimeMs
    setReader({ title: page.title, path: page.path, kind: 'vault' })
    if (fresh) {
      setReaderBody(hit.body)
      setReaderState('cached')
      return
    }
    setReaderBody('')
    setReaderState('loading')
    fetchNoteContent(page.id)
      .then(c => {
        setReaderBody(c.body)
        setReaderState('cached')
        setCache(prev => {
          const next = { ...prev, [page.id]: { title: page.title, body: c.body, mtimeMs: page.mtimeMs, at: Date.now() } }
          saveNoteCache(next)
          return next
        })
      })
      .catch((e: Error) => {
        setReaderState('error')
        toast(e.message, 'warn')
      })
  }

  const openPhoneNote = (id: string) => {
    const hit = phoneNotes.find(x => x.id === id)
    if (!hit) return
    setReader({ title: hit.title, path: '手机笔记 / ' + hit.title, kind: 'phone' })
    setReaderBody('# ' + hit.title + '\n\n' + hit.body)
    setReaderState('cached')
  }

  const isFresh = (page: NoteTreePage) => !!cache[page.id] && cache[page.id].mtimeMs === page.mtimeMs

  return (
    <section className={'page' + (active ? ' active' : '')}>
      <div className="search-box">
        <ISearch />
        <input value={kw} onChange={e => setKw(e.target.value)} placeholder="搜索笔记标题" />
      </div>
      <div className="vault-line">
        <span className="ldot" />
        {paired
          ? (loadingTree ? '正在拉取目录…' : '已连接 ' + paired.pcName + ' · ' + tree.pages.length + ' 篇 · 增量缓存')
          : '未配对电脑 · 配对后可看仓库笔记'}
      </div>

      {folders.map(f => {
        const files = f.pages.filter(x => !kwTrim || x.title.includes(kwTrim))
        if (kwTrim && files.length === 0) return null
        const open = !!openMap[f.name] || !!kwTrim
        return (
          <div key={f.name} className={'folder' + (open ? ' open' : '')}>
            <div className="folder-head" onClick={() => setOpenMap(m => ({ ...m, [f.name]: !m[f.name] }))}>
              <IFolder style={{ color: 'var(--accent-hover)' }} />
              {f.name}
              <span className="count">{f.pages.length}</span>
              <span className="chev"><IChevR /></span>
            </div>
            <div className="folder-files">
              {files.map(x => (
                <div key={x.id} className="file-row" onClick={() => openVaultNote(x)}>
                  <span className={'c ' + (isFresh(x) ? 'cached' : 'uncached')} />
                  {x.title}
                  <span className="arrow"><IChevR /></span>
                </div>
              ))}
              {!files.length && <div className="empty" style={{ padding: '16px 0' }}>无匹配笔记</div>}
            </div>
          </div>
        )
      })}
      {paired && !loadingTree && !folders.length && <div className="empty" style={{ padding: '20px 0' }}>仓库没有可读的 md 笔记（或目录还没拉到）</div>}

      <div className="sec-title" style={{ marginTop: 6 }}>手机笔记 <span className="more">上行同步进电脑收件箱</span></div>
      <div className="folder phone-notes">
        <div className="folder-head" style={{ pointerEvents: 'none' }}>
          <IPen size={15} style={{ color: 'var(--amber)' }} />
          手机创建
        </div>
        <div className="folder-files" style={{ display: 'block', borderTop: '1px solid var(--border-soft)' }}>
          {phoneNotes
            .filter(x => !kwTrim || x.title.includes(kwTrim))
            .map(x => (
              <div key={x.id} className="file-row" onClick={() => openPhoneNote(x.id)}>
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
          <span className="path">{reader?.path}</span>
          <span className={'badge-sync ' + (readerState === 'cached' ? 'synced' : 'pending')} style={{ marginLeft: 'auto' }}>
            {readerState === 'cached' ? '已缓存' : readerState === 'loading' ? '下载中…' : '加载失败'}
          </span>
        </div>
        <div className="reader-body"><div className="md" dangerouslySetInnerHTML={{ __html: mdRender(readerBody) }} /></div>
        <div className="reader-foot">
          <span className="note">{reader?.kind === 'phone' ? '手机笔记上行后在电脑收件箱继续整理' : '手机端 v1 只读电脑笔记，编辑回电脑进行'}</span>
        </div>
      </div>
    </section>
  )
}

export { NoteSheet }
