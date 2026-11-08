# 交接：组播发现 · 桌面应答端（手机伴侣）

> 2026-11-08 拍板（借鉴 LocalSend 的 UDP 组播发现，替代「经验网段扫段」这一唯一手段）。
> 手机侧（Android 原生插件 `PhrontisDiscover.java` + `discoverCompanions` 组播优先/扫段回退）已落地，
> **桌面侧缺一个 UDP 应答器**——本文是全部规格，照抄即可，预计 ~25 行。

## 为什么

- 手机 WebView 拿不到本机 IP，扫段只能按经验清单枚举 192.168.x 等 /24；电脑活在清单外
  （实测 `10.116.216.x`）就永远搜不到，且 App 重装清掉 localStorage 记忆后连自举都失效。
- 组播发现不猜网段：手机往组播组喊一声，加入了组的桌面单播应答，任意子网 <1s 命中。
- 本网络已实测组播可用（LocalSend 同机制工作正常）。

## 线路协议（冻结；2026-11-08 双组修订）

- 组播组 **`224.0.0.167`（主，LocalSend 同款链路本地组）+ `239.255.42.42`（过渡兼容旧手机 APK）**，端口 `8771`（UDP）。
  - **为什么换主组**：`224.0.0.0/24` 是链路本地控制块，RFC 4541 要求交换机/AP **无条件泛洪**；
    `239.0.0.0/8` 受 IGMP snooping 管控，常被整组静默丢弃。
  - **2026-11-08 A/B 实测（本机同网卡双组监听）**：手机 Phrontis ping（239 组）与手机 LocalSend
    开屏宣告（224 组）**双双零到达**——本网络 AP 对客户端发出的组播是**整类丢弃**，换组地址也救不了。
    **组播因此只是加速器**；手机侧真正的兜底是原生自知 IP（`PhrontisDiscover.selfIpv4`）→
    扫自己所在 /24（LocalSend 同款第二条腿，不依赖任何组播/广播）。桌面应答器两组都收（`joinGroup` 逐组逐接口）。
- 手机发 ping：**每组各 3 声、组间交错**（间隔 250ms，抗丢包）：UTF-8 文本 `PHRONDIS v1\n`。
- 桌面：加入组 → 收到 ping → **向来源地址单播**回一条 JSON（与 `GET /api/discover` 同构 + `port`）：

```json
{"ok":true,"protocol":1,"pc":{"name":"<电脑名>"},"port":8770,"pairing":["request","code"]}
```

- `port` = 伴侣 HTTP 服务实际端口（电脑端改端口时组播自动跟随，扫段路径做不到这点）。
- 手机只发不收组播（应答走单播），不需要 MulticastLock；桌面必须 `addMembership` 才收得到。
- 手机侧容错：应答 JSON 解析失败/`ok` 非 true 一律忽略并去重（按 `baseUrl`）。
- 兼容矩阵：新手机双组发 + 新桌面双组收 → 通；新手机 + 旧桌面（只收 239）→ 239 组通；
  旧手机（只发 239）+ 新桌面（双组收）→ 通。任何一格组播不通，都落扫段（新手机优先扫自知网段）。

## 桌面实现（Node，粘进 phoneCompanion 服务启动处）

```ts
import dgram from 'node:dgram'
import os from 'node:os'

/** 组播发现应答器：手机喊一声（PHRONDIS v1）→ 单播回发现负载（handoff-multicast-discovery-desktop.md） */
export function startDiscoverResponder(httpPort: number, pcName: string): void {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  socket.on('message', (msg, rinfo) => {
    if (msg.toString('utf8').trim() !== 'PHRONDIS v1') return
    const reply = Buffer.from(JSON.stringify({
      ok: true, protocol: 1,
      pc: { name: pcName },
      port: httpPort,
      pairing: ['request', 'code'],
    }))
    socket.send(reply, rinfo.port, rinfo.address)
  })
  socket.on('error', () => { /* 组播不可用的网络（AP 隔离等）：发现降级为扫段/手动，服务不受影响 */ })
  s.bind(8771, () => {
    for (const g of ['224.0.0.167', '239.255.42.42']) {
      try { socket.addMembership(g) } catch { /* 逐组尽力加 */ }
    }
  })
}
```

- 电脑名与 pairing 清单取现有 `deps.pcName()` / 配对能力，勿写死。
- 服务停止时 `socket.close()`（跟随伴侣服务的生命周期）。

## 防火墙（两台都要做一次）

- 电脑：**入站 UDP 8771 放行**——手机 ping 是入站（`sudo ufw allow 8771/udp`；Windows 防火墙同理放行 UDP 8771）。
- 手机：无操作（发送不需要组播权限）。

## 契约

- 手机端：`src/lib/sync.ts discoverCompanions`（组播优先/扫段回退）+ `PhrontisDiscover.java`。
- 桌面端落地后：本仓 `verify-sync.mjs` 可加断言（ping 文本 / 应答字段构型）；主仓契约脚本按需跟。
- iPad（SideStore 签名）拿不到组播权限，**不做 iOS 组播**——iPad 用扫码/手动配对一次自举
  （`rememberScanPrefix`），后续搜索走记忆网段扫段，已够用。
