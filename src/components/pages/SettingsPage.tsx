import { useEffect, useRef, useState } from 'react'
import type { AiConfig, AiProvider, ThemeName } from '../../lib/types'
import { AI_PRESETS, aiConfigReady, fetchModels, presetOf, testAiConfig, type AiPreset } from '../../lib/ai'
import { discoverCompanions, pollPair, requestPair, type DiscoveredPc } from '../../lib/sync'
import { useApp } from '../../lib/store'
import { IBars, ICheck, IChevL, IChevR, IKeyboard, IMonitor, IRefresh, ISparkle, IX, IEye } from '../../components/icons'
import { PageHead } from '../../components/chrome'
import { Sheet, Grip } from '../Sheet'

/** 主题选择器清单（色板预览用固定色值——色板必须展示目标主题自己的颜色，不能随当前主题变） */
const THEME_PICKS: Array<{ id: ThemeName; name: string; bg: string; line: string; dot: string }> = [
  { id: 'dark', name: '深色', bg: '#1e1e1e', line: '#cccccc', dot: '#007acc' },
  { id: 'light', name: '浅色', bg: '#ffffff', line: '#333333', dot: '#0078d4' },
  { id: 'opencode', name: 'OpenCode 灰', bg: '#f1ecec', line: '#211e1e', dot: '#211e1e' },
  { id: 'spring', name: '春 · 嫩芽', bg: '#f2f6ea', line: '#2f3d2a', dot: '#418431' },
  { id: 'summer', name: '夏 · 骄阳', bg: '#f7f7e0', line: '#333d23', dot: '#178343' },
  { id: 'autumn', name: '秋 · 金秋', bg: '#f8f2df', line: '#4a3f24', dot: '#9c6c0c' },
  { id: 'winter', name: '冬 · 初雪', bg: '#f1f6fb', line: '#2b3a47', dot: '#2f74b5' },
]

/**
 * 设置页。同步区 = M1 真实配对（协议 docs/design.md §2.1）：
 * 未配对时输入电脑地址 + 配对码（桌面端 工具箱 → 手机伴侣 出示），配对后长期互信。
 * 原型阶段手机浏览器没有相机可用，扫码（APK 相机）随 M6 打包阶段接入。
 * AI 区 = M4a 直连档配置（pm.aiConfig，Key 只在本机）。
 */
export function SettingsPage({ active }: { active: boolean }) {
  const { paired, online, syncing, syncPct, lastSync, runSync, pairWith, adoptPaired, unpair, theme, setTheme, toast, aiConfig, setActiveTab, kbSim, toggleKbSim, openSheet } = useApp()
  const [scope, setScope] = useState<Record<string, boolean>>({ 记账: true, 日程: true, 笔记: true, 'AI 会话记录': false })
  const [pairInput, setPairInput] = useState('')
  const [pairCode, setPairCode] = useState('')
  const [pairing, setPairing] = useState(false)
  const [confirmUnpair, setConfirmUnpair] = useState(false)
  /* v1.5 发现 + 桌面确认式配对 */
  const [discovering, setDiscovering] = useState(false)
  const [found, setFound] = useState<DiscoveredPc[]>([])
  const [pairMsg, setPairMsg] = useState('')
  const [manualOpen, setManualOpen] = useState(false)
  const [pairReq, setPairReq] = useState<{ baseUrl: string; pcName: string; requestId: string; code: string } | null>(null)
  const pollRef = useRef<number | null>(null)

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  /* 已存配置的连接测试状态（摘要卡上；表单内测试在抽屉里另有一份） */
  const [testSt, setTestSt] = useState<null | { ok: boolean; ms?: number }>(null)
  const [testing, setTesting] = useState(false)
  /* 入口行展示的当前主题（色板固定取目标主题自己的色值，不随当前主题变） */
  const curTheme = THEME_PICKS.find(t => t.id === theme) ?? THEME_PICKS[0]

  const scopeRows: Array<{ k: string; label: string; why?: string }> = [
    { k: '记账', label: '记账 · 双向按条目合并（含删除）' },
    { k: '日程', label: '日程 · 双向按条目合并（含删除）' },
    { k: '笔记', label: '笔记 · 手机笔记上行 + 电脑笔记只读缓存' },
    { k: 'AI 会话记录', label: 'AI 会话记录', why: '二期' },
  ]

  const doPair = async () => {
    setPairing(true)
    try {
      await pairWith(pairInput, pairCode)
    } finally {
      setPairing(false)
    }
  }

  /* v1.5：扫段找电脑（WebView 拿不到本机 IP，只能按常见网段枚举） */
  const doDiscover = async () => {
    setDiscovering(true)
    setPairMsg('')
    setFound([])
    try {
      const list = await discoverCompanions()
      setFound(list)
      if (!list.length) {
        setPairMsg('没搜到电脑。确认手机与电脑在同一 Wi-Fi（或热点）、电脑端「手机伴侣」已开启；也可以手动配对。')
      }
    } catch (e) {
      setPairMsg(e instanceof Error ? e.message : '搜索失败')
    } finally {
      setDiscovering(false)
    }
  }

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    setPairReq(null)
  }

  /* v1.5：点发现的电脑 → 电脑弹确认框 → 这里轮询结果（approved 即落盘并接首次对账） */
  const doRequest = async (pc: DiscoveredPc) => {
    setPairing(true)
    setPairMsg('')
    try {
      const r = await requestPair(pc.baseUrl, 'Phrontis 手机')
      setPairReq({ baseUrl: pc.baseUrl, pcName: pc.pcName, requestId: r.requestId, code: r.code })
      if (pollRef.current) clearInterval(pollRef.current)
      const startedAt = Date.now()
      pollRef.current = window.setInterval(() => {
        void (async () => {
          try {
            const p = await pollPair(pc.baseUrl, r.requestId)
            if (p.status === 'approved' && p.device) {
              stopPolling()
              await adoptPaired(p.device)
            } else if (p.status === 'rejected') {
              stopPolling()
              toast('电脑拒绝了这次配对', 'warn')
            } else if (p.status === 'expired' || Date.now() - startedAt > 200_000) {
              stopPolling()
              toast('配对请求已过期，重新搜索', 'warn')
            }
          } catch { /* 单次查询失败继续轮询（电脑端可能正忙） */ }
        })()
      }, 1500)
    } catch (e) {
      toast(e instanceof Error ? e.message : '发起配对失败', 'warn')
    } finally {
      setPairing(false)
    }
  }

  const ready = aiConfigReady(aiConfig)
  const preset = presetOf(aiConfig.provider)
  const doTestSaved = async () => {
    setTesting(true)
    const t0 = performance.now()
    try {
      await testAiConfig(aiConfig)
      setTestSt({ ok: true, ms: Math.round(performance.now() - t0) })
    } catch (e) {
      setTestSt({ ok: false })
      toast(e instanceof Error ? e.message : '连接失败', 'warn')
    } finally {
      setTesting(false)
    }
  }

  return (
    <section className={'page' + (active ? ' active' : '')}>
      <PageHead title="设置" />

      <div>
        <div className="set-label">同步</div>
        <div className="card">
          {!paired ? (
            pairReq ? (
              /* 已向电脑发起请求：同屏 4 位码核对，电脑点「允许」后自动落盘 */
              <>
                <div className="device-card">
                  <div className="device-ico"><IMonitor /></div>
                  <div className="info">
                    <div className="n">{pairReq.pcName}</div>
                    <div className="s">等待电脑确认 · 已发起配对请求</div>
                  </div>
                </div>
                <div style={{ textAlign: 'center', padding: '18px 0 4px' }}>
                  <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: '0.22em', fontVariantNumeric: 'tabular-nums', color: 'var(--accent-hover)' }}>
                    {pairReq.code}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6 }}>
                    核对电脑「工具箱 → 手机伴侣」里显示的验证码<br />一致就点「允许」，两边号码不同请点「拒绝」
                  </div>
                </div>
                <button className="btn-ghost" style={{ height: 44, width: '100%', marginTop: 10 }} onClick={stopPolling}>取消</button>
              </>
            ) : (
              <>
                <div className="device-card">
                  <div className="device-ico"><IMonitor /></div>
                  <div className="info">
                    <div className="n">未配对电脑</div>
                    <div className="s">同一 Wi-Fi 下自动搜索，配对后双向同步</div>
                  </div>
                </div>
                <button className="btn-primary" style={{ marginTop: 12 }} disabled={discovering || pairing} onClick={() => void doDiscover()}>
                  {discovering ? '搜索中…（约几秒）' : '搜索电脑'}
                </button>
                {found.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    {found.map(pc => (
                      <button key={pc.baseUrl} className="tool-row" disabled={pairing} onClick={() => void doRequest(pc)}>
                        <span className="tool-ico"><IMonitor size={16} /></span>
                        <span className="tool-body">
                          <span className="n">{pc.pcName}</span>
                          <span className="s">{pc.baseUrl.replace('http://', '')}{pc.canRequest ? ' · 请求配对' : ' · 需配对码'}</span>
                        </span>
                        <IChevR size={14} />
                      </button>
                    ))}
                  </div>
                )}
                {pairMsg && (
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.6, marginTop: 10 }}>{pairMsg}</div>
                )}
                <button className="adv-toggle" style={{ marginTop: 8 }} onClick={() => setManualOpen(v => !v)}>
                  <IChevR size={12} style={{ transform: manualOpen ? 'rotate(90deg)' : 'none', transition: 'transform .16s' }} />
                  手动配对（电脑端出示配对码）
                </button>
                {manualOpen && (
                  <>
                    <div className="field" style={{ marginTop: 4 }}>
                      <label>电脑地址或配对链接</label>
                      <input value={pairInput} onChange={e => setPairInput(e.target.value)}
                        placeholder="192.168.1.5:8770 或整条配对链接" />
                    </div>
                    <div className="field">
                      <label>配对码（电脑端 工具箱 → 手机伴侣 出示）</label>
                      <input value={pairCode} onChange={e => setPairCode(e.target.value)}
                        placeholder="8 位数字" inputMode="numeric" />
                    </div>
                    <button className="btn-primary" disabled={pairing || !pairInput.trim()} onClick={() => void doPair()}>
                      {pairing ? '配对中…' : '配对'}
                    </button>
                  </>
                )}
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.6, marginTop: 10 }}>
                  电脑端先开启「工具箱 → 手机伴侣」；配对一次后长期互信，同网自动重连。
                </div>
              </>
            )
          ) : (
            <>
              <div className="device-card">
                <div className="device-ico"><IMonitor /></div>
                <div className="info">
                  <div className="n">{paired.pcName}</div>
                  <div className="s"><span className="gdot" /><span>{online ? '已连接' : '离线'} · 上次同步 {lastSync}</span></div>
                </div>
              </div>
              <div className={'sync-progress' + (syncing ? ' on' : '')}><span className="fill" style={{ width: syncPct + '%' }} /></div>
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <button className="btn-primary" style={{ flex: 1 }} onClick={runSync}>立即同步</button>
                {confirmUnpair ? (
                  <>
                    <button className="btn-ghost" style={{ height: 44, color: 'var(--danger)' }}
                      onClick={() => { unpair(); setConfirmUnpair(false) }}>确认解除</button>
                    <button className="btn-ghost" style={{ height: 44 }} onClick={() => setConfirmUnpair(false)}>取消</button>
                  </>
                ) : (
                  <button className="btn-ghost" style={{ height: 44 }} onClick={() => setConfirmUnpair(true)}>解除配对</button>
                )}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.6, marginTop: 10 }}>
                {paired.baseUrl.replace('http://', '')} · 同步范围：记账 + 日程 + 笔记（含删除）
              </div>
            </>
          )}
        </div>
      </div>

      <div>
        <div className="set-label">同步范围</div>
        <div className="card" style={{ padding: '4px 14px' }}>
          {scopeRows.map(r => (
            <div key={r.k} className={'check-row' + (scope[r.k] ? ' on' : '')} onClick={() => setScope(s => ({ ...s, [r.k]: !s[r.k] }))}>
              <span className="box">{scope[r.k] && <ICheck size={11} />}</span>
              {r.label}
              {r.why && <span className="why">{r.why}</span>}
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="set-label">工具</div>
        <div className="card" style={{ padding: '2px 14px' }}>
          {/* 用量从底栏降级到这里的二级入口（M3 ≤5 规范） */}
          <button className="tool-row" onClick={e => setActiveTab('usage', e.currentTarget)}>
            <span className="tool-ico"><IBars /></span>
            <span className="tool-body">
              <span className="n">AI 用量</span>
              <span className="s">Token · 花费 · 按模型统计</span>
            </span>
            <IChevR size={14} />
          </button>
        </div>
      </div>

      <div>
        <div className="set-label">AI 模型（手机直连）</div>
        <div className="card">
          <div className="device-card">
            <div className="device-ico"><ISparkle /></div>
            <div className="info">
              <div className="n"><span className="pdot" style={{ background: preset.color }} />{preset.name}</div>
              <div className="s">
                <span className="mono">{aiConfig.model || '未选模型'}</span>
                <span className={'st' + (!ready ? '' : testSt === null ? ' idle' : testSt.ok ? ' ok' : ' bad')}>
                  {!ready ? '未配置' : testSt === null ? '未测试' : testSt.ok ? `可用 · ${testSt.ms}ms` : '连接失败'}
                </span>
              </div>
            </div>
          </div>
          <div className="btn-row">
            <button className="btn-primary" disabled={!ready || testing} onClick={() => void doTestSaved()}>
              {testing ? '测试中…' : '测试连接'}
            </button>
            <button className="btn-ghost" style={{ height: 44 }} onClick={e => openSheet('ai-config', e.currentTarget)}>更换供应商</button>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.6, marginTop: 10 }}>
            Key 只存手机本地，不上行不同步。换供应商不会丢聊天记录。
          </div>
        </div>
      </div>

      <div>
        <div className="set-label">外观</div>
        <div className="card">
          {/* 外观：一行式主题入口（2026-11-06 方案 A——七套平铺占两行半高度，收进抽屉；
             色板展示目标主题自己的颜色，不随当前主题变） */}
          <button className="theme-entry" onClick={e => openSheet('theme', e.currentTarget)}>
            <span className="sw" style={{ background: curTheme.bg }}>
              <span className="dot" style={{ background: curTheme.dot }} />
              <i className="l1" style={{ background: curTheme.line }} />
              <i className="l2" style={{ background: curTheme.line }} />
            </span>
            <span className="body">
              <span className="n">{curTheme.name}</span>
              <span className="s">当前主题 · 点按更换</span>
            </span>
            <IChevR size={14} />
          </button>
          {/* 桌面 letterbox 专用（触屏经 CSS 隐藏）：验证键盘弹出时贴底控件上提 */}
          <div className="check-row kb-sim-row" onClick={toggleKbSim}>
            <span className={'box' + (kbSim ? ' on' : '')}>{kbSim && <ICheck size={11} />}</span>
            模拟输入法 <IKeyboard size={13} style={{ color: 'var(--text-muted)' }} />
            <span className="why">桌面调试</span>
          </div>
        </div>
      </div>

      <div className="ver">Phrontis Mobile {__APP_VERSION__} · 与桌面 3.15.1 配套</div>
    </section>
  )
}

/* =========================================================================
   外观主题抽屉（2026-11-06 方案 A：一行入口 + 抽屉，取代设置页 3 列平铺）
   点 chip 即 setTheme 并立即关闭，不做「留在抽屉里预览再手动关」。
   色板固定取目标主题自己的色值（THEME_PICKS），不随当前主题变。
   ========================================================================= */
export function ThemePickerSheet() {
  const { theme, setTheme, closeSheet } = useApp()
  return (
    <Sheet>
      <Grip />
      <div className="aic-head">
        <div className="aic-title">外观主题</div>
        <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={closeSheet}><IX size={14} /></button>
      </div>
      <div className="theme-grid">
        {THEME_PICKS.map(t => (
          <button
            key={t.id}
            className={'theme-chip' + (theme === t.id ? ' on' : '')}
            onClick={() => { setTheme(t.id); closeSheet() }}
          >
            <span className="sw" style={{ background: t.bg }}>
              <span className="dot" style={{ background: t.dot }} />
              <i className="l1" style={{ background: t.line }} />
              <i className="l2" style={{ background: t.line }} />
            </span>
            <span className="nm">{t.name}</span>
            {theme === t.id && <span className="tick"><ICheck size={10} /></span>}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 12, textAlign: 'center' }}>点一下即换，选完自动关闭</div>
    </Sheet>
  )
}

/* =========================================================================
   AI 配置抽屉（对齐桌面 AiModelsTab 的预设体系，2026-11-01 按原型 prototype/ai-config.html 落码）
   两步：选供应商（8 张预设卡）→ 添加表单（预设填好的明着列出，用户只补 Key / 接入点 ID）。
   ========================================================================= */
export function AiConfigSheet() {
  const { aiConfig, closeSheet } = useApp()
  const [step, setStep] = useState<'pick' | 'form'>('pick')
  const [formId, setFormId] = useState<AiProvider | null>(null)
  const p = formId ? presetOf(formId) : null
  return (
    <Sheet>
      <Grip />
      <div className="aic-head">
        <button className="icon-btn" style={{ visibility: step === 'form' ? 'visible' : 'hidden' }} onClick={() => setStep('pick')}>
          <IChevL size={16} />
        </button>
        <div className="aic-title">{step === 'pick' ? '选择供应商' : `添加「${p?.name}」`}</div>
        <button className="icon-btn" onClick={closeSheet}><IX size={14} /></button>
      </div>
      {step === 'pick' ? (
        <>
          <div className="prov-grid">
            {AI_PRESETS.map(pr => (
              <button key={pr.id} className="prov-card" onClick={() => { setFormId(pr.id); setStep('form') }}>
                <span className="pdot" style={{ background: pr.color }} />
                <span className="pv-info">
                  <span className="pn">{pr.name}{pr.id === aiConfig.provider && <em>当前</em>}</span>
                  <span className="ps">{pr.sub}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="prov-foot">
            <span>选中预设 → 只差粘一个 Key</span>
            <span>地址 / 协议 / 会话头由预设带好</span>
          </div>
        </>
      ) : p && <AiPresetForm key={p.id} preset={p} onSaved={closeSheet} />}
    </Sheet>
  )
}

/** 添加表单。状态全部本地草稿，保存才落 pm.aiConfig；key 换 preset 时由 key={p.id} 整体重挂 */
function AiPresetForm({ preset, onSaved }: { preset: AiPreset; onSaved: () => void }) {
  const { updateAiConfig, toast } = useApp()
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [model, setModel] = useState(preset.defaultModel)
  const [base, setBase] = useState('')
  const [headText, setHeadText] = useState('')
  const [adv, setAdv] = useState(false)
  const [fetched, setFetched] = useState<string[] | null>(null)
  const [fetching, setFetching] = useState(false)
  const [fetchMsg, setFetchMsg] = useState('')
  const [keyErr, setKeyErr] = useState(false)
  const [modelErr, setModelErr] = useState(false)
  const [testOut, setTestOut] = useState<{ kind: 'ok' | 'bad' | 'busy'; text: string } | null>(null)

  /* 表单 → 配置草稿；不合法返回错误文案与出错字段 */
  const build = (): { cfg?: AiConfig; err?: string; field?: 'key' | 'model' | 'base' } => {
    if (!preset.local && !apiKey.trim()) return { err: '还差一个 API Key。', field: 'key' }
    const m = model.trim()
    if (!m) return { err: preset.modelInput === 'endpoint' ? '火山方舟需要接入点 ID（ep- 开头）。' : '模型不能为空。', field: 'model' }
    const b = base.trim()
    if (preset.id === 'custom' && !b) return { err: '自定义端点需要接口地址（在高级里填）。', field: 'base' }
    let headers: Record<string, string> | undefined
    if (headText.trim()) {
      try {
        const v = JSON.parse(headText) as unknown
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error()
        headers = Object.fromEntries(
          Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === 'string' && !!x),
        ) as Record<string, string>
      } catch {
        return { err: '自定义请求头不是合法的 JSON 对象。', field: 'base' }
      }
    }
    return { cfg: { provider: preset.id, baseUrl: b, apiKey: apiKey.trim(), model: m, headers } }
  }

  const flag = (field?: 'key' | 'model' | 'base') => {
    setKeyErr(field === 'key')
    setModelErr(field === 'model')
  }

  const doSave = () => {
    const r = build()
    if (!r.cfg) { flag(r.field); setTestOut({ kind: 'bad', text: r.err! }); return }
    updateAiConfig(r.cfg)
    toast(`已保存 ${preset.name} · 只在本机`, 'ok')
    onSaved()
  }

  const doTest = async () => {
    const r = build()
    if (!r.cfg) { flag(r.field); setTestOut({ kind: 'bad', text: r.err! }); return }
    flag(undefined)
    setTestOut({ kind: 'busy', text: '正在连接端点，发一条最小探测消息…' })
    const t0 = performance.now()
    try {
      await testAiConfig(r.cfg)
      setTestOut({ kind: 'ok', text: `连接成功 · ${Math.round(performance.now() - t0)}ms · ${r.cfg.model} 应答正常。Key 有效，可以保存。` })
    } catch (e) {
      setTestOut({ kind: 'bad', text: e instanceof Error ? e.message : '连接失败' })
    }
  }

  const doFetch = async () => {
    if (fetching) return
    setFetching(true)
    setFetchMsg('')
    try {
      const list = await fetchModels({ provider: preset.id, baseUrl: base.trim(), apiKey: apiKey.trim(), model: '' })
      setFetched(list)
      if (!list.includes(model.trim())) setModel(list[0])
      setFetchMsg(`已拉取 ${list.length} 个模型`)
    } catch (e) {
      setFetched(null)
      setFetchMsg((e instanceof Error ? e.message : '拉取失败') + '——可直接手填。')
    } finally {
      setFetching(false)
    }
  }

  return (
    <>
      <div className="filled-box">
        <div className="fb-h">预设替你填好的（可改）</div>
        <div className="fb-r"><span className="k">接口地址</span><span className="v mono">{preset.base || '（自定义，在高级里填）'}</span></div>
        <div className="fb-r"><span className="k">协议</span><span className="v">{preset.local ? 'Ollama · OpenAI 兼容层' : 'OpenAI 兼容'}</span></div>
        {preset.header && (
          <div className="fb-r"><span className="k">会话头</span><span className="v mono">{Object.keys(preset.header)[0]}: 按对话自动带上</span></div>
        )}
        {preset.srcConfig && <div className="fb-r"><span className="k" /><span><span className="badge-doc">按官方文档</span></span></div>}
        {preset.unverified && <div className="fb-r"><span className="k" /><span><span className="badge-unv">地址未经在线核实</span> 测试连接后再用</span></div>}
      </div>

      <div className="field">
        <label>{preset.local ? 'API Key（本地可留空）' : 'API Key'}</label>
        <div className="key-wrap">
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey} disabled={preset.local}
            onChange={e => { setApiKey(e.target.value); setKeyErr(false) }}
            className={keyErr ? 'err' : ''}
            placeholder={preset.local ? '本地模型无需 API Key' : 'sk-…（只存手机本地）'} />
          {!preset.local && (
            <button className="key-eye" onClick={() => setShowKey(s => !s)}><IEye size={16} /></button>
          )}
        </div>
      </div>

      <div className="field">
        <label>{preset.modelInput === 'endpoint' ? '接入点 ID' : '模型'}</label>
        {preset.modelInput === 'endpoint' ? (
          <>
            <input className={'mono' + (modelErr ? ' err' : '')} value={model} spellCheck={false}
              onChange={e => { setModel(e.target.value); setModelErr(false) }} placeholder="ep-2026…" />
            <div className="model-cnt">{preset.modelHint}</div>
          </>
        ) : (
          <>
            <div className="model-row">
              {fetched ? (
                <select value={model} onChange={e => setModel(e.target.value)}>
                  {fetched.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              ) : (
                <input className={'mono' + (modelErr ? ' err' : '')} value={model} spellCheck={false}
                  onChange={e => { setModel(e.target.value); setModelErr(false) }}
                  placeholder={preset.defaultModel || '模型名'} />
              )}
              <button className={'model-fetch' + (fetching ? ' busy' : '')} onClick={() => void doFetch()}>
                {fetching ? <span className="spin" /> : <IRefresh size={13} />}
                {fetching ? '拉取中' : fetched ? '重新拉取' : '拉取清单'}
              </button>
            </div>
            <div className="model-cnt">{fetchMsg || (fetched ? `共 ${fetched.length} 个` : '也可拉取端点的模型清单来选')}</div>
          </>
        )}
      </div>

      <button className={'adv-toggle' + (adv ? ' open' : '')} onClick={() => setAdv(a => !a)}>
        <IChevR size={12} />高级（接口地址 / 自定义请求头）
      </button>
      {adv && (
        <div className="adv-body">
          <div className="field">
            <label>接口地址</label>
            <input className="mono" value={base} spellCheck={false} onChange={e => setBase(e.target.value)}
              placeholder={preset.base || 'https://your-host/v1'} />
          </div>
          <div className="field">
            <label>自定义请求头（JSON）</label>
            <input className="mono" value={headText} spellCheck={false} onChange={e => setHeadText(e.target.value)}
              placeholder='{"头名":"值"}' />
          </div>
        </div>
      )}

      {testOut && <div className={'test-out ' + testOut.kind}>
        {testOut.kind === 'busy'
          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span className="spin" />{testOut.text}</span>
          : testOut.text}
      </div>}

      <div className="aic-foot">
        <button className="btn-ghost" style={{ flex: 1, height: 44 }} onClick={() => void doTest()}>测试连接</button>
        <button className="btn-primary" style={{ flex: 1 }} onClick={doSave}>保存</button>
      </div>
    </>
  )
}
