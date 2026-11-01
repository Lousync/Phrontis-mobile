# Phrontis Mobile 技术方案 v0.1

> 状态：方案与原型阶段（2026-10-31 拍板）。
> 桌面主仓库：`E:\Projects\KnowledgeRecorder`（npm 包名 `knowbase`，软件名 Phrontis）。
> 本仓库承载手机端的方案、原型与未来代码。

---

## 0. 决策记录（已拍板）

| 日期 | 决策 |
|---|---|
| 2026-10-31 | **定位**：本地优先的双端应用。手机自带存储、离线全功能；与电脑同网时「对账式同步」。不是瘦客户端（电脑关机手机照常用），也不是全量镜像同步。 |
| 2026-10-31 | **同步粒度**：域级同步（按条目 UUID 合并），**不做文件级同步**（vault JSON 是整文件重写式，文件级会互相覆盖）。 |
| 2026-10-31 | **技术栈**：Capacitor + React + Tailwind + TypeScript（复用桌面主题 token 与 TS 类型）；真 APK（本地存储/通知/后台可靠性所需），纯 PWA 不够。 |
| 2026-10-31 | **代码位置**：独立仓库（本仓库），与主仓平级。 |
| 2026-10-31 | **AI 形态**：手机端只留**一个**轻量统一 AI（记账/改日程/写笔记都找它），不复制桌面端的多角色细分；手机独立配 LLM Key。 |
| 2026-10-31 | **会话管理**：仿 DeepSeek 手机端——搜索 + 时间分组（置顶/今天/昨天/7天内/30天内/更早）+ 单行标题 + 长按呼出操作条（置顶/重命名/删除）。 |
| 2026-10-31 | **用量**：独立导航 Tab（AI·日程·记账·笔记·用量·设置 六栏），不做 AI 页内嵌细条。 |
| 2026-10-31 | **语音输入**：做，云端直连优先（详见 §6）；不做本地离线 ASR。 |
| 2026-10-31 | **M1 拍板**：配对 = 「8 位数字配对码（面板打开时生成、10 分钟有效、**一次配对即作废**）→ 换长期设备令牌」；服务默认端口 **8770**（lanShare 8765 不动）；手机端存储 M1 用 localStorage（等价 Preferences 形态），M2 评估 SQLite；v1 同步域**只做记账 `ledger`**（原「记账+日程双向」收窄，日程随 M2 加域，端点结构不变）；冲突裁决从「各留副本」简化为「同刻桌面赢 + `conflict` 标记回传」，删除同步（墓碑）挂 v1.1。 |
| 2026-11-01 | **应用内自动更新**仿桌面机制：发布复用公开仓 `Lousync/Phrontis` 的**第三个平台 tag** `v<ver>-mobile`（APK + `mobile-latest.json` 两件套门禁，扩展主仓 `scripts/publish-release.py --platform mobile`）；手机端 检查 → 镜像链下载 → sha256 校验 → 拉起系统安装器（Android 侧载无静默安装，最后一步必须用户点「安装」）。随 M6 落地，详见 §7.1。 |
| 2026-11-01 | **M2a 拍板**：同步域加 `schedule`（日程，子任务按条目同步、手机只读计数不编辑）；v1.1 **墓碑删除同步**双向打通（墓碑存 vault 随仓走，上限 5000 条）；游标**只在 pull 完成后推进**（修正 M1 在 push 时推游标、漏拉电脑侧早于 push 变更的缺陷）；手机端日程/流水落 localStorage 持久化（SQLite 评估挪到 M2b）；打卡（habit）暂不同步，保持本地演示。 |
| 2026-11-01 | **M2b 拍板**：账本本地真相改为**同步形态** `LedgerEntry { id, updatedAt, data }`（展示形态渲染时派生）——编辑/删除必须能还原完整同步负载，旧展示形态（日期是「今天」标签、金额带符号）还原不了；记账补全：点流水进「改一笔」抽屉、长按删除（行内确认 → 墓碑上行）、月份切换 + 月度统计；**SQLite 评估结论 = 维持 localStorage**（Capacitor 脚手架虽已在位，但账本+日程条目量级远低于 5MB 上限、切换要把全 store 改异步且浏览器 dev/smoke 回路复杂化，收益为负；`loadJson/saveJson` 已单点收口，迁移是机械活）——压力点在 M3 笔记正文缓存引入时再评。 |
| 2026-11-01 | **M3 拍板**：笔记双机制——「手机笔记上行」= sync 域 `notes`（负载 `{title,body}`，**无条件应用**、落 `.knowbase/_inbox` 收件箱 + frontmatter tags 恒加 `手机`，手机是闪念的真相源，v1 不做 LWW/墓碑）；「电脑笔记只读」= 内容 API（`GET /api/notes/tree` 平表 + `GET /api/notes/content?id=`，**按 id 服务端解析路径**，客户端永不传路径）；手机正文缓存 localStorage + 总量 1.5MB LRU 上限（SQLite/IndexedDB 评估继续推迟到真实触顶）；v1 笔记不 pull、不墓碑，手机删已上行笔记只删本地副本，附件/图片内链不解析（纯 md 渲染）。 |

---

## 1. 定位与原则

- **双端对等、局域网直连、无云无账号**（LocalSend 的精神）——唯一例外是 AI 调用走用户自己的 LLM Key，与桌面端同一立场。
- **手机 = 随身捕获与查看终端**：记账、记想法、看日程、问 AI 是核心场景；重度编辑（笔记正文、知识库结构）留在电脑。
- **同步是「回到一起时的合并」，不是「随时在线依赖」**：电脑不开、不在一个网，都不影响手机干活。
- 桌面端三条核心不变量继续成立：Vault 仍是唯一真相源（在电脑）；手机数据是**手机侧的本地真相**，通过同步并入 vault。

## 2. 架构

```
┌─ 手机 App（Capacitor + React）──────────────┐
│  本地存储（SQLite）· 四模块 UI · 轻量 AI 循环 │
│  待同步队列 · 同步引擎                        │
└──────────────┬──────────────────────────────┘
               │ 局域网 HTTP(S) · 配对令牌 · 自动发现
┌──────────────▼──────────────────────────────┐
│  电脑「手机伴侣」服务（由 lanShare 演化）      │
│  同步端点 → kbStore 业务函数 → broadcast     │
└─────────────────────────────────────────────┘
```

### 2.1 同步协议 v1（2026-10-31 冻结，M1 落地口径）

传输：局域网明文 HTTP（与 LocalSend / lanShare 同一信任模型），**私网网段白名单** + `Authorization: Bearer <deviceToken>`；报文 JSON；服务端开 CORS（手机 WebView 与服务不同源：`Access-Control-Allow-Origin: *` + 放行 `authorization` 头；令牌不落 cookie，无 CSRF 面）。

**端点（桌面「手机伴侣」服务，默认端口 8770）：**

| 端点 | 说明 |
|---|---|
| `POST /api/pair` | `{ code, deviceName }` → `{ ok, deviceToken, protocol: 1, pc: { name }, domains }`；code 8 位数字、10 分钟有效、**配对成功即作废**；尝试限频（10 次/分钟/IP） |
| `GET /api/ping` | 存活探测（带令牌），手机端以此判断「电脑在线」 |
| `POST /api/sync/push` | `{ deviceId, changes: [{ domain, id, updatedAt, data }] }` → `{ ok, results: [{ id, applied, conflict?, reason? }], serverTime }` |
| `POST /api/sync/pull` | `{ since: { ledger: <ms> } }` → `{ ok, changes: { ledger: [{ id, updatedAt, data }] }, cursor: { ledger: <ms> } }` |

**合并规则（不需要 CRDT）：**

- 身份 = 域内条目 UUID（手机生成、终身不变；桌面 repo 需要对应的**保 id upsert**，见 §8）。
- 新增（id 未见）：直接并入。
- 修改：`updatedAt`（ISO 字符串）**新的赢**；相同 → 桌面赢，响应标 `conflict: true`，手机以服务端版本为准回写收敛。
- v1 **没有删除**：删除同步需要墓碑机制，挂 v1.1（M2 一并评估）。
- 游标 = 毫秒时间戳，**按域存**（`lastSync.ledger` / `lastSync.schedule`）。**只在 pull 完成后推进**到响应的 `cursor`：push 不推游标——自己推上去的条目会被 pull 原样带回，按 id 幂等合并（收敛性保证）；若在 push 时就推进游标，会漏掉电脑侧早于本次 push 的变更（M1 缺陷，v1.1 修正）。pull 用各域游标过滤 `updatedAt > since`；冲突触发全量对账时该域游标回 0。

**v1.1 域范围（2026-11-01，M2a 落地）：`ledger` + `schedule`（日程）。**

- ledger 条目 data 不变（见上）。
- schedule 条目 data（两端各自映射到本地行）：`{ date, title, type: 'plan'|'deadline'|'daily', time, done, parentId, schedStart, schedEnd }`
  - `time` 为 `'HH:MM'`（deadline 截止时刻；桌面行存 `'YYYY-MM-DD HH:MM'`，pull 时截回 `'HH:MM'`；空串 = 无）；
  - `done` ↔ 桌面 `status`（pending/done）；`schedStart`/`schedEnd` 为当天分钟数 ↔ `scheduled_start`/`scheduled_end`（null = 未排期）；
  - `parentId` 使**子任务行也按条目同步**（手机侧只读：聚合计数展示，不编辑子任务）；
  - 桌面侧 `description`/`quadrant`/`tag_id`/`sort_order`/`recurring*`/`snooze_until`/`estimate_min`/`created_at` 不参与同步负载，upsert 时原样保留。
**v1.2 笔记（2026-11-01，M3 落地）：上行域 + 内容 API 双机制。**

笔记是 vault 里的 md 文件而非 JSON 条目，同步模型与条目域不同，拆成两条：

- **上行域 `notes`（手机闪念 → 仓库）**：负载 `{ title, body }`，走既有 `/api/sync/push`（id = 手机 UUID）。桌面应用语义：**手机是该笔记的真相源，无条件应用（v1 不做 LWW/墓碑）**——按 id 查知识库索引：已存在 → 原路径覆写（更新 title/body/updated，created/tags/starred 保留）；不存在 → 落 `.knowbase/_inbox/`（未分类收件箱），frontmatter tags 恒加 `手机`。电脑端把闪念整理成正式笔记后，手机端再推旧版会覆写整理结果——v1 已知边界，上行前在手机列表看一眼即可规避。
- **内容 API（电脑笔记 → 手机，只读缓存）**：`GET /api/notes/tree`（doc 类页面平表 `{ id, title, path, categoryId, mtimeMs, sizeBytes }`，排除欢迎页与非 md 的 file 条目）+ `GET /api/notes/content?id=<uuid>`（`{ title, updatedAt, body, truncated? }`，body 上限 30 万字符截断）。均带设备令牌；**按 id 由服务端解析路径**（客户端永不传路径，无目录穿越面）。
- **手机缓存策略**：正文缓存进 localStorage（`pm.noteCache`），总量 1.5MB、LRU 逐出（纯函数 `pruneNoteCache`，契约直测）；绿点 = 已缓存且 tree 的 mtimeMs 一致，空心 = 未缓存/已过期。SQLite/IndexedDB 评估继续推迟到真实触顶（M2b 结论的延续）。
- **v1 边界**：笔记不 pull、不墓碑；手机删除已上行笔记只删本地副本（仓库副本保留）；附件/图片内链手机端不解析（v1 阅读器纯 md 渲染，编辑回电脑进行）。

**删除同步（墓碑，v1.1）：**

- 上行：删除 = 一条 `data: { deleted: true }` 的变更（domain/id/updatedAt 照常，updatedAt = 删除时刻）。
- 桌面：收到即删行（日程级联删子任务，逐条记墓碑）；桌面侧自己的删除（界面 / AI 工具 / 7 天完成清理 / 结算撤销）经 repo 删除钩子统一记墓碑。墓碑 = `{ domain, id, deletedAt }`，存 vault（`.knowbase/modules/phoneCompanion/tombstones.json`），随仓迁移；上限 5000 条，超限弃最旧。
- 裁决：删除与更新在同一条 LWW 时线上——deletedAt/updatedAt 新者赢、相同桌面赢；已墓碑的 id 再收到**更旧**的上行 upsert → 拒绝（`reason: 'tombstoned'`），防止复活；删除比行内 updatedAt 旧 → 拒删回 `conflict`（手机以服务端版本回写收敛）。
- 下行：pull 响应增 `tombstones: [{ domain, id, deletedAt }]`（`deletedAt > min(各域游标)`）；手机按 id 幂等删本地条目，并丢弃该 id 的在途队列操作。

**触发：** 已配对且探测到电脑在线 → 自动对账（启动时 + 写操作后 + 手动「立即同步」）；未配对/离线时一切照旧记本地，待同步条数 UI 常显（琥珀色徽标）。

### 2.2 发现与配对

沿用主仓 `electron/lib/lanShare/` 已验证的模式（私网校验 + token + 扫码），做三处升级：

1. 一次性 token → **长期配对**：电脑出二维码（IP + 端口 + 配对令牌）→ 手机扫一次 → 两端互存设备指纹，之后同网自动重连；
2. 「手动开启 + 15 分钟超时」→ **可常驻的服务**（开机自启/托盘，设置可配）；
3. 文件传输端点 → **域级同步 API**。

mDNS 自动发现是锦上添花，二维码方案第一版就够。

**M1 实操流程**：桌面端入口 = 工具箱 →「手机伴侣」（常驻服务，可开可关，设置项 `companionAutoStart` 开机自启）；桌面出示**配对码 + 二维码**（二维码内容 `http://<ip>:8770/pair#<配对码>`，为将来扫码预留）。手机端 M1 在 设置 → 同步 里**手动输入**地址与配对码（或粘贴桌面端完整配对链接）——手机浏览器测试流程没有相机可用，APK 相机扫码随 M6 打包阶段接入。

## 3. AI 两档

| | 手机直连档（默认） | 电脑档（加分项） |
|---|---|---|
| 模型 | 手机自己配 Key（DeepSeek / 智谱 / OpenAI 兼容 / Ollama） | 电脑的 Key 与供应商体系 |
| 工具 | 轻量本地工具集（6~10 个，操作手机本地数据） | 桌面完整 agentService（全套工具、全库） |
| 写入 | 走确认卡：AI 提议 → 用户确认 → 本地落库 → 进同步队列 | 直接在电脑真相源执行 |
| 可用性 | 随时 | 仅电脑在线时 |

纪律：AI 工具与 UI 按钮共用同一条本地写入路径（同桌面端「AI 工具走 repo 业务函数」的铁律），AI 说记好了就是真的记了。

## 4. 功能范围（v1，六 Tab）

- **AI**：单 AI 多会话；两档模式切换；语音输入；操作确认卡。
- **日程**：三视图（待办：按 截止/计划/日常 分组、子任务进度、排期时段芯片；排期：时间轴 + 当下红线；打卡：连续天数 + 一周圆点轨迹 + 本周进度）+ 周条切日。对齐桌面 `ScheduleTodo` 的 taskType/scheduledStart/parentId 字段。
- **记账**：快速记一笔（数字键盘 + 分类/账户芯片）、流水按日分组、月度收支统计。
- **笔记**：仓库目录树（增量缓存：绿点已缓存可离线、空心点按需下载）+ 标题搜索 + 阅读器（v1 已有笔记只读）+ 「手机笔记」（上行并入仓库）。
- **用量**：今日/近 7 天/近 30 天 × Tokens（含输入/输出拆分）/花费/请求 × 趋势图（点柱看单日）× 按模型拆分 × 账户额度（额度/余额 + ok/warn/hot 级别）。口径对齐桌面 `src/modules/usage/`。
- **设置**：配对设备管理、重新扫码、同步范围、AI 模型（提供商/Key/模型）、外观（深浅色；「跟随桌面主题」为正式版项）。

原型：`prototype/index.html`（单文件，浏览器直接打开，可真实交互）。

## 5. 技术栈

- **Capacitor + React 19 + Tailwind + TypeScript**。UI 继承桌面 `src/styles/index.css` 的主题令牌（`#1e1e1e` 系深色 + `#007acc` 蓝）。
- 本地存储 SQLite（Capacitor 插件）；麦克风/通知/文件系统走官方插件。
- 共享代码：同步协议与条目类型以主仓 `src/types/index.ts` 为源头（`AccountingTransaction` / `ScheduleTodo` / `MomentsPost` 等均为逐条 UUID 的条目型，已核实）。
- 出网请求走 Capacitor 原生 HTTP 桥（等价于桌面「主进程 fetch 绕开 CORS」的架构位置）。

## 6. 语音输入（规划，非 v1 首日）

桌面端已论证到落码级并存档：`E:\Projects\DesignProcess\Phrontis\搁置功能与想法\语音输入\voice-input-design.md`（含实测数据与验收清单，可直接复用其交互规范）。手机端结论与桌面相反，性价比高一个量级：

- **云端直连**：硅基流动 `SenseVoiceSmall` 免费、OpenAI 兼容接口、走用户自己的 Key，费用为零；录 webm/opus 上传转写。
- **交互**：点击切换（**不做按住说话**——桌面端实测 pointer 手势补发 click 的坑）；状态机 空闲→录音（计时+波形）→识别中→出文本。
- **分流**：短句（<10s）转写后直接进 AI 出确认卡；长口述回填输入框让用户改。
- **不做**本地离线 ASR（手机上 AI 本就依赖云端，不值得背 200MB 模型）。

## 7. 里程碑

| 阶段 | 内容 | 产出 |
|---|---|---|
| M0 | Capacitor 脚手架 + 主题令牌移植 + 原型组件化 | 可装到真机的空壳 |
| M1 | 配对 + 同步基建（电脑端「手机伴侣」服务 + 手机同步引擎 + 待同步队列） | 记账一条流双端打通 |
| M2 | 记账/日程全功能双端 | 日常可用 |
| M3 | 笔记缓存 + 手机笔记上行 | 看笔记+闪念 |
| M4 | AI 两档（直连轻工具 + 电脑代理） | 完整 AI |
| M5 | 语音输入（云端直连） | 语音记一笔/记想法 |
| M6 | 本地通知（日程提醒）+ 打包发布 + 应用内自动更新（§7.1） | 可分发 APK + 应用内自更新闭环 |

### 7.1 应用内自动更新（随 M6 落地，2026-11-01 拍板仿桌面机制）

桌面版更新链路（主仓 `electron/lib/updateService.ts` + `scripts/publish-release.py`）：GitHub Releases 发布（三件套门禁：安装包 + blockmap + latest.yml，sha512/size 与本地产物实测一致才准上传）→ 客户端 `releases/latest` 对比版本号 → 镜像链（gh-proxy 前缀 → 备用节点 → 直连）流式下载 + 断点续传 + 坏字节换通道 → sha512 校验 → 拉起安装包。手机版照此骨架落地；Android 侧载（不进商店）的形态差异决定以下四点不同。

**发布侧（复用公开仓 `Lousync/Phrontis`，第三个平台 tag）**

- 桌面已是「Windows `v<ver>` / Linux `v<ver>-linux`」独立 tag 并行，手机作为第三个平台沿用同一模式：tag **`v<ver>-mobile`**（版本号用手机仓自己的 `0.x` 独立版本线，`-mobile` 后缀保证与桌面 tag 永不撞名）。资产**两件套** = `Phrontis-mobile-<ver>.apk` + `mobile-latest.json`（字段：`version` / `apk` 文件名 / `sha256` / `size` / `notes` / `mobileCommit` 溯源 / `publishedAt`）。
- 门禁哲学照搬发布脚本：APK 与 manifest 必须同时存在、manifest 的 sha256/size/version 与本地 APK 实测一致才准发布；扩展主仓 `scripts/publish-release.py` 加 `--platform mobile`（`--dir` 指向手机仓产物目录，手机仓采用同样的 `packs/<ver>[-N]` 产物约定）。与桌面双 tag 的「同 commit」交叉校验（决策 #10）不同：手机代码在另一个仓库，tag 钉在主仓 HEAD（发版事件 commit），手机仓代码 commit 记在 manifest 的 `mobileCommit` 字段。
- 已核实 `Lousync/Phrontis` 为公开仓（无鉴权 API 可达），桌面更新本就依赖这一点；APK 作为 Release 资产天然可被任何人下载（源码仓 Phrontis-mobile 保持私有不受影响）。若日后不想公开 APK，备选通道 = 手机伴侣 LAN 分发（见下）。

**手机端（检查 → 下载 → 校验 → 拉起安装）**

- **检查**：`GET api.github.com/repos/Lousync/Phrontis/releases?per_page=30` 过滤 `tag_name` 以 `-mobile` 结尾的最新一个（不能用 `releases/latest`——它与桌面 release 混排），semver 对比当前版本（Capacitor App 插件取 versionName）。触发时机对齐桌面：启动静默检查（≥24h 节流）+ 设置页手动「检查更新」；发现新版本出更新卡（版本号 + notes + 下载按钮），下载进度实时可见。
- **下载**：镜像链沿用桌面经验（`https://gh-proxy.com/https://github.com/...` 前缀拼接 → 备用节点 → 直连，坏通道自动换下一候选），流式进度 + 断点续传，APK 落应用缓存目录；落码时若 WebView 内 fetch 流式写文件不顺手，允许自写小型 Capacitor 插件（下载属原生职责，等价桌面「主进程 fetch」的架构位置）。
- **校验**：先 size 后 sha256（manifest 提供期望值），不符即弃包换下一通道——镜像坏字节防线与桌面一致。
- **安装**：FileProvider + `ACTION_VIEW`（`application/vnd.android.package-archive`）拉起系统安装器；需声明 `REQUEST_INSTALL_PACKAGES`，首次跳系统「允许安装未知应用」授权（一次性，之后不再问）。**Android 侧载没有静默安装，最后一步必须用户点「安装」**——应用内能做满的是「检查到、下完好、验过整、送到安装器面前」，这一点与桌面（NSIS 也弹确认）体验对齐。

**可选增强（不承诺）**：电脑在线时经手机伴侣拿 APK（电脑侧有完整镜像链与重试逻辑，局域网速度快于手机走代理），作为镜像链之外的加速兜底。

## 8. 与桌面端的契约

- 桌面端需新增「手机伴侣」：lanShare 演化（§2.2），同步端点走 kbStore，二维码配对 UI 进设置。
- 发布侧契约：主仓 `scripts/publish-release.py` 扩展 `--platform mobile`（tag `v<ver>-mobile`，APK + manifest 两件套门禁，§7.1）；手机仓产物目录同样落 `packs/<ver>[-N]`。
- 同步协议按资源版本号设计，为将来「全量镜像/更深同步」预留升级空间，不推翻重来。
- 桌面 `resources/help/*.md` 在「手机伴侣」上线时需同步补篇（AGENTS.md 铁律）。

## 9. 参考

- 原型：`prototype/index.html`
- 桌面 ASR 存档：`E:\Projects\DesignProcess\Phrontis\搁置功能与想法\语音输入\voice-input-design.md`
- 桌面用量口径：`E:\Projects\KnowledgeRecorder\src\modules\usage\`
- 桌面 lanShare（连接层地基）：`E:\Projects\KnowledgeRecorder\electron\lib\lanShare\`
- 条目型数据结构：`E:\Projects\KnowledgeRecorder\src\types\index.ts`
