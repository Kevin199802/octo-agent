# CLAUDE.md — octo-agent(文档主线)

> 本仓是 octo-insight 设计文档主线,代码已归档,见 [README](README.md)。
> 凡修改本仓的人或 AI,先读以下规则。

## 仓库定位

- **承载**:`docs/`(架构、specs、ADR、learning、集成手册)、`ROADMAP.md`、本 `CLAUDE.md`
- **不承载**:可运行代码(归档在 `v1-insight-impl-archive` / `archive/insight-impl-2026-06`)
- **真实产品代码**:内网 UXAI 仓 <https://github.com/MyHeavenDyf/UXAI>

---

## 提交规则（强制）

**未经用户明确确认,禁止执行任何 `git commit` 或 `git push`。** 完成任务后列出变更文件并等待确认,不得以任何理由自行提交。

**不接受任何含可执行代码 / 构建配置的 commit。** 唯一例外:明确把 archive 内容拉回 dev 恢复代码维护,且团队签字。

---

## 写 spec 的强制检查（强制）

架构决策类 spec(协议选择 / 接口形态 / 数据流向 / 上传下载等)落笔前必须：

1. **列 2–3 种业界常见做法做对比**（参考 AWS、阿里云、Stripe 等大型云服务），再选方案
2. 对"看起来能跑"的方案保持警惕,多问"为什么没人这么做"
3. spec 写完后专门 review 一次,假设自己第一次看到这个方案

涉及"做 UI / 做功能"的 spec,落笔前先排查**上游 opencode 是否已实现**（避免重复造轮子）,spec 顶部标注"上游已实现：✓/✗"。

**反例（曾发生的返工）**：base64 文件走 MCP 上传 / 让 LLM 把 JSON 转 mermaid / 设计 batch_xxx 工具替代 xxx(items[])。

---

## 文档维护

- **ADR** 一旦落地不删;改决策开新 ADR,在旧 ADR 顶部链过去
- **spec 变更**走 PR review（架构级尤其）;**learning 笔记**作者自负,可直接编写
- **重复内容走引用**：spec / ADR / learning 各司其职,事实层重叠时剥离换引用,不复制粘贴
- **死链 / 过期路径**:改动涉及的引用顺手修正,不留烂链

---

## 与 UXAI 仓的关系

- 代码改动:在 **UXAI 仓**改、跑、提 PR
- 设计变化需落 spec / ADR / learning:在**本仓**提 PR
- 两仓无代码同步;文档以本仓为准
- UXAI 仓的 CLAUDE.md 是其**全仓共享**文件,**不要为 insight 单独改它**;insight 的工作约束以**本仓 CLAUDE.md + docs/** 为准

---

## 代码在 UXAI、字典在本仓（改代码时回看）

以下文件记录的约束,代码在 UXAI 改动时需对照回看本仓:

- [docs/insight-debugging.md](docs/insight-debugging.md) — `[octo:*]` 日志 → bug 定位字典;UXAI 改日志前缀 / 字段 / `window.octoDebug` 命令时同步更新此字典
- [docs/intranet-handoff.md](docs/intranet-handoff.md) — 桌面壳 `window.api` API 依赖清单 + MCP / 文件上传对接契约
- [docs/specs/ui/design-assets-needed.md](docs/specs/ui/design-assets-needed.md) — UI 遇 SVG 占位 / 数据缺失时追加,给设计师的可交付清单

---

## 归档

- 旧实现代码在 `archive/insight-impl-2026-06` 分支(需参考旧实现时查)
- 完整 ADR 列表见 [docs/adr/](docs/adr/)
