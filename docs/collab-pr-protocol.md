# 协作 PR 协议

> **通用 PR 规范**,octo-agent 文档仓与 UXAI 代码仓的 PR 都适用(分支名按各仓实际)。
> octo-agent 文档默认直接 commit dev、无需 PR;**UXAI 代码改动走 PR,遵守本协议**。
> 提 PR 前通读;仓库定位见 [CLAUDE.md](../CLAUDE.md)。

---

## 0. 分支模型

| 分支 | 是什么 | 能不能动 |
|---|---|---|
| `main` | 纯 opencode 上游源码(历史基线) | ❌ 不要把 PR 提向 main |
| `dev` | **文档主线**,所有文档 PR 的 base | ✅ PR 目标都是 `dev` |
| `dev-xxx` / `feat-xxx` | 你的工作分支 | ✅ 从最新 `dev` 切 |

**铁律:永远从最新 `dev` 切分支。** 动手前先 `git fetch origin && git checkout dev && git pull --ff-only`。

**PR 合并后立刻删分支**(去 GitHub 仓库 Settings → General 开 "Automatically delete head
branches",不依赖人工记得删)。删分支不影响追溯:commit 已经在目标分支的祖先链上,PR 页面
(标题 / 描述 / diff / 评论)在 GitHub 侧独立永久保留,不需要额外维护"分支 ↔ 改动"对照表。

---

## 1. 一个 PR 只做一件事

PR 跟踪的是**分支**,开着没合期间任何推到该分支的 commit 都会自动并进这个 PR。
→ 一 PR 一主题;无关的活,从 `dev` 另开分支。

---

## 2. cherry-pick / rebase / revert 后要核对净 diff

`cherry-pick` 把原 commit 的 diff 重新应用一遍,**不携带**你之前针对旧 base 做的手工冲突解决。
cherry-pick / rebase 到新 base 后,必须重新核对当初手工解决过的点是否还在,别假设"改过就一定还在"。

**revert 同理,而且更容易骗过自己**:一次 revert 多个提交时,commit message 里列的回退范围是**声明**,
不是事实。改完跑一次 `git diff <base>...<head> --stat` 核对——净 diff 才是这个 PR 真正要合进去的东西。

> 踩过的坑(2026-08~09,UXAI PR #750):一个 revert 提交声明回退 6 个 commit(含另一个提交里的
> `showGenerating` 守卫移除),实际漏退了那一条,于是一个**未被声明的行为变更**被夹带进一个自称
> "净 diff 仅 1 个 CSS 文件"的 PR。写 PR 描述的人和审的人都按 commit message 理解,没人看净 diff。

---

## 3. 别重复写已有的文档

改 spec / ADR / learning 前,先 `git log --oneline` + 翻 `docs/` 现有文件,确认这块是不是已经有人写过。
复用 / 续写现成的,别按"我以为还没有"重建。

---

## 4. PR 标题与正文（团队约定）

- 标题走 conventional:`<type>(<scope>): <描述>`,`type` ∈ `docs | feat | fix | chore | refactor`;
  `scope` 填文档域,如 `spec` / `adr` / `architecture` / `handoff`
- 正文一句话说清意图("这个 PR 改了 X、为什么这样改")。diff 比长篇转述准。
- 不分 feat / fix:能对应到 `docs/specs/README.md` 登记表里某个已编号 spec 的,标题末尾追加
  `(SPEC-INS-NNN)`;很多 fix 其实就是修某个 spec 覆盖的功能,同样适用。匹配不到(全局性修复 /
  跨领域改动 / 不涉及具体 spec 的小改动)不必强行凑编号。

> ⚠️ **更正(2026-09-20):上面这些不只是人工约定,UXAI 仓的合规机器人还活着,而且真的会关 PR。**
> (此前本节写的是"已随上游 CI 一起移除 `pr-standards` / 合规机器人",与实际不符 —— 实测 PR #904
> 收到了两条合规评论并被打上 `needs:compliance` / `needs:issue` 标签。)
>
> UXAI `.github/workflows/` 里 **`pr-standards` 与 `compliance-close` 均为 active**:
>
> | workflow | 触发 | 行为 |
> |---|---|---|
> | `pr-standards` | PR opened / edited / synchronize | 标题不合 conventional → 打 `needs:title` + 评论;缺 linked issue → 打 `needs:issue` + 评论;正文缺模板小节 → 打 **`needs:compliance`** + 评论 |
> | `compliance-close` | **每 30 分钟定时** | 扫所有带 `needs:compliance` 的 open PR,合规评论超过 **2 小时**就**直接关闭** |
>
> **`.github/TEAM_MEMBERS` 里全是上游 opencode 的人,本仓成员一个都不在** —— 所以我们每个人提的
> PR 都会走这套检查。想彻底静音,把本仓成员加进那个文件(`pr-standards` 和 `pr-management` 都会
> `grep -qxF "$LOGIN" .github/TEAM_MEMBERS` 后直接跳过),这是一次性的修法,比每个 PR 去凑模板划算。
>
> 在那之前,提 PR 要知道的两条:
>
> - **`fix:` / `chore:` / `test:` 开头的 PR 需要 linked issue**;`docs:` / `refactor:` / `feat:`
>   会跳过这项检查(`pr-standards.yml` 的 `skipIssueCheck`)。没有对应 issue 又必须用 `fix:` 时,
>   正文写清楚没有 issue 的理由即可 —— 那只会留下一个标签和一条评论,**不会**触发自动关闭。
> - **真正会关 PR 的只有 `needs:compliance`**(正文缺模板小节)。**2 小时内合掉、或者编辑正文补上
>   `.github/pull_request_template.md` 的小节骨架**,都能避免。PR #904 没被关掉只是因为它在
>   1 小时内就合并了,不是因为机器人不工作。

---

## 5. 提交前自检

- 改了链接 / 路径:确认没留死链(`grep` 一下目标文件还在不在)
- ADR 一旦落地不删;改决策开新 ADR,在旧 ADR 顶部链过去
- markdown 能正常渲染

---

## 6. commit message

- 走 conventional 格式
- AI 协助产生的提交,结尾加一行 `Co-Authored-By: Claude <noreply@anthropic.com>`
- **未经项目 owner 明确确认,不要 `git push` 到共享分支、不要合 PR**(见 [CLAUDE.md](../CLAUDE.md))

---

## 7. owner 怎么审

- **先看净 diff,再看描述**:`git diff <base>...<head> --stat` 是唯一事实,PR 描述和 commit
  message 都是转述。两者对不上时以 diff 为准,并把差异当成一个待澄清项提出来(见 §2 的坑)
- **意图线**:diff 改的内容是不是 owner 当初要的——提 PR 时一句话说清意图即可
- **一致性线**:有没有引入死链、跟现有 spec / ADR 冲突、重复造文档
- **验证线**:PR 声称"测试全过 / typecheck 绿"时,在**分支合上最新 base 之后**复跑一次。分支落后
  base 较多时,直接在分支 HEAD 上跑出来的失败可能与本 PR 无关(base 上的接口/类型已经变了),
  反过来也可能掩盖真实冲突
