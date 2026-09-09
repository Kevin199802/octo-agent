---
name: fastui-vue-creator
description: 用 fastui/lake 组件库生成 Vue 页面,在真实脚手架里编译渲染并交付可运行的工程。当用户要做页面、要改页面、要看效果、要拿代码时使用。
version: 0.1.0
---

# fastui-vue-creator

把设计师的自然语言需求变成 `.vue` 页面,**在真实脚手架里编译**,再把预览地址交给 Design 渲染。

交付物是开发能直接 `yarn install && yarn serve` 跑起来的标准工程,不是任何中间产物。

---

## 工作流

```
① ensure-env   →  ② new-session  →  ③ 写代码  →  ④ verify  →  ⑤ 输出预览
                                        ↑             │
                                        └── 编译失败 ──┘  循环至通过

⑥ export-zip   ← 用户说"导出代码/打个包/给我代码"时才跑
```

脚本都在本 skill 的 `scripts/` 下。**用共享池里的 node 跑**(路径由 `ensure-env` 的 `ENV_DIR` 给出),
或在环境已就绪时直接 `node scripts/xxx.mjs`。

所有脚本的输出都是固定格式,**先读 `RESULT:` 那一行再决定下一步**:

```
RESULT: OK
KEY: value …

RESULT: FAIL | <CODE>: <原因>
HINT: <可直接执行的下一步>
```

### ① `ensure-env.mjs` —— 每个会话开头跑一次

```bash
node scripts/ensure-env.mjs
```

| `RESULT: FAIL` 的 CODE | 怎么办 |
|---|---|
| `ENV_MISSING` / `ENV_OUTDATED` / `ENV_NODE_MISMATCH` | **直接执行 `HINT:` 里那条命令**(安装/升级脚本),完成后重跑 `ensure-env`。这一步可能要几分钟,告诉用户在装环境 |
| `SKILL_NOT_ASSEMBLED` | 停下。这是 skill 没在内网组装好,**不是用户能解决的问题**,如实说明并给出 `HINT` 里的路径 |
| `WARN:` 开头的行 | 不阻塞,不用管,更不要转述给用户 |

**装不上时先跑 `doctor`,再报给用户** —— 别让用户自己去猜是网络、代理还是证书:

```bash
node scripts/doctor.mjs
```

它一次打印平台、skill 组装状态、共享池各部件、系统 node/yarn、**代理环境变量**、manifest 的 HTTP 状态与耗时、返回的是不是 JSON(代理错误页会在这里现形)。

**把 `OCTO_FASTUI_DOCTOR` 开头那整段原样贴给用户**,并指出其中异常的那几行(比如 `PROXY_*` 有值、`MANIFEST_HAS_MY_PLATFORM: NO`)。这些是环境问题,该由人处理,你绕不过去 —— 见硬约束 0.1。

> ⚠️ **`MANIFEST_HTTP_STATUS` 目前不可信,不要拿它下结论。** doctor 用 Node 的 `fetch` 探测,
> 而 `fetch`(undici)**完全忽略 `HTTP_PROXY` 环境变量**,install 脚本用的 curl 则会读 ——
> 两者走的根本不是同一条路。2026-09-08 内网就出现过 doctor 报 200、install 同时 504 的情况,
> 白白带偏了一轮排查。真正能说明问题的是 `PROXY_*` 那几行和 install 脚本自己的报错。
> 这个探针待重做,见 SPEC-DES-001 §10 的 Q10。

### ② `new-session.mjs` —— 每个会话建一次工程(幂等)

```bash
node scripts/new-session.mjs --artifact-dir="<[Artifact Folder] 绝对路径>" --name="<产物名>"
```

`--artifact-dir` 用系统给的 **[Artifact Folder]** 原值。`--name` 用一个简短的英文/拼音工程名。

记住返回的三个值,后面都要用:

- `WRITE_DIR` —— **你唯一可以新建文件的目录**
- `ENTRY_FILE` —— 聚合入口,**唯一允许你修改的既有文件**
- `PORT` —— 预览端口

### ③ 写代码 —— 边界见下面「硬约束」

### ④ `verify.mjs` —— 编译门禁

```bash
node scripts/verify.mjs --session-dir="<[Artifact Folder] 的上一级>"
```

dev server 起不来时(比如宿主环境不允许后台进程存活),可以让用户手工起一个,再用 `--port` 接管:

```bash
# 用户在 <PROJECT_DIR>/packages/portal 下跑 yarn serve,记下端口
node scripts/verify.mjs --session-dir="…" --port=8081
```

- `RESULT: OK` → 拿 `PREVIEW_URL` 走第 ⑤ 步
- `RESULT: FAIL | COMPILE_ERROR` → **读 `ERRORS_BEGIN`…`ERRORS_END` 之间的原文**,里面有 `file:line`,
  按它改代码,然后**再跑一次 verify**。改完必须重新验证,不要凭感觉判断
- 首次编译要 1–3 分钟,属正常

### ⑤ 输出预览 —— 不能省

`verify` 返回 `RESULT: OK` 之后,**必须**输出这一行(端口换成 `verify` 给的 `PREVIEW_URL`):

```
<artifact type="text/link">http://127.0.0.1:8081</artifact>
```

Design 靠这个标签渲染预览面板。**只有这个标签会被识别** —— 用别的形式给链接(纯文本 URL、markdown 链接、
代码块)都不会出卡片,用户就只能自己开浏览器,等于白做。

**这一步没做,整件事就不算完成**,和编译不通过是同等级别的未完成。

### ⑥ `export-zip.mjs` —— 用户要代码包时

```bash
node scripts/export-zip.mjs --session-dir="<[Artifact Folder] 的上一级>"
```

用户说「导出代码」「打个包」「把代码给我」之类的话时跑,产出 `outputs/<产物名>.zip`,
把 `ZIP_PATH` 告诉用户。

**只有这个脚本产出的包是干净的。** 产物目录里的 `node_modules` 是指向共享池的链接,
直接压缩整个目录会跟随链接把 1GB 依赖打进去;这个脚本会跳过链接并排除构建产物。

---

## 硬约束

### 0. 绝不删除用户磁盘上的任何东西 —— 这条没有例外

**禁止执行任何删除命令**:`Remove-Item` / `rm` / `rmdir` / `del` / `git clean`,不论加什么参数、
不论那个目录看起来多像垃圾残留。清理由 skill 脚本在共享池和会话目录内自己做,那是脚本的职责,不是你的。

2026-09-07 内网真实发生过:Windows 上中文路径建链接失败,PowerShell 把中文目录名显示成乱码,
agent 把用户的正常目录当成"失败操作留下的残留",执行 `Remove-Item -Recurse -Force` 永久删除 ——
绕过回收站,不可恢复,用户的资料没了。

**你在终端里看到的乱码目录名,极可能是完全正常的中文目录。** 编码显示问题从来不是删除的理由。

| 情况 | 正确动作 |
|---|---|
| 建链接 / 复制失败,目录看起来是残留 | 原样报告失败,让用户自己看那个目录 |
| 装不上,怀疑共享池坏了 | 跑 `doctor`,把输出给用户;要不要重装由用户决定 |
| 目录名是乱码,不确定那是什么 | **什么都别做**,把路径原样贴给用户 |

同理禁止:用 `sudo`(agent 没有交互通道,会静默挂住等密码)、改用户机器的**全局配置**
(`~/.npmrc`、shell profile、系统代理设置)。那些不是你能替用户决定的。
—— 脚本自己的开关(如 `--env-dir` / `--proxy` / `OCTO_FASTUI_ENV_DIR`)不在此列,该传就传。

**需要清理时,脚本会给你合法出口。** 目前只有一处:`new-session.mjs` 报 `PROJECT_INCOMPLETE`
时,按 `HINT:` 加 `--reset` 重跑,由脚本自己删掉残骸并重建(它会先校验路径在会话目录内)。
除此之外,任何"清理"都是报给用户、由人决定。

### 0.1 不要绕过脚本

脚本失败时,**唯一正确的动作是按 `HINT:` 处理或如实报告失败**。以下这些"看起来能绕过去"的做法一律禁止:

| ❌ 禁止 | 为什么 |
|---|---|
| 自己跑 `yarn serve` / `yarn dev` 代替 `verify` | 绕过 verify 就没有编译门禁,你会开始"我觉得应该好了";而且 `verify` 还负责端口分配、写 `.devserver.json` 给宿主回收进程 |
| 修改、调试 `scripts/` 下的任何文件 | 那是 skill 的一部分,不是本次任务的产物。脚本有 bug 应该报告,不是就地改 |
| 环境装不上就换个方式硬凑一个能跑的 | 装不上是环境问题,该由人处理。你绕过去之后跑起来的东西,和设计师机器上的不是同一个 |

**脚本报错不是让你想办法绕开的障碍,是让你转达的信息。** 把 `RESULT:` / `DETAIL:` / `HINT:` 原样告诉用户,
说明卡在哪一步。

> **系统里已有的 `node` / `yarn` 是可以用的** —— 脚本会优先用共享池里的版本,没有时回退到系统的,能跑起来就行。
> 真正不可替代的是**共享池里那 1GB 依赖**(`@lake/*` 等内网组件库),那个没有装好谁都跑不起来。

### 1. 编译不通过就不算做完

**这是最重要的一条。** 不允许在 `verify` 没有返回 `RESULT: OK` 的情况下告诉用户"做好了"。
编译失败就读错误、改代码、重跑 verify,直到通过。

### 2. 只碰这两个地方

| 允许 | 路径 |
|---|---|
| ✅ 新建 | `<WRITE_DIR>/<页面名>/` 下的任何文件 —— 一个页面一个目录,主文件叫 `index.vue`,拆出来的子组件、样式放同目录 |
| ✅ 修改 | `<ENTRY_FILE>`(即 `views/index.vue`)—— 加一行 import、加一个标签,把新页面挂上去 |
| ❌ 不动 | `src/` 下的 `app.vue`、`index.vue`、`main.vue`、`i18n/`、`interfaces/`、`utils/`,以及工程根的所有配置文件 |

那些是脚手架的壳,改了会让整个工程起不来,而且它们和交付给开发的结构强相关。

多个页面时,在 `<ENTRY_FILE>` 里怎么组织(tab 切换、纵向排列)按用户的实际要求来,不必预设。

### 3. 组件引入方式

- **lake 组件从 `'$/xxx'` 引入** —— `$` 是本脚手架的 webpack alias,**不是 npm 包名**,不要写成 `@lake/xxx`
- element-plus 走正常包名

**模板里用到的每一个组件,都必须在 `<script setup>` 里 import。** 这个脚手架**没有全局注册**
element-plus 或 lake 的组件:

```vue
<script lang="ts" setup>
// 用了 ElTable / ElTableColumn / ElTag / ElInput,四个都得 import
import { ElTable, ElTableColumn, ElTag, ElInput } from 'element-plus'
</script>
```

**模板里的组件标签一律写 PascalCase**(`<ElTable>` 而不是 `<el-table>`):

```vue
<!-- ✅ 对 -->
<script lang="ts" setup>
import { ElTable, ElTableColumn, ElTag } from 'element-plus'
</script>
<template>
  <ElTable :data="rows">
    <ElTableColumn prop="name" label="设备名称" />
    <ElTableColumn label="状态">
      <template #default="{ row }"><ElTag>{{ row.status }}</ElTag></template>
    </ElTableColumn>
  </ElTable>
</template>

<!-- ❌ 错(内网实测真实踩过):ElButton import 了,el-table 没有 —— -->
<!--    编译照样通过,页面白屏,console 里 Failed to resolve component: el-table -->
<script lang="ts" setup>
import { ElButton } from 'element-plus'
</script>
<template>
  <ElButton>新增</ElButton>
  <el-table :data="rows"><el-table-column prop="name" /></el-table>
</template>
```

> **为什么强调大小写形式**:kebab-case 的 `<el-table>` 看起来像原生 HTML 标签,很容易被当成"不需要 import"
> ——上面那个真实错误就是这么来的(PascalCase 的 `ElButton` 记得 import,kebab-case 的 `el-table` 忘了)。
> 统一写 PascalCase,标签本身就在提醒你"这是个组件,需要 import"。
>
> ⚠️ **漏 import 编译不会报错,页面会白屏。** webpack 不知道模板里 `<el-table>` 指的是什么,
> 编译照过;要到浏览器里才会看到 `[Vue warn]: Failed to resolve component`,然后整页炸掉。
> `verify` 会做一次静态检查并输出 `WARN: … 用了 X 但没有 import`,**看到这个警告必须回去补 import,
> 不能因为 `RESULT: OK` 就当作做完了**。

具体有哪些组件、各自的 API,查本 skill `vendor/` 下那三份组件文档。

### 4. golden example

`<WRITE_DIR>/_example/index.vue` 是一个**真实编译通过**的最小示例,写第一个页面前先读它:

```vue
<script lang="ts" setup>
// Octo golden example —— 唯一目的是示范本脚手架特有的引入方式:
//   lake 组件从 '$/xxx' 引入($ 是本脚手架的 webpack alias,不是 npm 包名);
//   element-plus 走正常包名。
// 生成页面时替换掉 views/index.vue 里对它的引用即可,本文件不必保留。
import { ElButton } from 'element-plus'
import { LakeIcon } from '$/lake-basic-component'
</script>

<template>
  <ElButton type="primary">
    <LakeIcon name="Add" />
    新增
  </ElButton>
</template>

<style></style>
```

**照它示范的引入方式写,但不要照抄它的形态** —— 它只是示范约定,不是页面模板。

---

## 交给用户的话怎么说

- 装环境时:说在准备环境、需要几分钟,不要贴命令和路径
- 编译失败自己修时:**不要每轮都汇报**,修好了一起说
- 做完时:说页面已生成、可以在预览里看;产物目录路径可以给
- `SKILL_NOT_ASSEMBLED` 这类用户解决不了的问题:如实说明是环境配置问题,不要试图绕过

---

## 已知边界

- 产物是**标准工程结构**,`yarn install && yarn serve` 在里面直接可用。工程根的 `node_modules`
  是指向共享池的链接(所以不用重装 1GB),代价是**整目录压缩会跟随链接**——
  要交付包就跑 `export-zip`(第 ⑥ 步),别让用户自己压缩目录
- 预览是 `http://127.0.0.1:<port>`,与 Design 页面**跨源** —— 选中元素、手动编辑这类功能在预览里不可用,第一版只做纯预览
- 编译通过 ≠ 渲染正确。样式错位、布局不合设计意图,机器判断不了,要设计师自己看
