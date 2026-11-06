import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { NoteCache, NoteTreePage } from '../../lib/types'
import { mdRender } from '../../lib/data'
import { useApp } from '../../lib/store'
import { useFormFactor } from '../../lib/useFormFactor'
import {
  fetchNoteContent, fetchNoteTree, loadNoteCache, loadNoteTree, saveNoteCache, saveNoteTree,
} from '../../lib/sync'
import { splitDocSegments } from '../../lib/quizParse'
import { IBack, IBars, ICheck, IChevR, IFolder, IPlus, IPen, ISearch } from '../../components/icons'
import { QuizCard } from '../../components/QuizCard'
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

/* ---------- 桌面同款嵌套文件树（对齐 VaultTree：目录恒在前、zh localeCompare） ---------- */
type NoteDir = { name: string; path: string; dirs: NoteDir[]; files: NoteTreePage[] }

function sortEntries(dirs: NoteDir[], files: NoteTreePage[]) {
  dirs.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  files.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'))
}

function buildTree(pages: NoteTreePage[]): NoteDir {
  const root: NoteDir = { name: '', path: '', dirs: [], files: [] }
  const dirAt = (path: string, name: string): NoteDir => {
    if (!path) return root
    const segs = path.split('/')
    let cur = root
    let acc = ''
    for (let i = 0; i < segs.length; i++) {
      acc = acc ? acc + '/' + segs[i] : segs[i]
      let next = cur.dirs.find(d => d.path === acc)
      if (!next) {
        // 系统目录 .knowbase/ 内按「收件箱」展示（与 v1 分组口径一致）
        next = { name: i === 0 && segs[0].startsWith('.') ? '收件箱' : segs[i], path: acc, dirs: [], files: [] }
        cur.dirs.push(next)
      }
      cur = next
    }
    return cur
  }
  for (const p of pages) {
    const segs = p.path.split('/')
    const dirPath = segs.slice(0, -1).join('/')
    dirAt(dirPath, segs[segs.length - 2] || '').files.push(p)
  }
  const sortAll = (d: NoteDir) => { sortEntries(d.dirs, d.files); d.dirs.forEach(sortAll) }
  sortAll(root)
  return root
}

/* 手机端保留的顶层分组（v1 口径不动） */
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
type SyncSel = { dirs: string[]; ids: string[] }

const FONT_KEY = 'tb-reader-font'
const SEL_KEY = 'pm.noteSyncSel'

function loadSel(): SyncSel {
  try {
    const v = JSON.parse(localStorage.getItem(SEL_KEY) || '')
    if (v && Array.isArray(v.dirs) && Array.isArray(v.ids)) return v
  } catch { /* 首次/损坏 → 默认 */ }
  return { dirs: [], ids: [] }
}

export function NotesPage({ active }: { active: boolean }) {
  const { phoneNotes, toast, paired, createPhoneNote, updatePhoneNote, discardPhoneNote, syncPhoneNote, quizRecords } = useApp()
  const tablet = useFormFactor() === 'tablet'
  const [kw, setKw] = useState('')
  const [tree, setTree] = useState(() => loadNoteTree())
  const [loadingTree, setLoadingTree] = useState(false)
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [cache, setCache] = useState<NoteCache>(() => loadNoteCache())
  const [reader, setReader] = useState<{ title: string; path: string; kind: 'vault' | 'phone' } | null>(null)
  const [readerBody, setReaderBody] = useState('')
  const [readerState, setReaderState] = useState<'cached' | 'loading' | 'error'>('cached')
  /* 阅读体验：字号可调（localStorage 持久化）+ 标题目录跳转 */
  const [fontSz, setFontSz] = useState(() => {
    const v = Number(localStorage.getItem(FONT_KEY))
    return v >= 12 && v <= 22 ? v : 15
  })
  const [tocOpen, setTocOpen] = useState(false)
  const [toc, setToc] = useState<TocItem[]>([])
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => { localStorage.setItem(FONT_KEY, String(fontSz)) }, [fontSz])

  /* ---------- 选择同步（文件夹 + 单篇；选中范围内容自动保持最新） ---------- */
  const [syncSel, setSyncSel] = useState<SyncSel>(loadSel)
  useEffect(() => { localStorage.setItem(SEL_KEY, JSON.stringify(syncSel)) }, [syncSel])

  const dirSelected = (path: string) => syncSel.dirs.includes(path)
  const noteSelected = (page: NoteTreePage) =>
    syncSel.ids.includes(page.id) ||
    page.path.split('/').slice(0, -1).some((_, i, arr) => syncSel.dirs.includes(arr.slice(0, i + 1).join('/')))

  const toggleDir = (path: string) => setSyncSel(s => ({
    ...s,
    dirs: s.dirs.includes(path) ? s.dirs.filter(d => d !== path) : [...s.dirs, path],
  }))
  const toggleNote = (id: string) => setSyncSel(s => ({
    ...s,
    ids: s.ids.includes(id) ? s.ids.filter(i => i !== id) : [...s.ids, id],
  }))

  const selectedPages = useMemo(() => tree.pages.filter(noteSelected), [tree, syncSel])

  /* 自动增量刷新：在线对账选中范围（mtimeMs 变了才重拉），60s 一轮 + 进页/选区变化即触发 */
  const refreshingRef = useRef(false)
  const refreshRef = useRef<() => void>(() => {})
  refreshRef.current = async () => {
    if (refreshingRef.current || !paired) return
    const targets = tree.pages
      .filter(noteSelected)
      .filter(p => { const hit = cache[p.id]; return !hit || hit.mtimeMs !== p.mtimeMs })
    if (!targets.length) return
    refreshingRef.current = true
    for (const p of targets) {
      try {
        const c = await fetchNoteContent(p.id)
        setCache(prev => {
          const next = { ...prev, [p.id]: { title: p.title, body: c.body, mtimeMs: p.mtimeMs, at: Date.now() } }
          saveNoteCache(next)
          return next
        })
      } catch { /* 静默：下一轮对账再试 */ }
    }
    refreshingRef.current = false
  }
  useEffect(() => {
    if (!active || !paired) return
    refreshRef.current()
    const t = setInterval(() => refreshRef.current(), 60_000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, paired, tree, syncSel])

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

  /* ---------- 备忘录式即建即编（弃抽屉表单） ---------- */
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
  const treeRoot = useMemo(() => buildTree(tree.pages), [tree])
  const segs = useMemo(() => splitDocSegments(readerBody), [readerBody])
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

  /* 同步开关（文件夹/单篇通用）：已选 ✓ / 未选 + */
  const SyncToggle = ({ on, onToggle }: { on: boolean; onToggle: () => void }) => (
    <button
      className={'icon-btn vt-toggle' + (on ? ' on' : '')}
      title={on ? '移出同步范围' : '加入同步范围'}
      onClick={e => { e.stopPropagation(); onToggle() }}
    >
      {on ? <ICheck size={15} /> : <IPlus size={15} />}
    </button>
  )

  /* 桌面同款嵌套文件树（递归；搜索时自动展开含匹配的分支） */
  const renderDir = (node: NoteDir, depth: number): ReactNode => {
    const kwFiles = kwTrim ? node.files.filter(x => x.title.includes(kwTrim)) : node.files
    const subDirs = kwTrim
      ? node.dirs.map(d => ({ ...d })).filter(d => {
          const keep = renderDirHasMatch(d)
          return keep
        })
      : node.dirs
    if (kwTrim && !kwFiles.length && !subDirs.length) return null
    const open = !!expanded[node.path] || !!kwTrim || depth === 0
    return (
      <div key={node.path || '__root__'}>
        {depth > 0 && (
          <div
            className="vt-row dir"
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => setExpanded(m => ({ ...m, [node.path]: !m[node.path] }))}
          >
            <span className={'chev' + (open ? ' on' : '')}><IChevR size={13} /></span>
            <IFolder size={15} style={{ color: 'var(--accent-hover)' }} />
            <span className="vt-name">{node.name}</span>
            <span className="count">{node.files.length}</span>
            <SyncToggle on={dirSelected(node.path)} onToggle={() => toggleDir(node.path)} />
          </div>
        )}
        {open && (
          <div>
            {subDirs.map(d => renderDir(d, depth + 1))}
            {kwFiles.map(x => (
              <div key={x.id} className="vt-row file" style={{ paddingLeft: 8 + (depth + 1) * 14 }} onClick={() => openVaultNote(x)}>
                <span className={'c ' + (isFresh(x) ? 'cached' : 'uncached')} />
                <span className="vt-name">{x.title}</span>
                <SyncToggle on={noteSelected(x)} onToggle={() => toggleNote(x.id)} />
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }
  /* 搜索过滤辅助：目录分支下（含孙级）是否有匹配文件 */
  const renderDirHasMatch = (d: NoteDir): boolean =>
    d.files.some(x => x.title.includes(kwTrim)) || d.dirs.some(renderDirHasMatch)

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
          ? (loadingTree
            ? '正在拉取目录…'
            : '已连接 ' + paired.pcName + ' · 全仓 ' + tree.pages.length + ' 篇 · 已选同步 ' + selectedPages.length + ' 篇自动保持最新（点击刷新目录）')
          : '未配对电脑 · 配对后可看仓库笔记'}
      </button>

      {tablet ? (
        /* 平板：桌面同款嵌套文件树 */
        <div className="vtree">
          {renderDir(treeRoot, 0)}
          {paired && !loadingTree && !tree.pages.length && <div className="empty" style={{ padding: '20px 0' }}>仓库没有可读的 md 笔记（或目录还没拉到）</div>}
        </div>
      ) : (
        /* 手机：保留 v1 顶层分组列表 */
        <>
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
        </>
      )}

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
        {/* md 文档分段渲染：quiz 围栏 → 就地题卡（读文档即刷题），其余走 mdRender */}
        {segs.map((s, i) => s.kind === 'md'
          ? <div key={i} className="md" style={{ '--rfs': fontSz + 'px' } as CSSProperties} dangerouslySetInnerHTML={{ __html: mdRender(s.text) }} />
          : (
            <QuizCard
              key={'q' + i}
              spec={s.spec}
              pageId={reader?.path || ''}
              pageTitle={reader?.title || ''}
              record={quizRecords.find(r => r.pageId === reader?.path && r.pageTitle === reader?.title && r.no === s.spec.no)}
            />
          ))}
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
