package com.lousync.phrontis;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

/**
 * 键盘高度桥（2026-11-06）。
 *
 * 为什么必须写到原生层：
 * Android 15（targetSdk 35）起强制 edge-to-edge，窗口不再随输入法缩放。此时 Web 侧三条路都拿不到键盘高度：
 *   1. interactive-widget=resizes-content 是 Blink 特性，**没有接入 WebView**（no-op）；
 *   2. visualViewport 在 WebView 里要 Chrome 139+ 才会因 IME 收缩，低于该版本毫无信号；
 *   3. Capacitor 自己的 CapacitorWebView.edgeToEdgeHandler() 注册了 insets 监听，
 *      只取 systemBars | displayCutout，然后 return WindowInsetsCompat.CONSUMED —— IME inset 被丢弃。
 *
 * 原生应用（Flutter 的 MediaQuery.viewInsets、RN 的 KeyboardAvoidingView）都是直接读系统 IME inset，
 * 这里补上同一层：把 IME 高度换算成 CSS px 注入 --kb-native，前端壳层高度扣掉它。
 *
 * 实现要点：
 * - 用 ViewCompat.getRootWindowInsets() **主动读**，不 setOnApplyWindowInsetsListener ——
 *   后者会顶掉 Capacitor 的 edge-to-edge 处理器（状态栏/刘海 margins 会跟着坏）。
 * - 用 addOnGlobalLayoutListener 触发：键盘弹出/收起必然引起布局变化。
 * - 只在数值变化时 evaluateJavascript，避免滚动期间频繁跨界调用。
 * - getInsets() 返回物理像素，除以 density 才是 WebView 的 CSS px。
 */
public class MainActivity extends BridgeActivity {

    /** 上一次注入的键盘高度（CSS px）；-1 = 尚未注入过 */
    private int lastKbCssPx = -1;
    /** 帧计数：用于周期性兜底重发，见 pushKeyboardInset */
    private int tick = 0;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        hookKeyboardInset();
    }

    private void hookKeyboardInset() {
        WebView webView = bridge != null ? bridge.getWebView() : null;
        if (webView == null) return;

        /* post 之后再注册：onCreate 阶段 WebView 可能还没 attach，
         * 此时 getViewTreeObserver() 拿到的是临时实例，listener 会随 attach 一起丢。 */
        webView.post(() -> {
            /* 触发时机很关键：adjustNothing + edge-to-edge 下窗口的尺寸和位置都不变，
             * addOnGlobalLayoutListener 很可能一次都不回调（视图树没重排）。
             * OnPreDrawListener 每帧绘制前必到 —— 键盘弹起必然引起重绘，信号一定拿得到；
             * 内部先判等，高度没变就直接 return，每帧开销只是一次 insets 读取 + 一次比较。 */
            webView.getViewTreeObserver().addOnPreDrawListener(() -> {
                pushKeyboardInset();
                return true;
            });
            /* 两种时机都挂上：某些 ROM 上首次布局只有其中一条会触发 */
            webView.getViewTreeObserver().addOnGlobalLayoutListener(this::pushKeyboardInset);

            /* 页面首次加载可能晚于监听就绪（evaluateJavascript 打在空文档上会丢），
             * 延时补一次，保证初始值 0 一定送达，避免残留旧值把壳压矮。 */
            webView.postDelayed(this::pushKeyboardInset, 1500);
        });
    }

    private void pushKeyboardInset() {
        WebView webView = bridge != null ? bridge.getWebView() : null;
        if (webView == null) return;

        WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(webView);
        if (insets == null) return;

        Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
        float density = getResources().getDisplayMetrics().density;
        if (density <= 0f) return;

        int cssPx = Math.max(0, Math.round(ime.bottom / density));

        /* 判等跳过跨界调用；但每约 3 秒兜底重发一次 ——
         * 页面重载（HMR / 刷新 / 崩溃恢复）会丢掉 html 上的内联变量，
         * 而那时高度没变、判等会把它当成「无需更新」，壳就一直停在无键盘的高度。 */
        tick = (tick + 1) % 180;
        if (tick != 0 && cssPx == lastKbCssPx) return;
        lastKbCssPx = cssPx;

        webView.evaluateJavascript(
            "document.documentElement.style.setProperty('--kb-native','" + cssPx + "px')",
            null
        );
    }
}
