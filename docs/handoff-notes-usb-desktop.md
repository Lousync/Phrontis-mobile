# 交接文档：笔记 U 盘模式（同步协议 v1.6）——桌面端实现指南

> **给谁**：桌面端（主仓 `E:\Projects\KnowledgeRecorder`）的会话。
> **协议真相源**：手机仓 `docs/design.md` §2.1「v1.6 笔记 U 盘模式」一节（本文是它的实现展开，两处不一致时以 §2.1 为准）。
> **手机侧已全部落地**（引擎、LWW 合并、墓碑删除、deviceName 单一来源、契约脚本），桌面侧尚未动——本文就是桌面侧的完整施工图。
> **用户原话（需求锚点）**：同步后仓库顶层有个「移动端」文件夹，里面是各设备名称的文件夹，点进去是该设备的笔记区；设备文件夹只有连接后才显现；桌面端可对里面的文件增删改，修改后移动端同步更新——像插了个 U 盘。

---

## 1. 现状（桌面侧今天的行为，v1.5-）

- 手机笔记经 `/api/sync/push`（domain `notes`，负载 `{title, body}`，id = 手机 UUID）**无条件应用**：有 id → 原路径覆写；无 → 落 `.knowbase/_inbox/`，frontmatter tags 加 `手机`。
- **没有 notes 的 pull**（pull 只回 ledger/schedule + tombstones），手机端删除只删本地副本。
- 桌面配对设备表：`%APPDATA%/knowbase/data/phone-companion.json`（应用全局），每设备已有 `deviceToken`、`vaultFingerprint`（v1.4）、`deviceName`（配对负载已带，v1.5 起两路配对都发）。

## 2. 目标形态（一句话）

手机笔记不再是「收件箱里的一条消息」，而是仓库里一棵**双向同步的子树**：`<vault>/移动端/<设备名>/<标题>.md`。手机增删改 → 文件跟着变；桌面（UI / AI 工具 / 直接编辑文件）增删改 → 下一轮 pull 回手机。语义 = 一台可编辑的网络 U 盘，但 Conflict-free（LWW 收敛，无冲突卡）。

## 3. 仓库布局与文件形态（硬契约）

```
<vault>/
  移动端/
    <设备名>/            ← 每台配对设备一个（deviceName；同名设备 → <名>-<deviceId 前 4 位>）
      购物清单.md
      会议纪要.md
```

每个文件的 frontmatter（桌面写文件时负责维护）：

```yaml
---
id: <手机笔记 uuid>     # 跨端同步锚点，永不改
updated: <ISO 时间戳>   # 该条内容最后改动时间 = LWW 裁决依据
tags: [手机]            # 沿用 v1.2
---
<正文 md>
```

规则：
- **文件名 = `<标题>.md`**：标题改动 = 文件改名（`id` 不变）；Windows 文件名非法字符 sanitize（`\ / : * ? " < > |`），空标题兜底「无标题」；重名加 `(2)` 后缀。
- **桌面任何一次内容改动都必须同步更新 frontmatter `updated`**（桌面 UI 编辑、AI 工具写入、用户在编辑器里改完保存——统一走 repo 写钩子）。这是下一轮 LWW 的裁决时钟，漏更会导致手机版旧内容「自愈」覆盖桌面改动。
- `id` 是唯一锚点：文件改名/移动目录都跟着 id 走，靠知识库索引（按 id 查路径）解析，**客户端永远不传路径**（v1.2 内容 API 同款安全边界）。

## 4. 协议增量（端点不变，语义升级）

### 4.1 push（手机 → 桌面，`/api/sync/push`）

changes 里 domain `notes` 的条目两种负载：

| 负载 | 语义 | 桌面动作 |
|---|---|---|
| `{ title, body }` | upsert | **LWW 裁决**：`change.updatedAt` 新于该 id 设备状态里记录的版本 → applied（写/改 `移动端/<设备名>/<标题>.md`，frontmatter `updated` 写 change.updatedAt）；桌面版本更新 → 回 `conflict`（手机以服务端版本收敛，下一轮 pull 带回桌面版） |
| `{ deleted: true }` | 墓碑 | 删除该 id 对应文件 + 记墓碑（既有墓碑机制，domain `notes`）。**桌面没见过这个 id → 照样回 applied**（手机新建即丢会制造无害墓碑，不要报错） |

裁决时钟就是 `change.updatedAt`（op 时间），**data 负载里没有时间字段**，不要去 data 里找。

### 4.2 pull（桌面 → 手机，`/api/sync/pull`）

请求 `since` 增加第三域：`{ ledger, schedule, notes }`（手机端已实现；旧手机不传 `notes` → 按缺省 0 处理，行为等同全量）。响应：

```jsonc
{
  ok: true,
  changes: {
    ledger: [...], schedule: [...],
    // v1.6 新增：该设备文件夹内，桌面侧的增改（含桌面自己改的 + 用户直接编辑文件被检测到的）
    notes: [{ id, updatedAt, data: { title, body } }]
  },
  tombstones: [{ domain, id, deletedAt }],  // domain 现在可能是 'notes'（桌面在文件树里删了文件）
  cursor: { ledger, schedule, notes }        // notes 游标：每台设备独立、单调（建议 Date.now() 生成时刻）
}
```

- `changes.notes[].updatedAt` = 该条内容的 LWW 时钟（与文件 frontmatter `updated` 同值）。
- 手机端合并逻辑（已实现，桌面只需保证上面字段）：远端新/同刻 → 覆盖本地；本地新 → 手机把本地版重新 push 上来（**自愈**，桌面会收到一条对已知 id 的 upsert——照 §4.1 LWW 裁决即可，通常 applied）。
- **兼容矩阵（两仓脚本都要锁）**：
  - 旧手机（不发 since.notes）+ 新桌面 → `since.notes` 缺省按 0：全量 notes 变更返回，手机旧版忽略 `changes.notes`（多余字段无害）。
  - 新手机 + 旧桌面 → 响应无 `changes.notes` → 手机按空数组、notes 游标保持 0，每轮全量重拉 notes（旧桌面无下行，行为不变）。
  - **`since.notes = 0`（冲突后全量重对、或旧手机）→ 返回该设备文件夹全量条目**；墓碑按既有规则 `deletedAt > min(游标)` 过滤，手机幂等应用。

### 4.3 桌面自身文件变更的检测（实现建议，非硬契约）

桌面需要感知「设备文件夹里的文件被桌面侧改动过」（UI 编辑 / AI 工具 / 用户手改文件）。建议每设备维护一份状态：

```jsonc
// phone-companion.json → devices[id].notesState（建议结构，可自行调整）
{ "cursor": 1731045600000, "items": { "<noteId>": { "path": "移动端/Phrontis 手机/购物清单.md", "updatedAt": "<ISO>" } } }
```

生成 pull 响应时扫描 `移动端/<设备名>/`：
- 文件存在但 **frontmatter 没有 `id`（用户从仓库别处拖进来的文件）→ 自动生成 uuid 写回 frontmatter 再纳入同步**（这是「拖入 = 下载到手机」用户场景的关键一步；写回时不要动正文与 tags）；
- 文件存在 + frontmatter `id` 不在 items → 新增变更（updatedAt 取 frontmatter）；
- 存在 + `updated` 与 items 记录不同 → 修改变更；
- items 里有、文件夹里没了（且非本设备刚记的墓碑）→ tombstone（`domain: 'notes'`，`deletedAt` = 发现时刻）；
- 全部比对完 → `cursor = Date.now()` 写回。
扫描时机：pull 请求到达时现算（文件量级小，免监听）；或文件 watcher + 脏标记二选一，行为契约只看 pull 响应。

### 4.4 设备文件夹的可见性（桌面 UI，用户拍板的形态）

- `移动端/<设备名>/` 在文件树中**仅在该设备在线时显示**（在线 = token 有效且最近 ping 通过；配对表里判）。
- 离线 → 树里隐藏该设备文件夹；**磁盘文件保留不动**（这不是删除——重连后树重现，期间桌面/手机的改动照常对账）。
- 没有任何设备在线 → 「移动端」顶层也隐藏。
- `移动端/**` **必须从 `/api/notes/tree`（内容 API）里排除**——否则手机阅读器的仓库树会出现自己的笔记（那是另一棵树，两域互不掺和；见 design.md v1.6「不做的事」）。

## 5. 手机侧已落地的清单（桌面只需对齐，不要重做）

- 引擎 `src/lib/sync.ts`：`since/cursor` 三域、`changes.notes` 解析、`RemoteNoteItem`、LWW 纯函数 `noteLww`（新者赢；同刻桌面赢；缺时间按旧）。
- `src/lib/store.tsx`：`PhoneNote.updatedAt`（旧数据回填纪元值）；`applyRemoteNotes`（远端新覆盖 + synced 置真；本地新重新入队自愈；在途删除保护）；墓碑 `domain:'notes'` → 本地删笔记；`deletePhoneNote`（清空标题保存 = 墓碑删除）。
- 配对负载 `deviceName` 单一来源 `getDeviceName()`（`pm.deviceName`，默认「Phrontis 手机」）。
- 契约脚本 `scripts/verify-sync.mjs` 已升级并全过（78 项），含 v1.6 断言（设计文档 + LWW 语义 + 三域游标）。

## 6. 桌面侧要改的清单（验收口径）

1. **push 应用语义**：notes upsert 无条件应用 → LWW 裁决（applied/conflict）；notes 墓碑 → 删文件 + 记墓碑；unknown id 墓碑回 applied。
2. **设备文件夹落盘**：upsert 写 `移动端/<设备名>/<标题>.md`（frontmatter id/updated/tags），不再进 `.knowbase/_inbox/`（旧收件箱文件不迁移、不动）。
3. **pull 下行**：`changes.notes` + tombstones notes + `since/cursor.notes`（§4.2 兼容矩阵全覆盖）。
4. **设备状态**：deviceName 持久化、每设备 notes 游标 + items 状态、文件变更检测（§4.3）。
5. **树 UI 可见性**：在线才显示设备文件夹；`移动端/**` 从内容 API 排除。
6. **契约脚本**：主仓 `.AGENT/scripts/phone-companion/verify-companion-protocol.mjs` 补 v1.6 断言（建议对齐手机仓 scripts/verify-sync.mjs 的新增项：LWW 语义、三域游标、frontmatter 契约、兼容矩阵口径），两仓脚本都要过（AGENTS.md 硬规则）。

## 7. 端到端验收清单

- [ ] 手机新建笔记 → 同步 → 桌面树出现 `移动端/<设备名>/<标题>.md`，frontmatter 带 id/updated/tags。
- [ ] 手机改标题 → 同步 → 文件改名，id 不变；手机改正文 → 文件内容更新。
- [ ] 手机删笔记（清空标题保存）→ 同步 → 桌面文件消失。
- [ ] 桌面改文件内容（frontmatter updated 被桌面更新）→ 手机同步 → 手机端该笔记变新内容、徽标「已同步」。
- [ ] 桌面新建文件（带 frontmatter id=新 uuid）→ 手机同步 → 手机列表出现该笔记。
- [ ] **拖入下载**：把仓库里一篇无 id 的 md 复制进设备文件夹 → 桌面自动补 uuid → 手机同步后成为手机笔记（离线可读、可编辑、改动同步回设备文件夹副本）。
- [ ] 拖入超 10 万字符的文件 → 手机端正文截断（既有口径，桌面文档变更集照发即可，但建议 UI 提示）。
- [ ] 桌面删除文件 → 手机同步 → 手机端该笔记消失。
- [ ] 两端同时改同一条：新者赢；桌面赢时手机自动收敛，手机赢时桌面收到自愈 upsert。
- [ ] 设备离线：树里隐藏文件夹，盘上文件还在；重连后积压变更双向对平。
- [ ] 旧 APK（无 notes pull）对新桌面：无异常、无重复。
- [ ] `/api/notes/tree` 不含 `移动端/**`。

## 8. 明确不做（本拍边界）

- 笔记冲突标记 UI（LWW + 自愈足够）；设备改名追认历史路径；旧收件箱文件迁移；`移动端` 文件夹参与内容 API/手机正文缓存；手机端显式删除按钮（编辑清空 = 删除已够，后续按需加长按删除）。
- 拖入文件的图片/附件解析（手机端纯 md 渲染，v1 边界不变）；超大文件（>10 万字符）手机端截断是既有口径，不做分块传输。
