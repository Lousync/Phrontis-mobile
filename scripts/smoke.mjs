/* M0 冒烟测试：自起 vite preview，无头 Edge 遍历六 Tab + 核心交互，采集运行时错误。npm run smoke */
import { spawn } from 'child_process'
import { chromium } from 'playwright'

const PORT = 4173
const BASE = process.env.SMOKE_URL || `http://localhost:${PORT}`

/* 自起 preview（若端口已被占用则直接复用） */
let server
try {
  await fetch(BASE)
  console.log('[SMOKE] 复用已运行的 preview')
} catch {
  server = spawn('npx', ['vite', 'preview', '--port', String(PORT)], { stdio: 'ignore', shell: true })
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 250))
    try { await fetch(BASE); break } catch { /* 未起，继续等 */ }
  }
}
const errors = []
let failures = 0
const ok = (name, cond) => {
  console.log((cond ? '[PASS] ' : '[FAIL] ') + name)
  if (!cond) failures++
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
page.on('pageerror', e => errors.push('pageerror: ' + e.message))
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)

ok('应用挂载（#root 有内容）', await page.locator('#root .app').count() === 1)
ok('默认落在 AI Tab', await page.locator('#root .page.active .ai-head').count() === 1)
ok('AI 欢迎消息渲染', (await page.locator('#root .chat .msg').count()) >= 1)

const tabs = [['AI', '.ai-head'], ['日程', '.week-strip'], ['记账', '.month-head'], ['笔记', '.search-box'], ['用量', '.ubar-wrap'], ['设置', '.ver']]
for (const [label, probe] of tabs) {
  await page.locator('.tabbar button', { hasText: label }).click()
  await page.waitForTimeout(250)
  ok(`Tab「${label}」切换渲染（${probe}）`, (await page.locator('#root .page.active ' + probe).count()) >= 1)
}

/* 日程：切到排期视图（时间轴）与打卡视图；周条翻周 */
await page.locator('.tabbar button', { hasText: '日程' }).click()
await page.locator('.view-seg button', { hasText: '排期' }).click()
await page.waitForTimeout(200)
ok('日程排期视图（时间轴块）', (await page.locator('#root .gblock').count()) >= 3)
await page.locator('.view-seg button', { hasText: '打卡' }).click()
await page.waitForTimeout(200)
ok('日程打卡视图（习惯卡）', (await page.locator('#root .habit-card').count()) === 3)
const dn0 = await page.locator('#root .week-strip .wday .dn').first().innerText()
await page.locator('.week-strip .wk-arrow').last().click()
await page.waitForTimeout(200)
ok('周条翻到下周 + 回到今天按钮出现', (await page.locator('#root .week-strip .wday .dn').first().innerText()) !== dn0 && (await page.locator('#root .today-jump').count()) === 1)
await page.locator('#root .today-jump').click()
await page.waitForTimeout(150)
ok('回到今天（按钮消失）', (await page.locator('#root .today-jump').count()) === 0)

/* 记账：打开记一笔键盘，输入并保存一条（含两位小数） */
await page.locator('.tabbar button', { hasText: '记账' }).click()
await page.locator('#root .page.active .fab').click()
await page.waitForTimeout(350)
ok('记一笔抽屉（键盘）', (await page.locator('#root .keypad button').count()) === 12)
await page.locator('.keypad button', { hasText: /^3$/ }).click()
await page.locator('.keypad button', { hasText: /^8$/ }).click()
await page.locator('.keypad button').nth(9).click()
await page.locator('.keypad button', { hasText: /^5$/ }).click()
ok('金额两位小数（¥38.50）', (await page.locator('#root .sheet .amt-display .num').innerText()) === '38.50')
await page.locator('.sheet .btn-primary').click()
await page.waitForTimeout(300)
ok('记一笔落账（出现 ¥38.50）', (await page.locator('#root .tx-amt', { hasText: '¥38.50' }).count()) >= 1)
ok('待同步徽标出现', (await page.locator('#root .sync-pill .badge').count()) === 1)

/* 同步胶囊：未配对 → 引导去设置页配对（不再假装在线/离线切换） */
await page.locator('.sync-pill').click()
await page.waitForTimeout(250)
ok('未配对点胶囊跳设置页', (await page.locator('#root .page.active .set-label').count()) >= 1)

/* AI：会话抽屉 + 语音按钮状态机 */
await page.locator('.tabbar button', { hasText: 'AI' }).click()
await page.locator('#root .page.active .ai-head .icon-btn').click()
await page.waitForTimeout(350)
ok('会话抽屉（时间分组）', (await page.locator('#root .sess-group-head').count()) >= 4)
await page.locator('#root .sess-row').first().click({ position: { x: 10, y: 10 } })
await page.waitForTimeout(300)
ok('抽屉已关', (await page.locator('#root .sheet').count()) === 0)
await page.locator('.mic-btn').click()
await page.waitForTimeout(200)
ok('录音态（麦克风变红 + 波形条）', (await page.locator('#root .mic-btn.rec').count()) === 1 && (await page.locator('#root .voice-bars.on').count()) === 1)
await page.locator('.mic-btn').click()
await page.waitForTimeout(2800)
ok('转写自动发送（AI 回复出现）', (await page.locator('#root .chat .msg.ai').count()) >= 2)

/* 用量：切窗口 */
await page.locator('.tabbar button', { hasText: '用量' }).click()
await page.locator('#usageSeg button', { hasText: '近 30 天' }).click()
await page.waitForTimeout(200)
ok('用量近 30 天（30 根柱）', (await page.locator('#root .ubar').count()) === 30)

/* 设置：主题切换 */
await page.locator('.tabbar button', { hasText: '设置' }).click()
await page.locator('#root .page.active .seg button', { hasText: '浅色' }).click()
await page.waitForTimeout(200)
ok('浅色主题生效', (await page.locator('html[data-theme="light"]').count()) === 1)

ok('零运行时错误', errors.length === 0)
if (errors.length) console.log(errors.slice(0, 10).join('\n'))

await browser.close()
if (server) server.kill()
console.log(failures === 0 ? '[SMOKE] ALL PASS' : `[SMOKE] ${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
