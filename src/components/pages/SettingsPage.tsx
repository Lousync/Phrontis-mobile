import { useState } from 'react'
import { useApp } from '../../lib/store'
import { ICheck, IMonitor } from '../../components/icons'

/**
 * 设置页。同步区 = M1 真实配对（协议 docs/design.md §2.1）：
 * 未配对时输入电脑地址 + 配对码（桌面端 工具箱 → 手机伴侣 出示），配对后长期互信。
 * 原型阶段手机浏览器没有相机可用，扫码（APK 相机）随 M6 打包阶段接入。
 */
export function SettingsPage({ active }: { active: boolean }) {
  const { paired, online, syncing, syncPct, lastSync, runSync, pairWith, unpair, theme, setTheme, toast } = useApp()
  const [scope, setScope] = useState<Record<string, boolean>>({ 记账: true, 日程: true, 笔记: true, 'AI 会话记录': false })
  const [provider, setProvider] = useState('DeepSeek')
  const [model, setModel] = useState('deepseek-chat')
  const [pairInput, setPairInput] = useState('')
  const [pairCode, setPairCode] = useState('')
  const [pairing, setPairing] = useState(false)
  const [confirmUnpair, setConfirmUnpair] = useState(false)

  const scopeRows: Array<{ k: string; label: string; why?: string }> = [
    { k: '记账', label: '记账 · 双向按条目合并' },
    { k: '日程', label: '日程 · 双向按条目合并', why: 'M2 接入' },
    { k: '笔记', label: '笔记 · 缓存 + 手机笔记上行', why: 'M3 接入' },
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
                {paired.baseUrl.replace('http://', '')} · M1 同步范围：记账（日程 M2 / 笔记 M3 陆续接入）
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
            <select value={provider} onChange={e => setProvider(e.target.value)}
              style={{ width: '100%', background: 'var(--bg-tertiary)', border: '1px solid var(--border-soft)', borderRadius: 11, padding: '11px 13px', fontSize: 14, outline: 'none' }}>
              <option>DeepSeek</option><option>智谱 GLM</option><option>OpenAI 兼容</option><option>本地 Ollama</option>
            </select>
          </div>
          <div className="field"><label>API Key</label><input type="password" defaultValue="sk-demo-prototype" placeholder="sk-..." /></div>
          <div className="field"><label>模型</label><input value={model} onChange={e => setModel(e.target.value)} /></div>
          <button className="btn-primary" onClick={() => toast('模型配置已保存（本地）', 'ok')}>保存</button>
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

      <div className="ver">Phrontis Mobile 0.2.0 · M1 · 与桌面 3.15.1 配套</div>
    </section>
  )
}
