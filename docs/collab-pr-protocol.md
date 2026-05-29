# 外网协作 PR 协议

> **本文件供"协作开发者本人 + 其 AI 助手"在动手改代码、提 PR 之前通读。**
> 我们是多人在各自外网机器上、基于 fork 自 opencode 的同一仓库协作。本文把
> "怎么提一个能顺利合进来、不返工、不被治理机器人拦下"的规则写清楚。
>
> 仓库目录边界与改动政策见 [CLAUDE.md](../CLAUDE.md);架构见 [docs/architecture.md](architecture.md)。

---

## 0. 分支模型（先记死这三条）

| 分支 | 是什么 | 你能不能动 |
|---|---|---|
| `main` | **纯 opencode 上游源码**,不含任何业务定制 | ❌ 永远不要把 PR 提向 main |
| `dev` | **集成分支**,项目全部业务开发都在这里 | ✅ 所有 PR 的目标分支(base)都是 `dev` |
| `dev-xxx` / `feat-xxx` | 你的工作分支 | ✅ 从最新 `dev` 切出来 |

**铁律:永远从最新 `dev` 切分支。** 动手前先 `git fetch origin && git checkout dev && git pull --ff-only`,
再 `git checkout -b <你的分支>`。基于陈旧 `dev` 开工是后续所有冲突和"功能被覆盖"的根源。

---

## 1. 一个 PR 只做一件事（硬约束）

GitHub PR 跟踪的是**分支**,不是某次提交。PR 开着没合期间,**任何**推到该分支的 commit
都会自动并进这个 PR——不管它跟这个 PR 是不是同一主题。

> **口诀:一 PR 一主题;无关的活,从 `dev` 新开分支。**

违反的后果:
- 不相干的 commit 混进 PR,reviewer 看不清这个 PR 到底在干嘛;
- 半成品被 PR 合入一起带进 `dev`;
- 想单独回退某一块极难。

→ 开着的 PR 分支,只追加与这个 PR **同主题**的 commit(含按 review 意见做的修复)。要做别的功能,
`git checkout dev && git pull` 后另开分支。

---

## 2. cherry-pick 的坑（真实返工教训）

`git cherry-pick` 做的事是**把原始 commit 的 diff 重新应用一遍**。它**不携带**你之前针对某个
旧 base 做的**手工冲突解决**。

真实事故:有人在 fork 的旧 commit 上手工解决过一版冲突(把模型选择器接对),后来为了"直接在本仓库提交"
把工作 cherry-pick 到最新 `dev`——手工解决没跟过来,被覆盖的回退又回来了,白干一轮。

**规则:cherry-pick 或 rebase 到新 base 之后,必须重新核对当初手工解决过的冲突点是否还在。**
不要假设"我之前修过了就一定还在"。

---

## 3. 不要重写已经落地的共享功能

共享功能(模型切换、数据层、上传等)的**唯一真相在 `dev`**。改 UI / 改页面前:

1. 先 `git log --oneline` 看 `dev` 最近的相关 commit,确认这块是不是已经有人做过;
2. 复用 / rebase 取用现成实现,**不要按"我以为还没做"的心智重建**;
3. 尤其别把一个能用的真实组件换成"等以后接入"的硬编码占位——那等于回退。

（真实事故:空态页改版时把已落地的 `ModelSelectorPopover` 换成写死的 disabled 假胶囊,
因为开发时没意识到模型切换早已在 `dev` 合过了。）

---

## 4. PR 标题:必须 conventional commit 格式

仓库的 `pr-standards` 检查会校验标题,不合格打 `needs:title` 标签并评论。格式:

```
<type>(<scope>): <描述>
```

- `type` ∈ `feat | fix | docs | chore | refactor | test`
- `scope` 可选,填包名,如 `app` / `desktop` / `insight` / `opencode`
- 例:`feat(insight): 空态欢迎页改版`、`fix(desktop): Windows predev 平台 guard`

**注意 issue 要求**:`fix` / `chore` / `test` 类型的 PR **必须关联一个 issue**
(描述里写 `Closes #<号>`),否则打 `needs:issue`;`feat` / `docs` / `refactor` 豁免。

---

## 5. PR 正文:必须按模板填

仓库有 [.github/pull_request_template.md](../.github/pull_request_template.md),
治理机器人会检查必填 section,**缺失会在 2 小时后自动关闭 PR**。至少填:

- **Type of change**(勾选)
- **What does this PR do?**(说清改了什么、为什么这样改)
- **How did you verify your code works?**(贴验证手段:typecheck / 单测 / 端到端)
- **Checklist**(本地测过、无不相关改动)

⚠️ 模板原文警告:**粘贴大段明显 AI 生成的描述,PR 可能被忽略或关闭。** 写简洁、说人话、讲事实。

---

## 6. 团队成员豁免（推荐配置）

`pr-standards` / 合规检查对 **`.github/TEAM_MEMBERS` 名单内的作者全部跳过**(名单从 `dev` 分支读)。
这是 opencode 给团队成员留的正路:**外部贡献者**走完整 template + issue 流程,**内部成员**免去这层摩擦。

→ 内部协作者的 GitHub 登录名应加入 `.github/TEAM_MEMBERS`(该文件改动属 `.github/`,
需在 [architecture.md §5.4](architecture.md) 登记一条)。加入后,你的内部 PR 不再被
`needs:title` / `needs:compliance` / `needs:issue` 拦——但**标题仍建议遵守 §4 的 conventional 格式**作为团队约定。

---

## 7. 提交前自检（本地能跑的都先跑）

| 检查 | 命令 | 说明 |
|---|---|---|
| 类型 | `bun typecheck` | 全仓 turbo;**`git push` 的 pre-push 钩子会强制跑一遍**,不过就推不上去 |
| Lint | `bun run lint`（oxlint） | — |
| 单测 | 在**包目录内**跑,如 `cd packages/desktop-electron && bun test` | ⚠️ 仓库根有 guard,**不能从根目录跑测试** |
| Bun 版本 | — | pre-push 钩子校验本机 bun 版本须匹配根 `package.json` 的 `packageManager` 字段 |

`bun.lock` 注意:若本机 `~/.npmrc`(Windows 在 `C:\Users\<你>\.npmrc`)设了第三方镜像
(如 `registry=https://registry.npmmirror.com/`),会污染 `bun.lock` 的 tarball URL。
**别 commit 被污染的 lockfile**,先 `git checkout origin/dev -- bun.lock`。详见
[development.md §1.1](development.md#11-windows-开发者补充)。

---

## 8. commit message 约定

- 跟标题同样走 conventional 格式;
- AI 协助产生的提交,结尾加一行:
  ```
  Co-Authored-By: Claude <noreply@anthropic.com>
  ```
- **未经项目 owner 明确确认,不要 `git push` 到共享分支、不要合 PR**(见 [CLAUDE.md](../CLAUDE.md))。

---

## 9. 非业务包改动要登记

改了构建配置、接线文件、根 `package.json`、`bun.lock`、`.github/` 等**非业务包**文件,
必须在 [architecture.md §5.4](architecture.md) 补一条记录(改了什么、为什么)。
业务自由改区(`packages/app/src/pages/<agent>/`、`packages/agent/<agent>/`、`docs/`)不需要。

---

## 10. 合入侧（项目 owner）会怎么审

收到协作 PR,owner 侧按**两条线**过:

1. **分区政策线**:有没有碰"不动/限改"区(`packages/ui`、`packages/opencode`、`packages/sdk`、
   `app.tsx`、接线文件);非业务包改动有没有登记 §5.4;有没有动到别人的自由改区造成覆盖。
2. **意图线**:diff 改的内容,是不是 owner 当初要的。diff 告诉"改了什么",但不告诉"是不是想要的"——
   所以提 PR 时**一句话说清意图**("我做了 X")即可,不用长篇转述变更(diff 比文字准)。

审完给两类结论:可放心合 / 哪几块要回退或返工。
