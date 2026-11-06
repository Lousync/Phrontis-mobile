import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { NoteCache, NoteTreePage } from '../../lib/types'
import { mdRender } from '../../lib/data'
import { useApp } from '../../lib/store'
import {
  fetchNoteContent, fetchNoteTree, loadNoteCache, loadNoteTree, saveNoteCache, saveNoteTree,
} from '../../lib/sync'
import { IBack, IBars, IChevR, IFolder, IPen, ISearch } from '../../components/icons'
import { PageHead } from '../../components/chrome'

/* 备忘录式内容→条目：首行为标题（去掉 markdown # 前缀），其余为正文 */
function splitTitleBody(text: string): { title: string; body: string } {
  const t = text.trim()
  if (!t) return { title: '', body: '' }
  const lines = t.split('\n')
  const title = (lines[0].replace(/^#\s*/, '').trim() || '无标题').slice(0, 60)
  const body = lines.length > 1 ? lines.slice(1).join('\n').trim() : ''
  return { title, body }
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

type TocItem = { id: string; text: string; level: number }

const FONT_KEY = 'tb-reader-font'

export function NotesPage({ active }: { active: boolean }) {
  const { phoneNotes, toast, paired, createPhoneNote, updatePhoneNote, discardPhoneNote, syncPhoneNote } = useApp()
  const [kw, setKw] = useState('')
  const [tree, setTree] = useState(() => loadNoteTree())
  const [loadingTree, setLoadingTree] = useState(false)
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({})
  const [cache, setCache] = useState<NoteCache>(() => loadNoteCache())
  const [reader, setReader] = useState<{ title: string; path: string; kind: 'vault' | 'phone' } | null>(null)
  const [readerBody, setReaderBody] = useState('')
  const [readerState, setReaderState] = useState<'cached' | 'loading' | 'error'>('cached')
  /* T1 阅读体验：字号可调（localStorage 持久化）+ 标题目录跳转 */
  const [fontSz, setFontSz] = useState(() => {
    const v = Number(localStorage.getItem(FONT_KEY))
    return v >= 12 && v <= 22 ? v : 15
  })
  const [tocOpen, setTocOpen] = useState(false)
  const [toc, setToc] = useState<TocItem[]>([])
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => { localStorage.setItem(FONT_KEY, String(fontSz)) }, [fontSz])

  /* 渲染后从真实 DOM 收集 h1–h3：编号写入 id，同时产出目录数据 */
  useEffect(() => {
    const el = bodyRef.current
    if (!el || !reader) { setToc([]); return }
    const items: TocItem[] = []
    el.querySelectorAll('h1, h2, h3').forEach((h, i) => {
      const id = 'md-h-' + i
      ;(h as HTMLElement).id = id
      items.push({ id, text: (h.textContent || '').slice(0, 48), level: Number(h.tagName[1]) })
    })
    setToc(items)
    setTocOpen(false)
  }, [readerBody, reader])

  const jumpTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  /* ---------- 备忘录式即建即编（弃抽屉表单） ----------
   * 新建 → 本地空笔记直接进编辑器，光标就位即写；
   * 首行即标题（列表实时跟手），内容实时落本地防丢；
   * 退出时：有内容 → 入上行队列，空 → 静默丢弃不留垃圾。 */
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const startNewNote = () => {
    setReader(null)
    setEditingId(createPhoneNote())
    setDraft('')
  }
  const onDraft = (v: string) => {
    setDraft(v)
    if (!editingId) return
    const { title, body } = splitTitleBody(v)
    updatePhoneNote(editingId, title, body)
  }
  const exitEditor = () => {
    if (!editingId) return
    const { title, body } = splitTitleBody(draft)
    if (!title || title === '无标题') { discardPhoneNote(editingId); toast('空笔记已丢弃', 'ok') }
    else { updatePhoneNote(editingId, title, body); syncPhoneNote(editingId, title, body) }
    setEditingId(null)
    setDraft('')
  }

  /* 拉目录树（进页自动一次；vault-line 点击可手动重拉，失败退回本地缓存树 + toast） */
  const fetchTreeNow = () => {
    setLoadingTree(true)
    fetchNoteTree()
      .then(pages => {
        saveNoteTree(pages)
        setTree({ fetchedAt: Date.now(), pages })
      })
      .catch((e: Error) => toast(e.message, 'warn'))
      .finally(() => setLoadingTree(false))
  }

  /* 进入本页且已配对 → 自动拉目录树 */
  useEffect(() => {
    if (!active || !paired) return
    fetchTreeNow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, paired])

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

  /* 列表块：搜索 + 仓库目录 + 手机笔记（手机整页 / 平板内容区共用） */
  const listEl = (
    <>
      {/* 新建入口（tb-only=平板显示）：对照 iPad 备忘录——页头右侧工具栏钮，不用悬浮球 */}
      <PageHead title="笔记">
        <button className="icon-btn tb-only" onClick={startNewNote} title="新建笔记"><IPen size={17} /></button>
      </PageHead>
      <div className="search-box">
        <ISearch />
        <input value={kw} onChange={e => setKw(e.target.value)} placeholder="搜索笔记标题" />
      </div>
      <button className="vault-line" onClick={fetchTreeNow} disabled={!paired || loadingTree}
        title={paired ? '重新拉取电脑笔记目录' : undefined}>
        <span className="ldot" />
        {paired
          ? (loadingTree ? '正在拉取目录…' : '已连接 ' + paired.pcName + ' · ' + tree.pages.length + ' 篇 · 增量缓存（点击刷新）')
          : '未配对电脑 · 配对后可看仓库笔记'}
      </button>

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
    </>
  )

  /* 阅读块：列表页内的覆盖层（手机全屏 / 平板内容区），含目录、字号、缓存徽标。
   * 两栏铁律：平板侧栏（可收纳）+ 内容区恒定两栏，阅读直接替换列表、返回键回列表。 */
  const readerEl = (
    <>
      <div className="reader-top">
        <button className="icon-btn" onClick={() => setReader(null)} title="返回列表"><IBack /></button>
        <span className="path">{reader?.path}</span>
        {toc.length > 0 && (
          <button className={'icon-btn' + (tocOpen ? ' on' : '')} onClick={() => setTocOpen(o => !o)} title="目录">
            <IBars />
          </button>
        )}
        <button className="icon-btn fs-btn" onClick={() => setFontSz(s => Math.max(12, s - 1))} title="缩小字号">A-</button>
        <button className="icon-btn fs-btn" onClick={() => setFontSz(s => Math.min(22, s + 1))} title="放大字号">A+</button>
        {/* 对照备忘录：阅读态也能直接新建（平板显示，手机保持 v1 无此钮） */}
        <button className="icon-btn tb-only" onClick={startNewNote} title="新建笔记"><IPen size={17} /></button>
        <span className={'badge-sync ' + (readerState === 'cached' ? 'synced' : 'pending')} style={{ marginLeft: 'auto' }}>
          {readerState === 'cached' ? '已缓存' : readerState === 'loading' ? '下载中…' : '加载失败'}
        </span>
      </div>
      {tocOpen && toc.length > 0 && (
        <div className="tb-toc">
          <div className="tb-toc-t">目录 · {toc.length} 节</div>
          {toc.map(t => (
            <button key={t.id} className={'toc-lv' + t.level} onClick={() => { jumpTo(t.id); setTocOpen(false) }}>
              {t.text}
            </button>
          ))}
        </div>
      )}
      <div className="reader-body" ref={bodyRef}>
        <div className="md" style={{ '--rfs': fontSz + 'px' } as CSSProperties} dangerouslySetInnerHTML={{ __html: mdRender(readerBody) }} />
      </div>
      <div className="reader-foot">
        <span className="note">
          {reader?.kind === 'phone' ? '手机笔记上行后在电脑收件箱继续整理' : '移动端 v1 只读电脑笔记，编辑回电脑进行'}
        </span>
      </div>
    </>
  )

  return (
    <section className={'page' + (active ? ' active' : '')}>
      {listEl}
      <button className="fab" onClick={startNewNote}><IPen /></button>
      {/* 编辑器（备忘录式）：即建即编，无表单无保存钮——返回/完成即入库，空笔记静默丢弃 */}
      {editingId && (
        <div className="reader open note-editor">
          <div className="reader-top">
            <button className="icon-btn" onClick={exitEditor} title="完成并返回列表"><IBack /></button>
            <span className="path">新笔记 · 首行即标题</span>
            <button className="btn-done" onClick={exitEditor}>完成</button>
          </div>
          <textarea
            className="editor-area"
            autoFocus
            value={draft}
            onChange={e => onDraft(e.target.value)}
            placeholder="想到什么写什么…（第一行会成为标题）"
          />
        </div>
      )}
      <div className={'reader' + (reader ? ' open' : '')}>{readerEl}</div>
    </section>
  )
}
