# Phrontis-mobile 长期项目记忆

## 平板版布局铁律（2026-11-06 用户拍板，永久有效）

- **恒定两栏**：[侧栏 | 内容区]，**永远不做三栏布局**（用户明确讨厌）。
- 侧栏可收纳：展开 232px ⇄ rail 64px 纯图标（`tb.sideCollapsed` localStorage）；左上角**不放软件品牌名**。
- 笔记阅读在内容区内切换（列表 ⇄ 覆盖层阅读器 + 返回键），不是并排分栏。
- 参考 iPad 备忘录的排版气质；平板核心定位是**阅读器**（看文档 + 做题），阅读优先于其他页签。

## 平板开发线（worktree）

- 平板版在 `E:\Projects\Phrontis-tablet`（分支 `feat/tablet`），主树 `Phrontis-mobile`（main）留给手机线，两线并行；push 一律等用户指令（与主仓同规）。
- worktree 的 node_modules 是指向主仓的 junction；其 vite.config.ts（端口 5180 / fs.allow / 独立 cacheDir）有意未提交。
- 里程碑 T0 自适应壳 ✅ → T1 阅读器（目录/字号）✅ → 收纳改版 ✅ → 待定：PDF(T1.5) / AI 分栏 / T2 做题闭环。

## 实现坑（平板线）

- **WebKit ≠ Chromium（真机才炸的头号坑）**：`.app.tablet .page > *` 这类「限宽+align-self」规则，WebKit（iPad Safari）会应用到**绝对定位子元素**上（Chromium 按规范忽略）——阅读器 `.reader`（inset:0 覆盖层）曾被压成内容高的浮块垂直居中，真机上中间布局「割裂」。修法：覆盖层类直接子元素（.reader/.add-bar/.fab）必须显式 `width:auto; max-width:none; align-self:auto` 翻回（c85efe4）。**平板线新增绝对定位子元素时必查这条**。
- `.app.tablet .page > *` 限宽规则会误伤直接子元素里的悬浮控件（FAB 曾被拉成通栏条）——新增贴底/绝对定位控件要加排除。
- vite dev 显式 fs.allow 会覆盖默认白名单，worktree 根自身也要放行。
- 真机数据要配对电脑；截图验证用 playwright + 系统 Edge（channel msedge），种子数据走 localStorage（`pm.notes` / `pm.companion`）。**Chromium 模拟通过 ≠ iPad 真机通过**，样式改动必须真机复核。
