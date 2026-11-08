import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AiProvider } from '../lib/types'
import { fetchModels, presetOf, recTagsOf } from '../lib/ai'
import { ICheck, IChevL, IRefresh, ISearch, IX } from './icons'

/**
 * 模型选择器（design.md §0 2026-11-06 第 35⑥ 条，原型 prototype/model-picker.html）
 *
 * 形态：**全屏子页从右侧滑入**（同扫码页 scan-full），不是底部上伸抽屉——
 * 项目 UI 硬规则禁止 bottom sheet，别改回去。
 *
 * 为什么用 portal 挂到 .app：它由 AI 配置全屏子页（FullPage，z 50）内部触发，
 * portal 进壳层后 z-index 60 才能盖住子页（与扫码页同级）。
 */
export function ModelPicker({
  provider, baseUrl, apiKey, current, defaultModel, onPick, onClose,
}: {
  provider: AiProvider
  /** 预设地址（用户未覆盖时用它拉清单） */
  baseUrl: string
  /** 可用于拉取的 Key（调用方负责回落到已存 Key） */
  apiKey: string
  current: string
  defaultModel: string
  onPick: (model: string) => void
  onClose: () => void
}) {
  const preset = presetOf(provider)
  const [open, setOpen] = useState(false)
  const [kw, setKw] = useState('')
  const [list, setList] = useState<string[]>([])
  const [fetching, setFetching] = useState(false)
  const [msg, setMsg] = useState('')
  const kwRef = useRef<HTMLInputElement>(null)

  /* 入场：挂载后下一帧加 open，否则初始样式与目标样式同帧落地、没有滑入 */
  useEffect(() => {
    const r = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(r)
  }, [])

  /* 打开即拉清单：模型选择页的价值就是「不用手打模型名」。
     失败不挡路——仍可搜索/手填，底部如实说明来源。 */
  const doFetch = async () => {
    if (fetching) return
    setFetching(true)
    setMsg('')
    try {
      const r = await fetchModels({ provider, baseUrl, apiKey, model: '' })
      setList(r)
      setMsg(`已从端点拉取 ${r.length} 个`)
    } catch (e) {
      setList([])
      setMsg((e instanceof Error ? e.message : '拉取失败') + ' · 可直接手填')
    } finally {
      setFetching(false)
    }
  }

  useEffect(() => { void doFetch() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [provider])

  /* 推荐组：预设默认模型 + 当前已选 + 免费档（≤4，绿标前置）；其余进「全部模型」。
     免费档进推荐是 2026-11-08 拍板——用户开选择器要一眼看到「哪些免费」。 */
  const groups = useMemo(() => {
    const all = list.filter(m => m.toLowerCase().includes(kw.trim().toLowerCase()))
    if (!list.length) return null
    const free = all.filter(m => recTagsOf(provider, m).some(([c]) => c === 'free')).slice(0, 4)
    const first = [defaultModel, current, ...free].filter((m, i, a) => m && all.includes(m) && a.indexOf(m) === i)
    const rest = all.filter(m => !first.includes(m))
    return { first, rest }
  }, [list, kw, defaultModel, current, provider])

  const body = createPortal(
    <div className={'mp-full' + (open ? ' open' : '')} role="dialog" aria-label="选择模型">
      <div className="mp-head">
        <button className="mp-back" onClick={onClose} aria-label="返回"><IChevL size={18} /></button>
        <span className="mp-t">选择模型</span>
        <span className="mp-from">
          <span className="pdot" style={{ background: preset.color }} />
          来自 {preset.name} · {fetching ? '…' : list.length || '—'}
        </span>
      </div>

      <div className="mp-search">
        <span className="mp-search-ico"><ISearch size={14} /></span>
        <input
          ref={kwRef}
          value={kw}
          onChange={e => setKw(e.target.value)}
          placeholder="搜索模型"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {kw && <button className="mp-clear" onClick={() => { setKw(''); kwRef.current?.focus() }}><IX size={13} /></button>}
      </div>

      <div className="mp-list">
        {fetching && <div className="mp-hint"><span className="spin" />正在向端点拉取模型清单…</div>}

        {!fetching && groups && (
          <>
            {groups.first.length > 0 && (
              <>
                <div className="mp-g">推荐</div>
                {groups.first.map(m => <ModelCard key={'r' + m} name={m} on={m === current} color={preset.color} rec={recTagsOf(provider, m)} onPick={onPick} />)}
              </>
            )}
            {groups.rest.length > 0 && (
              <>
                <div className="mp-g">{groups.first.length ? '全部模型' : '模型'}</div>
                {groups.rest.map(m => <ModelCard key={'a' + m} name={m} on={m === current} color={preset.color} rec={recTagsOf(provider, m)} onPick={onPick} />)}
              </>
            )}
            {!groups.first.length && !groups.rest.length && (
              <div className="mp-empty">没有匹配的模型</div>
            )}
          </>
        )}

        {/* 搜索词在清单里找不到 → 允许直接采用手填值（清单可能不全或拉取失败） */}
        {!fetching && kw.trim() && !(groups && [...groups.first, ...groups.rest].includes(kw.trim())) && (
          <button className="mp-manual" onClick={() => onPick(kw.trim())}>
            直接使用「<span className="mono">{kw.trim()}</span>」
          </button>
        )}

        {!fetching && !list.length && (
          <div className="mp-hint">
            未能从端点拿到清单{msg ? `（${msg}）` : ''}。可在上方输入模型名后选「直接使用」，或回到表单手填。
          </div>
        )}
      </div>

      <div className="mp-foot">
        {msg || '清单由端点 /models 拉取 · 拉取失败可手填'}
        <button className="mp-refresh" disabled={fetching} onClick={() => void doFetch()}>
          <IRefresh size={12} />重新拉取
        </button>
      </div>
    </div>,
    document.querySelector('.app') ?? document.body,
  )

  return body
}

/** 模型卡：家族徽标 + mono 名 + 标签（家族静态推断 + 推荐档位）+ 选中圆勾 */
function ModelCard({ name, on, color, rec, onPick }: {
  name: string; on: boolean; color: string
  /** 推荐档位标签（免费/性价比/旗舰，来自 MODEL_RECS） */
  rec?: Array<['free' | 'eco' | 'flag', string]>
  onPick: (m: string) => void
}) {
  const fam = familyOf(name)
  return (
    <button className={'mp-card' + (on ? ' sel' : '')} onClick={() => onPick(name)}>
      <span className="mp-avatar" style={{ background: fam?.color ?? color }}>{(name[0] ?? '?').toUpperCase()}</span>
      <span className="mp-body">
        <span className="mp-name">{name}</span>
        {(fam || rec?.length) && (
          <span className="mp-tags">
            {rec?.map(([cls, text]) => <span key={'rec' + text} className={'mp-tag ' + cls}>{text}</span>)}
            {fam?.tags.map(([cls, text]) => <span key={text} className={'mp-tag ' + cls}>{text}</span>)}
          </span>
        )}
      </span>
      <span className="mp-tick"><ICheck size={11} /></span>
    </button>
  )
}

/**
 * 已知模型家族 → 标签。只对认得的家族配标签；陌生模型只有名字（不猜）。
 * 标签是**静态推断**（名字前缀），不代表端点真实能力，原型里也是同一口径。
 */
const FAMILIES: Array<{ re: RegExp; color: string; tags: Array<[string, string]> }> = [
  { re: /claude/i, color: '#b07a18', tags: [['r', '推理'], ['ctx', '长文本']] },
  { re: /gpt-5|gpt-4|^o[134](-|$)/i, color: '#0f766e', tags: [['r', '推理'], ['vision', '视觉']] },
  { re: /gemini/i, color: '#7c5cd6', tags: [['ctx', '长文本'], ['vision', '视觉']] },
  { re: /deepseek/i, color: '#4d6bfe', tags: [['eco', '经济']] },
  { re: /qwen/i, color: '#615ced', tags: [['fast', '快速']] },
  { re: /kimi|moonshot/i, color: '#c0392b', tags: [['ctx', '长文本']] },
  { re: /glm/i, color: '#3859ff', tags: [['eco', '经济']] },
  { re: /coder/i, color: '#1f6f43', tags: [['r', '代码']] },
  { re: /llama|mistral|gemma|phi/i, color: '#8a6d3b', tags: [['eco', '经济']] },
]

function familyOf(name: string) {
  return FAMILIES.find(f => f.re.test(name))
}
