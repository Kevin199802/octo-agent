# bash 的 `set -e` 与 `ERR trap` —— 五个会让「响亮失败」悄悄失效的点

> 起因：给 `install.sh` 加「任何一次失败都要打出 `RESULT: FAIL` 契约行」的兜底（SPEC-DES-001 §0.0 的 S8）。第一版用 `set -euo pipefail` + `trap 'on_error $LINENO' ERR`，顶层实测通过、合入前 review 才发现：**整条 `--check` 路径上一行契约行都打不出来** —— 因为那条路径的逻辑全在函数里。
>
> 下面每一条都在 **macOS 自带的 `/bin/bash` 3.2.57** 上实测过（内网设计师的机器就是这个版本，不是 brew 的 5.x）。

---

## 一句话

`set -e` 和 `ERR trap` 都有一串**豁免规则**，而这些豁免恰好覆盖了最常见的写法：函数、`&&` 左侧、heredoc 里的命令替换。不知道它们，写出来的"兜底"会在**你最需要的那条路径上**静默失效，而顶层的冒烟测试照样绿。

---

## 1. ERR trap 默认**不被函数继承** —— 要 `set -E`

```bash
set -euo pipefail                 # ← 少了 E
trap 'echo "TRAP: line=$1"; exit 1' ERR

boom() { false; }                 # 函数内失败
boom                              # → 静默 exit 1，trap 一次都不跑
```

| 失败位置 | `set -euo` | `set -Eeuo` |
|---|---|---|
| 顶层 | trap 触发 ✅ | trap 触发 ✅ |
| 函数内（直接调用） | **静默退出** ❌ | trap 触发 ✅ |
| 函数内（被 `if` / `\|\|` 调用） | 不触发 | **仍然不触发** —— 见下面 3b，`-E` 也救不了 |

`-E`（= `set -o errtrace`）的含义就是"ERR trap 也传给函数、命令替换和子 shell"。`DEBUG` / `RETURN` trap 有对应的 `-T`（`functrace`），同一套设计。

**为什么这条特别毒**：兜底逻辑天然写在脚本顶部，冒烟测试也最容易在顶层注入失败，两边都绿；而真实脚本的主体往往在函数里。判据要写成「**在函数里**注入一次裸崩，看契约行还在不在」，不能只测顶层。

## 2. `exit` **不触发** ERR trap —— 所以正常的失败路径不会被兜底重复打印

```bash
trap 'echo "UNEXPECTED"' ERR
fail() { echo "RESULT: FAIL | CODE: 原因"; exit 1; }
fail        # → 只打一行 RESULT，不会再冒一条 UNEXPECTED
```

这是好事：自己的 `fail()` 与兜底 trap 可以共存，不需要加 `$FAILING` 之类的哨兵变量。写兜底前值得先确认这一条，否则很容易为了防重复而加一堆没用的状态。

## 3. `[ cond ] && cmd` 里条件为假**不算错误** —— 既不退出也不触发 trap

```bash
set -Eeuo pipefail
trap 'echo UNEXPECTED' ERR
X=""
[ -n "$X" ] && echo "有值"        # 条件假 → 整条语句返回 1
echo "还活着"                      # ← 照样执行
```

POSIX 规定：`&&` / `||` 列表里**除最后一条之外**的命令，`-e` 一律豁免。所以这种惯用写法是安全的，不用改成 `if`。反过来说，`[ -n "$CHECK" ] && check_mode` 里的 `check_mode` **是**最后一条，它内部的失败照常受 `-e` 与 trap 管。

**但有一个例外要当心**：如果它是**函数或脚本的最后一条语句**，那个返回值 1 就成了函数/脚本的退出码，会被外面当成失败。收尾处宁可写 `if`，或者补一句 `true`。

### 3b. 豁免会**传进函数体** —— 这是最反直觉的一条

```bash
set -Eeuo pipefail
trap 'echo "  TRAP 触发"; exit 9' ERR
f() { false; echo "  函数体继续跑了"; return 0; }

if ! f; then echo "  走了失败分支"; fi   # → 打印「函数体继续跑了」，trap 不触发
f || true                                  # → 同上
f                                          # → TRAP 触发
```

函数被放在**条件位置**（`if` / `while` 的条件、`!` 之后、`&&` `||` 的非末位）时，豁免不只作用于"这一次调用"，而是**覆盖整个函数体**：里面某条命令失败既不退出、也不触发 ERR trap，**函数会带着半截状态一路往下跑**。

这条直接决定了兜底能覆盖到哪：`install.sh` 里 `http_get` 总是写成 `if ! http_get …`、`probe_asset` 总是写成 `probe_asset … || bad=$((bad+1))` —— 这两个函数体内的裸崩，`UNEXPECTED` 兜底是**接不住**的。所以它们内部必须自己防：curl 用 `set +e` 明确接管退出码、`grep` 一律 `|| true`、返回值只由显式的 `case`/`return` 决定。**结论不是"兜底没用"，而是"兜底管直呼路径，条件位置的函数得自己把返回值算对"** —— 把这条写清楚，比声称"任何失败都会被兜住"要诚实。

## 4. heredoc 里的命令替换失败是**完全静默**的

```bash
set -Eeuo pipefail
trap 'echo UNEXPECTED' ERR
read -r A B <<EOF
$(python3 -c 'import sys; sys.exit(3)')
EOF
echo "A=[$A]"     # → A=[]，退出码 0，trap 不跑
```

`$(...)` 在 heredoc 正文里失败，既不被 `-e` 拦、也不触发 ERR trap，`read` 因为 heredoc 总以换行结尾还返回 0 —— 于是**变量是空的、脚本一路往下跑**。

这正是 `install.sh` 从 manifest 取平台信息那段的形态。唯一的挡法是**取完显式判空**：

```bash
[ -n "${FILE:-}" ] || fail MANIFEST_PARSE_FAILED "解析 manifest 失败，取不到 $PLATFORM_KEY 的包信息"
```

> 同源的一条：`VAR="$(cmd)"` 这种**赋值**形式，`cmd` 失败时 `-e` 会拦（赋值语句的退出码就是命令的退出码）、trap 也会触发 —— 与 heredoc 那条正相反。所以不能凭"都是命令替换"类推，两种位置的行为不一样。

---

## 落到脚本里的写法

```bash
set -Eeuo pipefail              # E 不能省

on_error() {
  ec=$?                         # 必须是函数第一条语句
  echo "RESULT: FAIL | UNEXPECTED: 脚本在第 $1 行意外中止(exit=$ec)"
  echo "HINT: 这条路径没有专门的错误处理，把日志整段发出来"
  exit 1
}
trap 'on_error $LINENO' ERR     # $LINENO 在 trap 字符串里展开，不影响 $?
```

`trap '... $LINENO' ERR` 用单引号：`$LINENO` 要在**触发时**展开成出错行号，双引号会在定义时就固定成 trap 那一行。bash 3.2 下报的是所在复合命令的行号（`case` 语句会报 `case` 那行），定位到"哪一段"够用了。

## 怎么验

别只测顶层。四个注入点各来一次：

| 注入 | 期望 |
|---|---|
| 顶层 `false` | 有 `RESULT: FAIL \| UNEXPECTED` |
| **函数内**第一行 `false` | 有 `RESULT: FAIL \| UNEXPECTED` ← 少了 `-E` 就是这条挂 |
| 自己的 `fail()` | **只有一行** `RESULT: FAIL \| <CODE>`，不叠加 UNEXPECTED |
| 条件位置调用的函数内 `false` | 契约行仍在，但来自**调用方对返回值的处理**（不是 trap）—— 见 3b |

---

## 相关

- [SPEC-DES-001 §0.0 的 S8](../specs/design/fastui-vue-codegen-pipeline.md#00-当前进度与待办改动后随手更新这一节) —— 这条兜底的来由与判据
- [SPEC-DES-001 §5.1.1](../specs/design/fastui-vue-codegen-pipeline.md#511-统一输出契约所有脚本) —— 契约行长什么样、日志里必须有什么
