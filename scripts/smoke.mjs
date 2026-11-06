/* M0 冒烟测试：自起 vite preview，无头 Edge 遍历 5 页签浮坞壳层 + 核心交互，采集运行时错误。npm run smoke */
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
ok('默认落在 AI 页（大标题页头）', (await page.locator('#root .page.active .pg-head .t').innerText()) === 'AI 助手')
ok('标题下元信息行（SyncMeta）渲染', (await page.locator('#root .page.active .pg-head .c-meta').count()) === 1)
ok('AI 欢迎消息渲染', (await page.locator('#root .chat .msg').count()) >= 1)
ok('浮坞 5 页签（用量已降级）', (await page.locator('#root .dock button').count()) === 5)

const tabs = [['AI', '.chat .msg'], ['日程', '.week-strip'], ['记账', '.stat-row'], ['笔记', '.search-box'], ['设置', '.ver']]
for (const [label, probe] of tabs) {
  await page.locator('#root .dock button', { hasText: label }).click()
  await page.waitForTimeout(250)
  ok(`页签「${label}」切换渲染（${probe}）`, (await page.locator('#root .page.active ' + probe).count()) >= 1)
}

/* 收拢顶栏与浮坞收缩：设置页内容足够长，JS 置 scrollTop 触发 scroll 事件 */
await page.locator('#root .dock button', { hasText: '设置' }).click()
await page.waitForTimeout(250)
await page.locator('#root .page.active').evaluate(el => { el.scrollTop = 300 })
await page.waitForTimeout(250)
ok('滚动 >46px：小顶栏淡入', (await page.locator('#root .c-bar.on').count()) === 1)
/* 2026-11-06 用户拍板：浮坞不再随滚动收缩（收缩后只剩一个胶囊、底部空一大片）。
   这里锁住反向契约——滚到底也必须 5 个页签全在、宽度正常。 */
ok('滚动下潜：浮坞不收缩（5 页签常驻）', await page.locator('#root .dock').evaluate(el => {
  if (el.classList.contains('min')) return false
  const bs = [...el.querySelectorAll('button')]
  return bs.length === 5 && bs.every(b => b.getBoundingClientRect().width > 20)
}))
await page.locator('#root .page.active').evaluate(el => { el.scrollTop = 0 })
await page.waitForTimeout(250)
ok('回顶：小顶栏复位', (await page.locator('#root .c-bar.on').count()) === 0)

/* 二级入口：设置 → 工具 → AI 用量 → 返回 */
await page.locator('#root .tool-row', { hasText: 'AI 用量' }).click()
await page.waitForTimeout(250)
ok('用量二级入口（24 根小时柱）', (await page.locator('#root .ubar').count()) === 24)
await page.locator('#usageSeg button', { hasText: '近 30 天' }).click()
await page.waitForTimeout(200)
ok('用量近 30 天（30 根柱）', (await page.locator('#root .ubar').count()) === 30)
await page.locator('#root .pg-back').click()
await page.waitForTimeout(250)
ok('用量返回设置页', (await page.locator('#root .page.active .tool-row').count()) === 1)

/* 日程：待办勾选组合拳 / 排期 / 打卡 / 周条翻周 */
await page.locator('#root .dock button', { hasText: '日程' }).click()
await page.waitForTimeout(250)
ok('日程大标题 + 进度环', (await page.locator('#root .page.active .todo-ring').count()) === 1)
/* 回归锁：类名曾用 .ring，与 Tailwind v4 的 ring 工具类（1px currentColor 描边）撞名长出黑框 */
ok('进度环无 ring 撞名描边框', await page.locator('#root .page.active .todo-ring').evaluate(el => getComputedStyle(el).boxShadow === 'none'))
const doneBefore = await page.locator('#root .todo-item.done').count()
await page.locator('#root .todo-item:not(.done) .todo-check').first().click()
await page.waitForTimeout(250)
ok('勾选完成反馈（done 态 + 对勾绘制类）', (await page.locator('#root .todo-item.done').count()) === doneBefore + 1)
await page.locator('.view-seg button', { hasText: '排期' }).click()
await page.waitForTimeout(300)
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

/* 记账：记一笔（FAB 圆形展开抽屉）→ 落账 → 未配对元信息行跳设置 */
await page.locator('#root .dock button', { hasText: '记账' }).click()
await page.waitForTimeout(250)
await page.locator('#root .page.active .fab').click()
await page.waitForTimeout(350)
ok('记一笔抽屉（键盘）', (await page.locator('#root .keypad button').count()) === 12)
/* 回归锁：圆形展开分支曾漏了「落位」，抽屉停在 bottom:-100% 的屏外，DOM 断言全绿但人看不见 */
ok('记一笔抽屉落在视口内', await page.locator('#root .sheet').evaluate(el => {
  const r = el.getBoundingClientRect()
  return r.top > 0 && r.top < window.innerHeight - 100
}))
await page.locator('.keypad button', { hasText: /^3$/ }).click()
await page.locator('.keypad button', { hasText: /^8$/ }).click()
await page.locator('.keypad button').nth(9).click()
await page.locator('.keypad button', { hasText: /^5$/ }).click()
ok('金额两位小数（¥38.50）', (await page.locator('#root .sheet .amt-display .num').innerText()) === '38.50')
await page.locator('.sheet .btn-primary').click()
await page.waitForTimeout(300)
ok('记一笔落账（出现 ¥38.50）', (await page.locator('#root .tx-amt', { hasText: '¥38.50' }).count()) >= 1)
await page.locator('#root .page.active .c-meta.unp').click()
await page.waitForTimeout(250)
ok('未配对点元信息行跳设置页', (await page.locator('#root .page.active .set-label').count()) >= 1)
ok('配对卡：搜索电脑入口在位（v1.5 发现优先）', (await page.locator('#root .page.active .btn-primary', { hasText: '搜索电脑' }).count()) === 1)
ok('配对卡：扫码配对入口在位', (await page.locator('#root .page.active .btn-ghost', { hasText: '扫码配对' }).count()) === 1)
await page.locator('#root .page.active .btn-ghost', { hasText: '扫码配对' }).click()
await page.waitForTimeout(700)
ok('扫码全屏打开（取景层铺满壳层）', (await page.locator('#root .scan-full').count()) === 1)
await page.locator('#root .scan-close').click()
await page.waitForTimeout(250)
await page.locator('#root .page.active .adv-toggle').click()
await page.waitForTimeout(200)
ok('手动配对展开（地址 + 配对码两个输入仍在）', (await page.locator('#root .page.active .field input').count()) === 2)
await page.locator('#root .page.active .adv-toggle').click()
await page.waitForTimeout(200)
ok('手动配对可收起', (await page.locator('#root .page.active .field input').count()) === 0)

/* AI：会话抽屉 + 语音按钮状态机 */
await page.locator('#root .dock button', { hasText: 'AI' }).click()
await page.locator('#root .page.active .pg-head .icon-btn').click()
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
/* 2026-11-06：落库后的 AI 消息此前直接 innerHTML 塞原文（**加粗** / 列表全是字面量）。
   现在与流式共用 mdRender 并套 .md 排版，这里锁住「确实走了渲染器」而不是裸文本 */
ok('AI 回复走 markdown 渲染器（.md 容器 + 段落）',
  (await page.locator('#root .chat .msg.ai .md').count()) >= 2
  && (await page.locator('#root .chat .msg.ai .md p').count()) >= 1)

/* 设置：外观主题（一行入口 → 抽屉里一点即换 → 选中即关 + 持久化） */
await page.locator('#root .dock button', { hasText: '设置' }).click()
await page.locator('#root .page.active .theme-entry').click()
await page.waitForTimeout(250)
ok('主题抽屉打开（7 套主题卡）', (await page.locator('#root .sheet .theme-chip').count()) === 7)
ok('主题抽屉落在视口内', await page.locator('#root .sheet').evaluate(el => {
  const r = el.getBoundingClientRect()
  return r.top > 0 && r.top < window.innerHeight - 100
}))
await page.locator('#root .sheet .theme-chip', { hasText: '嫩芽' }).click()
await page.waitForTimeout(250)
ok('春 · 嫩芽生效', (await page.locator('html[data-theme="spring"]').count()) === 1)
ok('选中即关抽屉', (await page.locator('#root .sheet').count()) === 0)
ok('入口行跟随当前主题', (await page.locator('#root .page.active .theme-entry .n').innerText()).includes('嫩芽'))
await page.locator('#root .page.active .theme-entry').click()
await page.waitForTimeout(250)
await page.locator('#root .sheet .theme-chip', { hasText: 'OpenCode' }).click()
await page.waitForTimeout(250)
ok('OpenCode 终端灰生效', (await page.locator('html[data-theme="opencode"]').count()) === 1)
await page.locator('#root .page.active .theme-entry').click()
await page.waitForTimeout(250)
await page.locator('#root .sheet .theme-chip', { hasText: '初雪' }).click()
await page.waitForTimeout(250)
ok('冬 · 初雪生效', (await page.locator('html[data-theme="winter"]').count()) === 1)
await page.locator('#root .page.active .theme-entry').click()
await page.waitForTimeout(250)
ok('主题选中数唯一（抽屉内勾选态在位）', (await page.locator('#root .sheet .theme-chip.on').count()) === 1
  && (await page.locator('#root .sheet .theme-chip.on .tick').count()) === 1)
await page.locator('#root .sheet .icon-btn').click()
await page.waitForTimeout(250)
ok('叉号可关抽屉', (await page.locator('#root .sheet').count()) === 0)
await page.reload()
await page.waitForTimeout(600)
ok('主题选择重启保留（pm.theme 落盘）', (await page.locator('html[data-theme="winter"]').count()) === 1)

/* 键盘适配（2026-11-06）：壳高度扣掉键盘占高，抽屉 / 浮坞 / FAB / toast 随之整体上移。
   两个来源取大者：--kb-native（APK 内由 MainActivity 读原生 IME inset 注入，主路径）与
   --kb-real（浏览器 / PWA 由 visualViewport 算出；Android WebView 里它对输入法无信号）。 */
const kbGeom = await page.evaluate(() => {
  const root = document.documentElement
  const app = document.querySelector('#root .app')
  const h = () => app.getBoundingClientRect().height
  const h0 = h()
  root.style.setProperty('--kb-real', '260px')
  const hReal = h()
  root.style.removeProperty('--kb-real')
  root.style.setProperty('--kb-native', '300px')
  const hNative = h()
  /* 两条通道同时有值：必须取大者，不能相加（否则双重扣、壳被压得过矮） */
  root.style.setProperty('--kb-real', '200px')
  const hBoth = h()
  root.style.removeProperty('--kb-native')
  root.style.removeProperty('--kb-real')
  return { h0, hReal, hNative, hBoth }
})
ok('visualViewport 通道驱动壳收缩', Math.abs(kbGeom.h0 - kbGeom.hReal - 260) <= 2)
ok('原生 IME 通道驱动壳收缩（APK 主路径）', Math.abs(kbGeom.h0 - kbGeom.hNative - 300) <= 2)
ok('两通道并存取大者（不双重扣）', Math.abs(kbGeom.h0 - kbGeom.hBoth - 300) <= 2)

/* 设置：AI 配置抽屉（预设卡 + 表单 + 保存摘要）——放在最后，保存的假 Key 不得影响前面的演示通路 */
await page.locator('#root .dock button', { hasText: '设置' }).click()
await page.waitForTimeout(300)
ok('AI 摘要卡（供应商 + 模型 + 未配置态）', (await page.locator('#root .page.active .device-card .pdot').count()) === 1
  && (await page.locator('#root .page.active .device-card:has(.pdot) .st').innerText()).includes('未配置'))
await page.locator('#root .page.active .btn-ghost', { hasText: '更换供应商' }).click()
await page.waitForTimeout(400)
ok('供应商选择网格（8 张预设卡）', (await page.locator('#root .sheet .prov-card').count()) === 8)
await page.locator('#root .sheet .prov-card', { hasText: 'opencode' }).click()
await page.waitForTimeout(300)
ok('opencode 表单列出预设自带的会话头 + 官方文档徽章', (await page.locator('#root .sheet .filled-box', { hasText: 'x-opencode-session' }).count()) === 1
  && (await page.locator('#root .sheet .badge-doc').count()) === 1)
ok('模型手填框预填默认模型', (await page.locator('#root .sheet .model-row input').inputValue()) === 'qwen3-coder')
/* 拉取清单走路由拦截（确定性，不碰外网）：先真实载荷 → 下拉；再空清单 → 优雅降级手填 */
let modelsBody = JSON.stringify({ data: [{ id: 'qwen3-coder' }, { id: 'claude-sonnet-4-5' }] })
await page.route('**/models', route => route.fulfill({ status: 200, contentType: 'application/json', body: modelsBody }))
await page.locator('#root .sheet .model-fetch').click()
await page.waitForTimeout(700)
ok('拉取清单出下拉（2 个模型）', (await page.locator('#root .sheet .model-row select').count()) === 1
  && (await page.locator('#root .sheet .model-row select option').count()) === 2)
modelsBody = JSON.stringify({ data: [] })
await page.locator('#root .sheet .model-fetch').click()
await page.waitForTimeout(700)
ok('空清单优雅降级手填', (await page.locator('#root .sheet .model-row input').count()) === 1
  && (await page.locator('#root .sheet .model-cnt').innerText()).includes('可直接手填'))
await page.locator('#root .sheet .aic-foot .btn-ghost').click()
await page.waitForTimeout(300)
ok('空 Key 测试被拦（错误卡）', (await page.locator('#root .sheet .test-out.bad').count()) === 1)
/* 回归锁：聚焦抽屉内的输入框后，抽屉不得再被「下沉」。
   旧实现把 bottom 写成负值让输入框贴键盘上沿；壳已随键盘上移的模型下，
   那等于把整块抽屉推出壳外（Android 15 上就是「输入框被键盘遮住」的真因）。 */
await page.locator('#root .sheet .key-wrap input').click()
await page.waitForTimeout(200)
ok('输入框聚焦后抽屉仍贴壳底（不下沉）', await page.locator('#root .sheet').evaluate(el => {
  const app = el.closest('.app')
  return !!app && Math.abs(el.getBoundingClientRect().bottom - app.getBoundingClientRect().bottom) < 2
}))
/* 键盘弹起时浮坞已隐藏，那 96px 的「给浮坞让位」留白必须收掉，否则输入栏离键盘一大截 */
ok('键盘弹起时页面底部留白收掉（输入栏贴键盘）',
  parseFloat(await page.locator('#root .page.active').evaluate(el => getComputedStyle(el).paddingBottom)) <= 12,
)
/* 状态栏占位：安卓由 MainActivity 注入 --safe-top（env() 在安卓恒为 0），页面顶部据此留白 */
const safeGeom = await page.evaluate(() => {
  const root = document.documentElement
  const page = document.querySelector('#root .page.active')
  const before = parseFloat(getComputedStyle(page).paddingTop)
  root.style.setProperty('--safe-top', '44px')
  const after = parseFloat(getComputedStyle(page).paddingTop)
  root.style.removeProperty('--safe-top')
  return { before, after }
})
ok('状态栏占位变量驱动页面顶部留白', Math.abs(safeGeom.after - safeGeom.before - 44) <= 1)
await page.locator('#root .sheet .key-wrap input').fill('sk-smoke-fake')
await page.locator('#root .sheet .aic-foot .btn-primary').click()
await page.waitForTimeout(500)
ok('保存后回摘要（opencode · 未测试）', (await page.locator('#root .sheet').count()) === 0
  && (await page.locator('#root .page.active .device-card:has(.pdot) .n').innerText()).includes('opencode'))
ok('摘要状态变「未测试」', (await page.locator('#root .page.active .device-card:has(.pdot) .st').innerText()).includes('未测试'))
/* 收尾：清掉假配置，恢复未配置默认（保持设备状态干净） */
await page.evaluate(() => localStorage.removeItem('pm.aiConfig'))

ok('零运行时错误', errors.length === 0)
if (errors.length) console.log(errors.slice(0, 10).join('\n'))

await browser.close()
if (server) server.kill()
console.log(failures === 0 ? '[SMOKE] ALL PASS' : `[SMOKE] ${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
