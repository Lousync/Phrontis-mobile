import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { mdRender } from '../../lib/data'
import { useApp } from '../../lib/store'
import { useFormFactor } from '../../lib/useFormFactor'
import { buildFolders } from '../../lib/notesTree'
import { splitDocSegments } from '../../lib/quizParse'
import { IBack, IBars, IChevR, IFolder, IPen, IBook, ISearch } from '../../components/icons'
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

type TocItem = { id: string; text: string; level: number }

const FONT_KEY = 'tb-reader-font'

export function NotesPage({ active }: { active: boolean }) {
  const {
    phoneNotes, toast, createPhoneNote, updatePhoneNote, discardPhoneNote, syncPhoneNote, quizRecords,
    vaultReader, setVaultReader, vaultBody, vaultState, vaultTree, vaultLoading, paired, fetchVaultTree,
    openVaultNote, openPhoneNote, vaultKw, setVaultKw, vaultCache,
  } = useApp()
  const tablet = useFormFactor() === 'tablet'
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({})
  /* 阅读体验：字号可调（localStorage 持久化）+ 标题目录跳转 */
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
    if (!el || !vaultReader) { setToc([]); return }
    const items: TocItem[] = []
    el.querySelectorAll('h1, h2, h3').forEach((h, i) => {
      const id = 'md-h-' + i
      ;(h as HTMLElement).id = id
      items.push({ id, text: (h.textContent || '').slice(0, 48), level: Number(h.tagName[1]) })
    })
    setToc(items)
    setTocOpen(false)
  }, [vaultBody, vaultReader])

  const jumpTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  /* ---------- 备忘录式即建即编（弃抽屉表单） ---------- */
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const startNewNote = () => {
    setVaultReader(null)
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

  const folders = useMemo(() => buildFolders(vaultTree.pages), [vaultTree])
  const segs = useMemo(() => splitDocSegments(vaultBody), [vaultBody])
  const kwTrim = vaultKw.trim()

  /* 阅读块：目录、字号、缓存徽标、题卡分段渲染。
   * 平板：直接铺满内容区（树在侧栏）；手机：列表内覆盖层，返回键回列表。 */
  const readerEl = (
    <>
      <div className="reader-top">
        <button className="icon-btn" onClick={() => setVaultReader(null)} title={tablet ? '关闭' : '返回列表'}><IBack /></button>
        <span className="path">{vaultReader?.path}</span>
        {toc.length > 0 && (
          <button className={'icon-btn' + (tocOpen ? ' on' : '')} onClick={() => setTocOpen(o => !o)} title="目录">
            <IBars />
          </button>
        )}
        <button className="icon-btn fs-btn" onClick={() => setFontSz(s => Math.max(12, s - 1))} title="缩小字号">A-</button>
        <button className="icon-btn fs-btn" onClick={() => setFontSz(s => Math.min(22, s + 1))} title="放大字号">A+</button>
        {/* 对照备忘录：阅读态也能直接新建（平板显示，手机保持 v1 无此钮） */}
        <button className="icon-btn tb-only" onClick={startNewNote} title="新建笔记"><IPen size={17} /></button>
        <span className={'badge-sync ' + (vaultState === 'cached' ? 'synced' : 'pending')} style={{ marginLeft: 'auto' }}>
          {vaultState === 'cached' ? '已缓存' : vaultState === 'loading' ? '下载中…' : '加载失败'}
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
              pageId={vaultReader?.path || ''}
              pageTitle={vaultReader?.title || ''}
              record={quizRecords.find(r => r.pageId === vaultReader?.path && r.pageTitle === vaultReader?.title && r.no === s.spec.no)}
            />
          ))}
      </div>
      <div className="reader-foot">
        <span className="note">
          {vaultReader?.kind === 'phone' ? '手机笔记上行后在电脑收件箱继续整理' : '移动端 v1 只读电脑笔记，编辑回电脑进行'}
        </span>
      </div>
    </>
  )

  /* 编辑器（备忘录式）：即建即编，无表单无保存钮——返回/完成即入库，空笔记静默丢弃 */
  const editorEl = editingId && (
    <div className="reader open note-editor">
      <div className="reader-top">
        <button className="icon-btn" onClick={exitEditor} title="完成并返回"><IBack /></button>
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
  )

  /* 平板：内容区 = 阅读器（树在侧栏，§10.1），未选中时空态引导 */
  if (tablet) {
    return (
      <section className={'page' + (active ? ' active' : '')}>
        {vaultReader ? (
          <div className="reader open">{readerEl}</div>
        ) : (
          <div className="notes-empty">
            <IBook size={30} />
            <p>从左侧文件树选一篇笔记开始阅读</p>
            <span>目录跳转 · 字号调节 · 选择同步自动保持最新</span>
            <button className="btn-primary" onClick={startNewNote}><IPen size={14} style={{ marginRight: 6 }} />新建笔记</button>
          </div>
        )}
        {editorEl}
      </section>
    )
  }

  /* 手机：保留 v1 列表（分组）+ 覆盖层阅读器；数据源已统一走 store vault 域 */
  const listEl: ReactNode = (
    <>
      <PageHead title="笔记" />
      <div className="search-box">
        <ISearch />
        <input value={vaultKw} onChange={e => setVaultKw(e.target.value)} placeholder="搜索笔记标题" />
      </div>
      <button className="vault-line" onClick={fetchVaultTree} disabled={!paired || vaultLoading}
        title={paired ? '重新拉取电脑笔记目录' : undefined}>
        <span className="ldot" />
        {paired
          ? (vaultLoading
            ? '正在拉取目录…'
            : '已连接 ' + paired.pcName + ' · 全仓 ' + vaultTree.pages.length + ' 篇（点击刷新目录）')
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
                  <span className={'c ' + (vaultCache[x.id] && vaultCache[x.id].mtimeMs === x.mtimeMs ? 'cached' : 'uncached')} />
                  {x.title}
                  <span className="arrow"><IChevR /></span>
                </div>
              ))}
              {!files.length && <div className="empty" style={{ padding: '16px 0' }}>无匹配笔记</div>}
            </div>
          </div>
        )
      })}
      {paired && !vaultLoading && !folders.length && <div className="empty" style={{ padding: '20px 0' }}>仓库没有可读的 md 笔记（或目录还没拉到）</div>}

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

  return (
    <section className={'page' + (active ? ' active' : '')}>
      {listEl}
      <button className="fab" onClick={startNewNote}><IPen /></button>
      {editorEl}
      <div className={'reader' + (vaultReader ? ' open' : '')}>{vaultReader ? readerEl : null}</div>
    </section>
  )
}
