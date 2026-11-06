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

import { parsePairInput, uuid, buildScheduleData, buildNoteData, pruneNoteCache, getLastSync } from '../src/lib/sync.ts'
import { txToDisplay, monthOf, monthShift, monthStats, groupEntriesByDay, weekOf, TODAY } from '../src/lib/data.ts'
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
  check('游标结构含双域（Node 无 localStorage 走兜底 0）', eq(getLastSync(), { ledger: 0, schedule: 0 }))
}

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

console.log('\n§2d 笔记负载与缓存（v1.2：上行 + LRU 缓存）')
{
  check('notes 负载：标题去空白，正文原样', eq(buildNoteData('  标题  ', '想到什么记什么'), { title: '标题', body: '想到什么记什么' }))
  check('notes 负载：标题截 120', buildNoteData('x'.repeat(200), '').title.length === 120)
  check('notes 负载：正文截 10 万', buildNoteData('', 'y'.repeat(200000)).body.length === 100000)

  const mk = (id, bodyLen, at) => [id, { title: 't', body: 'x'.repeat(bodyLen), mtimeMs: 1, at }]
  const small = Object.fromEntries([mk('a', 10, 1), mk('b', 10, 2)])
  check('缓存未超限原样返回', Object.keys(pruneNoteCache(small, 1000)).length === 2)
  const big = Object.fromEntries([mk('old', 60, 1), mk('mid', 60, 2), mk('new', 60, 3)])
  const pruned = pruneNoteCache(big, 130)
  check('缓存超限按 at 最旧先逐出', pruned.old === undefined && !!pruned.mid && !!pruned.new)
  check('缓存逐出后不超限', Object.values(pruned).reduce((s, v) => s + v.title.length + v.body.length, 0) <= 130)
}

console.log('\n§2e AI 直连档工具集（M4a：读直执行 / 写出确认卡）')
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
  check('§2.1 v1.2 记录 notes 上行域与无条件应用', design.includes('v1.2 笔记') && design.includes('无条件应用'))
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

console.log('\n' + (failures === 0 ? 'PASS (' + checks + ' checks)' : 'FAIL (' + failures + '/' + checks + ')'))
process.exit(failures === 0 ? 0 : 1)
