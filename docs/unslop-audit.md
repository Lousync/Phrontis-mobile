# Phrontis Mobile UI 去 AI 味审计报告（unslop）

> 2026-11-07 · 用 [unslop skill](https://github.com/heydamir/unslop)（heydamir，CC BY 4.0）对本 app 做的界面审计与美化执行方案。
> **状态：已执行完毕（2026-11-07）**——§4 清单全部落地，`typecheck` + `vite build` 通过，深/浅主题逐屏截图复检无回归。改动未提交，等用户验收。
> 取证方式：`npm run dev` + 浏览器 390×844 竖屏视口逐屏截图（AI/日程/记账/笔记/设置/用量/主题抽屉/记一笔键盘，深色+浅色），980×1100 平板形态补拍；`src/` 源码全文 + 文案/动效模式扫描交叉验证。

---

## 1. 总评

**轻-中度 slop，走「打磨模式」（polish mode），不重设计。**

App 已有一套真实设计体系：VS Code 深色基因、语义令牌（7 套主题）、线性图标、真实 mock 数据、备忘录式页头 + 玻璃浮坞的身份特征。重度 AI 味症状（紫色渐变、发光标题、emoji 满屏、假数据、营销腔）均不存在。问题集中在**没拍板的细节**：字重系统、彩色阴影、少量 emoji 图标、间距/圆角无刻度、过渡写法。

## 2. 审计发现（按 signs.md 分组，带定位）

### 2.1 Type（最重的一组）

| 问题 | 定位 | 现值 → 目标 |
|---|---|---|
| 页头大标题过重 + 加字距 | `index.css:220`（`.pg-head .t`） | `26px/700/.3px` → `500/0` |
| 收拢小顶栏标题过重 | `index.css:247`（`.c-bar .c-t`） | `15px/700` → `500` |
| 记一笔金额过重 | `index.css:721`（`.amt-display .num`） | `40px/700` → `600`（数字可留 600 作强调） |
| 统计值过重 | `index.css:482`（`.stat .val`） | `19px/700` → `600` |
| 错题书架统计 `b` 默认 700 | `index.css:1246`（`.quiz-stats .qs b`） | → `600` |
| 书名/题干过重 | `index.css:1257`（`.qb-title`）、`index.css:1298`（`.qc-q`） | `700` → `600` |
| 进度环数字 700 | `index.css:319`（`.todo-ring .rtx`） | `9px/700` → `500` |
| 小标签宽字距 | `.sec-title`/`.set-label`/`.group-head`/`.mp-g`（`index.css:288,737,352,847`） | `letter-spacing:1px` → `0.02em 或 0` |

原则（tokens.md）：层级靠字号与颜色，不靠加粗；权重主线 400/500，600 只留给少数强调；<16px 字距归零。

### 2.2 Icons

| 问题 | 定位 | 处置 |
|---|---|---|
| 子任务计数用 emoji ☑ | `SchedulePage.tsx:75`（`.sub-chip`） | 换线性 check 图标或纯文本 `3/5` |
| 置顶会话用 📌 前缀 | `TabletChrome.tsx:70` | 换 pin 线性图标或静音文本「置顶」 |
| 清除按钮用文本 ✕ | `ModelPicker.tsx:95` | 换现成的 `IX` 图标 |
| AI 全线 sparkle 星形 | `icons.tsx:22`（ISparkle）：坞页签、DeepSeek tile、AI 配置 | **待用户拍板**（已是识别符号；默认保留） |

### 2.3 Color

| 问题 | 定位 | 处置 |
|---|---|---|
| FAB 彩色光晕投影 | `index.css:503`（`rgba(0,122,204,.4)`） | 换中性投影 `0 10px 26px rgba(0,0,0,.25)` 一档 |
| 记账分类头像四行四色 | `index.css:488`（`.tx-ico`）+ LedgerPage 传色 | 保留分类色块但统一降饱和（12% 底 + 深字），或改单色 ramp 步进（待定） |
| 用量按模型图表 蓝+紫条 | UsagePage 模型条色 | 紫条换成 ramp 步进或主题 accent 系；一行内一强调色 |
| 设置页 accent 摊薄（6+ 处） | `SettingsPage` 各 tile/btn | 保留主按钮 accent，icon tile 降为中性（muted 图标 + 无底色），accent 只留主操作 |
| 浏览器默认黄色 focus 描边 | 浮坞按钮（截图实测） | 全局定义 `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }` |

### 2.4 Spacing / Details

| 问题 | 定位 | 处置 |
|---|---|---|
| 非 4px 网格随手值 | `.todo-item` padding `13px 4px`（`index.css:361`）、`.tx-item` `11px 4px`（`index.css:486`）、`.gblock` `4px 9px`（`index.css:415`） | 归 12/12、4px 步进 |
| 圆角散布 12 种（9~26） | 全 CSS | 归刻度：控件 8/10、卡 12/14、面板 16/20、浮坞 24 |
| 日程时间双芯片冗余 | SchedulePage 待办行 `14:00` + `14:00-15:30` | 区间覆盖起点时只留区间 |

### 2.5 Motion

| 问题 | 定位 | 处置 |
|---|---|---|
| `transition: all` 散布 | `.chip`（290）/`.view-seg button`（348）/`.todo-check`（367）/`.habit-btn`（445）/`.hdot`（435） | 改具名属性（color/background/border/opacity/transform） |
| 回弹曲线两处 | `.toast` `cubic-bezier(.2,.9,.3,1.2)`（975）、`.theme-chip .tick` `(.34,1.56,.64,1)`（895） | 统一 `cubic-bezier(0.22,1,0.36,1)` |
| 真实状态动效（保留 ✔） | 麦克风脉冲、流式光标、同步点 pulse、扫码线 | 不动 |

### 2.6 Copy（无需修 ✔）

无感叹号、无 hype 词、无虚假声明；空态文案有性格（「夜深了。手机端就我一个 AI…」）。「问点什么…」占位符有语气但属品牌声音，保留。

## 3. 设计方向（五行）

| 维度 | 定调 |
|---|---|
| 产品 | Phrontis Mobile —— 电脑的随身半边：手机随手记（AI/日程/记账/笔记），连上电脑深加工 |
| 性格 | 安静、利落、带一点纸面温度（工具感优先） |
| 世界 | 墨水与纸面 + 编辑器夜色：深色石墨底、浅色/四季主题纸面色温，中性面板永远安静 |
| 时刻 | 色彩只给内容时刻：账目大数字（tabular + 收/支语义色）、日程勾选粒子反馈；chrome 退后 |
| 签名 | 备忘录式大标题页头 + 浮动玻璃坞 —— 已有身份，打磨不替换 |

## 4. 执行清单（九轮 pass → 本仓映射）—— ✅ 已全部执行

实际落地情况（2026-11-07）：

1. ✅ **Spacing**：`.todo-item`/`.tx-item` 12px、`.gblock` 4px 8px（`index.css`）
2. ✅ **Color**：FAB 中性影、设置 `.device-ico`/`.tool-ico` 转中性（bg-tertiary + 次级色图标）、全局 `:focus-visible` accent 环、用量页按模型条「一图一强调」（lead 模型 accent，其余 `--border` 中性阶，硬编码紫 `#b180d7` 删除）
3. ✅ **Icons**：☑→`ICheck` 线性勾、📌→新增 `IPin` 线性图钉、✕→`IX`（`SchedulePage`/`TabletChrome`+`icons.tsx`/`ModelPicker`）
4. ✅ **Copy**：无改动（保留现有语气）
5. ✅ **Type**：页头 500/去字距、小顶栏 500、金额 600、统计 600、环数字 500、书架/题干 600；四处小标签字距 1px→.02em
6. ✅ **Layout**：排期区间覆盖起点时不再重复裸时间芯片（`fmtMin(t.sched.s) === t.time` 判定）
7. ✅ **Details**：圆角归刻度 9→8 / 11→10 / 13→12 / 22→20（壳层 26、浮坞 24+18、胶囊类按设计保留）
8. ✅ **Visuals**：app 内不加生成图 ✔ 无改动
9. ✅ **Motion**：7 处 `transition: all` 全部具名化；`toastIn`/`tickIn` 回弹曲线统一为 `cubic-bezier(0.22,1,0.36,1)`

**两项待拍板的最终决策**：记账分类头像块（四色）**保留**——读码确认其已是 13% 降饱和 + 分类语义色，与 app `.tag` 体系同构，符合「色彩给内容时刻」的方向；sparkle 图标**保留**（用户未选换除）。

## 5. 验证方案 —— ✅ 已执行

- `npm run typecheck` ✔、`npm run build` ✔（1.34s，无警告）
- 浏览器 390×844 逐屏复检截图：深色（日程/记账/设置/用量）+ 浅色（记账）改前后对比，均无回归；主题状态已复位深色
- 不涉及原生层，**无需打 APK**（纯 CSS + 3 个 tsx 组件 + icons.tsx）

## 6. 边界（本次不动）

- `Sheet.tsx` 及其调用点：历史遗留，只减不增，不在本轮改造
- 不碰 `MainActivity.java` / `AndroidManifest.xml` / `capacitor.config.ts`
- 不动竖屏/平板布局分支逻辑（`useFormFactor`）
- 文案语气整体保留
- sparkle 图标去留：默认保留，用户可随时改主意

## 7. 环境顺手修复（已落，非 UI 改动）

- `vite.config.ts`：`server.watch.ignored` 增加 `android/`、`dist/` —— Gradle 后台写 build 报告会触发 dev 整页刷新打断浏览器验证（2026-11-07 实测踩坑）

---
*审计方法与标准来自 unslop by Damir Sokolovsky（[@heydamir](https://x.com/heydamir)），CC BY 4.0。*
