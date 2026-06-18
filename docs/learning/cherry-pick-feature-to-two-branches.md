# 一份功能同时进两个分叉分支:cherry-pick vs merge,以及分支清理

## 场景

仓库有两条长期分支:
- `main` —— 随时打包上线;某个功能必须进它。
- `dev` —— 夹了一大堆别人的在研功能;测试同学的版本从 dev 出,所以功能**也得**进 dev。

`main` 和 `dev` 已经严重分叉(实测 main 独有 2、dev 独有 179),**谁都不能整体合进谁**。一份功能要同时落到两条分叉分支上——这就是 cherry-pick 的主场。

一个 PR 只能合进一个 base 分支 → 要进两条分支 = **两个 PR,两个 head 分支**。这不是"乱",是结构使然。

## 核心判断:什么时候 cherry-pick 干净

cherry-pick 是把"某个提交引入的 diff"重放到目标分支的 tip 上。冲突只在一种情况发生:**目标分支改过同一文件的同一片区域**。所以决策不靠感觉,靠两步只读核查:

1. **特性是否自包含** —— 这次只 +457/−0(多为新增文件 + 对已存在文件的纯增量 hook:注册一个 tool、透传一个 env)。不依赖源分支独有的重构/迁移。
2. **目标分支有没有动过特性要改的"已存在文件"** —— 逐个文件查:
   ```bash
   # MB = 特性分支与目标分支的共同祖先
   MB=$(git merge-base origin/main origin/feat/xxx)
   for f in 这些已存在文件...; do
     echo "$(git diff --name-only $MB..origin/main -- "$f" | wc -l)  $f"
   done
   # 全为 0 → 这些文件 main 没碰过 → cherry-pick 零冲突
   ```
   本案 7 个已存在文件 main 全是 0 → 干净。

> 注意 merge-base 可能很老:`main` 自共同祖先以来可能已经前进了几十个文件。"diff 只有 +457"是 **3-dot**(`main...feat`,以 merge-base 为基准)给的假象,不代表 main 没前进。判冲突要看的是 **main 有没有动过特性碰的那几个具体文件**,不是看特性 diff 大小。

## 什么时候**别**用 cherry-pick(改用 merge / rebase)

- **提交相互依赖、数量多**:摘一个要连带摘前置,漏一个就语义损坏 → 反复冲突。整支要的话直接 merge。
- **特性依赖源分支独有的重构/迁移**:目标分支没那次重构,摘过去能 apply 但**编译/语义坏**(无声的坑,比冲突更危险)。
- **目标分支改过同一片区域**:核查里出现非 0,要准备手动解冲突,评估值不值。

## 关键副作用:cherry-pick 会产生"重复提交"

cherry-pick 生成**新的 SHA**(同样的改动,不同提交)。于是同一份逻辑改动在 main 和 dev 上是两个不同 SHA。日后两条分支若再彼此 merge,git 可能认不出是同一改动 → **重复冲突**。

- 本案改动是新增文件 + 增量,即便重复合并,冲突也极小、可自动解 → 可接受。
- 若改动是大段改写,要警惕。规避手段:用 `git cherry-pick -x`(在提交信息里留 `(cherry picked from commit ...)`,方便日后人/工具识别),或约定一个方向为真相源、另一边只摘不回流。

## 不污染当前工作区的做法:git worktree

当前分支(如 `feat/insight-markdown-editor`)有未提交改动时,**别 `git checkout` 切走、也别 stash**(都可能扰动工作区)。用独立 worktree 旁路操作:

```bash
git fetch origin
git worktree add -b feat/xxx-main /tmp/wt-xxx origin/main   # 基于 main 拉薄分支,独立目录
git -C /tmp/wt-xxx cherry-pick <c1> <c2> <c3>               # 按时间顺序(老→新)摘真实提交,跳过 merge 提交
git -C /tmp/wt-xxx push -u origin feat/xxx-main
gh pr create --base main --head feat/xxx-main ...
git worktree remove /tmp/wt-xxx                              # 用完即删,原工作区全程没动
```

要点:
- cherry-pick 只摘**非 merge 的真实提交**(`git log --no-merges base..feat`),顺序老→新。
- 给 dev 的那个 PR 通常**不用 cherry-pick**——现成的特性分支本就基于共同祖先,直接 `gh pr create --base dev --head feat/xxx` 即可。
- worktree 让"拉第二个分支"这件事不落到主工作目录,所谓"很乱"不会发生。

## 分支会不会满天飞?——会,所以要当一次性资源管

feature / cherry-pick 交付分支都是**短命的(short-lived)**:它的唯一使命是承载一个 PR,**合并即作废**。留着不删才是"满天飞"的根因。业界(GitHub Flow / trunk-based)的标准管法:

**1. 远端:PR 合并即自动删 head 分支**
GitHub 仓库 Settings → General → 勾选 **"Automatically delete head branches"**。此后任何 PR 合并,GitHub 自动删掉那条 head 分支。这是治本的一招,一次设置长期省心。
> 注意:这只删**远端**分支;你本地的同名分支和 remote-tracking 引用不会自动消失,要靠下面的本地清理。

**2. 本地:定期 prune + 删已合并分支**
```bash
git fetch --prune                 # 删掉远端已不存在的 remote-tracking 引用(origin/feat-xxx)
git branch --merged dev           # 列出已并入 dev 的本地分支(确认安全可删)
git branch -d feat/xxx            # -d 只删已合并的(安全);未合并要 -D(强删,慎用)
```
节奏:**每次自己的 PR 合并后顺手删本地 + worktree**;再加每周一次 `git fetch --prune` 扫一遍存量。

**3. worktree 即用即删**
```bash
git worktree remove /tmp/wt-xxx   # 删目录
git worktree prune                # 清理失效的 worktree 记录
git worktree list                 # 定期看一眼有没有忘删的
```

**4. 命名约定 = 自带过期标签**
`feat/`、`fix/`、`chore/` 前缀 + 简短主题(本案 `feat/chat-knowledge-search`、交付分支 `feat/chat-knowledge-search-main`)。看前缀和名字就知道归属和用途,便于批量识别清理。交付用的临时分支可加 `-main`/`-release` 后缀,标明"摘出去交付用、合完即弃"。

**什么分支不删:** 长期分支(`main`、`dev`)、需要留存的 `archive/*` 快照。其余 feature 分支没有"留着以后可能用"的理由——历史已在 main/dev 里,留分支只增噪音。

## 一句话决策表

| 情况 | 选择 |
|---|---|
| 一份自包含功能进两条分叉分支 | 两个 PR;dev 用原分支 merge,main 用 cherry-pick 薄分支 |
| 目标分支没动过特性碰的文件 | cherry-pick 零冲突,放心摘 |
| 提交多/相互依赖/依赖源分支重构 | 别 cherry-pick,merge 整支或重新基于目标分支做 |
| 当前分支有未提交改动还要操作别的分支 | git worktree 旁路,别 checkout/stash |
| 分支合并后 | 删!远端开 auto-delete,本地 `fetch --prune` + `branch -d`,worktree `remove`+`prune` |
