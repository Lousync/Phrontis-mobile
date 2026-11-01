/**
 * 手机直连档 LLM 客户端（M4a，口径见 docs/design.md §3 直连档落地口径）。
 *
 * OpenAI 兼容 chat.completions（DeepSeek / 智谱 GLM / OpenAI 兼容自定义 / 本地 Ollama）。
 * 刻意**非流式**：SSE + tool_calls 增量合并的复杂度换不来手机捕获场景的收益，
 * 网络层稳健优先；最终回复由 store 的打字机呈现，观感不牺牲。
 * 工具循环上限 AI_MAX_ROUNDS 轮；写工具不落库（提案 → 确认卡 → 用户确认才写入）。
 */
import type { AiChatMsg, AiConfig, AiToolCall, AiToolDef } from './types'
import { loadJson, saveJson } from './sync'

export const AI_MAX_ROUNDS = 5

const K_AI_CONFIG = 'pm.aiConfig'

/** 提供商预设（baseUrl 空 = 用预设；custom 必填自己的地址） */
export const AI_PRESETS: Record<string, { baseUrl: string; model: string }> = {
  deepseek: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  glm: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.6' },
  custom: { baseUrl: '', model: '' },
  ollama: { baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3:8b' },
}

export const DEFAULT_AI_CONFIG: AiConfig = { provider: 'deepseek', baseUrl: '', apiKey: '', model: 'deepseek-chat' }

export function loadAiConfig(): AiConfig {
  const raw = loadJson<Partial<AiConfig>>(K_AI_CONFIG, {})
  const provider = raw.provider && raw.provider in AI_PRESETS ? raw.provider : 'deepseek'
  return {
    provider,
    baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : '',
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
    model: typeof raw.model === 'string' ? raw.model : AI_PRESETS[provider].model,
  }
}

export function saveAiConfig(cfg: AiConfig): void {
  saveJson(K_AI_CONFIG, cfg)
}

/** 配置是否可用（model 必填；custom 还须 baseUrl；云提供商还须 Key —— Ollama 本地服务除外） */
export function aiConfigReady(cfg: AiConfig | null): boolean {
  if (!cfg || !cfg.model.trim()) return false
  if (cfg.provider === 'custom') return !!cfg.baseUrl.trim()
  if (cfg.provider === 'ollama') return true
  return !!cfg.apiKey.trim()
}

export function endpointOf(cfg: AiConfig): string {
  const base = (cfg.baseUrl.trim() || AI_PRESETS[cfg.provider]?.baseUrl || '').replace(/\/+$/, '')
  return base + '/chat/completions'
}

export interface AiReply {
  content: string
  toolCalls: AiToolCall[]
}

/** 单轮 chat.completions（非流式）。失败抛 Error（文案可直接 toast） */
export async function chatOnce(
  cfg: AiConfig,
  messages: AiChatMsg[],
  tools: AiToolDef[],
  timeoutMs = 60_000,
): Promise<AiReply> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(endpointOf(cfg), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
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
      choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown } }>
      error?: { message?: string }
    }
    if (!res.ok) {
      throw new Error(json?.error?.message || '模型请求失败（' + res.status + '）')
    }
    const msg = json?.choices?.[0]?.message
    if (!msg) throw new Error('模型返回格式异常')
    return {
      content: typeof msg.content === 'string' ? msg.content : '',
      toolCalls: Array.isArray(msg.tool_calls) ? (msg.tool_calls as AiToolCall[]) : [],
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new Error('模型请求超时，稍后再试')
    if (e instanceof TypeError) throw new Error('连不上模型服务：检查地址与网络（本地 Ollama 需允许跨域）')
    throw e instanceof Error ? e : new Error('模型请求失败')
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
