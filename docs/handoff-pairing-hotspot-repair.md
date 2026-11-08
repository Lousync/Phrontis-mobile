# 交接文档：配对链路修复（手机流量 + 热点场景）

> **给谁**：下一轮手机端（`phrontis-mobile`）与桌面端（`Phrontis`）会话。
> **状态**：2026-11-08 诊断完成，**未落码**；本文是施工图，不是已实现说明。
> **基线**：手机仓 `30b601b`（0.8.5）/ 桌面仓 `51dd8d1`。
> **用户场景（原话）**：手机用流量、开着热点，让电脑连手机热点。
> **硬规则**：
> - 先改 `docs/design.md` 再动代码（协议增量才需要；本文标了“协议增量”的段落）。
> - 动原生层（`MainActivity.java` / `PhrontisDiscover.java`）**必须重新打包 APK**，旧包不会生效。
> - 两仓契约脚本都要过：本仓 `scripts/verify-sync.mjs` + 主仓 `.AGENT/scripts/phone-companion/verify-companion-protocol.mjs`。
> - `git push` 等用户明确指令；不要每改一处就打一个 APK。
> - 新增 UI 禁止底部抽屉；重新配对入口用设置卡内联展开或 `FullPage` 全屏子页。

---

## 0. TL;DR（先看这六条）

用户“配不上”不是单点故障，而是六层叠加；热点场景把每一层都触发了：

1. **桌面把 `172.18.0.1`（docker 网桥）当成手机可访问地址**，二维码/配对链接指向它；手机没有这条路由，必然失败。
2. **Android 原生发现插件从未注册成功**：`registerPlugin` 写在 `super.onCreate` 之后，Capacitor Bridge 已经建完；`isPluginAvailable('PhrontisDiscover')` 永远 false，组播和“自知本机网段”整条路是死的。
3. **就算插件生效，`selfIpv4()` 在“流量 + 热点”下拿到的是蜂窝网卡 IP，不是热点 AP 的 `192.168.43.1`**；而 JS 的 `COMMON_PREFIXES` 又没有 `192.168.43`，搜索永远扫不到电脑。
4. **配对成功后，启动探测失败一次就再也不重试**：没有离线重连循环，回前台也被 `onlineRef.current` 挡住，`toggleOnline` 根本没接到 UI；桌面晚于手机连上热点时，手机永远停在“离线”。
5. **桌面令牌/地址失效没有恢复入口**：桌面 `devices` 已被清空，手机还留着旧 token → ping 401 → 显示离线；401 文案被 `catch {}` 吞掉，已配对状态又隐藏了“搜索/扫码”，用户不知道要“解除配对”。
6. **原生请求超时是假的**：`CapacitorHttp` 的 fetch 补丁不传 `connectTimeout/readTimeout`、忽略 `AbortController`；只有 `lanFetch` 用了真原生超时。地址不对时“配对中…”可以无限转圈，而不是 6 秒报错。

修复顺序建议：**先修桌面地址选择 + 原生插件注册 + 热点前缀**（否则没有任何一条配对路能走通），再修**离线重连 + 401 重新配对**（否则配上了也像没配上），最后修**原生超时 + 配对码/二维码生命周期**。

---

## 1. 现场事实（2026-11-08 22:00 左右实测）

### 1.1 桌面服务与网络

- 桌面伴侣在跑：`0.0.0.0:8770`；`GET /api/discover` 正常返回：
  ```json
  {"ok":true,"protocol":1,"pc":{"name":"..."},"pairing":["request","code"]}
  ```
- UDP 8771 应答器正常：单播和组播 `PHRONDIS v1\n` 都能收到：
  ```json
  {"ok":true,"protocol":1,"pc":{"name":"..."},"port":8770,"pairing":["request","code"]}
  ```
- ufw 已放行：`8770:8789/tcp` + `8771/udp`（journal 里可见 21:13 的 `ufw allow`）。
- 当前网卡：
  - `wlp4s0` → `10.116.216.100`
  - `br-e105861832a4` → `172.18.0.1`（docker 网桥）
  - `docker0` 不存在，但 `br-...` 同样属于虚拟网桥。

### 1.2 桌面设备表

`~/.config/knowbase/data/phone-companion.json` 当前内容：

```json
{"devices":[],"notesStates":{"4264ffd4-33a0-4199-876b-84e15a89587e":{"cursor":1794137205242,"items":{}}}}
```

- **设备表为空**；
- 但 `notesStates` 里还留着一台设备的同步现场。

含义：这台设备曾经配对/同步过，后来桌面侧移除了（可能是面板“解除”或数据重置）。如果手机端还存着旧 `pm.companion` token，它现在每次 `/api/ping` 都是 401，但手机 UI 只会显示“离线”。

### 1.3 版本/构建

- 手机仓当前 `0.8.5`（`30b601b`），该提交只修了 `selfIpv4` 提前计算和组播 send 逐次吞异常；**没有修注册顺序、热点前缀、组播接口绑定**。
- `android/app/src/main/assets/public` 的产物是 21:34 构建的（0.8.4 时代）；如果手机装的是那个包，0.8.5 的 Java 改动也不在里面。
- 桌面仓当前 `51dd8d1`；`getLanAddresses`、配对面板、`status.urls` 均未修。

---

## 2. 用户会看到的失败路径

### 路径 A：搜索电脑（首选路径）

1. 手机开热点 + 流量，电脑连上热点，电脑 IP 是 `192.168.43.x`。
2. 手机设置 → 同步 → “搜索电脑”。
3. `originHintHost()` 在 APK 里是 `localhost`，探不到。
4. 原生插件不可用 → 没有组播、没有 `selfPrefix`。
5. `COMMON_PREFIXES` 没有 `192.168.43` → 扫的全是无关网段。
6. 扫段约 35-40 秒（10 段 × 254 地址 × 2 端口），最后提示“没搜到电脑（已扫 10 段 × 2 端口（本机段 拿不到））”。
7. 用户重试多次，体验 = “永远搜不到”。

### 路径 B：扫码 / 复制配对链接（兜底路径）

1. 桌面“手机伴侣”面板生成二维码/配对链接。
2. `getLanAddresses()` 返回 `['172.18.0.1', '192.168.43.x', ...]`（docker 网桥按接口名排最前）。
3. 面板只用 `urls[0]` → 二维码/链接 = `http://172.18.0.1:8770/pair#...`。
4. 手机扫码/粘贴 → `pairWith()` 请求 `172.18.0.1`，没有路由。
5. 原生 fetch 没有真超时 → “配对中…”无限转圈；用户以为 App 卡死。
6. 即使配对码过期，二维码仍然显示旧码（下面第 5 节），扫了必然 401。

### 路径 C：手动配对（没有暴露正确 IP）

1. 用户展开“手动配对”。
2. 面板只显示 `urls[0]` 的链接；正确地址 `192.168.43.x` 没有露出来。
3. 用户很难自己知道该填哪个 IP；只能去系统网络设置里找。
4. 配对码过期后，面板让点“换一个配对码”，但**过期分支里没有这个按钮**（第 5 节），只能关服务重开。
5. 所以“手动配对”也不是一条可用的兜底路。

### 路径 D：配对成功但一直离线

1. 手机 App 先打开，电脑后连热点（热点场景常态）。
2. 启动探测失败 → `online=false`。
3. 没有定时重试；回前台被 `onlineRef.current` 挡住；本地写不对账；“立即同步”直接 toast“电脑不在线”。
4. 只有杀掉 App 重开，才可能恢复。
5. 如果桌面 token 已被清空，重开也没用，因为 401 不会触发“重新配对”。

---

## 3. 根因总表

| 编号 | 严重度 | 现象 | 根因 | 主要位置 |
|---|---|---|---|---|
| A | **P0** | 二维码/链接连不上 | docker 网桥 `br-...` 未被识别为虚拟网卡；面板只用 `urls[0]` | 桌面 `electron/lib/lanShare/server.ts:32-49`；`phoneCompanion/index.ts:86-88`；`src/modules/toolbox/components/phone-companion/index.tsx:186-190,210-211` |
| B | **P0** | 搜索永远搜不到 | 原生插件注册在 `super.onCreate` 之后；`selfIpv4` 拿蜂窝 IP；`COMMON_PREFIXES` 无 `192.168.43` | `MainActivity.java:48-49`；`PhrontisDiscover.java:126-150`；`src/lib/sync.ts:176,292-313` |
| C | **P0** | 配对后永远离线 | 启动只 probe 一次；回前台/写操作/手动同步都被 `online` 挡住；`toggleOnline` 无 UI | `src/lib/store.tsx:501-511,623-627,689-710,752-777` |
| D | **P0** | 电脑不认设备却没有提示 | 401 与“离线”不分；driver/reconcile 的 `catch {}` 吞错；已配对隐藏搜索/扫码；无改地址/重新配对 | `src/lib/sync.ts:536-552,741-771`；`SettingsPage.tsx:184,262-292`；桌面 `phoneCompanion/index.ts:358-362` |
| E | **P1** | “配对中/同步中”无限转圈 | `CapacitorHttp` fetch 补丁不传 timeout、忽略 AbortController；只有 `lanFetch` 有真超时 | `src/lib/sync.ts:118-152,337-371,536-552,624-673,779-846`；依赖 `native-bridge.js` / `HttpRequestHandler.java` |
| F | **P1** | 码过期/作废后无法刷新；二维码是旧码 | `codeValid=false` 分支没有“换一个配对码”按钮；`status.urls` 仍嵌入过期码；QR 不隐藏 | 桌面 `phone-companion/index.tsx:193-227`；`phoneCompanion/index.ts:86-90` |
| G | **P1** | 过期确认请求一直挂在面板 | `purgePending` 只清内部 Map，不清 `state.pendingPairs`；过期后 `resolvePairRequest` 不 splice | 桌面 `phoneCompanion/server.ts:196-199`；`phoneCompanion/index.ts:100-112` |
| H | **P2** | 切仓库后可能写错仓 | v1.4 vault 绑定文档有、两端都没实现 | 设计 v1.4；`types.ts` `PairedDevice`；桌面 `CompanionDevice`/pair/ping/push/pull |

---

## 4. WP1：桌面端地址选择与配对二维码（P0）

### 4.1 目标

- 手机在热点/局域网里能用**它实际能路由到的那个桌面地址**配对。
- 面板不再只暴露一个地址；二维码使用“推荐/选中”的地址。
- docker、veth、VPN、link-local 等地址不被默认推荐。

### 4.2 现状代码

`Phrontis/electron/lib/lanShare/server.ts`：

```ts
const VIRTUAL_IFACE_RE = /vmware|virtualbox|vmnet|ve?thernet|wsl|hyper[- ]?v|radmin|tailscale|zerotier|wireguard|tun|tap|docker|loopback|virtual/i

export function getLanAddresses(): string[] {
  // 收集 private IPv4 → 按 (是否虚拟, 接口名) 排序 → 去重
}
```

问题：

- `br-e105861832a4`、`veth...` 不匹配该正则；
- `localeCompare` 让 `br-...` 排在 `wlp4s0` 前；
- 返回值被 `phoneCompanion/index.ts` 的 `status().urls` 直接使用；
- 面板只取 `urls[0]`。

### 4.3 具体改法

#### 第一步：提取纯函数（可契约直测）

新增 `Phrontis/electron/lib/lanShare/addresses.ts`（或 `server.ts` 导出纯函数）：

```ts
export interface LanAddressCandidate {
  iface: string
  addr: string
}

export interface LanAddressOptions {
  /** 默认路由出口 IP（非必须） */
  defaultIp?: string
  /** 最近一次手机请求的来源 IP（非必须，用于同网段优先） */
  clientIp?: string
}

export function isVirtualIface(name: string): boolean
export function orderLanAddresses(list: LanAddressCandidate[], opts?: LanAddressOptions): LanAddressCandidate[]
```

排序分数（越小越优先）：

1. 与 `clientIp` 同 /24（手机刚来过，几乎必然可达）；
2. `addr === defaultIp`（默认路由出口）；
3. 真实无线/有线网卡（`wlan*` / `wlp*` / `wifi*` / `en*` / `eth*`）；
4. 其他真实网卡；
5. 虚拟网卡（docker / br- / veth / vmnet / vbox / tun / tap / wg / tailscale / zerotier / virbr / cni / podman / flannel）；
6. link-local `169.254.*`；
7. 同分时：无线优先于有线，再按接口名。

虚拟网卡正则至少补：

```ts
/br-|veth|virbr|podman|cni|flannel|docker|vmnet|vboxnet|vmware|virtualbox|vethernet|wsl|hyper[- ]?v|radmin|tailscale|zerotier|wireguard|tun|tap|utun|awdl|llw/i
```

> 注意：不要因为 `br-` 可能误伤真实 bridge 就放弃；宁可把 bridge 排后，也不要让手机拿到 docker 地址。真实网桥场景极少，且会显示全部地址供用户选择。

#### 第二步：默认路由出口 IP（可选但建议）

Node 下可用 UDP connect 拿默认路由源地址（不会发包）：

```ts
function defaultRouteIp(): Promise<string | undefined> {
  return new Promise(resolve => {
    const s = dgram.createSocket('udp4')
    const done = (ip?: string): void => {
      try { s.close() } catch { /* 已关 */ }
      resolve(ip && ip !== '0.0.0.0' ? ip : undefined)
    }
    s.once('error', () => done())
    // 注意：connect 是异步的，不能在 connect 后同步 address()；必须等回调
    s.connect(53, '8.8.8.8', () => {
      try { done(s.address().address) } catch { done() }
    })
  })
}
```

注意：**默认路由不一定是手机能到的那个接口**（例如电脑同时插网线 + 连热点）。所以它只作为第二优先级；第一优先是“手机最近来源 IP 的同 /24”。

#### 第三步：记录最近手机来源网段

在伴侣服务里新增状态（内存即可）：

```ts
let lastClientIp: string | undefined
```

在以下入口更新：

- `GET /api/discover`（手机扫段/组播前置探测）；
- `POST /api/pair/request`；
- 已配对后的 `GET /api/ping` / push / pull（可选，用于持续修正）。

用手机来源 IP 推导手机所在 /24，再在 `getLanAddresses()` 中找同 /24 的本地地址，把它排到第一。热点场景下：

- 手机来源：`192.168.43.1`
- 电脑本地：`192.168.43.x`
- 同 /24 → 推荐 `192.168.43.x`，二维码正确。

#### 第四步：`status()` 输出

`electron/lib/phoneCompanion/index.ts` 的 `status()` 建议增补：

```ts
const candidates = getLanAddressDetails() // 不再只有 string[]
const ordered = orderLanAddresses(candidates, { defaultIp, clientIp: lastClientIp })
const urls = ordered.map(c => buildPairUrl(c.addr, state.port, validCode))
const recommendedUrl = urls[0]
```

其中：

```ts
const validCode = state.pairCode && state.pairCode.expiresAt > Date.now()
  ? state.pairCode.code
  : ''
```

**关键**：`urls` 里不要再用过期码。`urls` 可以带 `/pair#` 空 hash 或直接 `/pair`，但**绝不能嵌过期码**。

`CompanionStatus` 增补（保持向后兼容，全部 optional）：

```ts
urls: string[]                 // 全部可用地址，按推荐顺序
recommendedUrl?: string        // 给二维码/默认选中用
addresses?: Array<{ ip: string; iface: string; virtual: boolean; recommended: boolean }>
```

#### 第五步：面板 UI

`src/modules/toolbox/components/phone-companion/index.tsx`：

- 不再用 `status?.urls[0]` 作为唯一链接。
- 增加“手机可访问的地址”列表：
  - 每行显示 `192.168.43.x:8770` + 接口名；
  - 推荐项带“推荐”徽标；
  - 虚拟网卡行标“虚拟网卡，手机通常不可达”；
  - 点击某行 = 设为二维码/链接目标。
- 二维码使用“当前选中”的地址；默认选中 `recommendedUrl`。
- 如果没有有效配对码：
  - **隐藏或置灰二维码**；
  - 显示“配对码已过期/已使用，点此生成新码”；
  - 这个按钮在两个分支都要有（见第 5 节）。

### 4.4 验收

- 机器上有 docker `br-...` + Wi-Fi 时，面板推荐项不是 `172.18.x`。
- 手机开热点、电脑连热点时，手机第一次 `/api/discover` 后，面板推荐 `192.168.43.x`，二维码扫出来能直接配对。
- 电脑同时有以太网 + Wi-Fi 时，能看到两个地址；手机能选到热点那个。
- 纯函数契约：
  - `br-`/`veth` 排最后；
  - `clientIp` 同 /24 排第一；
  - `defaultIp` 排第二；
  - 重复地址去重。

---

## 5. WP2：Android 原生发现插件（P0）

### 5.1 目标

- 插件真的被 Capacitor 注册；
- “本机网段”返回**所有**可用私有 /24（尤其热点 AP 的 `192.168.43.0/24`），而不是蜂窝出口；
- 组播尽量从 AP/Wi-Fi 接口发；失败不影响扫段兜底；
- 旧 JS 仍兼容（保留 `selfPrefix`）。

### 5.2 注册顺序（一行位置，但必须装新包）

`android/app/src/main/java/com/lousync/phrontis/MainActivity.java` 当前：

```java
super.onCreate(savedInstanceState);
registerPlugin(PhrontisDiscover.class);
```

Capacitor 的 `BridgeActivity.onCreate()` 内部已经 `load()` 创建 Bridge；之后再 `registerPlugin` 只改 `bridgeBuilder`，**不会进入已创建的 Bridge**。因此：

```java
@Override
public void onCreate(Bundle savedInstanceState) {
    registerPlugin(PhrontisDiscover.class);   // 必须在 super 之前
    super.onCreate(savedInstanceState);
    applyOrientationPolicy();
    hookInsets();
}
```

验证方式（装新包后）：

- 原生日志/JS 里 `Capacitor.isPluginAvailable('PhrontisDiscover')` 应为 true；
- `discoverCompanions` 的 diag 应出现“组播命中”或“组播无应答 · 本机段 …”，不再是“本机段 拿不到”。

> 这一条不改，0.8.4/0.8.5 的 `selfIpv4` 改动全部无效，因为 JS 分支根本进不去。

### 5.3 `PhrontisDiscover` 返回多个本机前缀

当前只返回 `selfPrefix`（来自 `selfIpv4()` 的默认出口）。热点场景下默认出口是蜂窝，返回的是运营商 /24。

新增：

```java
private static List<String> selfPrefixes()
```

实现要求：

1. 枚举 `NetworkInterface.getNetworkInterfaces()`；
2. 跳过 `!isUp()`、loopback；
3. 跳过蜂窝接口名：`rmnet`、`ccmni`、`pdp`、`clat`、`v4-rmnet` 等；
4. 收集 `Inet4Address` 且 `isSiteLocalAddress()` 的地址；
5. 转 /24 前缀（`a.b.c`），去重；
6. 排序：
   - AP/热点常见接口名优先：`ap*`、`wlan*`、`swlan*`、`softap*`、`wifi*`；
   - 其次默认出口 IP 的前缀（`selfIpv4()`）；
   - 再次其他私有前缀。
7. 返回 `List<String>`。

返回负载：

```json
{
  "found": [...],
  "selfIp": "192.168.43.1",
  "selfPrefix": "192.168.43",
  "selfPrefixes": ["192.168.43", "10.116.216"]
}
```

- `selfPrefixes` 新字段；`selfPrefix` 保留 = `selfPrefixes[0]`，旧 JS 不受影响。
- `selfIpv4()` 保留，但只作为默认出口提示，不再作为唯一来源。

### 5.4 组播按接口发

当前 `new DatagramSocket()` 没有绑定接口；热点下走默认路由（蜂窝），电脑收不到。

建议：

- 枚举所有带 site-local IPv4 的接口；
- 对每个接口：
  - `MulticastSocket sock = new MulticastSocket()`；
  - `sock.setNetworkInterface(ni)`（`MulticastSocket` 的 API，minSdk 23 可用）；
  - 对 `GROUPS` 各发 `PING_COUNT` 声，间隔 250ms；
  - 接收单播应答，解析、按 `baseUrl` 去重；
- 任一接口失败只记日志，不影响其他接口和 `selfPrefixes` 回传；
- 如果没有可用接口，退化为当前的不绑定发送（保持旧行为）。

注意：

- `setNetworkInterface` 在部分 ROM 上可能抛异常，逐接口 `try/catch`；
- 组播只是加速器，**扫段必须仍然可用**；
- 不要因为组播失败让整个 `discover` reject（0.8.5 已改善 send，但多接口实现要继续保持）。

### 5.5 JS 侧接口

`src/lib/sync.ts` 的 `PhrontisDiscoverPlugin`：

```ts
discover(opts: { timeoutMs?: number }): Promise<{
  found: Array<{ baseUrl: string; pcName: string; protocol: number; canRequest: boolean }>
  selfIp?: string
  selfPrefix?: string
  selfPrefixes?: string[]
}>
```

`discoverCompanions`：

```ts
const prefixes = mergeScanPrefixes({
  selfPrefixes: r.selfPrefixes?.length ? r.selfPrefixes : (r.selfPrefix ? [r.selfPrefix] : []),
  remembered: scanPrefixes(),
  common: COMMON_PREFIXES,
})
```

详见 WP3。

### 5.6 契约/静态检查

- 本仓 `scripts/verify-sync.mjs` 增加：
  - `MainActivity.java` 中 `registerPlugin(PhrontisDiscover.class)` 出现在 `super.onCreate` 之前（正则/索引断言，防回归）；
  - `PhrontisDiscover.java` 含 `selfPrefixes` 输出、`setNetworkInterface` 或等价接口绑定、蜂窝接口过滤；
  - JS 接口接受 `selfPrefixes`。
- 桌面契约脚本 §9 可加：
  - 手机侧 `selfPrefixes` 字段存在；
  - 组播组/端口对表保持；
  - 不要求 Java 行为单测（原生难直测），以静态 + 真机验收为准。

### 5.7 真机验收

- 手机开热点 + 流量、电脑连热点：
  - 装新 APK；
  - `diag` 应显示本机段 `192.168.43`（或实际 AP 段）；
  - “搜索电脑”在 5-10 秒内找到电脑；
  - 组播日志（桌面）能看到来自 `192.168.43.1` 的 ping（如果网络没丢组播）。
- 手机普通 Wi-Fi：
  - `selfPrefixes` 包含 Wi-Fi 段；
  - 搜索能在 5 秒内找到。
- 手机只开流量、不开热点：
  - 不应把蜂窝 /24 扫很久；diag 应明确“本机段=蜂窝，不在局域网”。

---

## 6. WP3：JS 发现与扫段策略（P0/P1）

### 6.1 当前问题

`src/lib/sync.ts:176`：

```ts
const COMMON_PREFIXES = ['192.168.1', '192.168.0', '192.168.31', '192.168.3', '192.168.2', '192.168.50', '10.0.0', '10.0.1', '172.20.10']
```

- 缺 `192.168.43`（Android 热点）、`192.168.137`（Windows ICS）、`192.168.42/49`（部分 Android/旧热点）、`10.42.0`（Linux 热点）；
- `prefixes` 按顺序串行扫，每个前缀 254 地址 × 2 端口；找不到就一直扫完 10 段，约 35-40 秒；
- UI 写“约几秒”，没有进度/取消；
- 原生不可用时 `selfPrefix` 为空，只剩经验清单。

### 6.2 纯函数：合并前缀

新增（`sync.ts` 导出，契约直测）：

```ts
export function mergeScanPrefixes(input: {
  selfPrefixes: string[]
  remembered?: string | null
  common?: string[]
}): string[]
```

规则：

1. 只保留合法的 /24（`a.b.c`，0-255）；
2. 去重；
3. 顺序：
   - `selfPrefixes`（原生返回的 AP/Wi-Fi 段优先）；
   - `remembered`（上次成功配对的段）；
   - `common`（经验清单，含热点段）；
4. 如果 `selfPrefixes` 为空（iOS/旧插件/插件失败），仍使用 remembered + common；
5. 不要把明显无意义的段排前面；如果只有蜂窝 `selfPrefix`，可以保留但放最后（可选：识别 `100.64.0.0/10` CGNAT 并跳过）。

`COMMON_PREFIXES` 建议补齐：

```ts
[
  '192.168.43', '192.168.137', '192.168.42', '192.168.49',
  '192.168.1', '192.168.0', '192.168.31', '192.168.3', '192.168.2', '192.168.50',
  '10.0.0', '10.0.1', '10.42.0', '172.20.10',
]
```

### 6.3 全局扫描池（不要按前缀串行）

当前：`for (const prefix of prefixes) { ... await Promise.all(workers); if (found) return }`。

问题：正确段在最后时要等前面全部扫完。

建议：

- 把 `prefix × host × port` 展开成任务列表；
- 用**全局 worker 池**（Android 24 / iOS 6；每 worker 只做一个 host:port 探活，或保持每 worker 双端口的在途预算）；
- 交错调度（round-robin 前缀），保证每个前缀都在前几秒被覆盖；
- 总 deadline（建议 12-15 秒）到点停止调度，返回已找到的；
- 找到第一台后可停止调度（或留 300-500ms 宽限收其他电脑），避免无谓扫完；
- 提供进度回调：

```ts
discoverCompanions(opts?: {
  timeoutMs?: number
  concurrency?: number
  deadlineMs?: number
  onProgress?: (p: { scanned: number; total: number; found: DiscoveredPc[] }) => void
  signal?: AbortSignal
}): Promise<{ found: DiscoveredPc[]; diag: string }>
```

- `doDiscover` 显示“已扫 x/y · 发现 N 台”，并提供取消（离开页面/点取消）。
- 扫描超时/取消时返回部分结果 + diag，不要 reject。

### 6.4 端口策略

当前 `SCAN_PORTS = [8770, 8771]`，桌面端口漂移到 8772+ 就扫不到。

建议二选一（推荐同时做）：

1. **桌面端更稳地占住 8770**：
   - 增加首选端口重试窗口（例如 30 秒），避免 dev HMR 竞态把服务顶到 8771+；
   - 回退时写日志 + 面板显著提示实际端口；
   - 或持久化端口并在下次启动优先使用。
2. **手机端记住上次端口**：
   - 配对成功/发现成功时把端口存 `pm.lastScanPort`；
   - 扫段时把 `lastScanPort` 放最前；
   - 组播应答自带 `port`，组播路径不受影响；
   - 如果要做端口范围，最多加到 `[8770, 8771, 8772, 8773]`，不要 8770-8789 × 254 全扫（iOS/电池/时延都吃不消）。

### 6.5 `rememberScanPrefix`

- 保留现有行为（配对成功/扫码/手动成功记住 /24）；
- 另外记住端口（`pm.lastScanPort`）；
- 换网后如果记忆段不再可达，扫描应继续尝试 selfPrefixes/common，不要只信记忆；
- `scanPrefixes` 的格式守卫保留。

### 6.6 iOS

- iOS 没有 `PhrontisDiscover`；走 remembered + common；
- `172.20.10` 已覆盖 iPhone 热点；
- 并发保持 6（`CFNetwork` ENOMEM 红线）；
- 若要做 iOS 的“自知 IP”，需要另写 iOS 原生插件，不在本轮范围。

### 6.7 契约

本仓 `verify-sync.mjs` 增加：

- `mergeScanPrefixes`：
  - selfPrefixes 优先；
  - remembered 次之；
  - common 垫底；
  - 去重/非法值过滤；
  - 空 self 时仍返回 remembered+common。
- 热点前缀存在：`192.168.43`、`192.168.137`。
- 扫描池纯函数（如果抽出 `buildScanTargets`）：
  - 目标数量 = prefixes × 254 × ports；
  - round-robin 交错；
  - deadline 后停止。
- 不在真实网络里跑 5000 个请求；用注入的 fake probe。

---

## 7. WP4：手机离线重连（P0）

### 7.1 目标

配对 + App 前台时，无论电脑先开还是后开，手机都能自动连上；用户不需要杀 App。

### 7.2 当前行为

`src/lib/store.tsx`：

- 启动只 probe 一次（`752-761`）；
- 失败直接 return，没有定时器；
- `visibilitychange` 回前台：只有 `onlineRef.current === true` 才 reconcile（`767-777`）；
- `markPending` 只有 online 才防抖对账（`501-511`）；
- `runSync` 只有 online 才继续（`623-627`）；
- `toggleOnline` 有实现（`689-710`），但**没有任何 UI 调用**（grep 只有定义和 context 暴露）。

### 7.3 设计：连接监督器

新增一个“连接状态”，不要再用单个 `online` 布尔值同时表达“在线/离线/未启动”：

```ts
type ConnState = 'online' | 'offline' | 'auth' | 'paused'
```

- `online`：ping 200；
- `offline`：网络失败/超时；
- `auth`：ping 401（电脑不认识这个 token）；
- `paused`：用户手动暂停。

`syncMode` 继续表示实时/轮询/停止（RtDriver），与 `ConnState` 分离。**RtDriver 的 `onMode('off')` 不应直接把 `online` 置 false**（现在 `runSync` 一 `stop()` 就短暂显示离线）；在线状态由监督器/探测决定。

伪代码：

```ts
useEffect(() => {
  if (!paired || connState === 'paused') return
  let cancelled = false
  let timer: number | undefined
  let fails = 0

  const stop = () => { if (timer) clearTimeout(timer); timer = undefined }
  const schedule = () => {
    stop()
    timer = window.setTimeout(tick, nextProbeDelayMs(fails))
  }
  const tick = async () => {
    if (cancelled || document.hidden) return
    const r = await pingPaired(2500)   // lanRequest，真原生超时
    if (cancelled) return
    if (r === 'online') {
      fails = 0
      setConnState('online')
      await reconcileQuiet()           // 拉平积压
      rtRef.current?.maybeStart()
      return
    }
    if (r === 'auth') {
      setConnState('auth')
      rtRef.current?.stop()
      return
    }
    fails++
    setConnState('offline')
    schedule()
  }

  void tick()
  return () => { cancelled = true; stop() }
}, [paired, connState === 'paused'])
```

`nextProbeDelayMs`：1s / 2s / 5s / 10s / 15s 封顶（可加 ±20% 抖动），前台才跑，退后台停。

其他接线：

- **回前台**：无条件 `pingPaired`（不要看旧 `online`）；成功 → reconcile + `rt.maybeStart()`；失败 → 监督器继续。
- **启动**：配对就进监督器，不要只 probe 一次。
- **本地写** `markPending`：
  - 本地照常入队/落盘；
  - 如果 online：保持 800ms 防抖对账；
  - 如果 offline：`supervisor.poke()`（立即探测，但防抖，避免每个字符都探测）。
- **立即同步**：
  - 如果 offline/auth：先 ping 一次；online 再 sync；不要直接 toast“电脑不在线”。
  - 如果 auth：提示重新配对。
- **手动“重新连接”按钮**：调用 `supervisor.poke()` / 立即探测；`toggleOnline` 要么接到这个按钮，要么废弃。
- **UI 状态**：
  - online：已连接 · 实时/轮询；
  - offline：离线 · 正在自动重连（带“重新连接”按钮）；
  - auth：**电脑已不认识这台设备 · 重新配对**（红条，见 WP5）；
  - paused：已暂停同步。

### 7.4 RtDriver 的错误处理

当前 `RtDriver.loop` 的 `catch { ... }` 吞掉所有错误（`sync.ts:751-757`），导致 401、vault mismatch、超时都变成“离线”。

建议：

- `RtDeps` 增加 `onError?: (err: unknown) => void`；
- `catch` 里区分：
  - `AuthError` → 停止循环，交给监督器/UI 显示 auth；
  - 网络/超时 → 退避，继续；
- 不要把所有异常都静默。

### 7.5 验收

- 手机先开 App，电脑后连热点：≤ 15 秒内自动变“已连接”，无需重启 App。
- App 后台 1 分钟再回前台：立即探测并恢复。
- 飞行模式开关 5 次：不会重复配对/重复请求；恢复后自动重连。
- 桌面重启：手机按 1/2/5/10/15s 退避，恢复后无需人工。
- 手动“重新连接”按钮有效。
- 401 不被吞：显示重新配对。

---

## 8. WP5：401 / 令牌失效 / 地址变化 / 重新配对（P0）

### 8.1 目标

- 电脑侧删除了设备/换了 token 时，手机明确提示“重新配对”，而不是“离线”。
- 电脑 DHCP IP 变了时，手机能重新发现或手动改地址。
- 已配对状态也能进入搜索/扫码/手动配对，不再把入口藏死。

### 8.2 401 与离线分开

`probeOnline` 现在只返回 `res.ok`（`sync.ts:536-552`），401 与断网无法区分。

改为：

```ts
export type PingResult =
  | { state: 'online' }
  | { state: 'offline'; error?: string }
  | { state: 'auth'; error?: string }

export async function pingPaired(timeoutMs = 2500): Promise<PingResult>
```

- 200 → online；
- 401 → auth；
- 其他/网络/超时 → offline。

`pullOnce` / `syncNow` 的 401 也抛 `AuthError`（带 status=401），供上层识别。

### 8.3 已配对状态下的重新配对入口

`SettingsPage.tsx:184, 262-292` 当前：

- `!paired` 才显示“搜索电脑 / 扫码配对”；
- 已配对只显示“立即同步 / 解除配对”。

建议已配对卡片增加（内联展开，不要 bottom sheet）：

- **重新连接**：立即 ping 一次；
- **重新搜索电脑地址**：跑发现，列出同 `pcName` 的电脑；选中后更新 `paired.baseUrl`（保留 token），ping 验证；
- **重新配对 / 更换电脑**：展开搜索/扫码/手动配对；成功后替换 `paired`；
- **解除配对**：保留现有；
- 如果是 `auth` 状态：红条“电脑已不认识这台设备（可能在电脑端被移除）”，主按钮“重新配对”；不要自动清空本地数据。

重新配对时：

- 本地记账/日程/笔记/队列**不自动清空**；提示“本地数据会保留，首次同步会上行到新电脑”；
- 如果新电脑不是原来的仓库，需要 v1.4 vault 绑定（见 WP8）；在这之前至少提示风险。

### 8.4 自动修地址（可选但推荐）

当：

- 已配对；
- 监督器连续失败 N 次（例如 3 次）；
- 或 App 回前台且离线；
- 或用户点“重新搜索地址”；

跑一次轻量发现：

1. 用 selfPrefixes + remembered + lastScanPort，优先扫已知网段；
2. 找到候选 PC 后，按 `pcName` 过滤（如果有 `pcId` 更稳，见下）；
3. 对每个候选，用**现有 token** ping；
4. 200 → 更新 `baseUrl`，持久化，恢复在线；
5. 401 → auth，提示重新配对；
6. 没有候选 → 保持离线，继续退避。

注意：不要每次离线 1 秒就全量扫 254；用轻量发现 + 退避，避免耗电。

### 8.5 稳定电脑标识（可选）

`pcName` 可能重名/改名。建议桌面在配对响应/发现响应里加一个持久化的 `pcId`（例如 userData 里的 companion 实例 UUID），手机存 `PairedDevice.pcId`，重新发现时优先匹配 `pcId`，没有再用 `pcName`。

这是协议增量（`/api/discover`、`/api/pair`、`/api/pair/status` 响应加 `pc.id`）；如果做，先改 `docs/design.md` §2.2，再两端实现，旧桌面缺字段按 `pcName` 兼容。

### 8.6 真正的双向解除（建议）

现状：

- 桌面 `companionRevoke` 只删桌面设备表（`phoneCompanion/index.ts:358-362`）；
- 手机 `unpair` 只删本地（`sync.ts:154-156`）；
- 文档写的“双向清 token”没有实现。

建议新增（协议增量，先改 design）：

```
POST /api/unpair
Authorization: Bearer <deviceToken>
body: {}
→ { ok: true }
```

- 手机解除配对时先 best-effort 调它，再清本地；
- 桌面删除 token + notesState（文件保留；是否删 `notesStates` 需定：建议保留，重配对后新 deviceId 会重新建；旧 state 可定期清理）；
- 旧桌面 404 → 忽略，仍清本地；
- 桌面主动 revoke 仍无法实时通知手机；手机下次 ping 401 → auth 提示（这就是为什么 WP5 的 401 处理必须做）。

### 8.7 验收

- 桌面面板删除设备 → 手机下次 ping 显示“重新配对”（不是“离线”），点击可重新配对。
- 手机解除配对 → 桌面设备表少一台（如果端点已实现）。
- 电脑热点重连换了 IP → 手机自动/手动修地址后恢复；本地数据不丢。
- 已配对状态下能重新搜索/扫码，不再需要先“解除配对”。

---

## 9. WP6：原生请求超时 + 游标提交（P1）

### 9.1 问题

`capacitor.config.ts` 开了 `CapacitorHttp`，`window.fetch` 被原生补丁接管。补丁的行为（见 `node_modules/@capacitor/android/capacitor/src/main/assets/native-bridge.js`）：

- 调 `CapacitorHttp.request` 时**不传** `connectTimeout` / `readTimeout`；
- **忽略 `AbortController`**。

`HttpRequestHandler` 在 timeout 为 null 时不设置，`HttpURLConnection` 默认 0 = 无限等待。

项目里只有 `lanFetch`（`sync.ts:212-240`）显式传了原生超时。以下仍是普通 `fetch`：

- `pairWith`（125）
- `requestPair`（338）
- `pollPair`（354）
- `probeOnline`（542）
- `pullOnce`（636）
- `syncNow`（787）
- 笔记内容 API（475/494）

### 9.2 统一 `lanRequest`

建议把 `lanFetch` 升级为通用封装：

```ts
interface LanRequestOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  headers?: Record<string, string>
  timeoutMs: number
  /** 长轮询用：读超时 = wait + 余量；连接超时单独给 */
  connectTimeoutMs?: number
}

async function lanRequest(url: string, opts: LanRequestOptions): Promise<{ status: number; data: unknown }>
```

- 原生：`CapacitorHttp.request({ url, method, headers, data, connectTimeout, readTimeout })`；
- Web：`fetch` + `AbortController`；
- 解析 JSON 字符串；
- 抛出带 `status`/`kind` 的 `LanError`（timeout/network/http/auth）；
- 所有局域网端点改走它。

建议超时：

| 端点 | connect | read |
|---|---|---|
| `/api/discover` 探活 | 350-600ms | 350-600ms |
| `/api/pair` / `/api/pair/request` | 5s | 6s |
| `/api/pair/status` | 3s | 5s |
| `/api/ping` | 2.5s | 2.5s |
| `/api/sync/push` | 5s | 10s |
| `/api/sync/pull`（普通） | 5s | 10s |
| `/api/sync/pull`（wait=25s） | 5s | 35s |
| `/api/notes/tree` / `content` | 3s | 8s |

### 9.3 `pullOnce` 游标提交时机

当前 `pullOnce` 在返回前直接 `setLastSync`（`sync.ts:662-664`）；`RtDriver` 在 `await` 之后才做代数检查（`sync.ts:759`）。

后果：迟到的响应数据被丢弃，但游标已经推进 → 可能跳过未应用的变更。

建议：

- `pullOnce` **不再写 `setLastSync`**；
- `RtPullOutcome` 增加 `cursor: LastSyncCursor`；
- 调用方在“校验代数/应用数据”之后提交：
  - `RtDriver.loop`：`if (!alive(gen)) return; deps.apply(out); commitCursor(out.cursor)`；
  - `syncNow`/`reconcileQuiet`：应用 `applyRemote*`/墓碑之后再 `commitCursor`；
- 增加纯函数 `commitCursor(cursor)` 或 `applyPull(out)` 统一收口；
- 冲突全量重对（`sinceOverride`）也提交响应 cursor。

### 9.4 契约

本仓 `verify-sync.mjs`：

- 模拟 pull 响应 → 未调用 commit 前 `getLastSync()` 不变；
- 应用后 commit → 游标变化；
- 模拟迟到响应（旧代数）→ 数据不应用、游标不提交；
- `lanRequest` 的错误分类（可以用 fake `CapacitorHttp` 注入）。

### 9.5 AI 请求也要审计（相关）

`src/lib/ai.ts` 也走全局 `fetch`；`CapacitorHttp` 补丁同样让它的 `AbortController`/超时失效。虽然不属于配对，但建议同一轮或下一轮统一处理（至少给 AI 请求加原生 timeout），否则“停止生成”在真机上也可能停不下来。

---

## 10. WP7：桌面配对码 / 二维码 / 待确认请求（P1）

### 10.1 配对码过期后没有刷新按钮

`src/modules/toolbox/components/phone-companion/index.tsx:200-227`：

- `codeValid === true` 分支里有“换一个配对码”按钮；
- `codeValid === false` 分支只有文字“点击「换一个配对码」”，**没有按钮**。

修复：

- 把“换一个配对码”按钮移到两个分支之外，或两个分支都渲染；
- 文案改为“配对码已过期/已使用，点此生成新码”；
- 点击后 `companionNewPairCode()` → 刷新 status + QR。

### 10.2 过期码仍出现在 URL/二维码

`phoneCompanion/index.ts:86-90`：

```ts
const code = running ? state.pairCode : null
urls: ...buildPairUrl(ip, state.port, code?.code ?? '')
pairCode: code && code.expiresAt > Date.now() ? code.code : ''
```

`urls` 用了 `code?.code`，**不看 expiresAt**。所以码过期后：

- `pairCode` 空；
- `urls[0]` 仍带旧码；
- QR 仍显示（面板 `qr` 独立渲染，见 `193-197`）；
- 手机扫码 → 401。

修复：

- 只使用 `validCode` 生成 `urls`；
- `codeValid` 为 false 时**隐藏/置灰二维码**，显示“生成新码”；
- `qr` state 在 code 失效时清空（或 `refresh` 里判断 `!s.pairCode` 就 `setQr('')`）。

### 10.3 待确认请求过期不清理

- `server.ts:196-199` 的 `purgePending()` 只清服务内部 `pendingPairs` Map；
- `phoneCompanion/index.ts` 的 `state.pendingPairs` 是另一份，`status()` 每次都映射它；
- `resolvePairRequest` 在 `approve` 返回“请求已过期”时**不 splice**。

修复：

- `status()` 里按 `expiresAt > Date.now()` 过滤 `state.pendingPairs`；
- 或 `resolvePairRequest` 在过期/失败时也移除；
- 面板对已过期请求显示“已过期”并允许关闭；
- 这样诊断时留下的“诊断手机”测试请求也不会永久挂着。

### 10.4 桌面确认框只在面板打开时出现

`PhoneCompanion` 的 3 秒轮询只在组件挂载时跑（`index.tsx:33-38`）；用户不在“工具箱 → 手机伴侣”页面时，手机发起的请求只存在于主进程 `state.pendingPairs`，桌面没有任何提示。

修复建议：

- 渲染层监听 `companion:pairRequest` IPC（主进程已经 `broadcast`，见 `phoneCompanion/index.ts:126`），在全局壳层弹一个 toast/提示条“手机请求配对，点此查看”；
- 点击跳到工具箱 → 手机伴侣；
- 不要用 bottom sheet；用 toast + 跳转，或全屏 overlay；
- 如果没有 IPC 监听条件，至少在 app 壳层每 3 秒轮询 `companionStatus`（服务运行时），发现 `pendingPairs` 非空就显示角标/提示。

### 10.5 验收

- 码过期 → 面板有“生成新码”按钮；二维码不显示旧码。
- 配对成功后 → 面板能生成下一个新码（给第二台设备/重配对）。
- 过期请求不再永久挂卡片。
- 桌面不在手机伴侣页面时，手机发起请求，桌面能收到提示。

---

## 11. WP8：vault 绑定（P2，另开一轮）

design.md §2.1 v1.4 已经拍板，但两端都没实现。它不是当前“配不上”的原因，但会带来“配上了写错仓”的数据风险：

- `PairedDevice` / `CompanionDevice` 没有 `vault` 字段；
- `/api/pair`、`/api/ping`、push/pull 不携带 `vaultFingerprint`；
- 桌面切仓后，手机 push 会静默写进当前仓库。

建议不要塞进本轮配对修复（会把范围拖大）。单独一轮：

1. 协议：pair/ping/push/pull 加 `vault: { fingerprint, name }` / `vaultFingerprint`；
2. 桌面设备记录配对时的 vault 指纹；
3. 服务端 token + vaultFingerprint 双匹配；不匹配回 `vaultMismatch`；
4. 手机存 `paired.vault`；ping 检查；不一致红条“电脑当前仓库与配对仓库不符”；
5. “改配对到当前仓库”走桌面确认 + 双位码；
6. 两仓契约脚本补兼容矩阵。

---

## 12. 实施顺序与依赖

```text
第 1 批（没有这批，任何配对路径都不通）：
  WP1 桌面地址选择/二维码
  WP2 原生注册 + selfPrefixes + 热点前缀
  WP3 JS 合并前缀/扫描池

第 2 批（配上之后要能一直连）：
  WP4 离线重连监督器
  WP5 401/重新配对/地址修复

第 3 批（体验与稳定性）：
  WP6 原生超时 + 游标提交
  WP7 配对码/二维码/待确认请求 UX

第 4 批（独立拍板）：
  WP8 vault 绑定
```

依赖关系：

- WP1 和 WP2 可以并行（两个仓）。
- WP3 依赖 WP2 的 `selfPrefixes` 字段；可以先做兼容（旧插件只有 `selfPrefix`）。
- WP4 依赖 WP6 的 `lanRequest`（否则 ping 超时在原生上还是假的）；如果不想等，可以先用 `lanFetch` 的 ping 版本。
- WP5 依赖 WP4 的 `ConnState`/`pingPaired`。
- WP7 独立，桌面仓可并行。

---

## 13. 端到端验收清单（真机）

### 13.1 热点主场景

- [ ] 手机开流量 + 热点，电脑连热点（电脑 IP `192.168.43.x`）。
- [ ] 桌面面板推荐地址是 `192.168.43.x`，不是 `172.18.x`。
- [ ] 手机“搜索电脑”≤ 10 秒找到电脑；diag 有“本机段 192.168.43”。
- [ ] 点电脑 → 桌面弹 4 位码（面板打开）→ 两端一致 → 允许 → 手机配对成功。
- [ ] 配对后设置卡显示“已连接 · 实时”。
- [ ] 手机新建笔记 → 桌面 `移动端/<设备名>/` 出现文件。
- [ ] 桌面改该文件 → 手机 <1 秒更新。
- [ ] 手机退后台 1 分钟 → 回前台自动恢复，不重复请求。
- [ ] 桌面杀掉重开 → 手机 1/2/5/10/15s 退避后自动恢复。
- [ ] 电脑热点重连换 IP → 手机自动修地址或“重新搜索地址”后恢复。
- [ ] 桌面面板删除设备 → 手机显示“重新配对”，不是“离线”。

### 13.2 配对码/二维码

- [ ] 配对码过期 → 面板出现“生成新码”按钮。
- [ ] 过期状态下二维码隐藏/置灰，不显示旧码。
- [ ] 生成新码后二维码更新，扫码可配对。
- [ ] 配对成功后还能生成下一台设备的新码。
- [ ] 过期确认请求自动消失；点允许不会永久挂卡片。

### 13.3 多网卡/虚拟网卡

- [ ] 电脑有 docker `br-...` + Wi-Fi：推荐 Wi-Fi，不推荐 `172.18.x`。
- [ ] 电脑有 Ethernet + Wi-Fi：两个地址都显示，手机能选热点/同网段那个。
- [ ] 地址列表标注虚拟网卡；二维码默认不用虚拟网卡。

### 13.4 兼容矩阵

- [ ] 新手机 + 新桌面：全功能。
- [ ] 新手机 + 旧桌面（无 `selfPrefixes` / 旧码逻辑）：回退 `selfPrefix` + 扫段，配对/同步不崩。
- [ ] 旧 APK（0.8.4/0.8.5）+ 新桌面：不因新字段崩溃；旧问题仍存在但不新增回归。
- [ ] iOS 热点（`172.20.10.x`）：无原生插件时靠 common 扫描能发现。
- [ ] 手机只开流量不开热点：不扫蜂窝 254 个地址很久；提示“当前不在局域网”。

### 13.5 网络层

- [ ] 手机浏览器能打开 `http://<电脑IP>:8770/api/discover`。
- [ ] 电脑 `ss -lntp | grep 8770` 是 `0.0.0.0:8770`。
- [ ] ufw 放行 `8770:8789/tcp` + `8771/udp`。
- [ ] 热点没有客户端隔离/AP 隔离（如果浏览器都打不开，先处理网络，不要继续改业务代码）。

---

## 14. 契约与测试改动（两仓）

### 14.1 本仓 `scripts/verify-sync.mjs`

建议新增：

1. `mergeScanPrefixes` 纯函数：
   - selfPrefixes 优先；
   - remembered 次之；
   - common 垫底；
   - 去重/非法过滤。
2. 热点前缀存在：`192.168.43`、`192.168.137`。
3. `MainActivity.java` 注册顺序：
   - `registerPlugin(PhrontisDiscover.class)` 的索引 < `super.onCreate` 的索引；
   - 防回归。
4. `PhrontisDiscover.java`：
   - 含 `selfPrefixes`；
   - 含接口绑定（`setNetworkInterface` / `IP_MULTICAST_IF`）；
   - 含蜂窝接口过滤。
5. `pingPaired` / `AuthError` 分类（可用注入 fake lanRequest）。
6. `pullOnce` 不再直接写游标；commit 只在应用后调用。
7. 兼容矩阵：旧响应无 `selfPrefixes`/`waitSupported` 等字段不崩。

### 14.2 主仓 `.AGENT/scripts/phone-companion/verify-companion-protocol.mjs`

建议新增：

1. `orderLanAddresses` 纯函数：
   - `br-...`/`veth` 排最后；
   - `clientIp` 同 /24 最前；
   - `defaultIp` 次之；
   - 去重。
2. `status.urls` 不包含过期码（纯 view builder 直测）。
3. 过期 pair request 不出现在 `pendingPairs`。
4. 可选：`/api/unpair` 端点契约（如果本轮做）。
5. §9 更新：
   - 手机侧 `selfPrefixes`/`setNetworkInterface` 静态断言；
   - 组播双组/端口保持。

> 两仓脚本都要过是仓规；不要只改一边。

---

## 15. 风险与回滚

| 风险 | 处理 |
|---|---|
| 改 `registerPlugin` 顺序影响其他插件 | 只注册自定义插件；装新包后验证剪贴板/通知仍正常 |
| 扫所有接口/所有前缀耗电/时延 | 前台才扫；12-15s 总 deadline；AP/Wi-Fi 段优先；找到即停 |
| 多接口组播在部分 ROM 抛异常 | 逐接口 try/catch；失败落扫段；不影响服务 |
| 自动修地址误连到同名电脑 | 先用现有 token ping，401/失败不更新；有 `pcId` 优先 |
| 401 自动清 token 丢配对 | **不要自动清**；显示 auth 状态，让用户点重新配对 |
| 游标提交时机改动引入漏拉/重拉 | 纯函数 + 契约测试；先提交后应用的回滚路径要明确 |
| 显示全部地址让用户困惑 | 标“推荐”，虚拟网卡标“不可达”；默认选推荐 |
| 旧桌面/旧 APK 兼容 | 新字段全部 optional；旧响应缺字段按旧逻辑 |

回滚：

- 桌面地址选择/面板改动可单独 revert；
- 原生插件改动必须重新装旧 APK 才能回滚；
- 协议增量（`/api/unpair`、`pcId`、vault）单独提交，便于按需 revert。

---

## 16. 构建与发版

- **原生改动必须装新包**：
  - `npm run build`（或 `tsc --noEmit && vite build`）；
  - `node scripts/sync-android.mjs`；
  - `cd android && JAVA_HOME=/home/lousync/develp/jdk-21.0.13+9 ./gradlew assembleDebug`；
  - 不要依赖 `npm run android:apk` 的 Windows `gradlew.bat` 写法。
- 桌面改动：重启 Electron dev / 伴侣服务；确认 8770 没被旧进程占用。
- 版本：
  - 纯修复 z+1（当前 0.8.5 → 0.8.6）；
  - 如果新增“重新配对/改地址/双向解除”算新功能，可 y+1（0.9.0）；由用户拍板。
- 发版前：
  - 两仓契约脚本全过；
  - 热点真机验收清单跑完；
  - 不要把“测试请求”留在桌面 pending 列表（或确认已拒绝）。

---

## 17. 现在就能用的临时绕过（给用户）

在代码修好前，按这个顺序可以尽量配对成功：

1. 电脑连上手机热点后，在电脑上查热点 IP：
   ```bash
   ip -4 addr show wlp4s0
   # 或
   hostname -I
   ```
   找 `192.168.43.x` 那个，**不要用 172.18.x / 172.17.x**。
2. 桌面面板如果配对码过期且没有“换一个配对码”按钮：**关闭服务 → 重新开启服务**，会生成新码。
3. 手机如果显示“已配对”但桌面“已配对设备”为空：先在手机点“解除配对”，否则搜索/扫码入口不显示。
4. 手机：设置 → 同步 → 手动配对，输入 `<192.168.43.x>:8770` + 新的 8 位码。  
   保持桌面“手机伴侣”面板打开（如果用 4 位确认流程）。
5. 验证网络：手机浏览器打开
   ```
   http://<192.168.43.x>:8770/api/discover
   ```
   能返回 JSON = 网络通，问题在 App 地址/发现；打不开 = 热点隔离/防火墙/不同网段。
6. 手动配对成功一次后，手机会记住 `192.168.43` 网段；下次“搜索电脑”会先扫它（在发现逻辑修好前，这是最接近自动发现的办法）。

---

## 18. 附录：关键代码现场（便于下一轮定位）

### 18.1 桌面地址排序

`Phrontis/electron/lib/lanShare/server.ts:32-49`：`VIRTUAL_IFACE_RE` 不含 `br-`/`veth`；按接口名排序。

### 18.2 桌面二维码取 `urls[0]`

`src/modules/toolbox/components/phone-companion/index.tsx:40, 75-77, 186-190, 210-211`。

### 18.3 桌面码过期分支无按钮

同文件 `200-227`。

### 18.4 桌面 `status.urls` 带过期码

`electron/lib/phoneCompanion/index.ts:86-90`。

### 18.5 原生注册顺序

`android/app/src/main/java/com/lousync/phrontis/MainActivity.java:48-49`（super 在前）。

### 18.6 手机常识网段

`src/lib/sync.ts:176`。

### 18.7 手机启动只 probe 一次 / 回前台被 online 挡住

`src/lib/store.tsx:501-511, 623-627, 689-710, 752-777`。

### 18.8 原生 fetch 超时

- `node_modules/@capacitor/android/capacitor/src/main/assets/native-bridge.js` 的 fetch patch；
- `HttpRequestHandler.java` 的 `connectTimeout/readTimeout` 为 null 时不设置；
- 本仓只有 `lanFetch`（`src/lib/sync.ts:212-240`）显式传。

---

## 19. 诊断时留下的测试请求

本次探查向桌面 `/api/pair/request` 发过一条：

- `deviceName`: `诊断手机`
- `code`: `6850`

桌面 `state.pendingPairs` 不会自动清理（WP7 的问题）。如果面板里还看到它，**点“拒绝”即可**，不要点“允许”；不会影响数据。

---

## 20. 最小可交付定义（本轮做完算完成）

- [ ] 热点下“搜索电脑”能找到电脑（不再依赖用户手动输入 IP）。
- [ ] 桌面二维码/链接不再出现 `172.18.x`，推荐地址是手机可达的。
- [ ] 配对成功后，电脑晚开/重启/换 IP 都能自动或一键恢复。
- [ ] 桌面删除设备/手机换 token 时，手机明确提示“重新配对”，不是无限“离线”。
- [ ] 配对码过期后能在面板生成新码；二维码不显示旧码。
- [ ] 两仓契约脚本通过；热点真机验收清单通过。

达到这六条，再谈 vault 绑定和更细的 UI 打磨。
