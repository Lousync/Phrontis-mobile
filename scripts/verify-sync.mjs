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

import { parsePairInput, uuid, buildScheduleData, getLastSync } from '../src/lib/sync.ts'

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
}

console.log('\n' + (failures === 0 ? 'PASS (' + checks + ' checks)' : 'FAIL (' + failures + '/' + checks + ')'))
process.exit(failures === 0 ? 0 : 1)
