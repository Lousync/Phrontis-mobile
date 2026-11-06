/* mdRender 契约测试：AI 回答 / 笔记阅读器共用的 markdown 渲染器（src/lib/data.ts）。
   2026-11-06 平板线拍板换 marked(GFM)+DOMPurify（主线自研增强版的功能超集），契约随之适配：
   - 断言前做空白归一（marked 输出标准 GFM 格式，与自研版的紧凑格式语义等价）
   - 安全两项（危险链接 / HTML 注入）依赖 DOMPurify → 需要 window，Node 下跳过
     （浏览器运行时的消毒已由 playwright 断言覆盖：script 标签 0 残留 / onerror 不入 DOM）
   - 单换行即 <br>（breaks:true 平板拍板：中文笔记/AI 输出友好），不再对齐桌面 remark 软换行合并

   纯字符串变换用 node --experimental-strip-types 直接跑真实源码最快；npm run verify:md */
import { mdRender } from '../src/lib/data.ts'

const hasWindow = typeof window !== 'undefined'
const norm = s => s.replace(/\n+/g, '').replace(/>\s+</g, '><').trim()

const cases = [
  ['粗体', '这是 **重点** 内容', /<strong>重点<\/strong>/],
  ['下划线粗体', '__重点__', /<strong>重点<\/strong>/],
  ['斜体', '嗯 *轻微强调* 吧', /<em>轻微强调<\/em>/],
  ['删除线', '~~删掉~~', /<del>删掉<\/del>/],
  ['行内代码不被当强调', '`**x**` 保持原样', /<code>\*\*x\*\*<\/code>/],
  ['无序列表', '- 甲\n- 乙', /<ul><li>甲<\/li><li>乙<\/li><\/ul>/],
  ['有序列表真编号', '1. 一\n2. 二', /<ol><li>一<\/li><li>二<\/li><\/ol>/],
  ['代码块带语言标签', '```js\nconst a = 1\n```', /<pre><code class="language-js">const a = 1<\/code><\/pre>/],
  ['代码块内容不被解析', '```\n**x**\n```', /<pre><code>\*\*x\*\*<\/code><\/pre>/],
  ['表格', '| 名 | 值 |\n|---|---|\n| a | 1 |',
    /<table><thead><tr><th>名<\/th><th>值<\/th><\/tr><\/thead><tbody><tr><td>a<\/td><td>1<\/td><\/tr><\/tbody><\/table>/],
  ['引用', '> 一句引用', /<blockquote><p>一句引用<\/p><\/blockquote>/],
  ['单换行即换行（breaks:true，平板拍板）', '第一行\n第二行', /<p>第一行<br>第二行<\/p>/],
  ['空行分段', '段一\n\n段二', /<p>段一<\/p><p>段二<\/p>/],
  ['链接', '[文档](https://a.com)', /<a href="https:\/\/a.com"[^>]*>文档<\/a>/],
  /* DOMPurify 在浏览器运行时生效：危险链接降级 / XSS 消毒 */
  ['危险链接降级为 #（需 DOMPurify）', '[x](javascript:alert(1))', /href="#"/, true],
  ['标题', '## 小节', /<h2>小节<\/h2>/],
  ['分隔线', 'a\n\n---\n\nb', /<hr\s*\/?>/, ],
  ['HTML 注入被消毒（需 DOMPurify）', '<img onerror=1>', /&lt;img/, true],
  ['乘法式不被当斜体', '3 * 4 * 5', /3 \* 4 \* 5/],
  ['空输入不炸', '', /^$/],
]

let fail = 0
for (const [name, src, re, needsWindow] of cases) {
  if (needsWindow && !hasWindow) { console.log('[SKIP] ' + name + '（Node 无 DOM，浏览器运行时验证）'); continue }
  const out = norm(mdRender(src))
  if (re.test(out)) {
    console.log('[PASS] ' + name)
  } else {
    fail++
    console.log('[FAIL] ' + name + '  →  ' + JSON.stringify(out))
  }
}
console.log(fail ? '\nFAILURES=' + fail : '\nALL PASS (' + cases.length + ' 项)')
process.exit(fail ? 1 : 0)
