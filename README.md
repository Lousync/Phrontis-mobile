# Phrontis Mobile

Phrontis（本地优先学习生活操作系统，桌面主仓库 [KnowledgeRecorder](https://github.com/Lousync/Phrontis)）的手机端 —— **本地优先的双端应用**：手机自带存储、离线全功能，与电脑同网时对账式同步（局域网直连、扫码配对、无云无账号）。

- **状态**：M0–M4 完成（v0.6.0），M5 语音输入待做
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

### 打安卓 APK

构建链已装在 `D:\develp`（不在 C 盘）：Android Studio 2026.2.2.8（IDE + JBR）、JDK 21（构建用，Gradle 8.11.1 不支持更高）、Android SDK（platform-35 / build-tools 35.0.0 / platform-tools）、Gradle 缓存。gradle wrapper 发行包走腾讯镜像（官方源的重定向 CDN 在国内部分网络下 TLS 握手失败）。

```bash
npm run android:apk      # 产物：android/app/build/outputs/apk/debug/app-debug.apk（约 4MB）
```

传到手机直接安装（需允许「安装未知来源应用」）。开发期更顺手的路径：

- `npm run android:open` —— Android Studio 打开工程，连真机点 Run（需 USB 调试）
- `npx cap run android --livereload --external` —— 热刷新
- Chrome `chrome://inspect` —— 看 WebView 控制台

## 当前进度

- [x] 需求讨论与架构拍板（数据归属 / 同步粒度 / 技术栈 / AI 形态）
- [x] 可交互原型（四模块 + 会话管理 + 语音模拟 + 用量 + 设置）
- [x] M0：Capacitor 脚手架 + 主题令牌移植 + 原型组件化（APK 可构建）
- [x] M1：配对 + 同步基建 —— 记账一条流双端打通（协议 v1，仅 `ledger` 域）
- [x] M2：记账 / 日程全功能 —— 同步形态账本 + 编辑删除墓碑 + 月度统计；日程加域
- [x] M3：笔记 —— 电脑笔记按需缓存（1.5M 字符 LRU）+ 手机笔记上行收件箱
- [x] M4：AI 直连 —— OpenAI 兼容 + 7 工具 + 确认卡真写入（电脑档 2026-11-06 移除）
- [x] 0.4 / 0.5：备忘录式壳层 C（大标题 + 5 页签浮坞 + 圆形扩散转场）· 7 套主题 · 8 家 AI 预设卡
- [ ] M5：语音输入（云端 SenseVoiceSmall 直连 + 点击切换状态机）
- [ ] M6：本地通知 + APK 发布（tag `v<ver>-mobile`）+ 应用内自动更新

版本号单一真相源是 `package.json`：界面的版本行（`__APP_VERSION__`）与 Android 的 `versionName` / `versionCode` 都从它派生，抬版只改这一处。
