/**
 * 相机扫码（配对兜底路径）：getUserMedia 取后置摄像头 → 定时抓帧 → jsQR 解码。
 *
 * 三个实测要点（2026-11-06 真机反馈后重写）：
 * 1. **必须显式 muted + 显式 play()**：Android WebView 里 <video autoPlay muted> 仍可能被
 *    自动播放策略拦住，画面停在「大播放键」的占位态——这时 jsQR 一帧都拿不到，表象是「扫不出」。
 *    play() 失败要回调 UI 让用户点一下（用户手势必然放行）。
 * 2. **jsQR 与开相机并行**：解码器是独立 chunk（130KB），串行等它会把首帧再推后。
 * 3. **限定分辨率**：不约束时部分机型会以最高档开流，首帧要 1s+；1280×720 足够解码且明显更快。
 *
 * 浏览器里 getUserMedia 需要**安全上下文**（https 或 localhost）：
 * 用 http://192.168.x.x 打开的开发页没有 navigator.mediaDevices，属预期降级（APK 内不受影响）。
 */

export type ScanState = 'starting' | 'ready' | 'tap'

export interface ScanHandle {
  stop(): void
  /** 自动播放被拦时由用户点一下画面触发；成功返回 true */
  play(): Promise<boolean>
}

const DECODE_INTERVAL_MS = 200
const MAX_FRAME_WIDTH = 640

export async function startQrScanner(
  video: HTMLVideoElement,
  onHit: (text: string) => void,
  onState: (s: ScanState) => void,
): Promise<ScanHandle> {
  const media = navigator.mediaDevices
  if (!media?.getUserMedia) {
    throw new Error('当前环境拿不到摄像头：浏览器需 https 或 localhost，用 APK 打开即可扫码')
  }

  /* 开相机与拉解码器并行，少等一截。
   * getUserMedia 不设超时：权限弹窗若一直无人应答（嵌入式 WebView 无弹窗 UI 时会这样），
   * promise 永远 pending，界面就永远停在「正在启动相机…」——15s 后按超时给出指引（2026-11-08 实测）。 */
  const camPromise = media.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  })
  const camTimeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new DOMException('相机启动超时', 'TimeoutError')), 15000))
  const modPromise = import('jsqr')

  let stream: MediaStream
  try {
    stream = await Promise.race([camPromise, camTimeout])
  } catch (e) {
    const name = e instanceof DOMException ? e.name : ''
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new Error('相机权限被拒绝：到系统设置里允许 Phrontis 使用相机')
    if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new Error('没找到可用的摄像头')
    if (name === 'TimeoutError') throw new Error('相机启动超时：检查相机权限弹窗，或改用「手动配对」')
    throw new Error('打开相机失败' + (e instanceof Error ? '：' + e.message : ''))
  }
  const { default: jsQR } = await modPromise

  video.muted = true
  video.playsInline = true
  video.setAttribute('playsinline', 'true')
  video.srcObject = stream

  const play = async (): Promise<boolean> => {
    try {
      await video.play()
      return true
    } catch {
      return false
    }
  }

  /* 首帧：先直接 play；被拦就等元数据再试一次，仍不行交回 UI 让用户点 */
  if (await play()) {
    onState('ready')
  } else {
    await new Promise<void>(res => {
      const done = () => res()
      video.addEventListener('loadedmetadata', done, { once: true })
      setTimeout(done, 900)
    })
    if (await play()) onState('ready')
    else onState('tap')
  }

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
    if (ctx && video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth) {
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

  return { stop, play }
}
