# SPEC-DES-001 — fastui/lake 组件代码生成：预览与交付管道

> 状态：草案（v12，**内网首次全流程跑通**，按实测反转链接位置并补 export-zip） · 优先级 P1 · 规模 [L] · 领域 infra/design
>
> 上游已实现：✗ —— 本 spec 全部为 Design 侧新增；参考实现是 ICT 的 `ict-component-creator` skill（外部，React + 自制 mini bundler），**其管道分层可借鉴、具体实现不可照搬**（理由见 §1.3）
>
> skill 暂定名 **`fastui-vue-creator`**（待产品确认，见 §8.1）

---

> ## 修订记录
>
> **2026-09-06：v12(内网首次全流程跑通 + 反转链接位置 + 放宽运行时限制)**——内网一遍跑通(设备列表页,46 条数据、分页、状态标签),但过程暴露三件事,两件是设计问题。① **链接位置从会话根改回工程根(反转 v6 的 ②),§2.5 记录完整权衡**:实测发现产物目录里 `yarn serve` 跑不起来(`'lerna' 不是内部或外部命令`——yarn 只从工程根的 `node_modules/.bin` 找命令)。v6 换来的"设计师随手压缩安全"是**虚的收益**:设计师恰恰是不懂开发环境、不会去磁盘折腾的那类用户,他拿代码走的是导出按钮。而代价是**实的**且落在最不该承担的人身上——设计师拉产线开发对接时对方第一件事就是 `yarn serve`,跑不起来会被判定成"生成的代码有问题",否定的是整个方案的可信度。压缩体积是小事,交付信任不是。② **`export-zip` 从"延后的便利性"提为"第一版的正确性"**(§5.6):链接改回工程根后整目录压缩会跟随链接,干净交付包只能由它产出;已实现并实测(中文产物名/页面名、UTF-8 flag、CRC、跳过链接、包内无 node_modules)。③ **撤回 v11 加的"禁止用系统 node/yarn"**:那是我为控制调试变量加的限制,不是用户需要的——对设计师来说能跑起来最重要,而真正不可替代的是共享池那 1GB 内网组件库,不是运行时本身;脚本改为共享池优先、回退系统。④ **模型两次绕过 skill**(装环境失败就用本地 node、verify 失败就自己前台跑 yarn serve),后者导致没输出 artifact 卡片——SKILL.md 新增排在最前面的硬约束「不要绕过脚本」,并把第 ⑤ 步输出 artifact 标为"不能省,与编译不通过同级"。⑤ **安装脚本:TLS 1.2 显式启用 + 证书校验默认放行**(内网自签名;完整性判据是 sha256,比证书链更强)+ 失败详情从 HINT 拎出来单独成 `DETAIL:` 行。⑥ 新风险记入 §2.5:产物目录里跑 `yarn add`/`upgrade` 会写穿链接污染共享池,写进 HANDOFF.md 并由 `lockfileHash` 兜底。
>
> **2026-09-06：v11(收口:生产包瘦身 + 版本字段合一 + 失败可定位)**——内网调试前的最后一轮。① **`ASSEMBLE.md` 从 skill 包移除,组装说明收进 §8.3**:skill 是生产包,凡不是设计师使用场景要用到的东西都不进去;`assemble.mjs` 也确定不做——组装就是复制两个目录,本地路径每次不同,脚本换不来更省的事。`PLACEHOLDER.md` 保留(它是 `ensure-env` 的哨兵,组装后删),内容精简成一句话 + 指向本 spec。② **版本字段从三个合并成一个**:`envVersion` / `templateVersion` / `requiredEnvVersion` 在 v9(template 不进共享池)之后承载的是同一件事,而依赖树本身已被 `lockfileHash` 严格约束——只留 `template/package.json` 里的 `octoTemplateVersion`,`env.lock.json` 的 `envVersion` 取自它,`requiredEnvVersion` 作为死字段删除。**格式用语义化版本 `0.1.0`,不用日期**:日期要手工改、容易忘,忘了比没有更误导。③ **§3.4 补 `HANDOFF.md` 全文**(英文静态,给拿到交付包的开发看,含"OCTO_DEPS/OCTO_PORT 你不需要也不用删"这一条)。④ **verify 超时改为自包含诊断**:输出 `STAGE`(卡在等输出/等稳定/等轮次哪一步)+ `ROUNDS_SEEN` + 分阶段 HINT + `LOG_TAIL` 尾部 40 行——超时是最难排查的一种失败,而日志在内网带不出来(§8.4),定位所需的东西必须全部内联。实测:MARKERS 对不上时直接输出"大概率是 MARKERS 与实际输出对不上,把 LOG_TAIL 里表示编译成功/失败的那几行发给开发"。⑤ **修一个实测出的解析 bug**:错误块会把下一轮的 `Compiled successfully` 混进来——`parseRounds` 在 outcome 定下之后仍继续收行(为了接住"结束标志在前、明细在后"的形态),但必须在下一轮 start 处硬停,并限 40 行预算。⑥ 本地 V0 全部通过,含 detached 存活、复用、连改两次的竞态、编译失败原文回传。
>
> **2026-09-04：v10(第一版脚本写完 + 本地 V0 通过 + 一处实测出的真 bug)**——① **§6.2.1 新增「光靠探测不够,new-session 要原子占位」**:V0-a 实测暴露真 bug——`probe()` bind 完立刻 close 不占位,5 个并发 `new-session` 全部拿到 8081;改成只读"已登记端口表"仍有 2 个撞车(并发时大家读到的表都是空的);最终用 `O_EXCL` 原子创建标记文件根治,并修掉陈旧标记回收判据的窗口(占位与写状态文件之间有几十毫秒,后来者会把前一个刚占的位当陈旧回收)。修完 8 进程并发零重复。② **§5.1.1 新增统一输出契约**:`RESULT:`/`HINT:`/`LOG:`/`ERRORS_BEGIN…END` 的形式、退出码三态(用法错误=2 与业务失败分开)、失败原因写成「英文错误码: 中文说明」(内网 GBK 终端下中文可能乱码,ASCII 错误码仍可截图读)、两个状态文件的位置与内容、`OCTO_FASTUI_ENV_DIR` 覆盖开关。③ **§5.3 / §5.5 补全 IO 契约**与两处实现决定(cli-service 入口从 `package.json` 的 `bin` 解析、编译标志集中在 `lib/compile.mjs` 的 `MARKERS` 待内网校准)。④ **§8.2 目录树修偏移**:v4 遗留的那张图里没有 `template/`(那时设想 template 走内网托管,v7 已作废)。⑤ 预览链路**内网实测通过**:`<artifact type="text/link">` → 卡片 → iframe 渲染,零改动,与 §7.5 的查证结论一致;错误 bridge 的 window 级与 promise 级也实测通过。
>
> **2026-09-03：v9(做减法 —— 砍掉预付款,先在内网跑通一次)**——到 v8 为止一版都没在内网跑起来,而 spec 还在为尚未观测到的失败模式加机制。本版全部改动只有一个方向:**这件事不做,端到端还能不能跑通?** 能 → 砍或延后。① **新增 §0.1「第一版范围」**:只做四个脚本(`install`+`setup-env` / `ensure-env` / `new-session` / `verify`)+ 一份 SKILL.md;成功判据是"设计师在干净机器上调一次 skill 看到页面渲染出来",**在此之前 spec 不再新增任何机制**。② **砍掉 `register.mjs`**(§3.3 重写):聚合入口 `views/index.vue` 实际只有五行,模型手里有整个工程的文件访问权,改它是最日常的操作;而为省掉这一步 v8 累积出了脚本 + `AUTO-GENERATED` 标记 + assemble 两条校验 + `_` 前缀跳过 + tab 生成逻辑,全是预付款。三种失败(漏改/语法错/误删引用)分别由"设计师一眼看见"/"verify 编译门禁"/"说一句就恢复"兜住,没有一种值得预建机制。③ **`template` 不进共享池**(§3.1):v7 让安装时复制一份进共享池,理由"skill 换掉时正在跑的会话不受影响"**不成立**(会话工程是复制过去的,复制完就独立);而这一份带来的是真问题——v8 评审指出 `lockfileHash` 检不出"只改模板不改依赖"的升级,共享池 template 会悄悄过期,故障极难定位。**去掉这一跳,问题从根上消失**,不需要 `envVersion` 双判据也不需要新增 `templateHash`。共享池只留"装一次就不动"的 node 与 deps。④ **`export-zip` 延后**:单区布局的直接收益就是产物零链接、随手压缩即安全,这个脚本是便利性不是正确性,而它要写 200 行 ZIP 容器 + 中文文件名跨平台单测。⑤ **`assemble` 延后**(内网第一版手工复制两个目录)、**`--probe` 延后**(装完手工跑一次看得见)。⑥ 采纳评审建议:`export-zip` **删掉 `.bin` 放行例外**(`yarn install` 本来就会重新生成 `.bin`,带不带行为一样,而例外分支是排除规则里最易错的逻辑);**§8.6 补第四件**——模板侧内置的 error bridge 现在是空转的,宿主侧监听等第三层再做,记下来免得那时临时排期。⑦ §3.4 模板改造清单按内网实物更新状态(1/2/3 已完成)。
>
> **2026-09-03：v8(review 三处必改 + 脚手架结构按实物订正)**——v7 交叉评审发现三处不自洽,全部修掉。① **§5.2 整段重写**:旧校验链是 v4 遗留(探针在链里、没有占位检测、没有 lockfileHash、`env.lock.json` 注释还写"打包机产出"),与 v7 的分发架构全面脱节,照它实现会与 §5.2.2 / §8.3 直接打架;新链六步、主判据换成 lockfileHash、探针默认关并改用 golden example 做探针页。② **§5.2.1 新增「lockfileHash 比的是谁和谁」——这是 v7 引入的功能性缺陷**:v7 把 template 改成随 skill 走、`env.lock.json` 改成本机产出后,原来的「记录值 vs 实际值」比法失效了(skill 升级时两者依然一致,检测不出变化,`install --upgrade` 永远不会被触发);正确比法必须跨 skill 与共享池的边界:`sha256(<skillDir>/template/yarn.lock)` vs `sha256(<envDir>/deps/yarn.lock)`,`env.lock.json` 里那个字段降级为诊断记录。③ **撤回 v7 的「dev server 由宿主 spawn」,回到 skill spawn + 宿主按 pid 收**:那是用确定的复杂度(新跨进程协议 + 必须在 Hono/Effect HttpApi 两套后端里选边站的已知坑)去换一个可能的 Windows 风险,方向反了;且自管模式无论如何都要写(内网调试与外网 V0 都不经过宿主),宿主方案省不掉它。Windows detached 改标为**待内网实测的风险**,退路与两套路由框架的选择写在 §6.3 末备查。④ **§3.2 目录结构按内网实物订正**:`app.vue`/`index.vue`/`main.vue` 在 `src/` 下而非 `views/` 下;**§3.3 重写为三层边界表**(脚手架的壳 / 聚合入口 / 模型的可写目录),并补上「为什么是一页一目录而不是一页一文件」——平铺时模型拆出的子组件会被 register 误扫成页面。⑤ **§3.4 新增「模板定版需要做的改造」7 项清单**,含建议这次一并定版的运行时错误 bridge(否则第三层要做时模板版本会分叉)。⑥ **§7.2 新增 golden example 的形态与位置**:实体在 `views/_example/`(真实可编译、register 与 export-zip 都跳过)、同一份内联进 SKILL.md(模型必然看到)、`--probe` 拿它当探针页(不会随组件库升级失效);内容上纠偏——不枚举组件变体,只钉死 `$/` 别名、lake class 约定、`<script setup>` 骨架、根布局四件模型猜不到的事。⑦ **§5.6 排除清单统一成一张表**,消除"不需要排除规则但仍排除"的自相矛盾,并标出 `packages/portal/node_modules/.bin/` 必须放行的例外。⑧ §5.2.3 字段归属表随之更新(不再有"内网打包机")。⑨ 仓库可见性已确认为 private,§4.4.6 写死内网 URL 的取舍成立。
>
> **2026-09-03：v7(分发链路定型 + 内网托管操作手册 + 三处实现级订正)**——脚本实现前的最后一轮收口。① **§4.4 新增「内网托管操作手册」**:精确到下载哪个 node 文件名、sha256 从 `SHASUMS256.txt` 抄、投放目录与访问地址、`manifest.json` 完整示例、首次搭建与每次升级各自的操作顺序。② **`template/` 跟 skill 包走技能库,不单独托管**(§4.4.1 修正 v5 的"新 template 放内网托管"):`template/` 与 `scripts/` 强耦合必须同版本,而技能库有现成的上架/版本机制;`template` 与 `deps` 的耦合由 `lockfileHash` + 本机 `yarn install` 自愈。**nginx 上第一版只剩 node 包 + manifest.json**。③ **§4.1 ④ 改为在 `deps/` 里跑 `yarn install`**,不再"模板里装完再移"——后者会让增量升级退化成每次全量重装 1GB;同时写死 registry 分离(装 yarn 传 `--registry`、装依赖绝不传,否则覆盖掉各 scope 源)。④ **§6.3 末:dev server 改由宿主 spawn 并持有**,`verify` 保留自管模式作为脱离宿主的调试路径——避开 Windows `detached` 语义与 Job Object 的坑,且生命周期归属不再"一个进程两个爹"(§8.6③ 同步改写)。⑤ **§5.5.1 编译判定防竞态**(开始时刻晚于文件 mtime + 完整的开始/结束对 + 800ms 稳定窗口),⑥ **§5.6 ZIP 必须置 UTF-8 flag**(否则中文文件名在 Windows 解压乱码),⑦ **§8.3 assemble 增加校验**:template 必须预置带 `AUTO-GENERATED` 标记的 `views/index.vue`——把"首次 register 面对无标记文件"挡在组装期,避免每个交付包里留一个 `index.vue.pre-octo` 垃圾文件。⑧ **`ensure-env` 只判断不下载**,升级动作收进 `install --upgrade`;设计师全程不接触安装命令,由 agent 依 `HINT:` 自动执行。⑨ **托管落点确定**:内网现有 `/design` 静态目录,投放到 `https://octo.hdesign.huawei.com/design/fastui-env/`,无需改 nginx;manifest 的缓存问题改由客户端侧解决(`no-cache` 头 + 时间戳破缓存)。⑩ **manifest URL 直接写死在 `references/env.manifest.json`**,放弃 `env.source.json` 注入方案(现有代码仓已多处出现内网地址,不值得为此引入一个外网看不到的文件层次)——§4.4.6 记了这次取舍的来由与回退方式。⑪ **skill 落点确认为 `.octo/skills/<skillName>/`**(自定义技能与平台技能一致),脚本一律用 `import.meta.url` 推导 `../template/`,前期自定义验证与后期平台上架不需改代码;§3.1 补充了「skill 的 template → 共享池 template → 会话」这一跳的意义。⑫ §8.6 明确三件 UXAI 侧改动**必须增量式兼容**,任何一项若必须改动既有代码路径,先停下对齐。
>
> **2026-09-03：v6(改单区,取消工作区/交付区分离 —— 核心机制内网整体实测通过)**——v2~v5 的双区(工作区藏 `.octo/` + 干净副本同步到 outputs)是为了绕开"产物目录里有链接、设计师手工压缩会带出 1GB"。**本次验证证明不需要绕**:把链接建在**会话根**(`.octo/<sid>/node_modules`,即 outputs 的父级)+ **直连 cli-service 启动**(绕过 yarn 的 `.bin` PATH 与 shim 写死层级这两道坎)+ `turboui.config.js` 三处环境变量注入(全部带 `||` 回退),webpack 成功跨两层向上解析(`209/227 modules`),`OCTO_PORT`/`OCTO_DEPS` 均生效。于是**产物目录本身零链接**,压缩安全、文件管理扫盘安全、模型写的就是交付物,**同步步骤取消**。§1.6 由"已否决"改写为"第一次试失败的真正原因是启动路径而非解析能力"——保留是因为那次误判差点否掉整条正确路线。`sync-output` 改为 `export-zip`(按需打包,非同步);新增 **§8.6 UXAI 仓要做的三件事**(导出按钮 / external URL tab 的编辑类功能 gate / dev server 生命周期),明确这三件 skill 做不了、必须在 `pages/make/` 侧做。
>
> **2026-09-03：v5(升级机制改增量 + 外网仓占位结构 + Q1 收口)**——① **§5.2.2 修正 v4 说过头的"环境不可变"**:要禁的是**改 lock 的操作**(`yarn upgrade`/`add`),不是 `yarn install`——后者按 lockfile 复现,各机结果一致且有 `lockfileHash` 兜底,这正是 lockfile 的意义。因此升级走**增量**:内网打包机产出新 template(几百 KB) + 新 `env.lock.json` → 内网托管 → 外网仓只改 `requiredEnvVersion` 走 GitHub → 设计师端拉新 template + 共享池 `yarn install` 增量装差异 → 校验 hash。**不需要重下几百 MB**,§4.2 的整包分发降级为首次安装的可选优化。② **§5.2.3 新增字段承载关系表**,明确组件库版本不单独立字段(已被 `envVersion` 涵盖、精确值在 `keyPackages`、由 `lockfileHash` 严格约束)。③ **§8.3 新增外网仓结构**:`template/` 与 `vendor/` 是内网资产、外网仓留 `PLACEHOLDER.md` 占位,内网 `assemble.mjs` 组装;`ensure-env` 必须能检出"占位未填充"并响亮失败。④ **Q1 收口**:不预先约谈 Design,实现时按实际情况处理,原则是**不影响既有业务逻辑**(只加 gate 不改 srcdoc 路径行为)。
>
> **2026-09-02：v4(预览链路查实为零改动 + 版本模型定型)**——① **§7.5 重写**:追完 `text/link` 链路发现**不需要新增 renderer**——skill 输出 `<artifact type="text/link">http://127.0.0.1:<port></artifact>`,现有 `insight-turn.tsx:156` → `index.tsx:3771` → `html-renderer.tsx:853 shouldUseExternalUrl()` → `:1405 <iframe src>` 一路直达,代码注释原文即「复用 preview URL 工作流」;`refreshKey` 拼 `?_octo_v=N` 顺带解决重编译刷新。待确认收敛为两点(external 下编辑类功能是否已 gate / dev server 生命周期归谁)。② **§5.2 版本模型定型**:分清期望值/实际值/上游值三个"版本";`lockfileHash` 作权威判据(yarn.lock 唯一决定依赖树),`keyPackages` 降为诊断展示;`scaffoldVersion` 语义含糊改名 `templateVersion`;确立**环境不可变原则**——绝不在设计师机器上 `yarn install`/`upgrade`,升级只重打环境包(否则各机漂移、故障无法复现);`ensure-env` 只判断不修复且方向不对称(低于要求阻塞、高于要求放行)。
>
> **2026-09-02：v3(落点/端口/预览三处按实测与查证订正)**——① **Q3 已验证**:环境变量可穿透 `yarn`→`lerna`→`turbo-ui-cli-service`,模板 `turboui.config.js` 已改为读 `OCTO_PORT`;② **落点不是新约定**:查 `pages/make/index.tsx:2515`,Design 传给 skill 的 `[Artifact Folder]` 就是 `.octo/<sessionId>/outputs`,沿用即可,工作区取平级 `fastui-project/`(§3.2 重写,v2 里写的 `<工作目录>/outputs/` 有误);③ **预览容器机制查清**:renderer 分发是 `result-viewer/index.tsx` 里按 `tab.type` 的硬编码 Switch(`subtype-registry` 只管 html 内部 subtype),新增形态必须改 Design 代码但改动很小;纯预览下 srcdoc 与 `127.0.0.1:<port>` **完全等价**,差异只在同源性(§7.5);④ 版本号明确分 `skillVersion` / `envVersion` 两条,合并会导致每改一次提示词就触发几百 MB 重下(§5.2)。
>
> **2026-09-02：v2（工作区与交付区分离，取代 v1 的「outputs 里放带链接的工程 + 导出脚本」）**——v1 把会话工程直接放 `outputs/`，`node_modules` 是目录链接，靠 `export-session` 脚本产出干净 zip。问题：**设计师直接右键压缩会跟随链接把 1GB 依赖打进去**，而"记得先点导出"这件事防不住。v2 改为**双区**：带链接的工作区藏进 `.octo/`（设计师不翻），`outputs/` 里放编译通过后同步过去的**干净副本**（任何层级都无 `node_modules`）——设计师在文件管理里看到的、随手压缩的，天生就是安全的那份。不再依赖任何"记得触发脚本"的行为。
> 同时**否决 v1 §3.4 留的备选**（把链接建在 `outputs/` 层让会话目录零链接）：内网实测 `node_modules` 上提一级即无法启动，两道坎——① `yarn` 执行 script 时把 `./node_modules/.bin` 拼进 PATH，项目根无 `node_modules` 则找不到 `lerna`；② `.bin` 里 shim 写死 `$basedir/../../../../node_modules/…`，层级一变即指错。与 Node 的逐级向上解析无关，那两步在解析之前就失败了。

---

## 0.0 当前进度与待办（改动后随手更新这一节）

> **翻这份 spec 先看这里。** 下面每一项都直接链到对应章节，不用全文找。

### 已跑通（内网实测）

| | 状态 |
|---|---|
| 环境安装（共享池 node + deps） | ✅ Windows / macOS arm64 各一遍（[§4.1](#41-v1-路线分发-portable-node--模板本机安装依赖)、[§4.4](#44-内网托管要准备什么怎么放离线操作手册)） |
| 会话工程创建（链接 + 复制模板 + 端口） | ✅ [§3.2](#32-会话布局沿用-design-现有约定)、[§5.3](#53-new-sessionmjs--创建会话工程) |
| 编译门禁（起 dev server + 判定 + 错误回传） | ✅ [§5.5](#55-verifymjs--编译门禁) |
| 预览卡片（`text/link` → iframe） | ✅ 零改动，[§7.5](#75-预览容器现有-textlink-链路已支持预计零改动) |
| 导出代码包（`export-zip`） | ✅ 中文名 / UTF-8 flag / 跳链接，[§5.6](#56-export-zipmjs--打交付包v12提为第一版正确性需求) |
| dev server 宿主化 | ✅ UXAI PR #801 已合，[§8.6.1](#861-dev-server-由宿主起并持有-的完整方案) |
| 运行时错误 bridge（模板侧） | ✅ 已内置并实测，宿主侧待接，[§8.6.4](#864-运行时错误-bridge-的监听端-的协议) |

### 待办

**UXAI 侧五件**（[§8.6](#86-uxai-仓要做的五件事design-模块不是-skill)，Design 模块，走 PR 协议）

| # | 事项 | 优先级 | 落点 |
|---|---|---|---|
| ① | 导出代码包按钮 | **高** —— 设计师拿代码的主路径 | [§8.6.2](#862-导出代码包按钮-的落点与契约) |
| ⑤ | 预览就绪前不要挂 iframe | **高** —— 重启后必现白屏 | [§8.6.5](#865-重启后预览白屏iframe-早于-dev-server-就绪-新增) |
| ② | external URL tab 的编辑功能 gate | 低 —— 先查现状，可能不用改 | [§8.6.3](#863-external-url-tab-的编辑功能-gate-的判据) |
| ④ | bridge 监听端 | 低 —— 等第三层 | [§8.6.4](#864-运行时错误-bridge-的监听端-的协议) |
| ③ | ~~dev server 宿主化~~ | ✅ 已完成 | — |

> **①⑤ 落在同一层**（subtype handler / html-renderer 的 external 分支），建议一起做。

**验证覆盖缺口**（[§9.2](#92-内网验证)）

| 缺口 | 为什么要补 |
|---|---|
| **完全没装过 node 的机器** | 前几次实测机上都有系统 node，portable node 的**下载路径从没被真正走过** —— 而它上面挂着最多没验过的代码（下载 / sha256 / 解压 strip / `npm i -g yarn`），且首装正是设计师会遇到的路径 |
| **Intel Mac（`darwin-x64`）** | manifest 里有这个平台的包，没人验过 |

**跟外部团队的开口**

| # | 事项 | 状态 |
|---|---|---|
| Q4 | fastui 发版后谁触发重打、怎么通知设计师升级 | 机制已定（[§5.2.2](#522-升级机制lockfile-驱动的增量升级)），**流程待与 fastui 团队约定**，不阻塞 |

### 明确不做

二次编辑回环（选中元素 → 属性面板 → 改 `.vue` → 重编译）、`vendor/` 里三份组件 skill 的内容与组织 —— 见[文末「明确不在本 spec 范围」](#明确不在本-spec-范围)。

---

## 0. 这份 spec 解决什么

设计师在 Design 里描述需求 → 模型生成 `.vue` → **在真实脚手架里编译渲染**（不是模拟、不是近似）→ 设计师看到效果 → 交付一个开发能直接 `yarn install && yarn dev` 跑起来的工程。

三个硬约束决定了所有设计：

1. **设计师机器上不能有任何前端开发环境**，整个环境准备必须能自助完成、不依赖人工兜底
2. **fastui/lake 组件库和内网的微组件框架深度耦合**，组件无法脱离脚手架独立运行（实测：`yarn build` 产物 89MB，单独打开卡在微前端 loading 页）
3. **交付物必须是开发认得的东西** —— `.vue` 源码 + 标准工程结构，不是某种中间产物

结论是：**不做任何形式的"轻量模拟预览"，直接用他们的脚手架跑真实构建**。全部工程量花在「怎么让这套重环境在设计师机器上可控地跑起来」上。

---

## 0.1 第一版范围：先在内网跑通一次，再谈完善

> **v9 加这一节，是因为到 v8 为止一版都没在内网跑起来，而 spec 还在为尚未观测到的失败模式加机制。**
> 判断标准换成一条：**这件事不做，端到端还能不能跑通？** 不能 → 第一版；能 → 延后。

**第一版要做的（四个脚本 + 一份 SKILL.md）**

| # | 交付物 | 为什么是必需 |
|---|---|---|
| 1 | `install.ps1` / `install.sh` + `setup-env.mjs` | 没有环境什么都跑不了（§4.1、§4.4） |
| 2 | `ensure-env.mjs` | 环境没装好时给出确定的下一步，否则失败形态千奇百怪（§5.2） |
| 3 | `new-session.mjs` | 建链接、复制模板、分端口 —— 会话工程的地基（§5.3） |
| 4 | `verify.mjs` | **整套东西可靠性的分水岭**，没有它模型会一直说"我改好了"（§7.3） |
| 5 | `export-zip.mjs` | v12 提入：链接改到工程根后，干净交付包只能由它产出（§2.5 / §5.6） |
| 6 | `SKILL.md` | 没有它 agent 不知道何时调什么、失败怎么办（§8.5） |

**第一版不做的**

| 延后项 | 理由 |
|---|---|
| `register.mjs` | **砍掉**，聚合入口交回模型（§3.3） |
| ~~`export-zip.mjs`~~ | **v12 提回第一版** —— 链接改到工程根后，干净交付包只能由它产出（§5.6） |
| `assemble.mjs` | **不做**。组装就是复制两个目录，本地路径每次不同，脚本换不来更省的事；步骤写在 §8.3 |
| `--probe` 真实探针 | 装完手工跑一次 dev server 看得见，不必先脚本化（§5.2） |
| 运行时错误 bridge 的**宿主侧监听** | 模板侧先埋上（§3.4-5），宿主侧等第三层再做（§8.6④） |
| §4.2 的 1GB deps 整包 | v1 路线是本机 `yarn install`，规模化失败了再说 |

**放进第一版的实现细节**（不是新机制，是写代码时必须做对的事）：编译判定的防竞态（§5.5.1）、`detached` spawn 后 dev server 存活（§6.3）、端口冲突重试（§6.2③）。

**成功判据**：设计师在一台干净机器上调一次 skill，说要做一个页面，看到它渲染出来。**在此之前，spec 不再新增任何机制。**


---

## 1. 背景与已否决的方案

> 本节记录被推翻的中间结论。这些方案在讨论中都曾被认真考虑，写下来是为了避免下一轮重新推演。

### 1.1 ✗ 浏览器内 SFC 编译（`vue3-sfc-loader` / `@vue/repl`）

**曾是首选**：Vue 有官方的浏览器内编译器（`@vue/compiler-sfc`，`vue-loader` 和 `@vitejs/plugin-vue` 底层用的就是它），预览的编译语义天然等同真实工程，且预览的输入就是交付物本身，零源码改写。

**否决原因**：该方案的隐含前提是「运行环境很薄」——Vue 运行时 + 一个自包含的组件库 dist 就够了。实测推翻了这个前提：lake 组件耦合微组件框架（`$loader` + `components.json` 注册表 + `turbo-ui-runtime`），构建产物都无法独立运行。环境很厚，浏览器里凑不齐，编译出来的东西找不到它要的世界。

**保留价值**：将来 fastui 团队若愿意产出一个「预览壳」bundle（把 Vue + 微组件框架 + 组件库打成一个产物，暴露 `mount(sfcSource, el)`），这条路可以复活，体积能从数百 MB 降到数 MB。**但这需要他们新增工作量，需要本 spec 落地后的成果作为说服材料。**

### 1.2 ✗ Babel 转译（照搬 ICT skill 的做法）

ICT skill 用 `babel.min.js` 是因为 **JSX 需要转译**。Vue 面对的不是 JSX 问题而是 SFC 编译问题 —— `<script setup>`、scoped style、CSS 里的 `v-bind()`，Babel 一个都处理不了。这条路在 Vue 场景不成立。

### 1.3 ✗ 复刻 ICT 的 mini bundler

ICT 的 `build.mjs` 用正则剥 import、拼 IIFE，305 行。它之所以要自己写，是因为 React 生态没有官方的浏览器内编译器。Vue 有，所以自己写没有收益；而且 SFC 的复杂度（script setup 编译产物、scope id、模板里的组件解析）远高于 JSX，复刻成本更高、正确性更差。

**ICT skill 真正值得借鉴的是它的管道分层**（见 §7），不是它的编译实现。

### 1.4 ✗ 全局安装依赖（`npm i -g` + 项目共享）

起因是想避免 1GB 依赖在每个会话目录重复。但这是对 Node 模块解析的误解：

- `npm i -g` 做的是「装到全局目录 + 把可执行文件挂到 PATH」——所以 CLI 工具全局装完到处能敲
- `import` / `require` 走的是**另一套机制**：从当前文件逐级向上找 `node_modules`，**全局目录根本不在这条查找链上**

唯一的口子是 `NODE_PATH`，但它只对 CommonJS 有效、ESM 不看、构建工具的解析器也不认。这条路不通。

### 1.5 ✗ 改 webpack `resolve.modules` 指向共享依赖

技术上可行（`turboui.config.js` 里 push 共享路径即可），且能让会话目录完全不含 `node_modules`。**否决原因是失败模式太恶劣**：

| 方案 | 若交付包被错误地发出去 |
|---|---|
| 目录链接（§2） | 包变成 1GB —— 难看、传得慢，**但开发解压就能跑** |
| 改 `resolve.modules` | 包很小，**但开发那边跑不起来**（配置指向一台别人机器上的路径） |

后者是**静默失败 + 延迟到开发手上才暴露 + 误导对方以为是代码问题**。而且被改过的 `turboui.config.js` 是代码层面的污染，一旦提交进仓库会扩散；目录链接只活在文件系统里，不进代码。

（v6 的依赖外置布局让"产物目录里根本没有链接"，这个前提也随之消失，见 §2 / §3.2。）

### 1.6 ⚠️ 「依赖外置 + 逐级向上解析」——第一次试失败，第二次绕过两道坎后**成立**（即最终方案）

**第一次试（失败）**：把 `node_modules` 从仓库根剪到上一级，`yarn serve` 起不来。当时判定"原理不通"并否决。

**复盘后发现失败的不是解析，是启动路径**，两道坎都在模块解析**之前**：

1. `yarn` 执行 script 时把 `./node_modules/.bin` 拼进 PATH —— 项目根无 `node_modules` 就找不到 `lerna`
2. `packages/portal/node_modules/.bin` 里的 shim 写死 `$basedir/../../../../node_modules/@turboui/…` —— 层级一变即指错

**第二次试（成立）**：绕过 `yarn` + `lerna`，直连 cli-service 入口，两道坎同时消失。实测 webpack 成功跨两层向上找到依赖。

这就是 §2 的最终方案。保留本条是因为"第一次失败"曾让整条路线被误判为不可行，而真正的判据是**启动路径**，不是解析能力。

---

## 2. 架构：共享依赖池 + 依赖外置

> **命名**：不是有标准名字的业界模式，是个组合手法，本 spec 定义如下。同类思路的工业级版本是 pnpm 的 content-addressable store + 硬链接。

三个要素缺一不可，**已内网整体实测通过（2026-09-03）**：

| # | 要素 | 作用 |
|---|---|---|
| ① | **依赖只装一份**，放共享池；会话根用目录链接指过去 | 1GB 每台机器只占一次 |
| ② | **链接建在工程根**（`outputs/<产物名>/node_modules`，即标准布局）<br>~~v6–v11：建在会话根~~ | 产物是标准工程，`yarn install && yarn serve` 直接可用（v12 反转，理由见 §2.5） |
| ③ | **直连 cli-service 启动**，绕过 `yarn` + `lerna` | 消除 §1.6 那两道坎；附带输出干净、启动更快 |

链接机制：Windows 目录联接 junction（`mklink /J`，**普通用户可建，不需要管理员权限**）；macOS symlink（POSIX 标准，同样无需权限）。

### 2.1 依赖解析怎么走通的

```
outputs/<产物名>/packages/portal   ← webpack context
  ↑ packages
  ↑ <产物名>/node_modules           ← 命中(链接),v12 起在这一层
```

Node / webpack 的 enhanced-resolve 逐级向上找 `node_modules`。v6–v11 把链接放在再往上两层的会话根，实测也能解析（`35% building 209/227 modules`）—— 但 v12 改回工程根之后，这就是**标准布局**，连"能不能跨层解析"都不再是问题，`yarn` / `lerna` 也一并恢复可用（§1.6 那两道坎随之消失）。

### 2.2 三处环境变量注入（全部带回退）

模板里三处改动，**语义一致：有环境变量走共享池，没有就回退到标准路径**。开发拿到交付包没有这些变量，行为与原脚手架完全一致，**无需改回**。

| 变量 | 位置 | 写法 |
|---|---|---|
| `OCTO_PORT` | `turboui.config.js` `devServer.port` | `Number(process.env.OCTO_PORT) \|\| 8081` |
| `OCTO_DEPS` | `turboui.config.js` `configureWebpack` 顶部 | `const DEPS = process.env.OCTO_DEPS \|\| path.resolve(__dirname, '../../node_modules')`<br>`const dep = (p) => path.resolve(DEPS, p)` |
| — | 同上，所有 `path.resolve(__dirname, '../../node_modules/XXX')` | 换成 `dep('XXX')`（copy-webpack-plugin 的拷贝源，实测不改则 `Failed to compile`） |

### 2.3 `packages/portal/node_modules` 当模板代码处理

实测该目录只有 `.bin/turbo-ui-cli-service`（+`.cmd`），合计 **735 字节**（yarn workspaces 把其余全 hoist 到了根）。直接放进模板，不为它建链接。

> 直连启动后其实连这个 `.bin` 都不走了，但保留它能让开发拿到包后 `yarn install` 的结构完整、`yarn serve` 照常可用。

### 2.4 启动命令

```
<共享池>/node/node  <共享池>/deps/node_modules/@turboui/turbo-ui-cli-service/bin/turbo-ui-cli-service.js \
  serve --replace-policy=dev --target=esnext
# cwd = <产物目录>/packages/portal
# env: OCTO_DEPS=<共享池>/deps/node_modules  OCTO_PORT=<分配的端口>
```

**交付不受影响**：产物里 `package.json` 的 `scripts` 原样保留，开发那边照旧 `yarn install && yarn serve`。直连只是我们预览时的启动方式。

---


### 2.5 链接位置为什么从会话根改回工程根（v12 反转 v6 的 ②）

v6 把链接放在会话根（`outputs/` 的父级），换来"产物目录里零链接 → 设计师随手压缩安全"。
内网首次实测（2026-09-06）暴露了它的真实代价：**产物目录里 `yarn serve` 跑不起来**
（`'lerna' 不是内部或外部命令` —— yarn 只从工程根的 `node_modules/.bin` 找命令，父级有也没用）。

重新权衡两边：

| | 收益 | 代价 |
|---|---|---|
| 链接在会话根（v6–v11） | 设计师随手压缩不会带出 1GB | 产物目录不是标准工程，`yarn serve` 失败 |
| 链接在工程根（v12） | 标准工程，`yarn install && yarn serve` 直接可用 | 整目录压缩会跟随链接 → 必须由 `export-zip` 产出交付包 |

**v6 那个收益是虚的**：它假设"设计师会去文件管理里随手压缩产物目录"，而设计师恰恰是**不懂开发环境、
不会去磁盘折腾**的那类用户 —— 他拿代码的路径是点导出按钮或说一句"帮我导出代码"，不是右键压缩。

**而代价是实的**，且落在最不该承担它的人身上：

1. **交付信任**：设计师拉产线开发对接时，对方第一件事就是 `yarn serve`。跑不起来会被直接判定成
   "生成的代码有问题" —— 这是最坏的失败模式，因为它**否定的是整个方案的可信度**，而不只是一个环境细节
2. **排查受限**：连我们自己去帮设计师定位问题，都不能在产物目录里跑起来

**压缩体积是小事，交付信任不是。** 于是 v12 改回标准布局，干净交付包改由 `export-zip` 产出（§5.6，
从"延后的便利性"提为"第一版的正确性"），并在 UXAI 侧配一个导出按钮（§8.6①）。

即使有人真的右键压缩了整个目录，失败模式也只是 §1.5 表格里那条：**包变成 1GB —— 难看、传得慢，
但开发解压就能跑**。这比"包很小但跑不起来"好得多。

> **新引入的风险**：产物目录里的 `node_modules` 是链接，有人在里面跑 `yarn add` / `yarn upgrade`
> 会写进**共享池**，污染所有会话。`yarn install`（按 lockfile 复现）无害。这条写进 `HANDOFF.md`，
> 并由 §5.2.1 的 `lockfileHash` 校验兜底 —— 真被改了，下次 `ensure-env` 会报 `ENV_OUTDATED`。

---

## 3. 目录布局：单区

### 3.1 共享池（每台机器一份，装一次）

```
Windows:  %LOCALAPPDATA%\OctoAgent\fastui-env\
macOS:    ~/Library/Application Support/OctoAgent/fastui-env/

fastui-env/
├─ node/                        ← portable node（解压即用，不写注册表 / 不改 PATH / 不需要管理员权限）
├─ deps/node_modules/           ← 共享依赖池（~1GB）
└─ env.lock.json                ← 版本清单，见 §5.2

（v9：template 不再进共享池，会话直接从 `<skillDir>/template/` 复制 —— 见下）
```

> ⚠️ **Windows 必须用 `%LOCALAPPDATA%`，不能用 `%APPDATA%`** —— 后者是 Roaming，域环境下会被漫游配置文件同步，1GB 会让设计师登录时卡死或同步失败。

**共享池与 skill 目录是两回事**：skill（自定义技能与平台技能位置一致）落在 `.octo/skills/<skillName>/`，`template/` 就在其中（§4.4.1）；共享池是上面这个平台目录，**只放 node 与 deps**。

> **v9 简化：template 不复制进共享池，会话直接从 `<skillDir>/template/` 复制。**
> v7 曾让安装时把 template 复制进共享池一份，理由是"skill 被换掉时正在跑的会话不受影响" —— **这个理由不成立**：会话工程是复制过去的，复制完就独立了，skill 后来怎么变都不影响已存在的会话目录。
> 而多这一份的代价是真实的：共享池的 template 会与 skill 的 template 不同步。`lockfileHash` 只能检出依赖树变化，**改 `turboui.config.js`、改 golden example、改 `HANDOFF.md` 这类不动 `yarn.lock` 的升级，它一概检不出来** —— 于是 skill 升级了、提示词也更新了，新会话用的还是旧模板，而这种"skill 说的和模板做的对不上"的故障极难定位。
> 去掉这一跳，问题从根上消失，不需要再引入 `templateHash` 或 `envVersion` 双判据。**共享池只保留"装一次就不动"的东西（node 与 deps），随 skill 走的东西就只在 skill 里有一份。**

### 3.2 会话布局（沿用 Design 现有约定）

查证（UXAI `pages/make/index.tsx:2511-2518`）：Design 传给 skill 的 `[Artifact Folder]` 就是 `<projectDir>/.octo/<sessionId>/outputs`。**沿用，不另起一套。**

```
<projectDir>/.octo/<sessionId>/
└─ outputs/                              ← skill 收到的 [Artifact Folder]
    └─ <产物名>/                          ← 工程本体,模型直接写这里
        ├─ node_modules  ⇢ 链接到 fastui-env/deps/node_modules   ← v12:标准位置
        ├─ package.json  yarn.lock  .npmrc  .yarnrc  lerna.json …
        ├─ HANDOFF.md                    ← 模板里的静态文件,说明如何运行
        └─ packages/portal/
            ├─ node_modules/.bin/        ← 实体,735 B
            ├─ turboui.config.js         ← 三处环境变量注入,见 §2.2
            └─ src/
                ├─ app.vue  index.vue  main.vue   ← 脚手架的壳,一次定版后不动(§3.3)
                ├─ i18n/  interfaces/  utils/     ← 脚手架自带,模型不碰
                └─ views/
                    ├─ index.vue          ← 聚合入口,模型改这一个既有文件(§3.3)
                    ├─ _example/index.vue ← golden example(§7.2)
                    └─ <页面名>/index.vue ← ★ 模型新建页面写这里 ★
```

**产物就是标准工程** —— `yarn install && yarn serve` 在里面直接可用，模型写的就是交付物本身，不需要同步步骤。
唯一的链接是工程根的 `node_modules`（指向共享池，省掉每个会话重装 1GB），**干净交付包由 `export-zip` 产出**（§5.6）。
理由与权衡见 §2.5。

工作路径由 `[Artifact Folder]` 直接得到，链接位置由它推导上一级。

### 3.3 三层边界：脚手架的壳 / 聚合入口 / 模型的可写目录

模板定版后，`packages/portal/src/` 下的东西分成三类，**边界必须清楚，否则模型会去改不该改的文件**：

| 层 | 文件 | 谁写 |
|---|---|---|
| **脚手架的壳** | `app.vue`、`index.vue`、`main.vue`、`i18n/`、`interfaces/`、`utils/` | **谁都不写**。fastui 脚手架定的，一次定版后不动。`main.vue` 里那句 `import Index from './views/index.vue'` 是壳与聚合入口的唯一接点 |
| **聚合入口** | `views/index.vue` | **模型改这一个文件**：新增页面时加一行 import、加一个标签 |
| **可写目录** | `views/<页面名>/` | **模型新建，随便写**。一个页面一个目录，页面主文件固定叫 `index.vue`，子组件/样式/局部资源放同目录 |

#### v9：聚合入口交回给模型，`register.mjs` 砍掉

v3~v8 设计了一个 `register.mjs`：扫描 `views/` 子目录、自动生成 `views/index.vue`，理由是"让模型改既有文件的错误率高于让它新建文件"。

**这个理由撑不起它的成本。** 实际的 `views/index.vue` 长这样：

```vue
<script lang="ts" setup>
import Example from './_example/index.vue'
</script>

<template>
  <Example />
</template>

<style></style>
```

模型手里有整个工程的文件系统访问权，改这样一个五行文件是它最日常的操作。而为了省掉这一步，v8 累积出来的是：一个要写要测的脚本、`AUTO-GENERATED` 标记约定、assemble 的两条校验、`_` 前缀跳过规则、多产物的纯 CSS tab 生成逻辑 —— **全部是为一个尚未观测到的失败模式付的预付款**。

**决定：砍掉 `register.mjs`，模型直接改 `views/index.vue`。** 约束写进 SKILL.md 就够：

> 只改 `views/index.vue`，只新建 `views/<页面名>/` 下的文件；`src/` 下其余文件（`app.vue` / `index.vue` / `main.vue` / `i18n/` / `interfaces/` / `utils/`）一律不动。

多产物要不要 tab 切换、纵向堆叠还是别的，**也交给模型按设计师的实际要求决定** —— 工程侧不预设（这一点与 v6 的结论一致，只是实现者从脚本换成了模型）。

失败会怎样、能不能承受：模型漏改 `index.vue` → 页面不显示，设计师一眼看见；改错语法 → `verify` 的编译门禁直接拦下（§7.3）；误删了上一个页面的引用 → 说一句就能恢复，页面文件本身还在。**三种都是可见且可恢复的，没有一种值得预先建一套机制去防。**

> `HANDOFF.md` 是**模板里写死的静态文件，不由模型生成** —— 模型生成的说明会漂。用英文名，避免内网 Windows 下的编码问题（内网终端已出现过中文注释乱码）。

### 3.4 模板定版需要做的改造

在 fastui 原脚手架基础上，模板要落这几处（一次性，定版后不动）：

| # | 改动 | 状态 |
|---|---|---|
| 1 | `turboui.config.js` 三处环境变量注入（`OCTO_PORT` / `OCTO_DEPS` / `dep()` 包裹 copy-webpack-plugin 的拷贝源，§2.2） | ✅ **已完成** |
| 2 | `main.vue` 的引用改为 `import Index from './views/index.vue'` | ✅ **已完成** |
| 3 | `views/index.vue` 作为聚合入口，初始内容引用 `_example` | ✅ **已完成**（初始就显示示例页，正好当环境自检的可视反馈） |
| 4 | `views/_example/index.vue` —— golden example（§7.2） | 内容待按 §7.2 纠偏 |
| 5 | 内置运行时错误 bridge（`window.onerror` + `app.config.errorHandler` → `postMessage`） | **建议这次一并定版**：落在 `main.vue` 里十几行，等第三层要做时再改模板，已有会话的模板版本就分叉了 |
| 6 | `HANDOFF.md`（英文，静态） | 内容见下，直接用 |
| 8 | `package.json` **顶层**加 `"octoTemplateVersion": "0.1.0"` | 见下 |

**`octoTemplateVersion` 放 `package.json` 的顶层，不是 `dependencies`**：

```json
{
  "name": "example-portal",
  "private": true,
  "octoTemplateVersion": "0.1.0",   ← 这一层
  "workspaces": ["packages/*"],
  "dependencies": { … }             ← 不是这里
}
```

放进 `dependencies` 会被 yarn 当成包名去装，必然报"找不到包"。放顶层是安全的：npm / yarn 只认自己定义的那些字段，**其余顶层字段一律忽略**（`lerna` 的 `useWorkspaces`、各种工具的自定义配置都是这么挂的）。

`setup-env` 写 `env.lock.json` 时读它。**用语义化版本，不用日期** —— 日期要手工改、容易忘，忘了反而误导（明明改了模板，版本还停在上个月）。每次改模板手工 +1。
| 7 | 确认 `tsconfig.json` / webpack alias 里 `$` 别名配置完整 | golden example 依赖它；截图里 `tsconfig.json` 挂着 1 个问题标记，定版前确认下不是别名相关 |

#### `HANDOFF.md` 的内容（模板里的静态文件，直接用这份）

它是**给拿到交付包的开发看的**，回答三个问题：这是什么、怎么跑起来、哪些地方是生成的。
放在工程根目录，用英文（内网 Windows 终端出现过中文乱码），**不由模型生成** —— 模型写的说明会漂。

````markdown
# Handoff

A standard Vue 3 project generated from the internal fastui/lake scaffold.
The pages under `packages/portal/src/views/` were generated from a designer's
description; everything else is the untouched scaffold.

## Run it

```bash
yarn install
yarn serve
```

That's all. No extra setup, no environment variables required.

## What was generated

| Path | |
|---|---|
| `packages/portal/src/views/<page>/` | Generated pages — one directory per page |
| `packages/portal/src/views/index.vue` | Entry that mounts the generated pages |
| everything else | Untouched scaffold |

`views/_example/` is a reference snippet showing how lake components are
imported (`$/...`). Safe to delete.

## If you are looking at the generated workspace (not the exported zip)

`node_modules` there is a **symlink into a shared dependency pool**, so that every
generated project does not have to install 1 GB of its own. Two consequences:

- `yarn install` / `yarn serve` work normally — go ahead
- **Do not run `yarn add` or `yarn upgrade` there.** Those write through the link
  into the shared pool and affect every other generated project on the machine.
  Need a new dependency? Export the zip first, then add it there.

The exported zip has no symlink and no `node_modules` at all — it is a plain project.

## About OCTO_DEPS / OCTO_PORT

`turboui.config.js` reads two optional environment variables:

- `OCTO_DEPS` — alternate `node_modules` location
- `OCTO_PORT` — dev server port

Both fall back to the scaffold defaults when unset, which is the case here.
They are used by the preview tooling that generated this project; **you do not
need them and should not set them**. No need to remove the code either — with
the variables unset the behaviour is identical to the original scaffold.
````


---

## 4. 环境分发

### 4.1 v1 路线：分发 portable node + 模板，本机安装依赖

这是**正式路线，必须能自助跑通**，不依赖人工上门。**设计师全程不接触任何安装命令** —— 他只调 skill 说要做什么页面，`ensure-env` 检出环境缺失/过期时由 agent 自动执行安装脚本。

```
① 按平台下载 portable node → 解压到共享池 <envDir>/node/
② (v9 删除:template 不进共享池,会话直接从 <skillDir>/template/ 复制)
③ 用 portable node 的 npm 装 yarn(指定 --registry)
④ 复制 template 的"依赖清单"到 <envDir>/deps/ → cwd=deps 跑 yarn install  ← 不传 registry
⑤ 写 env.lock.json → ensure-env 探针校验
```

关键点：

- **`npm i -g yarn` 在 portable node 下不需要 sudo** —— global prefix 落在 node 自己的目录里，不碰 `/usr/local`。这是必须用 portable node 而非系统 node 的核心原因之一：**Agent 内执行 `sudo` 会静默挂住等密码，没有交互通道**
- 已验证：Windows 与 macOS 各走通一遍（node 离线装、yarn 指定 registry 可装、项目内 `yarn` 装依赖无阻碍）
- **② 的 `template/` 来源路径不要硬编码**：skill（自定义技能与平台技能一致）落在 `.octo/skills/<skillName>/`，脚本一律用 `import.meta.url` 推导同级的 `../template/`。这样前期以自定义技能验证、后期上架平台技能，脚本不用改一个字

#### ④ 为什么在 `deps/` 里装，而不是"在模板里装完再移过去"

v6 及以前写的是"用 yarn 在模板里装依赖 → 移入共享池"。**这一步会让 §5.2.2 的增量升级失效**：装完 `node_modules` 被移走，`template/` 里空了，下次升级再跑 `yarn install` 就是全量重装 1GB。

改为把 template 的**依赖清单**（不含源码）复制到 `deps/`，让 `node_modules` 直接生成在最终位置：

```
<envDir>/deps/
├─ package.json  yarn.lock  .npmrc  .yarnrc      ← 从 template 根复制
├─ packages/<每个 workspace 成员>/package.json    ← 只复制 package.json,不复制源码
└─ node_modules/                                  ← yarn install 直接产出在这里(~1GB)
```

> workspace 成员目录必须存在且带 `package.json`，否则 yarn 的 hoist 结果与真实工程不同 —— 那会让 `lockfileHash` 校验通过、实际依赖树却不对。

升级时只覆盖这几个清单文件再跑一次 `yarn install`，yarn 天然增量、只装差异包。

#### ③④ 的 registry 必须分开处理（极易踩）

| 步骤 | 命令 | registry |
|---|---|---|
| ③ 装 yarn | `<node>/npm install -g yarn --registry=<npmRegistry>` | **显式传**，此时还没有任何项目级配置可依赖 |
| ④ 装依赖 | `cd <envDir>/deps && <node>/yarn install` | **绝不传** —— 让它读 `deps/` 下从 template 复制来的 `.yarnrc` / `.npmrc` |

脚手架自带的 `.npmrc` / `.yarnrc` 已配全内网 registry 与**各 scope 的独立源**（`@lake` / `@turboui` 等）。给 `yarn install` 加 `--registry` 会**覆盖掉所有 scope 源**，表现是"包找不到"，极难往这个方向想。`setup-env.mjs` 里这行上方必须有注释写死这条。


### 4.2 v2 整包分发（**仅在 v1 实测出现规模化安装失败时才推进**）

把「portable node + 共享池 + 模板」在标准机器上打包一次，设计师端只解压，把 `yarn install` 这一步从 N 台机器收敛到 1 台。

**可行性已验证**：全仓 `*.node` 文件为 0 —— 没有 native 编译产物，不绑 node ABI，`node_modules` 整体拷贝的可移植性很好。

若要做，注意：
- **每个平台各打一份**（`win-x64` / `darwin-arm64` / `darwin-x64`）——`.bin` 在 Windows 是 `.cmd` 实体文件、在 Unix 是 symlink，格式不同；且可能有平台特定的 optionalDependencies
- macOS 用 `tar -czf`，**不要用 zip**（zip 不保留 symlink）
- portable node 必须和依赖一起打包、版本锁死
- 压缩慢的瓶颈是**数万个小文件的文件系统元数据操作，不是压缩算法**。方向：换 `zstd` / 降压缩率（7z `-mx1`）/ 虚拟磁盘镜像挂载。反方向：「逐文件从服务器下载而不是下载压缩包」——数万次 HTTP 请求开销远大于「下一个大文件 + 解压」

### 4.3 环境包不走 GitHub

按 §8.4 的同步约束，环境包（数百 MB，且内容是内网依赖）**只能在内网构建、内网托管**。外网仓库里只有 skill、脚本和 `env.manifest.json`（期望的版本号）。


### 4.4 内网托管：要准备什么、怎么放（离线操作手册）

> 本节是**可照着做的操作清单**，目标是把"内网侧要做的事"一次说完。

#### 4.4.1 三样资产走三条链路 —— 先分清，不然会重复托管

| 资产 | 大小 | 分发链路 | 每平台一份？ | 变更频率 |
|---|---|---|---|---|
| **skill 包**（`SKILL.md` + `scripts/` + `references/` + **`template/`** + `vendor/`） | 几 MB | **技能库上架机制**（已有） | 否，通用 | 高 |
| **portable node** | ~50 MB | **nginx 托管** | **是** | 极低（版本锁死） |
| **deps 整包**（1GB） | 1 GB | nginx 托管 | 是 | 低 |

**`template/` 跟 skill 包走，不单独托管** —— 这是 v7 相对 v5/v6 的修正，理由：

1. `template/` 与 `scripts/`、`SKILL.md` **强耦合**：`turboui.config.js` 的三处环境变量注入（§2.2）、SKILL.md 里内联的 golden example、`HANDOFF.md` —— 它们必须同版本。拆到两条分发链路 = 人为制造一个版本对齐问题，而 skill 有现成的上架/版本机制
2. `template/` 与 `deps/` 的耦合（`yarn.lock` 决定依赖树）**不需要靠分发同步来保证** —— `lockfileHash` 校验 + 本机 `yarn install` 自愈就是 lockfile 存在的意义（§5.2.2）
3. 手工维护的托管条目越少越好。nginx 上只剩一个几乎永不变的 node

**`deps` 整包第一版不做**（§4.2：仅在 v1 实测出现规模化安装失败时才推进）。所以 **nginx 上第一版只有 node 包 + 一个 manifest.json**。

#### 4.4.2 下载哪些 node 文件（精确文件名）

版本锁 **v22.19.0**（与内网现有环境一致）。官方目录 `https://nodejs.org/dist/v22.19.0/`，内网走已有 node 镜像同路径。**原样搬，不要解压重压**（重压会丢 Unix 权限位和 symlink）：

| 目标平台 | 文件名 | 说明 |
|---|---|---|
| Windows x64 | `node-v22.19.0-win-x64.zip` | 设计师机器主力 |
| macOS Apple Silicon | `node-v22.19.0-darwin-arm64.tar.gz` | M 系列 |
| macOS Intel | `node-v22.19.0-darwin-x64.tar.gz` | 若无 Intel 机器可省 |

> Windows ARM64 暂不列；确有此类机器再加 `node-v22.19.0-win-arm64.zip` 并在 manifest 里补一条。
> **必须用 `.zip` / `.tar.gz`，不要用 `.msi` / `.pkg`** —— 安装器会写注册表、改 PATH、要管理员权限，与 §4.1 的前提冲突。

三个包解压后外层都有一级同名目录（如 `node-v22.19.0-win-x64/`），安装脚本按 manifest 的 `stripComponents: 1` 剥掉，最终落成 `<envDir>/node/node.exe`（Win）/ `<envDir>/node/bin/node`（Mac）。

#### 4.4.3 sha256 从哪来

**node 包不用自己算** —— 官方每个版本目录下有 `SHASUMS256.txt`，直接从里面抄对应行（内网镜像通常也同步了这个文件）。

> ⚠️ **三个包的 sha256 各不相同**，一个文件一个值 —— sha256 是文件内容的指纹，Windows 包和 macOS 包内容完全不同。`SHASUMS256.txt` 里是**每行一个文件**（`<hash>  <文件名>`），按文件名找对应行，不要抄成同一个值。

自己算（校验搬运过程有没有损坏，或给自己压的包算）：

```powershell
# 内网 Windows / PowerShell
Get-FileHash -Algorithm SHA256 .\node-v22.19.0-win-x64.zip | Format-List
```
```bash
# 本地 macOS / bash
shasum -a 256 node-v22.19.0-darwin-arm64.tar.gz
```

**sha256 是必须的，不是可选项**：内网下载被网关截断、代理返回一个 HTML 错误页存成 `.zip`，这类事情的表现是"`yarn install` 报一堆看不懂的错"，不校验根本想不到是包坏了。

#### 4.4.4 资源怎么放（内网已有 `/design` 目录，无需改 nginx）

内网现有一个可直接投放的静态目录，落地路径与访问地址：

```
https://octo.hdesign.huawei.com/design/fastui-env/
├─ manifest.json
└─ node/
    ├─ node-v22.19.0-win-x64.zip
    ├─ node-v22.19.0-darwin-arm64.tar.gz
    └─ node-v22.19.0-darwin-x64.tar.gz
```

**manifest.json 和资源本身放在同一目录**，manifest 里用**相对路径**引资源（见 §4.4.5）—— 将来换域名、换目录，manifest 一个字都不用改。

> 目录名用 `fastui-env`，与共享池同名。刻意如此：将来 §4.2 的 1GB `deps` 整包也放这里，届时这个目录的内容就是共享池的完整镜像。

**不需要动 nginx 配置**，但 manifest 的缓存问题仍在（升级后客户端可能读到旧的），由**客户端侧解决**，不依赖服务端配合：

- 请求 manifest 时带 `Cache-Control: no-cache` 请求头
- URL 追加 `?t=<毫秒时间戳>` 破缓存

资源包本身**允许被缓存**（内容不变、有 sha256 兜底），命中缓存反而是好事。

自检：

```powershell
# 内网 Windows / PowerShell
Invoke-RestMethod https://octo.hdesign.huawei.com/design/fastui-env/manifest.json
(Invoke-WebRequest -Uri https://octo.hdesign.huawei.com/design/fastui-env/node/node-v22.19.0-win-x64.zip -Method Head).Headers['Content-Length']
```
```bash
# 本地 macOS / bash（该 host 外网不可达，此处仅记录命令形态）
curl -s https://octo.hdesign.huawei.com/design/fastui-env/manifest.json | head -40
curl -sI https://octo.hdesign.huawei.com/design/fastui-env/node/node-v22.19.0-darwin-arm64.tar.gz | grep -i content-length
```

**投放后必须逐个核对 `Content-Length`**：内网投放走网页上传时，几十 MB 的包被截断或代理返回错误页存成 `.zip` 都发生过，表现只是"`yarn install` 报一堆看不懂的错"。sha256 会兜住，但先看一眼大小能省一轮排查。

#### 4.4.5 `manifest.json` 示例（可直接改数值使用）

```json
{
  "manifestVersion": 1,
  "npmRegistry": "http://mirrors.tools.huawei.com/npm",
  "node": {
    "version": "v22.19.0",
    "platforms": {
      "win32-x64": {
        "file": "node/node-v22.19.0-win-x64.zip",
        "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
        "stripComponents": 1
      },
      "darwin-arm64": {
        "file": "node/node-v22.19.0-darwin-arm64.tar.gz",
        "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
        "stripComponents": 1
      },
      "darwin-x64": {
        "file": "node/node-v22.19.0-darwin-x64.tar.gz",
        "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
        "stripComponents": 1
      }
    }
  },
  "depsBundle": null
}
```

| 字段 | 含义 |
|---|---|
| `npmRegistry` | 只用于 §4.1 ③ 装 yarn。**不传给 `yarn install`** |
| `file` | **相对 manifest 所在目录**解析 |
| `sha256` | 从 `SHASUMS256.txt` 抄，或按 §4.4.3 自算 |
| `stripComponents` | 解压时剥掉的外层目录级数，node 官方包固定为 `1` |
| `depsBundle` | §4.2 的 1GB 整包，第一版填 `null` |

#### 4.4.6 manifest URL 写在哪

**直接写死在 skill 的 `references/env.manifest.json` 里**：

```json
{ "manifestUrl": "https://octo.hdesign.huawei.com/design/fastui-env/manifest.json" }
```

> 这是一次**显式取舍**，不是疏漏：原设计是由 `assemble.mjs --manifest-url=…` 注入一个 gitignore 的 `env.source.json`，好让外网仓不出现内网地址（§8.4）。经确认现有代码仓已有多处内网地址，不值得为这一条单独引入一个"内网生成、外网看不到"的文件层次 —— 那会让外网仓的 skill 处于"缺一个文件所以跑不起来"的状态，调试成本高于它挡住的风险。
>
> 将来若要清理外网仓的内网地址，回到 `env.source.json` 方案即可，`ensure-env` 侧只需换一个读取来源，其余不变。

#### 4.4.8 首装踩到的坑（2026-09-07 内网实测，已全部修掉）

测试同学的 Windows 机器上跑通了，但过程磕了好几处。**根因链是一路连锁的**，记下来免得下次重演：

| 现象 | 根因 | 修法 |
|---|---|---|
| `install.ps1` 报一堆语法错误 | **PowerShell 5.1 读无 BOM 的 UTF-8 时按系统 ANSI（内网 GBK）解释**，脚本里 36 行中文注释被解成乱码字节，其中含引号/反引号，直接破坏语法 | 文件改存 **UTF-8 with BOM**，并在文件头写明这条约束，免得以后被"顺手清理" |
| `setup-env.mjs` 中途失败，`EINVAL` | **Node 18 起禁止直接 spawn `.cmd`/`.bat`**（命令注入防护 CVE-2024-27980），而共享池的 yarn 在 Windows 上就是 `yarn.cmd` | 改走 yarn 的 JS 入口：`<node> <node>/node_modules/yarn/bin/yarn.js`，两平台统一、不经 shell；找不到再回落 `shell: true` |
| 编译报 `Cannot find module '../../../package.json'`、`./src/index 找不到` | **模板复制中断**，根目录的 `package.json` 与 `src/` 下若干文件没复制过来。而复制失败后目录已存在，重跑会被当成"已有会话"跳过复制，**残缺状态被固化，永远修不好** | `new-session` 复制后自检 5 个关键文件；缺则**删掉半成品并响亮失败**，重跑即可自愈。已存在的目录同样过一遍自检 |

> **这三个坑的可怕之处在于表现形式全都离根因很远**：第 1 个报语法错误、第 2 个报 EINVAL、第 3 个报编译找不到模块 —— 没有一个指向"编码"、"cmd 不能 spawn"、"复制没做完"。所以修完之后更要紧的是**让失败发生在离根因近的地方**（自检、`doctor`），而不只是把这三处修好。

#### 4.4.9 `doctor.mjs` —— 装不上时先跑它

```bash
node <skill>/scripts/doctor.mjs
```

一次性打印：平台/node 版本、skill 组装状态、共享池各部件、系统 node/yarn/npm、**代理环境变量**、manifest 的 HTTP 状态与耗时、返回内容是不是 JSON（代理/网关的错误页会在这里现形）、manifest 里有没有当前平台的包。

存在的理由：内网出问题时人只能截图（§8.4），而"装不上"背后有十几种可能，挨个手工试要来回好几轮。输出每行自解释，**截图发出来就够定位**，不需要再补充上下文。

设计师那边报"装不上"时，让他先跑这一条，比问任何问题都快。

#### 4.4.7 你在内网要做的事，按顺序

**首次搭建（一次性）**

1. 在 `/design` 下建目录 `fastui-env/node/`（无需改 nginx，见 §4.4.4）
2. 从内网 node 镜像下载 §4.4.2 的 2~3 个包，放进 `fastui-env/node/`
3. 抄/算 sha256（§4.4.3）
4. 按 §4.4.5 写 `manifest.json`，放进 `fastui-env/`
5. 按 §4.4.4 的自检命令确认 manifest 和资源都能拉到
6. 在内网跑 `assemble.mjs --template=<脚手架模板> --vendor=<三份组件 skill>`
7. 把 assemble 产出的 skill 包按技能库的上架流程上架
8. 在一台**干净的**设计师机器上调一次 skill，全程观察是否零人工介入（§9.2 阶段 1）

**fastui 发新版后的升级（每次）**

1. 更新脚手架模板的 `package.json` → 在内网维护机上 `yarn install` → 得到新 `yarn.lock`
2. 产出新的 `env.lock.json`（新 `envVersion` + 新 `lockfileHash`），写 env CHANGELOG
3. 跑 `assemble.mjs`（带上新 template）→ 上架新版 skill 包
4. **服务器上什么都不用改**（node 没变、template 随 skill 包走）
5. 设计师端下次调 skill 时 `ensure-env` 检出 `lockfileHash` 不匹配 → agent 自动跑 `install --upgrade` → 共享池增量 `yarn install` → 校验 hash → 继续

**只有 node 版本要换时**，才动 nginx：换包、更新 sha256 与 `version`、改 manifest —— 这是数月一次的事。


## 5. 脚本

> 全部输出机器可解析的固定行（沿用 ICT `init.mjs` 的 `RESULT:` 风格），让 agent 能判断该不该继续。全部幂等：已存在则复用，绝不覆盖用户文件。

### 5.1 调用时序

```
ensure-env  ──►  new-session  ──►  [模型写 views/<页面名>/* 并改 views/index.vue]  ──►  verify
   ↑                                                    ▲                                │
   │                                                    └── 编译失败,带 file:line 回传 ──┘
每会话首次(幂等)                                              循环至通过
```

**主流程只有 `ensure-env` / `new-session` / `verify` 三个**；`export-zip` 由"帮我导出代码"这类提示词或预览器的导出按钮（§8.6①）触发。

v9 砍掉了 `register`（§3.3，聚合入口交回模型）；`export-zip` 在 v9 延后、v12 又提回第一版（§2.5）。

### 5.1.1 统一输出契约（所有脚本）

stdout 只放契约行，过程输出一律走 stderr —— agent 解析 stdout，人看 stderr。

```
RESULT: OK
<KEY>: <value>                  # 大写 SNAKE,单行
WARN: <诊断>                     # 0..n 行,不阻塞

RESULT: FAIL | <CODE>: <中文一句话原因>
HINT: <可直接执行的下一步>
LOG: <日志绝对路径>
```

退出码：OK=0，业务失败=1，**用法错误=2**（参数缺失/非法，与业务失败区分开，便于 agent 判断是自己调错了还是环境有问题）。

> **失败原因写成「英文错误码: 中文说明」**：内网 Windows 终端代码页是 GBK，中文可能显示成乱码，但错误码是 ASCII —— 截图出来仍然可读。§8.4 要求"单条 `RESULT: FAIL` 要能独立说明问题"，这是它的实现形式。

多行内容（目前只有 `verify` 的编译错误原文）用显式块，不混进 key-value：

```
ERRORS_BEGIN
ERROR in ./src/views/foo/index.vue
Module not found: Error: Can't resolve '$/lake-basic-componnet'
ERRORS_END
```

**状态落盘**（端口要跨脚本传，靠 agent 转述字符串不可靠）。两个文件都在 `.octo/<sid>/` 下，**不在 `outputs/` 里**，产物目录保持零污染：

| 文件 | 写者 | 内容 |
|---|---|---|
| `.octo/<sid>/.octo-fastui.json` | `new-session` | `{name, projectDir, writeDir, port, envDir, depsDir, createdAt, updatedAt}` |
| `.octo/<sid>/.devserver.json` | `verify` | `{port, pid, projectDir, logPath, startedAt}` ← §8.6③ 宿主读这个 |
| `.octo/<sid>/devserver.log` | `verify` | dev server 的 stdout/stderr，编译判定的数据源 |

**环境目录可被 `OCTO_FASTUI_ENV_DIR` 覆盖** —— 外网 V0 验证要用假共享池，没有这个开关本地一步都跑不了。

##### 日志落在哪（v13 统一）

宿主 UI 未必把脚本 stdout 展示给人看，所以契约行同时落盘。**落点按"有没有会话上下文"分成两处，只有两处**：

| 文件 | 谁写 | 里面是什么 |
|---|---|---|
| `.octo/<sid>/octo-fastui.log` | `new-session` / `verify` / `export-zip` | 这些脚本的全部契约行，带时间戳与完整命令行 |
| `.octo/<sid>/devserver.log`（Windows 另有 `.err`） | 宿主（子进程 stdio 重定向） | dev server 原始输出，**编译判定的数据源** |
| `<envDir>/octo-fastui.log` | `ensure-env` / `setup-env` / `doctor` | 首装与诊断 —— 这几个可能在还没有任何会话时跑 |

**跑起来之后出的问题，日志全在会话目录一处**；只有装不上那类问题才去共享池找。`doctor` 会把这两个路径都打印出来（`LOG_INSTALL` / `LOG_PER_SESSION`），找不到日志时先跑它。

> 主进程侧另有一份：Electron 的 electron-log，搜 `[fastui]` 前缀，定位方式见 [find-local-logs.md](../../find-local-logs.md)。那份记的是"宿主起没起 dev server"，与脚本侧互补。

### 5.2 `ensure-env.mjs` — 环境就绪校验

> v7 重写。旧版校验链写于 v4，与 v7 的分发架构（template 随 skill 走、依赖本机装、探针默认关、占位检测）已全面脱节 —— 照旧版实现会与 §5.2.2 / §8.3 直接打架。

**目标是 1 秒内出结果**（每个会话开头都要跑），所以只做只读判断，不做任何修复动作（§5.2.2）。

校验链，快的先跑，任一不过立即返回 `RESULT: FAIL`：

| # | 检查 | 不过时的 `RESULT: FAIL \| …` |
|---|---|---|
| 1 | **占位未填充**：`template/PLACEHOLDER.md` 或 `vendor/PLACEHOLDER.md` 仍存在；`template/package.json` 缺失；`vendor/` 三子目录不齐（§8.3 末尾的硬要求） | `SKILL_NOT_ASSEMBLED` —— skill 未完成内网组装 |
| 2 | **共享池存在**：`<envDir>/node/`、`<envDir>/deps/node_modules/`、`<envDir>/env.lock.json` | `ENV_MISSING` —— 环境未安装 |
| 3 | **`lockfileHash` 比对（主判据，见 §5.2.1）** | `ENV_OUTDATED` —— 环境与当前 skill 的依赖清单不一致 |
| 4 | `<envDir>/node/node -v` 比对 `env.lock.json` 的 `nodeVersion` | `ENV_NODE_MISMATCH` —— 拿错平台包或 node 被换过 |
| 5 | 抽查 `keyPackages` 各包的 `package.json` 版本号 | **不阻塞**，仅输出 `WARN:` 行（§5.2.3：仅供诊断，不作判据） |
| 6 | **真实探针**（起一次 dev server 轮询到 200 再停掉）—— **默认关，`--probe` 才跑** | `ENV_PROBE_FAILED` |

不做文件数/体积校验（不可靠），不 hash 整个 `node_modules`（太慢）。

> **为什么链里没有 `envVersion` / `templateHash`**：v8 评审提过一个真问题 —— `lockfileHash` 只能检出依赖树变化，改 `turboui.config.js`、改 golden example 这类不动 `yarn.lock` 的升级它检不出来，于是共享池里的 template 会悄悄过期。
> **v9 用「template 不进共享池」从根上消掉了这个问题**（§3.1）：会话直接从 `<skillDir>/template/` 复制，skill 一升级，下一个会话拿到的就是新模板，中间没有第二份可以过期。于是不需要 `envVersion` 双判据，也不需要引入 `templateHash` 字段。
> `envVersion` 保留在 `env.lock.json` 里仅作诊断与 CHANGELOG 对账。

**探针默认关**是 v7 的修正：首次编译要 1–3 分钟，放进每个会话的开头等于让设计师每次等 3 分钟。它的正确位置是**安装/升级完成后收口跑一次**（§4.4.7 第 8 步、§9.2 阶段 1 第 2 步），由 `install` 脚本在末尾以 `--probe` 调用。

> 探针需要一个能编译的页面 —— 直接用 `references/golden-example.vue`（§7.2）：拷进一个临时会话编译一次，**既验证环境可用、又顺带验证 golden example 没有随组件库升级而失效**。这是它唯一一次被真实编译的机会，别浪费。

失败时 `HINT:` 行必须给出可直接执行的下一步（§5.2.2），`SKILL_NOT_ASSEMBLED` 除外 —— 那是内网组装环节的问题，指向本 spec §8.3。

```json
// <envDir>/env.lock.json —— v7:由本机 setup-env.mjs 在安装/升级末尾产出
// (不再是"打包机产出随环境包分发",因为 v7 的依赖是本机 yarn install 装的)
{
  "envVersion":  "2026.09.02-1",       // 环境构建号,来自 template 里的声明
  "lockfileHash": "sha256:…",          // 装这棵树时用的 yarn.lock 的 hash —— 见 §5.2.1 的比对方式
  "platform": "win32", "arch": "x64",
  "nodeVersion": "v22.19.0",
  "yarnVersion": "1.22.5",
  "templateVersion": "2026.09.02",     // 脚手架模板版本(我们从他们脚手架裁剪来的那份)
  "fastuiRelease": "…",                // fastui 团队的发布标识,用于对账(若他们有)
  "installedAt": "2026-09-03T10:22:31Z",
  "keyPackages": {                     // 仅供诊断展示,不作判据
    "vue": "3.5.13",
    "element-plus": "2.11.4",
    "@lake/lake-pro-component": "3.3.3-beta.80",
    "@lake/lake-report-component": "3.59.2"
  }
}
```

### 5.2.1 `lockfileHash` 比的是谁和谁 —— v7 架构下这个变了

> **这是整条升级链路的枢纽，比错了升级永远不会被触发。**

v5 时代 `template/` 走内网托管、`env.lock.json` 由打包机产出，所以比对是「`env.lock.json` 记录值 vs 共享池实际值」。

**v7 把 `template/` 改成随 skill 包走、`env.lock.json` 改成本机产出之后，这个比法失效了**：skill 升级带来新 `template`（新 `yarn.lock`）时，`env.lock.json` 和 `deps/` 都没动，两者依然一致 → 检测不出任何变化 → `install --upgrade` 永远不会被触发。

正确的比对**必须跨过 skill 与共享池的边界**：

```
sha256(<skillDir>/template/yarn.lock)    ← 期望值:随 skill 升级而变
        vs
sha256(<envDir>/deps/yarn.lock)           ← 实际值:只有跑过 install/upgrade 才变
```

不一致 = 当前 skill 要求的依赖树，与共享池里实际装的那棵不是同一棵 → `ENV_OUTDATED`。

`env.lock.json` 里的 `lockfileHash` 字段**降级为记录**：「上次安装时装的是哪棵树」，用于诊断输出和 env CHANGELOG 对账，**不是判据**。（保留它是因为 `deps/yarn.lock` 可能被人手动动过，两者对不上时能一眼看出是这种情况。）

`install --upgrade` 的收尾校验则是另一个方向：装完后 `sha256(<envDir>/deps/yarn.lock)` 必须等于它复制过来的那份 —— 不等就是响亮失败。

**顺带把三个"版本"分清，否则一定搞乱**：

| 概念 | 是什么 | 谁维护 |
|---|---|---|
| **期望值** | 当前 skill 的 `template/` 里声明的版本与 `yarn.lock` | 我们（跟随 fastui），随 skill 上架分发 |
| **实际值** | 共享池 `deps/` 里真正装了什么，由 `deps/yarn.lock` 唯一决定 | 本机 `install` 产出 |
| **上游值** | fastui 团队当前发布的最新版 | 他们 |

`env.lock.json` 记录的是**实际值**，因为它的用途是"这台机器上装的是哪一份"。

**`yarn.lock` 是权威判据**：它唯一决定整棵依赖树，比列举 `keyPackages` 更严格且零维护。`keyPackages` 只在诊断输出里展示给人看。

`templateVersion` 是脚手架模板的版本（不是组件库版本，组件库版本在 `keyPackages` 里）—— 原字段名 `scaffoldVersion` 语义含糊，改掉。

### 5.2.2 升级机制：lockfile 驱动的增量升级

**要禁的是"改 lock 的操作"，不是"装依赖"** —— 这两件事必须分开：

| 操作 | 是否允许 | 原因 |
|---|---|---|
| `yarn install`（按 `yarn.lock` 复现） | ✅ **允许** | lockfile 唯一决定整棵依赖树，各机器结果一致且可用 `lockfileHash` 验证。这正是 lockfile 存在的意义 |
| `yarn upgrade` / `yarn add`（会改 lock） | ❌ **禁止**（设计师机器上） | 各机器漂移到不同状态，「预览正常但交付到开发编译失败」这类问题**无法复现** |

因此升级不需要重下几百 MB，走**增量**：

```
fastui 发新版
  ① 内网维护机:更新 template 的 package.json → 跑 yarn install → 得到新 yarn.lock
     → 产出新 env.lock.json(新 envVersion + 新 lockfileHash) + 写 env CHANGELOG
  ② assemble.mjs 带上新 template → 上架新版 skill 包(几 MB,走技能库)  ← v7:template 随 skill 走
     nginx 上什么都不用改
  ③ 外网仓只改 skill 的 requiredEnvVersion,走 GitHub
  ④ 设计师端 ensure-env 检出 lockfileHash 不匹配
     → agent 自动跑 install --upgrade
     → 把新 template 的依赖清单覆盖到 <envDir>/deps/ → cwd=deps 跑 yarn install(按新 lock 增量装差异)
     → 校验 lockfileHash 匹配 → 完成
```

新 template 是**随 skill 包一起到设计师机器上的**（§4.4.1），所以 ④ 不需要任何下载动作，只是本机复制 + 增量 `yarn install`。

绝大多数升级只动少数几个包，`yarn install` 的增量远快于首次安装，也远快于重下整包。**确定性没有丢失**，因为有 `lockfileHash` 兜底 —— 装完不匹配就是响亮失败。

`ensure-env` **只判断，不执行修复**：检出不一致时响亮失败，并在 `HINT:` 行给出一条**可直接执行的升级命令**；下载/解压/`yarn install` 全部收在 `install` 脚本的 `--upgrade` 分支里。SKILL.md 里写死"`ensure-env` 返回 `ENV_OUTDATED` / `ENV_MISSING` 时直接执行 `HINT:` 那条命令"，所以**对设计师而言这一步是全自动的**，他不接触任何安装命令。

这样分的理由：`ensure-env` 是每个会话开头都跑的快校验（目标 1 秒内出结果），把可能跑 3–10 分钟的下载与 `yarn install` 塞进去，它就会偶尔无预警地卡十分钟；而且那段逻辑与 `install` 脚本重复。拆开后 `ensure-env` 永远快、永远只读，下载逻辑只有一份。

判据方向不对称：

| 情况 | 行为 |
|---|---|
| `lockfileHash` 不匹配（依赖树不是期望的那棵） | `RESULT: FAIL \| ENV_OUTDATED` + `HINT:` 升级命令 |
| 机器上的 `envVersion` ≥ `requiredEnvVersion` 且 hash 匹配 | **通过** —— skill 更新远比环境频繁，必须向后兼容 |

> §4.2 的整包分发在这个机制下降级为**首次安装的可选优化**，与升级路径无关。

### 5.2.3 哪个字段承载什么

| 字段 | 在哪个文件 | 承载什么 | 谁改 |
|---|---|---|---|
| `skillVersion` | skill 的 `SKILL.md` frontmatter | 提示词、脚本、`vendor/` 组件 skill 的版本 | 外网仓，走 GitHub |
| `requiredEnvVersion` | skill 的 `references/env.manifest.json` | **skill 要求的最低环境版本**（同 `package.json` 的 `engines`） | 外网仓，走 GitHub |
| `envVersion` | 环境的 `env.lock.json` | 环境构建号，**模板 + 依赖 + 组件库版本 + node 全部包含在内**；声明在 template 里，安装时抄进 `env.lock.json` | template（内网维护），本机 `install` 写入 |
| `lockfileHash` | 环境的 `env.lock.json` | 上次安装时装的是哪棵树，**诊断与对账用；判据是 §5.2.1 的跨边界比对** | 本机 `install`（随 `deps/yarn.lock` 派生） |
| `templateVersion` | 环境的 `env.lock.json` | 脚手架模板自身的版本 | template（内网维护），本机 `install` 写入 |
| `keyPackages` | 环境的 `env.lock.json` | 组件库等关键包的版本，**仅供诊断展示，不作判据** | 本机 `install` 从实际装好的包里读出 |

**组件库版本不单独立字段** —— 它已经被 `envVersion` 涵盖（组件库变了就是环境变了），精确值在 `keyPackages` 里可查、在 `lockfileHash` 里被严格约束。

### 5.2.4 版本号分两个，不要合并

| | 跟什么走 | 怎么分发 | 变更频率 |
|---|---|---|---|
| `skillVersion` | 提示词、脚本、`vendor/` 里的组件 skill | GitHub，秒级 | 高 |
| `envVersion` | 模板、依赖、portable node | 内网托管，数百 MB | 低 |

**合并成一个会出事**：每改一次提示词都让版本号变，环境就会被判定"过期"而触发重新下载几百 MB。

做法同 `package.json` 的 `engines` 字段：skill 的 `env.manifest.json` 里写 `requiredEnvVersion`，`ensure-env` 拿它跟机器上的 `env.lock.json` 比。

**两份 CHANGELOG 分开记**（skill 的 / env 的），改动来源不同：前者是提示词、脚本调优，后者是模板、依赖升级。env 那份顺带承接 §10-Q4 的「fastui 版本 ↔ envVersion」对应关系。

**对外契约（v1/v2 换实现时保持不变）**：

```
RESULT: OK
ENV_DIR: C:\Users\xxx\AppData\Local\OctoAgent\fastui-env
ENV_VERSION: 2026.09.02-1
---
RESULT: FAIL | <一句话原因>
LOG: <日志绝对路径>
```

### 5.3 `new-session.mjs` — 创建会话工程

```
入参  --artifact-dir=<绝对路径>   必填,Design 传的 [Artifact Folder](= .octo/<sid>/outputs)
      --name=<产物名>            可选,默认 fastui-app;即工程目录名
      --env-dir=<路径>           可选
```

1. 建依赖链接 `.octo/<sessionId>/node_modules` ⇢ 共享池（junction / symlink）。**幂等**：已指向正确目标就跳过；指向别处则报错，不擅自改用户的东西
2. 从 `<skillDir>/template/` 复制工程骨架到 `.octo/<sessionId>/outputs/<产物名>/`。**目录已存在则整体跳过复制**，绝不覆盖模型已经写过的东西
3. 分配端口（§6）。已有状态且那个端口还可用就沿用，免得每次调用都换端口
4. 写 `.octo-fastui.json`

```
出参  RESULT: OK
      PROJECT_DIR / WRITE_DIR / ENTRY_FILE / PORT / DEPS_DIR / SESSION_STATE / LINK / REUSED
```

`WRITE_DIR` 是**模型唯一可写目录**（`…/packages/portal/src/views/`），`ENTRY_FILE` 是它要改的那个聚合入口（`…/views/index.vue`）—— 两个都直接给出绝对路径，不让模型自己拼。

### 5.4 ~~`register.mjs`~~ —— v9 砍掉

聚合入口 `views/index.vue` 交回模型自己改，理由与失败面分析见 §3.3。约束写进 SKILL.md 即可，不需要脚本。

### 5.5 `verify.mjs` — 编译门禁

```
入参  --session-dir=<.octo/<sid>>   与 --project-dir 二选一
      --project-dir=<产物目录>
      --restart                     强制重启 dev server(默认复用)
      --timeout=300                 秒
```

起（或复用）dev server，等编译完成，解析日志判定 success/error。失败时把**错误原文（含 file:line）**返回给 agent。详见 §7.3。

```
出参  RESULT: OK
      PREVIEW_URL: http://127.0.0.1:8083     ← 直接拿去拼 artifact 标签(§7.5)
      PORT / PID / PROJECT_DIR / REUSED / COMPILE_MS / LOG

      RESULT: FAIL | COMPILE_ERROR: webpack 编译未通过
      PORT / PID / LOG
      ERRORS_BEGIN … ERRORS_END              ← 错误原文,含 file:line
```

两处实现决定：

- **cli-service 入口从 `@turboui/turbo-ui-cli-service/package.json` 的 `bin` 字段解析**，不硬编码路径 —— 版本升级换了入口文件名也不会断
- **编译输出的匹配标志集中在 `lib/compile.mjs` 的 `MARKERS` 里**（`Compiled successfully` / `Failed to compile` 等）。这些按 webpack / vue-cli-service 的通行输出写，**turbo-ui-cli-service 的实际形态待内网首次实测校准，届时只改这一处**

#### 5.5.1 编译结果判定必须防竞态（否则必然 flaky）

dev server 是常驻 watch 的，模型写文件的过程中 webpack 就会被触发。天真的做法（"日志里最后一次结果是什么就报什么"）会读到两类假信号：

| 假信号 | 成因 |
|---|---|
| **假失败** | 模型正在写多个文件，webpack 在只写了一半时就编了一次，报 `Module not found` |
| **假成功** | 读到的是上一轮（模型改动之前）那次编译的结果 |

判定规则，三条同时满足才采信：

1. 该次编译的**开始时刻晚于**本次 `views/` 下所有文件的最新 mtime
2. 日志里能匹配到**完整的一对**「编译开始 → 编译结束」，只看到结束标志不算数
3. **稳定窗口**：这次编译结束后 `800ms` 内没有新的「编译开始」出现，才认为文件已经写完、结果是终态

第 3 条是关键 —— 它把"等模型彻底写完"这件不可观测的事，转换成了"等 webpack 不再被触发"这件可观测的事。webpack 的 `watchOptions.aggregateTimeout` 默认 300ms，800ms 留了足够余量，且**不需要改 template**。

超时上限仍是 §6.2④ 的 5 分钟（首次编译 1–3 分钟）。

### 5.6 `export-zip.mjs` — 打交付包（**v12：提为第一版，正确性需求**）

> **v9 曾判它为"便利性"而延后**，前提是"产物目录零链接、随手压缩就安全"。v12 把链接改回工程根之后（§2.5），
> 这个前提没了：**整目录压缩会跟随链接把 1GB 依赖打进去，干净交付包只能由这个脚本产出**。于是它从便利性变成正确性，提进第一版。

单区下产物本来就在 `outputs/<产物名>/`，**没有同步步骤**。这个脚本只负责"打个 zip 出来"，两条触发路径：

- 设计师在预览器上点**导出按钮**（主路径，见 §8.6）
- 提示词触发（"帮我导出代码包"）→ agent 调本脚本

产出 `outputs/<产物名>.zip`。产物目录里本来就没有链接（§3.2），所以**排除清单不是打包正确性的必要条件，而是防御性的** —— 防御的是"开发在本地 `yarn install` 之后又拿这个脚本打包"这类情况。统一一份清单，实现照抄：

| 排除项 | 防御什么 |
|---|---|
| `node_modules/`（任何层级） | 本地装过依赖后再打包 → 1GB |
| `.git/` | 产物目录被 git init 过 |
| `dist/`、`.cache/`、`.turbo/` | 构建中间产物 |
| `*.log`、`yarn-error.log` | 日志噪音 |
| `.DS_Store`、`Thumbs.db` | 平台垃圾文件 |

**不设例外，`node_modules` 全量排除。** 曾考虑放行 `packages/portal/node_modules/.bin/`（§2.3 的 735 字节），但那站不住：开发拿到包必然要跑 `yarn install`，而 `yarn install` 本来就会重新生成 `.bin` —— 带不带它，开发那边行为完全一样。而放行它要写一个"排除 `node_modules` 但放行某个子路径"的例外分支，那是排除规则里最容易写错的一类逻辑。template 里保留那 735 字节没问题，打包时不需要。

**实现用 node 内置 `zlib` 自写 ZIP 容器**，不依赖系统 `zip`（Windows 没有）也不依赖 `Compress-Archive`（两平台行为不一致、对大量小文件极慢）。零依赖、两平台字节级一致、排除规则完全可控，代价约 200 行（local header / central directory / CRC32 / DOS 时间戳 / 目录 entry）。

> ⚠️ **必须置 general purpose bit 11（UTF-8 flag），并把文件名按 UTF-8 编码写入。**
> 不置这一位时，Windows 资源管理器会按系统 ANSI 代码页（内网即 GBK）解释文件名，中文产物名/页面名解压后全是乱码。内网场景中文命名概率很高，**单测必须有中文文件名 case，并断言 Windows 与 macOS 解压结果一致**。

---

---

## 6. 端口分配与生命周期

> 这是设计师端最高频的故障点（端口占用导致服务起不来），本节给出确定性方案。

### 6.1 为什么不让 dev server 自己找端口

webpack-dev-server v4+ 才支持 `port: 'auto'`，而 `turbo-ui-cli-service` 封装的版本未知。**更重要的是：Octo 必须知道最终端口才能让预览容器指向它** —— 让 dev server 自己找，我们还得去解析它的 stdout 才知道用了哪个，格式可能变、还会被 lerna 的输出前缀污染。

**所以端口由我们分配、传进去。**

### 6.2 四步，以及各自落在哪

| 步骤 | 落点 |
|---|---|
| ① 探测空闲端口（从 8081 向上扫，端口号可预测便于排查） | `new-session.mjs` |
| ② 通过环境变量 `OCTO_PORT` 传入 | **模板里的 `turboui.config.js`** —— `port: Number(process.env.OCTO_PORT) \|\| 8081`，模板自带，脚本不改文件 |
| ③ 捕获 `EADDRINUSE` 重新分配，最多 3 次 | `verify.mjs` 的启动逻辑 |
| ④ 轮询 `http://127.0.0.1:<port>/` 直到 200（超时 5 分钟，首次编译要 1–3 分钟） | `verify.mjs` |

③ 是必要的：探测到空闲、到 dev server 真正 listen，中间有几百毫秒窗口理论上会被抢。做了这一步，端口冲突是零概率事件。

#### 6.2.1 光靠探测不够 —— `new-session` 要原子占位（v10，V0-a 实测发现）

`probe()` bind 完立刻 close，**不占位**。并发跑起来的多个 `new-session` 会同时发现 8081 空闲，于是**全部拿到 8081** —— V0-a 实测：5 个进程只拿到 1 个端口。冲突要到 `verify` 启动 dev server 时才暴露，那时虽然还能重试，但 `new-session` 报给 agent 的 `PORT` 已经是错的了。

修法分两步，都验证过：

1. **原子占位**：在 `.octo/.ports/<port>` 用 `O_EXCL`（`writeFileSync` 的 `wx` 标志）创建标记文件，创建成功即占到 —— 这一步是原子的，没有"检查与使用"之间的窗口。只维护一张"已登记端口表"再去读它是不够的：并发时大家读到的表都还是空的（实测 8 进程仍有 2 个撞在 8081）
2. **陈旧标记的回收判据要两条同时成立**：`标记里的会话状态文件不存在` **且** `标记已超过 60 秒没人接手`。只看第一条会出事 —— 占位与写状态文件之间有几十毫秒窗口，并发时后来者会把前一个刚占的位当成陈旧回收掉（这正是上面那 2 个撞车的成因）

修完实测：**8 个进程并发 → 8081…8088，零重复**；同一会话重复调用端口不变（重入）。


```js
// new-session.mjs
import net from 'node:net'
function probe(port) {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, '127.0.0.1')
  })
}
```

> ✅ **已验证（2026-09-02）**：环境变量可穿透 `yarn` → `lerna run serve --parallel` → `turbo-ui-cli-service` 三层进程，模板已改。

### 6.3 生命周期

- Octo 内存里维护 `会话 → port → pid`（一个 Map，不是持久化表）
- **不做精细的挂载/卸载回收** —— 设计师来回切 tab 时反复重启 webpack 体验很差
- **Agent 退出时统一清理**
- **软上限：同时最多 3 个 dev server**，超出关最旧的。webpack dev server 每实例吃数百 MB 内存，不设上限会把设计师机器拖垮

#### 谁来 spawn dev server —— skill 起、宿主按 pid 收（v7 二次修正，回到 v6）

`verify.mjs` 是短命脚本，它退出后 dev server 必须还活着：`detached: true` + `windowsHide: true` + stdio 全部重定向到 `.octo/<sid>/devserver.log` + `unref()`，然后把 `{port, pid, projectDir, logPath, startedAt}` 写进 `.octo/<sid>/.devserver.json`。宿主读这个文件拿 pid 做生命周期管理（§8.6③）—— **宿主只需要知道 pid，不需要持有进程**。

> **一次自我修正**：v7 初稿曾改成"由宿主 spawn 并持有"，理由是绕开 Windows `detached` 与 Job Object 的坑。这个权衡是反的，撤回：
> - 那个 Windows 坑是**可能存在**的（`detached` 在 Windows 走 `CREATE_NEW_PROCESS_GROUP`+`DETACHED_PROCESS`，通常能脱离；只有父进程被放进设了 `KILL_ON_JOB_CLOSE` 的 Job Object 时才会被连坐）
> - 而宿主方案引入的是**确定存在**的成本：一套新的跨进程协议（本地 HTTP + token + `.octo-host.json` 的位置语义）、以及必须在两套后端框架里选边站的已知坑（`packages/opencode` 同时有 Hono 与 Effect HttpApi，开发/预览渠道只跑后者，照抄 Hono 会写出一个永远 404 的路由，见 [hono-vs-effect-httpapi-routing](../../learning/hono-vs-effect-httpapi-routing.md)）
> - 而且**自管模式无论如何都要写**（内网调脚本、外网跑 §9.1 的 V0 都不经过宿主），宿主方案并不能省掉这段代码，只是在它之上再加一层
>
> 用确定的复杂度去换一个可能的风险，方向错了。先按自管做，内网实测（§9.2 阶段 2）验证"脚本退出后 dev server 仍存活"。

**Windows detached 是待验风险，不是已解问题**：内网调试恰恰就在 Windows 上，若实测发现 dev server 跟着 `verify.mjs` 一起死，退路是把 spawn 交给宿主（Electron 主进程或 opencode server），届时**必须先定走哪套路由框架**：

| 退路 | 落点 | 注意 |
|---|---|---|
| 挂 opencode server | **必须走 Effect HttpApi**（`server/routes/instance/httpapi/groups/*` + `handlers/*`），扩展现有 `insight` 分组 | 普通 Hono 路由在本仓开发/预览渠道是死代码 |
| Electron 主进程另起本地 server | `packages/app` 侧，不碰上游核心 | token 与端口发现机制要自己做 |

**在没有实测证据之前不要提前上这一层。**

### 6.4 host 用 `127.0.0.1`

脚手架默认 `host: 'localhost.huawei.com'`（因为 UAC 的 cookie 绑在 `.huawei.com` 域上）。**我们全程用 `127.0.0.1`** —— 已实测可直接访问、iframe 可嵌入、`flushdns` + 断网后仍正常。附带好处是只监听环回，避开 Windows 防火墙弹窗。

> 边界：若将来生成的代码需要调 `/uac-service/` 等 proxy 接口，登录态会带不上。纯组件渲染不受影响。

---

## 7. 生成质量保障：三层

### 7.1 分层依据（借鉴 ICT skill）

ICT skill 的核心思想值得照搬：**把「能不能跑」变成一个 agent 自己能跑、能读懂错误、能自己修的闭环**，并在 SKILL.md 里写死「不过就继续修」。它分两层——静态硬校验（icon 名查 1777 词表、CSS token 白名单、import 语法白名单，任一不过 `exit 1`）+ 动态执行（headless 编译 + stub DOM 跑一遍）。

但**校验对象必须换**：它没有真实组件库，校验的是 token 和 icon 名；我们有真实构建，校验的是「组件/路径存不存在」和「webpack 编不编得过」。

### 7.2 第一层 — 生成前约束｜落在 **fastui 组件 skill 正文**

组件选型、API 用法、**import 路径**由内嵌的三份 fastui skill 负责（§8.2），本 spec 不介入其内容。

现已诊断清楚：**当前的路径错误源于「空对空生成」**——内网 agent 生成时看不到脚手架，只能凭组件文档猜路径。给定确定的输出目录 + 一个真实跑通的 golden example（现有的图表 `index.vue`）后，这类问题预期基本消失。

我们这侧要提供的只有三样确定的东西（**不是"更多上下文"，是"更强的约束 + 更清晰的反馈"**）：

1. 确定的可写目录（`new-session` 返回）
2. 一个真实跑通的 golden example
3. 可读的失败信号（第二层）

#### golden example 的形态与位置

它是这三样里最容易做歪的一样，四个要求同时成立才有价值：

| 要求 | 怎么满足 |
|---|---|
| **真实可编译**（否则它教给模型的写法可能本身就是错的） | 实体放在 `template/…/src/views/_example/index.vue`，是工程里真实存在的文件 |
| **模型必然看到**（放在某个 references 文件里，模型未必去读） | **同一份代码内联进 `SKILL.md` 正文**；`assemble.mjs` 校验两处内容一致 |
| **可以被替换掉** | 模板初始的 `views/index.vue` 就引用它，所以装完就能看到一个真实页面（环境自检的可视反馈）；模型写第一个页面时自然把它换掉 |
| **不会随组件库升级而失效** | `ensure-env --probe` 就用它做探针（§5.2）—— 每次安装/升级都会真实编译它一次 |

**内容上写什么**：示例的价值**不在于展示组件有多少种用法，而在于钉死模型猜不到、文档也给不了的那几件事**。当前脚手架里那个"七种 Button 变体"的示例页，方向偏了 —— 模型会模仿成"罗列组件"，而不是"写一个页面"。

一份最小但完整的页面，示范四件事就够：

| # | 示范什么 | 为什么模型猜不到 |
|---|---|---|
| 1 | **两种 import 路径**：`import { ElButton } from 'element-plus'` 与 `import { LakeTooltip } from '$/lake-basic-component'` | **`$/` 这个别名是最高价值的一条** —— 它是脚手架的 webpack alias，不在任何组件文档里，模型只能靠猜，而 §7.2 诊断出的路径错误正是这么来的 |
| 2 | **lake 的 class 约定**：`class="lake-icon-add"`、`lake-pure-icon` | 同上，属于脚手架约定而非组件 API |
| 3 | **`<script setup lang="ts">` 里的状态写法**：一个 `ref` + 一个事件处理 | 让模型看到的是"一个页面"的骨架，不是组件目录 |
| 4 | **根布局容器 + `<style scoped>`** | 页面级的结构与样式隔离约定 |

每种组件保留**一个**用例即可，不需要枚举变体 —— 变体属于组件文档（`vendor/` 里那三份 skill）的职责，不是 golden example 的。

> **备选（实测路径错误仍高频时再做）**：写脚本扫共享池里的 `@lake/*` 包，导出一份「组件名 → import 路径」的权威映射表。价值在于它**从真实依赖生成，不是人写的也不是从文档抄的**，不会过时、不会有笔误。

### 7.3 第二层 — 真实编译门禁｜落在 **`verify.mjs` + 本 skill 的 SKILL.md**

webpack 编译通过 = 能跑，这是最硬的信号。缺的是**把错误喂回 agent**：

- `verify.mjs`：起（或复用）dev server → 等首次编译完成 → 解析 stdout 判定
- 失败则返回错误原文（含 file:line），agent 自己改，循环至通过
- **SKILL.md 里写死硬约束：编译不通过不算完成**

**没有这一步，模型会一直说「我改好了」。这是整套东西可靠性的分水岭。**

> **输出解析**：直连启动（§2.4）后 stdout 是原始 webpack 输出，不带 `lerna run serve --parallel` 的 `demo-portal: <s>` 前缀，解析干净。实测编译失败时的形态是 `ERROR Failed to compile with N errors` + 逐条 `[plugin] …` 明细，可直接回传。

### 7.4 第三层 — 运行时错误捕获｜落在 **模板内置 bridge + 宿主监听**

编译通过 ≠ 渲染正确（prop 类型传错、组件内部抛异常，编译都能过）。

**实现载体是模板，不是宿主注入** —— 原因见 §7.6 的同源性约束：预览指向 `http://127.0.0.1:<port>`，与 Octo 页面**跨源**，宿主拿不到 `iframe.contentDocument`，注不进去。

做法：`template/` 里内置一段 bridge（挂 `window.onerror` + Vue 的 `app.config.errorHandler`），`postMessage` 回宿主；宿主侧的 renderer 监听并喂给 agent。模板由我们控制，这条路是通的。

### 7.5 预览容器：现有 `text/link` 链路已支持，预计零改动

**查证结论（2026-09-02，UXAI `pages/make/`）：不需要新增 renderer。** skill 只要输出一条 artifact 标签，现有链路会把它变成一个指向 dev server 的 iframe：

```
skill 输出：<artifact type="text/link">http://127.0.0.1:8083</artifact>
  │
  ├─ insight-turn.tsx:156      "text/link" → link 类型卡
  ├─ index.tsx:3771            识别 http(s):// → 开 { type:"html", subtype:"url", filePath:<URL> } tab
  ├─ html-renderer.tsx:853     shouldUseExternalUrl() —— 判据就是 /^https?:\/\//.test(props.filePath)
  └─ html-renderer.tsx:1405    <iframe src={externalUrl()}>   ← 走 src，不走 srcdoc
```

`index.tsx:3771` 处的注释原文是「**复用 preview URL 工作流**」—— 这条路是现成的、已在使用的。

**附带收益**：`externalUrl()` 会把 `refreshKey` 拼成 `?_octo_v=N` query，正好用于「重新编译后刷新预览」，不用自己造刷新机制。

**external 分支的 sandbox 也已经是放宽的那套**：`allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox`（srcdoc 分支只有前两项）。

#### 实现时按实际情况处理的两点（不预先约谈，但**不得影响既有业务逻辑**）

1. **external URL tab 上的 inspect / manual-edit / draw / comment**
   它们依赖 `iframe.contentDocument`，而 `127.0.0.1:<port>` 与宿主**跨源**，直接访问会抛异常。实现时先看 `shouldUseExternalUrl()` 为真的分支里这些功能是否已被 gate；若没有，**只加 gate、不改既有行为**——srcdoc 路径上的所有能力必须原样保留。第一版我们只要纯预览。

2. **dev server 的生命周期**
   §6.3 的方案（Octo 内存维护 `会话 → port → pid`、Agent 退出统一清理、软上限 3 个）落在 Design 页面侧还是 skill 侧，实现时按代码实际结构定。倾向页面侧——skill 进程退出后管不了常驻服务。

#### 同源性的遗留影响（二次编辑，不在本 spec 范围）

Design 现有的 `InspectPanel` / `ManualEditPanel` / `DrawOverlay` 直接读写 `contentDocument`，**跨源下都不可用**。将来做二次编辑必须改成 postMessage 协议。好消息是 bridge 的注入点在**模板**里、由我们控制，且 §7.4 的错误回传正好复用同一条通道 —— 一次建设两处受益。

### 7.6 诚实的边界

三层做完，**「能跑起来」有保障，「效果对不对」没有** —— 样式错位、布局不合设计意图、组件选型不当，机器判断不了，只能设计师看。

**目标不是「100% 一次通过」，而是「失败必然被捕获，且 agent 能自己修」。** 这个目标能达成，且够用。

---

## 8. skill 结构、归属与内网同步

### 8.1 命名

暂定 **`fastui-vue-creator`**（对仗参考实现 `ict-component-creator`：`<域>-<技术栈>-<动作>`）。

**用英文 kebab-case，不用中文名** —— skill 名同时是目录名和调用标识，中文在内网 Windows 下的编码风险不值得冒（内网终端已出现过中文注释乱码）。名字里刻意不含 `page` / `component`，因为产物粒度由设计师的提示词决定，工程侧不预设。

待产品确认；改名只需动 §8.2 的目录名和 SKILL.md 的 frontmatter。

### 8.2 组件 skill 内嵌，用户只调我们这一个

fastui 那三份（`fastui-vue-skill` / `lake-code-example` / `lake-style-skill`）**原样包进本 skill 的 `vendor/`**，用户侧只有一个入口。

```
fastui-vue-creator/                    ← skill 包，几 MB（体积几乎都在 template 与 vendor）
├─ SKILL.md                            ← 工作流 + 硬约束（只写 views/<页面名>/、编译不通过不算完成）
├─ scripts/                            ← §5 的脚本（第一版四个，见 §0.1）
│   ├─ ensure-env.mjs  new-session.mjs  verify.mjs  setup-env.mjs
│   ├─ install/install.ps1  install/install.sh
│   └─ lib/                            ← result / paths / hash / port / link / compile
├─ references/
│   └─ env.manifest.json               ← requiredEnvVersion + manifestUrl（不含环境本体）
├─ template/                           ← ★ 内网资产：脚手架模板（外网仓是 PLACEHOLDER.md）
└─ vendor/                             ← ★ 内网资产：原样嵌入,我们不改内容
    ├─ fastui-vue-skill/
    ├─ lake-code-example/
    └─ lake-style-skill/
```

> `template/` 在 skill 包里（v7 定，§4.4.1）—— 它与 `scripts/`、`SKILL.md` 里内联的 golden example 强耦合，必须同版本分发。v4 时代这张图里没有它，那时的设想是 template 走内网托管，已作废。

**边界**：`vendor/` 里的内容**我们不决策、不修改、不重组**（是否合并成一份是组件 skill 维护方的事）。他们更新，我们整目录替换同步。

> **绝不把环境包塞进 skill 目录** —— 否则每调一次提示词就要重新分发数百 MB。skill（几十 KB，跟提示词调优走）与环境包（数百 MB × 平台数，跟 fastui 版本走）更新频率完全不同，必须分开分发。

### 8.3 外网仓只放外网能维护的部分，内网资产留占位

`template/` 和 `vendor/` 都是**内网资产**（脚手架来自内网、三份组件 skill 也只在内网），按 §8.4 的单向约束进不了外网仓。所以外网仓里它们是占位目录：

```
<文档仓>/skills/fastui-vue-creator/
├─ SKILL.md                          ← 外网维护 ✅
├─ scripts/                          ← 外网维护 ✅（第一版：ensure-env / new-session / verify / setup-env + 两版安装脚本）
├─ references/env.manifest.json      ← 外网维护 ✅（requiredEnvVersion + manifestUrl）
├─ template/
│   └─ PLACEHOLDER.md                ← 占位：说明从内网哪里取、放什么、怎么校验
├─ vendor/
│   └─ PLACEHOLDER.md                ← 占位：说明三份组件 skill 从内网哪里取
```

**组装在内网做**，`scripts/assemble.mjs` 负责（也可手工，但脚本化更可靠）：

| 步骤 | 动作 |
|---|---|
| ① | 从 GitHub 拉外网部分（`SKILL.md` / `scripts/` / `references/`） |
| ② | 用内网托管的 `template/` 覆盖占位 |
| ③ | 用内网的三份组件 skill 覆盖 `vendor/` 占位 |
| ④ | 校验（任一不过即 `RESULT: FAIL`）：<br>• 占位文件 `PLACEHOLDER.md` 必须已消失<br>• `template/package.json` 与 `yarn.lock` 存在<br>• `vendor/` 三个子目录齐全<br>• `template/packages/portal/turboui.config.js` 里 `OCTO_DEPS` 与 `OCTO_PORT` 均出现（§2.2 三处注入没做就是废的）<br>• `template/…/src/views/_example/index.vue` 存在，且其内容与 `SKILL.md` 里内联的 golden example **一致**（§7.2）<br>• `template/…/src/main.vue` 引用的是 `./views/index.vue`（§3.4 改造 2） |


**`ensure-env` 必须能检出"占位未被填充"并响亮失败** —— 否则会退化成"skill 装上了但一跑就报莫名其妙的找不到文件"。这是最容易漏、也最容易误判成代码 bug 的一种状态。

#### 组装怎么做（手工，不写脚本）

**组装说明放本 spec，不放进 skill 包** —— skill 是生产包，凡不是设计师使用场景要用到的东西都不进去。
组装也**不需要脚本**：本地路径每次都不一样，一个参数化脚本换不来比"复制两个目录"更省的事。

**① 填 `template/`** —— 内网脚手架工程的全部内容，**排除根目录的 `node_modules/`**：

```powershell
# 内网 Windows / PowerShell
$src = "D:\path\to\portal-web"
$dst = ".\skills\fastui-vue-creator\template"
robocopy $src $dst /E /XD "$src\node_modules" "$src\packages\portal\dist" ".git" /XF "yarn-error.log"
```

> ⚠️ **`packages/portal/node_modules/` 要保留** —— 只有 735 字节（`.bin/turbo-ui-cli-service`），
> yarn workspaces 把其余全 hoist 到根了，它是模板代码的一部分（§2.3）。排除只针对**根目录**那个。

**② 填 `vendor/`** —— 三份组件 skill 整目录拷进去，内容不改：
`vendor/fastui-vue-skill/`、`vendor/lake-code-example/`、`vendor/lake-style-skill/`

**③ 删掉两个 `PLACEHOLDER.md`**

**④ 自检** —— 跑一次 `ensure-env.mjs`，它的前两条检查正好覆盖组装结果：

| 输出 | 含义 |
|---|---|
| `SKILL_NOT_ASSEMBLED: … PLACEHOLDER.md 仍是占位文件` | ③ 没做 |
| `SKILL_NOT_ASSEMBLED: template/ 缺少 package.json 或 yarn.lock` | ① 拷贝失败，或拷错层级（`template/` 下应直接是 `package.json`，不能再套一层工程目录） |
| `ENV_MISSING: 共享池未安装 …` | ✅ **组装成功**，接着跑安装脚本 |

**什么时候要重新组装**：`scripts/` 或 `SKILL.md` 变了 → ①不用做，重新上架即可；模板变了 → 重做①；
三份组件 skill 变了 → 重做②。依赖版本变了（`yarn.lock` 变）→ 重做① + 上架，设计师端 `ensure-env`
会检出 `ENV_OUTDATED` 并自动走 `install --upgrade`（§5.2.2）。

### 8.4 内网同步：单向

| 方向 | 允许 |
|---|---|
| 外网 → 内网 | **代码可经 GitHub 完整同步**（skill、脚本、references 全走这条） |
| 内网 → 外网 | **只能片段式或截图**，不能大批量带出 |

两个推论必须落到实现上：

1. **环境包只能在内网构建、内网托管**（§4.3）—— 它既大又是内网依赖，走不了 GitHub
2. **脚本的错误输出必须自包含、可截图** —— 不能设计成"把整个日志文件发出来给我看"的排查方式。单条 `RESULT: FAIL | <原因>` 要能独立说明问题，日志落盘只作为本机深挖用

### 8.5 skill 放文档仓，不进 UXAI 代码仓

- UXAI 仓只提交 insight 代码（见 CLAUDE.md）
- 参考实现 `ict-component-creator` 同样不在任何代码仓，是独立可分发目录
- **单给脚本没有意义** —— agent 需要知道什么时候调、参数是什么、失败怎么办，这些是 SKILL.md 的内容

位置：文档仓新建 `skills/` 目录。

### 8.6 UXAI 仓要做的五件事（Design 模块，不是 skill）

skill 管不了常驻进程，也画不了按钮。这五件必须在 UXAI 侧做。

> **四件都必须是增量式兼容改造，不得影响 Design 现有功能。** 具体到每一项：② 只加 gate 不改 srcdoc 路径上的任何既有行为；③ 除了退出钩子里追加一行，其余全是新文件与新 handler；① 是 ActionBar 新增一个按钮；④ 是新增一个 message 监听。任何一项若发现必须改动既有代码路径才能做成，停下来先对齐，不要顺手改。

| # | 事项 | 状态 |
|---|---|---|
| ③ | **dev server 由宿主起并持有** | ✅ **已实现并内网实测通过**（Windows + macOS arm64 各一遍过），方案见 §8.6.1；UXAI PR #801 |
| ① | **导出代码包按钮** | **下一步做**。链接改回工程根之后（§2.5），这是设计师拿到干净代码的**唯一正确路径** —— 不做的话他右键压缩会得到 1GB。落点已勘查，见 §8.6.2 |
| ② | **external URL tab 的编辑类功能 gate** | 先查现状，可能不用改（内网预览未崩），判据见 §8.6.3 |
| ④ | **运行时错误 bridge 的监听端** | 做 §7.4 第三层时补，协议见 §8.6.4。模板侧已内置并实测通过，宿主侧现在空转 |
| ⑤ | **预览就绪前不要挂 iframe** | 重启后点卡片白屏、切走再切回就好 —— iframe 早于 dev server 就绪且不会自己重试。落在与 ① 同一层，建议一起做，见 §8.6.5 |

**预览本身不需要新增 renderer**（§7.5）—— 现有 `text/link` → external URL iframe 链路直接可用，已内网实测。

---

#### 8.6.1 dev server 由宿主起并持有（③ 的完整方案）

##### 为什么必须是宿主

内网实测（2026-09-06）：`verify.mjs` 用 `detached` 起的 dev server，**脚本一退出就没了**（`Get-Process -Id <pid>` 无返回）。根因在上游代码里 —— `packages/opencode/src/tool/shell.ts:296`：

```ts
if (process.platform === "win32" && Shell.ps(shell)) {
  return ChildProcess.make(shell, [...], { detached: false })   // ← Windows 下有意不脱离
}
return ChildProcess.make(command, [], { detached: process.platform !== "win32" })
```

整条链 `opencode → PowerShell → verify.mjs → dev server` 在同一个 Job Object 里，shell 工具收尾时整棵树被清掉。而 shell 工具的参数只有 `command / cwd / env / timeout / shell`，**没有 `background`**（不像 Claude Code 的 `run_in_background`）。

**主流 agent 的做法都是「让一个长命进程持有它」，不是「让子进程脱离」。** Octo 缺的正是这个能力，而 Electron 主进程正好是那个长命进程。

> **附带解决的体验问题**：现在每次起服务都弹一个空的 node 窗口。这不是配置问题，是父进程类型决定的 —— PowerShell 是 console 应用，子进程继承 console；**Electron 主进程是 GUI 应用，根本没有 console**，`spawn(..., { windowsHide: true })` 直接就没窗口。

##### 时序

```
new-session.mjs
  └─ 写 .octo/<sid>/.octo-fastui.json { projectDir, port, depsDir, envDir, … }
        │
        ▼
pages/make 侧监听到这个文件(或在建会话的同一处主动触发)
  └─ IPC → 主进程 spawn dev server(持有它)
        └─ 写 .octo/<sid>/.devserver.json { port, pid, projectDir, logPath, startedAt }
        └─ stdout/stderr → .octo/<sid>/devserver.log
        │
        ▼
[模型写代码]        ← 这段时间 webpack 已经在编译 _example 并进入 watch
        │
        ▼
verify.mjs --port=<port>
  └─ 只做编译判定:读 devserver.log,按 §5.5.1 的三条规则采信最后一轮
  └─ 顺带跑漏 import 静态检查(§7.2)
        │
        ▼
<artifact type="text/link">http://127.0.0.1:<port></artifact>
```

**免费的性能优化**：别等模型写完再起服务。`new-session` 一写出状态文件就起 —— 那时 `views/` 下只有 `_example`，编译很快；**模型写代码的几十秒里 webpack 已经编完在 watch 了**。等 `verify` 时只剩一次增量编译（几秒），而不是干等 1–3 分钟的首次编译。首次编译与模型写代码并行。

##### 文件契约（skill 侧已固定，宿主按这个读写）

| 文件 | 谁写 | 谁读 | 内容 |
|---|---|---|---|
| `.octo/<sid>/.octo-fastui.json` | `new-session` | **宿主** | `{name, projectDir, writeDir, port, envDir, depsDir, createdAt, updatedAt}` |
| `.octo/<sid>/.devserver.json` | **宿主** | `verify`（回退路径） | `{port, pid, projectDir, logPath, startedAt}` |
| `.octo/<sid>/devserver.log` | **宿主**（子进程 stdio 重定向） | `verify` | dev server 原始输出 —— **编译判定的唯一数据源** |

> ⚠️ **日志路径必须是 `.octo/<sessionId>/devserver.log`**，不能换地方 —— `verify` 靠读它做编译判定，路径不对就只能超时。

##### 启动参数（照抄，四个点都不能少）

```ts
const portalDir = join(state.projectDir, "packages", "portal")
const cli = join(state.depsDir, "@turboui", "turbo-ui-cli-service", "bin", "turbo-ui-cli-service.js")
const nodeBin = process.platform === "win32"
  ? join(state.envDir, "node", "node.exe")
  : join(state.envDir, "node", "bin", "node")

const logFd = openSync(join(sessionDir, "devserver.log"), "a")
const child = spawn(nodeBin, [cli, "serve", "--replace-policy=dev", "--target=esnext"], {
  cwd: portalDir,
  env: { ...process.env, OCTO_DEPS: state.depsDir, OCTO_PORT: String(state.port) },  // ① 缺一不可
  windowsHide: true,                                                                  // ② 无窗口
  stdio: ["ignore", logFd, logFd],                                                    // ③ 日志落盘
})
```

| # | 点 | 不做会怎样 |
|---|---|---|
| ① | `OCTO_DEPS` + `OCTO_PORT` 两个都传 | 缺 `OCTO_DEPS` 则 copy-webpack-plugin 找不到拷贝源，`Failed to compile`（§2.2）；缺 `OCTO_PORT` 则回落 8081，多会话必撞 |
| ② | `windowsHide: true` | 弹空的 console 窗口 |
| ③ | stdio 重定向到那个固定路径 | `verify` 没有数据源，只能 `COMPILE_TIMEOUT` |
| ④ | `app.on("will-quit")` 里全 kill + 软上限 3 个 | webpack dev server 每实例数百 MB，设计师做几个页面就把机器拖垮 |

**不做精细的挂载/卸载回收** —— 设计师来回切 tab 时反复重启 webpack 体验很差（§6.3）。

##### 改动清单

| 文件 | 改动 | 性质 |
|---|---|---|
| `packages/desktop/src/main/fastui-devserver.ts` | 新文件 ~120 行：`ensure` / `stop` / `stopAll` + 内存 `Map<sessionId, {pid, port}>` + 软上限 | **新增** |
| `packages/desktop/src/main/ipc.ts` | +2 个 `ipcMain.handle`（~12 行） | 追加，不动现有 handler |
| `packages/desktop/src/preload/{index,types}.ts` | +2 个方法与类型（~10 行） | 追加 |
| `packages/desktop/src/main/index.ts` | `will-quit` 回调里 **+1 行** `stopAll()` | ⚠️ **唯一碰既有代码处**（追加一句，不替换） |
| `packages/app/octoapp/context/platform.tsx` | 类型透传（~4 行） | 追加 |
| `packages/app/octoapp/pages/make/index.tsx` | 建会话处（约 `:1603` 写 `.octo/<id>/outputs/.gitkeep` 那一带）挂钩（~30 行） | 追加 |

约 180 行，6 个文件，**5 个是纯追加**。

> `sidecar.ts` 是主进程管长命子进程的现成参照，但它用 `worker_thread`（`parentPort`）而非 `spawn`，逻辑不能直接复用 —— 可借鉴的是它的形态：start / stop / 退出清理 / 错误上报。

##### skill 侧对应的降级

`verify` 的启动策略按可靠性排序：

1. **`--port=<n>` 接管** —— 显式指定用哪个端口上已有的服务
2. **读 `.devserver.json` 复用** —— 宿主起好的那个
3. **等宿主启动（最多 15 秒）** —— 宿主监听状态文件、异步 spawn，这里给它时间；**不等的话两边会各起一个 dev server 打架**
4. **自己 spawn（回退）** —— 输出 `[fallback]` 提示，说明这条路在 Windows 上活不过本次调用

第 4 条保留是为了脱离宿主也能调试（内网调脚本、外网 V0），它在 Windows 上失效属于**已知的模式差异，不是 bug**。

##### 平台差异：mac 同样需要宿主，理由不同

| | Windows | macOS |
|---|---|---|
| skill 自己 spawn 的进程 | **活不过本次调用**（Job Object 连坐） | 能活（`shell.ts` 在非 win32 下用 `detached: true`，Unix 也没有 Job 连坐） |
| 空的 node 窗口 | 有（PowerShell 是 console 应用，子进程继承 console） | 无 |
| 要不要宿主接管 | **必须** —— 否则起不来 | **同样要** —— 不是为了"活下来"，是为了**有人回收**：那些进程会活到没人管，设计师做几个页面就攒一堆常驻 webpack，每个数百 MB |

**宿主方案两个平台通用，不做平台分支。**

> ⚠️ `pages/make/` 与 `packages/desktop/` 属 Design 模块，改动需按 [collab-pr-protocol](../../collab-pr-protocol.md) 走。
> **若发现任何一项必须改动既有代码路径才能做成，停下来先对齐** —— 尤其 `index.tsx` 有 5600+ 行，在里面加东西要克制。

---

#### 8.6.2 导出代码包按钮（① 的落点与契约）

> **落点已勘查（2026-09-07），实现时不用重找。**

##### 不要改 `action-bar.tsx`，注册一个 subtype handler

`action-bar.tsx` 有 1115 行且已有完整的下载链路，但**它有扩展点**：

```ts
// action-bar.tsx:533
const handler = getSubtypeHandler(props.tab.subtype)
if (handler?.handleDownload) { … }
```

```ts
// subtype-handlers/types.ts:78
handleDownload?: (ctx: SubtypeHandlerContext, option?: string) => Promise<boolean | void>
// :89 声明且长度 > 1 时，action bar 渲染「下载」下拉按钮；每项 value 作为 option 传入
```

预览 tab 的形态是 `{ type: "html", subtype: "url" }`（§7.5），所以**给 `url` 这个 subtype 注册一个 handler、实现 `handleDownload` 即可，`action-bar.tsx` 零改动**。注册表在 `pages/make/utils/subtype-registry`。

##### 前端不要自己打包

`export-zip.mjs` 已经处理了两件前端不容易做对的事：**用 `lstat` 跳过链接**（工程根的 `node_modules` 是指向共享池的链接，跟随就把 1GB 打进去）、**置 ZIP 的 UTF-8 flag**（不置的话中文产物名在 Windows 解压全是乱码，而内网中文命名概率很高）。

所以走 IPC 调脚本，与 §8.6.1 的 `fastui-devserver` 同一个模式：

```ts
// 主进程新增,与 fastui-devserver.ts 平级
ipcMain.handle("fastui-export-zip", (_e, sessionDir: string) => { … })
//   → spawn(<envDir>/node, [<skillDir>/scripts/export-zip.mjs, `--session-dir=${sessionDir}`])
//   → 解析 stdout 的 RESULT: / ZIP_PATH: 契约行(§5.1.1)
//   → 返回 { ok, zipPath, bytes } 给渲染进程
```

`skillDir` 与 `envDir` 从 `.octo/<sid>/.octo-fastui.json` 读（`envDir` 字段已有；`skillDir` 需要 `new-session` 补写一个字段，或由主进程按 `.octo/skills/fastui-vue-creator` 推导）。

##### 拿到 zip 之后

`handleDownload` 返回后，用 `getDesktopApi()` 的现成能力把文件给用户（`saveFilePicker` + 复制，或 `showItemInFolder`）—— `action-bar.tsx` 里 `downloadBlob` / `DownloadCancelledError` 那套是给内容型 tab 用的，工程 zip 已经在磁盘上，不必再走 blob。

#### 8.6.3 external URL tab 的编辑功能 gate（② 的判据）

**先查，可能不用改。** 内网实测预览没崩，说明要么已经 gate、要么那些功能在 external 分支下根本没被触发。

查法：`html-renderer.tsx` 里 `shouldUseExternalUrl()`（约 `:853`）为真的分支，看 `InspectPanel` / `ManualEditPanel` / `DrawOverlay` / comment 这几处是否已经被条件挡住。它们都读 `iframe.contentDocument`，而 `127.0.0.1:<port>` 与宿主**跨源**，直接访问会抛。

若确实没 gate：**只加条件、不改 srcdoc 路径上的任何既有行为**。srcdoc 是 Design 现有的主路径，任何回归都不可接受。

#### 8.6.4 运行时错误 bridge 的监听端（④ 的协议）

模板侧已内置并**内网实测通过**（window 级与 promise 级都收到了消息），宿主侧现在不监听、空转。协议是固定的：

```js
window.parent.postMessage({
  channel: "octo:runtime-error",
  type: "vue" | "window" | "unhandledrejection",
  message, stack,
  component,      // type=vue 时有
  info,           // type=vue 时有,Vue 给的位置,如 "render function"
  source, line, col,   // type=window 时有
  at,             // Date.now()
}, "*")
```

宿主侧要做的是：`window.addEventListener("message")` 过滤 `channel === "octo:runtime-error"`，然后把错误喂回 agent。

**这条通道的价值已经被实测证明**：模型漏 import 组件时编译通过、页面白屏，浏览器 console 里是 `Failed to resolve component: el-table` —— `verify` 的静态检查能抓到大部分（§7.2），但抓不到的那些正是要靠这条通道。

> ⚠️ 别忘了 iframe 是跨源的，`event.origin` 会是 `http://127.0.0.1:<port>`。过滤时按 `channel` 字段判断即可，不要按 origin 白名单（端口每个会话都不同）。

---

#### 8.6.5 重启后预览白屏：iframe 早于 dev server 就绪（⑤ 新增）

**现象**（2026-09-07 内网实测）：重启 agent 后点预览卡片是白屏，**但切到「文件管理」再切回该 tab 就正常渲染了**。

**这个"切走再切回就好"恰恰是判据** —— 它说明 dev server 本身是好的（否则切回来也不会好），问题只在**加载时机**：

```
重启 agent
  → params.id effect 触发 → arm → ensure → spawn dev server
  → webpack 开始首次编译（几秒到 1–3 分钟）
  → 与此同时用户点开预览卡片
  → iframe src = http://127.0.0.1:<port> → 此刻还没 listen → ERR_CONNECTION_REFUSED → 白屏
  → iframe **不会自己重试**，就一直白着
  → 切走再切回 = iframe 重新挂载 = 重新请求 → 这时通了 → 正常
```

**修法**：external URL 分支下，端口未就绪时不要直接把 `src` 挂上去。§7.5 已经查明 `externalUrl()` 会把 `refreshKey` 拼成 `?_octo_v=N`，前端**已有现成的刷新机制**，所以只需要：

1. 打开 external URL tab 时先探测端口（或直接向宿主要一次 `ensure`，它会返回 `port`）
2. 未就绪则显示"正在准备预览环境…"，并轮询（1 秒一次、上限与首次编译同量级）
3. 通了之后 bump `refreshKey` 让 iframe 加载

**不要只加 `iframe.onerror` 重试** —— 跨源 iframe 的加载失败未必触发 `onerror`，拿不到可靠信号；主动探测端口才是确定的判据。

> 这条与 §8.6.2（导出按钮）落在同一层（subtype handler / html-renderer 的 external 分支），建议一起做。

## 9. 验证

> **不攒到最后统一验证。** 四个阶段各自独立可验，前一阶段不过不进下一阶段。

### 9.1 外网可做（本地 Mac）

脚本逻辑与跨平台机制不依赖内网组件库，可用任意公网 npm 工程替代验证：

- **V0-a 端口探测与重试**：并发起 5 个进程抢同一起始端口，断言各自拿到不同端口、无 `EADDRINUSE` 逃逸
- **V0-b symlink 布局**：任取一个 vue3 工程，把 `node_modules` 移到别处建 symlink，断言 `dev` 正常
- **V0-c 脚本契约**：各脚本的 `RESULT:` 输出、幂等性、失败路径
- **V0-d 交付包干净**：`export-zip` 产出的 zip 里任何层级都无 `node_modules`、无链接（v12 起产物目录本身有工程根那一个链接，干净的是 zip）
- **V0-e 回退语义**：不设 `OCTO_DEPS` / `OCTO_PORT` 时，配置回退到原路径与 8081
- **V0-f ZIP 中文文件名**：产物名与页面名都用中文，断言 UTF-8 flag 已置、CRC 校验通过、包内无 `node_modules`、链接被跳过（v12 实测通过）
- **V0-g 编译判定不 flaky**（v8 新增）：连续快速改两次文件，断言 `verify` 采信的是**最后一次**编译结果而非中间态；再断言"复用已跑的 dev server"时不会读到上一轮的成功记录（§5.5.1）
- **V0-h 升级链路能被触发**（v8 新增）：改动 `<skillDir>/template/yarn.lock` 后重跑 `ensure-env`，断言返回 `ENV_OUTDATED` —— 这条直接验的是 §5.2.1 那个跨边界比对，比错了整条升级链是死的

### 9.2 内网验证

**阶段 1 — 环境包**（不涉及 AI）
1. 干净机器上按 §4.1 走完五步，**全程无管理员权限、无 sudo、无人工介入**
2. `ensure-env` 探针通过
3. **`flushdns` + 断网**后重跑，页面仍能渲染 lake 组件 ✅ *（已验证）*
4. Windows / macOS 各做一遍

**阶段 2 — 会话布局与端口** ✅ *（核心机制已于 2026-09-03 内网实测通过；dev server 宿主化于 2026-09-07 在 Windows + macOS arm64 各跑通一遍）*

> **两个平台尚未覆盖的组合**：① **完全没装过 node 的机器** —— 前两次实测的机器上都有系统 node，`install` 脚本下载 portable node 那条路径没被真正走过；② **Intel 芯片的 Mac**（`darwin-x64`）—— manifest 里有这个平台的包，但没人验过。两条都不阻塞当前进度，但**首装体验正是设计师会遇到的那条路径**，补验优先级不低。
1. 依赖链接建在会话根、产物目录零链接，直连 cli-service 启动，webpack 跨两层解析成功 ✅
2. `OCTO_PORT` / `OCTO_DEPS` 均生效（端口落在指定值、copy-webpack-plugin 从共享池取源）✅
3. `new-session` 建三个会话，各自独立端口并行运行，互不干扰
4. 手动占住起始端口，断言自动落到下一个可用端口

**阶段 3 — 生成闭环**
1. agent 写入 `views/<页面名>/index.vue` 并改 `views/index.vue` → 编译通过 → 预览可见（`<artifact type="text/link">http://127.0.0.1:<port></artifact>`）
2. **故意注入一个编译错误**（错的 import 路径），断言 `verify` 捕获、错误原文含 file:line 回到 agent、agent 自行修复后通过
3. **故意注入一个运行时错误**（prop 类型错误），断言第三层捕获

**阶段 4 — 交付**
1. `outputs/<产物名>/` 整目录压缩 < 1MB，**不含任何 node_modules、无任何链接**
2. `export-zip` 与预览器导出按钮产出一致
3. 在一台**只有脚手架、没跑过我们任何脚本**的机器上解压，`yarn install && yarn serve`（**不设 `OCTO_DEPS` / `OCTO_PORT`**，验证回退语义），页面渲染与预览一致

---

## 10. 待确认与遗留

| # | 问题 | 影响 | 状态 |
|---|---|---|---|
| ~~Q1~~ | ~~预览容器接法~~ | — | ✅ **已定**：走现有 `text/link` → external URL iframe 链路，预计零改动（§7.5）。两处细节实现时按实际情况处理，原则是**不影响既有业务逻辑** |
| ~~Q2~~ | ~~会话落点~~ | — | ✅ **已确认**：Design 现行是 `.octo/<sessionId>/outputs`（`pages/make/index.tsx:2515`），沿用；依赖链接建在其父级 `.octo/<sessionId>/node_modules`，见 §3.2 |
| ~~Q3~~ | ~~环境变量穿透 lerna~~ | — | ✅ **已验证**（2026-09-02）：可穿透；模板 `turboui.config.js` 已改为 `port: Number(process.env.OCTO_PORT) \|\| 8081` |
| **Q4** | fastui / 组件库升级后的流程 —— 谁触发重打、怎么通知设计师升级 | §5.2.2 已定死机制（**不可变环境，只重打不 patch**），剩下的是与 fastui 团队约定「发版通知」这个人的流程 | 机制已定，**流程待与 fastui 团队约定**（不阻塞实现） |
| ~~Q5~~ | ~~`.bin` shim 相对路径指向~~ | — | ✅ **已验证**：指向仓库根，§2.2 成立 |
| ~~Q6~~ | ~~产出形态（组件 vs 页面）~~ | — | ✅ **已定**：工程侧不预设，聚合入口用 tab 切换兼容两者（§3.3） |
| ~~Q7~~ | ~~依赖外置（链接建在工程之外）~~ | — | ✅ **反转为最终方案**：第一次试失败的真正原因是启动路径而非解析能力；绕过 yarn+lerna 后实测成立，见 §1.6 / §2 |
| ~~Q8~~ | ~~内网同步流程~~ | — | ✅ **已定**：见 §8.3 / §8.4 |
| **Q9** | UXAI 侧三件事（§8.6：导出按钮 / external URL tab 编辑类功能 gate / dev server 生命周期）的排期与归属 | 属 Design 模块，需走 [collab-pr-protocol](../../collab-pr-protocol.md) | **待与 Design 负责同事对齐**（不阻塞 skill 侧实现） |

### 明确不在本 spec 范围

- **二次编辑回环**（选中元素 → 属性变化回调 → 改 `.vue` → 重新编译）。已有讨论结论：必须区分「组件元素」与「纯 html 元素」，且组件内部 DOM 应上浮到最近的组件实例——否则会滑向生成 `:deep()` 覆盖 hack，让交付物变成开发不愿接的东西。属性面板第一版不做全量 props/slots（103 个组件的 schema 维护成本远超收益），只显示组件名 + 已写的 props + 自然语言输入框。**这些留待基础生成闭环跑通后另起 spec。**
- **`vendor/` 里三份组件 skill 的内容与组织**（是否合并、怎么拆 references）——归组件 skill 维护方，我们只做整目录同步。
