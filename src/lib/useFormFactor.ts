import { useEffect, useState } from 'react'

export type FormFactor = 'phone' | 'tablet'

const MQ = '(min-width: 768px)'

/**
 * 形态检测（T0）：视口 ≥768px 视为平板 → TabletShell（侧栏壳）；其余走手机浮坞壳。
 * iPad 竖屏 768pt、横屏 1024pt 均命中；手机横屏（部分机型 ~915px）会被误判为平板，
 * 但手机横屏属低频场景，先按宽度一刀切，真机反馈后再加 pointer/UA 细化（design.md §10）。
 * 断点变化（旋转/分屏拖拽）实时切换，壳层跟着换。
 */
export function useFormFactor(): FormFactor {
  const [ff, setFf] = useState<FormFactor>(() =>
    typeof matchMedia !== 'undefined' && matchMedia(MQ).matches ? 'tablet' : 'phone',
  )
  useEffect(() => {
    const mq = matchMedia(MQ)
    const on = (e: MediaQueryListEvent) => setFf(e.matches ? 'tablet' : 'phone')
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return ff
}
