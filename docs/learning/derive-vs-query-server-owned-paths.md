# 宿主定位「由 server 管理的资源」：推导 vs 查询（以及一次把平台差异归错因的复盘）

**日期**：2026-09-20 · **现场**：内网 Mac x64，存量 fastui 产物点「导出代码包」报 `找不到 fastui-vue-creator 的 export-zip.mjs`；同版本 Windows 全部正常，同机新建会话的产物正常，skill 目录里脚本明明在。
**状态**：已实现修复（UXAI PR #904，`main/fastui-export.ts` 改为向 server 要 `Skill.Info.location`），**待内网验证**。

这篇有两条线：一条是技术的（宿主怎么定位 skill 目录），一条是方法的（**"Windows 好、Mac 坏"这个信号把我引向了错误的根因，而且错得很像真的**）。后一条可能更值钱。

## 一、现场与真因

三个反常点：Windows 全部正常（新老产物都是）；同一台 Mac 上新建会话的产物导出正常；用户去 skill 目录看，脚本确实在，手工跑 `export-zip.mjs` 也能出包。

从那台机器取回的数据（同一次采集、同一张终端截图里的两行）：

```
find: /Users/w00448758/.config/octo/skill/fastui-vue-creator /scripts/export-zip.mjs
ls:   /Users/w00448758/.config/octo/skill/fastui-vue-creator/scripts/export-zip.mjs → No such file
                                                            ↑ 实际目录名尾部多一个空格
```

单独确认过一遍：

```
$ ls -1 ~/.config/octo/skill | sed 's/$/|/'
H Design 官网设计规范 |      ← 尾部空格
ICT 规范 Skill|
creative-assets|
…
fastui-vue-creator |         ← 尾部空格
fastui-vue-skill|
…
竞品分析 |                    ← 尾部空格
半导体领域PC端设计规范 |      ← 尾部空格
```

**而且不是个例 —— 那台机器上 4 个 skill 目录都带尾部空格。** 这把问题的性质从"一次偶发事故"改成了"某条分发/安装链路会系统性地带进畸变"：靠"下次小心点"防不住，宿主侧必须不依赖目录名。

**skill 目录名是 `fastui-vue-creator␠`，skill 名是 `fastui-vue-creator`。** 宿主拿常量拼路径：

```ts
join(xdgConfig, "octo", "skill", SKILL_NAME, "scripts", "export-zip.mjs")   // ← SKILL_NAME 是常量
```

拼出的是不带空格的那个，`existsSync` 必然 false。而 server 扫 skill 走 glob `*/SKILL.md`，用的是**实际目录名**，照常加载 —— 所以 agent 用得好好的，只有宿主找不到。

同一次采集还显示：`XDG_CONFIG_HOME` **未设置**、app-data-fallback 落点**为空**。这两个值把下面第三节那套"环境变量分裂"的解释在这台机器上直接排除了。

### 为什么 Windows 免疫

Win32 API 在解析路径时会**剥离末尾的空格和点**（`CreateFile` / `CreateDirectory` 层面的行为，不是 shell 的事），NTFS 上正常途径根本创建不出 `fastui-vue-creator␠` 这样的目录名。所以同一份分发物、同样的拼路径代码，Windows 上永远对得上。

**平台差异来自文件系统的命名约束，不是来自代码里的 `platform === "win32"` 分支。** 这一点是这次复盘的核心，见第五节。

### 为什么只有存量会话中招

`new-session` 会把 `SKILL_DIR`（脚本用 `import.meta.url` 往上推，**是实际路径，带空格**）写进 `.octo-fastui.json`。新会话读这个字段，直接命中。升级前建的会话里没有这个字段，于是落到候选链上 —— 而候选链每一条都是拿常量拼的。

## 二、"`existsSync` 是确定判断"这句话的陷阱

改之前那版代码的注释是这么写的：

> 按候选逐个 `existsSync` 验 —— 是「文件在不在」的确定判断，不是猜路径。

这句话半对半错，而且错的那一半很隐蔽：**`existsSync` 验的确实是确定的事实，但被验的那个路径是拼出来的。** 确定的判断挂在不确定的前提上，整体仍然不确定。候选链不会给出错误答案（它只会说"没有"），但它会在前提错的时候**全部落空**，而落空的表现是"技能可能未安装"——一句把人引向完全错误方向的话。

判断一段路径逻辑是不是真的确定，问一句就够：**这个字符串里，有哪一段是我猜的？** 这里猜的是"目录名等于 skill 名"。

## 三、推导路径的三种失效模式

宿主要算出 `<octoConfig>/skill/<name>/`，至少有三处会崩，每一处都有代码依据：

### (1) 目录名 ≠ skill 名 —— 本次的真因

`Skill.Info.name` 取自 SKILL.md 的 frontmatter，目录名是另一回事：

```ts
// packages/opencode/src/skill/index.ts
const skillDir = path.basename(path.dirname(match))
state.skills[parsed.data.name] = { name: parsed.data.name, location: match, … }
state.skillDirMap[parsed.data.name] = skillDir     // ← 两者被分开记，因为它们本来就可能不同
```

server 从来不假设这两者相等，宿主假设了。

### (2) `XDG_CONFIG_HOME` 在主进程与 sidecar 之间取值不同

这条**机制真实存在**（仓里已经为它付过代价，见下），**但不是本次的根因** —— 本次现场那个变量压根没设。记在这里是因为它仍然会咬人：

- `main/storage.ts` 的 app-data-fallback 把它指到 `<userData>/xdg-config`，这份 env 只在 `main/sidecar.ts` 的 `prepareSidecarEnv()` 里 `Object.assign` 进**子进程自己的** `process.env`，从不写回主进程；而且这个模式一旦触发就持久化（`getStore().set(STORAGE_MODE_KEY, …)`），原因消失也退不回去。
- `main/server.ts` 的 `preferAppEnv()` 探测用户 shell（`zsh -il -c 'env -0'`）**只在 `platform !== "win32"` 时执行**，`mergeShellEnv` 是 `{...shell, ...process.env}` —— GUI 启动的主进程本来没有这个变量，于是 Mac 上会采纳用户 `.zshrc` 里的值。

> ⚠️ **但这两条合起来推不出"主进程与 sidecar 分裂"**：`createSidecarEnv()` 把主进程的 `process.env` **整份拷给 sidecar**（`main/server.ts:248-251`），而 `preferAppEnv()` 在 sidecar 启动之前就跑完了。所以 **legacy storage 模式下两边完全一致**。真正会分裂的只有 app-data-fallback 这一条路径，以及"装进去那一刻的 XDG"与"现在这一刻的 XDG"之间的跨时间差异。
>
> 这个约束是 review 时才被指出来的 —— 我最初的分析漏了 `createSidecarEnv`，推出了一个内部矛盾的模型（按那个模型，server 也该看不见这个 skill，那台 Mac 上 fastui 根本跑不起来，与事实冲突）。

另有一条确凿的不对称：`main/migrate.ts` 的 `deployBuiltinSkills()` **硬编码 `~/.config/octo/skill`**（`migrate.ts:185`），完全不看 XDG；而 server 扫的是 `Global.Path.octoConfig`（`core/global.ts:15`，由 `xdg-basedir` 推出，模块加载期求值）。设过那个变量的机器上，**部署落点与扫描落点本就是两个目录**。

### (3) skill 根本不在 `<octoConfig>/skill/` 下

`skill/index.ts:197` 还会扫**项目目录**下的 `{skill,skills}/**/SKILL.md`。装在那里的 skill，宿主无论怎么算都算不出来。

## 四、查询为什么对

```ts
GET <serverUrl>/skill?directory=<projectDir>     // Basic auth，与 checkHealth 同款
  → list.find(s => s.name === "fastui-vue-creator").location → dirname()
```

要害是**按 `name` 找、拿 `location`**：`name` 来自 frontmatter（稳定、是 skill 的身份），`location` 来自 `Glob.scan({ absolute: true })` 的实际扫描结果（是事实）。两者解耦，中间不经过任何"目录名应该长什么样"的假设。上面三种失效模式一次全覆盖。

代价只有一次回环 HTTP。注意它的前提：该 instance 必然是热的（会话就跑在它下面），所以是毫秒级；`directory` 万一推错、落到冷 instance 上，那边要做一次完整的 skill 发现扫描 —— 超时兜底是为那种情况留的。

**候选链保留为兜底，但必须清楚它兜的是什么**：server 未就绪 / 超时 / 该 skill 真没装。**对本次这个根因，候选链里每一条都同样 miss** —— 不要因为"加了候选 #4，bug 好了"就把因果搞反。

## 五、复盘：平台差异这个信号是怎么把我带偏的

这次的错误推理链条是：

1. 观察：Windows 全好、Mac 全坏。
2. 推论：**去代码里找 `platform === "win32"` 的分支**。
3. 找到了两个（`preferAppEnv` 的 shell 探测、`storage.ts` 的 fallback），它们确实都跟路径计算有关，而且确实都能造成"算错地址"。
4. 于是收工，写成了根因。

第 3 步的问题在于：**它找到的是一个能解释现象的机制，不是唯一能解释现象的机制**，而我没有去证伪。更糟的是，这个解释"看起来"特别可信，因为它引用的都是真实存在的代码，甚至仓里还有一条同机制的历史踩坑（`main/proxy-config.ts` 顶部注释记的就是 XDG 读写分裂）。**有先例的解释最容易被当成已证实的解释。**

真正的教训：

- **平台差异不一定来自代码里的平台分支。** 文件系统的命名约束（Windows 剥离末尾空格/点、大小写敏感性、路径长度上限、保留名 `CON`/`NUL`）同样是平台差异的来源，而且它们不在任何一个 `if (platform === …)` 里，grep 不出来。
- **能解释现象 ≠ 是根因。** 检验方法很便宜：把假设推到底，看有没有内部矛盾。我那个模型推到底是"server 也看不见这个 skill"，而现场明明是"skill 用得好好的" —— 这个矛盾在我写下分析的那一刻就已经存在了，只是我没有回头验算。
- **让现场数据来定案，而不是让机制来定案。** 一条 `find` 就能看出目录名畸变，而 `ls` 报 `No such file` 什么也看不出来。这两条命令我当时都给了，但我给的判读表只教人"比较两个路径相不相等"，没教人"看看实际有什么"。

## 六、排查手法

定位这类"路径拼不上"的问题，**先看实际有什么，再看算出来的是什么**：

```bash
# 1. 实际有什么 —— find 会把真实路径原样打出来，畸变一眼可见
find ~/.config/octo/skill -maxdepth 3 -name 'export-zip.mjs'

# 2. 目录名有没有不可见字符（尾部空格 / 全角空格 / 零宽字符）
ls -1 ~/.config/octo/skill | sed 's/$/|/'        # 竖线前有空格就是它
ls -1b ~/.config/octo/skill                      # 非打印字符转义显示

# 3. 算出来的是什么
echo "${XDG_CONFIG_HOME:-$HOME/.config}/octo/skill/"

# 4. server 实际用的（新会话的状态文件里记着，是 skill 自己写的实际路径）
grep -o '"skillDir": *"[^"]*"' <项目目录>/.octo/*/.octo-fastui.json | sort | uniq -c
```

`ls <算出来的路径>` 报 `No such file` 只能告诉你"这里没有"，不能告诉你"那么在哪"。**排查要从"有什么"那一侧入手，不要从"我以为在哪"那一侧入手。**

## 七、可以直接拿走的规约

1. **宿主要定位一个由 server 管理的资源，问 server，不要自己拼路径。** skill、config、agent 定义都属于这一类，它们的位置是 server 的实现细节。
2. **任何拿常量拼出来的路径都是假设，不是事实。** 写 `join(base, SOME_NAME)` 之前问一句：这个名字是谁定的、跟磁盘上那个名字是同一个东西吗？
3. **`existsSync` 不让一段路径逻辑变得"确定"。** 它只让"这个字符串对应的文件在不在"这件事确定。
4. **"Windows 正常、Mac 不正常"至少有两类来源**：代码里的平台分支（`preferAppEnv` 那种），和文件系统的命名约束（本次）。后一类 grep 不出来，只能靠看实际数据。
5. **候选链兜底要记日志**，落空时把试过的路径都 `log.warn` 出来（`[fastui] 定位不到导出脚本`），否则下次还是只能靠远程一问一答猜环境。
6. **写完根因分析，回头把它推到底再看一遍。** 有内部矛盾就说明还没到底。
7. **别把"用户不会这么命名"当保证。** 现场那 4 个带空格的目录名不是谁手抖打出来的，是某条链路系统性带进去的。凡是名字来自外部（分发物、用户输入、第三方目录），宿主侧就不能拿它当路径的一部分去拼。

## 相关

- `docs/specs/design/fastui-uxai-integration.md` §8.6.2（v17 修正）—— 导出脚本定位的候选表与验证
- `main/proxy-config.ts` 顶部注释 —— XDG 读写分裂的第一次踩坑记录（机制真实，但与本次无关）
- [stale-path-predicate-after-layout-refactor.md](stale-path-predicate-after-layout-refactor.md) —— 另一次"路径判据悄悄失效"的复盘，那次是恒假判据，这次是恒不命中的拼接
- [electron-main-fetch-vs-net-fetch.md](electron-main-fetch-vs-net-fetch.md) —— 同样是"两套东西看起来该一样、实际不一样"
