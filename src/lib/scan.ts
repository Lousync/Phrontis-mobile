/**
 * 相机扫码（配对兜底路径）：getUserMedia 取后置摄像头 → 定时抓帧 → jsQR 解码。
 *
 * 为什么不用 BarcodeDetector：Android WebView 上它靠 Play Services 模块，是否有不确定；
 * jsQR 是纯 JS，APK 与浏览器行为一致，桌面冒烟也能跑。
 * **jsQR 走动态 import**：它单独 130KB，扫码是低频路径，不该压在首屏包里（打开抽屉时才拉）。
 *
 * 注意：浏览器里 getUserMedia 需要**安全上下文**（https 或 localhost）——
 * 用 http://192.168.x.x 打开的开发页会直接没有 navigator.mediaDevices，
 * 这是预期降级（APK 内是 https://localhost，不受影响）。
 */

export interface ScanHandle {
  stop(): void
}

const DECODE_INTERVAL_MS = 200
const MAX_FRAME_WIDTH = 640

export async function startQrScanner(video: HTMLVideoElement, onHit: (text: string) => void): Promise<ScanHandle> {
  const media = navigator.mediaDevices
  if (!media?.getUserMedia) {
    throw new Error('当前环境拿不到摄像头：浏览器需 https（或 localhost），用 APK 打开即可扫码')
  }
  /* 动态拉解码器：130KB 的低频依赖不进首屏包 */
  const { default: jsQR } = await import('jsqr')
  let stream: MediaStream
  try {
    stream = await media.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
  } catch (e) {
    const name = e instanceof DOMException ? e.name : ''
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new Error('相机权限被拒绝：到系统设置里允许 Phrontis 使用相机')
    if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new Error('没找到可用的摄像头')
    throw new Error('打开相机失败' + (e instanceof Error ? '：' + e.message : ''))
  }

  video.srcObject = stream
  video.setAttribute('playsinline', 'true')
  await video.play().catch(() => { /* 自动播放被拦时靠用户点一下画面 */ })

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  let stopped = false
  let timer = 0

  const stop = () => {
    if (stopped) return
    stopped = true
    if (timer) clearTimeout(timer)
    stream.getTracks().forEach(t => t.stop())
    video.srcObject = null
  }

  const tick = () => {
    if (stopped) return
    if (ctx && video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth) {
      const scale = Math.min(1, MAX_FRAME_WIDTH / video.videoWidth)
      canvas.width = Math.round(video.videoWidth * scale)
      canvas.height = Math.round(video.videoHeight * scale)
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
      if (code?.data) {
        stop()
        onHit(code.data)
        return
      }
    }
    timer = window.setTimeout(tick, DECODE_INTERVAL_MS)
  }
  tick()

  return { stop }
}
