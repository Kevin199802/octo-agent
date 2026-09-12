# learning/ — 深度学习文档

跟 architecture / development / specs / adr 的区别:

| 目录 | 回答的问题 | 风格 |
|---|---|---|
| `architecture.md` | 我们的系统**长什么样** | 精炼、当前事实、给同事快速对齐 |
| `development.md` | 我**怎么操作**(命令、调试、打包) | 操作手册,粘命令就用 |
| `specs/` | 某个功能**要做成什么样**(验收标准) | 一项一规格,可勾选 |
| `adr/` | 某个决策**为什么这么选** | 一项一记录,不可变 |
| **`learning/`** | **某个事物内部到底怎么运作的** | **深度解释,允许长,带例子,允许冗余** |

learning 文档面向"对该领域不熟悉、想完整理解原理"的读者。可以反复读、可以跳读,内容做到足够详尽。

## 目录

按从基础到进阶顺序读:

1. [opencode-internals.md](opencode-internals.md) — opencode 后端工作原理:HTTP 路由、SSE 事件、Part 类型、SQLite 表、Provider 接入
2. [agent-mental-model.md](agent-mental-model.md) — Agent 是什么、agent loop、primary vs subagent、多 agent 三种模式
3. [skill-and-mcp.md](skill-and-mcp.md) — Skill 与 MCP 区别与联系、MCP 三种传输、Skill 包结构、安全模型
4. [provider-protocols.md](provider-protocols.md) — Anthropic / OpenAI / Google 协议差异、thinking/reasoning 怎么传、国内网关兼容性
5. [context-and-memory.md](context-and-memory.md) — 上下文压缩、`AGENTS.md` 项目记忆、共享记忆设计
6. [opencode-agent-system.md](opencode-agent-system.md) — Agent 配置 schema、加载流程、Tools/Skills/MCP 关系、前端切换机制 **(M2 必读)**
7. [opencode-ui-composition.md](opencode-ui-composition.md) — `@opencode-ai/ui` vs `@opencode-ai/app` 角色、Provider 体系、形态 B 实施细节 **(M2 必读)**
8. [tools-and-permissions.md](tools-and-permissions.md) — 内置工具清单（11 个）、MCP 工具接入、agent 工具白名单配置、权限规则（allow/ask/deny）
9. [agent-deploy.md](agent-deploy.md) — 注册 vs 不注册的区别、config 版本化写入机制、Electron 打包后用户侧如何自带配置
10. [mcp-api-integration.md](mcp-api-integration.md) — 内网 API 对接 MCP 的完整方案（路径 C）：UXR 服务加 /mcp 路由的实现、联调验证流程
11. [opencode-db-and-storage.md](opencode-db-and-storage.md) — opencode 数据持久化全貌:SQLite 事务 / WAL / Drizzle schema-as-code / migration journal + snapshot.json / channel-aware DB / JsonMigration / storage + snapshot + tool-output 三兄弟,与 Rails/Prisma/Django/Flyway 对比
12. [client-event-routing-by-directory.md](client-event-routing-by-directory.md) — 前端按目录分发实时事件:globalSync + per-directory child store / directory·worktree·project 三层模型 / `event.directory` = worktree 根 /「页面数据层目录 vs 事件投递目录」错位导致白屏(Insight 锚点案例)/ 排查方法论 + octoapp 自有 context 大坑
13. [plugin-hooks-url-injection.md](plugin-hooks-url-injection.md) — opencode 插件系统:`Plugin` 函数 / `INTERNAL_PLUGINS` vs config 插件 / `tool.execute.before` 钩子在哪触发(MCP 也触发)/「就地改写 output.args」契约 / 用「纯 handle→url 解析器」插件把精确 S3 URL 注入工具(两个输入源:session 区块=权威 url 表、args=要替换的 handle)/ 踩坑与演进:顺序号 handle 跨 turn 撞号、单桶全量覆盖错注、MCP 工具名带 `uxr-tool_` 前缀、插件日志在 server 进程
14. [rag-chat-integration.md](rag-chat-integration.md) — 把内网知识库 RAG 接进 chat:RAG 数据流 / 三种触发策略(agentic·前置·路由·显式)/「内网模型弱」如何否掉纯 agentic /「噪音」是什么 / MCP vs HTTP 与触发耦合 / 三套可落地组合 / 业界标准呈现(内联答案+来源卡片)/ 待定问题清单
15. [happy-dom-and-indexeddb.md](happy-dom-and-indexeddb.md) — 测试用的假浏览器(happy-dom,缺 IndexedDB)vs 真落盘存储(IndexedDB 有实体文件、跨重启);为何 debug-observer 阶段2 持久化只能人工验证、降级路径才能自动测
16. [electron-app-name.md](electron-app-name.md) — Electron app 的四种"名字"(运行时 `getName` / 打包 `productName` / `appId` / npm `name`)、channel 机制、为何 `~/Library/Logs` 有多个目录、怎么定位当前日志在哪
17. [build-channel-injection.md](build-channel-injection.md) — 多渠道桌面应用如何把 channel 一致贯穿 build+package:渠道的四个消费者(prebuild/predev·electron-vite·electron-builder)/ 业界五类做法对比(shell 内联·cross-env·env-file·CI env·--mode·拆 config·产物 marker)/ 为何 opencode 原生 GitHub Actions+env 本地照搬不了 / 我们的 cross-env 决策 / 五个坑(win shell 失效·bun --env-file 不执行·生命周期钩子只认精确名致 prod 包带 dev 图标·bun 自动加载 .env 污染·三层优先级)
> 配套速查见 [env-vars-and-build-modes.md](env-vars-and-build-modes.md)(命令/文件对应表 + 提交规则)
18. [rag-mental-model.md](rag-mental-model.md) — RAG 心智模型:检索+生成两段 / 一堆 chunk 怎么变成带出处问答 / 引用下标 [1][2] 与参考文件列表怎么来(prompt 编号 + 客户端解析回源)/ 现有数据结构是否支持(支持,TOPIC_TITLE 不可当标题是唯一坑)/ 业界是不是"检索接口+LLM 生成"(是,两变体)/ 端到端走一遍
19. [session-category-enum-400-crash.md](session-category-enum-400-crash.md) — 事故复盘:一个 `category="subagent"` 越界值炸掉整个会话列表。effect HttpApi 整列响应编码 / `Schema.Union` 严格枚举 / `fromRow` 的 `as` cast 骗过编译期 / "半截改动"(写入侧类型改了、响应 schema 漏改)/ 空 body 400 指纹 / 前端 `createResource` 无兜底致整页崩 / "db 脏行" vs "WAL 物理 malformed" 两种故障别混 / server 错误日志在 `opencode/log/` 不在 `main.log`
20. [file-card-depends-on-current-turn-tool-call.md](file-card-depends-on-current-turn-tool-call.md) — insight 文件卡片只渲染"本轮工具返回":模型凭上下文跳过 `get_task_result` 调用 → "详见下方文件卡片"话术与界面脱节;prompt 承诺 UI 存在的话术必须条件化
21. [mock-server-patterns.md](mock-server-patterns.md) — mock server 两种模式:Vite 插件 middleware(renderer 侧,自动降级)vs 独立进程(Node.js sidecar 侧,显式配置);选型依据、对比表、MSW 定位说明
22. [cherry-pick-feature-to-two-branches.md](cherry-pick-feature-to-two-branches.md) — 一份自包含功能同时进两条分叉分支(main 打包 / dev 给测试):cherry-pick vs merge 何时干净何时别用 / 冲突只看"目标分支动没动过那几个文件"(每个 base 各验一遍)/ cherry-pick 产生重复 SHA 的副作用 / both-add 冲突两边都留 / git worktree 旁路不污染当前工作区 / feature 分支当一次性资源:auto-delete + fetch --prune + worktree prune 的清理节奏
23. [file-passing-to-models.md](file-passing-to-models.md) — 文件怎么传给模型/工具:模型 API 不收 File/Blob/磁盘路径 / 三种模式(文本内联·base64-or-url 多媒体·工具引用)/ `FilePart.url` 多态且**组 prompt 时被急切解析**(text→内联、二进制→base64,`prompt.ts:1103-1264`)/ 非多模态 stripMedia 占位 / **图片 base64 不进 token**(走 vision 解码通道,URL 与 base64 的 image token 数相同;曾误写成「170 万 token 装不下」,2026-08-14 修正,ADR-015 决策 2 依据同步换掉)/ **判据别只看两端,要数中间有几跳**(同机 sidecar 那一跳不需要第三方存储,ADR-017 反例)/ insight 三条现状路径 + 终态分流(ADR-015)/「FilePart 喂模型 vs handle 喂工具不可混用」
23. [env-dotenv-override-trap.md](env-dotenv-override-trap.md) — 事故复盘:`release:win` 打 prod 包却连 beta MCP,手动 `build:prod` 却对。根因 = `bun <file>`(release.ts)自动加载 `.env` 进 `process.env` + `loadEnv(prefix="")` 优先级 `process.env > .env.<mode> > .env`,`.env` 业务值**反向盖过** `.env.prod` / 为何 release.ts 中招、`bun run build:prod` 不中招 / 为何 REPORT 不暴露 MCP 暴露 / 解药:环境专属值只放 `.env.beta`/`.env.prod` + `[octo:env]` 构建/启动日志(dev 经 configureServer 避开 clearScreen)
> 与 [build-channel-injection.md](build-channel-injection.md) 坑 4/5 同机制:那篇是 `OCTO_CHANNEL` 被污染,本篇是业务地址变量被污染
24. [resource-accessor-refetch-flashes-global-suspense.md](resource-accessor-refetch-flashes-global-suspense.md) — 排查复盘:Insight"每次发送/生成完整页闪一下初始加载动画"。真凶是会话列表 `createResource` 的 accessor 被在 render(`hasMore`)里读 → `session.updated` 事件触发 refetch → Solid"refetch 重新挂起 Suspense"把最外层全屏 `<Splash>` fallback 顶出来,子树却不卸载(故无重挂、数据不变)/ A/B/C/D 四假设按代价排除的方法论 /「整页像重置但代码无重挂」= 优先查祖先 Suspense / 根治:render 只读镜像信号·`.loading`·`.error`,绝不读 resource accessor
25. [git-pull-merge-vs-rebase.md](git-pull-merge-vs-rebase.md) — `git pull` 三种策略:为何 `--merge` 不存在(`--no-rebase` 才是正确写法)/ merge(菱形历史)vs rebase(线性历史)vs fast-forward-only(只允许前进)机制对比 / 冲突解法 / 何时用哪个 / 全局配置默认策略
26. [turn-level-tool-gating.md](turn-level-tool-gating.md) — turn 级工具 gate:opencode 原生 per-message `tools: Record<string,boolean>`(随 promptAsync 走、存 user 消息、`session/llm.ts resolveTools` 按 `user.tools[k] !== false` 过滤)/ 副作用兼兜底:`prompt()` 把它转成 session.permission 持久化,漏传 = 工具仍隐藏而非暴露 / 两个重名 `resolveTools` 别找错 / agent `mcp` 绑定管"在册"、gate 管"本 turn 可见"(SPEC-INS-017 §3 方案 A 落点)
27. [terminal-proxy-and-corporate-gateway.md](terminal-proxy-and-corporate-gateway.md) — 浏览器/终端两套代理体系为何互不相通 / 产物代理链路(`setGlobalProxyFromEnv`·mac `$SHELL -il` 抓环境·win 继承用户级变量·NO_PROXY 内网豁免·系统证书加载)/ netentsec 网关实测行为(中间人重签·按 UA 拦裸 curl 伪造 503·按域名 TLS 层掐断·浏览器裁决法)/ 各平台 curl 坑(schannel 吊销检查·mac 不读钥匙串·`-s` 吞报错)/ 按信号强弱的排查方法论(超时→407→503 各指向什么)
> 配套操作手册见 [../intranet-proxy-setup.md](../intranet-proxy-setup.md)(纯步骤,给小白粘命令)
28. [agent-tool-configuration-layers.md](agent-tool-configuration-layers.md) — Agent 工具配置全景:七层控制点(注册 / registry 硬编码 gate / agent 定义 permission·mcp·skills / config 覆盖 / session permission / per-message tools / 执行钩子+审批)各自粒度与选型口诀 / MCP 工具"存在"的运行时前提是连接成功(排查三连日志) / 用户级 agent 覆盖丢 fork 私有 `mcp` 字段、session.permission 跨版本残留两大坑 / insight chip 完整工具面案例(含 chip turn 关 task/bash 防弱模型即兴模拟)
29. [hono-vs-effect-httpapi-routing.md](hono-vs-effect-httpapi-routing.md) — 后端路由入门(接上前端路由的既有认知)+ 本仓踩坑:同时有两套后端(传统 Hono 路由 `routes/instance/*.ts` vs 类型化 Effect HttpApi `httpapi/groups+handlers`)/ `dev`·`beta`·`local` 渠道默认只有后者在跑,前者是死代码 / 为什么 `/artifact/list` 能通而照抄它写法的新接口 404 / 新接口该写在哪的判断口诀 / 404 排查方法论(先测源码直跑绕开构建变量,再看响应体指纹,最后才怀疑没重启)/ 锚点案例:SPEC-INS-014 §10 文件管理接口踩坑全过程
30. [electron-embed-web-and-sso.md](electron-embed-web-and-sso.md) — Electron 内嵌 web 页面与 SSO:iframe / `<webview>` / WebContentsView 三方式本质区别与选型口诀(嵌布局内→iframe;webview 永不用)/ 为什么 iframe 里 SSO 结构性必死(登录页 frame-ancestors)/ 四条业界解法对比,选主进程 `webRequest` 网络层注入(资产站零改造、绕过 SameSite/三方 cookie 全部策略)/ 两个误解点名:「系统浏览器 cookie 传不回来」「`cookies.set` 绕不开策略,改头才绕得开」/ 实现四注意:单监听器静默顶替 + 本仓 CORS 改写已占坑 · ACAO `*` × 凭证注入的危险组合 · 注入按来源收窄 · 过期 302 主进程接管(锚点:Design 页平台/项目资产嵌入,ADR-016)
31. [reasoning-output-formats.md](reasoning-output-formats.md) — 思考链输出格式的业界四类规范(`<think>` 内联 / `reasoning_content` 国内事实标准 / `reasoning` OpenRouter·gpt-oss 派 / 结构化块)/ 请求头协商为何是反模式 / 多轮回传三种口径 / AI SDK(两字段名都认)→ opencode ReasoningPart → UI 消费链路 / 2026-07 内网 MaaS 思考格式变更评估:更正规非魔改、零改动兼容、DeepSeek 多轮回传观察点
32. [electron-main-fetch-vs-net-fetch.md](electron-main-fetch-vs-net-fetch.md) — 内网"浏览器能下载、应用内 fetch failed"根因:主进程 undici fetch 与 Chromium 栈(渲染端/`net.fetch`)代理·DNS·证书·挂起恢复四项差异 / PAC-only 可达的内网 host 对 Node 直连是死路 / `error.cause` 被 IPC 序列化吞掉与裸 console.log 不进 main.log 两个排障陷阱 / 规约:主进程 http(s) 一律 `net.fetch`、失败展开 cause 链走 `log.error`(锚点:2026-07-16 OBS 产物下载失败)
33. [standing-instruction-echoed-by-weak-model.md](standing-instruction-echoed-by-weak-model.md) — 「常驻/条件性指令塞进 user turn → 弱模型当当前任务复述」反模式:insight 发「你好」内网模型回一段带 outputs 绝对路径的话(每轮注入 `[输出目录] synthetic` 指令,空问候无锚点时被弱模型 latch)/ 本质=弱模型分不清「背景配置」vs「这轮要做的事」、「每轮注入」放大命中 / 三级避免法(工具兜底>常驻位置>别靠改措辞)/ 判据「想让模型知道但通常不提的东西别当 user turn 指令喂」/ 唯一稳妥「不暴露」=根本不放进对话(锚点:SPEC-INS-014 v5 / UXAI PR #368)
34. [stale-path-predicate-after-layout-refactor.md](stale-path-predicate-after-layout-refactor.md) — 排查复盘:输入框上传的文件对话正常、却永远进不了文件管理。根因 = 落点迁 `.octo/tmps` 那次重构**只改了判据上方的注释、函数体仍按旧布局找 `insight/uploads`** → 判据恒假 → 附件停在预会话区不搬进会话 uploads / 四个放大器(注释反向漂移比过期更难 review · 恒假判据是静默降级三条日志一条不打 · 私有纯函数不在可测面 · 面板上传旁路仍能用制造"功能正常"假象)/ 规约:迁落点 grep 旧名字·路径判据从已知根派生·死分支要可观测·纯函数搬 utils 加单测(锚点:SPEC-INS-014 §4.1.2 / UXAI `b90d404c6`)

35. [permission-ask-and-always-allow.md](permission-ask-and-always-allow.md) — 权限询问完整链路(以 insight「读取工作区外文件」`external_directory` 弹窗为线索):7 个工具经 `assertExternalDirectory` 发起 ask → `Deferred.await` **阻塞整个工具调用**(「贴路径卡在正在探索」的成因)→ once/always/reject 三种应答差异 / **两个反直觉点**:①「始终允许」作用域是**整个项目(directory)下所有会话**而非当前会话(`reply()` 里那句 sessionID 判断只管即时解阻塞,不决定授权作用域;`approved` 存在按 directory 缓存的 InstanceState、表主键也是 `project_id`)②`permission` 表建好了却**只在启动时 select、运行时从不写回**(全仓唯一写入是 json-migration 一次性迁移)→ **「始终允许」重启即失效**,是 bug 还是安全取舍存疑不下定论 / 服务端 `approved` vs 前端 `autoAccept` 两套机制辨析 / `patterns` 是目录 glob、真实文件在 `metadata.filepath` / 「弹窗没出现」五条排查清单

36. [uxai-app-entry-routing.md](uxai-app-entry-routing.md) — UXAI 前端**两条入口链、一个 root**:浏览器/Playwright(`entry.tsx → @/octo`,history)与 Electron(`desktop/renderer → @opencode-ai/app → octoapp/index.ts → octo.tsx`,HashRouter 无地址栏)共用 `octo.tsx`,平台差异只走 `router` prop + `PlatformProvider` / 上游 root 是 `src/app.tsx` 不在 `octoapp/` 里,「为不动上游要留两份 root」不成立 / **两次更正的历史**:先误判 `octo.tsx` 是死副本(成因:引用在跨 package re-export 链上,单目录 grep 看不见)→ 导致两份 root 漂移两个多月、浏览器验 UI 看到的不是交付形态 → 2026-07-29 归一(PR #474) / 方法论:顶层探针只能证明"不在 X 入口的图里",不能证明"死文件";平台差异优先找注入点,复制 root 是最贵的解法 / Electron 进 dev 页用 `location.hash`,pushState+PopStateEvent 无效
37. [solid-jsx-blocks-import-meta-env-treeshaking.md](solid-jsx-blocks-import-meta-env-treeshaking.md) — `{import.meta.env.DEV && devStuff()}` 在 Solid 里**摇不掉**(桌面生产包一直多带 78KB 预览代码):Vite 7 `vite:define` 只有 transform 钩子、替换时机没问题;真凶是 `vite-plugin-solid` 排在 `definePlugin` 之前,Solid 把 JSX 里的成员表达式额外包一层内嵌 memo → `memo(() => memo(() => false)() && f())`,Rollup 折不掉 / 第二个坑:模块顶层 `lazy()` 是 Rollup 眼里的副作用 / **两个条件是「与」关系**,单独做任何一个产物都无变化,极易误判方向 / 五种做法实测对比 / 验证要数 chunk + 搜路径字符串,别 grep 函数名(会被混淆)

38. [agent-output-path-and-provenance.md](agent-output-path-and-provenance.md) — agent 产物落点约束 与「路径出处」不可判定:产物该落哪是**运行时策略、不进模型上下文**,模型只给文件名(业界标配=Code Interpreter `/mnt/data`·沙箱根)/ 从"提示词塞绝对路径"(泄漏,见 #33)迁到"插件重定向"方向就对 / 难在**自找的错位**——默认落点(outputs)比工作目录窄,标准的"写工作目录外才弹权限"对工作目录根的写不触发 / 残留长尾:弱模型/skill 拼 `cwd+文件名` 成绝对路径绕过重定向(DB 取证:agent 对但 filePath=`D:\...`)/ 三条打架指令(上游 write schema「must be absolute」·上下文暴露 cwd·提示词「只给文件名」)/ **出处无法从工具参数判定**——能判的是模型(看得见 user 消息)故规则进 prompt·插件只机械搬运 / 硬保证不可兼得的证明 / 落法:提示词消矛盾·skill 位置无关·插件按「以 filePath 落盘产物」扩 `{write,edit}`(锚点:SPEC-INS-021 · UXAI PR #488)

39. [relative-path-base-per-tool.md](relative-path-base-per-tool.md) — 相对路径的「基准」为什么要逐工具指定,以及它跟「能读写哪里」不是一回事:**基准**(`a.md` 等于哪个绝对路径,我们的插件)≠ **允许区**(那个绝对路径准不准碰,上游 `external_directory`)——插件对绝对路径完全不介入,不会让模型「读不到某目录」/ 必须逐工具是因为上游没有会话级 cwd 抽象、每个工具各自 join `instance.directory`,而改 `Instance.directory` 自指 / 基准表(write·edit·read·bash → 产物目录;glob·grep → **会话根**)与三处刻意的不对称(搜索范围≠落点,否则「在材料里找 X」搜不到 uploads;read 不拦越界因 `../uploads/` 合法;bash 只能靠 workdir——skill 脚本不读系统提示词)/ **三层心智模型**:声明层(改字符串)·基准层(改参数)·权限层(改判定),①② 缺一不可——只改声明,`write.ts` 的 `path.join(instance.directory,…)` 一字未动(锚点:SPEC-INS-028 · `octo-session-workdir.ts`)

40. [sync-store-is-partial-cache.md](sync-store-is-partial-cache.md) — 前端 `sync.data.session` **不是**会话全集、也不是侧栏列表的镜像,而是「最近 5 个根会话 + 4h 内活跃的 + 本次运行碰巧路过的子会话」(三条进入路径 / 两条淘汰路径,`roots: true` · `limit: 5` · `trimSessions`)/ 锚点案例:子会话导航拦截查它的 `parentID`,**当轮对、刷新后错**——`!!undefined?.parentID` 把「没查到」悄悄当成「不是子会话」放行 / 为什么自测动作永远走在对的那一半 / 判定分三类:渲染态与优化性判断可查 store,**权威判定不行**(「查不到 ≠ 不成立」)/ 三条出路(根本不问 > 实拉校验 > 服务端判定)与 `!!x?.foo` 形状自查法(锚点:SPEC-INS-021 §1 · UXAI PR #718)

41. [bash-err-trap-and-set-e.md](bash-err-trap-and-set-e.md) — `set -e` / `ERR trap` 的六条豁免规则,每一条都能让「响亮失败」在你最需要的路径上静默失效:**ERR trap 默认不进函数**(要 `set -E`)—— 兜底写在脚本顶部、冒烟也测顶层,两边都绿,而主体逻辑在函数里,一行契约行都打不出(fastui `install.sh --check` 实际踩到,review 才抓出来)/ `exit` **不**触发 ERR trap(所以自家 `fail()` 与兜底 trap 可以共存,不用加哨兵)/ `[ cond ] && cmd` 条件为假不算错误(安全,但**别放在函数末尾**)/ heredoc 里的 `$(...)` 失败**完全静默**,变量空着往下跑,只能显式判空 —— 而同样是命令替换,`VAR="$(cmd)"` 赋值形式却会被拦,不能类推。**豁免会传进条件位置调用的函数体**(`if ! http_get …` 里函数整段都不受管,`-E` 也救不了,只能让函数自己把返回值算对)/ **`-E` + `VAR=$(cmd)` 会把 trap 的契约行灌进被捕获的变量**、退出码也被改写(真出过事:好资产被判假红、`curl exit=7` 被静默改成 1)/ **污染与放在哪无关**,取决于子 shell 里还有没有 bash 进程——单条外部命令会被 exec 掉故不触发,**多一条命令或加一个重定向就触发**;位置只决定你察不察觉得到,所以按位置防不住,只能 trap 开头判 `BASH_SUBSHELL` 一刀切/ **`set +e` 并不抑制 ERR trap** / 含 bash 3.2(macOS 自带)实测与「五个注入点」验证法

42. [npm-global-prefix-and-node-abi.md](npm-global-prefix-and-node-abi.md) — 两个被当成架构约束的误解:**`npm -g` 要不要 sudo 只由 prefix 决定**(`--prefix=<用户目录>` 就够,跟"是不是 portable node"无关——SPEC-DES-001 v1~v15 把它写成"必须用 portable node 的核心原因",代价是每台机器首装先下 50MB 并走一条 504/403 过的链路)/ 全局落点**两种布局别猜**(Unix `lib/node_modules` vs Windows / portable 包的 `node_modules`,两次实测互相打脸 → 顺 bin 符号链接问真相,还要校验是 `.js`;Node 18+ 不许 spawn `.cmd`)/ `~/.npmrc` 的 `prefix=` 会静默抢落点,装完要断言落点 / **换 node 大版本真会挂的只有三类**(绑 ABI 的 `.node`、webpack4 md4 在 OpenSSL3、被删 API),**N-API 不绑**,fsevents 是 optional+N-API 且失败回落轮询 → 判据放宽到"大版本相同"有依据 / 但**用白名单不用 `>=`**(未验过的新大版本不该算满足要求)/ node 版本**不是**依赖树一致性的代理指标(那是 lockfileHash 的活,两者别混)/ 方法论:怎么认出"被固化成前提的手段"(问"到底是什么迫使必须这样",答不出机制就只是手段)、"已有用户在违反约束下跑通过"是强信号、取消依赖要取消干净(不下载 node 还必须不读 manifest,否则只绕开一半)

> 后续可能补:
>
> - `electron-vite-build.md` — main/preload/renderer 三段构建模型(暂不重要)
> - `effect-ts-primer.md` — opencode 用 Effect.js,看源码会遇到
