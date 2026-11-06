/* 笔记仓库树构建（桌面 VaultTree 同口径）：目录恒在前、zh localeCompare。
 * 平板侧栏树与手机分组列表共用。 */
import type { NoteTreePage } from './types'

export type NoteDir = { name: string; path: string; dirs: NoteDir[]; files: NoteTreePage[] }

function sortEntries(dirs: NoteDir[], files: NoteTreePage[]) {
  dirs.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  files.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'))
}

export function buildTree(pages: NoteTreePage[]): NoteDir {
  const root: NoteDir = { name: '', path: '', dirs: [], files: [] }
  const dirAt = (path: string): NoteDir => {
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
    dirAt(segs.slice(0, -1).join('/')).files.push(p)
  }
  const sortAll = (d: NoteDir) => { sortEntries(d.dirs, d.files); d.dirs.forEach(sortAll) }
  sortAll(root)
  return root
}

/** 手机端顶层分组（v1 口径不动） */
export function buildFolders(pages: NoteTreePage[]): Array<{ name: string; pages: NoteTreePage[] }> {
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
