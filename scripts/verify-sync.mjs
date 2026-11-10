#!/usr/bin/env node
/**
 * 契约验证：手机端同步引擎（M1 配对 / v1.1 双域 + 墓碑）。
 *
 * 覆盖两端各自持有一份、却必须行为一致的解析逻辑（parsePairInput 与桌面
 * protocol.ts 同源），schedule 负载构建（与桌面 TodoRow 映射口径一致），以及
 * 协议文档（docs/design.md §2.1）与手机实现的契约。
 * localStorage / fetch 相关路径浏览器专属，不在本脚本范围（由 smoke 覆盖 UI 面）。
 *
 * 运行（手机仓根目录）：
 *   node --experimental-strip-types --no-warnings scripts/verify-sync.mjs
 * 期望：末尾 PASS 且 exit=0
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parsePairInput, uuid, buildScheduleData, buildNoteData, buildHabitData, buildHabitRecordData, habitRecordId, parseHabitRecordId, parseSyncTime, habitLww, pruneNoteCache, getLastSync, noteLww, nextBackoffMs, nextProbeDelayMs, mergeScanPrefixes, COMMON_PREFIXES, AuthError, RtDriver, RT_WAIT_MS, RETRYABLE_PUSH_REASONS } from '../src/lib/sync.ts'
import { txToDisplay, monthOf, monthShift, monthStats, groupEntriesByDay, weekOf, TODAY, chipListWith, catColorOf } from '../src/lib/data.ts'
import { AI_TOOLS, validateLedgerAdd, validateTodoAdd, validateNoteCreate, buildSystemPrompt } from '../src/lib/aiTools.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

let failures = 0
let checks = 0
const ok = (m) => console.log('  [OK] ' + m)
const bad = (m) => { failures++; console.error('  [FAIL] ' + m) }
const check = (m, cond, detail) => { checks++; cond ? ok(m) : bad(detail ? m + ' —— ' + detail : m) }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

console.log('\n§1 配对输入解析（与桌面端 protocol.parsePairInput 同款语义）')

check('整条配对链接（含 #code）', eq(parsePairInput('http://192.168.1.5:8770/pair#12345678', ''), { host: '192.168.1.5:8770', code: '12345678' }))
check('host + 码分开填', eq(parsePairInput('192.168.1.5:8770', '87654321'), { host: '192.168.1.5:8770', code: '87654321' }))
check('https 头与路径可带', eq(parsePairInput('https://192.168.1.5:8770/', '87654321'), { host: '192.168.1.5:8770', code: '87654321' }))
check('链接里的 code 优先于输入框', eq(parsePairInput('192.168.1.5:8770#11111111', '22222222'), { host: '192.168.1.5:8770', code: '11111111' }))
check('前后空白容忍', eq(parsePairInput('  192.168.1.5:8770  ', ' 12345678 '), { host: '192.168.1.5:8770', code: '12345678' }))
check('无端口拒绝', parsePairInput('192.168.1.5', '12345678') === null)
check('码缺失拒绝', parsePairInput('192.168.1.5:8770', '') === null)
check('码非数字拒绝', parsePairInput('192.168.1.5:8770', 'abc123') === null)
check('空输入拒绝', parsePairInput('', '12345678') === null)

console.log('\n§2 UUID（http 非安全上下文下的 v4 兜底）')
{
  const a = uuid(), b = uuid()
  check('两次生成不同', a !== b)
  check('v4 形态', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(a))
}

console.log('\n§2b schedule 负载构建（与桌面 TodoRow 映射口径一致，协议 v1.1）')
{
  const t = { date: '2026-11-02', title: '写周报', type: 'deadline', time: '09:30', done: false, parentId: null, sched: { s: 570, e: 610 } }
  check('完整负载映射', eq(buildScheduleData(t), { date: '2026-11-02', title: '写周报', type: 'deadline', time: '09:30', done: false, parentId: null, schedStart: 570, schedEnd: 610 }))
  check('无排期 → schedStart/End null', buildScheduleData({ ...t, sched: undefined }).schedStart === null && buildScheduleData({ ...t, sched: undefined }).schedEnd === null)
  check('非 HH:MM 的 time 视为无', buildScheduleData({ ...t, time: '' }).time === '' && buildScheduleData({ ...t, time: '9:3' }).time === '')
  check('子任务行携带 parentId', buildScheduleData({ ...t, parentId: 'p-1' }).parentId === 'p-1')
  check('done 原样透传（翻转由调用方先改对象）', buildScheduleData({ ...t, done: true }).done === true)
  check('游标结构含四域（v1.8 起 habit 入列；Node 无 localStorage 走兜底 0）', eq(getLastSync(), { ledger: 0, schedule: 0, notes: 0, habit: 0 }))
}

console.log('\n§2b3 habit 负载与 LWW（v1.8 打卡同步）')
{
  const h = { name: '背单词', color: '#3B82F6', target: 9, remind: 480, archived: false }
  const d = buildHabitData(h)
  check('定义 target 夹取 1..7、remind 保留', d.kind === 'habit' && d.target === 7 && d.remind === 480)
  check('定义 remind 缺省 null', buildHabitData({ ...h, remind: undefined }).remind === null)
  const rid = habitRecordId('h1', '2026-11-09')
  check('记录 id = hr:habitId:date', rid === 'hr:h1:2026-11-09')
  check('记录 id 解析互逆', parseHabitRecordId(rid)?.habitId === 'h1' && parseHabitRecordId(rid)?.date === '2026-11-09')
  check('记录负载结构', eq(buildHabitRecordData('h1', '2026-11-09'), { kind: 'record', habitId: 'h1', date: '2026-11-09' }))
  check('habitLww 远端新 → remote', habitLww('2026-11-09T10:00:00.000Z', '2026-11-09T11:00:00.000Z') === 'remote')
  check('habitLww 本地新 → local', habitLww('2026-11-09T11:00:00.000Z', '2026-11-09T10:00:00.000Z') === 'local')
  check('habitLww 同刻 → remote（桌面赢）', habitLww('2026-11-09T11:00:00.000Z', '2026-11-09T11:00:00.000Z') === 'remote')
  check('parseSyncTime SQL(UTC) == ISO', parseSyncTime('2026-11-09 10:00:00') === parseSyncTime('2026-11-09T10:00:00.000Z'))
}

console.log('\n§2b2 全量对账与可重试 push 原因（2026-11-09 日程空仓修复）')
check('no-vault / apply-error / vaultMismatch 可重试（不出队）', ['no-vault', 'apply-error', 'vaultMismatch'].every(x => RETRYABLE_PUSH_REASONS.has(x)))
check('invalid-data / tombstoned 不重试（正常出队）', !RETRYABLE_PUSH_REASONS.has('invalid-data') && !RETRYABLE_PUSH_REASONS.has('tombstoned'))

console.log('\n§2c 账本派生与月视图（同步形态 → 展示/统计，M2b）')
{
  const e = (id, date, time, type, amount, category, payment, merchant, updatedAt) =>
    ({ id, updatedAt, data: { date, time, type, amount, category, payment, merchant, note: '' } })
  const a = e('a', '2026-11-02', '09:30', 'expense', 28, '餐饮', '微信', '午餐', '2026-11-02T01:30:00.000Z')
  const d = txToDisplay(a)
  check('展示派生：支出负号 + 名目/分类/账户', d.amt === -28 && d.name === '午餐' && d.cat === '餐饮' && d.acc === '微信')
  check('展示派生：merchant 缺省回落分类', txToDisplay(e('b', '2026-11-02', '10:00', 'expense', 5, '交通', '地铁', '', '2026-11-02T02:00:00.000Z')).name === '交通')
  check('收入显示为正数', txToDisplay(e('c', '2026-11-03', '10:00', 'income', 100, '工资', '银行卡', '工资', '2026-11-03T02:00:00.000Z')).amt === 100)
  check('月归属（异常日期不属任何月）', monthOf('2026-11-02') === '2026-11' && monthOf('垃圾') === '')
  check('月份平移跨年', monthShift('2026-01', -1) === '2025-12' && monthShift('2026-12', 1) === '2027-01' && monthShift('2026-06', 0) === '2026-06')
  const list = [
    a,
    e('c', '2026-11-01', '20:00', 'income', 800, '稿费', '银行卡', '稿费', '2026-11-01T12:00:00.000Z'),
    e('d2', '2026-10-31', '09:00', 'expense', 4, '交通', '现金', '地铁', '2026-10-31T01:00:00.000Z'),
  ]
  const st = monthStats(list, '2026-11')
  check('月统计：支出/收入/结余', st.expense === 28 && st.income === 800 && st.balance === 772)
  check('月统计：跨月条目不计入', monthStats(list, '2026-10').expense === 4 && monthStats(list, '2026-12').expense === 0)
  /* 2026-11-08 记账对齐：电脑拉回的分类/账户不在手机内置清单 → 保留原值（此前编辑保存被静默改写，数据破坏） */
  check('未知分类/账户保留为首位 chip', eq(chipListWith(['餐饮', '交通'], '居住'), ['居住', '餐饮', '交通']))
  check('已知值与空值不改清单', eq(chipListWith(['餐饮', '交通'], '交通'), ['餐饮', '交通']) && eq(chipListWith(['餐饮'], ''), ['餐饮']))
  /* 分类色与桌面同源：内置 seed 色 + 手机独有分类 = 桌面 colorForName 同 hash */
  check('分类色：内置 seed 与桌面 DEFAULT_CATEGORIES 一致', catColorOf('餐饮') === '#e8842c' && catColorOf('居住') === '#8a7f5c' && catColorOf('其他') === '#7a7a7a')
  check('分类色：手机独有 = 桌面自动建时的 hash 值', catColorOf('日用') === '#c9922e' && catColorOf('理财') === '#e8842c')
  check('分类色：未知名 hash 兜底（不再一律灰）', catColorOf('宠物') === '#9157d6')
  const g = groupEntriesByDay(list, '2026-11')
  check('按日分组：新日在前', g.length === 2 && g[0].date === '2026-11-02' && g[1].date === '2026-11-01')
  check('组内 updatedAt 倒序（后记的在上）', groupEntriesByDay([a, e('a2', '2026-11-02', '08:00', 'expense', 6, '交通', '现金', '早地铁', '2026-11-02T00:00:00.000Z')], '2026-11')[0].entries[0].id === 'a')
  check('分组排除其他月份', groupEntriesByDay(list, '2026-10').length === 1)
  check('空月返回空组', groupEntriesByDay(list, '2025-01').length === 0)
}

console.log('\n§2c-2 周导航（weekOf：日程页周条翻周的数据源）')
{
  const wk = weekOf(0)
  check('本周 7 天、周一起', wk.length === 7 && wk[0].wd === '一' && wk[6].wd === '日')
  const monday = new Date(wk[0].iso + 'T00:00:00')
  check('周一不晚于今天且在同一周内', monday <= new Date(TODAY + 'T00:00:00') && (new Date(TODAY + 'T00:00:00').getTime() - monday.getTime()) / 86400000 < 7)
  const gap = (new Date(weekOf(1)[0].iso + 'T00:00:00') - monday) / 86400000
  check('offset=1 恰好平移一周（跨月/跨年由 Date 进退位保证）', gap === 7)
  check('WEEK 常量 = weekOf(0)', weekOf(0)[0].iso === wk[0].iso && weekOf(0)[6].iso === wk[6].iso)
}

console.log('\n§2d 笔记负载与缓存（v1.2 上行 + LRU 缓存；v1.6 U 盘模式）')
{
  check('notes 负载：标题去空白，正文原样', eq(buildNoteData('  标题  ', '想到什么记什么'), { title: '标题', body: '想到什么记什么' }))
  check('notes 负载：标题截 120', buildNoteData('x'.repeat(200), '').title.length === 120)
  check('notes 负载：正文截 10 万', buildNoteData('', 'y'.repeat(200000)).body.length === 100000)

  // v1.6 笔记 U 盘模式：LWW 裁决纯函数（与桌面裁决语义同源：新者赢、同刻桌面赢、缺时间按旧）
  check('LWW：远端新 → remote', noteLww('2026-11-08T10:00:00.000Z', '2026-11-08T11:00:00.000Z') === 'remote')
  check('LWW：本地新 → local（自愈上行）', noteLww('2026-11-08T12:00:00.000Z', '2026-11-08T11:00:00.000Z') === 'local')
  check('LWW：同刻 → remote（桌面赢，收敛）', noteLww('2026-11-08T10:00:00.000Z', '2026-11-08T10:00:00.000Z') === 'remote')
  check('LWW：本地缺时间 → remote', noteLww(undefined, '2026-11-08T10:00:00.000Z') === 'remote')
  check('LWW：远端缺时间 → local（pull 版让位）', noteLww('2026-11-08T10:00:00.000Z', '') === 'local')

  const mk = (id, bodyLen, at) => [id, { title: 't', body: 'x'.repeat(bodyLen), mtimeMs: 1, at }]
  const small = Object.fromEntries([mk('a', 10, 1), mk('b', 10, 2)])
  check('缓存未超限原样返回', Object.keys(pruneNoteCache(small, 1000)).length === 2)
  const big = Object.fromEntries([mk('old', 60, 1), mk('mid', 60, 2), mk('new', 60, 3)])
  const pruned = pruneNoteCache(big, 130)
  check('缓存超限按 at 最旧先逐出', pruned.old === undefined && !!pruned.mid && !!pruned.new)
  check('缓存逐出后不超限', Object.values(pruned).reduce((s, v) => s + v.title.length + v.body.length, 0) <= 130)
}

console.log('\n§2d-2 v1.7 实时同步（挂起循环时机机：退避 / waitSupported 探测 / supersede 判废）')
{
  check('退避序列 1/2/5/10/30 封顶', eq([1, 2, 3, 4, 5, 6].map(nextBackoffMs), [1000, 2000, 5000, 10000, 30000, 30000]))

  const tick = () => new Promise(r => setTimeout(r, 0))
  const empty = { remoteLedger: [], remoteSchedule: [], remoteNotes: [], removedIds: [] }
  /* 假件 sleep 记毫秒即时返回（测「下一发何时发」不看真实等待）；
     pullOnce 内部过一次宏任务：循环每一拍可被 tick 逐步推进，断言确定 */
  const mkDriver = (script, rec) => {
    const d = new RtDriver({
      pullOnce: async o => {
        rec.pulls.push(o.waitMs)
        await new Promise(r => setTimeout(r, 0))
        const s = script.shift()
        if (!s) throw new Error('script exhausted')
        return { ...empty, ...s }
      },
      apply: out => rec.applied.push(out),
      sleep: async ms => { rec.sleeps.push(ms); await new Promise(r => setTimeout(r, 0)) },
    })
    rec.modes = []
    d.onMode = m => rec.modes.push(m)
    return d
  }
  const fail = { fail: true }
  const pullOnceScript = script => async o => {
    const s = script.shift()
    if (!s || s.fail) throw new Error('scripted failure')
    return { ...empty, ...s }
  }

  /* 挂起循环：waitSupported → 应用后立即挂下一发（中间无任何轮询睡眠） */
  {
    const rec = { pulls: [], sleeps: [], applied: [], modes: [] }
    const script = [{ waitSupported: true }, { waitSupported: true }]
    const d = new RtDriver({
      pullOnce: async o => { rec.pulls.push(o.waitMs); await tick(); return pullOnceScript(script)(o) },
      apply: out => rec.applied.push(out),
      sleep: async ms => { rec.sleeps.push(ms); await tick() },
    })
    d.onMode = m => rec.modes.push(m)
    d.start()
    await tick(); await tick()
    d.stop()
    await tick()
    check('挂起 pull 携带 wait=' + RT_WAIT_MS, rec.pulls.slice(0, 2).every(w => w === RT_WAIT_MS))
    check('挂起模式应用后立即挂下一发（无轮询睡眠）', rec.applied.length === 2 && rec.sleeps.length === 0)
    check('模式进入 hang（实时）', rec.modes[0] === 'hang')
  }

  /* 旧桌面探测：首个 wait 响应无 waitSupported → 切 30s 轮询，代内不再探测 */
  {
    const rec = { pulls: [], sleeps: [], applied: [], modes: [] }
    const script = [{ waitSupported: false }]
    const d = new RtDriver({
      pullOnce: async o => { rec.pulls.push(o.waitMs); await tick(); return pullOnceScript(script)(o) },
      apply: out => rec.applied.push(out),
      sleep: async ms => { rec.sleeps.push(ms); await tick() },
    })
    d.onMode = m => rec.modes.push(m)
    d.start()
    await tick(); await tick(); await tick()
    d.stop()
    await tick()
    check('首个请求仍探测（wait=' + RT_WAIT_MS + '）', rec.pulls[0] === RT_WAIT_MS)
    check('无 waitSupported → 切 30s 轮询并标旧桌面', rec.sleeps[0] === 30000 && rec.modes.includes('poll'))
    check('轮询代内不再探测（后续请求 wait=0）', rec.pulls[1] === 0)
  }

  /* 失败退避 1s/2s/…；重试仍带 wait（探测位），成功后回 hang */
  {
    const rec = { pulls: [], sleeps: [], applied: [], modes: [] }
    const script = [{ fail: true }, { fail: true }, { waitSupported: true }, { waitSupported: true }, { waitSupported: true }]
    const d = new RtDriver({
      pullOnce: async o => { rec.pulls.push(o.waitMs); await tick(); return pullOnceScript(script)(o) },
      apply: out => rec.applied.push(out),
      sleep: async ms => { rec.sleeps.push(ms); await tick() },
    })
    d.onMode = m => rec.modes.push(m)
    d.start()
    await tick(); await tick(); await tick(); await tick(); await tick()
    d.stop()
    await tick()
    check('退避序列生效（1s → 2s）', eq(rec.sleeps.slice(0, 2), [1000, 2000]))
    check('退避重试仍带 wait', rec.pulls.slice(0, 3).every(w => w === RT_WAIT_MS))
    check('成功后回 hang 且已应用', rec.applied.length === 1 && rec.modes.includes('hang'))
  }

  /* supersede：stop() 换代顶掉在途——迟到响应判废（不应用）；重建恰发一发、运行中 maybeStart 不重启 */
  {
    const rec = { pulls: [], sleeps: [], applied: [] }
    let resolveLate = () => {}
    const d = new RtDriver({
      pullOnce: o => new Promise(r => { rec.pulls.push(o.waitMs); resolveLate = () => r({ ...empty, waitSupported: true }) }),
      apply: out => rec.applied.push(out),
      sleep: async ms => { rec.sleeps.push(ms) },
    })
    d.start()
    await tick()
    d.stop()
    resolveLate()
    await tick()
    check('在途响应迟到判废：不应用、无退避', rec.applied.length === 0 && rec.sleeps.length === 0 && d.mode === 'off')
    d.maybeStart()
    await tick()
    check('stop 后重建恰发新一发（对账与循环不并发重复 pull）', rec.pulls.length === 2)
    d.maybeStart()
    check('运行中 maybeStart 不重启（不打断在途挂起）', rec.pulls.length === 2)
    d.stop()
    await tick()
  }
}
{
  /* 2026-11-06 平板线补齐学习域 5 工具（quiz_query/stats/add/note/del，专项契约见 scripts/contract-quiz-ai.mjs）：7 → 12 */
  check('工具集 12 个（7 基础 + 5 错题）', AI_TOOLS.length === 12)
  check('工具名唯一', new Set(AI_TOOLS.map(t => t.function.name)).size === AI_TOOLS.length)
  const maxLen = Math.max(...AI_TOOLS.map(t => JSON.stringify(t).length))
  check('单个工具 schema ≤ 600 字符（实际最大 ' + maxLen + '；quiz_add 带题型/来源字段超原 400 上限）', maxLen <= 600)
  check('写工具 3 个齐备', ['ledger_add', 'todo_add', 'note_create'].every(n => AI_TOOLS.some(t => t.function.name === n)))
  check('读工具 4 个齐备', ['now_time', 'ledger_query', 'todo_query', 'notes_list'].every(n => AI_TOOLS.some(t => t.function.name === n)))

  check('记账提案：合法', typeof validateLedgerAdd({ type: 'expense', amount: 30.5, category: '餐饮', account: '微信', merchant: '午饭' }) === 'object')
  check('记账提案：金额<=0 拒绝', typeof validateLedgerAdd({ type: 'expense', amount: 0 }) === 'string')
  check('记账提案：坏 type 拒绝', typeof validateLedgerAdd({ type: 'transfer', amount: 5 }) === 'string')
  check('记账提案：缺省回落（其他/微信/名目=分类）', (() => {
    const p = validateLedgerAdd({ type: 'income', amount: 3 })
    return typeof p !== 'string' && p.category === '其他' && p.account === '微信' && p.merchant === '其他'
  })())

  check('待办提案：缺省今天 + plan', (() => {
    const p = validateTodoAdd({ title: '周报' }, '2026-11-01')
    return typeof p !== 'string' && p.date === '2026-11-01' && p.type === 'plan'
  })())
  check('待办提案：空标题拒绝', typeof validateTodoAdd({ title: '  ' }, '2026-11-01') === 'string')
  check('待办提案：坏日期拒绝', typeof validateTodoAdd({ title: 'x', date: '11-01' }, '2026-11-01') === 'string')

  check('笔记提案：仅正文可过', typeof validateNoteCreate({ title: '', body: '想法' }) === 'object')
  check('笔记提案：全空拒绝', typeof validateNoteCreate({ title: '', body: '  ' }) === 'string')

  const sp = buildSystemPrompt('2026-11-01', 'TEST-PC')
  check('系统提示含真实日期与写入纪律', sp.includes('2026-11-01') && sp.includes('不要说「已经记好了」'))
  check('系统提示区分未配对', buildSystemPrompt('2026-11-01', null).includes('尚未配对'))
}

/* ---- §2f 连接监督器与发现策略（2026-11-08 热点修复轮：WP2/WP3/WP4/WP6 防回归） ---- */
console.log('\n§2f 连接监督器与发现策略（热点修复轮）')
{
  /* mergeScanPrefixes：自知网段优先 → 记忆段 → 经验清单；去重/非法过滤/CGNAT 跳过 */
  check('mergeScanPrefixes：selfPrefixes 排最前', eq(mergeScanPrefixes({ selfPrefixes: ['192.168.43', '10.116.216'], remembered: '10.0.0', common: ['192.168.1'] }), ['192.168.43', '10.116.216', '10.0.0', '192.168.1']))
  check('mergeScanPrefixes：去重', eq(mergeScanPrefixes({ selfPrefixes: ['192.168.1'], common: ['192.168.1', '192.168.0'] }), ['192.168.1', '192.168.0']))
  check('mergeScanPrefixes：非法段过滤（格式/越界）', eq(mergeScanPrefixes({ selfPrefixes: ['abc', '192.168.999', '1.2.3.4', null, undefined], remembered: '', common: ['10.0.0'] }), ['10.0.0']))
  check('mergeScanPrefixes：CGNAT（蜂窝 100.64/10）整段跳过', eq(mergeScanPrefixes({ selfPrefixes: ['100.72.16', '192.168.43'] }), ['192.168.43']))
  check('mergeScanPrefixes：空 self 回落 remembered+common', eq(mergeScanPrefixes({ remembered: '10.116.216', common: ['192.168.1'] }), ['10.116.216', '192.168.1']))
  check('经验清单含热点系网段（Android 43 / Windows ICS 137 / Linux 10.42.0）', COMMON_PREFIXES.includes('192.168.43') && COMMON_PREFIXES.includes('192.168.137') && COMMON_PREFIXES.includes('10.42.0'))

  /* 连接监督器退避序列 */
  check('nextProbeDelayMs：1s/2s/5s/10s，n≥5 恒 15s 封顶', nextProbeDelayMs(1) === 1000 && nextProbeDelayMs(2) === 2000 && nextProbeDelayMs(3) === 5000 && nextProbeDelayMs(4) === 10000 && nextProbeDelayMs(9) === 15000)

  /* 401 分诊：AuthError 与离线是两回事 */
  const ae = new AuthError()
  check('AuthError：是 Error 且 status=401', ae instanceof Error && ae.status === 401)

  /* WP2 静态断言：原生插件注册顺序 + 自知网段 + 按接口组播（原生难直测，以静态 + 真机验收为准） */
  const { readFileSync: rf } = await import('node:fs')
  const { dirname: dn, join: jn } = await import('node:path')
  const here = dn(fileURLToPath(import.meta.url))
  let main = ''
  try { main = rf(jn(here, '../android/app/src/main/java/com/lousync/phrontis/MainActivity.java'), 'utf-8') } catch { /* 下面报 */ }
  const regIdx = main.indexOf('registerPlugin(PhrontisDiscover.class)')
  const superIdx = main.indexOf('super.onCreate(savedInstanceState)')
  check('MainActivity：registerPlugin 在 super.onCreate 之前（0.8.0-0.8.5 插件从未注册的根因，防回归）',
    regIdx >= 0 && superIdx >= 0 && regIdx < superIdx)
  let java = ''
  try { java = rf(jn(here, '../android/app/src/main/java/com/lousync/phrontis/PhrontisDiscover.java'), 'utf-8') } catch { /* 下面报 */ }
  check('PhrontisDiscover：返回 selfPrefixes 多网段（热点 AP 段）', java.includes('selfPrefixes'))
  check('PhrontisDiscover：组播按接口发（setNetworkInterface）', java.includes('setNetworkInterface'))
  check('PhrontisDiscover：蜂窝接口过滤（rmnet/ccmni 不进扫描清单）', java.includes('isCellular') && java.includes('rmnet') && java.includes('ccmni'))
  check('PhrontisDiscover：双组交错（224 主组 + 239 过渡）', java.includes('"224.0.0.167"') && java.includes('"239.255.42.42"'))

  /* WP6.3 游标提交时机：pullOnce 不再自行落盘（迟到响应判废不再漏数据） */
  let syncSrc = ''
  try { syncSrc = rf(jn(here, '../src/lib/sync.ts'), 'utf-8') } catch { /* 下面报 */ }
  const pullStart = syncSrc.indexOf('export async function pullOnce')
  const pullEnd = syncSrc.indexOf('export type RtMode', pullStart)
  check('pullOnce：函数体内不再调用 setLastSync（游标提交收口到 commitPullCursor）',
    pullStart >= 0 && pullEnd > pullStart && !syncSrc.slice(pullStart, pullEnd).includes('setLastSync('))
  check('commitPullCursor 存在且导出', syncSrc.includes('export function commitPullCursor'))
}

console.log('\n§3 协议文档契约（docs/design.md §2.1 与手机实现一致）')
{
  const design = readFileSync(join(HERE, '..', 'docs', 'design.md'), 'utf-8')
  check('§2.1 记录 /api/pair', design.includes('/api/pair'))
  check('§2.1 记录 /api/sync/push 与 /api/sync/pull', design.includes('/api/sync/push') && design.includes('/api/sync/pull'))
  check('§2.1 记录默认端口 8770', design.includes('8770'))
  check('§2.1 冻结标注存在', design.includes('2026-10-31 冻结'))
  // v1.1 契约
  check('§2.1 v1.1 域范围含 schedule', design.includes('`ledger` + `schedule`（日程）'))
  check('§2.1 记录 schedule 负载字段', design.includes('schedStart') && design.includes('parentId'))
  check('§2.1 记录墓碑上行负载 { deleted: true }', design.includes('{ deleted: true }'))
  check('§2.1 记录游标只在 pull 后推进（v1.1 修正）', design.includes('只在 pull 完成后推进'))
  check('§2.1 记录墓碑下行 tombstones', design.includes('tombstones'))
  // v1.2 契约
  check('§2.1 v1.2 记录 notes 上行域（v1.6 已标注取代）', design.includes('v1.2 笔记') && design.includes('v1.6 笔记 U 盘模式'))
  // v1.6 契约（2026-11-08 笔记 U 盘模式）
  check('§2.1 v1.6 记录设备文件夹布局', design.includes('移动端/<设备名>') && design.includes('deviceName'))
  check('§2.1 v1.6 记录 frontmatter 锚点（id + updated + tags 手机）', design.includes('id: <手机笔记 uuid>') && design.includes('updated: <ISO>') && design.includes('tags: [手机]'))
  check('§2.1 v1.6 记录 pull 下行 notes 域与墓碑', design.includes("changes.notes") && design.includes("domain: 'notes'"))
  check('§2.1 v1.6 记录在线可见性 + 离线数据保留', design.includes('仅在该设备在线时') && design.includes('磁盘上文件永久保留'))
  check('§2.1 v1.6 记录旧桌面兼容口径', design.includes('旧桌面（v1.5-）不回 notes 域'))
  // v1.7 契约（2026-11-08 实时同步 · C 长轮询；与主仓方案 §2.4 兼容矩阵逐条对齐）
  check('§2.1 v1.7 记录协议增量（wait + waitSupported 探测位）', design.includes('`waitSupported?: true`') && design.includes('`wait` = 挂起上限毫秒'))
  check('§2.1 v1.7 挂起硬契约（信号粗粒度 + 25s 封顶）', design.includes('通知不是数据') && design.includes('`min(wait, 25000)`'))
  check('§2.1 v1.7 兼容矩阵：新手机 + 旧桌面退回 30s 轮询', design.includes('新手机 + 旧桌面 → 首个 `wait` 请求立即返回且无 `waitSupported` → 手机退回 30s 定时轮询'))
  check('§2.1 v1.7 兼容矩阵：旧手机 + 新桌面完全同 v1.6', design.includes('旧手机 + 新桌面 → 手机不发 `wait` → 立即返回，完全同 v1.6 行为'))
  check('§2.1 v1.7 兼容矩阵：双方离线退避重试', design.includes('任意一方离线 → 手机退避重试，不影响本地记录'))
  check('§2.1 v1.7 前后台硬要求（退后台暂停 / 回前台拉平重建）', design.includes('退后台（`visibilitychange`') && design.includes('立即对账一次（不带 wait）'))
  check('§2.1 v1.7 状态三态文案', design.includes('「实时」') && design.includes('「轮询 30s（电脑版本较旧）」') && design.includes('「离线待同步」'))
  check('§2.1 v1.8 记录 habit 域（定义 + 每日记录）', design.includes('v1.8 打卡域') && design.includes('hr:<habitId>:<YYYY-MM-DD>'))
  check('§2.1 v1.8 LWW/墓碑口径', design.includes('取消打卡 = 记录墓碑') && design.includes('删除习惯 = 习惯墓碑 + 级联记录墓碑'))
  check('§2.1 v1.8 兼容矩阵：旧桌面 unsupported-domain', design.includes('habit push 回 `unsupported-domain`'))
  check('§2.1 记录内容 API 端点', design.includes('/api/notes/tree') && design.includes('/api/notes/content'))
  check('§2.1 记录缓存上限与按 id 解析路径', design.includes('1.5MB') && design.includes('按 id 服务端解析路径'))
  // v1.3 契约（2026-11-06 电脑档整体移除，改为反向断言；决策记录里仍会提到该端点，故只查端点表行）
  check('§2.1 端点表已移除 AI 中继端点（电脑档下线）', !design.includes('| `POST /api/ai/chat`'))
  const syncSrc = readFileSync(join(HERE, '..', 'src', 'lib', 'sync.ts'), 'utf-8')
  const typesSrc = readFileSync(join(HERE, '..', 'src', 'lib', 'types.ts'), 'utf-8')
  check('电脑档代码已拔净（pcChat / AiMode / 会话映射）',
    !syncSrc.includes('export async function pcChat')
    && !syncSrc.includes('pm.aiPcSessions')
    && !typesSrc.includes('AiMode'))
}

console.log('\n§2.3 文件通道 v1（iPad 交接 / 批注回传，2026-11-10）')
{
  const design = readFileSync(join(HERE, '..', 'docs', 'design.md'), 'utf-8')
  const handoff = readFileSync(join(HERE, '..', 'docs', 'handoff-files-ipad-desktop.md'), 'utf-8')
  const filesSrc = readFileSync(join(HERE, '..', 'src', 'lib', 'fileHandoff.ts'), 'utf-8')
  const typesSrc = readFileSync(join(HERE, '..', 'src', 'lib', 'types.ts'), 'utf-8')
  check('§2.3 已冻结（只做 PDF / 只另存副本）', design.includes('### 2.3 文件通道 v1') && design.includes('entryKind === \'file\'') && design.includes('只另存副本'))
  check('§2.3 三端点 + name query 入协议', design.includes('/api/files/tree') && design.includes('/api/files/content?id=') && design.includes('/api/files/upload?name='))
  check('§2.3 ping 能力位 features', design.includes("features: ['files']"))
  check('统一落盘目录 iPad 批注/', design.includes('iPad 批注/') && handoff.includes('iPad 批注/'))
  check('手机端文件桥已落码（下载 / 分享 / 上传）', filesSrc.includes('downloadVaultFile') && filesSrc.includes('shareLocalFile') && filesSrc.includes('uploadReturnPdf'))
  check('回传状态类型存在', typesSrc.includes('interface FileReturnItem') && typesSrc.includes('interface VaultFile'))
  check('桌面施工图记录 name query 优先', handoff.includes('?name=') && handoff.includes('query `name`'))
}

console.log('\n' + (failures === 0 ? 'PASS (' + checks + ' checks)' : 'FAIL (' + failures + '/' + checks + ')'))
process.exit(failures === 0 ? 0 : 1)
