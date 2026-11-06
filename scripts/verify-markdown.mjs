/* mdRender 契约测试：AI 回答 / 笔记阅读器共用的 markdown 渲染器（src/lib/data.ts）。
   2026-11-06 起对齐桌面 react-markdown + remark-gfm 的常见子集，这里逐条锁住语法。

   为什么单独一个脚本而不是塞进冒烟：这些是纯字符串变换，用 node --experimental-strip-types
   直接跑真实源码最快；冒烟负责 UI 集成（.md 容器是否真的用了这个渲染器）。
   npm run verify:md */
import { mdRender } from '../src/lib/data.ts'

const cases = [
  ['粗体', '这是 **重点** 内容', /<strong>重点<\/strong>/],
  ['下划线粗体', '__重点__', /<strong>重点<\/strong>/],
  ['斜体', '嗯 *轻微强调* 吧', /<em>轻微强调<\/em>/],
  ['删除线', '~~删掉~~', /<del>删掉<\/del>/],
  ['行内代码不被当强调', '`**x**` 保持原样', /<code>\*\*x\*\*<\/code>/],
  ['无序列表', '- 甲\n- 乙', /<ul><li>甲<\/li><li>乙<\/li><\/ul>/],
  ['有序列表真编号', '1. 一\n2. 二', /<ol><li>一<\/li><li>二<\/li><\/ol>/],
  ['代码块带语言标签', '```js\nconst a = 1\n```', /<pre data-lang="js"><code>const a = 1<\/code><\/pre>/],
  ['代码块内容不被解析', '```\n**x**\n```', /<pre><code>\*\*x\*\*<\/code><\/pre>/],
  ['表格', '| 名 | 值 |\n|---|---|\n| a | 1 |',
    /<table><thead><tr><th>名<\/th><th>值<\/th><\/tr><\/thead><tbody><tr><td>a<\/td><td>1<\/td><\/tr><\/tbody><\/table>/],
  ['引用', '> 一句引用', /<blockquote>一句引用<\/blockquote>/],
  ['软换行合并成一段（与桌面 remark 一致）', '第一行\n第二行', /<p>第一行 第二行<\/p>/],
  ['空行分段', '段一\n\n段二', /<p>段一<\/p><p>段二<\/p>/],
  ['链接', '[文档](https://a.com)', /<a href="https:\/\/a.com"[^>]*>文档<\/a>/],
  ['危险链接降级为 #', '[x](javascript:alert(1))', /href="#"/],
  ['标题', '## 小节', /<h2>小节<\/h2>/],
  ['分隔线', 'a\n\n---\n\nb', /<hr>/],
  ['HTML 注入被转义', '<img onerror=1>', /&lt;img onerror=1&gt;/],
  ['乘法式不被当斜体', '3 * 4 * 5', /3 \* 4 \* 5/],
  ['空输入不炸', '', /^$/],
]

let fail = 0
for (const [name, src, re] of cases) {
  const out = mdRender(src)
  if (re.test(out)) {
    console.log('[PASS] ' + name)
  } else {
    fail++
    console.log('[FAIL] ' + name + '  →  ' + JSON.stringify(out))
  }
}
console.log(fail ? '\nFAILURES=' + fail : '\nALL PASS (' + cases.length + ' 项)')
process.exit(fail ? 1 : 0)
