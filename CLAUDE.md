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

**新建 insight 专属 spec 要编号时,先读 [docs/specs/README.md](docs/specs/README.md) 登记表**,取当前最大 `SPEC-INS-NNN` + 1,不要凭记忆猜(撞号教训见该表脚注)。

**每份实现类 spec 起草阶段就要有「验证」章节（强制，不是实现完再补）**：外网验证写本地开发环境 / 公网可复现的步骤（typecheck、单测、mock 数据、纯前端交互等不依赖内网真实服务或数据的都算外网）；只有当验证确实依赖**内网真实数据 / 服务**（真实 MCP 工具调用、真实 S3、真实内网部署跑通等）时才另加「内网验证」节——不是每份 spec 都要有内网验证节,外网就能走完全部验证的不用硬凑一节。凡涉及**新增/改动服务端路由、IPC handler、agent 配置等需要重启进程才生效**的改动，验证步骤开头要显式提示"验证前先重启 xxx 进程/服务"。**但"新路由 404"不要默认归因于"没重启"就停止排查**——实测踩过更深的坑：UXAI 的 opencode server 同时有两套后端（普通 Hono 路由 vs 类型化 Effect HttpApi，本仓开发/预览渠道默认走后者），照抄了一个在当前后端选择下其实早已是死代码的模块，改完重启多少次都是 404，排查了很久才定位到是选错了路由框架，不是没重启。涉及新增服务端接口的 spec，落笔前先确认目标代码库有没有类似"多套并行实现，只有一套真正在跑"的情况。

**反例（曾发生的返工）**：base64 文件走 MCP 上传 / 让 LLM 把 JSON 转 mermaid / 设计 batch_xxx 工具替代 xxx(items[])。

---

## 文档维护

- **spec 完成 / 变更后,更新 [ROADMAP.md](ROADMAP.md)**;新建 / 撞号修复带编号的 spec 后,同步更新 [docs/specs/README.md](docs/specs/README.md) 登记表
- **内网版本改动记录在 [docs/releases/](docs/releases/)**,起草 / 增量更新 / 定版按其 README 流程执行
- **ADR** 一旦落地不删;改决策开新 ADR,在旧 ADR 顶部链过去
- **spec / ADR / learning 改完直接 commit,无需开 PR**(commit / push 前仍需用户确认)
- **重复内容走引用**：spec / ADR / learning 各司其职,事实层重叠时剥离换引用,不复制粘贴
- **死链 / 过期路径**:改动涉及的引用顺手修正,不留烂链

---

## 与 UXAI 仓的关系

- 代码改动:在 **UXAI 仓**改、跑、提 PR(遵守 [collab-pr-protocol](docs/collab-pr-protocol.md));设计变化落 spec / ADR / learning:在**本仓**直接 commit(无需 PR)
- 两仓无代码同步;文档以本仓为准
- UXAI 仓的 CLAUDE.md 是其**全仓共享**文件,**不要为 insight 单独改它**
- **在 UXAI 开发 insight 的完整约束**(实施原则、查上游、工作目录、字典同步等)在
  [CLAUDE.uxai.md](CLAUDE.uxai.md) ——复制到 UXAI 本地、改名 `CLAUDE.md`、改文档仓路径一行即用
  (UXAI 已 gitignore `CLAUDE.md`,不污染团队共享文件)

---

## 归档

- 旧实现代码在 `archive/insight-impl-2026-06` 分支(需参考旧实现时查)
- 完整 ADR 列表见 [docs/adr/](docs/adr/)
