# 交接：主仓 `publish-release.py --platform mobile`（手机版发布侧收编）

> 2026-11-09 · 手机端应用内更新已落地（`docs/design.md` §7.1，修订表同日条目），
> 手机侧产物两件套已可自产；本仓的发布动作暂由手动 `gh release create` 承担，
> 按本交接把发布门禁收编进主仓脚本，与本仓解耦。**本仓会话不动主仓脚本。**

## 目标

主仓 `scripts/publish-release.py` 的 `--platform` 增加第四个值 `mobile`（现 choices：`auto|win|linux`），
复用既有门禁哲学与 `gh release create` 通道，发布手机版两件套。

## 两件套契约（§7.1 冻结）

产物目录（手机仓 `packs/<ver>[-N]/`，`--dir` 指过去）内必须**同时**存在：

| 文件 | 说明 |
|---|---|
| `Phrontis-mobile-<ver>.apk` | 安装包（assembleDebug 产物改名） |
| `mobile-latest.json` | 更新元数据，字段：`version` / `apk`（文件名）/ `sha256`（hex）/ `size`（字节）/ `notes` / `mobileCommit`（手机仓 commit，溯源用）/ `publishedAt` |

**门禁（对齐桌面三件套门 1/2/3 的哲学，v2.13.0 事故同款防线）**：

1. 两件缺一即拒（`mobile-latest.json` 缺失 = 手机端检查直接报「发布侧两件套不全」）；
2. `sha256` / `size` 与 APK **实测一致**才准上传（重新读文件算，不信任 manifest 自述——桌面「重新打包使元数据与产物匹配」同款口径）；
3. `manifest.version` 与 `--version` 参数一致；`manifest.apk` 文件名必须能在产物目录里找到对应 APK；
4. tag 规则：`v<ver>-mobile`，**钉在主仓 HEAD**（发版事件 commit）——与桌面双 tag 的「同 commit」交叉校验（决策 #10）**不适用**：手机代码在另一个仓（`Lousync/Phrontis-mobile`），溯源走 manifest 的 `mobileCommit` 字段；
5. `check_counterpart_tag` 对 mobile 不做（无 counterpart tag 可查）。

## 发布命令形态

```
python scripts/publish-release.py --version 0.11.0 --platform mobile \
    --dir <手机仓绝对路径>/packs/0.11.0 --notes-file notes.md
```

实现上等价于：

```
gh release create v0.11.0-mobile -R Lousync/Phrontis \
    --title "Phrontis Mobile v0.11.0" --notes-file notes.md \
    <dir>/Phrontis-mobile-0.11.0.apk <dir>/mobile-latest.json
```

## 手机仓侧现状（主仓会话需要知道的）

- 手机仓产物由未来的 `scripts/pack-mobile.mjs` 产出（build → sync → `gradlew assembleDebug` → 改名落 `packs/<ver>[-N]/` → 算 sha256/size 写 manifest → 自校验门禁）；**该脚本尚未落**（用户暂缓打包），落码前发布走手动两步：
  ```
  cp android/app/build/outputs/apk/debug/app-debug.apk packs/0.11.0/Phrontis-mobile-0.11.0.apk
  # sha256 与 size 手算，mobile-latest.json 手写（字段见上表）
  ```
- 手机端检查链路（`src/lib/update.ts`）对发布物的全部要求：`releases?per_page=30` 里 tag 以 `-mobile` 结尾、资产含 `mobile-latest.json` 且其中 `apk` 字段指向同名 APK 资产、`version/sha256/size` 可校验——**两件套不齐手机端会显式报「发布侧两件套不全」，不会静默**。
- 版本线：手机 `0.x` 独立于桌面 `3.x`；versionCode = `major*10000+minor*100+patch`（build.gradle 派生，只增不减），发布前手机仓 `package.json` 的 `version` 必须已抬。

## 验收清单（主仓侧做完后）

1. `--platform mobile` 对缺 manifest / sha256 不符 / version 不符三种坏目录全部拒绝，报错信息指名缺什么；
2. 正常目录 dry-run（`gh release view` 前打断）打印的资产清单 = 两件套；
3. 发一个真实 `vX.Y.Z-mobile` 后，手机端「检查更新」能发现并完成下载校验（真机，手机侧已具备能力）。
