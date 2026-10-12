# design/ —— 占位（设计师维护的内容）

这里应该是图表设计方法论那一整坨，由**设计师团队维护**，我们**只搬位置、不改内容**。

上游包：`chart-design-advisor`（当前对接版本 v0.6.6）。

## 怎么放

把上游包里这些**整目录平移**到本目录下，保持彼此的相对关系不变：

```
design/
├─ 02-router/
├─ 03-methods/
├─ 04-references/
├─ 05-tests/
├─ 06-assets/
├─ VALIDATION.md        ← 必须一起搬：05-tests/ 下有两处 ../VALIDATION.md 指它
├─ README.md            ← 可选，包说明
├─ CHANGELOG.md         ← 可选，版本历史
└─ description.md       ← 可选，宿主兼容入口
```

**不要搬上游的 `SKILL.md`** —— 本 skill 的 SKILL.md 由我们维护（它是工作流和门禁），
上半段已经把上游 SKILL.md 的设计规则抄进来了，链接也都改成了 `design/` 前缀。

**不要搬上游的 `scripts/check_package.py`** —— 那是他们的包自检脚本，生产包不跑。

## 唯一要改的两行

整目录平移后，内部的 `../03-methods/`、`../VALIDATION.md` 这类相对链接**全部仍然成立**，
一条都不用动。只有两个文件里指向上游包根 `SKILL.md` 的链接会变成死链：

| 文件 | 改法 |
|---|---|
| `design/README.md` | `[SKILL.md](SKILL.md)` → `[SKILL.md](../SKILL.md)` |
| `design/description.md` | `[SKILL.md](SKILL.md)` → `[SKILL.md](../SKILL.md)` |

这两个文件运行时读不到（SKILL.md 的"按需读取"表里不引用它们），不改也不影响功能；
真不想改就干脆别搬这两个文件。

## 上游发新版时

拿新版原包，重做一次上面的平移即可，**不做任何 merge**。
然后 diff 一次新版的 `SKILL.md` 和本 skill SKILL.md 的上半段，把设计规则的变化抄过来——
下半段（工程流程、硬约束）是我们的地盘，不受上游影响。

**组装后删除本文件** —— `ensure-env.mjs` 会检查它是否还在。
