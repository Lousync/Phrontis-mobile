# Phrontis Mobile

工程规则的唯一维护处在主仓 `E:\Projects\KnowledgeRecorder\AGENTS.md`（在主仓开的会话每轮自动注入；本仓只放主仓管不到的差异化规则）。

硬规则：

- **push 永远等用户明确指令**：commit 可随改动本地进行，`git push` 一律等用户说推再推（与主仓同规，2026-10-31 拍板）。
- **不要「改一处就打一个 APK」**（2026-11-06 用户拍板）：日常改动用 `npm run dev` + 桌面 / 浏览器模拟验证即可，APK 攒到用户明确要求、或一批改动要真机验收时再打。
  - **例外**：动了原生层（`MainActivity.java` / `AndroidManifest.xml` / `capacitor.config.ts`）就必须重新打包才可能生效，这时要主动说明「这次必须装新包」，但仍不要顺手多打几个。
  - 打包命令统一走 `npm run android:apk`（内部先 `vite build` 再 `scripts/sync-android.mjs`，别用 `cap sync`，见下条）。
- **改配置后必须走 `scripts/sync-android.mjs`**：`android/app/src/main/assets/capacitor.config.json` 是 git 忽略的生成物，`cap sync` 在本机被 safe-delete 垫片挡住时会漏更新它 —— 曾导致 `CapacitorHttp` 从未启用、真机 AI 直连全部失败（电脑端正常，极具迷惑性）。
- 同步协议 v1 冻结在 `docs/design.md` §2.1，改协议先改文档再动代码，两仓契约脚本都要过（`scripts/verify-sync.mjs` + 主仓 `.AGENT/scripts/phone-companion/verify-companion-protocol.mjs`）。

## UI 规范（2026-11-06 用户拍板，硬规则）

- **⛔ 禁止底部抽屉（bottom sheet）**：不做任何「从屏幕底部滑出 / 从触发点圆形铺开」的浮层。用户明确不喜欢这种形态（扫码那版已因此改成全屏），**新功能一律不要用**。
- **替代形态按场景选**：
  - 需要独立任务 → **全屏子页**：整页进入 + 左上返回（参照 `ScanOverlay` 的全屏取景、用量页的二级入口）
  - 轻量确认 / 单选 / 少量输入 → **页内内联展开**：行内展开、卡片内切换，不弹层
  - 系统级提示、阻塞性状态 → **全屏 overlay**（覆盖壳层，仍然不是从底部弹出）
- 动效同源约束：入场用整页切换（全局已有页面圆形扩散），不要用「自下而上位移」。
- **⛔ 手机端只有竖屏，横屏是平板端的事**：手机锁竖屏由 `MainActivity.applyOrientationPolicy()` 按 `sw600dp` 运行时判定（<600dp 锁 PORTRAIT，≥600dp 交给系统）。**不要在 AndroidManifest 里写 `android:screenOrientation`** —— 那是静态值，会把平板一起锁死。前端也不得为「手机横屏」做任何布局分支。
- ~~`src/components/Sheet.tsx` 历史遗留~~ **已清偿（2026-11-07）**：`Sheet.tsx` 已删除，原调用点全部改为三形态——主题=外观卡内联展开；记一笔 / 添加待办 / 会话记录 / AI 配置=全屏子页（`src/components/FullPage.tsx`，从触发点圆形扩散入场，与全局切页动效同源）。新独立任务一律复用 `FullPage`，bottom sheet 禁令照旧。
- 类名空间（2026-11-07）：本项目自研类与 HeroUI v3 组件类已隔离，原同名裸类改名为 `.ph-card` / `.ph-chip` / `.ph-tag` / `.ph-toast`；HeroUI 的 Card/Chip/Tag/Toast 可安全使用。**新增自研类不要用裸通用名**（button/field/label 等已被 HeroUI 占用）。
- **✅ 空态提示垂直居中（2026-11-08 用户拍板）**：界面为空时的提示文字必须「屏幕视觉对齐」——垂直居中于可视内容区，不许贴在页头下沿留一大片空白。工具类都在 `src/styles/index.css`（`.empty` 旁），按场景选：
  - **页面级空态**（整个内容区为空）→ `.empty.empty-spring`：`flex: 1 0 auto` 撑满 `.page` 剩余空间并居中。flex-grow 先于 auto margin 吸收自由空间，贴底的 fab / add-bar（`margin-top: auto`）位置不受影响。已接入：错题本、记账、日程（待办 + 打卡）、AI 会话记录（还没有会话 / 搜索无匹配，提示与用法脚注整组居中）。
  - **卡片内空态** → `.empty.empty-box`：`min-height` 对齐有数据时图区的高度，卡片不塌（AI 用量图区）。
  - **侧栏树空态** → `.tb-tree-empty` 自带 `margin: auto 0`（`.tb-tree` 是定高 flex 列），新增域树空态直接用它。
  - **段内空态不居中**：页面还有其他内容时（如手机笔记页分组里的「无匹配笔记」），空态是段内提示，保持原位——只有「整个内容区为空」才居中。
  - **坑**：容器级居中（`justify-content: center` / auto margin）只许在空态分支生效。有数据的列表容器无条件加居中会把数据压到中部——AI 会话记录页踩过（`.sess-list.center` 只在空态时挂）；FullPage 弹层要空态居中用 `.fp-body.flex` 变体（`> *` 一律 `flex: none` 防固定高度控件被压扁，弹簧项 `1 0 auto`）。
