import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../lib/store'
import { useFormFactor } from '../lib/useFormFactor'
import { circleFrom } from '../lib/fx'

/**
 * 全屏子页容器（AGENTS.md UI 三形态之「独立任务」）：整页进入 + 左上返回，
 * 取代遗留 Sheet（2026-11-06 规范禁 bottom sheet；2026-11-07 六个调用点全部改造完成）。
 *
 * 入场动效与全局切页同源：带触发元素（sheetOrigin）时从触发点 clip-path 圆形铺开
 * （280ms，Sheet 时代同款曲线），无触发元素（程序化打开）直接淡入。
 * 不渲染遮罩——全屏子页盖住壳层本身，点按返回关闭。
 *
 * 平板落位（A+F，design.md §0 2026-11-08，原型 prototype/tablet-panel.html 拍板）：
 * portal 进内容区（.pages）停靠——侧栏纹丝不动、恒定两栏铁律不破，头与体收进
 * 640px 居中列（见 index.css）；圆形扩散坐标相对停靠后的自身盒，起点自然落在列内。
 * 手机维持盖整窗不变。
 */
export function FullPage({ children, className }: { children: ReactNode; className?: string }) {
  const { sheetOrigin } = useApp()
  const ff = useFormFactor()
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(!sheetOrigin)
  useEffect(() => {
    const el = ref.current
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (sheetOrigin && el && !reduce) {
      const { x, y, r } = circleFrom(sheetOrigin, el)
      setOpen(true)
      const anim = el.animate(
        [{ clipPath: `circle(0px at ${x}px ${y}px)` }, { clipPath: `circle(${r}px at ${x}px ${y}px)` }],
        { duration: 280, easing: 'cubic-bezier(.23,1,.32,1)' },
      )
      return () => { anim.cancel() }
    }
    const r = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(r)
  }, [])
  const node = (
    <div ref={ref} className={'full-page' + (open ? ' open' : '') + (className ? ' ' + className : '')} role="dialog" aria-modal="true">
      {children}
    </div>
  )
  /* 平板：停靠内容区（.pages 是 position:relative 的定位上下文，inset:0 即内容区边界）；
     手机：原位渲染（父级就是 .app）。 */
  if (ff === 'tablet') return createPortal(node, fullPageHost())
  return node
}

/** 全屏子页/模型选择器的宿主：平板 = 内容区，手机 = 整壳（供 portal 类组件统一取用） */
export function fullPageHost(): HTMLElement {
  return (document.querySelector('.app.tablet .pages') as HTMLElement)
    ?? (document.querySelector('.app') as HTMLElement)
    ?? document.body
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
