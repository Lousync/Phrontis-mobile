import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useApp } from '../lib/store'
import { circleFrom } from '../lib/fx'

/**
 * 全屏子页容器（AGENTS.md UI 三形态之「独立任务」）：整页进入 + 左上返回，
 * 取代遗留 Sheet（2026-11-06 规范禁 bottom sheet；2026-11-07 六个调用点全部改造完成）。
 *
 * 入场动效与全局切页同源：带触发元素（sheetOrigin）时从触发点 clip-path 圆形铺开
 * （280ms，Sheet 时代同款曲线），无触发元素（程序化打开）直接淡入。
 * 不渲染遮罩——全屏子页盖住壳层本身，点按返回关闭。
 */
export function FullPage({ children, className }: { children: ReactNode; className?: string }) {
  const { sheetOrigin } = useApp()
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(!sheetOrigin)
  useEffect(() => {
    const el = ref.current
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (sheetOrigin && el && !reduce) {
      const app = el.closest('.app')
      if (app) {
        const { x, y, r } = circleFrom(sheetOrigin, app)
        setOpen(true)
        const anim = el.animate(
          [{ clipPath: `circle(0px at ${x}px ${y}px)` }, { clipPath: `circle(${r}px at ${x}px ${y}px)` }],
          { duration: 280, easing: 'cubic-bezier(.23,1,.32,1)' },
        )
        return () => { anim.cancel() }
      }
    }
    const r = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(r)
  }, [])
  return (
    <div ref={ref} className={'full-page' + (open ? ' open' : '') + (className ? ' ' + className : '')} role="dialog" aria-modal="true">
      {children}
    </div>
  )
}

/** 全屏子页标准头：左上返回 + 标题 + 右侧可选动作（对齐 ModelPicker / ScanOverlay 的头部口径） */
export function FullPageHead({ title, children }: { title: ReactNode; children?: ReactNode }) {
  const { closeSheet } = useApp()
  return (
    <div className="fp-head">
      <button className="fp-back" onClick={closeSheet} aria-label="返回">
        <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
      </button>
      <span className="fp-title">{title}</span>
      {children}
    </div>
  )
}
