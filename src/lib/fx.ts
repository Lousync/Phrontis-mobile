/** 粒子迸发：从元素中心迸出 9 颗（完成反馈组合拳的一层；只动 transform/opacity） */
export function burstAt(el: Element | null) {
  if (!el) return
  const holder = document.createElement('span')
  holder.className = 'parts'
  el.appendChild(holder)
  const colors = ['var(--green)', 'var(--accent-hover)', '#ffffff', 'var(--amber)']
  for (let i = 0; i < 9; i++) {
    const p = document.createElement('i')
    const a = (Math.PI * 2 * i) / 9 + Math.random() * 0.5
    const r = 16 + Math.random() * 14
    p.style.setProperty('--tx', Math.cos(a) * r + 'px')
    p.style.setProperty('--ty', Math.sin(a) * r + 'px')
    p.style.background = colors[i % colors.length]
    holder.appendChild(p)
  }
  setTimeout(() => holder.remove(), 520)
}

/** 圆形扩散起点：元素中心换算到 .app 坐标系（clip-path circle 的 at 参数） */
export function circleFrom(el: Element, container: Element): { x: number; y: number; r: number } {
  const b = el.getBoundingClientRect()
  const s = container.getBoundingClientRect()
  const x = b.left + b.width / 2 - s.left
  const y = b.top + b.height / 2 - s.top
  const r = Math.hypot(Math.max(x, s.width - x), Math.max(y, s.height - y)) + 20
  return { x, y, r }
}
