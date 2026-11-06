/**
 * 手机直连档 LLM 客户端（M4a，口径见 docs/design.md §3 直连档落地口径）。
 *
 * OpenAI 兼容 chat.completions（预设 8 家：DeepSeek / 通义千问 / 豆包·火山方舟 / Kimi /
 * 智谱 GLM / opencode 网关 / 本地 Ollama / 自定义；2026-11-01 对齐桌面 llmPresets）。
 * 刻意**非流式**：SSE + tool_calls 增量合并的复杂度换不来手机捕获场景的收益，
 * 网络层稳健优先；最终回复由 store 的打字机呈现，观感不牺牲。
 * 工具循环上限 AI_MAX_ROUNDS 轮；写工具不落库（提案 → 确认卡 → 用户确认才写入）。
 */
import type { AiChatMsg, AiConfig, AiProvider, AiToolCall, AiToolDef } from './types'
import { AiStopped, loadJson, saveJson } from './sync'

export const AI_MAX_ROUNDS = 5

const K_AI_CONFIG = 'pm.aiConfig'

/**
 * 供应商预设（对齐桌面 src/lib/llmPresets.ts，2026-11-01）。
 * 预设不只是省打字——地址 / 协议 / 必需请求头 / 模型录入指路都是「用户不可能知道的东西」，
 * 表单里要**明着列出**（SettingsPage 的「预设替你填好的」区）。
 * 与桌面的差异：手机端只讲 OpenAI 兼容一种协议（Ollama 走其 /v1 兼容层），不做多协议与语义检索模型。
 */
export interface AiPreset {
  id: AiProvider
  name: string
  /** 卡片副标题（品牌归属之类） */
  sub: string
  base: string
  /** 卡片上的品牌色圆点 */
  color: string
  /** Ollama 本地服务：免 Key；模型清单走 /api/tags */
  local?: boolean
  /** 这家没有可下拉的模型清单：模型那一栏要填接入点 ID（ep-…） */
  modelInput?: 'endpoint'
  /** 预设替你带上的请求头；opencode 的会话 ID 由 chatOnce 按当前会话覆盖 */
  header?: Record<string, string>
  /** 地址未能在线核实 —— 界面上要显式写出来（老实标注，不假装核过） */
  unverified?: boolean
  /** 说明取自官方文档，值得展示出处 */
  srcConfig?: boolean
  /** 模型那一栏怎么填的指路（modelInput==='endpoint' 时必填） */
  modelHint?: string
  /** 兜底默认模型（拉取清单失败时的手填框预填值） */
  defaultModel: string
}

export const AI_PRESETS: AiPreset[] = [
  { id: 'deepseek', name: 'DeepSeek', sub: '官方 API', base: 'https://api.deepseek.com/v1', color: '#4d6bfe', defaultModel: 'deepseek-chat' },
  { id: 'qwen', name: '通义千问', sub: '阿里云 DashScope', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', color: '#615ced', defaultModel: 'qwen-plus' },
  {
    id: 'doubao', name: '豆包 · 火山方舟', sub: '字节跳动', base: 'https://ark.cn-beijing.volces.com/api/v3',
    color: '#1664ff', modelInput: 'endpoint', unverified: true,
    modelHint: '该平台没有可下拉的模型清单，「模型」一栏需填写接入点 ID（以 ep- 开头）：请在火山方舟控制台 →「在线推理」中复制接入点 ID。较新的接入点也接受模型名。',
    defaultModel: '',
  },
  { id: 'kimi', name: 'Kimi', sub: '月之暗面', base: 'https://api.moonshot.cn/v1', color: '#0b0b0b', defaultModel: 'kimi-k2-0905-preview' },
  { id: 'glm', name: '智谱 GLM', sub: 'bigmodel.cn', base: 'https://open.bigmodel.cn/api/paas/v4', color: '#3859ff', defaultModel: 'glm-4.6' },
  {
    id: 'opencode', name: 'opencode', sub: 'opencode.ai 网关', base: 'https://opencode.ai/inference/go/v1', color: '#9a9a9a',
    // 官方要求「每个对话一个稳定的会话 ID，用于优化路由与 prompt 缓存」。
    // 这里只是**声明**这个头存在；真实值由 chatOnce 按当前会话 ID 覆盖，无会话上下文时兜底。
    header: { 'x-opencode-session': 'phrontis-mobile' },
    srcConfig: true,
    modelHint: '该端点同时提供三种协议（chat / messages / responses），协议属于模型自身的属性；手机端按当前所选模型自动匹配。',
    defaultModel: 'qwen3-coder',
  },
  // 手机端保持 /v1 兼容层（chat.completions 与模型清单同源）；/api/tags 走 stripV1 后的原生地址
  { id: 'ollama', name: 'Ollama 本地', sub: '本机运行，无需 API Key', base: 'http://127.0.0.1:11434/v1', color: '#8a8a8a', local: true, defaultModel: 'qwen3:8b' },
  { id: 'custom', name: '自定义 / 网关', sub: '任意兼容端点', base: '', color: '#6a6a6a', defaultModel: '' },
]

export function presetOf(id: AiProvider): AiPreset {
  return AI_PRESETS.find(p => p.id === id) ?? AI_PRESETS[AI_PRESETS.length - 1]
}

/** 地址核实状态徽章用：桌面口径「按官方文档取自端点表」 */
export const PRESET_SRC_BADGE = '按官方文档'

export const DEFAULT_AI_CONFIG: AiConfig = { provider: 'deepseek', baseUrl: '', apiKey: '', model: 'deepseek-chat' }

/** 自定义请求头消毒：只留合法的 string:string，量与长度封顶（对齐桌面 sanitizeVars 的精神） */
function sanitizeHeaders(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[a-zA-Z0-9-]{1,64}$/.test(k)) continue
    if (typeof v !== 'string' || !v.length || v.length > 300) continue
    out[k] = v
    if (Object.keys(out).length >= 8) break
  }
  return out
}

export function loadAiConfig(): AiConfig {
  const raw = loadJson<Partial<AiConfig>>(K_AI_CONFIG, {})
  const provider: AiProvider = raw.provider && AI_PRESETS.some(p => p.id === raw.provider) ? raw.provider : 'deepseek'
  return {
    provider,
    baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : '',
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
    model: typeof raw.model === 'string' ? raw.model : presetOf(provider).defaultModel,
    headers: sanitizeHeaders(raw.headers),
  }
}

export function saveAiConfig(cfg: AiConfig): void {
  saveJson(K_AI_CONFIG, cfg)
}

/** 配置是否可用（model 必填；custom 还须 baseUrl；云提供商还须 Key —— Ollama 本地服务除外） */
export function aiConfigReady(cfg: AiConfig | null): boolean {
  if (!cfg || !cfg.model.trim()) return false
  if (cfg.provider === 'custom') return !!cfg.baseUrl.trim()
  if (presetOf(cfg.provider).local) return true
  return !!cfg.apiKey.trim()
}

export function baseOf(cfg: AiConfig): string {
  return (cfg.baseUrl.trim() || presetOf(cfg.provider).base).replace(/\/+$/, '')
}

export function endpointOf(cfg: AiConfig): string {
  return baseOf(cfg) + '/chat/completions'
}

/** 请求头合成：预设自带（opencode 会话头按会话覆盖）→ 用户自定义最后落（用户显式选择优先） */
export function headersFor(cfg: AiConfig, sessionId?: string): Record<string, string> {
  const out: Record<string, string> = {}
  const preset = presetOf(cfg.provider)
  if (preset.header) {
    for (const [k, v] of Object.entries(preset.header)) {
      out[k] = k === 'x-opencode-session' ? (sessionId?.trim() || v) : v
    }
  }
  if (cfg.headers) Object.assign(out, cfg.headers)
  return out
}

/** 模型清单端点：OpenAI 兼容走 GET {base}/models；Ollama 走原生 /api/tags（剥掉 /v1） */
export function modelsUrlOf(cfg: AiConfig): string {
  const base = baseOf(cfg)
  return cfg.provider === 'ollama' ? base.replace(/\/v1$/, '') + '/api/tags' : base + '/models'
}

export interface AiReply {
  content: string
  /** 思考痕迹（仅推理模型返回）：DeepSeek / 硅基流动用 reasoning_content，OpenRouter 系用 reasoning */
  reasoning?: string
  toolCalls: AiToolCall[]
}

/** 单轮 chat.completions（非流式）。失败抛 Error（文案可直接 toast）；external 中止抛 AiStopped */
export async function chatOnce(
  cfg: AiConfig,
  messages: AiChatMsg[],
  tools: AiToolDef[],
  timeoutMs = 60_000,
  external?: AbortSignal,
  sessionId?: string,
): Promise<AiReply> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const onAbort = () => ctrl.abort()
  external?.addEventListener('abort', onAbort)
  try {
    const res = await fetch(endpointOf(cfg), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...headersFor(cfg, sessionId),
        ...(cfg.apiKey.trim() ? { authorization: 'Bearer ' + cfg.apiKey.trim() } : {}),
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        ...(tools.length ? { tools } : {}),
        temperature: 0.6,
      }),
      signal: ctrl.signal,
    })
    const json = await res.json().catch(() => ({})) as {
      choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown; reasoning_content?: unknown; reasoning?: unknown } }>
      error?: { message?: string }
    }
    if (!res.ok) {
      throw new Error(json?.error?.message || '模型请求失败（' + res.status + '）')
    }
    const msg = json?.choices?.[0]?.message
    if (!msg) throw new Error('模型返回格式异常')
    /* 思考痕迹：不同网关字段名不同（DeepSeek/Qwen/硅基流动 = reasoning_content，
       OpenRouter 系 = reasoning）。两者都取不到就是普通模型，不显示折叠区。 */
    const rawReason = typeof msg.reasoning_content === 'string' ? msg.reasoning_content
      : typeof msg.reasoning === 'string' ? msg.reasoning : ''
    return {
      content: typeof msg.content === 'string' ? msg.content : '',
      reasoning: rawReason.trim() ? rawReason.trim() : undefined,
      toolCalls: Array.isArray(msg.tool_calls) ? (msg.tool_calls as AiToolCall[]) : [],
    }
  } catch (e) {
    if (external?.aborted) throw new AiStopped()
    if (e instanceof DOMException && e.name === 'AbortError') throw new Error('模型请求超时，稍后再试')
    if (e instanceof TypeError) {
      /* 原生 HTTP 桥是否就绪，直接决定这类失败的处置方向：
       *   桥在   → 请求确实发出去了但没回来（地址 / DNS / 明文 http 被系统拦 / 证书）；
       *   桥不在 → 走的是 WebView 普通请求，跨域就被拦掉（安卓上几乎必然失败）。
       * CapacitorHttpAndroidInterface 是 Capacitor 原生注入的 JS 接口，存在即代表补丁可用。 */
      const bridged = typeof (window as unknown as Record<string, unknown>).CapacitorHttpAndroidInterface !== 'undefined'
      throw new Error(bridged
        ? '请求发不出去：原生桥已就绪，检查地址是否可达；若填的是 http:// 地址，安卓默认禁止明文传输'
        : '连不上模型服务：原生 HTTP 桥未启用（当前走 WebView 请求，会被跨域拦截）——请装带 CapacitorHttp 配置的 APK')
    }
    throw e instanceof Error ? e : new Error('模型请求失败')
  } finally {
    clearTimeout(timer)
    external?.removeEventListener('abort', onAbort)
  }
}

/**
 * 拉取端点模型清单（GET /models / Ollama /api/tags），与桌面 llmService 同一手法。
 * 失败抛 Error（文案可直接展示）；调用方失败时降级为手填输入框。
 */
export async function fetchModels(cfg: AiConfig, timeoutMs = 10_000): Promise<string[]> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(modelsUrlOf(cfg), {
      method: 'GET',
      headers: {
        ...headersFor(cfg),
        ...(cfg.apiKey.trim() && !presetOf(cfg.provider).local ? { authorization: 'Bearer ' + cfg.apiKey.trim() } : {}),
      },
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error('清单请求失败（' + res.status + '）')
    const json = await res.json().catch(() => null) as {
      data?: unknown
      models?: unknown
    } | null
    const rows: string[] = cfg.provider === 'ollama'
      ? (Array.isArray(json?.models) ? json.models : []).map((m) => {
          const id = (m as { name?: unknown })?.name
          return typeof id === 'string' ? id : ''
        })
      : (Array.isArray(json?.data) ? json.data : []).map((m) => {
          const id = (m as { id?: unknown })?.id
          return typeof id === 'string' ? id : ''
        })
    const list = [...new Set(rows.filter(Boolean))].sort((a, b) => a.localeCompare(b))
    if (!list.length) throw new Error('端点返回了空清单')
    return list
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new Error('拉取超时，稍后再试')
    if (e instanceof TypeError) throw new Error('连不上端点：检查地址与网络；浏览器调试时多为跨域拦截（APK 原生桥不受限）')
    throw e instanceof Error ? e : new Error('拉取失败')
  } finally {
    clearTimeout(timer)
  }
}

/** 工具参数解析：非法/空返回空对象（不炸循环） */
export function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || '{}')
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

/** 测试连接：最小请求，通了即认为配置可用 */
export async function testAiConfig(cfg: AiConfig): Promise<void> {
  const reply = await chatOnce(cfg, [{ role: 'user', content: 'ping' }], [], 10_000)
  if (!reply.content && !reply.toolCalls.length) throw new Error('服务通了但返回为空，确认模型名是否正确')
}
