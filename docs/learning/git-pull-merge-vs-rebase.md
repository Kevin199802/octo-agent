# `git pull` 的三种策略：merge / rebase / fast-forward

> 背景：执行 `git pull` 遇到本地与远端分叉时，`--merge` 会报错，正确写法是 `--no-rebase`。本篇深挖三种拉取策略的机制差异、历史线长什么样、以及什么时候用哪个。

---

## 一句话

`git pull = git fetch + 合入`，"合入"有三种策略：**merge**（`--no-rebase`）、**rebase**（`--rebase`）、**fast-forward**（`--ff-only`）。`--merge` 这个旗标根本不存在；想用 merge 策略，正确写法是 `--no-rebase`（或直接 `git pull`，前提是 config 默认值是 merge）。

---

## 为什么 `--merge` 不存在

Git 在 2.27 之前默认 pull = merge，不需要旗标；2.27 起因为「默认 merge 还是 rebase」争议较大，pull 改成了「若未配置则警告并要求明确」。为了兼容历史，表达「我要 merge」的旗标不叫 `--merge`，而叫 **`--no-rebase`**（"不要 rebase，也就是 merge"）。这是 git 命名中比较反直觉的一处。

```bash
git pull          # 取决于 pull.rebase 配置（未配置则报 warning）
git pull --no-rebase  # 明确：用 merge 策略
git pull --rebase     # 明确：用 rebase 策略
git pull --ff-only    # 明确：只允许 fast-forward，不 merge 也不 rebase
```

---

## 三种策略的机制和历史线

### 场景基础

```
          A - B (本地 dev)
         /
...-- X
         \
          C    (origin/dev)
```

本地有提交 B，远端有提交 C，共同祖先是 X。这就是"分叉"状态，也就是 `git status` 显示 "have diverged" 的情况。

---

### 策略一：merge（`--no-rebase`）

```bash
git pull --no-rebase
```

**做了什么**：`git fetch` 拿到 C，然后 `git merge origin/dev`，在本地生成一个**合并提交 M**。

```
          A - B
         /     \
...-- X          M   (合并提交，有两个 parent)
         \     /
          C
```

**特点**：
- 历史呈菱形，忠实记录"B 和 C 是并行发生的"
- 如果 B 和 C 改了同一行，停在冲突处，手动解决 → `git add` → `git merge --continue`（或 `git commit`）
- 合并提交 M 永久保留，`git log --graph` 可以看到分叉和汇合

---

### 策略二：rebase（`--rebase`）

```bash
git pull --rebase
```

**做了什么**：`git fetch` 拿到 C，然后 `git rebase origin/dev`——把本地的提交 B **重新播放**到 C 后面，生成一个内容相同但 SHA 不同的新提交 B'。

```
...-- X - C - B'   (线性历史)
```

**特点**：
- 历史线性，看起来像「先有 C，再有 B」
- B 的 SHA 会改变（变成 B'），如果 B 已经推到远端被别人拉过，rebase 后 force-push 会让别人的历史乱
- 如果 B 和 C 改了同一行，停在冲突处，解决 → `git add` → `git rebase --continue`

---

### 策略三：fast-forward only（`--ff-only`）

```bash
git pull --ff-only
```

**做了什么**：只允许"直接把本地分支指针往前移"——即**本地没有领先远端的提交**。若分叉（本地有远端没有的提交），直接报错退出，什么也不做。

```
# 本地没有新提交时（远端领先）：
...-- X - C           → 本地指针移到 C，干净成功

# 本地有新提交时（分叉）：
fatal: Not possible to fast-forward, aborting.
```

**特点**：
- 最保守，绝不产生合并提交或重写历史，只是"追上去"
- 报错时需要手动决策：要 merge 还是 rebase

---

## 对比表

| | `--no-rebase` | `--rebase` | `--ff-only` |
|---|---|---|---|
| 本地提交 SHA | 不变 | **改变**（重写） | 不变（指针移动，无新 commit） |
| 历史形状 | 菱形（有 merge commit） | 线性 | 线性（只前进） |
| 分叉时行为 | 生成合并提交 | 重播本地提交 | **报错退出** |
| 冲突解决方式 | `git merge --continue` | `git rebase --continue` | 无冲突（分叉直接拒绝） |
| 已推到远端的提交 | 安全 | 危险（需 force-push） | 安全 |

---

## 什么时候用哪个

### 用 `--no-rebase`（merge）
- 个人习惯，且不在乎历史线有分叉
- 本地提交**已经推到远端**，不能重写 SHA
- 多人协作的**共享分支**（如 main/dev），保留"谁什么时候合入"的历史痕迹

### 用 `--rebase`
- **私有 feature 分支**，还没推到远端（或推了但只有你一个人用）
- 想保持线性历史，方便 `git bisect` / `git log` 查问题
- 文档仓这种提交频率低的仓库，偶尔两人分叉时用 rebase 会比较干净

### 用 `--ff-only`
- CI 流水线或自动化脚本，"能追上就追，不行就报错让人工决策"
- 强制"只能快进"的保守策略（如 main 分支不允许本地提交，只允许 merge 进来）

---

## 配置默认策略

不想每次手打旗标，可以设全局默认值：

```bash
# 全局默认用 merge
git config --global pull.rebase false

# 全局默认用 rebase
git config --global pull.rebase true

# 全局默认只允许 fast-forward
git config --global pull.ff only
```

设完之后，直接 `git pull` 就不会出 warning，按设定的策略走。

---

## 遇到冲突怎么办

### merge 冲突（`--no-rebase`）

```bash
git pull --no-rebase
# → CONFLICT (content): Merge conflict in foo.md
# → Automatic merge failed; fix conflicts and then commit the result.

# 1. 打开冲突文件，找 <<<< ==== >>>> 手动选择保留哪段
# 2. git add foo.md
# 3. git commit       ← 产生合并提交
```

### rebase 冲突（`--rebase`）

```bash
git pull --rebase
# → CONFLICT (content): Merge conflict in foo.md
# → error: could not apply a308ba3... 你的提交信息

# 1. 解决冲突文件
# 2. git add foo.md
# 3. git rebase --continue    ← 继续下一个提交（若本地有多个提交，循环这一步）
# 4. 若想放弃 rebase 回到原状：git rebase --abort
```

---

## 本次实际情况复盘

```
本地 dev:    ... - f9b2de6 - a308ba3   ← SPEC-INS-014
                 ↑ 共同祖先
远端 dev:    ... - f9b2de6 - a1d9af0   ← render refetch 踩坑笔记
```

- 工作区干净，**没有文件内容冲突**，只是 SHA 层面的分叉
- 两边都是文档 commit，内容不重叠，无论 merge 还是 rebase 都会干净完成，不会停在冲突处
- `git pull --rebase` 的结果：`... - f9b2de6 - a1d9af0 - a308ba3'`（线性）
- `git pull --no-rebase` 的结果：两个提交汇入一个合并提交（菱形）

---

## 相关

- [cherry-pick-feature-to-two-branches.md](cherry-pick-feature-to-two-branches.md) — 分叉分支之间搬运提交；cherry-pick vs merge 的选择逻辑
