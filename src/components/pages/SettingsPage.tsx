import { useEffect, useState } from 'react'
import type { AiConfig, AiProvider } from '../../lib/types'
import { AI_PRESETS, aiConfigReady, testAiConfig } from '../../lib/ai'
import { useApp } from '../../lib/store'
import { ICheck, IMonitor } from '../../components/icons'

const PROVIDERS: Array<{ key: AiProvider; label: string }> = [
  { key: 'deepseek', label: 'DeepSeek' },
  { key: 'glm', label: '智谱 GLM' },
  { key: 'custom', label: 'OpenAI 兼容' },
  { key: 'ollama', label: '本地 Ollama' },
]

/**
 * 设置页。同步区 = M1 真实配对（协议 docs/design.md §2.1）：
 * 未配对时输入电脑地址 + 配对码（桌面端 工具箱 → 手机伴侣 出示），配对后长期互信。
 * 原型阶段手机浏览器没有相机可用，扫码（APK 相机）随 M6 打包阶段接入。
 * AI 区 = M4a 直连档配置（pm.aiConfig，Key 只在本机）。
 */
export function SettingsPage({ active }: { active: boolean }) {
  const { paired, online, syncing, syncPct, lastSync, runSync, pairWith, unpair, theme, setTheme, toast, aiConfig, updateAiConfig } = useApp()
  const [scope, setScope] = useState<Record<string, boolean>>({ 记账: true, 日程: true, 笔记: true, 'AI 会话记录': false })
  const [pairInput, setPairInput] = useState('')
  const [pairCode, setPairCode] = useState('')
  const [pairing, setPairing] = useState(false)
  const [confirmUnpair, setConfirmUnpair] = useState(false)

  /* AI 配置草稿（保存才生效）；换提供商自动带出预设模型 */
  const [cfgDraft, setCfgDraft] = useState<AiConfig>(aiConfig)
  const [testing, setTesting] = useState(false)
  useEffect(() => { setCfgDraft(aiConfig) }, [aiConfig])

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

  const saveAi = () => {
    const preset = AI_PRESETS[cfgDraft.provider]
    updateAiConfig({ ...cfgDraft, model: cfgDraft.model.trim() || preset.model })
    toast('AI 配置已保存（只在本机）', 'ok')
  }

  const doTestAi = async () => {
    setTesting(true)
    try {
      const preset = AI_PRESETS[cfgDraft.provider]
      await testAiConfig({ ...cfgDraft, model: cfgDraft.model.trim() || preset.model })
      toast('连接成功，模型可用', 'ok')
    } catch (e) {
      toast(e instanceof Error ? e.message : '连接失败', 'warn')
    } finally {
      setTesting(false)
    }
  }

  return (
    <section className={'page' + (active ? ' active' : '')}>
      <div className="ai-head"><span className="t">设置</span></div>

      <div>
        <div className="set-label">同步</div>
        <div className="card">
          {!paired ? (
            <>
              <div className="device-card">
                <div className="device-ico"><IMonitor /></div>
                <div className="info">
                  <div className="n">未配对电脑</div>
                  <div className="s">配对后记账数据与电脑双向同步</div>
                </div>
              </div>
              <div className="field" style={{ marginTop: 12 }}>
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
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.6, marginTop: 10 }}>
                手机与电脑需在同一 Wi-Fi / 热点下；首次配对后两端长期互信，同网自动重连。
              </div>
            </>
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
                {paired.baseUrl.replace('http://', '')} · 同步范围：记账 + 日程（含删除；笔记 M3 接入）
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
        <div className="set-label">AI 模型（手机直连）</div>
        <div className="card">
          <div className="field" style={{ marginTop: 2 }}>
            <label>提供商</label>
            <select value={cfgDraft.provider} onChange={e => {
              const key = e.target.value as AiProvider
              setCfgDraft(d => ({ ...d, provider: key, model: AI_PRESETS[key].model }))
            }}
              style={{ width: '100%', background: 'var(--bg-tertiary)', border: '1px solid var(--border-soft)', borderRadius: 11, padding: '11px 13px', fontSize: 14, outline: 'none' }}>
              {PROVIDERS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </div>
          {cfgDraft.provider === 'custom' && (
            <div className="field">
              <label>服务地址（OpenAI 兼容根路径）</label>
              <input value={cfgDraft.baseUrl} onChange={e => setCfgDraft(d => ({ ...d, baseUrl: e.target.value }))}
                placeholder="https://your-host/v1" />
            </div>
          )}
          {cfgDraft.provider !== 'ollama' && (
            <div className="field"><label>API Key</label><input type="password" value={cfgDraft.apiKey} onChange={e => setCfgDraft(d => ({ ...d, apiKey: e.target.value }))} placeholder="sk-..." /></div>
          )}
          <div className="field"><label>模型</label><input value={cfgDraft.model} onChange={e => setCfgDraft(d => ({ ...d, model: e.target.value }))} placeholder={AI_PRESETS[cfgDraft.provider].model} /></div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn-primary" style={{ flex: 1 }} onClick={saveAi}>保存</button>
            <button className="btn-ghost" style={{ height: 44 }} disabled={testing} onClick={() => void doTestAi()}>{testing ? '测试中…' : '测试连接'}</button>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.6, marginTop: 10 }}>
            {aiConfigReady(aiConfig)
              ? '已配置：' + PROVIDERS.find(p => p.key === aiConfig.provider)?.label + ' · ' + aiConfig.model + '。Key 只存手机本地，不上行不同步。'
              : '还没配好——配好后 AI 才能真的帮你记账、查日程、记笔记（写操作都会先出确认卡）。'}
          </div>
        </div>
      </div>

      <div>
        <div className="set-label">外观</div>
        <div className="card">
          <div className="seg">
            <button className={theme === 'dark' ? 'on' : ''} onClick={() => setTheme('dark')}>深色</button>
            <button className={theme === 'light' ? 'on' : ''} onClick={() => setTheme('light')}>浅色</button>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>正式版提供「跟随桌面端主题」选项，主题配置随同步走。</div>
        </div>
      </div>

      <div className="ver">Phrontis Mobile 0.2.0 · M4a · 与桌面 3.15.1 配套</div>
    </section>
  )
}
