# AI 教学移植分析(已搁置归档)

> 状态:**已搁置**(2026-11-08 用户拍板:暂不移植——AI 教学在电脑端体验更舒服,平板/手机不立项)。
> 本文档是 2026-11-08 讨论与原型工作的完整存档;将来重启移植时从这里进入,不必重新探索桌面仓。
> 配套原型:`prototype/ai-teaching.html`(单文件,浏览器直接打开,可真实交互)。
> 桌面权威设计文档:主仓 `docs/ai-teaching-simplify-plan.md`(3.14.0,课程/段/素材的最终口径)。

---

## 0. 结论与时间线

| 阶段 | 结论 |
|---|---|
| 范围讨论 | 1:1 全量移植不可行(工作量大头在 Electron 主进程,移动端没有等价物);拍板「只做地基」(教学模式感知的 AI 会话),平板 UI 落位后定 |
| 原型 v1 | 平板壳层上验证「教学对话循环」:讲解 → quiz 围栏题卡 → 判分 → 错题回流;用户反馈:**课程知识点结构缺失** |
| 原型 v2 | 对齐桌面 3.14 课程骨架重做:课程树 / 段 / 开段预检 / 收尾交接 / 章末复习,全链路浏览器实测通过 |
| 收口(2026-11-08) | 体验后拍板:**暂不移植**。AI 教学以电脑为宿主;平板维持 design.md §10 既有路线(T2 做题闭环 = 错题复习 + 读文档刷题,与 AI 教学模块是两回事,不受本决定影响) |

## 1. 桌面端 AI 教学模块结构(探索结论,重启时省一次探索)

「AI 教学」是整仓级子系统,不是一个组件:

| 层 | 体量 | 内容 |
|---|---|---|
| 渲染层 | ~5000 行 | 主仓 `src/modules/ai-teaching/index.tsx`(3645 行,五区工作台)+ 15 个子组件(CourseRail / Preflight / CourseProgress / CourseSources / ArtifactsPane / SideLanePanel / AiTeachFileTree / RequirementsDrawer 等) |
| Electron 主进程 | ~6600 行 | `agentService`(2214,Agent 循环 + 每轮 system 注入)+ `llmService`(2284,多供应商流式)+ `builtinTools`(3513,工具执行面)+ `aiTeaching*` 六个服务(Course 1645 / Sources 1428+907 / Folders 666 / Profile 381 / Scope 299 / Workspaces 244) |
| 零依赖纯函数 | ~1000 行 | `aiTeachingProgressPure` / `aiTeachingSourcesPure` / `agentStreamCore` / `chatCommands` / `courseRailPure` / `profilePatchParse` / `constraintsParse` |
| 共享组件组 | ~1400 行 | `QuizParser`(360,含 `looseJsonParse` 协议块解析)/ `QuizMode`(352)/ `QuizCard`(272)/ `QuizRecordStore`(417) |
| 数据 | vault 文件系 | `.knowbase/modules/aiTeaching/{workspaces,progress,sources,favorites}.json` + `.knowbase/agent/{sessions.json,messages/*.jsonl}` + `AI教学/` 产物夹(会话⇄文件夹绑定) |

**架构事实**:LLM 请求 100% 走 Electron 主进程代理(渲染层从不直接 fetch);~60 个 `aiTeach:*` IPC 通道 + 工具执行面全在主进程;API Key 经 safeStorage 加密永不出主进程。流式回推走 `agent:stream` / `agent:step` / `assistant:runstate` 三通道。

**数据模型核心**(simplify-plan §3):`课程.md` = 人读人改的大纲真相源(章带稳定 ID `[cN]`,知识点行 `uN | 名称 | 目标 | 依据`);`progress.json` v2 段模型(`lessons[sessionId]{unitIds, activeUnitId, order, status, sources快照, handoffRel}` + `units{finished}` + `reviews{章ID→讲义}`);`sources.json` 三分离(登记 / 章级分配 / 段快照);知识点「学完」= 所在段已收尾,不看掌握度;章末复习解锁只看「本章全学完」。

## 2. 移植障碍清单(重启时的成本评估)

| 障碍 | 等级 | 说明 |
|---|---|---|
| Agent 循环 + 工具执行 + 每轮注入 | **最大** | `agentService`/`llmService`/`builtinTools` 全在主进程;移动端要重写成 WebView JS 层(CapacitorHttp 桥 = 架构等价物),流式需另想(CapacitorHttp 不支持 SSE) |
| ~60 个 aiTeach IPC + ws:* 文件服务 | **大** | 需用 Capacitor Filesystem 重写六个 aiTeaching* 服务 |
| soffice/PDF/PPTX 提取、webCrawler、视觉转写 | 中 | 主进程能力,移动端需替代方案(pdf.js 可解一部分) |
| 纯函数层 | **小,可直接搬** | §1 表中「零依赖纯函数」整组 |
| 要替换 | — | `assistantRunStore` 的 ipc 订阅、secretBox Key 存储(→ `pm.aiConfig` 本地)、`appModules.ts` 注册方式 |
| 不搬 | — | 五区布局/浮窗/禅模式(平板两栏范式冲突)、`builtinTools` 的 vault 写工具面 |

## 3. 已拍板的「地基」方案(2026-11-08,未落码)

当时拍板「只做地基」的范围,重启时可直接沿用:

1. 会话模型加 `mode: 'chat' | 'teach'`(localStorage 本地态,不碰同步协议);
2. `buildSystemPrompt` 扩展教学块:教学纪律 + 桌面同款 quiz 围栏规则(`agentService` 的 quizRuleHint 口径);
3. 对话流内渲染题卡:复用现成 `quizParse` + `QuizCard` + 错题回流链路;
4. 轮次上限:教学模式单独放宽到 8(全局 `AI_MAX_ROUNDS=5` 不动);
5. 上下文预算:最近 N 轮 + system 注入的截断策略(参考桌面 ctxWindow 口径精神);
6. 数据层顺手带上、UI 不暴露:Session 可选 `docId` 锚点(正文截断注入);`looseJsonParse` 从桌面 QuizParser 搬(模型输出的宽松 JSON 解析是刚需);
7. 维持非流式 + 打字机(M4a 口径,教学长文观感成立,v1 原型已验证)。

## 4. 原型 v2 验证过的平板课程骨架(桌面 3.14 口径在两栏里的落位形态)

`prototype/ai-teaching.html` 实测通过的全链路,重启时 UI 形态可直接引用:

- **侧栏 AI 域 = 「课程 | 会话」双页签**;课程页签 = 课程助手行 + 搜索 + 章手风琴(章头 `章名 + 已学 x/y + 本段标记`,知识点行 `状态点(未学/本段进行中/已学) + 本段徽章`,章末复习行排最后不参与计数)。264px 侧栏密度成立。
- **点知识点三分支**:在当前段 → 聚焦胶囊;已学 → 打开已收尾段(只读续看);未学 → 预检(本章有 open 段则 toast 拦截「先收尾再开新段」)。
- **开段预检 = 内容区整页**(非弹窗,符合 UI 硬规范):知识点复选(默认连续 3 个、已学灰显、上限 3)+ 素材匹配徽章(精确/缩窄/整章)+ 上一段交接预览。
- **段视图头部** = 面包屑 + 本章细进度条 + 段内 k/m + 知识点胶囊条(点击切换聚焦)+ 交接折叠条 + 段素材快照条;「收尾本段」在头部右侧。
- **收尾 → 交接生成 → 知识点绿点翻转 → 下一段预检自动带交接**;本章全学完 → 「去章末复习」→ 复习视图(知识点清单 + 生成《复习讲义》)→ 行变「已生成讲义」。
- 教学对话循环(讲解/思考折叠/围栏闪现 morph 题卡/动态讲评/错题回流书架)嵌在段视图内,打字机观感成立。

原型刻意没做(桌面有、重启时再议):素材登记/提取流程、支线旁问、工件分栏(讲义/导图)、CONSTRAINTS 分层要求抽屉、课程助手建课全流程。

## 5. 重启移植的入口建议

1. 先读本档 §1/§2 + 桌面 `docs/ai-teaching-simplify-plan.md`,再决定范围(全量课程化 vs 地基切片);
2. UI 形态直接从 `prototype/ai-teaching.html` 起(骨架已验证),不必重画;
3. 落码顺序建议沿用桌面 simplify-plan §8 的 P0→P3 思路:先纯函数/数据模型(progress 投影进 store 的形态),再 prompt 注入,最后课程 UI;
4. 若「教学数据要进 vault / 跨端同步」,先动 design.md §2.1 冻结协议(按 AGENTS.md 规则:先改文档再动代码,双仓契约脚本都要过);
5. 手机端是否共享教学模式:`mode` 字段与教学 system 注入是 lib 层,手机 AI 页可免费受益,落码时不要做成平板专属。
