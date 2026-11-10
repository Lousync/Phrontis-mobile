# 交接文档：iPad 文件交接与批注回传（文件通道 v1）——桌面端实现指南

> **给谁**：桌面端（主仓 `E:\Projects\KnowledgeRecorder`）的会话。
> **协议真相源**：手机仓 `docs/design.md` §2.3「文件通道 v1（iPad 交接 / 批注回传）」；本文是它的实现展开，两处不一致时以 §2.3 为准。
> **手机侧状态**：**已落码（2026-11-10）**，等待桌面端点联调。实现：`src/lib/fileHandoff.ts` + `src/lib/store.tsx` 文件域 + `FilePanel.tsx` / `FileInbox.tsx`；原型 `prototype/ipad-file-handoff.html`；iOS 已声明 PDF document types 与 `UIFileSharingEnabled`，原生依赖 app/filesystem/share/file-transfer。
> **用户原话（需求锚点）**：电脑 vault 里的 PDF → iPad 上用 Prodrafts 手写批注 → 导出后回传电脑。先做 iPad；回传只另存副本到统一 `iPad 批注/`，不覆盖原文件；v1 只列 PDF。

---

## 1. 目标与边界

**目标**：手机/平板端能把电脑 vault 里的 PDF 下载到本地，交给 Prodrafts 等 App 打开；用户在别的 App 里导出批注后的 PDF，再通过 Phrontis 回传到电脑。电脑端**只新增文件**，不改动原文件。

**v1 硬边界**：

- 只列 `.pdf`；其他类型后续扩展。
- 只支持「回传副本」：统一落 `<vault>/iPad 批注/`，不覆盖、不删除、不改名任何现有文件。
- 只做 iPad；Android 平板后续复用端点，文件桥另实现。
- 不做应用内 PDF 渲染/批注；Prodrafts 等 App 负责内容，Phrontis 只做搬运和状态。
- 不抬同步协议大版本：文件通道是**增量能力**，用 `/api/ping` 的 `features` 做能力探测，旧两端零破坏。

---

## 2. 现状：桌面端可复用的东西

桌面的知识索引已经把非 md 文件全量收录了，**不需要新写文件扫描器**：

- `getKnowledgeIndex().pages` 对非 md 文件给出 `entryKind: 'file'`、`fileType`（扩展名小写）、`title`（去扩展名的文件名）、`sizeBytes`、`mtimeMs`、`path`（仓库相对路径，`/` 分隔）。
- `findKnowledgePage(id)` 按 id 解析条目；PDF 文件的 id 形如 `auto:课程/线性代数/讲义 03.pdf`。
- `listNoteTree` 现在过滤了 `entryKind === 'file'`，所以 PDF 不会出现在「电脑笔记」树里——文件通道要**另开一个只读列表端点**，不要把 file 混进 notes 域。

其他可复用件：

- `electron/lib/lanShare/upload.ts`：零依赖的流式 multipart 解析器，单文件上限 500MB、边读边写盘、不整包进内存。**注意它现在硬编码 `getInboxDir()` 和 `<Date.now()>-<name>` 前缀**；给伴侣复用时要参数化目标目录/命名，或复制一份伴侣专用版本，别改坏 lanShare。
- `electron/lib/pathGuard.ts` 的 `safePathInside` / 现有 `isMobileNotesRel`。
- `electron/lib/fsWatcher.ts` 的 `markSelfWrite`、知识索引 `invalidateKnowledgeIndex`、`broadcastDataChanged('knowledge')`。
- `writeWorkspaceFile` 是**文本**写入口；二进制上传要新写一个原子写 helper（或直接 `fs` + `markSelfWrite` + 索引失效），不要拿文本函数硬塞 Buffer。
- 桌面的 `MAX_OPEN_SIZE`（50MB）是编辑器限制，文件通道单独设上限（建议 200MB），不要复用它。

---

## 3. 仓库布局

```
<vault>/
  iPad 批注/
    讲义 03（批注）.pdf
    设计心理学（批注）.pdf
  课程/
    线性代数/
      讲义 03.pdf          ← 原文件，永不改动
```

规则：

- `iPad 批注/` **自动创建**，目录可见、走正常知识索引，不做隐藏。
- 文件名 = `<原文件名 stem>（批注）.pdf`；如果上传名已经以 `（批注）` 或 `(批注)` 结尾，不重复追加。
- 重名自动加 ` (2)`、` (3)`……**绝不覆盖**。
- 上传成功 = 临时文件 + 原子 rename；失败清理临时文件，不在 vault 里留半成品。
- 不删除、不改名、不覆盖任何原文件；用户要整理就在桌面端自己做。

---

## 4. 端点规格

全部沿用伴侣服务现有安全模型：**私有网段 + `Authorization: Bearer <deviceToken>` + vaultFingerprint 绑定**。不要新开无鉴权路径。

### 4.1 `GET /api/files/tree`

列出当前 vault 内可交接的 PDF。

**请求**

```
GET /api/files/tree
Authorization: Bearer <deviceToken>
```

**响应**

```json
{
  "ok": true,
  "generatedAt": 1760000000000,
  "files": [
    {
      "id": "auto:课程/线性代数/讲义 03.pdf",
      "path": "课程/线性代数/讲义 03.pdf",
      "title": "讲义 03",
      "fileType": "pdf",
      "sizeBytes": 2516582,
      "mtimeMs": 1760000000000
    }
  ]
}
```

**过滤规则**

- `entryKind === 'file'` 且 `String(fileType).toLowerCase() === 'pdf'`。
- 排除 `移动端/**`（`isMobileNotesRel`）——这是手机笔记 U 盘子树，两棵树互不掺和。
- 排除 `.knowbase/**`、`.attachments/**`、`_attachments/**`、`_inbox/**` 以及任何隐藏段（段名以 `.` 开头）。
- `.ignore` 已由知识索引处理，直接信任索引结果。
- 空 vault / 无 PDF → `files: []`，不要 404。
- v1 一次性返回全部 PDF；如果 vault 里 PDF 上千，再加 `limit` / 目录前缀参数，端点结构不变。

### 4.2 `GET /api/files/content?id=`

按 id 服务端解析路径，二进制流返回 PDF。

**请求**

```
GET /api/files/content?id=auto%3A%E8%AF%BE%E7%A8%8B%2F%E7%BA%BF%E6%80%A7%E4%BB%A3%E6%95%B0%2F%E8%AE%B2%E4%B9%89%2003.pdf
Authorization: Bearer <deviceToken>
```

**实现**

1. `findKnowledgePage(id)`；不存在 / `entryKind !== 'file'` / `fileType !== 'pdf'` → **404**。
2. `abs = join(vaultRoot, entry.path)`；`safePathInside(vaultRoot, abs)` + 符号链接检查；越界 → 403。
3. `statSync` 拿 size；`res.writeHead(200, headers)`；`createReadStream(abs).pipe(res)`。
4. 流错误 / 客户端断开：`res.destroy()`，不要崩服务。

**响应头**

```
Content-Type: application/pdf
Content-Length: <size>
Content-Disposition: attachment; filename*=UTF-8''<encoded name>
Cache-Control: no-store
X-Content-Type-Options: nosniff
```

v1 不要求 `Range`；后续要断点续传再加（iOS `FileTransfer` 默认整包下载，够用）。

### 4.3 `POST /api/files/upload`

流式接收 multipart，只写新文件到 `iPad 批注/`。

**请求**

```
POST /api/files/upload?name=%E8%AE%B2%E4%B9%89%2003%EF%BC%88%E6%89%B9%E6%B3%A8%EF%BC%89.pdf
Authorization: Bearer <deviceToken>
Content-Type: multipart/form-data; boundary=...

--boundary
Content-Disposition: form-data; name="file"; filename="讲义 03（批注）.pdf"
Content-Type: application/pdf

<PDF bytes>
--boundary--
```

**`name` query 是协议的一部分（2026-11-10 追加）**：原生 `FileTransfer` 无法单独指定 multipart 文件名，它用本地路径末段当 filename；手机端暂存文件叫 uuid.pdf，因此必须用 `name` 传用户可编辑的最终名。服务端优先用 `name`，缺失再回落 multipart filename，两者都走同一套消毒规则。不要信任这个值（防路径穿越/非法字符）。

手机端用 `@capacitor/file-transfer@1.x` 的 `uploadFile`，默认就是 multipart；先用默认行为联调。若 iOS 端实际发的是 raw body（不是 multipart），再加一个 `application/octet-stream` 的 raw 端点作为备选，**不要为了协议洁癖让手机端手写 multipart**。

v1 **不需要客户端传原文件 id**：回传目标始终是 `iPad 批注/`，最终名来自 `name`（或上传文件名）；手机端的「匹配原文件」只用于给用户一个默认文件名，不参与服务端路径决策。这样即使原文件在电脑上改名/移动，也不影响回传副本落盘。

**服务端步骤**

1. 鉴权 + vault 检查；`Content-Type` 必须是 multipart，否则 400。
2. 复用/参数化 `parseUpload`，把文件流式写到 `<vault>/iPad 批注/.tmp-<uuid>.pdf`；边写边计数，超过 **200MB** → 413 并删临时文件。
3. 读临时文件前 5 字节，必须是 `%PDF-`；否则 415 并删除。
4. 最终名 = query `name`（有则优先）→ multipart `originalName`：
   - `basename`，去掉路径分隔符、控制字符、Windows 非法字符 `\ / : * ? " < > |`；
   - 强制 `.pdf` 扩展；`stem` 已以 `（批注）`/`(批注)` 结尾则不重复追加，否则追加 `（批注）`；
   - 目标目录 `<vault>/iPad 批注/`；重名循环 ` (2)`、` (3)`……最多 100 次，仍冲突 → 409。
5. 原子 rename 到最终路径；`markSelfWrite(finalAbs)`；`invalidateKnowledgeIndex()`；`broadcastDataChanged('knowledge')`。
6. 返回新文件信息；失败清理临时文件。

**响应**

```json
{
  "ok": true,
  "file": {
    "name": "讲义 03（批注）.pdf",
    "path": "iPad 批注/讲义 03（批注）.pdf",
    "size": 2726297,
    "mtimeMs": 1760000000000
  }
}
```

**错误**

| 状态 | 场景 |
|---|---|
| 400 | 缺 boundary / 缺文件 / 空文件 |
| 401 | 无效设备令牌 |
| 403 | 仓库指纹不符 / 路径越界 |
| 413 | 超过 200MB |
| 415 | 非 PDF（魔数不对） |
| 409 | 重名 100 次仍冲突（几乎不会发生） |
| 500 | 写盘 / 索引刷新失败（临时文件已清理） |

### 4.4 `GET /api/ping` 能力位

在现有响应上加：

```json
{
  "ok": true,
  "protocol": 1,
  "pc": { "name": "..." },
  "features": ["files"]
}
```

- 旧手机不认识 `features`，忽略即可。
- 新手机在旧桌面（无 `features`）时隐藏文件区，不报错。
- 不要求抬 `protocol` 大版本；如果主仓倾向抬到 1.9，两仓契约脚本一起改，但文件端点本身仍按能力位降级。

---

## 5. 桌面端实现步骤（建议顺序）

1. **抽流式上传器**：把 `lanShare/upload.ts` 的解析核心参数化（目标目录、命名策略、maxBytes），或者复制成 `phoneCompanion/fileUpload.ts`；保留 lanShare 现有行为，加一条契约测试防回归。
2. **`GET /api/files/tree`**：复用知识索引，按 §4.1 过滤；先在契约脚本里断言「只有 PDF / 排除移动端 / 中文路径」。
3. **`GET /api/files/content`**：id 解析 + 路径围栏 + 流式输出；用 curl 下载一个中文名 PDF，和磁盘 sha256 对比。
4. **`POST /api/files/upload`**：临时文件 + 魔数 + 命名 + 原子 rename + 索引刷新；用 curl `-F` 上传，检查 `iPad 批注/` 和桌面树。
5. **`/api/ping` 加 `features`**：确认旧手机不受影响；新手机按能力位显示文件区。
6. **契约脚本**：主仓 `.AGENT/scripts/phone-companion/verify-companion-protocol.mjs` 补文件通道断言；手机仓 `scripts/verify-sync.mjs` 补纯函数/命名/过滤断言。两仓都过。
7. **桌面 UI（可选，不阻塞）**：`iPad 批注/` 自动出现在树里；可在「手机伴侣」面板加一行「最近回传」，不做也行。

---

## 6. 安全与边界

- **鉴权**：与同步端点同一套 device token / vaultFingerprint；新增端点不绕过。
- **路径**：客户端只传 `id`，不传路径；服务端用 `findKnowledgePage` 解析，再 `safePathInside` + 符号链接检查。
- **类型**：只收 PDF；扩展名 + 魔数双检；响应 `nosniff`。
- **大小**：200MB/文件；`Content-Length` 预检 + 流式计数双保险；超限即断。
- **写盘**：临时文件 + 原子 rename；失败清理；不在 vault 里留 `.tmp`。
- **不覆盖**：`iPad 批注/` 内重名加后缀；绝不写回原路径。
- **并发**：临时文件名带 uuid；同目标名并发靠 rename 前存在性检查 + 后缀循环兜底；如需更强，可加目录级队列。
- **限频（可选）**：大文件上传会占满局域网；可按设备限制同时 1 个上传，失败重试由手机端做。
- **CORS**：沿用现有 `Access-Control-Allow-Origin: *` + 放行 `authorization`；原生 FileTransfer 不受 CORS 约束，PWA 联调需要。

---

## 7. 兼容矩阵

| 组合 | 行为 |
|---|---|
| 新手机 + 旧桌面 | `/api/files/tree` 404 / ping 无 `features` → 手机隐藏文件区；笔记 / 同步零影响 |
| 旧手机 + 新桌面 | 新端点无人调用；旧功能零影响 |
| 新手机 + 新桌面 | 完整交接 / 回传 |
| 新桌面 + PWA 联调 | 三个端点可被 fetch；小文件可跑通 UI |
| 新桌面 + IPA | FileTransfer 直传，正式验收路径 |

---

## 8. 验收清单

- [ ] `GET /api/files/tree` 只返回 PDF；中文路径正常；空 vault 返回 `[]`；`移动端/**`、`.knowbase/**`、隐藏目录不出现。
- [ ] `GET /api/files/content?id=` 下载的 PDF 与磁盘 sha256 一致；100MB 大文件不爆内存；中文文件名 `Content-Disposition` 正确；非 PDF / 不存在返回 404；无令牌 401。
- [ ] `POST /api/files/upload` 的 PDF 落到 `iPad 批注/原名（批注）.pdf`；`?name=` 优先于 multipart filename；原文件 mtime/内容不变；重名生成 ` (2)`；中文名正常。
- [ ] 非 PDF 返回 415；>200MB 返回 413；空文件 400；中断上传后 `iPad 批注/` 无残留 `.tmp`。
- [ ] 上传成功后知识索引包含新文件、桌面树刷新、`markSelfWrite` 不弹「外部修改」。
- [ ] 路径 id 伪造 / 路径穿越 / 符号链接逃逸被拒（403/404）。
- [ ] 旧桌面 + 新手机：文件区隐藏，笔记/同步正常；旧手机 + 新桌面：无异常。
- [ ] PWA fetch 三个端点通过；IPA `FileTransfer` 下载/上传通过；Prodrafts 分享进出通过（与手机端联调）。
- [ ] 两仓契约脚本全过。

---

## 9. 明确不做（v1）

- 覆盖原文件、删除/改名、文件版本/回收站。
- 非 PDF 文件（后续按同一通道扩展）。
- Android 平板文件桥（后续）。
- 断点续传 / 分块 / 后台传输。
- 缩略图、应用内 PDF 预览/批注。
- 多 vault 同时访问（沿用单配对单仓）。
- Share Extension / iCloud 容器 / 云盘中转。

---

## 10. 手机侧对应实现（给桌面联调时对齐）

- 文件列表：`GET /api/files/tree`，按 `id` 下载；不把 PDF 混进 md 阅读器。
- 下载：`@capacitor/file-transfer@1.x` + `@capacitor/filesystem`，落 `Library/NoCloud/vault-files/`（不进 iCloud 备份）；分享用 `@capacitor/share` 的 `files`。
- 回传：Prodrafts 导出 PDF → 系统分享面板选 Phrontis（`CFBundleDocumentTypes`）或保存到 `Documents/导入/`；App 扫描到后提示「回传到电脑」。
- 上传：`FileTransfer.uploadFile` multipart 到 `/api/files/upload`；失败进 `pm.fileQueue`，联网重试。
- UI：文件面板内联回传卡（单文件）；回传收件箱全屏子页（多文件 + 历史）。原型见 `prototype/ipad-file-handoff.html`。
- 形态铁律：不用 bottom sheet；iPad 分屏落到手机断点时文件入口仍然保留（不按 `tablet` 宽度硬 gate）。

---

## 11. Phase 0 联调顺序（建议）

1. 桌面：起伴侣服务，vault 放一个中文名 PDF；curl 跑 tree / content / upload；确认 `iPad 批注/`、原文件、知识索引三者都对。
2. 桌面：用手机端 `FileTransfer.uploadFile` 的默认 multipart 打一次真实请求，确认字段名 / boundary / 文件名；不行再切 raw octet-stream。
3. 手机 IPA：下载 → `Share.share({ files })` → Prodrafts 导入 → 导出 PDF → 分享回 Phrontis / 存 Files → 上传。
4. PWA：同一套 UI + 三个端点的小文件联调；作为日常 UI 回路。
5. 全部通过后再批量落 UI 与文件树，避免 UI 做完才发现最后一公里不通。
