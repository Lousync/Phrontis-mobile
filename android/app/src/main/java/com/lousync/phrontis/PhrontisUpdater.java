package com.lousync.phrontis;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 应用内更新的原生半边（2026-11-09，docs/design.md §7.1 冻结设计的落地）。
 *
 * 分工：检查（releases API + semver 对比）与镜像候选链在 JS 侧（src/lib/update.ts，
 * 等价桌面「渲染层 + 主进程 fetch」的架构位置）；本插件只管字节——流式下载、校验、
 * 拉起系统安装器，等价桌面 electron/lib/updateService.ts 的下载管线。
 *
 * 为什么必须写在原生层：WebView 的 fetch 被 CapacitorHttp 接管后不支持流式读响应体
 * （大二进制会整体进内存），也没有文件句柄做断点续传；把 APK 送到系统安装器要
 * FileProvider + Intent，全是 WebView 够不着的原生职责。
 *
 * 下载套路移植桌面 updateService.ts downloadOne（参数全部是真机报障修出来的，勿动）：
 *   候选循环（JS 算好传入）→ Range 断点续传（200 应答=不支持续传则从头）→
 *   content-length 前置校验（不符直接判坏，不白下载整包）→ 15s 窗口 2MB 慢速看门狗
 *   （挂着不回也不断的通道 15s 内判死，不等 30s readTimeout）→ 进度节流（256KB/200ms、
 *   floor 百分比、**校验通过前上限锁 99%**——「卡 100%」观感的根治）→ size 兜底校验
 *   （chunked 截流兜底）→ sha256（流内边下边算）→ 任一不符删包换下一候选。
 *
 * 失败语义（对齐桌面 UpdateFailReason，JS 据此渲染差异化文案）：
 *   size-mismatch / sha256-mismatch → 服务器或镜像坏字节（换通道重试）；
 *   network → 网络类（HTTP 错误 / 断流 / 域名不通）；stalled → 通道挂死（已自动换）；
 *   channel-all-failed → 候选全部耗尽；paused / cancelled → 主动中止，不算错误。
 * 与 PhrontisDiscover 同规：单候选失败不 reject，全部候选耗尽或主动中止仍 resolve
 * （降级语义优先），JS 端零 reject 分支。
 */
@CapacitorPlugin(name = "PhrontisUpdater")
public class PhrontisUpdater extends Plugin {

    static final String UA = "Phrontis-Mobile";
    /** 连接/读超时：慢速看门狗 15s 先行判死，这是 fully-dead socket 的最后保险 */
    static final int CONNECT_TIMEOUT_MS = 15000;
    static final int READ_TIMEOUT_MS = 30000;
    /** 进度节流：字节增量 ≥256KB 或距上次 ≥200ms 才发一个事件（不依赖整数百分比变化） */
    static final long PROGRESS_MIN_BYTES = 256 * 1024;
    static final long PROGRESS_MIN_INTERVAL_MS = 200;
    /** 慢速看门狗：15s 窗口内新增不足 2MB（≈136KB/s）判定为慢通道，断流换下一候选 */
    static final long WATCHDOG_WINDOW_MS = 15000;
    static final long WATCHDOG_MIN_BYTES = 2L * 1024 * 1024;
    /** 安装器清理 marker：install 触发时记录 {路径, 触发时 versionCode}，下次启动版本已变（=装完）则删包 */
    static final String CLEANUP_MARKER = "pending-apk-cleanup.json";
    static final String APK_DIR = "update";

    /** 单飞下载：downloading 仅供进行中判定（volatile 读）；pause/cancel 从其他线程置位 */
    private volatile boolean downloading = false;
    private final AtomicBoolean pauseRequested = new AtomicBoolean(false);
    private final AtomicBoolean cancelRequested = new AtomicBoolean(false);
    private final AtomicBoolean stalled = new AtomicBoolean(false);
    /** 活动连接：暂停/取消/看门狗从其他线程 disconnect 它，让阻塞中的 read 立刻抛异常醒来 */
    private volatile HttpURLConnection activeConn = null;
    /** 暂停态取消要删断点文件，但 cancelDownload 进来时下载已结束——记下最后一次 dest */
    private volatile File lastDest = null;

    // ---- 生命周期：启动清理（移植桌面 runInstallerStartupCleanup） ----

    @Override
    public void load() {
        try {
            File marker = new File(getContext().getFilesDir(), CLEANUP_MARKER);
            JSONObject m = new JSONObject(readAll(marker));
            int from = m.optInt("fromVersionCode", -1);
            if (from != -1 && from != currentVersionCode()) {
                /* versionCode 变了 = 更新装成了 → 旧 APK 已无用，删掉腾缓存 */
                String p = m.optString("path", "");
                if (!p.isEmpty()) new File(p).delete();
            }
            /* versionCode 未变（安装被取消/失败）→ 保留 APK 供用户重试，只清 marker 之外不动 */
            marker.delete();
        } catch (Exception ignore) { /* 无 marker 或读取失败：无需清理，尽力而为 */ }
    }

    // ---- 查询：安装权限 ----

    /** Android 8.0（API 26）起安装未知来源应用是 per-app 开关；更早版本走全局设置，安装器自行处理 */
    @PluginMethod
    public void canInstall(PluginCall call) {
        boolean granted = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                granted = getContext().getPackageManager().canRequestPackageInstalls();
            } catch (Exception e) {
                granted = false;
            }
        }
        JSObject res = new JSObject();
        res.put("granted", granted);
        res.put("sdkInt", Build.VERSION.SDK_INT);
        call.resolve(res);
    }

    /** 直接跳系统「安装未知应用」授权页（比 toast 指路少两步；仿 lib/notify.ts 的引导但直达） */
    @PluginMethod
    public void openInstallPermSettings(PluginCall call) {
        JSObject res = new JSObject();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            res.put("success", false);
            res.put("message", "本机 Android 版本无需此授权");
            call.resolve(res);
            return;
        }
        try {
            Intent it = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName()));
            it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(it);
            res.put("success", true);
        } catch (Exception e) {
            res.put("success", false);
            res.put("message", e.getMessage() == null ? "无法打开授权页" : e.getMessage());
        }
        call.resolve(res);
    }

    // ---- 下载 ----

    /**
     * 下载 APK。候选链由 JS 算好传入（镜像→备用→直连），原生只管字节：
     * 逐候选「下载 → size/sha256 双校验 → 通过才 resolve」，坏包删掉换下一候选。
     */
    @PluginMethod
    public void download(PluginCall call) {
        List<String> urls = new ArrayList<>();
        JSArray arr = call.getArray("urls");
        if (arr != null) {
            try {
                for (int i = 0; i < arr.length(); i++) {
                    String u = arr.optString(i, "");
                    if (!u.isEmpty()) urls.add(u);
                }
            } catch (Exception ignore) { /* 坏元素跳过 */ }
        }
        if (urls.isEmpty()) {
            call.resolve(err("channel-all-failed", "候选下载地址为空"));
            return;
        }
        final String name = sanitizeName(call.getString("name", "update.apk"));
        Long esz = call.getLong("expectedSize");
        final long expectedSize = esz == null ? 0L : esz;
        final String sha256 = call.getString("sha256", "");

        synchronized (this) {
            if (downloading) {
                call.resolve(err("unknown", "已有下载任务进行中"));
                return;
            }
            downloading = true;
        }
        pauseRequested.set(false);
        cancelRequested.set(false);
        stalled.set(false);

        final Thread t = new Thread(() -> runDownload(call, urls, name, expectedSize, sha256));
        t.setName("phrontis-updater");
        t.start();
    }

    private void runDownload(PluginCall call, List<String> urls, String name, long expectedSize, String sha256) {
        File dest = new File(updateDir(), name);
        lastDest = dest;
        /* manifest 没带 sha256 → 仅剩 size 校验兜底（发布侧事故信号），JS 端提示 */
        final boolean metaMissing = sha256 == null || sha256.isEmpty();
        String lastReason = "channel-all-failed";
        String lastMessage = "所有下载通道均失败";
        try {
            for (int i = 0; i < urls.size(); i++) {
                if (pauseRequested.get() || cancelRequested.get()) break;
                /* 上一候选失败后进入下一候选 → 先发 switching 让 UI 说「正在切换镜像」，
                 * 而不是让进度条原地冻住；首字节到达后由事件自然回到正常进度展示 */
                if (i > 0) pushStage("switching");
                try {
                    downloadOne(urls.get(i), dest, expectedSize, sha256);
                    /* 全部校验通过 → 这才允许 100% */
                    pushProgress(100, dest.length(), expectedSize > 0 ? expectedSize : dest.length());
                    JSObject res = new JSObject();
                    res.put("success", true);
                    res.put("path", dest.getAbsolutePath());
                    res.put("size", dest.length());
                    res.put("metaMissing", metaMissing);
                    call.resolve(res);
                    return;
                } catch (UpdateError e) {
                    lastReason = e.reason;
                    lastMessage = String.valueOf(e.getMessage());
                    try { dest.delete(); } catch (Exception ignore) { /* ignore */ }
                } catch (Exception e) {
                    lastReason = "network";
                    lastMessage = e.getMessage() == null ? "网络请求失败" : e.getMessage();
                    try { dest.delete(); } catch (Exception ignore) { /* ignore */ }
                }
            }
            if (pauseRequested.get()) {
                resolvePaused(call);
                return;
            }
            if (cancelRequested.get()) {
                try { dest.delete(); } catch (Exception ignore) { /* ignore */ }
                call.resolve(err("cancelled", "下载已取消"));
                return;
            }
            call.resolve(err(lastReason, lastMessage));
        } finally {
            synchronized (this) { downloading = false; }
            activeConn = null;
        }
    }

    /** 单候选下载：成功返回（流收完 + size/sha256 双校验通过），失败抛 UpdateError（上层换下一候选） */
    private void downloadOne(String url, File dest, long expectedSize, String sha256) throws Exception {
        try {
            long offset = partialSize(dest);
            HttpURLConnection conn = open(url, offset);
            activeConn = conn;
            DownloadState st = new DownloadState();
            Thread wd = startWatchdog(st);
            try {
                int code = conn.getResponseCode();
                if (code < 200 || code >= 300) {
                    throw new UpdateError(host(url) + " HTTP " + code, "network");
                }
                String ctype = String.valueOf(conn.getContentType()).toLowerCase();
                if (ctype.contains("text/html")) {
                    /* 镜像失效时常见：拿回来的是错误页而非文件 */
                    throw new UpdateError(host(url) + " 返回的是网页而非文件", "network");
                }
                /* 服务器不支持 Range（应答 200 而非 206）→ 只能从头重下 */
                boolean resumed = offset > 0 && code == 206;
                if (!resumed) offset = 0;
                long segTotal = conn.getContentLengthLong();
                long totalFull = resumed ? offset + segTotal : segTotal;
                /* 大小前置校验：content-length 与期望不符 → 直接判坏，避免白下载整包 */
                if (expectedSize > 0 && totalFull > 0 && totalFull != expectedSize) {
                    throw new UpdateError("文件大小不符（期望 " + expectedSize + "，实际 " + totalFull
                            + "），服务器文件可能未传完整", "size-mismatch");
                }

                MessageDigest digest = (sha256 == null || sha256.isEmpty())
                        ? null : MessageDigest.getInstance("SHA-256");
                long lastPushAt = 0;
                long lastPushBytes = offset;
                long received = 0;
                boolean aliveNotified = false;
                try (InputStream in = conn.getInputStream();
                     FileOutputStream out = new FileOutputStream(dest, resumed)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        if (pauseRequested.get() || cancelRequested.get()) throw new IOException("ABORT");
                        out.write(buf, 0, n);
                        if (digest != null) digest.update(buf, 0, n);
                        received += n;
                        if (!aliveNotified) {
                            /* 首个字节到达 = 本通道确实活着 → 收回「正在切换镜像」提示，
                             * 回到正常进度展示（头是瞬时就有的，要等真实字节才算活） */
                            aliveNotified = true;
                            pushStage("downloading");
                        }
                        st.received.set(offset + received);
                        long now = System.currentTimeMillis();
                        long done = offset + received;
                        /* 进度口径移植桌面：floor 百分比、字节+时间双节流、校验通过前锁 99 */
                        if (totalFull > 0 && (done - lastPushBytes >= PROGRESS_MIN_BYTES
                                || now - lastPushAt >= PROGRESS_MIN_INTERVAL_MS)) {
                            lastPushAt = now;
                            lastPushBytes = done;
                            pushProgress((int) Math.min(99, (done * 100) / totalFull), done, totalFull);
                        }
                    }
                }
                /* 流收完 → 校验窗口（sha256 流内已算完，这里只剩比对） */
                pushStage("verifying");
                /* 流结束后的兜底校验：chunked/无 content-length 时服务器提前断流也会被截获 */
                if (expectedSize > 0 && dest.length() != expectedSize) {
                    throw new UpdateError("文件大小不符（期望 " + expectedSize + "，实际 " + dest.length()
                            + "），服务器文件可能未传完整", "size-mismatch");
                }
                if (digest != null) {
                    StringBuilder sb = new StringBuilder();
                    for (byte b : digest.digest()) sb.append(String.format("%02x", b));
                    if (!sb.toString().equalsIgnoreCase(sha256)) {
                        throw new UpdateError("文件校验和（SHA256）不符，镜像可能返回了坏字节", "sha256-mismatch");
                    }
                }
            } finally {
                wd.interrupt();
                activeConn = null;
            }
        } catch (UpdateError ue) {
            throw ue;
        } catch (Exception e) {
            /* 异常分类：主动中止 > 看门狗判死 > 网络类。中止的 reason 值无所谓，
             * runDownload 的 catch 分支先查 pause/cancel 标志。 */
            if (pauseRequested.get()) throw new UpdateError("paused", "paused");
            if (cancelRequested.get()) throw new UpdateError("cancelled", "cancelled");
            if (stalled.get()) {
                throw new UpdateError(host(url) + " 通道无响应（"
                        + (WATCHDOG_WINDOW_MS / 1000) + "s 内新增不足 2MB），已切换通道", "stalled");
            }
            throw new UpdateError(host(url) + " " + (e.getMessage() == null ? "网络请求失败" : e.getMessage()), "network");
        }
    }

    /**
     * 慢速看门狗：独立线程每 WATCHDOG_WINDOW_MS 结算一次「本窗口新增字节」，
     * 不足 2MB 判死并 disconnect 活动连接——阻塞中的 read 立刻抛异常醒来。
     * 桌面教训：比较**本窗口新增**而非全程累计（首窗口收过 2MB 后累计值永远达标，
     * 看门狗就永远判不出卡死，表象即「进度满格后静默死锁」）。
     */
    private Thread startWatchdog(DownloadState st) {
        Thread wd = new Thread(() -> {
            while (true) {
                try {
                    Thread.sleep(WATCHDOG_WINDOW_MS);
                } catch (InterruptedException ie) {
                    return;
                }
                HttpURLConnection conn = activeConn;
                if (conn == null) return;
                long now = System.currentTimeMillis();
                if (now - st.markAt.get() < WATCHDOG_WINDOW_MS) continue;
                if (st.received.get() - st.markBytes.get() < WATCHDOG_MIN_BYTES) {
                    stalled.set(true);
                    try { conn.disconnect(); } catch (Exception ignore) { /* ignore */ }
                    return;
                }
                st.markAt.set(now);
                st.markBytes.set(st.received.get());
            }
        });
        wd.setName("phrontis-updater-watchdog");
        wd.setDaemon(true);
        wd.start();
        return wd;
    }

    @PluginMethod
    public void pauseDownload(PluginCall call) {
        if (!downloading) {
            JSObject res = new JSObject();
            res.put("ok", false);
            res.put("message", "没有进行中的下载");
            call.resolve(res);
            return;
        }
        pauseRequested.set(true);
        HttpURLConnection c = activeConn;
        if (c != null) c.disconnect();
        JSObject res = new JSObject();
        res.put("ok", true);
        call.resolve(res);
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        if (downloading) {
            cancelRequested.set(true);
            HttpURLConnection c = activeConn;
            if (c != null) c.disconnect();
            JSObject res = new JSObject();
            res.put("ok", true);
            call.resolve(res);
            return;
        }
        /* 暂停态取消：清除断点文件（桌面同款语义） */
        boolean removed = false;
        File d = lastDest;
        if (d != null && d.exists()) {
            removed = d.delete();
        }
        JSObject res = new JSObject();
        res.put("ok", true);
        res.put("removedPartial", removed);
        call.resolve(res);
    }

    // ---- 安装 ----

    @PluginMethod
    public void install(PluginCall call) {
        String p = call.getString("path", "");
        if (p.isEmpty()) {
            call.resolve(err("unknown", "缺少安装包路径"));
            return;
        }
        try {
            /* 路径围栏（移植桌面 update:install）：只允许运行 cache/update/ 目录内的安装包，
             * 用 canonical 路径防 ../ 逃逸 */
            File base = updateDir().getCanonicalFile();
            File f = new File(p).getCanonicalFile();
            if (!f.getPath().startsWith(base.getPath() + File.separator)) {
                call.resolve(err("unknown", "路径不受信任"));
                return;
            }
            if (!f.exists() || f.length() == 0) {
                call.resolve(err("unknown", "安装包不存在"));
                return;
            }
            android.content.Context ctx = getContext();
            Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", f);
            Intent it = new Intent(Intent.ACTION_VIEW);
            it.setDataAndType(uri, "application/vnd.android.package-archive");
            it.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                ctx.startActivity(it);
            } catch (ActivityNotFoundException e) {
                call.resolve(err("unknown", "系统安装器不可用"));
                return;
            }
            /* 清理 marker：下次启动 versionCode 已变（=装完）由 load() 删包；没变保留供重试 */
            try {
                JSONObject m = new JSONObject();
                m.put("path", f.getAbsolutePath());
                m.put("fromVersionCode", currentVersionCode());
                java.io.Writer w = new java.io.OutputStreamWriter(
                        getContext().openFileOutput(CLEANUP_MARKER, android.content.Context.MODE_PRIVATE), "UTF-8");
                w.write(m.toString());
                w.close();
            } catch (Exception ignore) { /* 尽力而为 */ }
            JSObject res = new JSObject();
            res.put("success", true);
            call.resolve(res);
        } catch (Exception e) {
            call.resolve(err("unknown", e.getMessage() == null ? "拉起安装器失败" : e.getMessage()));
        }
    }

    /** 检查失败的兜底出路：浏览器打开 GitHub 发布页（域名白名单防外部 intent 注入） */
    @PluginMethod
    public void openReleasePage(PluginCall call) {
        String url = call.getString("url", "");
        JSObject res = new JSObject();
        try {
            URL u = new URL(url);
            if (!"https".equalsIgnoreCase(u.getProtocol()) || !u.getHost().toLowerCase().endsWith("github.com")) {
                res.put("success", false);
                res.put("message", "URL 不受信任");
            } else {
                Intent it = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(it);
                res.put("success", true);
            }
        } catch (Exception e) {
            res.put("success", false);
            res.put("message", e.getMessage() == null ? "URL 非法" : e.getMessage());
        }
        call.resolve(res);
    }

    // ---- 工具 ----

    private static class DownloadState {
        final AtomicLong received = new AtomicLong();
        final AtomicLong markAt = new AtomicLong(System.currentTimeMillis());
        final AtomicLong markBytes = new AtomicLong();
    }

    /** 带结构化 reason 的下载错误（对齐桌面 UpdateFailReason），downloadOne → runDownload 统一抛出 */
    private static final class UpdateError extends Exception {
        final String reason;
        UpdateError(String message, String reason) {
            super(message);
            this.reason = reason;
        }
    }

    private static JSObject err(String reason, String message) {
        JSObject res = new JSObject();
        res.put("success", false);
        res.put("reason", reason);
        res.put("message", message == null ? "" : message);
        return res;
    }

    private void resolvePaused(PluginCall call) {
        JSObject res = new JSObject();
        res.put("success", false);
        res.put("paused", true);
        res.put("receivedBytes", partialSize(lastDest));
        res.put("message", "下载已暂停,可随时继续");
        call.resolve(res);
    }

    private HttpURLConnection open(String url, long offset) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
        conn.setReadTimeout(READ_TIMEOUT_MS);
        conn.setInstanceFollowRedirects(true);
        conn.setRequestProperty("User-Agent", UA);
        if (offset > 0) conn.setRequestProperty("Range", "bytes=" + offset + "-");
        return conn;
    }

    private void pushProgress(int percent, long receivedBytes, long totalBytes) {
        JSObject d = new JSObject();
        d.put("percent", percent);
        d.put("receivedBytes", receivedBytes);
        d.put("totalBytes", totalBytes);
        notifyListeners("updProgress", d);
    }

    private void pushStage(String stage) {
        JSObject d = new JSObject();
        d.put("stage", stage);
        notifyListeners("updStage", d);
    }

    private File updateDir() {
        File d = new File(getContext().getCacheDir(), APK_DIR);
        if (!d.exists()) d.mkdirs();
        return d;
    }

    private int currentVersionCode() {
        try {
            return getContext().getPackageManager()
                    .getPackageInfo(getContext().getPackageName(), 0).versionCode;
        } catch (Exception e) {
            return -1;
        }
    }

    private static String readAll(File f) throws IOException {
        java.io.BufferedReader r = new java.io.BufferedReader(new java.io.FileReader(f));
        try {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = r.readLine()) != null) sb.append(line);
            return sb.toString();
        } finally {
            r.close();
        }
    }

    private static long partialSize(File f) {
        try {
            return f != null && f.isFile() ? f.length() : 0;
        } catch (Exception e) {
            return 0;
        }
    }

    private static String host(String url) {
        try {
            return new URL(url).getHost();
        } catch (Exception e) {
            return url;
        }
    }

    private static String sanitizeName(String name) {
        String n = name == null ? "" : name;
        int i = Math.max(n.lastIndexOf('/'), n.lastIndexOf('\\'));
        if (i >= 0) n = n.substring(i + 1);
        return n.isEmpty() ? "update.apk" : n;
    }
}
