# 仓库结构改造 — octo-agent 转为文档主线 + 实现归档

> 状态:草案 · 优先级 P0 · 规模 [M] · 领域 infra/repo · 类型:架构 + 实施 spec
> 创建:2026-06-06
>
> **本 spec 是历史决策记录,执行完后随当前 dev 分支整体归档**(tag `v1-insight-impl-archive` + branch `archive/insight-impl-2026-06`)。未来的 docs-only 主线不需要它继续指导工作,它只回答"为什么 2026-06-06 我们把这个仓变成文档仓"。

---

## 1. 两仓的真实关系(spec 的核心背景)

### 1.1 历史

| 仓 | 起源 | 定位(原本) | 定位(实际兑现) |
|---|---|---|---|
| **octo-agent**(本仓) | 外网设计 + 实验室,基于 opencode 上游 + insight 添加层 | 设计实验室 + reference implementation + 跟踪上游 opencode | 文档主线(架构 / spec / ADR / learning),代码部分**实际兑现度低** |
| **UXAI**(`MyHeavenDyf/UXAI`,内网) | 内网 fork(opencode + 内网业务定制) | 内网生产产品 | **真实运行的产品**,所有 bug 暴露点、所有用户活动 |

### 1.2 为什么走到"分家"这一步

过去 3 个月的实际工作模式:

1. **bug 99% 从 UXAI 暴露**(内网用户先踩坑)。再回溯到 octo-agent 改、合 PR。octo-agent 作为"先发现问题的实验室"这个假设**从未兑现**
2. **上游 opencode 跟踪**写在 CLAUDE.md / architecture.md 里,但 3 个月内**没有一次实际从上游同步代码**。这条原则是 aspirational(理想型)不是 load-bearing(承重型)
3. **双向 sync 维护成本高**:每次代码改动需在两仓之间 rsync / mirror,涉及路径转换、stub 漂移、cross-repo migration 冲突、SDK 重新生成。**单次 3-6 小时认知成本**
4. **本地 dev 在 octo-agent 跑不跑通**对实际工作流影响**极低** — 所有有意义的调试 + 联调都在 UXAI 上做

结论:octo-agent **作为可运行的 reference impl 已经名存实亡**,但**作为设计文档 + 历史思考记录的载体仍有独立价值**。把它**精简到只承担实际兑现的那部分**(文档),消除维护代价。

### 1.3 改造后两仓的关系

```
UXAI(内网,有代码)              octo-agent(本仓,纯文档)
─────────────────────────       ──────────────────────────────
- 产品代码完整                  - docs/architecture.md
- 跑 dev / 打包 / 出 release    - docs/specs/(含本 spec)
- 所有同事日常工作              - docs/adr/
- bug 暴露点                    - docs/learning/
- 提 PR                         - docs/intranet-handoff.md
                                - CLAUDE.md(本仓工作规则)
                                - ROADMAP.md(文档维护计划)
                                - archive/insight-impl-2026-06 分支
                                - v1-insight-impl-archive tag(完整历史代码)
```

**双向耦合**:几乎为零。

- UXAI 改代码 → 不需要同步任何东西到本仓
- 本仓改文档 → 也不要求 UXAI 反向引用(UXAI 同事按需自行访问本仓 docs)
- 仅在"设计变化要落 spec / ADR / learning"时,改本仓 docs(同事直接在本仓提 PR / commit)

### 1.4 历史代码归宿

UXAI 已经有本仓所有代码改动的镜像(SPEC-INS-010 / agent-attribution / useProjectDir / IPC baseDir 等都是从本仓同步过去后被 PR 合入 UXAI dev)。**本仓代码作为"独立运行的 reference impl"这个身份已经被 UXAI 接管**。

为保留 2026-06-06 之前完整的"独立实现"快照(包括本仓特有的实现细节、未必被同步过去的中间产物、调试历史),整体打 tag + archive 分支。**任何时刻 `git checkout v1-insight-impl-archive` 都能复活完整代码 + 跑起来**(取决于依赖版本能否解析,但 git 树是完整的)。

---

## 2. 锁定决策清单

| # | 决策 | 状态 |
|---|---|---|
| D1 | 当前 dev 整体打 tag `v1-insight-impl-archive`,**永不覆盖** | 锁定 |
| D2 | 复制 dev 到 `archive/insight-impl-2026-06` 分支并 push,作为"想看历史代码的人"的明确入口 | 锁定 |
| D3 | dev 分支上**删除所有代码包**(`packages/`、`script/`、`infra/`、`nix/`、`sdks/`、`github/`、根 `package.json/bun.lock/tsconfig.json` 等),仅保留 `docs/`、`README.md`、`LICENSE`、`AGENTS.md`、`CLAUDE.md`、`ROADMAP.md` | 锁定 |
| D4 | README 重写,**第一段说明新定位 + archive 入口** | 锁定 |
| D5 | CLAUDE.md 重写,**删除所有基于代码假设的条款**(改动政策表、自由改/不动区、上游 opencode 对齐原则等),改为"文档仓工作规则" | 锁定 |
| D6 | architecture.md §5.4(上游接线壳改动清单)**顶部加归档标记**;内容不删(对 archive 分支仍有效) | 锁定 |
| D7 | ROADMAP 调整:**已完成区不动**(它本就是历史);当前 / P0 / P1 / P2 改成"文档维护计划",代码任务全部删除或移入"已归档" | 锁定 |
| D8 | docs/intranet-handoff.md 改写为"代码已归档,代码维护看 UXAI 仓"的简短指引;**`script/octo-sync.ts` 这套同步机制随代码包一起删除** | 锁定 |
| D9 | UXAI 仓本期**不动**(由 UXAI 仓负责人决定要不要在他们 README 加引用本仓的入口) | 锁定 |
| D10 | 本 spec 自身**保留在 dev**(归档时随 archive 带走;新 docs-only 主线也保留作为决策记录) | 锁定 |

---

## 3. 执行清单

> 新对话执行,**每个 Phase 结束停下汇报让用户 review 再进下一个**。

### Phase 0:归档前清理 — 实际约 30 分钟

> **执行校正(2026-06-06,实际执行时回填)**:本节原计划"大规模诚实化"(删 aspirational 条款、补 ADR、README 去虚,估 3-5 小时)。实际动手发现**存量文档本身已相当诚实** —— CLAUDE.md / architecture 通篇是真实在用的纪律与真实的历史记录,没有"声称但从未兑现"的条款可删。原计划点名要删的"packages/opencode 不动"其实是**真实遵守了的纪律**(上游目录确实一行没动),只是"为了便于上游 sync"这个理由没触发过实际同步动作 —— 删它等于抹掉真实纪律。
>
> 因此 Phase 0 退化为一件小事:**只修客观死链 / 过期路径**(下方 0.1)。对"上游跟踪没兑现"的清算,改放归档后的新 CLAUDE.md / README 里一次讲清(见 Phase C),而不是回头去擦旧文档里的真实痕迹(那才是篡改历史)。

#### 0.1 统一 agent 改名遗留路径

SPEC-INS-010 把 agent 改名 `insight → octo_insight`,但 docs 里约 55 处旧路径 / 文件名简称没跟着更新(含 7 处可点击死链 + 大量行内文本)。全局统一改成 `octo_insight`,**唯一例外**是 architecture §5.4 那条"改名前 → 后"对照记录(它记录的就是改名本身,保留原貌)。

> 实现:`(?<!octo_)insight\.md` 正则 + 路径前缀替换,排除已是 `octo_insight.md` 的串与 `insight-*.md` spec 文件名。

#### 0.2 原计划取消的事(留痕,解释为何没做)

- ~~删 aspirational 条款~~ → 文档已诚实,无对象(见上方执行校正)
- ~~补 2-3 条 ADR(2-3h)~~ → 不为补而补;归档后若发现明显缺失,挪入 §5 后续工作再单独议
- ~~README 去虚~~ → 当前根 README 是上游 opencode 英文原版 + 20+ 个语言镜像,octo 从没维护过它,不存在"octo 写的虚假定位"可去。README 整体放归档后重写(Phase C),多语言镜像一并删除
- ~~architecture §5.4 补登~~ → 现有清单已足够,不强补

#### 0.3 commit + push Phase 0 改动

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(docs): 归档前清理 — 统一 octo_insight 改名遗留路径

SPEC-INS-010 改名 insight→octo_insight 后,docs 里约 55 处旧路径 /
文件名简称没跟着更新(含 7 处死链)。全局统一,让 archive 快照里
所有路径与代码现状一致、链接可点。architecture §5.4 那条
"改名前→后"对照记录保留原貌。
EOF
)"
git push origin dev
```

**验收 0**:
- `grep -rn '\binsight\.md' docs/ CLAUDE.md | grep -v octo_insight | grep -v 'insight-'` 零输出
- 无 `octo_octo` 误伤
- archive 之后 checkout `v1-insight-impl-archive`,docs 里 agent 路径都指向真实存在的 `packages/agent/octo_insight/agents/octo_insight.md`

### Phase A:归档 — 10 分钟

```bash
cd /Users/huowenkai/Desktop/projects/octo-agent

# A0. 状态确认
git status -sb
git log --oneline -5
git branch --show-current  # 必须 = dev

# A1. 打 tag(语义化 + 完整说明,future-you 看 tag 列表能直接看懂)
git tag -a v1-insight-impl-archive -m "insight 独立实现归档(2026-06-06)。

包含完整实现:
- SPEC-INS-010 (insight 独立化) 全套落地
- useProjectDir hook + path-valid util
- packages/opencode session.agent 字段化 + JsonMigration + 迁移
- desktop-electron IPC baseDir(MCP 文件落项目目录)
- pages/insight/* 全部业务代码 + 设计文档 + ADR

此 tag 之后,octo-agent 仓转为纯文档主线,代码不再维护。
未来若需复现历史实现,checkout 此 tag 即可。

UXAI 仓 (https://github.com/MyHeavenDyf/UXAI) 是 insight 实际运行的产品仓。
本仓自此仅承载 docs/、specs/、learning/、ADR、ROADMAP 等设计文档。"

git push origin v1-insight-impl-archive

# A2. 复制 dev 到 archive 分支并推
git branch archive/insight-impl-2026-06 dev
git push origin archive/insight-impl-2026-06
```

**验收 A**:
- `git tag -l v1-insight-impl-archive` 有输出
- `git branch -a` 看到 `remotes/origin/archive/insight-impl-2026-06`
- GitHub tags + branches 页面均可见

### Phase B:清除代码 — 15 分钟

```bash
# B1. 删代码包
git rm -r packages/
git rm -r script/      2>/dev/null || true
git rm -r infra/       2>/dev/null || true
git rm -r nix/         2>/dev/null || true
git rm -r sdks/        2>/dev/null || true
git rm -r github/      2>/dev/null || true
git rm -rf .github/    2>/dev/null || true
git rm -rf patches/    2>/dev/null || true

# B2. 删根目录构建配置
git rm -f package.json bun.lock turbo.json tsconfig.json bunfig.toml drizzle.config.ts 2>/dev/null || true

# B2b. 删上游多语言 README 镜像(README.zh.md / README.ko.md 等 20+ 个上游文件,octo 从没维护)
#      glob 只命中 README.<lang>.md,不动 README.md(归档后 Phase C 重写)
git rm -f README.*.md 2>/dev/null || true
# 注意:保留 LICENSE / AGENTS.md / README.md / CLAUDE.md / ROADMAP.md / .gitignore / docs/

# B3. 确认剩余
ls -la
# 期望大致剩:
#  .git/  .gitignore  AGENTS.md  CLAUDE.md  LICENSE  README.md  ROADMAP.md  docs/

# B4. 暂时不 commit,等 Phase C 文档改完一起 commit
```

**验收 B**:
- `git status` 显示一堆 deleted
- `ls` 只剩文档资产

### Phase C:重写文档 — 1-1.5 小时

> ⚠️ 先 README(定调),再 CLAUDE.md(规则),最后调其他。

#### C1. README.md(主入口)

新结构:

```markdown
# octoAI / octo-agent

> 本仓为 octo-insight 的**设计文档主线**。实际运行的产品代码在内网 UXAI 仓
> (https://github.com/MyHeavenDyf/UXAI)。本仓不再承载可运行代码。
>
> 历史实现完整保留:
> - tag `v1-insight-impl-archive`
> - branch `archive/insight-impl-2026-06`

## 这个仓库现在是什么

- **docs/**:架构文档、specs、ADR、learning 笔记、handoff 流程
- **CLAUDE.md / AGENTS.md / ROADMAP.md**:本仓工作约束 + 路线图
- 给 insight 维护者(人 / AI)看的设计真相源

## 这个仓库不再是什么

- ~~可运行的 reference implementation~~
- ~~packages/app、packages/opencode 等代码包~~
- (已归档,见上)

## 看历史代码 / 复现历史实现

```bash
git checkout v1-insight-impl-archive
# 或
git checkout archive/insight-impl-2026-06
```

回到 2026-06-06 那天的完整状态,可继续 `bun install` 起 dev(依赖 lock 仍在 git 树里)。

## 现役文档入口

- [架构](docs/architecture.md)
- [Specs](docs/specs/)
- [ADR](docs/adr/)
- [Learning 笔记](docs/learning/)
- [集成手册(给 UXAI 集成者)](docs/intranet-handoff.md)

## 历史

- ~2026-06-05:作为 octo-insight 独立实现仓,完整代码 + 文档共存
- 2026-06-06 起:转为文档主线,代码归档。详情见 [本期 spec](docs/specs/infra/repo-restructure-to-docs-only.md)
```

#### C2. CLAUDE.md(完全替换)

新内容大致:

```markdown
# octo-agent 仓工作规则

> 本仓是 octo-insight 设计文档主线。代码已归档,见 README。
> 凡修改本仓的人或 AI,先读以下规则。

## 仓库定位

- **承载**:docs/、specs/、ADR、learning、ROADMAP、handoff、本 CLAUDE.md
- **不承载**:运行代码(归档在 v1-insight-impl-archive / archive/insight-impl-2026-06)
- **真实产品代码**:UXAI 内网仓 https://github.com/MyHeavenDyf/UXAI

## 工作流

- 改 docs/* 之前,确认是否与 UXAI 仓同事有共识。涉及共识的,先在 UXAI 拉齐,再来本仓落 docs
- 不接受任何包含可执行代码、构建配置的 commit(除非明确把 archive 内容拉回 dev,需团队签字)
- spec / ADR / learning 文档可独立编写,但**架构级 spec 应通过 PR review**

## 文档维护

- ADR 一旦落地不删;改决策开新 ADR 在旧 ADR 顶部链过去
- spec 变更通过 PR;learning 笔记由作者自负,可直接 commit
- 不允许往本仓 commit 任何代码 / 构建文件

## 历史与归档

- 实现代码完整保留在:
  - tag `v1-insight-impl-archive`
  - branch `archive/insight-impl-2026-06`
- 任何时候可 checkout 复活;dev 主线不维护代码
```

#### C3. architecture.md §5.4 加归档标记

在 §5.4 标题下方加一个 callout block:

```markdown
> ## ⚠️ 本节(§5.4 上游接线壳改动清单)已归档
>
> 内容记录的是 2026-06-06 之前的代码改动细节。代码本身已归档,见仓库 README。
> 本节保留是给未来检查 archive 时仍能对照设计文档参考使用,**不再视为现役约束**。
>
> 复现/继续这些代码改动 → `git checkout v1-insight-impl-archive`
```

§5.4 现有所有条目内容**不删**(对 archive 仍有效)。

#### C4. ROADMAP.md 重整

- **已完成区**:不动
- **当前 / 内网联调中 / P0 / P1 / P2 区**:把"代码实现"任务全删,改成"文档维护计划"(例:补 learning 笔记、ADR 体系梳理、spec 交叉引用清理 等)
- **挂起区**:不动(它本就是"以后再说"的备忘)

#### C5. docs/intranet-handoff.md 重写

把"双向 sync 契约"改成"代码维护流程",大致:

```markdown
# Intranet Handoff(2026-06-06 起新版)

octo-agent 代码已归档(见 README)。insight 实际运行代码 + 维护在 UXAI 仓
(https://github.com/MyHeavenDyf/UXAI)。

## 给 UXAI 仓 insight 同事

- 代码改动:在 UXAI 仓提 PR
- 设计变化需要 spec / ADR / learning 文档变更:在 octo-agent 仓提 PR
- 本仓 CLAUDE.md 是 insight 工作约束的真相源

## 历史

2026-06-06 之前的"octo-sync 双向同步"流程已废弃,见 git 历史。
```

### Phase D:统一 commit + push — 5 分钟

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(repo): 转为文档主线,代码归档至 v1-insight-impl-archive

详见 docs/specs/infra/repo-restructure-to-docs-only.md。

变化:
- 删除所有代码包(packages/ script/ infra/ 等)
- README 改写,定位为 octo-insight 设计文档主线
- CLAUDE.md 重写为"文档仓工作规则"
- architecture.md §5.4 顶部加归档标记
- ROADMAP 调整为文档维护计划
- handoff doc 重写为"代码看 UXAI,文档看本仓"

实现完整保留在:
- tag: v1-insight-impl-archive
- branch: archive/insight-impl-2026-06

EOF
)"

git push origin dev
```

### Phase E:验证 — 10 分钟

- [ ] GitHub README 首页第一段显示新定位
- [ ] tag + archive 分支在 GitHub 可见
- [ ] checkout tag 后 `ls packages/` 仍有内容,确认归档可复活
- [ ] checkout dev 后 `ls` 只剩 docs + 几个根 .md
- [ ] dev 上 `find . -name '*.json' -o -name '*.ts' -o -name '*.tsx' | grep -v docs/ | head` 应该几乎无输出

---

## 4. 风险与回滚

### 4.1 风险

| 风险 | 缓解 |
|---|---|
| 归档分支被误删 | GitHub branch protection 锁住 `archive/*` 和 `v1-*` tag |
| 三个月后想恢复代码维护 | `git checkout v1-insight-impl-archive -b dev-restore` → 决策可回滚 |
| GitHub 仓首页给路过者的初印象差(没代码看着像废仓) | README 第一段明确说"这是文档仓,不是死仓",archive 入口清晰 |
| spec 自身随归档分支带走,但新 docs-only 主线也保留它 | D10 已锁定:保留;它解释了"为什么仓库长这样" |

### 4.2 完全回滚方案

```bash
# 三个月后如果决策错了
git checkout v1-insight-impl-archive -b dev-restore
git push origin dev-restore
# UI 上把 dev 默认分支改成 dev-restore,本期改造彻底回滚
```

git 历史完整,无单向门。

---

## 5. 后续工作(本 spec 落地后开新对话推)

> spec 交叉引用清理 / ADR 补全 / §5.4 补登 / CLAUDE.md 去虚 等"修正历史记录"的事已挪进 Phase 0(归档前做)。
> 以下是"沉淀未来知识"的事,**属于新 docs-only 主线的工作**,不在 archive 范围:

- **learning 笔记补全**:SQLite / Drizzle / Effect / Solid 响应式 / IPC / SDK 生成机制等。这些是"现在的我们沉淀给将来"的知识,放新 docs-only 写
- **UXAI 仓那侧加引用本仓的入口**:需要新 docs-only 状态先存在,由 UXAI 负责人决定
- **文档视角迁移到 UXAI(大工程,开新对话)**:architecture / development / 各 spec / ADR 里的代码路径、开发流程目前沿用 octo-agent 本仓命名(如 `packages/app/src/pages/insight/`),需逐篇调成 UXAI 视角(路径映射见 [intranet-handoff §0](../../intranet-handoff.md):`octoapp/pages/insight/`),让文档直接服务 UXAI 开发,而非要求读者心算映射。本期只在 architecture / development 顶部加了定位指引,逐路径迁移**未做**。
- **新 docs-only 状态下的 docs 重组**:看运行一段时间后是否需要(比如 specs/ 按"已归档 / 现役" 分子目录)

以上不在本期范围。
