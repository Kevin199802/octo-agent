# SPEC-INS-028：会话工作目录声明对齐（Working directory = 会话产物目录）

> **状态**：草案（待实现）
> **上游已实现**：✗（上游只有 instance 级单一 `directory`，无会话级工作目录概念；但 `experimental.chat.system.transform` hook 与 `Working directory` / `Workspace root folder` 二元语义均为上游现成物，本 spec 不新增概念）
> **领域**：infra/insight（声明层，跨系统提示词 / 工具基准 / skill 契约）
> **关系**：是 [SPEC-INS-026 产物身份模型](insight-artifact-identity.md) 的下一层——026 主张「身份 = 磁盘路径」，本份定义**那条路径的根由谁声明**；取代 learning [agent-output-path-and-provenance.md](../../learning/agent-output-path-and-provenance.md) §6 的第 1、4 条落法
> **配套对外文档**：[产物落盘 — skill 作者须知](../agents/artifact-output-for-skills.md)

---

## 修订记录

- **2026-08-05 v1（本版）**：起因是接入外部 skill 后产物「随机散落在选中目录根与 outputs」。排查发现散落不随机，是**按写盘通道确定性分裂**；再往上追，根因是全系统只有一处目录声明且它指向选中目录，插件只改了行为、没改声明。2026-07-30 定的四条落法（见 learning §6）没有一条动过声明，这是一个记录在案但一直没关的口子。

---

## 1. 现状取证：全系统只有一处目录声明

`Instance.directory`（= 用户所选目录）是唯一真相源。`session.directory` **不是独立概念**——建会话时把它抄了一份（`packages/opencode/src/session/session.ts:637` `directory: ctx.directory`）。**「会话级工作目录」目前在系统里不存在。**

三个通道全部读它，插件只覆盖了其中一个：

| 通道 | 位置 | 解析基准 | 插件覆盖 |
|---|---|---|---|
| **模型看到的声明** | `session/system.ts:55` `Working directory: ${ctx.directory}` | 选中目录 | ✗ |
| **bash cwd** | `tool/shell.ts:597-599` `params.workdir ?? executeInstance.directory` | 选中目录 | ✗ |
| **write 相对基准** | `tool/write.ts:41-43` | 选中目录 | ✓ 仅相对路径 |
| edit / read / glob / grep / apply_patch | `edit.ts:82`、`read.ts:160`、`glob.ts:40-41`、`grep.ts:56-58`、`apply_patch.ts:73,138` | 选中目录 | edit ✓，其余 ✗ |

### 1.1 散落的确定性成因

产物落点按**通道**分裂，不是模型随机：

- 模型用 `write` 写相对名 → 插件重定向 → `.octo/<sid>/outputs/` ✓
- 模型用 `write` 写**绝对**路径 → 插件按设计放行 → 选中目录根 ✗
- **skill 脚本经 bash 落盘 → 完全不经过任何重定向 → 选中目录根** ✗

第三条是主力通道。外部 skill 仓（`UCD_SKILLS`）5 个 skill 里 4 个把落点写死在自己的 SKILL.md 里（「产物写到用户当前工作目录」「落地位置：当前工作目录，不另建子目录」），`画像旅程` 的 `init_run_dir.py --base-dir` 默认 `"."`，直接在选中目录根建出 `用户画像报告输出/<项目名>-<时间戳>/{过程稿,画像头像素材,界面截图}` 整棵树。

### 1.2 模型不是不听话，是听话了

learning 笔记记录的那次 SQLite 取证里，错误落点是 `D:\测试 insight\xxx.md`——**这个字符串等于我们在 `system.ts:55` 声明的值**。模型拿到「Working directory: `D:\测试 insight`」+ `write` schema 的「must be absolute」，拼出该路径是正确执行。

我们随后在 insight 提示词里加了「禁止拼当前工作目录」去对抗**我们自己的声明**。learning §4 早已把「系统上下文把 Working directory 喂给模型」列为三条打架指令之一，但 §6 的四条落法一条都没动它。

> **判据**：这不是模型遵从度问题，是声明与行为不一致。遵从度问题的表征是「有时对有时错」；本例是「按通道 100% 可预测」。

---

## 2. 业界对照与选型

| 做法 | 代表 | 声明与落点的关系 | 代价 |
|---|---|---|---|
| **A. 会话即沙箱根** | OpenAI Code Interpreter（一会话一容器，根 `/mnt/data`，uploads/outputs 同处其中） | **同一个东西**，不存在错位 | 需要「一会话一 instance」；我们的 instance 按目录建、会话共享，且 `.octo/<sid>/` 本身由 `instance.directory` 算出，改它自指 |
| **B. 声明不动 + per-tool override** | 我们的现状 | 声明 A、落到 B，**结构性不一致** | 模型每次自行拼路径都会拼到声明处；只能靠提示词硬抗，长尾无法收敛 |
| **C. 声明对齐 + 运行时兜底** | 本 spec | 声明与落点一致，插件退为确定性兜底 | 需要把「声明」与「instance 根」拆成两个概念 |

**选 C。** A 在架构上最干净但不可达（自指 + `.octo` 存储、配置/skill 发现、file watcher、git snapshot 全部挂在 `instance.directory` 上）。B 是现状，已被 §1 证伪。

C 不需要发明新概念——上游 env block 本来就是两行：

```
  Working directory: ${ctx.directory}
  Workspace root folder: ${ctx.worktree}
```

上游自己就承认 **cwd ≠ workspace root**。C 做的只是把这两个槽填对：`Working directory` = 会话产物目录，`Workspace root folder` = 选中目录。

---

## 3. 设计

### 3.1 声明层：两个槽分别对上两层

上游 env block 的两行正好承接我们要表达的两层，对 insight 会话双双改写：

| 槽 | 改为 | 含义 |
|---|---|---|
| `Working directory` | `.octo/<sessionID>/outputs/` | **落点** —— 相对路径的解析基准，产物写在这里 |
| `Workspace root folder` | **本版不动**（见下） | **范围** —— 本会话的全部材料与产出（`uploads/` + `outputs/`），glob / grep 的默认搜索范围 |

**`Workspace root folder` 本版刻意不改，留给独立 PR 全局修。** 非 git 目录时上游把 `worktree` 置为 `/`（`project/project.ts`），模型会看到「工作区根 = 整个磁盘根」。这是**全局问题**——所有 agent、所有模块都受影响，正确的修法是在 `project.ts` 一次性改掉，让其他模块一并受益；在本插件里做 insight 局部覆盖，等于两套改动叠在同一行上，后续全局 PR 落地时会打架。

注意它只是一行声明，**不驱动任何写入**——`worktree` 从来不是任何工具的路径解析基准，`containsPath()` 遇到 `/` 还会特意跳过（`project/instance-context.ts`）。所以历史上并不会因此把文件写到磁盘根，本版不改也不会引入新故障。

**已知临时不一致**：本版 glob / grep 的默认根已经是会话根（§3.2），而声明里的 `Workspace root folder` 还是 `/`。这条随全局 PR 关闭。

**`Working directory` 为什么是 `outputs/` 而不是会话根**，三条理由与一处已知代价：

1. **skill 契约位置无关**：选会话根会要求 skill 知道 `outputs/` 与 `tmp/` 两个宿主内部目录名，与 §5 直接冲突。选 `outputs/` 后 skill 只需「写相对路径、要收纳就建相对子目录」，宿主布局完全不外泄。
2. **skill 脚本是产物散落的主力通道**：bash cwd 若设成会话根，skill 脚本写的相对文件会落在会话根而不是 `outputs/`，文件管理照样看不到——直接退回今天的症状。
3. **模型视角内部自洽**：模型 `ls`、`read`、`write` 面对的是同一个目录；材料一律从 `[附件]` 拿绝对路径，从不需要相对访问 `uploads/`。

**已知代价**：`uploads/` 成了工作目录的兄弟，相对访问要写 `../uploads/`。所以 §3.2 的越界拦截只能管落盘、不能管读取（否则误伤合法读取），提示词里的 `..` 约束也必须限定在「产物不要写到工作目录外」，不能一刀切禁止——**一刀切就是又造一条自相矛盾的指令**，与本 spec 要消除的那类矛盾同源。

中间产物随之进 `outputs/<子目录>/`，在文件管理里可见可收纳——这正是 skill 作者「中间产物需要规整收纳、不是用完即丢」的诉求。

**实现走插件，不改上游文件**：hook `experimental.chat.system.transform`（`packages/plugin/src/index.ts:290-295`）带 `sessionID`，`session/llm.ts:116-120` 触发时传入。本仓已有先例 `plugin/proto-theme.ts:37`。

注意 hook 触发时 `output.system` 是**单元素数组**——`llm.ts:100-114` 把 agent prompt + env + instructions + skills 先 `join("\n")` 成一个字符串。所以改写是对 `system[0]` 做**定点行替换**，锚点为字面量 `  Working directory: ${directory}`（插件从 `PluginInput.directory` 拿到该值，两端都确定，不做模糊匹配）。

三条硬要求：

1. `sessionID` 缺省时 no-op（`agent/agent.ts:676` 那条触发路径不传 sessionID）。
2. 非 insight 会话 no-op（判据同 `octo-outputs-redirect.ts`：`session.agent === "octo_insight"`）。
3. **锚点未命中时响亮失败**：按 `[octo:*]` 日志字典打 error（上游模板变更的唯一信号），并保持原声明不动——此时 §3.2 的插件兜底仍在，退化为现状而非更差。

### 3.2 执行层：让三个通道与声明一致

| 通道 | 改法 | 基准 |
|---|---|---|
| **write / edit** | 相对 `filePath` 重定向；**强制不越界**（§3.3） | 产物目录 |
| **read** | 相对 `filePath` 重定向；**不做越界拦截** | 产物目录 |
| **bash** | 未显式给 `workdir` 时补默认值（脚本产出即产物） | 产物目录 |
| **glob / grep** | 未显式给 `path` 时补默认值 | **会话根** |
| **apply_patch** | 不覆盖。参数是整段 `patchText`、无单一 filePath，无法同款重定向；对 insight 本就 deny，自洽 | — |

模型显式给出的绝对路径 / `workdir` / `path` 一律尊重，不覆盖。

**两处不对称是刻意的，不是疏漏：**

- **glob / grep 用会话根，不用产物目录**。搜索范围和落点是两件事。收到产物目录，「在我材料里找一下 X」就搜不到 `uploads/`——实测 `file/ripgrep.ts` 的两条命令都带 `--hidden`，`.octo/` 今天是能被搜到的，收窄即回归。会话根同时覆盖 `uploads/` 与 `outputs/`。

  > **这是一个可调点，不是硬约束。** 搜索范围与落点解耦之后，往外放到用户所选目录（让模型能搜整个项目而不只是本会话）只是把这一处默认值从会话根换成 `meta.directory`，落点、权限、其余通道一律不受影响。要不要放，取决于产品上是否希望 insight 会话看见同目录下其他会话与用户自己的文件；本版按「会话自包含」取会话根，需要时可直接改。
- **read 不做越界拦截**。`uploads/` 是产物目录的兄弟，`../uploads/x.docx` 是合法读取。§3.3 的校验是防**产物**逃逸，读取不产生产物；越界与否交原生 `external_directory` 权限判定。这里设的是「基准」，不是「牢笼」。

`read/glob/grep` 纳入是本版相对 v5 的扩大项：声明改了而它们不改，会产生新的不一致（模型按声明写下 `foo.md`，再 `read("foo.md")` 却读到选中目录根）。

### 3.2.1 为什么改了声明还需要执行层（常见误解）

**我们并没有真的把进程 cwd 改成产物目录**——§2 已说明 Level 2 自指不可达。改的只是**塞进模型上下文的那行字符串**。真实解析基准一行未动，也动不了：

| 上游硬编码 | 位置 | 声明改写对它的影响 |
|---|---|---|
| `path.join(instance.directory, params.filePath)` | `write.ts:43` / `edit.ts:82` / `read.ts:160` / `glob.ts:41` / `grep.ts:58` | **零**。模型按新声明写下相对名 `a.md`，仍落选中目录根 |
| `cwd = executeInstance.directory` | `shell.ts:599` | **零**。且脚本进程根本不读系统提示词 |

**最关键的一条**：本次散落的主力通道是 bash，而 **skill 脚本不读系统提示词**。`init_run_dir.py --base-dir "."` 里那个 `.` 是**进程 cwd**，由 `shell.ts:599` 决定。对这条通道，声明从来就不是原因，声明改写也一点用没有——只能靠 §3.2 的 `workdir` 默认值。

一句话：**声明层让模型「想对」，执行层让它「落对」，是两套互不替代的机制。** 插件里的逻辑不是旧补丁的残留，它就是「把声明变成事实」的那一半；因为上游不给改基准，只能在 `tool.execute.before` 里改参数。

### 3.2.2 考虑过并否决：让模型一律给绝对路径

声明对齐后模型拼出的绝对路径就是对的。据此可以把提示词改成「一律给绝对路径」，则 write/edit/read/glob/grep 的相对基准重定向全部变成死代码，插件只剩 bash `workdir` + containment 校验。

**否决。** 两条理由：

1. 上游 `write` schema 白纸黑字写着 `must be absolute`，但模型实际两种都给（这正是现行插件在接的那部分流量）。赌它 100% 给绝对路径，赌输的表现是「文件静默落到选中目录根」——与今天的症状一模一样，且此时已无兜底。
2. 保留相对基准重定向的成本是**已有代码**，近似为零；换来的简化不值这个风险。

附带理由：相对路径是「模型不需要知道绝对位置」的唯一形态，与 learning §0 的核心判据一致。

### 3.3 允许子路径 + containment 校验（前置安全项）

现行 insight 提示词禁止 `filePath` 带任何路径分隔符，子目录因此不可能出现。放开为「允许相对子路径，禁止绝对路径 / 盘符 / `..`」。

**放开分隔符前必须先补校验**：现行插件是裸 `path.join(outputsDir, filePath)`，`../../x.md` 可穿出产物目录。改为 join 后 `path.resolve` 并断言仍在产物目录内，越界则拒绝改写并按 `[octo:*]` 记录（不是静默落回根目录——静默会把越界写变成新的散落源）。

子目录在下游**已经是被支持的形态，不是新增能力**：服务端 `httpapi/handlers/artifact.ts` 的 list 支持 `path` 参数、`isFolder`、`collectFilesRecursive`；前端 `pages/insight/utils/insight-file-store.ts:290` 有 `navigateToFolder`。

### 3.4 权限不变

`project/instance-context.ts` 的 `contains()` 用**真实** `ctx.directory` / `ctx.worktree` 判定 `external_directory`，不看声明。产物目录是选中目录的子目录，恒在允许区内。所以本 spec **不引入任何新权限弹窗**，也不改变「用户明确指定其他位置」的既有行为。

### 3.5 提示词降级

insight 提示词中「只给文件名 / 禁止带分隔符 / 禁止拼当前工作目录」这组**对抗性硬规则**，其存在理由（对抗错误声明）在 §3.1 后消失。降级为常规表述：给相对路径即可、需要收纳就建子目录、用户明确指定位置时按用户路径写。

这一条是本 spec 的价值检验点：**如果改完之后提示词里还必须留着「禁止拼当前工作目录」，说明声明没真正对齐。**

---

## 4. 边界：明确不解决的

- **`cd xxx && ...` 绕过 `workdir`**：属模型遵从度，用户无输入此类命令的途径，不为它加机制。
- **脚本把中间产物写到源文件旁边**：如 `extract_transcript.py` 把 `.transcript.txt` 写在输入文件同级 → 落进 `uploads/`，污染上传区。这跟随的是**输入路径**而非 cwd，声明对齐救不了，只能靠 §5 的 skill 契约。
- **用户明确指定绝对路径**：照旧尊重，不强行收进产物目录（沿用 learning §5 的 honor 判据）。

---

## 5. 配套：skill 落盘契约

skill 不应点名任何具体目录——「当前工作目录」这句话本身就是一次落点决策，是宿主的职责。对外文档见 [产物落盘 — skill 作者须知](../agents/artifact-output-for-skills.md)，要点：产物声明怎么写、需要子文件夹时提示词怎么写、为什么不要写绝对路径和目录名。

---

## 6. 落地清单

UXAI 仓，单分支：

1. `packages/opencode/src/agent/octo-outputs-redirect.ts` — 扩为声明 + 执行两层：新增 `experimental.chat.system.transform`（§3.1）、bash `workdir` 默认值（§3.2）、read/glob/grep 基准（§3.2）、containment 校验（§3.3）。文件职责已超出「outputs 重定向」，考虑更名为 `octo-session-workdir.ts`。
2. `packages/opencode/src/agent/prompt/octo_insight.md` — 提示词降级（§3.5）。
3. 文档仓 `docs/specs/agents/artifact-output-for-skills.md` — 新增对外契约（§5）。
4. 文档仓 `docs/insight-debugging.md` — 同步新增 / 变更的 `[octo:*]` 日志前缀与字段。
5. 文档仓 learning `agent-output-path-and-provenance.md` — §6 标注被本 spec 取代。

---

## 7. 验证

### 7.1 外网可复现（本地跑源码即可）

前置：`bun run --cwd packages/opencode --conditions=browser src/index.ts serve --port <n>`，选一个空目录作为工作目录，起一个 insight 会话。

| # | 场景 | 步骤 | 通过判据 |
|---|---|---|---|
| V1 | 声明改写命中 | 起会话发任意一句话，看服务端 `[octo:*]` 日志 | 出现改写日志且**前值 = 选中目录、后值 = 该会话产物目录**；非 insight 会话无此日志。**判据是日志不是问模型**——`cli/cmd/debug/` 下没有 dump system prompt 的子命令，而问模型属于用不可靠手段验确定性改动（它可能复述别处或直接编） |
| V2 | 声明未泄漏到普通对话 | 发「你好」 | 回复中不出现任何路径（回归 v5 修复的老问题） |
| V3 | 绝对路径不再错位 | 提示模型「把结果保存成文件」，不给任何路径 | 即使模型拼绝对路径，落点也在产物目录内；文件管理可见 |
| V4 | bash 通道对齐 | 让模型跑 `python -c "open('a.txt','w').write('x')"`（不给 workdir） | `a.txt` 落在产物目录，选中目录根无新增文件 |
| V5 | 子目录 | 让模型「把过程文件放到 `过程稿/` 下」 | 磁盘出现 `outputs/过程稿/…`；文件管理能点进该文件夹 |
| V6 | 越界拒绝 | 构造 `filePath = "../../escape.md"` 的写入 | 写入被拒 + `[octo:*]` 记录；产物目录外无 `escape.md` |
| V7 | read 基准一致 | V3 落盘后让模型 `read` 该文件的**相对**名 | 读到内容（证明写/读基准同一） |
| V7.1 | **材料仍搜得到** | 上传一份含特征词的 txt/md，问「在我材料里找一下 <特征词>」，不给任何路径 | 命中 `uploads/` 里那份材料。**这是 glob/grep 默认根用会话根而非产物目录所守的回归**——收窄到产物目录此项必挂 |
| V7.2 | 相对读取兄弟目录 | 让模型 `read` `../uploads/<文件名>` | 读到内容，不被越界拦截误伤 |
| V8 | 隔离性 | 同一目录下起 Chat / Design 会话做一次写入 | 落点、声明均为原生行为，未受影响 |
| V9 | 响亮失败 | 临时改坏锚点字面量重跑 | 出现 error 日志；行为退化为现状而非更差 |
| V10 | 用户指定位置 | 明确要求「保存到 `<某绝对路径>`」 | 按用户路径写，不被收进产物目录 |
| V11 | `Workspace root folder` 取值 | 检查非 git 的普通选中目录下该行渲染值 | 确认为 `/`（`project/project.ts` 对非 git 项目置 `/`），且**本版未被改写**——它是独立 PR 的输入，不是本版的交付 |

### 7.2 内网验证（真实 skill + 弱模型）

外网用不上真实 skill 与内网模型，以下必须内网跑：

| # | 场景 | 通过判据 |
|---|---|---|
| N1 | `画像旅程` skill 全流程 | `用户画像报告输出/<项目名>-<时间戳>/` 整棵树落在产物目录内，选中目录根无新增；文件管理可逐层点入 |
| N2 | `会议观点总结` / `金句提取` / `思维导图` / `观点解析` | 产物落产物目录；记录 `.transcript.txt` 等中间产物是否落进 `uploads/`（§4 已知边界，用于评估 skill 侧改造优先级） |
| N3 | 弱模型长尾 | 连续 10 轮生成类任务，统计落点在产物目录外的次数；目标 0 |
| N4 | 提示词降级不回退 | 确认删掉「禁止拼当前工作目录」后 N3 仍为 0 |

---

## 8. 与其他 spec 的关系

- [SPEC-INS-014 本地工作目录布局](insight-worktree-layout.md)：v5 确立的插件重定向是本 spec 的前身，本 spec 把它从「唯一手段」降为「声明对齐后的确定性兜底」；`.octo/<sid>/{uploads,outputs,tmp}` 布局本身不变。
- [SPEC-INS-026 产物身份模型](insight-artifact-identity.md)：身份仍是磁盘路径；本 spec 允许该路径含子目录，026 §4.1 的命名规则对每一段路径分量同样适用。
- [SPEC-INS-021 工具集收敛](insight-toolset-convergence.md)：bash 为 skill 放开是本问题的前提条件；本 spec 不改工具集，只改 cwd。
- learning [agent-output-path-and-provenance.md](../../learning/agent-output-path-and-provenance.md)：§0–§5 的认知（落点是运行时策略、出处不可从工具参数判定）仍然成立；§6 的第 1、4 条被本 spec 取代。实现完成后另立一篇 learning 记录「Working directory 与 Workspace root folder 的区分」。
