import type { QuizOption, QuizSpec } from './types'

/* ---------- md 文档的 quiz 围栏解析（对齐桌面 QuizParser 的新格式） ----------
 * 桌面契约：每题一个 ```quiz 围栏 JSON —— {"no":1,"question":"...","options":[{"key":"A","text":"..."}],
 * "answer":"A","explanation":"..."}；简答 {"type":"short","answer":"参考答案","referenceAnswer":"..."}。
 * 兼容 options 为字符串数组的写法（["..."] → 自动配 A/B/C…）。 */

export type DocSegment =
  | { kind: 'md'; text: string }
  | { kind: 'quiz'; spec: QuizSpec }

const FENCE = /```quiz[^\n]*\n([\s\S]*?)```/g

function normalizeOptions(raw: unknown): QuizOption[] {
  if (!Array.isArray(raw)) return []
  return raw.map((o, i) => {
    if (typeof o === 'string') return { key: String.fromCharCode(65 + i), text: o }
    const obj = o as { key?: string; text?: string }
    return { key: obj.key || String.fromCharCode(65 + i), text: obj.text || '' }
  })
}

/** md 正文切段：quiz 围栏成为独立交互段，其余照常走 mdRender */
export function splitDocSegments(body: string): DocSegment[] {
  const segs: DocSegment[] = []
  let last = 0
  for (const m of body.matchAll(FENCE)) {
    const before = body.slice(last, m.index)
    if (before.trim()) segs.push({ kind: 'md', text: before })
    try {
      const j = JSON.parse(m[1]) as Record<string, unknown>
      const type = j.type === 'short' || typeof j.referenceAnswer === 'string' ? 'short' : 'choice'
      segs.push({
        kind: 'quiz',
        spec: {
          no: Number(j.no) || segs.filter(s => s.kind === 'quiz').length + 1,
          question: String(j.question || ''),
          options: type === 'choice' ? normalizeOptions(j.options) : [],
          answer: String(j.answer || j.referenceAnswer || ''),
          explanation: String(j.explanation || ''),
          type,
          referenceAnswer: typeof j.referenceAnswer === 'string' ? j.referenceAnswer : undefined,
        },
      })
    } catch {
      // 围栏 JSON 坏了 → 当普通代码块内容回退，不让整篇渲染崩掉
      segs.push({ kind: 'md', text: '```quiz\n' + m[1] + '```' })
    }
    last = (m.index || 0) + m[0].length
  }
  const tail = body.slice(last)
  if (tail.trim()) segs.push({ kind: 'md', text: tail })
  return segs
}
