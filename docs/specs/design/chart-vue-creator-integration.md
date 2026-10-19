# SPEC-DES-006 — 图表设计 skill 接入 fastui 编译交付管道

> 把设计师团队维护的图表设计方法论（上游 `chart-design-advisor`）与我们的「环境 → 编译门禁 → 预览 → 导出」管道组合成一个 skill `chart-vue-creator`，让图表原型产出**开发可直接 `yarn install && yarn serve` 的工程**，而不是一份自述"已验证"的源码。
>
> 管道本体见 [SPEC-DES-001](fastui-vue-codegen-pipeline.md)，本 spec 只写**组合方式**与**边界**，不重复管道机制。

---

## 0. 当前进度与待办

### 已完成

| | 状态 |
|---|---|
| skill 骨架（SKILL.md 两段式、scripts、design 实体化） | ✅ 已合入 dev |
| 上游 v0.6.8 同步 | ✅ `design/` = 上游 commit `1629ba8`（2026-10-14，版本号未涨） |
| 内网组装 + 端到端跑通 | ✅ 2026-10-13，柱状图，`verify` 返回 OK、预览出图 |
| echarts 在老 webpack 上可用 | ✅ 内网实测（产物带 `_echarts_instance` attr） |
| 外网自动验证 | ✅ 链接 0 死链、`lint.test` 31/31、`verify.test` 5/5 |
| 样式写法约束 | ✅ 同步自组件 skill 1.0.7（SKILL.md 硬约束 3.2，golden example 同步改写；只取写法、不取视觉值，§4.4）。内网待验 N8 |
| 版本管理 / 首次上架 | ✅ 2026-10-19 定 `1.0.0`(design/ = 上游 v0.6.8 @ `1629ba8`),按 [SPEC-DES-001 §5.2.4](fastui-vue-codegen-pipeline.md#524-发布版本号与-changelog):`doctor` 改读 frontmatter、删 `env.manifest.json` 的 `skillVersion`(两份 `scripts/` 重新只差 `ensure-env.mjs` 一行 hint)。版本记录见 [docs/releases/skills/chart-vue-creator.md](../../releases/skills/chart-vue-creator.md) |

### 待办

| # | 事项 | 阻塞谁 |
|---|---|---|
| T1 | **效果基线盲评** —— 同一提示词，集成版与上游原版各跑 3 次让设计师盲评。设计师反馈"有时比单跑原版差"，但样本量未知，没有基线后面所有优化都没有判据（§5.3） | 决定 T2 做不做 |
| T2 | 下半段瘦身：环境类内容拆到 `references/environment.md`，SKILL.md 只留判断分支与指针 | 等 T1 |
| T3 | `_example/index.vue` 本身是否被编译过 —— SKILL.md 称它"真实编译通过"，内网首跑时模型可能已替换掉入口对它的引用 | 文案诚实性 |
| T4 | 复杂图表实测（平行坐标、箱图叠点云等）—— 柱状图证明管道通，不证明能力够 | — |
| T5 | 拿产物问开发"这样交付收不收" —— 决定要不要做封装组件 / 裸 ECharts 的分流（§5.2） | — |
| T6 | macOS 弹 python3 安装窗：抓现场确认来源。**2026-10-14 找到更可能的来源**：没 node 的 Mac 上管道自己的 `install.sh` 会调 `/usr/bin/python3`（没装 CLT 时是个一运行就弹窗的占位程序），已在 [SPEC-DES-001 v20](fastui-vue-codegen-pipeline.md) 去掉；次要嫌疑（上游文档命令）已由上游 `1629ba8` 收口（§7.2） | — |
| T7 | `echarts` 从幻影依赖提成直接依赖（§6.2） | 不阻塞 |
| T8 | 漏 import 门禁覆盖 `echarts` 与 element-plus 命令式 API（SPEC-DES-001 的 L1） | 不阻塞 |
| T9 | `export-zip` 不检查本次代码是否通过 `verify`（上游 codex 评审指出） | 不阻塞 |
| T10 | `verify` 偶现卡死 —— 与本次集成无关，`verify.mjs` 两份代码相同，fastui 侧同样存在 | 独立排查 |

---

## 1. 这份 spec 解决什么

设计师团队有一套成熟的图表设计方法论 skill（方法路由、图表规范、数据语义），但它的产物止于源码：模型自己跑 typecheck、自己声明"已验证"，没有任何会**响亮失败**的门禁，开发拿到的也不是能直接跑的工程。

我们有一套已在内网跑通的管道（SPEC-DES-001），但它的组件知识是 fastui/lake，与图表无关。

两边组合的价值是**互补而非叠加**：他们提供"画什么、怎么画对"，我们提供"真的编译过、真的能预览、真的能交付"。

**不解决**：复用内网封装的业务图表组件（§5.2）、管道机制本身的改进（归 SPEC-DES-001）。

---

## 2. 关键事实：上游产物早就不是 HTML

立项时的普遍认知是"图表 skill 产出 HTML"，实际 v0.6.6 起上游**默认就交付 Vue 3 + TypeScript + ECharts 组件 + Vite 预览工程**，还要求随工程产出 `HANDOFF.md`、交付前跑 typecheck 和生产构建。

这个认知差改变了整件事的性质：我们要给的不是"生成 Vue 代码的能力"，而是**验证与交付链路**。后续所有设计决策都建立在这个事实上。

---

## 3. 复用形态：三种做法与选型

管道脚本要同时服务两个 skill，业界对"一份内核、多处复用"有三种成熟做法：

| 做法 | 代表 | 用在这里的样子 | 判断 |
|---|---|---|---|
| **A. 共享内核 + 各自配置** | ESLint shareable config + plugin、Nx executor/preset | 抽 `scripts/` 成共享包，两个 skill 各带一份 profile（工程根、可写目录、启动命令、lint 方言） | **方向正确，但不是第一版**。profile 契约要先知道哪些点真的需要参数化，而这只有两边都跑稳之后才看得清 |
| **B. 独立单元互相调用** | microservice、npm peer dependency | 环境与构建做成独立 skill，图表 skill 调它 | **✗ 否决**。SPEC-DES-001 §8.2 已定"用户只调我们这一个入口"；跨 skill 调度靠模型自己判断，不可靠，且两个 skill 的 description 会互相抢触发 |
| **C. 整体复制（vendoring）** | Go vendor、monorepo 内复制 | 直接拷一份 `scripts/`，分叉维护 | **✓ 第一版采用**。两份现在几乎一致，代价是 bug 修两遍；换来的是不用先设计 profile 契约 |

**选 C 的代价是明确记账的**：两份 `scripts/` 从拷贝那刻起分叉。当前实际差异只有 `ensure-env.mjs` 一行 hint 文案（`design/` 实体化后那条额外检查已撤回）。等 T10 排查完、差异点收敛清楚，再按 A 抽共享包——那时候抽也更准。

### 3.1 被否决的其它形态

| 方案 | 否决理由 |
|---|---|
| 集成进现有 `fastui-vue-creator` | 两套领域知识（组件库 API / 图表设计方法）挤在一个 skill 里，注意力竞争。立项时的担心，后被实测佐证（§5.1） |
| `template-overlay/` 目录（只放要覆盖的模板文件） | 徒增一层结构。模板改动极少，内网手工替换一个文件即可 |
| `assemble.mjs` 组装脚本 | 本地路径每次不同，参数化脚本换不来比"复制一个目录"更省的事。与 SPEC-DES-001 §8.3 同一判断 |
| git submodule 引上游 | **内网访问不了外网**，submodule 在内网拉不到；而我们是整目录覆盖，不需要精确到 commit 的版本绑定 |

---

## 4. 隔离边界：谁维护什么

| 我们维护 | 上游维护（`design/`，我们不改） |
|---|---|
| `SKILL.md`（全量） | `02-router/` `03-methods/` `04-references/` `05-tests/` `06-assets/` `VALIDATION.md` |
| `scripts/` `references/` | |
| `template/`（内网脚手架 + ECharts golden example） | |

### 4.1 SKILL.md 为什么由我们全量维护

和 SPEC-DES-001 的 vendor 模式相反：那边 SKILL.md 是我们写的、vendor 是别人的；这边主体内容是上游的，SKILL.md 却归我们。理由三条：

1. 注入管道之后，SKILL.md 承载的是**工作流程和门禁** —— 谁的门禁谁定流程
2. 它只有几 KB，手工合一次远便宜于写一个靠字符串匹配、匹配不上就失败的注入脚本
3. 全量覆盖没有"匹配失败"这种中间状态

**两段式结构**：上半段是设计方法（基本照抄上游，链接加 `design/` 前缀），下半段是工程流程与硬约束，文件开头写明**冲突以下半段为准**。上游发新版时只需 diff 上半段。

### 4.2 与上游 `hosted-project.md` 的分工

上游 v0.6.8 主动新增了 `04-references/prototype/hosted-project.md`，专讲"接入既有工程与管道"，内容与我们下半段高度对应（不覆盖工程根文件、遵从承载环境的 ECharts 导入方式、不另起构建进程替代门禁、预览入口按宿主要求给出、不自行压缩含链接的工程目录）。

**分工定死：上游写通用原则，我们写本环境的具体命令、路径与失败码。** 同一件事两边都写会互相冲突并白占上下文。升级时按这条判断新内容该不该同步进上半段。

### 4.3 我们向上游提的建议（已全部采纳）

上游 v0.6.7/0.6.8 按我们的反馈改了四条，根因都是"文档假设了工程是本次从零生成的、根目录归我管"：

| 建议 | 落点 |
|---|---|
| `HANDOFF.md` 不固定在工程根目录 | 既有工程里随页面/组件放，不覆盖宿主原有文档 |
| 不强制修改工程 README | 从最终交付说明给入口（新建独立工程仍要求 README 链接） |
| 用承载环境的验证手段，以实际门禁输出为依据 | 已覆盖，并明确未执行项不能写成通过 |
| 工程形态由环境决定 | 优先接入既有工程，无承载工程时才默认 Vite |

上游评审同时反向指出我们两处写窄了，均已修正：

1. 「验证与限制只写 `verify` 的实际结果」**过严** —— `verify` 只管编译，用它卡住所有验证项，等于把视觉、导出、业务接入这些该记的全堵死。改为**四层分别记录**：编译门禁以 `verify` 输出为准 / 视觉与交互照实写看过什么 / 导出分工程代码包与图片导出两项 / 业务图表组件一律记待接入。
2. element-plus 与半导体规范"不额外引入外部 UI 库"**表面冲突** —— 区分"使用承载工程已有依赖"（遵从既有约定）与"自行新增 UI 库"（受限）；并补明**用了 element-plus 不等于视觉合规**，字体/间距/颜色仍按所选规范逐项核对。

### 4.4 样式写法：同步自组件 skill，只取"怎么写"，不取"取什么值"

**来源**：组件 skill（`fastui-vue-creator` 的 `vendor/`）**1.0.7** 的「7.1 样式编写优先级」。fastui 组装后天然带着这一段；chart 刻意不带 vendor（§5.1），不会自动同步，所以抄进来。**组件 skill 以后改这一段，按这里的版本号判断 chart 要不要跟。**

**落点**：SKILL.md 下半段硬约束 **3.2**（约 15 行，直接内联 —— 写样式是每次都会发生的事，放 `references/` 靠指针去读，大概率读不到），golden example 同步改成示范写法（Tailwind `w-full` + `<style lang="less">` 引入 `mixin.less` + 一处 `// 待整改`），否则示例与规则矛盾 —— 那正是 §5.3 排第一的质量嫌疑。

**只取写法三条**（Tailwind 优先 → Less 引用 `mixin.less` → 没有的值标「待整改」），这是纯工程约束，与上半段不冲突。**原文的视觉取值部分（颜色 / 尺寸速查表 + 强制要求 1~7）没有同步**：视觉取值归设计师的图表规范管（§4 隔离边界），而且放进下半段会因"冲突以下半段为准"反过来盖掉已确认的图表视觉数值。3.2 因此写明只管页面 CSS，ECharts option 里的取值按上半段规范；取自图表规范、`mixin.less` 里又没有的值，照规则标「待整改」并写明来源。

**交给设计师决定的冲突**（视觉速查表 vs 图表规范；是否、如何合入由他们定）：

| 速查表 / 强制要求 | 图表规范 |
|---|---|
| 次要文本 `#676767`、说明文本 `#939393`、占位 `#BBBBBB` | 标题说明 / 轴单位 / 图例文字 `#777777`，刻度文字 `#AEAEAE`（[visual-basics](../../../skills/chart-vue-creator/design/04-references/chart-spec/common/visual-basics.md)） |
| "颜色必须从规范色值中选取" | 系列色板 `#2070F3` 等均不在速查表内（[color](../../../skills/chart-vue-creator/design/04-references/chart-spec/common/color.md)） |
| "所有尺寸数值必须为 4 的倍数" | 标题旁下拉图标 10×10px（visual-basics「图标」） |
| "所有组件参数必须遵循 tokens.md" | chart 包内没有 `tokens.md`，引了即死链 |

**对 template 的要求**：工程里要有 `tailwind.config.js` 与 `src/assets/styles/mixin.less`（`~@/assets/styles/mixin.less` 解析到它）。这两样是 2026-10 手工加进内网脚手架的 —— 若源脚手架本身没有，**重新复制 `template/` 时要补回**（§7.1）。

---

## 5. 技术栈：裸 ECharts + element-plus

### 5.1 为什么不带 lake 组件文档（vendor）

**实测证据**：拷贝 `fastui-vue-creator` 改名后直接试跑（保留 `vendor/`），提示词里写了"使用 echarts"，模型仍然用 lake 的图表组件生成；补一句"使用纯 echarts 而非 lake 组件"才掰回来。

带偏的来源有三处，必须一起拔掉，只删 `vendor/` 不够：

| # | 位置 | 原内容 |
|---|---|---|
| ① | `vendor/` 三份组件文档 | lake 组件的全部 API 知识 |
| ② | SKILL.md 硬约束 3 | 「lake 组件从 `'$/xxx'` 引入」整节 |
| ③ | SKILL.md 硬约束 4 的 golden example | `import { LakeIcon } from '$/lake-basic-component'` |

②③ 在正文里，比 vendor 更靠前、更像"规矩"。删了 vendor 却留着 ②，模型会照着 `'$/xxx'` 硬编组件名——拿不到 API 只能瞎编，比用 lake 更糟。

第 ④ 处是脚手架壳 `main.vue` 里的 `LakeLayout`，不能动（动了起不来），改为在硬约束 2 里写明"壳里的 lake 组件是布局用的，页面里不要照着引"。

### 5.2 代价：不复用封装的业务图表组件

本管道直接用 ECharts，**不接内网封装的图表组件**（如业务 BoxPlot）。这是刻意的边界，不是遗漏——设计 skill 的定位正是"组件做不了的复杂图表"，而封装组件的能力边界写死在它源码里，撞到边界只能放弃或绕路。

但两条代价要摆明：

1. **视觉一致性** —— 封装组件大概率内置了 HD/半导体规范的 token，裸 ECharts 要自己实现一遍，容易和平台其它图表不像一家
2. **开发侧接受度** —— 若团队规范是"图表一律走封装组件"，这份代码可能被打回

所以正确定位是**分流而非替代**：常规图表走封装组件，组件做不了的才走裸 ECharts，并在 HANDOFF 里写明为什么没用组件（已落地：四层记录的"业务图表组件接入"一律记待接入）。

**当前卡点**：包里没有封装组件的能力信息，模型无法判断"这张图组件能不能做"。要解这个**不需要把整套组件 API 文档塞回来**（会重蹈 §5.1），只需一页纸的能力对照表（支持哪些图表类型、哪些交互、哪些不支持），由开发或组件团队维护。等 T5 有结论再定。

### 5.3 已知的生成质量问题

设计师反馈：集成版有时比单跑上游原版效果差。三个嫌疑，权重从高到低：

| 嫌疑 | 判断 |
|---|---|
| **上下半段指令矛盾**（v0.6.6 时期） | 最大嫌疑。上半段说"默认交付 Vite 预览工程"，下半段说"在既有脚手架里编译、不另起 Vite" —— 模型得先做一次取舍，而取舍结果每次可能不同，正好对应"有时候差一些"。上游 v0.6.8 从源头消除了它 |
| 上下文占用 | 真实存在。上游原版 SKILL.md 约 40 行，我们 487 行。但纯长度的影响通常不如矛盾指令大 |
| 概率波动 | 存在，但解释不了"系统性地比单跑差" |

⚠️ **v0.6.8 在这件事上有两个相反方向的作用**：消除矛盾（改善）、同时新增「原型交付硬门槛」一节与两个入口文件（内容变长，恶化）。净效果判断不了，**只能实测**——这就是 T1 必须先做的原因。

---

## 6. 与 fastui-vue-creator 的关系

### 6.1 共享依赖池：两份 `yarn.lock` 必须逐字相同

共享池路径固定（`OctoAgent/fastui-env`，不按 skill 区分），而 `ensure-env.mjs` 的主判据是 `template/yarn.lock` 的 sha256 与池子里 `deps/yarn.lock` 的比对（[ensure-env.mjs 第 3 步](../../../skills/chart-vue-creator/scripts/ensure-env.mjs)）。

**两份 lock 差一个字节**，设计师用 A skill 时被判 `ENV_OUTDATED` 刷成 A 的依赖树，切到 B 又刷回去——每次切 skill 触发一次几分钟的全量升级，来回拉锯，现象看起来像"环境老是坏"，极难归因。

准确的规则：

- `ensure-env` **只比 `yarn.lock`，不读 `package.json`** → lock 不变时两份 `package.json` 可以不同
- 改动会让 lock 变 → **必须两份 template 一起改**

安全网：`setup-env.mjs` 装完会比对 template 与 deps 两份 lock，不一致直接 `LOCKFILE_DRIFT` 响亮失败，不会退化成"每次 ensure-env 都要我升级"的死循环。

### 6.2 `echarts` 是幻影依赖

`echarts@5.5.1` 在 `yarn.lock` 里但不在 `package.json` 里——被 `@lake/lake-report-component` 等上游包带进来，yarn 1 的扁平化 hoisting 让它可以被直接 `import`。

**现状不影响运行与交付**：内网实测可用；`export-zip` 的排除清单里没有 `yarn.lock`，开发拿到的是带锁的完整工程，`yarn install` 照样装 5.5.1。

**真正会咬人的场景**：开发多半只把 `.vue` 搬进自己的真实项目，那边 `package.json` 没有 echarts，就会踩同一个幻影依赖。

**修法（T7）**：在 `template/package.json` 加 `"echarts": "5.5.1"`，**必须精确版本**——lock 里已有 `echarts@5.5.1:` 这个精确 descriptor，写 `5.5.1` 正好命中，lockfile 零变化；写 `^5.5.1` 会生成新 descriptor，lock 变了就要走全员升级。验证见 §8。

### 6.3 预览卡片仍用 `fastui://`

宿主注册的 subtype 就叫 `fastui`（[SPEC-DES-005](fastui-subtype.md)），与 skill 叫什么无关。模型很容易"好心"改成 `chart://`，那样预览卡片直接废掉。SKILL.md ⑤ 已写死禁止。

---

## 7. 组装与升级

> 本节是组装的**唯一真相源**。skill 包里不放组装说明 —— 那是维护者的事，不是设计师使用场景要用到的东西（沿用 SPEC-DES-001 §8.3 的边界）。`template/PLACEHOLDER.md` 只留一句指针，它存在的功能性理由是 `ensure-env.mjs` 靠它判断"未组装"。

### 7.1 组装：只剩填 `template/` 一步

`design/` 自 v0.6.8 起是**实体内容**，跟着 git 走，不需要手工平移。所以组装只做两件事：

**① 填 `template/`** —— 按 SPEC-DES-001 §8.3 把内网脚手架复制进来（排除根目录 `node_modules/`，但 `packages/portal/node_modules/` 那 735 字节要保留）。复制后确认工程里有 `tailwind.config.js` 与 `src/assets/styles/mixin.less`（硬约束 3.2 与 golden example 依赖它们，见 §4.4）。

**② 替换 golden example** —— 把 `SKILL.md` 硬约束 4 里那份 ECharts golden example 写进
`template/packages/portal/src/views/_example/index.vue`，**逐字一致**。这是本 template 与
`fastui-vue-creator/template/` 唯一允许存在的差异。

**③ 删掉 `template/PLACEHOLDER.md`**，跑一次 `ensure-env.mjs` 自检。

#### 组装后必须自检：两份 `yarn.lock` 的 sha256 相同

```bash
shasum -a 256 <文档仓>/skills/fastui-vue-creator/template/yarn.lock \
              <文档仓>/skills/chart-vue-creator/template/yarn.lock
# 两行 hash 必须完全一样，理由见 §6.1
```

### 7.2 upstream 同步

上游已公开托管：<https://github.com/peterbobidu/chart-design-advisor>。合规障碍因此消失（内容所有者自己公开了，我们再存一份不增加暴露），`design/` 由占位改为实体。

| | |
|---|---|
| 当前同步版本 | **v0.6.8**（上游 commit `1629ba8`，同步于 2026-10-14；上一次 `dc562a3`，2026-10-13） |

**搬进来时做了什么**：整目录平移，相对关系不变 —— 上游文件之间的 `../03-methods/`、`../VALIDATION.md` 这类链接全部仍然成立。只改了一行：`description.md` 里指向包根的 SKILL.md 链接改成 `../SKILL.md`。

**没搬进来的**：

| 不搬 | 为什么 |
|---|---|
| `SKILL.md` | 本 skill 的 SKILL.md 由我们维护（§4.1）。上半段已把上游的设计规则抄进来并加了 `design/` 前缀 |
| `scripts/`（`check_package.py` / `check_prototype.py`） | 上游包自用的检查工具，本环境唯一门禁是 `verify.mjs`。**macOS 未装 Command Line Tools 时执行 `python3` 会弹系统安装窗**（T6 的嫌疑来源），不搬就少一个诱惑源。代价是 `delivery-gates.md` 里那条 `python3 .../check_prototype.py` 成为死链 —— 它属于"新建独立 Vite 工程"分支，本环境永不走到，SKILL.md 另有硬约束禁止执行 `design/` 下任何脚本 |
| `README.md` | 上游 README 引用了 `AGENTS.md` / `CONTRIBUTING.md` / `.github/workflows/`，搬进来只会制造死链 |
| `.github/` `.githooks/` `.gitignore` `AGENTS.md` `CONTRIBUTING.md` | 上游的仓库治理文件，生产包用不到 |

**升级到上游新版本**：

1. `git clone` 或 `git pull` 上游仓，看一眼 `CHANGELOG.md` 与 `git log`
2. **整目录覆盖** `design/`（按上表排除），重做那一行链接修正，**不做任何 merge**
3. **diff 上游 `SKILL.md` 与本 skill SKILL.md 的上半段** —— 上游改了设计规则 / 按需读取表 / 新增入口文件，要同步抄进上半段并加 `design/` 前缀；下半段是我们的地盘，不受上游影响
4. 更新本节的「当前同步版本」，**必须连 commit 一起记** —— 上游会不涨版本号就改内容（`1629ba8` 即是）
5. 检查新增文件有没有与下半段重复或冲突的规则，判据见 §4.2 的分工
6. **在版本记录的「未发布」段记一笔"design/ 同步至上游 v<版本> @ <commit>"**,上架时按 [SPEC-DES-001 §5.2.4](fastui-vue-codegen-pipeline.md#524-发布版本号与-changelog) 涨号(同步上游新内容一般为 minor)

已向上游反馈两处会进生产包的 `python3` 可执行命令（`delivery-gates.md` 的 `check_prototype.py`、`README.md` 的 `check_package.py`），建议把限定说明挪到命令前面。**上游 `1629ba8` 已采纳**：限定说明前置，并改为"确认有可用解释器才执行、不试运行系统 `python3` 探测、不为此装 Python 或 CLT"，`vue-echarts-delivery.md` 与回归用例同步。该提交的 `VALIDATION.md` 另记了一条跟进项「creator 的 `install.sh` 存在 `require_py`」—— 那是 v20 之前的代码，已由 [SPEC-DES-001 v20](fastui-vue-codegen-pipeline.md) 去掉，可回告上游关闭。

## 8. 验证

### 8.1 外网（本地可做）

> skill 文件改动后，**运行中的 Octo 需要重启才会重新加载 SKILL.md**；验证生成行为前先重启，否则测的是旧版提示词。

| # | 验什么 | 怎么验 | 状态 |
|---|---|---|---|
| V1 | `SKILL.md` + `design/` 全部相对链接可达 | 遍历所有 md 的 markdown 链接，检查目标存在 | ✅ 0 死链 |
| V2 | 门禁逻辑未被破坏 | `node scripts/lib/lint.test.mjs`、`node scripts/verify.test.mjs` | ✅ 31/31、5/5 |
| V3 | 全部脚本语法正确 | `node --check` 遍历 `scripts/**/*.mjs` | ✅ 通过 |
| V4 | 未组装时响亮失败 | 不填 `template/` 直接跑 `ensure-env.mjs` | ✅ 报 `SKILL_NOT_ASSEMBLED` 并点名文件 |
| V5 | 两份 scripts 的差异可枚举 | `diff -r` 两个 skill 的 `scripts/` | ✅ 仅 `ensure-env.mjs` 一行 hint 文案 |
| V6 | **效果基线盲评**（T1） | 同一提示词，集成版与上游原版各跑 3 次，设计师盲评 | ⏸ 待做 |

### 8.2 内网验证

> 需要内网脚手架、共享依赖池与真实 Octo 宿主，外网无法替代。

| # | 验什么 | 判据 | 状态 |
|---|---|---|---|
| N1 | 组装后端到端 | `ensure-env` → `new-session` → 写图表页 → `verify` 返回 OK → 预览出图 | ✅ 2026-10-13 柱状图 |
| N2 | ECharts 在老 webpack 上可用 | 产物 DOM 带 `_echarts_instance` attr，图形正确渲染 | ✅ 同上 |
| N3 | golden example 本身编译通过（T3） | `_example/index.vue` 在入口引用下被实际编译 | ⏸ 待确认 |
| N4 | 复杂图表（T4） | 平行坐标、箱图叠点云等在 640/420px 下的几何与交互 | ⏸ 待做 |
| N5 | 导出包干净可跑 | `export-zip` 产物解压后无 `node_modules`、`yarn install && yarn serve` 能起 | ⏸ 待做 |
| N6 | `echarts` 提直接依赖不波及 fastui（T7） | 改 `package.json` 后 `yarn install --frozen-lockfile` 通过且 `git diff --stat yarn.lock` 零变化；两份 lock 的 sha256 相同 | ⏸ 待做 |
| N7 | python3 弹窗来源（T6） | 用 v20 的 skill 在没装 CLT 的 Mac 上首装 + 出图，全程不再弹窗；仍弹则记下弹窗时 agent 正在执行的命令 | ⏸ 待做 |
| N8 | 样式写法（§4.4） | 重新组装后 golden example 编译通过（Less 与 `mixin.less` 引入可用）、画布宽度撑满（`w-full` 生效 = Tailwind 已配好）；生成一张图表页，样式优先用 Tailwind、写死的值都带「待整改」标注 | ⏸ 待做 |

---

## 9. 明确不做

| 不做 | 理由 |
|---|---|
| 为本 skill 另起 Vite 脚手架（P2） | 管道最值钱的一半是"交付物是开发能直接跑的内网工程"。独立 Vite 工程要第二棵依赖树、第二份环境包托管、重走一遍内网安装链路，而开发拿到还得自己搬进真实项目。当前消费方就是这个领域，P1 寄宿成立 |
| 把设计方法论的维护权接过来 | 我们没有判断力审 `chart-spec` 里某条视觉参数改得对不对。接过来的后果是上游失去维护动力，而我们成了一个没能力审的内容的 owner |
| 定期让两边 AI 互评 | 一次集成/失败/版本更新这类**具体事由**触发才有价值。无事由的定期互审会产出大量低价值 diff，而每轮都要人来裁决 |
