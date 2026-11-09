package com.lousync.phrontis;

import android.content.pm.ActivityInfo;
import android.os.Bundle;
import android.util.DisplayMetrics;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

/**
 * 原生 insets 桥（2026-11-06）：把系统栏与输入法占位换算成 CSS 变量注入页面。
 *
 * 为什么必须写在原生层：Android 15（targetSdk 35）起强制 edge-to-edge，Web 侧拿不到这些尺寸 ——
 *   1. interactive-widget=resizes-content 是 Blink 特性，**没有接入 WebView**（no-op）；
 *   2. visualViewport 在 WebView 里要 Chrome 139+ 才响应输入法，低于该版本毫无信号；
 *   3. env(safe-area-inset-top) 在安卓上基本恒为 0（只反映刘海，不含状态栏）；
 *   4. Capacitor 自己的 edgeToEdgeHandler 会 return WindowInsetsCompat.CONSUMED，
 *      把 IME inset 直接吞掉（本项目已用 adjustMarginsForEdgeToEdge: 'disable' 关掉它）。
 *
 * 原生应用（Flutter 的 MediaQuery.viewInsets、RN 的 KeyboardAvoidingView）都直接读系统 inset，
 * 这里补同一层，注入三个变量：
 *   --kb-native    输入法占高 —— 壳层高度扣掉它，抽屉/浮坞/FAB/toast 整体上移到键盘上方
 *   --safe-top     状态栏(+刘海)高度 —— 页面顶部留白；状态栏区域由页面自己绘制，才能跟随 7 套主题
 *   --safe-bottom  导航栏/手势条高度 —— 浮坞、FAB、toast 的贴底间距
 *
 * 实现要点：
 * - 用 ViewCompat.getRootWindowInsets() **主动读**，不 setOnApplyWindowInsetsListener ——
 *   后者会顶掉 Capacitor 的处理器（若将来重新启用 margins，会把状态栏处理弄坏）。
 * - 触发用 OnPreDrawListener：铺满模式下窗口尺寸位置都不变，
 *   addOnGlobalLayoutListener 可能一次都不回调。
 * - getInsets() 返回物理像素，除以 density 才是 WebView 的 CSS px。
 */
public class MainActivity extends BridgeActivity {

    /** 上一次注入的值（CSS px）；-1 = 尚未注入过 */
    private int lastKb = -1;
    private int lastTop = -1;
    private int lastBottom = -1;
    /** 帧计数：周期性兜底重发，见 pushInsets */
    private int tick = 0;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        /* ★ 注册必须在 super.onCreate 之前：BridgeActivity.onCreate 内部就 load() 建桥，
         *   之后 registerPlugin 只改 builder、进不了已建好的桥——PhrontisDiscover 因此
         *   从 0.8.0 起在真机上从未注册成功（isPluginAvailable 恒 false，组播与自知网段
         *   整条原生路是死的，2026-11-08 复盘实锤）。 */
        registerPlugin(PhrontisDiscover.class);
        registerPlugin(PhrontisUpdater.class);
        super.onCreate(savedInstanceState);
        applyOrientationPolicy();
        hookInsets();
    }

    /**
     * 屏幕方向策略（2026-11-06）：手机锁竖屏，平板不干预。
     *
     * 为什么不在清单里写 android:screenOrientation="portrait"：那是静态值，一份 APK 对所有设备生效，
     * 平板会跟着被锁死。而横屏只该由平板使用 —— 手机横过来时 .app 的 letterbox 规则（宽度 ≥480px
     * 收窄成 420px 居中卡片）会把界面压成一条，既不是一套真正的横向布局，也不该被看到。
     *
     * sw600dp 是 Android 通用的平板断点（平板线 feat/tablet 的 useFormFactor 也取 768px 宽度，
     * 二者在常见机型上一致）。平板保持 UNSPECIFIED —— 跟随系统旋转与用户的旋转锁，
     * 由那边的自适应两栏布局接管。
     */
    private void applyOrientationPolicy() {
        int swDp = getResources().getConfiguration().smallestScreenWidthDp;
        if (swDp <= 0) {
            /* 极少数设备/初始化阶段该值为 0（未填充），按短边估算，避免把平板误判成手机 */
            DisplayMetrics dm = getResources().getDisplayMetrics();
            swDp = Math.round(Math.min(dm.widthPixels, dm.heightPixels) / dm.density);
        }
        setRequestedOrientation(swDp >= 600
                ? ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
                : ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
    }

    private void hookInsets() {
        WebView webView = bridge != null ? bridge.getWebView() : null;
        if (webView == null) return;

        /* post 之后再注册：onCreate 阶段 WebView 可能还没 attach，
         * 此时 getViewTreeObserver() 拿到的是临时实例，listener 会随 attach 一起丢。 */
        webView.post(() -> {
            /* OnPreDrawListener 每帧绘制前必到 —— 键盘弹起、状态栏变化都必然引起重绘；
             * 内部先判等，没变就直接 return，每帧开销只是一次 insets 读取 + 几次比较。 */
            webView.getViewTreeObserver().addOnPreDrawListener(() -> {
                pushInsets();
                return true;
            });
            /* 两种时机都挂上：某些 ROM 上首次布局只有其中一条会触发 */
            webView.getViewTreeObserver().addOnGlobalLayoutListener(this::pushInsets);

            /* 页面首次加载可能晚于监听就绪（evaluateJavascript 打在空文档上会丢），
             * 延时补一次，保证初始值送达，避免残留旧值把壳压矮。 */
            webView.postDelayed(this::pushInsets, 1500);
        });
    }

    private void pushInsets() {
        WebView webView = bridge != null ? bridge.getWebView() : null;
        if (webView == null) return;

        WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(webView);
        if (insets == null) return;

        float density = getResources().getDisplayMetrics().density;
        if (density <= 0f) return;

        Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
        Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());

        int kb = Math.max(0, Math.round(ime.bottom / density));
        int top = Math.max(0, Math.round(bars.top / density));
        int bottom = Math.max(0, Math.round(bars.bottom / density));

        /* 判等跳过跨界调用；但每约 3 秒兜底重发一次 ——
         * 页面重载（HMR / 刷新 / 崩溃恢复）会丢掉 html 上的内联变量，
         * 而那时数值没变、判等会把它当成「无需更新」，壳就一直停在错误高度。 */
        tick = (tick + 1) % 180;
        boolean changed = kb != lastKb || top != lastTop || bottom != lastBottom;
        if (tick != 0 && !changed) return;
        lastKb = kb;
        lastTop = top;
        lastBottom = bottom;

        String js = "(()=>{const s=document.documentElement.style;"
            + "s.setProperty('--kb-native','" + kb + "px');"
            + "s.setProperty('--safe-top','" + top + "px');"
            + "s.setProperty('--safe-bottom','" + bottom + "px');})()";
        webView.evaluateJavascript(js, null);
    }
}
