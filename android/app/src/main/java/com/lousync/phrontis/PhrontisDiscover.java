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
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.SocketTimeoutException;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 组播发现 + 自知 IP（2026-11-08，借鉴 LocalSend 的 UDP 发现，替代「经验网段扫段」这一唯一手段）。
 *
 * 为什么必须写在原生层：WebView 拿不到 UDP 套接字，也拿不到本机 IP——JS 扫段只能按
 * 经验清单枚举 192.168.x 等网段，电脑活在清单外（实测 10.116.216.x）就永远搜不到，
 * 且 App 重装清掉 localStorage 记忆后连自举都没了。原生层两件事：
 *   ① 组播：手机往组播组喊一声，桌面（加入了组的伴侣服务）单播应答，命中即秒回；
 *   ② 自知 IP：UDP connect 公网地址不发包即得本机出口 IP → 推导本机 /24 网段——
 *      JS 扫段回退优先扫「自己所在的网段」（LocalSend 同款第二条腿，不依赖组播通不通；
 *      实测本网络 AP 会整类丢弃客户端组播——连 LocalSend 的 224.0.0.167 都到不了对端，
 *      组播只能当加速器，扫自己网段才是兜底主路）。
 *
 * 线路（与 docs/handoff-multicast-discovery-desktop.md 冻结一致，2026-11-08 双组修订）：
 *   手机 → 组播组 224.0.0.167:8771 与 239.255.42.42:8771 各发 3 声 "PHRONDIS v1\n"（交错发，间隔 250ms）；
 *     —— 224.0.0.x 是链路本地控制块（RFC 4541 要求 AP 无条件泛洪，LocalSend 同组，最被善待）；
 *     —— 239.255.42.42 为初版组地址，保留双发是对旧桌面 APK 的过渡兼容（新桌面两组都收）。
 *   桌面 → 加入组收 ping，向来源地址单播回 JSON（与 GET /api/discover 同构 + port 字段）：
 *          {"ok":true,"protocol":1,"pc":{"name":"..."},"port":8770,"pairing":["request","code"]}
 * 手机只发不收组播（应答走单播），不需要 MulticastLock——那是收组播才要的驱动过滤豁免。
 *
 * 失败语义：socket 打不开 / 发送失败 → reject（JS 落回扫段）；超时零应答 → found 空数组
 * （JS 同样落回扫段，桌面还没实现应答端时保持旧行为）。
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
        try (DatagramSocket sock = new DatagramSocket()) {
            sock.setBroadcast(true);
            byte[] ping = PING.getBytes("UTF-8");
            byte[] buf = new byte[2048];
            long deadline = System.currentTimeMillis() + timeoutMs;
            /* 组间交错发送：第 n 声轮到 GROUPS[n % GROUPS.length]，每组足额 PING_COUNT 声 */
            int sent = 0;
            while (System.currentTimeMillis() < deadline) {
                if (sent < PING_COUNT * GROUPS.length) {
                    InetAddress group = InetAddress.getByName(GROUPS[sent % GROUPS.length]);
                    sock.send(new DatagramPacket(ping, ping.length, group, PORT));
                    sent++;
                }
                int remain = (int) Math.max(1, deadline - System.currentTimeMillis());
                sock.setSoTimeout(Math.min(remain, PING_GAP_MS));
                DatagramPacket in = new DatagramPacket(buf, buf.length);
                try {
                    sock.receive(in);
                } catch (SocketTimeoutException e) {
                    continue;
                }
                String payload = new String(in.getData(), 0, in.getLength(), "UTF-8").trim();
                JSObject pc = parseCompanion(payload, in.getAddress().getHostAddress());
                if (pc != null) {
                    String baseUrl = pc.getString("baseUrl", "");
                    if (!baseUrl.isEmpty()) found.put(baseUrl, pc);
                }
            }
            JSArray arr = new JSArray();
            for (JSObject v : found.values()) arr.put(v);
            JSObject res = new JSObject();
            res.put("found", arr);
            /* 自知 IP（不随发现成败）：UDP connect 公网地址不发包即得出口 IP → 本机 /24 前缀；
             * JS 扫段回退拿它优先扫自己网段，App 重装/换网络都不怕 */
            String selfIp = selfIpv4();
            res.put("selfIp", selfIp);
            String selfPrefix = "";
            if (selfIp != null) {
                java.util.regex.Matcher m = java.util.regex.Pattern
                        .compile("^(\\d{1,3}\\.\\d{1,3}\\.\\d{1,3})\\.\\d{1,3}$").matcher(selfIp);
                if (m.find()) selfPrefix = m.group(1);
            }
            res.put("selfPrefix", selfPrefix);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("multicast unavailable: " + e.getClass().getSimpleName());
        }
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
                if (!ni.isUp() || ni.isLoopback() || !ni.isRunning()) continue;
                for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                    InetAddress a = ia.getAddress();
                    if (a.isLoopbackAddress() || !(a instanceof java.net.Inet4Address)) continue;
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
