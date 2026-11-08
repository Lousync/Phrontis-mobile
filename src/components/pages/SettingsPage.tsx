import { useEffect, useRef, useState } from 'react'
import { Switch, SwitchContent, SwitchControl, SwitchThumb } from '@heroui/react'
import { Clipboard } from '@capacitor/clipboard'
import type { AiConfig, AiProvider, ThemeName } from '../../lib/types'
import { AI_MAX_ROUNDS, AI_PRESETS, aiConfigReady, fetchModels, parseMaxRounds, presetOf, recOf, testAiConfig, type AiPreset } from '../../lib/ai'
import { discoverCompanions, getDeviceName, pollPair, requestPair, type DiscoveredPc } from '../../lib/sync'
import { useApp, type SettingsSec } from '../../lib/store'
import { useFormFactor } from '../../lib/useFormFactor'
import { UsagePanel } from './UsagePage'
import { IBars, IBell, ICheck, IChevL, IChevR, IClip, IKeyboard, IMonitor, IRefresh, ISparkle, IX, IEye } from '../../components/icons'
import { PageHead } from '../../components/chrome'
import { ModelPicker } from '../../components/ModelPicker'
import { FullPage } from '../FullPage'

/* API Key 输入的安全键盘问题（2026-11-08 用户反馈）：type=password 会唤起国产输入法的「安全键盘」，
 * 粘贴被禁——Key 手敲不现实。支持 -webkit-text-security 的内核（Android WebView / 桌面 Chromium）
 * 改走 text + .mask 视觉打码：键盘恢复普通态，长按粘贴照常；不支持的内核（iOS WKWebView）
 * 保持 type=password——iOS 密码框可长按粘贴，无安全键盘问题。 */
const MASK_OK = typeof CSS !== 'undefined' && !!CSS.supports?.('-webkit-text-security', 'disc')

type ToastFn = (msg: string, type?: 'ok' | 'warn' | 'info') => void

/** 一键粘贴 Key：统一走 @capacitor/clipboard——打包壳内是原生 ClipboardManager（可靠），
 * 纯网页环境自动落到其 web 实现（异步剪贴板 API，权限被拒时走兜底提示）。
 * 长按粘贴路径由 text+mask 方案保底（不再触发安全键盘）。 */
async function pasteKeyInto(set: (v: string) => void, toast: ToastFn) {
  try {
    /* 5s 上限：个别嵌入内核的剪贴板权限弹窗无人应答时 read 会永远 pending（IAB 实测），不能无声无息 */
    const { value } = await Promise.race([
      Clipboard.read(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('clipboard-timeout')), 5000)),
    ])
    if (!value.trim()) { toast('剪贴板是空的', 'info'); return }
    set(value.trim())
    toast('Key 已粘贴', 'ok')
  } catch {
    toast('读不到剪贴板——长按输入框选「粘贴」', 'info')
  }
}

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
  const { paired, online, syncing, syncPct, syncMode, lastSync, runSync, pairWith, adoptPaired, unpair, theme, setTheme, toast, aiConfig, setActiveTab, kbSim, toggleKbSim, openSheet, settingsSec } = useApp()
  const ff = useFormFactor()
  /* 平板：分类隔离——侧栏点哪个分类就只渲染那个分类的设置项，后续设置项增多互不干扰；
   * 手机：单页滚动全展示。分类清单 SETTINGS_SECS 与此处 data-sec 一一对应（加分类两处同步加） */
  const showSec = (id: SettingsSec) => ff !== 'tablet' || settingsSec === id
  const [pairInput, setPairInput] = useState('')
  const [pairCode, setPairCode] = useState('')
  const [pairing, setPairing] = useState(false)
  const [confirmUnpair, setConfirmUnpair] = useState(false)
  /* v1.5 发现 + 桌面确认式配对 */
  const [discovering, setDiscovering] = useState(false)
  const [found, setFound] = useState<DiscoveredPc[]>([])
  const [pairMsg, setPairMsg] = useState('')
  const [manualOpen, setManualOpen] = useState(false)
  const [themeOpen, setThemeOpen] = useState(false)
  const [pairReq, setPairReq] = useState<{ baseUrl: string; pcName: string; requestId: string; code: string } | null>(null)
  const pollRef = useRef<number | null>(null)

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  /* 已存配置的连接测试状态（摘要卡上；表单内测试在抽屉里另有一份） */
  const [testSt, setTestSt] = useState<null | { ok: boolean; ms?: number }>(null)
  const [testing, setTesting] = useState(false)
  /* 入口行展示的当前主题（色板固定取目标主题自己的色值，不随当前主题变） */
  const curTheme = THEME_PICKS.find(t => t.id === theme) ?? THEME_PICKS[0]

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
      const r = await requestPair(pc.baseUrl, getDeviceName())
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

      {showSec('sync') && (
      <div data-sec="sync">
        <div className="set-label">同步</div>
        <div className="ph-card">
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
                <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                  <button className="btn-primary" style={{ flex: 1 }} disabled={discovering || pairing} onClick={() => void doDiscover()}>
                    {discovering ? '搜索中…（约几秒）' : '搜索电脑'}
                  </button>
                  <button className="btn-ghost" style={{ height: 44, flex: 'none' }} onClick={e => openSheet('scan', e.currentTarget)}>
                    扫码配对
                  </button>
                </div>
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
              </>
            )
          ) : (
            <>
              <div className="device-card">
                <div className="device-ico"><IMonitor /></div>
                <div className="info">
                  <div className="n">{paired.pcName}</div>
                  <div className="s"><span className="gdot" /><span>
                    {/* v1.7 同步状态三态：实时（挂起中）/ 轮询 30s（旧桌面）/ 离线待同步 */}
                    {syncMode === 'hang' ? '已连接 · 实时'
                      : syncMode === 'poll' ? '已连接 · 轮询 30s（电脑版本较旧）'
                      : online ? '已连接' : '离线待同步'} · 上次同步 {lastSync}</span></div>
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
      )}

      {/* AI 用量：平板独立分类（内嵌 UsagePanel）；手机走工具二级页（UsagePage），不在此渲染 */}
      {ff === 'tablet' && settingsSec === 'usage' && (
      <div data-sec="usage">
        <UsagePanel />
      </div>
      )}

      {showSec('tools') && (
      <div data-sec="tools">
        <div className="set-label">工具</div>
        <div className="ph-card" style={{ padding: '2px 14px' }}>
          {/* 用量从底栏降级到这里的二级入口（M3 ≤5 规范）；平板已是独立分类，此行仅手机显示 */}
          {ff !== 'tablet' && (
          <button className="tool-row" onClick={e => setActiveTab('usage', e.currentTarget)}>
            <span className="tool-ico"><IBars /></span>
            <span className="tool-body">
              <span className="n">AI 用量</span>
              <span className="s">Token · 花费 · 按模型统计</span>
            </span>
            <IChevR size={14} />
          </button>
          )}
          <NotifPermRow />
        </div>
      </div>
      )}

      {showSec('ai') && (
      <div data-sec="ai">

        <div className="set-label">AI 模型（手机直连）</div>
        <div className="ph-card">
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
            <button className="btn-ghost" style={{ height: 44 }} onClick={e => openSheet('ai-config', e.currentTarget)}>{ready ? '编辑配置' : '去配置'}</button>
          </div>
        </div>
      </div>
      )}

      {showSec('appearance') && (
      <div data-sec="appearance">
        <div className="set-label">外观</div>
        <div className="ph-card">
          {/* 外观：一行式主题入口（2026-11-06 方案 A——七套平铺占两行半高度，收进抽屉；
             色板展示目标主题自己的颜色，不随当前主题变） */}
          <button className="theme-entry" onClick={() => setThemeOpen(v => !v)}>
            <span className="sw" style={{ background: curTheme.bg }}>
              <span className="dot" style={{ background: curTheme.dot }} />
              <i className="l1" style={{ background: curTheme.line }} />
              <i className="l2" style={{ background: curTheme.line }} />
            </span>
            <span className="body">
              <span className="n">{curTheme.name}</span>
              <span className="s">当前主题 · 点按更换</span>
            </span>
            <IChevR size={14} style={{ transform: themeOpen ? 'rotate(90deg)' : 'none', transition: 'transform .16s' }} />
          </button>
          {themeOpen && (
            <div className="theme-grid" style={{ marginTop: 12, marginBottom: 4 }}>
              {THEME_PICKS.map(t => (
                <button
                  key={t.id}
                  className={'theme-chip' + (theme === t.id ? ' on' : '')}
                  onClick={() => { setTheme(t.id); setThemeOpen(false) }}
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
          )}
        </div>
      </div>
      )}

      {showSec('about') && (
      <div data-sec="about">
        <div className="set-label">关于</div>
        {/* 桌面 letterbox 专用（触屏经 CSS 隐藏，.kb-sim-card 同口径）：验证键盘弹出时贴底控件上提 */}
        <div className="ph-card kb-sim-card">
          <div className="check-row kb-sim-row">
            <span>模拟输入法 <IKeyboard size={13} style={{ color: 'var(--text-muted)' }} /></span>
            <span className="why">桌面调试</span>
            <Switch isSelected={kbSim} onChange={toggleKbSim} aria-label="模拟输入法" size="sm">
              <SwitchContent>
                <SwitchControl>
                  <SwitchThumb />
                </SwitchControl>
              </SwitchContent>
            </Switch>
          </div>
        </div>
        <div className="ver">Phrontis Mobile {__APP_VERSION__}</div>
      </div>
      )}
    </section>
  )
}

/* =========================================================================
   工具卡行（2026-11-07 主题选择器内联化：外观卡点主题入口就地展开 7 色板，
   点 chip 即 setTheme 并收起，替代原「外观主题抽屉」——AGENTS.md 禁 bottom sheet）
   ========================================================================= */
/** 工具卡「提醒通知」状态行：真实接线 lib/notify.ts（浏览器 dev 恒为 unsupported；
 * v7 插件没有 openSettings，拒绝态只能引导用户去系统设置，不做假跳转） */
function NotifPermRow() {
  const { notifPerm, requestNotifPerm, toast } = useApp()
  const sub = notifPerm === 'granted' ? '已允许 · 日程到点提醒'
    : notifPerm === 'denied' ? '已被拒绝 · 点看如何重开'
    : notifPerm === 'prompt' ? '尚未申请 · 点按开启'
    : '浏览器调试无通知 · 真机生效'
  const onClick = async () => {
    if (notifPerm === 'prompt') {
      const r = await requestNotifPerm()
      toast(r === 'granted' ? '通知已允许，日程到点会提醒' : '通知被拒绝 · 可去系统设置重开', r === 'granted' ? 'ok' : 'warn')
    } else if (notifPerm === 'denied') {
      toast('去系统设置 → 应用 → Phrontis → 通知，允许后回来', 'info')
    } else if (notifPerm === 'granted') {
      toast('通知已允许 · 日程到点会提醒', 'ok')
    }
  }
  return (
    <button className="tool-row" onClick={() => void onClick()}>
      <span className="tool-ico"><IBell /></span>
      <span className="tool-body">
        <span className="n">提醒通知</span>
        <span className="s">{sub}</span>
      </span>
    </button>
  )
}

/* =========================================================================
   AI 配置抽屉（对齐桌面 AiModelsTab 的预设体系，2026-11-01 按 prototype/ai-config.html 落码；
   2026-11-06 按 prototype/session-config.html 改「极简编辑态」）

   两条路径：
   - **已配置 → 直接进编辑态**：供应商收成一行、主体只有 Key + 模型、预设详情进高级。
     首版是纯添加表单（恒从「选供应商」起步、不回填已存配置），后果是「想换个模型必须
     重走一遍选供应商，而保存会把 Key 一起弄丢」——这是本次要修的缺陷。
   - **未配置 → 两步添加流**：8 张预设卡 → 表单（预设替你填好的明着列出）。
   Key 留空 = 保留旧 Key（不回显原文）；换供应商则必须重填（不同端 Key 不通用）。
   ========================================================================= */
export function AiConfigSheet() {
  const { aiConfig, closeSheet } = useApp()
  const ready = aiConfigReady(aiConfig)
  const [step, setStep] = useState<'pick' | 'form' | 'edit'>(ready ? 'edit' : 'pick')
  const [formId, setFormId] = useState<AiProvider | null>(null)
  const p = formId ? presetOf(formId) : null
  return (
    <FullPage>
      <div className="fp-head">
        <button className="fp-back" onClick={() => (step === 'form' ? setStep('pick') : closeSheet())} aria-label="返回">
          <IChevL size={16} />
        </button>
        <span className="fp-title">
          {step === 'edit' ? '编辑 AI 配置' : step === 'pick' ? '选择供应商' : `添加「${p?.name}」`}
        </span>
        <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={closeSheet}><IX size={14} /></button>
      </div>
      <div className="fp-body">
      {step === 'edit' ? (
        <AiEditForm onSaved={closeSheet} />
      ) : step === 'pick' ? (
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
        </>
      ) : p && <AiPresetForm key={p.id} preset={p} onSaved={closeSheet} />}
      </div>
    </FullPage>
  )
}

/** 添加表单。状态全部本地草稿，保存才落 pm.aiConfig；key 换 preset 时由 key={p.id} 整体重挂 */
function AiPresetForm({ preset, onSaved }: { preset: AiPreset; onSaved: () => void }) {
  const { updateAiConfig, toast } = useApp()
  const rec = recOf(preset.id)
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [model, setModel] = useState(preset.defaultModel)
  const [base, setBase] = useState('')
  const [headText, setHeadText] = useState('')
  const [roundsText, setRoundsText] = useState('')
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
    return { cfg: { provider: preset.id, baseUrl: b, apiKey: apiKey.trim(), model: m, headers, maxRounds: parseMaxRounds(roundsText) } }
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
      <div className="field">
        <label>{preset.local ? 'API Key（本地可留空）' : 'API Key'}</label>
        <div className="key-wrap">
          <input
            /* 见 MASK_OK 注释：text + 视觉打码代替 password，避免安全键盘禁粘贴 */
            type={showKey || MASK_OK ? 'text' : 'password'}
            value={apiKey} disabled={preset.local}
            onChange={e => { setApiKey(e.target.value); setKeyErr(false) }}
            className={(keyErr ? 'err ' : '') + (!showKey && MASK_OK ? 'mask' : '')}
            placeholder={preset.local ? '本地模型无需 API Key' : 'sk-…（只存手机本地）'} />
          {!preset.local && (
            <button className="key-paste" title="粘贴 Key" onClick={() => void pasteKeyInto(setApiKey, toast)}><IClip size={16} /></button>
          )}
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
            {rec?.hint && <div className="model-cnt">{rec.hint}</div>}
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
            {rec?.hint && <div className="model-cnt">{rec.hint}</div>}
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
          <div className="field">
            <label>工具轮数上限（1–24）</label>
            <input className="mono" type="number" inputMode="numeric" min={1} max={24} value={roundsText}
              onChange={e => setRoundsText(e.target.value)} placeholder={String(AI_MAX_ROUNDS)} />
            <div className="model-cnt">单次回复最多连续执行几轮工具——越大越能跑长任务，也越费 token 与时间；留空用默认（{AI_MAX_ROUNDS}）。</div>
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

/**
 * 编辑态（已配置后的默认形态，design.md §0 2026-11-06 第 35 条）。
 *
 * 与添加表单的差别是**信息密度**：供应商收成一行（点开才出网格）、主体只留
 * Key 与模型两项、预设详情折进「高级」。两处必须守住的语义：
 * - Key **不回显**，留空即保留旧值（`aiConfig.apiKey` 兜底）；
 * - **换供应商必须重填 Key**——不同端的 Key 不通用，静默沿用会得到一个
 *   看似保存成功、实际每次请求都 401 的配置。
 */
function AiEditForm({ onSaved }: { onSaved: () => void }) {
  const { aiConfig, updateAiConfig, toast } = useApp()
  const [providerId, setProviderId] = useState<AiProvider>(aiConfig.provider)
  const preset = presetOf(providerId)
  const rec = recOf(providerId)
  const changed = providerId !== aiConfig.provider
  const [provOpen, setProvOpen] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [model, setModel] = useState(aiConfig.model || presetOf(aiConfig.provider).defaultModel)
  const [base, setBase] = useState(aiConfig.baseUrl)
  const [headText, setHeadText] = useState(
    aiConfig.headers && Object.keys(aiConfig.headers).length ? JSON.stringify(aiConfig.headers) : '',
  )
  /* 轮数上限是全局项（不随供应商走），换供应商时保留 */
  const [roundsText, setRoundsText] = useState(aiConfig.maxRounds ? String(aiConfig.maxRounds) : '')
  const [adv, setAdv] = useState(false)
  const [keyErr, setKeyErr] = useState(false)
  const [modelErr, setModelErr] = useState(false)
  const [picker, setPicker] = useState(false)
  const [testOut, setTestOut] = useState<{ kind: 'ok' | 'bad' | 'busy'; text: string } | null>(null)

  /* 草稿 → 配置；不合法返回错误文案与出错字段 */
  const build = (): { cfg?: AiConfig; err?: string; field?: 'key' | 'model' | 'base' } => {
    const key = preset.local ? '' : (apiKey.trim() || (changed ? '' : aiConfig.apiKey))
    if (!preset.local && !key) {
      return {
        err: changed ? `换到「${preset.name}」需要重填 Key（不同端 Key 不通用）。` : '还差一个 API Key。',
        field: 'key',
      }
    }
    const m = model.trim()
    if (!m) return { err: preset.modelInput === 'endpoint' ? '火山方舟需要接入点 ID（ep- 开头）。' : '模型不能为空。', field: 'model' }
    const b = base.trim()
    if (providerId === 'custom' && !b) return { err: '自定义端点需要接口地址（在高级里填）。', field: 'base' }
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
    return { cfg: { provider: providerId, baseUrl: b, apiKey: key, model: m, headers, maxRounds: parseMaxRounds(roundsText) } }
  }

  const flag = (field?: 'key' | 'model' | 'base') => {
    setKeyErr(field === 'key')
    setModelErr(field === 'model')
    if (field === 'base') setAdv(true)
  }

  const doSave = () => {
    const r = build()
    if (!r.cfg) { flag(r.field); setTestOut({ kind: 'bad', text: r.err! }); return }
    updateAiConfig(r.cfg)
    toast(preset.local ? `已保存 ${preset.name}` : `已保存 · Key ${r.cfg.apiKey && apiKey.trim() ? '已更新' : '沿用旧值'}`, 'ok')
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

  /* 换供应商：预填该预设默认模型，Key 清空（不同端 Key 不通用），地址/头回预设 */
  const pickProv = (id: AiProvider) => {
    const np = presetOf(id)
    setProviderId(id)
    setProvOpen(false)
    setApiKey('')
    setShowKey(false)
    setModel(np.defaultModel)
    setBase('')
    setHeadText('')
    setKeyErr(false)
    setModelErr(false)
    setTestOut(null)
    toast(np.local ? `已切换到 ${np.name}（本地服务免 Key）` : `已切换到 ${np.name}，请填新 Key`)
  }

  const keyPlaceholder = preset.local
    ? '本地模型无需 API Key'
    : aiConfig.apiKey && !changed
      ? '已保存（重输即覆盖，留空保留旧 Key）'
      : 'sk-…（只存手机本地）'

  return (
    <>
      {/* 供应商一行：点开才出 8 张卡（原型 §编辑态） */}
      <button className="prov-row" onClick={() => setProvOpen(v => !v)}>
        <span className="pdot" style={{ background: preset.color }} />
        <span className="pr-body">
          <span className="n">{preset.name}{changed && <em>待更换</em>}</span>
          <span className="s">{preset.sub} · 点按更换供应商</span>
        </span>
        <span className="chev" style={{ transform: provOpen ? 'rotate(90deg)' : 'none' }}><IChevR size={14} /></span>
      </button>
      {provOpen && (
        <div className="prov-grid" style={{ marginBottom: 14 }}>
          {AI_PRESETS.map(pr => (
            <button key={pr.id} className={'prov-card' + (pr.id === providerId ? ' on' : '')} onClick={() => pickProv(pr.id)}>
              <span className="pdot" style={{ background: pr.color }} />
              <span className="pv-info">
                <span className="pn">{pr.name}{pr.id === providerId && <em>当前</em>}</span>
                <span className="ps">{pr.sub}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="field">
        <label>{preset.local ? 'API Key（本地可留空）' : 'API Key'}</label>
        <div className="key-wrap">
          <input
            /* 见 MASK_OK 注释：text + 视觉打码代替 password，避免安全键盘禁粘贴 */
            type={showKey || MASK_OK ? 'text' : 'password'}
            value={apiKey} disabled={preset.local}
            onChange={e => { setApiKey(e.target.value); setKeyErr(false) }}
            className={(keyErr ? 'err ' : '') + (!showKey && MASK_OK ? 'mask' : '')}
            placeholder={keyPlaceholder} />
          {!preset.local && (
            <button className="key-paste" title="粘贴 Key" onClick={() => void pasteKeyInto(setApiKey, toast)}><IClip size={16} /></button>
          )}
          {!preset.local && (
            <button className="key-eye" onClick={() => setShowKey(s => !s)}><IEye size={16} /></button>
          )}
        </div>
        {changed && !preset.local && (
          <div className="model-cnt">换供应商后 Key 需重填；旧 Key 仍保留在本机，切回原供应商即恢复。</div>
        )}
      </div>

      <div className="field">
        <label>{preset.modelInput === 'endpoint' ? '接入点 ID' : '模型'}</label>
        {preset.modelInput === 'endpoint' ? (
          <>
            <input className={'mono' + (modelErr ? ' err' : '')} value={model} spellCheck={false}
              onChange={e => { setModel(e.target.value); setModelErr(false) }} placeholder="ep-2026…" />
            <div className="model-cnt">{preset.modelHint}</div>
            {rec?.hint && <div className="model-cnt">{rec.hint}</div>}
          </>
        ) : (
          <>
            <button className={'model-field' + (modelErr ? ' err' : '')} onClick={() => setPicker(true)}>
              <span className="pdot" style={{ background: preset.color }} />
              <span className="mf-body">
                <span className="lab">当前模型</span>
                <span className="val mono">{model || '未选模型'}</span>
              </span>
              <IChevR size={14} />
            </button>
            {rec?.hint && <div className="model-cnt">{rec.hint}</div>}
          </>
        )}
      </div>

      <button className={'adv-toggle' + (adv ? ' open' : '')} onClick={() => setAdv(v => !v)}>
        <IChevR size={12} />高级（地址覆盖 / 自定义请求头）
      </button>
      {adv && (
        <div className="adv-body">
          <div className="field" style={{ marginTop: 10 }}>
            <label>接口地址覆盖（可选）</label>
            <input className="mono" value={base} spellCheck={false} onChange={e => setBase(e.target.value)}
              placeholder={preset.base || 'https://your-host/v1'} />
          </div>
          <div className="field">
            <label>自定义请求头（JSON）</label>
            <input className="mono" value={headText} spellCheck={false} onChange={e => setHeadText(e.target.value)}
              placeholder='{"头名":"值"}' />
          </div>
          <div className="field">
            <label>工具轮数上限（1–24）</label>
            <input className="mono" type="number" inputMode="numeric" min={1} max={24} value={roundsText}
              onChange={e => setRoundsText(e.target.value)} placeholder={String(aiConfig.maxRounds ?? AI_MAX_ROUNDS)} />
            <div className="model-cnt">单次回复最多连续执行几轮工具——越大越能跑长任务，也越费 token 与时间；留空用默认（{AI_MAX_ROUNDS}）。</div>
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

      {/* 全屏模型选择页（portal 到 .app，盖住抽屉；不是底部上伸抽屉） */}
      {picker && (
        <ModelPicker
          provider={providerId}
          baseUrl={base.trim() || preset.base}
          apiKey={apiKey.trim() || (changed ? '' : aiConfig.apiKey)}
          current={model}
          defaultModel={preset.defaultModel}
          onPick={m => { setModel(m); setModelErr(false); setPicker(false) }}
          onClose={() => setPicker(false)}
        />
      )}
    </>
  )
}
