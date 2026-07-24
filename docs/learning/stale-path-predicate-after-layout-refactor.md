# learning/ — 布局重构漏改一个判据:注释更新了、函数体没改,于是附件永远进不了文件管理

> 排查复盘(2026-07-24)。现象:Insight **输入框上传的文件,对话完全正常,但文件管理面板里死活看不到**。
> 根因是一行 `segs.lastIndexOf("insight")` —— 落点目录半年前就从 `insight/<sessionId>/uploads/`
> 迁到了 `.octo/tmps/` + `.octo/<sessionId>/uploads/`,那次重构**把这个判据上方的注释改成了新布局,函数体一个字没动**。
>
> 值得单独写一篇,不是因为 bug 本身难(修法 4 行),而是因为它把"为什么没人发现"这件事的四个放大器凑齐了:
> **注释反向漂移**、**恒假判据是静默降级不是报错**、**私有函数不可测**、**旁路链路仍然工作制造"功能是好的"错觉**。

相关阅读:[file-passing-to-models.md](file-passing-to-models.md)(insight 文件三条路径、附件清单怎么来的)、
[session-category-enum-400-crash.md](session-category-enum-400-crash.md)(同属"半截改动":写入侧改了、读取侧漏改)、
[hono-vs-effect-httpapi-routing.md](hono-vs-effect-httpapi-routing.md)(文件管理接口本身的踩坑)。
规格锚点:SPEC-INS-014 §4.1.2(`a9f6992` v7 迁落点)、UXAI `b90d404c6`(实现侧同一次迁移)。

---

## 0. 症状

- 输入框选一个 docx → 发送 → **对话一切正常**:模型读得到文件、`extract_document` 能解析、结果正确。
- 切到「文件管理」面板 →「已上传」段**空的**。多轮、多文件、换会话都一样。
- 文件管理面板**自带的上传按钮**传同一个文件 → **正常出现在列表里**。

最后这条是整个排查里最误导人的信号:它让人第一反应去查列表接口/刷新时机,而真凶在另一条链路上。

---

## 1. 一句话根因

附件落地分两步:**先拷进预会话区 `.octo/tmps/`,发送时再 rename 进 `.octo/<sessionId>/uploads/`**。
第二步被一个判据 gate 住,而这个判据还在按**旧布局**找 `insight/uploads` 这两个相邻路径段:

```ts
// packages/app/octoapp/pages/insight/index.tsx(修复前)
// .octo/tmps/(而非已经 rename 进 .octo/<sessionId>/uploads/)——发送时用来决定要不要挪。  ← 注释是新的
function isPendingUploadPath(path: string): boolean {
  const segs = path.split(/[\\/]/)
  const i = segs.lastIndexOf("insight")        // ← 函数体是旧的
  return i !== -1 && segs[i + 1] === "uploads"
}
```

实际路径 `D:\proj\.octo\tmps\访谈稿.docx` 里根本没有 `insight` 这一段 → **判据恒为 false** →
一个文件都不会被搬 → 文件停在 `tmps/`,而面板只读 `.octo/<sessionId>/uploads/`。

---

## 2. 三段链路,只坏了中间一段

| 段 | 落点 | 那次重构改了吗 |
|---|---|---|
| ① 选中即拷贝 `copy-file-to-worktree` (desktop/main/ipc.ts) | 写死 `join(baseDir, ".octo", "tmps")` | ✅ 改了 |
| ② 发送时搬迁 `isPendingUploadPath` → `move-pending-upload-to-session` | 不执行 | ❌ **判据漏改** |
| ③ 面板列表 `insight/files` handler | 读 `.octo/<sessionId>/uploads/` | ✅ 改了 |

① 和 ③ 都是**写死路径**,重构时必然被 grep 到;② 是**判断路径**,它不构造路径、只识别路径,
于是躲过了"改落点"时的搜索视野。**记住这个不对称:重构落点时,构造路径的代码好找,识别路径的代码难找。**

---

## 3. 四个放大器:为什么半年没人发现

### 3.1 注释反向漂移 —— 比"注释过期"更难 review

我们都被教育"注释会过期,以代码为准"。这次恰恰相反:**注释是新的、代码是旧的**。
review 时读到"判断是否还落在 `.octo/tmps/`"就点头过了 —— 而下面那行 `lastIndexOf("insight")`
在旧世界里是**真实存在过的合法路径**,单看它也自洽,不像笔误。

> 这类漂移的检出方式只有一个:**读判据时把注释挡住**,只问"这段代码认的是哪个路径",再跟当前布局对。

### 3.2 恒假判据 = 静默降级,不是报错

判据错的方向决定了故障有多难发现:

| | 恒 **false**(本案) | 恒 **true**(假想) |
|---|---|---|
| 行为 | 少做一步搬迁 | 对已归属会话的文件重复 rename |
| 可观测 | **完全静默**:无异常、无 catch、该打的日志因"没尝试"而不打 | `rename` ENOENT → 走 catch → 打 `upload-move failed` |
| 结果 | 半年无人报 | 当天就会被日志发现 |

代码里其实有完备的日志:`upload-copy ok` / `upload-move ok` / `upload-move failed`。
但**恒假走的是"连尝试都没有"的那条路,后两条一条都不打**。

更麻烦的是**日志打在哪个进程**:这三条都在 **Electron 主进程**(`desktop/src/main/ipc.ts`),
进的是 main.log / 启动终端,**DevTools 控制台里根本看不到**;渲染进程侧只在**失败分支**打
`upload-move failed, keep pending path` —— 而恒假连"失败"都算不上,于是渲染端一条都没有。
**日志是齐的,但要么落在没人看的那个进程,要么落在永远走不到的那个分支。**

渲染端唯一能反映真相的,是 `[octo:prompt] send` 里的 `localFiles[].path` —— 它打的是搬迁后的
`resolvedPath`:显示 `.octo\tmps\…` 就是没搬,显示 `.octo\<sessionId>\uploads\…` 才是搬成了。

> 这个坑有现场版本:修复后第一次验证,我让人"看控制台有没有 `upload-move ok`" —— 结果当然没有
> (它压根不在 DevTools),差点据此判定修复无效。**"日志没出现"要先排除"你看错了进程",再谈"代码没走到"。**

> 规约:**一个决定"要不要做某件事"的布尔判据,false 分支也该可观测**(哪怕是一行 debug 日志),
> 否则它退化时的表现就是"功能安静地少做了一步"。

### 3.3 私有纯函数 = 不可测面

这个判据埋在 2000+ 行的 SolidJS 页面组件里、**没有导出**。同仓 `utils/*.test.ts` 单测覆盖不差
(insight 单测 138 条),但它压根不在可测面上 —— 想测就得把整个页面组件拉起来。
**一个纯字符串函数,却因为住错了地方而永远测不到。**

修复顺手把它搬进 `utils/local-file.ts`(已有 `local-file.test.ts`)并导出,5 条用例把布局假设钉死:
Windows 反斜杠 / POSIX / 已归属会话不重复挪 / **旧布局路径不误判** / `.octo` 外的同名 `tmps` 不误判。
其中"旧布局不误判"那条就是这次 bug 的回归锁。

### 3.4 旁路链路仍然工作 → "这功能明明是好的"

文件管理面板自己的上传走 `copyFilesToSessionUploads`,是**无条件 copy→move、不经这个判据**:

```ts
// utils/local-file-ops.ts —— 面板上传:拷完直接归属当前会话,没有 pending 判断
const dest = await api.copyFileToWorktree(srcPath, baseDir, file.name)
finalPath = await api.movePendingUploadToSession(dest, baseDir, sessionId)
```

于是"上传到文件管理"这个能力**看起来是好的**,只有输入框那条路径坏了。
同一功能有两条实现路径、只坏一条时,**能用的那条会持续制造"功能正常"的假象**,把排查引向"是不是没刷新/是不是列表接口"。

外加一层掩护:**对话本身完全正常**。`[附件]` 清单里给模型的是 `.octo/tmps/xxx.docx` 这个真实存在的路径,
`extract_document` 读得到 —— 所以用户报的是"文件没进文件管理"(像个 UI 小问题),而不是"上传坏了"(像个 P0)。
**故障被降级成了一个不起眼的展示问题。**

---

## 4. 修法

判据搬进 `utils/local-file.ts` 并按现行布局改写:

```ts
/** 附件本地路径是否还在预会话落地区 `<projectDir>/.octo/tmps/`(SPEC-INS-014 §4.1.2)——
 *  发送时据此决定要不要 rename 进 `.octo/<sessionId>/uploads/`。已归属会话的返回 false,不重复挪。 */
export function isPendingUploadPath(filePath: string): boolean {
  const segs = filePath.split(/[\\/]/)
  const i = segs.lastIndexOf(".octo")
  return i !== -1 && segs[i + 1] === "tmps"
}
```

同一次重构漏改的还有 agent 提示词里 `[附件]` 的**示例路径**(`octo_insight.txt` + 镜像 `.md`),
仍写着 `/…/.octo/insight/ses_xxx/uploads/…` —— 模型会照抄示例的路径形状,一并改掉。

**没做的事**:`tmps/` 里历史堆积的旧文件不做自动迁移。它们不携带任何会话归属信息,按时间猜会串会话
—— **归错会话比看不见更糟**。

---

## 5. 可推广的几条

1. **迁移落点时,grep 的关键词是旧名字,不是新名字。** 搜 `.octo`/`tmps` 只能找到已经改对的地方;
   搜 `insight`/`uploads` 这些**旧路径段字面量**才能捞出残留。这次除了判据,还捞出提示词示例、
   server 端注释、OpenAPI description 三处残留。
2. **路径判据别用"含某一段名",用"从已知根派生"。** 本案更稳的写法是拿 `projectDir` 拼出
   `<baseDir>/.octo/tmps/` 前缀去比,布局一变就编译期/测试期爆,而不是安静地不匹配。
   段位匹配是权宜,至少要有测试把布局假设钉死。
3. **恒假的守卫是死分支,而死分支不报错。** 判据类代码值得问一句:"如果它永远返回 false,
   我从哪看出来?"答不上来就补日志或补测试。
4. **给验证步骤时,必须指明"去哪个进程看"。** Electron 三进程(主 / 渲染 / sidecar server)
   日志各去各的落点:`console.log` 写在 `main/` 下就不进 DevTools。没指明落点的"看有没有 X 日志",
   得到的"没看到"是个**无效观察** —— 既证明不了坏,也证明不了好。
5. **纯函数别住在组件里。** 判断逻辑一旦超出"一眼看穿",就搬进 `utils/` 导出 + 单测 ——
   住错地方等于自愿放弃回归保护。
6. **同一能力的两条实现路径,坏一条时不会有人报"坏了"。** 排查时先问"这个功能有几条路径进来",
   而不是默认只有一条。

---

## 6. 一句话教训

**注释先于实现被更新,是比注释过期更危险的一种漂移** —— 它让 review 读到的是"意图",而运行的是"旧事实",
两者都自洽、都不报错。再叠加"判据恒假 → 静默少做一步"、"私有函数不可测"、"旁路链路仍能用",
一个 4 行的疏漏就能安静活半年,并最终以"文件管理里少个文件"这种轻描淡写的样子被报上来。
