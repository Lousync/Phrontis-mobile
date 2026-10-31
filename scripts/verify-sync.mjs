#!/usr/bin/env node
/**
 * 契约验证：手机端同步引擎（M1）。
 *
 * 覆盖两端各自持有一份、却必须行为一致的解析逻辑（parsePairInput 与桌面
 * protocol.ts 同源），以及协议文档（docs/design.md §2.1）与手机实现的契约。
 * localStorage / fetch 相关路径浏览器专属，不在本脚本范围（由 smoke 覆盖 UI 面）。
 *
 * 运行（手机仓根目录）：
 *   node --experimental-strip-types --no-warnings scripts/verify-sync.mjs
 * 期望：末尾 PASS 且 exit=0
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parsePairInput, uuid } from '../src/lib/sync.ts'

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

console.log('\n§3 协议文档契约（docs/design.md §2.1 与手机实现一致）')
{
  const design = readFileSync(join(HERE, '..', 'docs', 'design.md'), 'utf-8')
  check('§2.1 记录 /api/pair', design.includes('/api/pair'))
  check('§2.1 记录 /api/sync/push 与 /api/sync/pull', design.includes('/api/sync/push') && design.includes('/api/sync/pull'))
  check('§2.1 记录默认端口 8770', design.includes('8770'))
  check('§2.1 冻结标注存在', design.includes('2026-10-31 冻结'))
}

console.log('\n' + (failures === 0 ? 'PASS (' + checks + ' checks)' : 'FAIL (' + failures + '/' + checks + ')'))
process.exit(failures === 0 ? 0 : 1)
