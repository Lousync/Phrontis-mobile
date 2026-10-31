import { useMemo, useState } from 'react'
import { drawQrGrid } from '../../lib/data'
import { useApp } from '../../lib/store'
import { ICheck, IMonitor } from '../../components/icons'
import { Grip, Sheet } from '../../components/Sheet'

function QrSheet() {
  const grid = useMemo(() => drawQrGrid(), [])
  return (
    <Sheet>
      <Grip />
      <h3>扫码配对</h3>
      <div className="qr-wrap">
        <div className="qr-grid">
          {grid.flatMap((row, r) => row.map((v, c) => (
            <div key={r + '-' + c} className="qr-cell" style={{ background: v ? '#1a1a1a' : 'transparent' }} />
          )))}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.7 }}>
          电脑端 <b style={{ color: 'var(--text-primary)' }}>设置 → 手机伴侣 → 配对新设备</b> 出示二维码<br />
          首次配对后两端互相记住，同网自动重连
        </div>
      </div>
    </Sheet>
  )
}

export function SettingsPage({ active }: { active: boolean }) {
  const { online, syncing, syncPct, lastSync, runSync, openSheet, theme, setTheme, toast } = useApp()
  const [scope, setScope] = useState<Record<string, boolean>>({ 记账: true, 日程: true, 笔记: true, 'AI 会话记录': false })
  const [provider, setProvider] = useState('DeepSeek')
  const [model, setModel] = useState('deepseek-chat')

  const scopeRows: Array<{ k: string; label: string; why?: string }> = [
    { k: '记账', label: '记账 · 双向按条目合并' },
    { k: '日程', label: '日程 · 双向按条目合并' },
    { k: '笔记', label: '笔记 · 缓存 + 手机笔记上行' },
    { k: 'AI 会话记录', label: 'AI 会话记录', why: '建议二期' },
  ]

  return (
    <section className={'page' + (active ? ' active' : '')}>
      <div className="ai-head"><span className="t">设置</span></div>

      <div>
        <div className="set-label">同步</div>
        <div className="card">
          <div className="device-card">
            <div className="device-ico"><IMonitor /></div>
            <div className="info">
              <div className="n">Phrontis-PC</div>
              <div className="s"><span className="gdot" /><span>{online ? '已连接' : '离线'} · 上次同步 {lastSync}</span></div>
            </div>
          </div>
          <div className={'sync-progress' + (syncing ? ' on' : '')}><span className="fill" style={{ width: syncPct + '%' }} /></div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button className="btn-primary" style={{ flex: 1 }} onClick={runSync}>立即同步</button>
            <button className="btn-ghost" style={{ height: 44 }} onClick={() => openSheet('qr')}>重新扫码</button>
          </div>
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

      <div className="ver">Phrontis Mobile 0.1.0 · M0 · 与桌面 3.15.1 配套</div>
    </section>
  )
}

export { QrSheet }
