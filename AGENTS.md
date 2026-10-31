# Phrontis Mobile

工程规则的唯一维护处在主仓 `E:\Projects\KnowledgeRecorder\AGENTS.md`（在主仓开的会话每轮自动注入；本仓只放主仓管不到的差异化规则）。

硬规则：

- **push 永远等用户明确指令**：commit 可随改动本地进行，`git push` 一律等用户说推再推（与主仓同规，2026-10-31 拍板）。
- 同步协议 v1 冻结在 `docs/design.md` §2.1，改协议先改文档再动代码，两仓契约脚本都要过（`scripts/verify-sync.mjs` + 主仓 `.AGENT/scripts/phone-companion/verify-companion-protocol.mjs`）。
