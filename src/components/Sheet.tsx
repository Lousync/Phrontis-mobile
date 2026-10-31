import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useApp } from '../lib/store'

/**
 * 底部抽屉容器：挂载即播放滑入动画（进动画保留，关闭直接卸载——M0 从简）。
 * 含遮罩，点遮罩关闭。
 */
export function Sheet({ children }: { children: ReactNode }) {
  const { closeSheet } = useApp()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const r = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(r)
  }, [])
  return (
    <>
      <div className="backdrop open" onClick={closeSheet} />
      <div className={'sheet' + (open ? ' open' : '')}>{children}</div>
    </>
  )
}

export function Grip() {
  return <div className="sheet-grip" />
}
