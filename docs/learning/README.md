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
23. [file-passing-to-models.md](file-passing-to-models.md) — 文件怎么传给模型/工具:模型 API 不收 File/Blob/磁盘路径 / 三种模式(文本内联·base64-or-url 多媒体·工具引用)/ `FilePart.url` 多态且**组 prompt 时被急切解析**(text→内联、二进制→base64,`prompt.ts:1103-1264`)/ 非多模态 stripMedia 占位 / base64 体量爆炸(5MB→170 万 token)/ insight 三条现状路径 + 终态分流(ADR-015)/「FilePart 喂模型 vs handle 喂工具不可混用」
23. [env-dotenv-override-trap.md](env-dotenv-override-trap.md) — 事故复盘:`release:win` 打 prod 包却连 beta MCP,手动 `build:prod` 却对。根因 = `bun <file>`(release.ts)自动加载 `.env` 进 `process.env` + `loadEnv(prefix="")` 优先级 `process.env > .env.<mode> > .env`,`.env` 业务值**反向盖过** `.env.prod` / 为何 release.ts 中招、`bun run build:prod` 不中招 / 为何 REPORT 不暴露 MCP 暴露 / 解药:环境专属值只放 `.env.beta`/`.env.prod` + `[octo:env]` 构建/启动日志(dev 经 configureServer 避开 clearScreen)
> 与 [build-channel-injection.md](build-channel-injection.md) 坑 4/5 同机制:那篇是 `OCTO_CHANNEL` 被污染,本篇是业务地址变量被污染
24. [resource-accessor-refetch-flashes-global-suspense.md](resource-accessor-refetch-flashes-global-suspense.md) — 排查复盘:Insight"每次发送/生成完整页闪一下初始加载动画"。真凶是会话列表 `createResource` 的 accessor 被在 render(`hasMore`)里读 → `session.updated` 事件触发 refetch → Solid"refetch 重新挂起 Suspense"把最外层全屏 `<Splash>` fallback 顶出来,子树却不卸载(故无重挂、数据不变)/ A/B/C/D 四假设按代价排除的方法论 /「整页像重置但代码无重挂」= 优先查祖先 Suspense / 根治:render 只读镜像信号·`.loading`·`.error`,绝不读 resource accessor
25. [git-pull-merge-vs-rebase.md](git-pull-merge-vs-rebase.md) — `git pull` 三种策略:为何 `--merge` 不存在(`--no-rebase` 才是正确写法)/ merge(菱形历史)vs rebase(线性历史)vs fast-forward-only(只允许前进)机制对比 / 冲突解法 / 何时用哪个 / 全局配置默认策略
26. [terminal-proxy-and-corporate-gateway.md](terminal-proxy-and-corporate-gateway.md) — 浏览器/终端两套代理体系为何互不相通 / 产物代理链路(`setGlobalProxyFromEnv`·mac `$SHELL -il` 抓环境·win 继承用户级变量·NO_PROXY 内网豁免·系统证书加载)/ netentsec 网关实测行为(中间人重签·按 UA 拦裸 curl 伪造 503·按域名 TLS 层掐断·浏览器裁决法)/ 各平台 curl 坑(schannel 吊销检查·mac 不读钥匙串·`-s` 吞报错)/ 按信号强弱的排查方法论(超时→407→503 各指向什么)
> 配套操作手册见 [../intranet-proxy-setup.md](../intranet-proxy-setup.md)(纯步骤,给小白粘命令)

> 后续可能补:
>
> - `electron-vite-build.md` — main/preload/renderer 三段构建模型(暂不重要)
> - `effect-ts-primer.md` — opencode 用 Effect.js,看源码会遇到
