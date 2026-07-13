# CLAUDE.md — Octo Insight 开发（UXAI 本地）

## 对话语言（强制）

所有对话输出一律用简体中文(解释、追问、汇报、commit / PR 说明等面向用户的文字),不因话题切换或引用英文材料改用其他语言;代码、命令、标识符、专有名词照原样,不硬译。

## 文档仓

设计文档(architecture / spec / ADR / learning / handoff)的真相源在 **octo-agent 仓**:
`/Users/huowenkai/projects/octo-agent`(下文 `docs/…`、`ROADMAP.md` 等均指此仓)。

- 读 / 写文档都在文档仓,**不在 UXAI 提交设计文档(.md)**;文档不走 PR,但任何 commit 仍需用户确认(见「提交」)
- UXAI 仓只提交 insight 代码;**提代码 PR 遵守 `docs/collab-pr-protocol.md`**(一 PR 一事 / conventional 标题 / 说清意图)

## 提交

未经用户确认,不 `git commit` / `git push` / 提 PR;完成后列变更等确认。

## 写 spec / 代码前

- 做 UI / 功能先 grep 上游 opencode(`packages/ui`、`packages/app`)有没有,有就复用
- 架构决策类(协议 / 接口 / 数据流 / 上传)先列 2–3 种业界做法对比再选;spec 顶标「上游已实现 ✓/✗」
- 新建 insight 专属 spec 要编号,先读文档仓 `docs/specs/README.md` 登记表取当前最大号 + 1,不要凭记忆猜
- spec 起草阶段就要写「验证」章节,不要等实现完再补;外网验证写本地/公网可复现的步骤,只有真依赖内网真实数据或服务才加「内网验证」节,外网能走完的不用硬凑内网节

## 实施原则

- 复用 `@opencode-ai/ui` 组件;不动上游核心(`packages/ui` `packages/opencode` `packages/sdk`)
- insight 页面自包含(样式 / 组件 / 工具不外散);可视化各自在页面目录引库
- Office 预览走 `window.api.openPath()`
- PromptInput 自实现 · 预置提示词单 turn · 对话内容永不替代(卡片是附加预览),细节见 `docs/specs/ui/`
- **生产可见文案用专业措辞**:toast / 错误提示 / 按钮 / 空态等用户可见文字,不用口语化表述(如"粘给 Claude 定位"、"可提交给 xx 排查");面向用户的文案默认按"这段话会被真实用户看到"来写,不是写给内部调试用的
- **资源(`createResource`)读取要挡错误态**:Solid resource 在 `.error` 时直接调用 accessor 会 throw、冒泡到最近 `ErrorBoundary`——局部功能(如某个面板拉取列表失败)要用 `<Show when={!resource.error} fallback={...}>` 挡住,不能让局部失败冒泡成整页崩溃兜底
- **新增/改服务端路由、IPC handler 需要重启进程才生效**:本地验证前先重启对应的 opencode server / Electron 进程,否则会看到"新路由 404"这种容易被误判成代码 bug 的现象
- **新增服务端接口前先确认走哪套路由框架**:`packages/opencode` 里同时有两套后端——普通 Hono 路由(`server/routes/instance/*.ts`)和类型化 Effect HttpApi(`server/routes/instance/httpapi/groups/*.ts` + `handlers/*.ts`)。本仓开发/预览渠道**默认启用 `OPENCODE_EXPERIMENTAL_HTTPAPI`**,这种情况下普通 Hono 路由不会被处理请求的那套 server 用到——照抄一个"看起来是 Hono 路由"的现成模块（如 `artifact.ts`）新增接口前,先确认那个模块本身在当前后端选择下是否真的活着(它也可能是遗留代码);同名分组已存在类型化实现（如 `insight` 分组）时优先扩展它。重启多少次都救不了这个问题,不要在"是不是没重启"上反复打转,先用 `bun run --cwd packages/opencode --conditions=browser src/index.ts serve --port <n>` 直接跑源码 + curl 验证接口本身通不通。详见 learning 笔记 [hono-vs-effect-httpapi-routing.md](docs/learning/hono-vs-effect-httpapi-routing.md)。

## 工作流

- spec 完成 / 变更后,更新 `ROADMAP.md`
- 查 bug 先看 `docs/insight-debugging.md`(`[octo:*]` 日志字典,console 日志的手工镜像);新增 / 改 / 删日志前缀 / 字段 / `octoDebug` 命令时同步它
- UI 遇占位 / 缺数据,记 `docs/specs/ui/design-assets-needed.md`
- 沉淀踩坑 / 机制理解,写 learning 笔记放 `docs/learning/`;新增 / 删笔记同步 `docs/learning/README.md` 索引

## 工作目录（UXAI 代码）

- `packages/app/octoapp/pages/insight/` · `packages/app/octoapp/pages/_shell/`
- `packages/opencode/src/agent/prompt/octo_insight.md`(agent 配置)

## 参考（用到时查）

- 对接契约(MCP / 上传 / `window.api`):`docs/intranet-handoff.md`
- PR 协议:`docs/collab-pr-protocol.md`
- 旧实现快照:`archive/insight-impl-2026-06` 分支
