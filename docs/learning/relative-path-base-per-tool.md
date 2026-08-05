# 相对路径的「基准」：为什么要逐个工具指定，以及它跟「能读写哪里」不是一回事

> 面向：想搞清楚「我们的插件是不是给每个工具都规定了从哪个目录开始读写、这部分改动在哪」的读者。
>
> 配套：
> - [agent-output-path-and-provenance.md](agent-output-path-and-provenance.md) —— 前传：为什么落点是运行时策略、不该进模型上下文。
> - SPEC-INS-028（`docs/specs/infra/insight-workdir-declaration.md`）—— 本篇描述的机制的设计文档。
> - `packages/opencode/src/agent/octo-session-workdir.ts` —— 本篇主角。

---

## 0. 先纠一个字

「插件规定了每个工具**能**从哪个目录读写」——这句话里的「能」要换成「**从哪儿起算**」。

一字之差是两套完全不同的机制，混在一起会让人以为插件是个权限系统：

| | 基准（本篇的事） | 允许区（不是本篇的事） |
|---|---|---|
| 管什么 | 模型给了 `a.md` 这种**相对**路径时，它等于磁盘上的哪个绝对路径 | 一个**已经确定**的绝对路径，准不准碰 |
| 谁实现 | 我们的插件（`octo-session-workdir.ts`） | 上游权限层（`external_directory` + `containsPath`） |
| 给绝对路径时 | **完全不介入** | 照常判定 |
| 越界了怎样 | 落盘工具拒绝改写并抛错；读取工具不拦 | 弹权限询问（Dock） |

所以插件**不会**让模型「读不到某个目录」。模型给绝对路径，插件一律放行；管不管得住，是权限层的事。插件只回答一个问题：**「a.md」到底是谁家的 a.md。**

---

## 1. 为什么必须逐个工具做，而不是一处开关

因为上游根本没有「会话级工作目录」这个概念。

全系统只有一处目录：`Instance.directory`（用户所选目录）。`session.directory` 不是独立概念，只是建会话时抄的一份副本。而每个工具都**各自**去 join 它：

```ts
// write.ts / edit.ts
path.join(instance.directory, params.filePath)
// read.ts
path.resolve(instance.directory, filepath)
// glob.ts / grep.ts
params.path ?? ins.directory
// shell.ts
params.workdir ? resolvePath(params.workdir, executeInstance.directory) : executeInstance.directory
```

没有一个中间层可以拦。想改成「会话产物目录」，只有两条路：

1. 改 `Instance.directory` 本身 —— **不行，自指**：`.octo/<sid>/outputs` 就是从它算出来的，而且它还承载配置发现、skill 发现、file watcher、git snapshot、会话存储。
2. 在 `tool.execute.before` 里逐工具改参数 —— 这就是我们做的。

「逐个工具」不是设计品味，是上游结构逼出来的唯一入口。

---

## 2. 实际的基准表

改动全部集中在 `octo-session-workdir.ts` 的 `tool.execute.before`：

| 工具 | 被改写的参数 | 基准 | 越界拦截 |
|---|---|---|---|
| `write` / `edit` | `filePath`（相对时） | 会话产物目录 `.octo/<sid>/outputs/` | **拦**（抛错） |
| `read` | `filePath`（相对时） | 会话产物目录 | 不拦 |
| `bash` | `workdir`（缺省时） | 会话产物目录 | — |
| `glob` / `grep` | `path`（缺省时） | **会话根** `.octo/<sid>/` | — |
| `apply_patch` / `lsp` | — | 未接管（insight 已 deny 两者） | — |

三处不对称都是刻意的：

- **`glob`/`grep` 用会话根，不是产物目录**：搜索范围和落点是两件事。材料在 `uploads/`，收窄到产物目录会让「在我材料里找一下 X」搜不到。（`file/ripgrep.ts` 两条命令都带 `--hidden`，所以 `.octo/` 本来就搜得到，收窄是净损失。）
- **`read` 不拦越界**：`uploads/` 是产物目录的兄弟，`../uploads/x.docx` 是合法读取。拦截的目的是防**产物**逃逸，读取不产生产物。
- **`bash` 用产物目录**：脚本产出即产物。skill 脚本根本不读系统提示词，`--base-dir "."` 里的 `.` 是进程 cwd —— 这条通道只能靠 `workdir` 管，声明改写对它零作用。

---

## 3. 三层心智模型（记住这个就不会绕）

一次「模型要写个文件」实际经过三层，各管各的：

```
① 声明层   模型看到 `Working directory: <会话产物目录>`
           → 它自己拼绝对路径时，拼出来的就是对的
           实现:experimental.chat.system.transform

② 基准层   模型给了相对路径 `a.md`
           → 插件把它 resolve 成 <会话产物目录>/a.md
           实现:tool.execute.before

③ 权限层   最终那个绝对路径准不准写
           → 在允许区内静默放行,区外弹 Dock
           实现:上游 external_directory,我们没碰
```

**① 和 ② 缺一不可，这是最容易误解的地方。** 常见的疑问是「都把 cwd 声明成 outputs 了，② 是不是多余」——不是：我们改的只是**塞进模型上下文的那行字符串**，`write.ts` 里那句 `path.join(instance.directory, ...)` 一个字都没动。只改 ① 不改 ②，模型老实写下 `a.md`，照样落到用户所选目录根。

反过来，只改 ② 不改 ① 就是 2026-07-30 那版的状态：声明说 A、实际落到 B，模型每次自行拼绝对路径都会拼到 A，只能靠提示词硬抗，长尾永远收不干净。

---

## 4. 判据速记

- 说「限制模型能读写哪里」时，先分清是**基准**还是**允许区**——前者是我们的插件，后者是上游权限层。
- 相对路径的基准要改，就得逐工具改：上游没有会话级 cwd 这层抽象，也没有中间层可拦。
- 「搜索范围」和「落点」是两件事，别用同一个目录一刀切；把它们绑死会造出「搜不到自己的材料」这种回归。
- 越界拦截只该套在**产生产物**的工具上；套在读取工具上必然误伤兄弟目录。
- 判断一个改动属于 ①②③ 哪一层，看它改的是**字符串**、**参数**还是**判定**。
