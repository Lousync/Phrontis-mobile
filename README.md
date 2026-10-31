# Phrontis Mobile

Phrontis（本地优先学习生活操作系统，桌面主仓库 [KnowledgeRecorder](https://github.com/Lousync/Phrontis)）的手机端 —— **本地优先的双端应用**：手机自带存储、离线全功能，与电脑同网时对账式同步（局域网直连、扫码配对、无云无账号）。

- **状态**：M0 完成（Web 应用组件化 + Capacitor 安卓壳就绪）
- **设计方案**：[docs/design.md](docs/design.md) —— 定位、域级同步协议、AI 两档、里程碑
- **可交互原型**（单文件版，已归档）：[prototype/index.html](prototype/index.html)
- **应用源码**：`src/` —— 原型已组件化为 React 应用（`npm run dev` 直接跑）
- **技术栈**：Capacitor 7 + React 19 + TypeScript + Tailwind v4

## 本地运行与真机测试

```bash
npm install
npm run dev          # 局域网可访问（--host 已开）：手机同 WiFi 开 http://<电脑IP>:5173
```

手机浏览器打开后可通过「添加到主屏幕」安装为独立全屏应用（PWA manifest 已配）。

### 打安卓 APK（需一次性安装 Android Studio）

1. 安装 [Android Studio](https://developer.android.com/studio)（含 SDK），首次启动按默认勾选装好 SDK Platform + Build-Tools；
2. 回到本仓库执行：

```bash
npm run android:apk      # 产物：android/app/build/outputs/apk/debug/app-debug.apk
```

3. 或 `npm run android:open` 用 Android Studio 打开工程，连真机点 Run（USB 调试）。
4. 真机调试：`npx cap run android --livereload --external`（热刷新）；Chrome `chrome://inspect` 看 WebView 控制台。

## 当前进度

- [x] 需求讨论与架构拍板（数据归属 / 同步粒度 / 技术栈 / AI 形态）
- [x] 可交互原型（四模块 + 会话管理 + 语音模拟 + 用量 + 设置）
- [x] M0：Capacitor 脚手架 + 主题令牌移植 + 原型组件化（APK 构建待装 Android Studio）
- [ ] M1：配对 + 同步基建
