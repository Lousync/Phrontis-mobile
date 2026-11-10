/**
 * iPad 文件交接 / 批注回传（docs/design.md §2.3，2026-11-10 拍板）。
 *
 * 职责边界：本模块只做「文件搬运」——vault PDF 下载到本机、交给系统分享面板
 * （Prodrafts 等外部 App）、把外部 App 导出的 PDF 上传回电脑。不解析、不渲染、
 * 不批注 PDF；原文件永不覆盖，回传统一由电脑端另存到 iPad 批注/。
 *
 * 浏览器（PWA / 桌面 dev）走 fetch / Web Share / FileTransfer web 实现，
 * 仅用于联调；Files App、document types、原生分享面板必须在 SideStore IPA 上验收。
 */
import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { FileTransfer } from '@capacitor/file-transfer'
import { Share } from '@capacitor/share'
import { getPaired, uuid } from './sync'
import type { UploadedVaultFile, VaultFile } from './types'

/** 单文件回传上限：与桌面端点对齐（200MB），客户端再留一点余量 */
export const MAX_RETURN_BYTES = 200 * 1024 * 1024
/** 低于此值不做内存告警（base64 预写盘会临时占用约 1.35 倍） */
export const LARGE_FILE_WARN_BYTES = 60 * 1024 * 1024

export function isNativeFileChannel(): boolean {
  return Capacitor.isNativePlatform()
}

/** 文件在树里显示的名字：优先路径末段（含扩展名），API 的 title 是去扩展名版 */
export function fileDisplayName(f: Pick<VaultFile, 'path' | 'title'>): string {
  const seg = String(f.path || '').split('/').pop()
  return seg || f.title || '未命名.pdf'
}

export function formatBytes(n: number): string {
  const v = Number(n)
  if (!Number.isFinite(v) || v < 0) return '—'
  if (v < 1024) return Math.round(v) + ' B'
  if (v < 1024 * 1024) return (v / 1024).toFixed(v < 10 * 1024 ? 1 : 0) + ' KB'
  if (v < 1024 * 1024 * 1024) return (v / 1024 / 1024).toFixed(v < 10 * 1024 * 1024 ? 1 : 0) + ' MB'
  return (v / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}

/** 'YYYY-MM-DD HH:mm'（本地时区） */
export function formatFileTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  const d = new Date(ms)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function stripPdfExt(name: string): string {
  return String(name || '').trim().replace(/\.[^.]+$/, '')
}

/** 回传名建议：原名（批注）.pdf；已经带（批注）就不重复追加 */
export function suggestReturnName(sourceName: string): string {
  const stem = stripPdfExt(sourceName).replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').trim() || '未命名'
  if (/[（(]批注[）)]$/.test(stem)) return stem + '.pdf'
  return stem + '（批注）.pdf'
}

/** 用户可改文件名：清掉路径与 Windows 非法字符，强制 .pdf；空值回落建议名 */
export function normalizeReturnName(raw: string, fallbackSourceName: string): string {
  const fallback = suggestReturnName(fallbackSourceName)
  let name = String(raw || '').trim().replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
  if (!name) return fallback
  name = stripPdfExt(name).trim()
  if (!name) return fallback
  return name + '.pdf'
}

/** 稳定的本地缓存名：不把中文/路径塞进文件名（iOS 路径长度与转义都更省心） */
function cacheKey(id: string): string {
  let h = 5381
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) >>> 0
  return 'pdf-' + h.toString(36) + '-' + id.length.toString(36)
}

function authHeaders(): { authorization: string } {
  const p = getPaired()
  if (!p) throw new Error('尚未配对电脑')
  return { authorization: 'Bearer ' + p.token }
}

function contentUrl(id: string): string {
  const p = getPaired()
  if (!p) throw new Error('尚未配对电脑')
  return p.baseUrl + '/api/files/content?id=' + encodeURIComponent(id)
}

function uploadUrl(targetName: string): string {
  const p = getPaired()
  if (!p) throw new Error('尚未配对电脑')
  return p.baseUrl + '/api/files/upload?name=' + encodeURIComponent(targetName)
}

/** 原生 FileTransfer 无法单独指定 multipart 文件名（它用本地路径末段），
 *  所以回传名走 query `name`；桌面端优先用它，缺失再回落 multipart filename。 */
function fileUri(pathOrUri: string): string {
  if (/^file:\/\//i.test(pathOrUri)) return pathOrUri
  /* 中文名/空格必须编码；URL(string:) 对裸空格不友好 */
  return 'file://' + encodeURI(pathOrUri).replace(/#/g, '%23')
}

function errText(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e || '未知错误')
}

/* ================= 下载 / 交给外部 App ================= */

export interface LocalVaultFile {
  fileId: string
  /** 原生 file:// URI（分享面板要它）；web 为空 */
  uri: string
  /** LibraryNoCloud 内相对路径（删除副本用） */
  path: string
  name: string
  sizeBytes: number
  mtimeMs: number
  downloadedAt: number
}

/**
 * 下载 vault PDF 到本机（Library/NoCloud，不进 iCloud 备份）。
 * web 分支不落盘：能 Web Share 就拉系统分享，否则触发浏览器下载。
 * mode='share' 仅影响 web 分支（原生由调用方下载后再 shareLocalFile）。
 */
export async function downloadVaultFile(
  file: VaultFile,
  onProgress?: (pct: number) => void,
): Promise<LocalVaultFile | null> {
  const headers = authHeaders()
  const url = contentUrl(file.id)
  const name = fileDisplayName(file)

  if (!Capacitor.isNativePlatform()) {
    const res = await fetch(url, { headers })
    if (!res.ok) throw new Error('下载失败（' + res.status + '）')
    const blob = await res.blob()
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean; share?: (d: ShareData) => Promise<void> }
    try {
      const shareFile = new File([blob], name, { type: 'application/pdf' })
      if (nav.canShare?.({ files: [shareFile] }) && nav.share) {
        await nav.share({ files: [shareFile], title: name })
        onProgress?.(100)
        return null
      }
    } catch { /* 用户取消/不支持 → 落普通下载 */ }
    const a = document.createElement('a')
    const href = URL.createObjectURL(blob)
    a.href = href
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(href), 30_000)
    onProgress?.(100)
    return null
  }

  const rel = 'vault-files/' + cacheKey(file.id) + '.pdf'
  /* 先下到临时名再原子替换：下载失败不会毁掉上一份可用的本机副本 */
  const tmpRel = 'vault-files/.tmp-' + uuid() + '.pdf'
  await Filesystem.mkdir({ path: 'vault-files', directory: Directory.LibraryNoCloud, recursive: true }).catch(() => {})
  const { uri: tmpUri } = await Filesystem.getUri({ path: tmpRel, directory: Directory.LibraryNoCloud })
  const listener = await FileTransfer.addListener('progress', p => {
    if (p.type !== 'download' || !p.lengthComputable || p.contentLength <= 0) return
    if (!p.url.includes('/api/files/content')) return
    onProgress?.(Math.max(0, Math.min(100, (p.bytes / p.contentLength) * 100)))
  })
  try {
    await FileTransfer.downloadFile({
      url,
      path: tmpUri,
      headers,
      progress: true,
      /* iOS 插件把 connectTimeout 当总超时（无 connect/read 区分），这里只给 readTimeout，
       * 否则大 PDF 下载会在 8s 被掐断 */
      readTimeout: 180_000,
    })
    try {
      await Filesystem.rename({ from: tmpRel, to: rel, directory: Directory.LibraryNoCloud, toDirectory: Directory.LibraryNoCloud })
    } catch {
      /* 部分实现不覆盖已存在文件：删旧副本再重命名（新文件已完整落盘） */
      await Filesystem.deleteFile({ path: rel, directory: Directory.LibraryNoCloud }).catch(() => {})
      await Filesystem.rename({ from: tmpRel, to: rel, directory: Directory.LibraryNoCloud, toDirectory: Directory.LibraryNoCloud })
    }
    onProgress?.(100)
    const { uri } = await Filesystem.getUri({ path: rel, directory: Directory.LibraryNoCloud })
    return {
      fileId: file.id,
      uri: fileUri(uri),
      path: rel,
      name,
      sizeBytes: file.sizeBytes,
      mtimeMs: file.mtimeMs,
      downloadedAt: Date.now(),
    }
  } catch (e) {
    await Filesystem.deleteFile({ path: tmpRel, directory: Directory.LibraryNoCloud }).catch(() => {})
    throw new Error('下载失败：' + errText(e))
  } finally {
    await listener.remove().catch(() => {})
  }
}

/** 调系统分享面板把本地 PDF 交给 Prodrafts 等 App（iOS/Android） */
export async function shareLocalFile(local: LocalVaultFile): Promise<void> {
  if (!Capacitor.isNativePlatform()) throw new Error('浏览器不支持直接调起外部 App，请用 SideStore 安装的 iPad App')
  const can = await Share.canShare().catch(() => ({ value: false }))
  if (!can.value) throw new Error('当前设备不支持系统分享')
  await Share.share({
    title: local.name,
    files: [local.uri],
    dialogTitle: '选择应用打开',
  })
}

export async function deleteLocalFile(local: Pick<LocalVaultFile, 'path'>): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  await Filesystem.deleteFile({ path: local.path, directory: Directory.LibraryNoCloud }).catch(() => {})
}

/* ================= 选择回传文件 / 接收分享 ================= */

/** 系统文件选择器（iPadOS 会打开「文件」App；Prodrafts 导出的 PDF 也可从这里选） */
export function pickPdfFile(): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/pdf,.pdf'
    input.style.position = 'fixed'
    input.style.left = '-9999px'
    input.style.opacity = '0'
    let settled = false
    const done = (f: File | null) => {
      if (settled) return
      settled = true
      input.remove()
      resolve(f)
    }
    input.addEventListener('change', () => done(input.files?.[0] ?? null), { once: true })
    document.body.appendChild(input)
    input.click()
    /* 取消选择没有 change 事件：焦点回到页面后收尾（不 resolve 空值会一直挂起） */
    window.addEventListener('focus', () => setTimeout(() => done(input.files?.[0] ?? null), 1500), { once: true })
  })
}

export interface StagedReturn {
  /** 原生已复制到 App 缓存后的 file:// URI；web 为空（用 blob 直传） */
  uri?: string
  /** LibraryNoCloud 内相对路径（清理用） */
  path?: string
  name: string
  sizeBytes: number
  blob?: Blob
}

function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.onload = () => {
      const s = String(reader.result || '')
      const comma = s.indexOf(',')
      resolve(comma >= 0 ? s.slice(comma + 1) : s)
    }
    reader.readAsDataURL(file)
  })
}

/** 把选中的 PDF 落到本机缓存（原生）或暂存 Blob（web），供后续上传/重试 */
export async function stageReturnFile(file: File): Promise<StagedReturn> {
  const name = file.name || '回传.pdf'
  if (file.size > MAX_RETURN_BYTES) throw new Error('文件超过 200MB，请先压缩或拆分')
  if (!Capacitor.isNativePlatform()) {
    return { name, sizeBytes: file.size, blob: file }
  }
  const b64 = await fileToBase64(file)
  const path = 'returns/' + uuid() + '.pdf'
  const r = await Filesystem.writeFile({
    path,
    data: b64,
    directory: Directory.LibraryNoCloud,
    recursive: true,
  })
  return { uri: r.uri, path, name, sizeBytes: file.size }
}

/** 清理自己暂存的回传稿（上传成功 / 忽略后）；外部 App 分享进 Inbox 的文件不在此列 */
export async function deleteStagedReturn(path: string): Promise<void> {
  if (!Capacitor.isNativePlatform() || !path) return
  await Filesystem.deleteFile({ path, directory: Directory.LibraryNoCloud }).catch(() => {})
}

/** 从 Prodrafts 分享到 Phrontis 时，iOS 给的是 Documents/Inbox 里的 file:// URL */
export function incomingPdfFromUrl(raw: string): { uri: string; name: string } | null {
  const url = String(raw || '')
  if (!/^file:\/\//i.test(url)) return null
  const clean = url.split('#')[0].split('?')[0]
  let name = ''
  try { name = decodeURIComponent(clean.split('/').pop() || '') } catch { name = clean.split('/').pop() || '' }
  if (!/\.pdf$/i.test(name)) return null
  return { uri: url, name }
}

/* ================= 上传回传 ================= */

export interface ReturnUploadSource {
  uri?: string
  blob?: Blob
  name: string
  sizeBytes: number
}

function parseUploadBody(raw: string | undefined): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as unknown
    return v && typeof v === 'object' ? v as Record<string, unknown> : null
  } catch { return null }
}

function transferError(e: unknown): { message: string; status?: number } {
  const data = (e as { data?: { httpStatus?: number; body?: string; message?: string; exception?: string } })?.data
  const body = parseUploadBody(data?.body)
  const bodyMsg = typeof body?.error === 'string' ? body.error : ''
  return {
    message: bodyMsg || data?.message || data?.exception || errText(e),
    status: data?.httpStatus,
  }
}

/**
 * 上传 PDF 到电脑，统一另存到 <vault>/iPad 批注/。
 * 原生：FileTransfer 流式 multipart（field=file）；web：同一插件走 XHR+FormData，便于 PWA 联调。
 */
export async function uploadReturnPdf(
  source: ReturnUploadSource,
  targetName: string,
  onProgress?: (pct: number) => void,
): Promise<UploadedVaultFile> {
  const headers = authHeaders()
  const url = uploadUrl(targetName)
  const native = Capacitor.isNativePlatform()

  let path = source.uri || ''
  let tempRel = ''
  if (native && !path) {
    if (!source.blob) throw new Error('源文件已不在本机，请重新选择 PDF')
    const b64 = await fileToBase64(source.blob)
    tempRel = 'returns/' + uuid() + '.pdf'
    const w = await Filesystem.writeFile({ path: tempRel, data: b64, directory: Directory.LibraryNoCloud, recursive: true })
    path = w.uri
  }

  const listener = await FileTransfer.addListener('progress', p => {
    if (p.type !== 'upload' || !p.lengthComputable || p.contentLength <= 0) return
    if (!p.url.includes('/api/files/upload')) return
    onProgress?.(Math.max(0, Math.min(100, (p.bytes / p.contentLength) * 100)))
  })

  try {
    const r = await FileTransfer.uploadFile({
      url,
      path: native ? path : (source.name || targetName),
      blob: native ? undefined : source.blob,
      fileKey: 'file',
      mimeType: 'application/pdf',
      headers,
      progress: true,
      /* 同上：iOS 无 connect/read 区分，8s 会把稍大的上传掐断 */
      readTimeout: 300_000,
    })
    const code = Number(r.responseCode)
    const json = parseUploadBody(r.response)
    if (code < 200 || code >= 300 || json?.ok !== true) {
      throw new Error(String(json?.error || ('上传失败（' + (r.responseCode || '无响应') + '）')))
    }
    const f = json.file as UploadedVaultFile | undefined
    if (!f || typeof f.path !== 'string') throw new Error('电脑端返回缺少文件信息')
    onProgress?.(100)
    return f
  } catch (e) {
    const t = transferError(e)
    const err = new Error(t.message) as Error & { status?: number }
    err.status = t.status
    throw err
  } finally {
    await listener.remove().catch(() => {})
    if (tempRel) {
      await Filesystem.deleteFile({ path: tempRel, directory: Directory.LibraryNoCloud }).catch(() => {})
    }
  }
}
