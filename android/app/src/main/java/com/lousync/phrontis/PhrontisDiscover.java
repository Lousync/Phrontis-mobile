package com.lousync.phrontis;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.Inet4Address;
import java.net.InterfaceAddress;
import java.net.MulticastSocket;
import java.net.NetworkInterface;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

/**
 * 组播发现 + 自知网段（2026-11-08，借鉴 LocalSend 的 UDP 发现，替代「经验网段扫段」这一唯一手段）。
 *
 * 为什么必须写在原生层：WebView 拿不到 UDP 套接字，也拿不到本机 IP——JS 扫段只能按
 * 经验清单枚举 192.168.x 等网段，电脑活在清单外（实测 10.116.216.x）就永远搜不到，
 * 且 App 重装清掉 localStorage 记忆后连自举都没了。原生层两件事：
 *   ① 组播：按接口发（热点场景默认路由在蜂窝，不绑接口的组播永远到不了电脑）——
 *      枚举非蜂窝、带站点内 IPv4 的接口，每个接口独立 MulticastSocket + setNetworkInterface，
 *      向双组各发 PING_COUNT 声；桌面（加入了组的伴侣服务）单播应答，任一接口命中即得。
 *   ② 自知网段：selfPrefixes = 上述接口的全部 /24（热点 AP 的 192.168.43.x/随机段排最前）——
 *      JS 扫段回退优先扫这些段（LocalSend 同款第二条腿，不依赖组播通不通）；
 *      蜂窝接口（rmnet/ccmni/pdp/clat）整类过滤，流量出口的运营商段不进扫描清单。
 *
 * 线路（与 docs/handoff-multicast-discovery-desktop.md 冻结一致，2026-11-08 双组修订）：
 *   手机 → 组播组 224.0.0.167:8771 与 239.255.42.42:8771 各 PING_COUNT 声（组间交错，间隔 250ms）；
 *   桌面 → 加入组收 ping，向来源地址单播回 JSON（与 GET /api/discover 同构 + port 字段）。
 * 手机只发不收组播（应答走单播），不需要 MulticastLock——那是收组播才要的驱动过滤豁免。
 *
 * 失败语义：单接口组播失败只记日志不影响其他接口；组播整体失败 → found 空数组但
 * selfIp/selfPrefixes 照回（JS 落回扫段）；socket 都打不开才 reject。
 */
@CapacitorPlugin(name = "PhrontisDiscover")
public class PhrontisDiscover extends Plugin {

    /** 组播组清单：[0] = LocalSend 同款链路本地组（224.0.0.x，AP 必须泛洪），[1] = 初版 239 组（过渡兼容旧桌面） */
    static final String[] GROUPS = {"224.0.0.167", "239.255.42.42"};
    static final int PORT = 8771;
    static final String PING = "PHRONDIS v1\n";
    /** 每组各发 PING_COUNT 声，组间交错（防单组整组被丢时 3 声全砸在一个组里） */
    static final int PING_COUNT = 3;
    static final int PING_GAP_MS = 250;

    @PluginMethod
    public void discover(PluginCall call) {
        final int timeoutMs = call.getInt("timeoutMs", 900);
        final Thread t = new Thread(() -> runDiscover(call, timeoutMs));
        t.setName("phrontis-discover");
        t.start();
    }

    private void runDiscover(PluginCall call, int timeoutMs) {
        Map<String, JSObject> found = new LinkedHashMap<>();
        /* 自知网段先算、独立于组播成败：组播全挂时 selfPrefixes 照回——扫自己网段才是兜底主路 */
        List<NetworkInterface> ifs = eligibleInterfaces();
        List<String> prefixes = selfPrefixes(ifs);
        String defaultIp = selfIpv4();
        long deadline = System.currentTimeMillis() + timeoutMs;
        try {
            List<DatagramSocket> socks = new ArrayList<>();
            for (NetworkInterface ni : ifs) {
                try {
                    MulticastSocket s = new MulticastSocket();
                    s.setNetworkInterface(ni); /* 部分 ROM 会抛：逐接口 try，跳过该接口 */
                    s.setBroadcast(true);
                    socks.add(s);
                } catch (Exception ignore) { /* 该接口发不了组播：跳过 */ }
            }
            boolean unbound = socks.isEmpty();
            if (unbound) {
                /* 没有可用接口（罕见）：退回不绑接口的旧行为，默认路由能到哪算哪 */
                socks.add(new DatagramSocket());
            }
            try {
                byte[] ping = PING.getBytes("UTF-8");
                /* 阶段一：组间交错发 ping，每轮全体接口齐发，轮间隔 PING_GAP_MS，间隙里听应答 */
                int total = PING_COUNT * GROUPS.length;
                for (int round = 0; round < total && System.currentTimeMillis() < deadline; round++) {
                    InetAddress group = InetAddress.getByName(GROUPS[round % GROUPS.length]);
                    for (DatagramSocket s : socks) {
                        try {
                            s.send(new DatagramPacket(ping, ping.length, group, PORT));
                        } catch (Exception e) {
                            /* 蜂窝/被禁接口 send 抛异常：逐次吞掉，别让单接口失败拖死整轮 */
                        }
                    }
                    drainReplies(socks, Math.max(20, PING_GAP_MS / Math.max(1, socks.size())), found, deadline);
                }
                /* 阶段二：余下时间继续听（桌面应答在 ping 后毫秒级到达） */
                while (System.currentTimeMillis() < deadline) {
                    drainReplies(socks, 100, found, deadline);
                }
            } finally {
                for (DatagramSocket s : socks) {
                    try { s.close(); } catch (Exception ignore) { /* 已关 */ }
                }
            }
        } catch (Exception e) {
            /* socket 打不开等硬失败：仍 resolve（found 空 + 自知网段照回），JS 落回扫段 */
        }
        JSArray arr = new JSArray();
        for (JSObject v : found.values()) arr.put(v);
        JSObject res = new JSObject();
        res.put("found", arr);
        /* 自知 IP/网段（不随发现成败）：selfPrefixes[0] = 热点 AP/Wi-Fi 段；全空时回默认出口段
         * （蜂窝场景 JS 侧会按 CGNAT 丢弃不扫，但 diag 会亮出来——一眼看出手机不在局域网） */
        res.put("selfIp", defaultIp);
        String selfPrefix = prefixes.isEmpty() ? prefixOf(defaultIp) : prefixes.get(0);
        res.put("selfPrefix", selfPrefix == null ? "" : selfPrefix);
        JSArray parr = new JSArray();
        for (String p : prefixes) parr.put(p);
        res.put("selfPrefixes", parr);
        call.resolve(res);
    }

    /** 轮流听一遍所有 socket 的应答（每个 socket 至多等 perSockMs） */
    private void drainReplies(List<DatagramSocket> socks, int perSockMs, Map<String, JSObject> found, long deadline) {
        for (DatagramSocket s : socks) {
            if (System.currentTimeMillis() >= deadline) return;
            try {
                s.setSoTimeout(perSockMs);
                byte[] buf = new byte[2048];
                DatagramPacket in = new DatagramPacket(buf, buf.length);
                s.receive(in); /* 超时抛 SocketTimeoutException → 跳下一个 socket */
                String payload = new String(in.getData(), 0, in.getLength(), "UTF-8").trim();
                JSObject pc = parseCompanion(payload, in.getAddress().getHostAddress());
                if (pc != null) {
                    String baseUrl = pc.getString("baseUrl", "");
                    if (!baseUrl.isEmpty()) found.put(baseUrl, pc);
                }
            } catch (SocketTimeoutException ignore) {
                /* 本 socket 静默：下一个 */
            } catch (Exception ignore) {
                /* socket 已被关/异常：跳过 */
            }
        }
    }

    /** 可发组播的接口：up、非 loopback、带站点内 IPv4、非蜂窝；AP/热点接口排最前 */
    private static List<NetworkInterface> eligibleInterfaces() {
        List<NetworkInterface> ap = new ArrayList<>(), wifi = new ArrayList<>(), rest = new ArrayList<>();
        try {
            Enumeration<NetworkInterface> nis = NetworkInterface.getNetworkInterfaces();
            while (nis != null && nis.hasMoreElements()) {
                NetworkInterface ni = nis.nextElement();
                if (!ni.isUp() || ni.isLoopback()) continue;
                if (isCellular(ni.getName())) continue;
                boolean hasSiteLocal = false;
                for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                    if (ia.getAddress() instanceof Inet4Address && ia.getAddress().isSiteLocalAddress()) { hasSiteLocal = true; break; }
                }
                if (!hasSiteLocal) continue;
                String n = ni.getName() == null ? "" : ni.getName().toLowerCase();
                if (n.startsWith("ap") || n.startsWith("swlan") || n.startsWith("softap")) ap.add(ni);
                else if (n.startsWith("wlan") || n.startsWith("wifi")) wifi.add(ni);
                else rest.add(ni);
            }
        } catch (SocketException ignore) { /* 枚举失败：返回空，上层退化 */ }
        List<NetworkInterface> out = new ArrayList<>();
        out.addAll(ap);
        out.addAll(wifi);
        out.addAll(rest);
        return out;
    }

    /** 蜂窝数据接口名：rmnet* / ccmni*（MTK）/ pdp* / clat* / v4-rmnet——它们的 /24 是运营商大网，扫了也没用 */
    private static boolean isCellular(String name) {
        if (name == null) return false;
        String n = name.toLowerCase();
        return n.startsWith("rmnet") || n.startsWith("ccmni") || n.startsWith("pdp")
                || n.startsWith("clat") || n.contains("rmnet");
    }

    /** 自知 /24 前缀清单（去重保序：AP/热点段 → Wi-Fi 段 → 其他） */
    private static List<String> selfPrefixes(List<NetworkInterface> ifs) {
        LinkedHashSet<String> out = new LinkedHashSet<>();
        for (NetworkInterface ni : ifs) {
            for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                if (!(ia.getAddress() instanceof Inet4Address)) continue;
                String p = prefixOf(ia.getAddress().getHostAddress());
                if (p != null) out.add(p);
            }
        }
        return new ArrayList<>(out);
    }

    /** IPv4 → /24 前缀（a.b.c）；非点分四段返回 null */
    private static String prefixOf(String ip) {
        if (ip == null || "0.0.0.0".equals(ip)) return null;
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("^(\\d{1,3}\\.\\d{1,3}\\.\\d{1,3})\\.\\d{1,3}$").matcher(ip);
        return m.find() ? m.group(1) : null;
    }

    /**
     * 本机出口 IPv4：UDP connect 到公网地址（不发包，只走路由查找）读本地地址；
     * 拿不到（离线 / 0.0.0.0）再枚举网卡，优先 wlan 口的非内部 IPv4。
     */
    private static String selfIpv4() {
        try (DatagramSocket s = new DatagramSocket()) {
            s.connect(InetAddress.getByName("8.8.8.8"), 53);
            String ip = s.getLocalAddress().getHostAddress();
            if (ip != null && !ip.equals("0.0.0.0")) return ip;
        } catch (Exception ignore) { /* 落到网卡枚举 */ }
        try {
            Enumeration<NetworkInterface> nis = NetworkInterface.getNetworkInterfaces();
            String fallback = null;
            while (nis != null && nis.hasMoreElements()) {
                NetworkInterface ni = nis.nextElement();
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                    InetAddress a = ia.getAddress();
                    if (a.isLoopbackAddress() || !(a instanceof Inet4Address)) continue;
                    String ip = a.getHostAddress();
                    if (ni.getName() != null && ni.getName().startsWith("wlan")) return ip;
                    if (fallback == null) fallback = ip;
                }
            }
            return fallback;
        } catch (Exception e) {
            return null;
        }
    }

    /** 应答 → DiscoveredPc 同构对象；baseUrl 用应答里的 port + 来源 IP（桌面自报端口，IP 以线路为准） */
    private JSObject parseCompanion(String payload, String ip) {
        try {
            JSONObject j = new JSONObject(payload);
            if (!j.optBoolean("ok", false)) return null;
            int port = j.optInt("port", 8770);
            JSONObject pc = j.optJSONObject("pc");
            JSObject out = new JSObject();
            out.put("baseUrl", "http://" + ip + ":" + port);
            out.put("pcName", pc != null ? pc.optString("name", "我的电脑") : "我的电脑");
            out.put("protocol", j.optInt("protocol", 1));
            org.json.JSONArray pairing = j.optJSONArray("pairing");
            boolean canRequest = false;
            if (pairing != null) {
                for (int i = 0; i < pairing.length(); i++) {
                    if ("request".equals(pairing.optString(i))) canRequest = true;
                }
            }
            out.put("canRequest", canRequest);
            return out;
        } catch (Exception e) {
            return null;
        }
    }
}
