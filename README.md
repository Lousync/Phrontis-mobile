# Phrontis Mobile

Phrontis（本地优先学习生活操作系统，桌面主仓库 [KnowledgeRecorder](https://github.com/Lousync/Phrontis)）的手机端 —— **本地优先的双端应用**：手机自带存储、离线全功能，与电脑同网时对账式同步（局域网直连、扫码配对、无云无账号）。

- **状态**：方案与原型阶段（v0.1）
- **设计方案**：[docs/design.md](docs/design.md) —— 定位、域级同步协议、AI 两档、里程碑
- **可交互原型**：[prototype/index.html](prototype/index.html)（浏览器直接打开；含 AI/日程/记账/笔记/用量/设置 六 Tab 全部交互）
- **技术栈**（规划）：Capacitor + React + Tailwind + TypeScript

```
npm run dev      # （脚手架后）
```

## 当前进度

- [x] 需求讨论与架构拍板（数据归属 / 同步粒度 / 技术栈 / AI 形态）
- [x] 可交互原型（四模块 + 会话管理 + 语音模拟 + 用量 + 设置）
- [ ] M0：Capacitor 脚手架
- [ ] M1：配对 + 同步基建
