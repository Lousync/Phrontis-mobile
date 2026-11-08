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
import java.net.SocketTimeoutException;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 组播发现（2026-11-08，借鉴 LocalSend 的 UDP 发现，替代「经验网段扫段」这一唯一手段）。
 *
 * 为什么必须写在原生层：WebView 拿不到 UDP 套接字，也拿不到本机 IP——JS 扫段只能按
 * 经验清单枚举 192.168.x 等网段，电脑活在清单外（实测 10.116.216.x）就永远搜不到，
 * 且 App 重装清掉 localStorage 记忆后连自举都没了。组播发现不猜网段：手机往组播组喊一声，
 * 桌面（加入了组的伴侣服务）单播应答，任意子网 <1s 命中。
 *
 * 线路（与 docs/handoff-multicast-discovery-desktop.md 冻结一致）：
 *   手机 → 组播 239.255.42.42:8771 发 3 声 "PHRONDIS v1\n"（间隔 250ms，抗丢包）；
 *   桌面 → 加入组收 ping，向来源地址单播回 JSON（与 GET /api/discover 同构 + port 字段）：
 *          {"ok":true,"protocol":1,"pc":{"name":"..."},"port":8770,"pairing":["request","code"]}
 * 手机只发不收组播（应答走单播），因此不需要 MulticastLock——那是收组播才要的驱动过滤豁免。
 *
 * 失败语义：socket 打不开 / 发送失败 → reject（JS 落回扫段）；超时零应答 → found 空数组
 * （JS 同样落回扫段，桌面还没实现应答端时保持旧行为）。
 */
@CapacitorPlugin(name = "PhrontisDiscover")
public class PhrontisDiscover extends Plugin {

    static final String GROUP = "239.255.42.42";
    static final int PORT = 8771;
    static final String PING = "PHRONDIS v1\n";
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
            InetAddress group = InetAddress.getByName(GROUP);
            byte[] ping = PING.getBytes("UTF-8");
            byte[] buf = new byte[2048];
            long deadline = System.currentTimeMillis() + timeoutMs;
            int sent = 0;
            while (System.currentTimeMillis() < deadline) {
                if (sent < PING_COUNT) {
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
            call.resolve(res);
        } catch (Exception e) {
            call.reject("multicast unavailable: " + e.getClass().getSimpleName());
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
