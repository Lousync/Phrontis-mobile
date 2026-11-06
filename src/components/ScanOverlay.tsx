import { useEffect, useRef, useState } from 'react'
import { useApp } from '../lib/store'
import { startQrScanner, type ScanHandle, type ScanState } from '../lib/scan'
import { IX } from './icons'

/**
 * 扫码配对（**全屏取景，不是抽屉**）。
 *
 * 2026-11-06 真机反馈：抽屉形态在「对着电脑举手机」这个动作里别扭，改成铺满整屏。
 * 状态机：starting（起相机）→ ready（出帧，画扫描框）→ tap（自动播放被拦，等用户点一下）→ error。
 *
 * 二维码内容 = 配对链接 `http://<ip>:8770/pair#<8 位码>`，解出直接走旧路换令牌
 * （二维码只在电脑屏幕上，扫到即人在跟前，不再走确认框 —— design.md §2.2 兜底口径）。
 */
export function ScanOverlay() {
  const { closeSheet, pairWith } = useApp()
  const videoRef = useRef<HTMLVideoElement>(null)
  const handleRef = useRef<ScanHandle | null>(null)
  const [state, setState] = useState<ScanState | 'error'>('starting')
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
        }, s => { if (!cancelled) setState(s) })
        if (cancelled) { h.stop(); return }
        handleRef.current = h
      } catch (e) {
        if (!cancelled) {
          setState('error')
          setErr(e instanceof Error ? e.message : '打开相机失败')
        }
      }
    })()
    return () => {
      cancelled = true
      handleRef.current?.stop()
      handleRef.current = null
    }
  }, [pairWith, closeSheet])

  const tapToPlay = async () => {
    const ok = await handleRef.current?.play()
    if (ok) setState('ready')
  }

  return (
    <div className="scan-full">
      <video ref={videoRef} className="scan-video" muted playsInline autoPlay />
      {state === 'ready' && (
        <>
          <div className="scan-frame" />
          <div className="scan-line" />
        </>
      )}
      <div className="scan-head">
        <button className="scan-close" onClick={closeSheet} aria-label="关闭"><IX size={16} /></button>
        <span className="scan-title">扫码配对</span>
      </div>
      {state === 'starting' && <div className="scan-center"><span className="spin" /> 正在启动相机…</div>}
      {state === 'tap' && (
        <button className="scan-center scan-tap" onClick={() => void tapToPlay()}>点一下开始预览</button>
      )}
      {state === 'error' && <div className="scan-center">{err}</div>}
      <div className="scan-foot">{hit ? '已识别，正在配对…' : '对准电脑「手机伴侣」里的二维码'}</div>
    </div>
  )
}
