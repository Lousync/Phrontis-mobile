import { useEffect, useRef, useState } from 'react'
import { useApp } from '../lib/store'
import { startQrScanner, type ScanHandle } from '../lib/scan'
import { Sheet, Grip } from './Sheet'
import { IX } from './icons'

/**
 * 扫码配对抽屉：扫电脑「工具箱 → 手机伴侣」出示的二维码。
 *
 * 二维码内容 = 配对链接 `http://<ip>:8770/pair#<8 位码>`，解出来直接走旧路换令牌
 * （二维码只呈现在电脑屏幕上，能扫到即等于人在跟前，不必再走一遍桌面确认框 —— design.md §2.2 兜底口径）。
 */
export function QrScanSheet() {
  const { closeSheet, pairWith } = useApp()
  const videoRef = useRef<HTMLVideoElement>(null)
  const handleRef = useRef<ScanHandle | null>(null)
  const [err, setErr] = useState('')
  const [hit, setHit] = useState(false)

  useEffect(() => {
    let cancelled = false
    const el = videoRef.current
    if (!el) return
    void (async () => {
      try {
        const h = await startQrScanner(el, text => {
          if (cancelled) return
          setHit(true)
          void (async () => {
            await pairWith(text, '')
            closeSheet()
          })()
        })
        if (cancelled) { h.stop(); return }
        handleRef.current = h
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : '打开相机失败')
      }
    })()
    return () => {
      cancelled = true
      handleRef.current?.stop()
      handleRef.current = null
    }
  }, [pairWith, closeSheet])

  return (
    <Sheet>
      <Grip />
      <div className="aic-head">
        <div className="aic-title">扫码配对</div>
        <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={closeSheet}><IX size={14} /></button>
      </div>
      <div className="scan-stage">
        <video ref={videoRef} muted playsInline autoPlay />
        {!err && <div className="scan-frame" />}
        {!err && <div className="scan-line" />}
        {err && <div className="scan-err">{err}</div>}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 10, textAlign: 'center', lineHeight: 1.6 }}>
        {hit ? '已识别，正在配对…' : '对准电脑上「手机伴侣」里的二维码；扫不到就在设置页点「搜索电脑」'}
      </div>
    </Sheet>
  )
}
