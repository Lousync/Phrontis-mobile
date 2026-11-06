import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useApp } from '../lib/store'
import { circleFrom } from '../lib/fx'

/**
 * 底部抽屉容器：默认滑入；带触发元素（sheetOrigin）时改用圆形扩散——
 * 从 FAB / 行 / 按钮中心 clip-path 圆形铺开（280ms），遮罩照常淡入，关闭仍是直接卸载。
 * 含遮罩，点遮罩关闭。
 */
export function Sheet({ children }: { children: ReactNode }) {
  const { closeSheet, sheetOrigin } = useApp()
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(!sheetOrigin)
  useEffect(() => {
    const el = ref.current
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (sheetOrigin && el && !reduce) {
      const app = el.closest('.app')
      if (app) {
        /* 圆形展开：锚定触发元素中心。
         * ★ 必须先落位再铺开——.sheet 缺省 bottom:-100%（藏屏外），只 animate clip-path 的话
         *   遮罩展开的是一块屏幕外的元素，抽屉永远不出现（2026-11-06 实测抓到的真 bug：
         *   冒烟只数 DOM 节点所以一直绿）。落位用内联 transition:none 瞬时完成，
         *   入场观感全交给 clip-path；收起仍走 bottom 通道。 */
        const { x, y, r } = circleFrom(sheetOrigin, app)
        setOpen(true)
        el.style.transition = 'none'
        const anim = el.animate(
          [{ clipPath: `circle(0px at ${x}px ${y}px)` }, { clipPath: `circle(${r}px at ${x}px ${y}px)` }],
          { duration: 280, easing: 'cubic-bezier(.23,1,.32,1)' },
        )
        /* 动画结束恢复 transition —— 键盘停靠要靠它把抽屉平滑上提 */
        anim.finished.then(() => { el.style.transition = '' }).catch(() => { /* canceled：卸载中 */ })
        return () => { anim.cancel(); el.style.transition = '' }
      }
    }
    const r = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(r)
  }, [])
  return (
    <>
      <div className="backdrop open" onClick={closeSheet} />
      <div ref={ref} className={'sheet' + (open ? ' open' : '')}>{children}</div>
    </>
  )
}

export function Grip() {
  return <div className="sheet-grip" />
}
