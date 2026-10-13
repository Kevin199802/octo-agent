# design/ —— 上游内容，我们不维护

本目录的全部内容来自设计师团队维护的 **chart-design-advisor**，我们**只搬位置、不改内容**。
改设计方法论、图表规范、方法短卡请去上游提 PR，不要在本仓改。

| | |
|---|---|
| 上游仓库 | <https://github.com/peterbobidu/chart-design-advisor> |
| 当前同步版本 | **v0.6.8**（上游 commit `dc562a3`，同步于 2026-10-13） |

## 搬进来时做了什么

整目录平移，相对关系不变 —— 上游文件之间的 `../03-methods/`、`../VALIDATION.md` 这类链接**全部仍然成立**。
只改了两行：`README.md` 与 `description.md` 里指向包根的 SKILL.md 链接改成了 `../SKILL.md`。

**没搬进来的**：

| 不搬 | 为什么 |
|---|---|
| `SKILL.md` | 本 skill 的 SKILL.md 由我们维护（它是工作流和门禁）。上半段已把上游的设计规则抄进来并加了 `design/` 前缀 |
| `scripts/`（`check_package.py` / `check_prototype.py`） | 上游包自用的检查工具，本环境唯一门禁是 `verify.mjs`。**macOS 未装 Command Line Tools 时执行 `python3` 会弹系统安装窗**，不搬就少一个诱惑源。代价是 `delivery-gates.md` 里那条 `python3 .../check_prototype.py` 成为死链——它属于"新建独立 Vite 工程"分支，本环境永不走到，SKILL.md 已写明禁止执行 `design/` 下任何脚本 |
| `.github/` `.githooks/` `.gitignore` `AGENTS.md` `CONTRIBUTING.md` | 上游的仓库治理文件，生产包用不到 |
| `README.md` | 上游 README 引用了上面那几个治理文件，搬进来只会制造死链；包说明看本文件，原始 README 看上游仓 |

## 升级到上游新版本

1. `git clone` 或 `git pull` 上游仓，看一眼 `CHANGELOG.md` 与 `git log`
2. **整目录覆盖**本目录（按上面的清单排除），重做那两行链接修正，**不做任何 merge**
3. **diff 上游 `SKILL.md` 与本 skill SKILL.md 的上半段** —— 上游改了设计规则 / 按需读取表 / 新增入口文件，要同步抄进上半段并加 `design/` 前缀；下半段是我们的地盘，不受上游影响
4. 更新本文件的「当前同步版本」
5. 检查新增文件有没有与下半段重复或冲突的规则

> **分工**：上游 `04-references/prototype/hosted-project.md` 讲的是"接入既有工程与管道"的**通用原则**，
> 本 skill 下半段讲的是**本环境的具体命令、路径与失败码**。同一主题两边都写会互相冲突并白占上下文——
> 升级时按这条判断新内容该不该同步进上半段。冲突时以下半段为准（SKILL.md 开头已写明）。
