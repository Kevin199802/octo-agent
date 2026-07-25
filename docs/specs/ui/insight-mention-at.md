# Spec — Insight 输入框 `@` 引用面板（SPEC-INS-023）

> 状态：草案 · P1 · 规模 [M] · 领域 ui
>
> 起因：[需求 #88] insight 输入框需要 `@` 唤起引用面板，让用户显式引用**技能（skills）**与**本地会话文件**。站内 Design（make）模块已在 PR #428 做了同类 `@` 面板，insight 参考其实现做本地化适配（Design 用 ProseMirror + `session.command`，insight 用纯 `<textarea>` + `promptAsync`，样式与交互形态不同）。
>
> 上游已实现：✓（Design/make 的 textarea 版 `@` 逻辑 + `MentionPopover` 组件 + `loadSkillsFromPanel` 共享 util，可直接移植；opencode 侧 skill 已注册为 slash command，`get-skill-content` IPC 已存在）

---

## 1. 背景与范围

### 1.1 目标
insight 输入框支持 `@` 唤起面板，**只做两类引用**：

- **技能库**：平台技能（`octo_insight` 面板）+ 自定义技能（`common` 面板）
- **文件管理**：当前会话的本地文件（生成 = `outputs`、上传 = `uploads`）

### 1.2 明确不做（范围外）
- slash 命令面板、设计系统 / 模板选择器（Design 专有）
- 把 `@文件` 加进附件条：**走文本引用**（对齐 Design），不新增附件上传

> **修订（2026-07-25，方案 B）**：原定「insight 保持纯 `<textarea>`、不上 ProseMirror」。实测后用户要求 @提及呈现为 Design 那种**行内灰胶囊**——原生 `<textarea>` 物理上无法在文字流内渲染带背景的原子节点。故**输入控件从 `<textarea>` 切换为 ProseMirror**（移植 Design 的 `prosemirror-editor`），详见 §3.1。3b 注入、文件文本引用、queue、打点等其余决策不变。

### 1.3 与 Design（make PR #428）的对照

| 维度 | Design（make） | Insight 适配 |
|---|---|---|
| 输入控件 | ProseMirror（另有完整保留的 textarea 旧路径） | 纯 `<textarea>`（移植 Design 的 textarea 旧路径逻辑） |
| 平台技能面板 key | `octo_make` | **`octo_insight`** |
| 自定义技能 | `common` | `common` |
| 文件数据源 | `fetchArtifactList`（generated/uploaded） | **`fetchInsightFiles`（outputs/uploads）** |
| 文件 tab 文案 | 「设计资产」 | **「会话文件」** |
| 技能落地 | `session.command` 真执行 `/技能名` | **synthetic 注入 SKILL.md 到 `promptAsync`**（见 §4） |
| 文件落地 | `@名` → 文本 `读取{path}这个文件` | 同（对齐） |

---

## 2. 架构决策：synthetic 注入（方案 3b），不走 `session.command`（3a）

### 2.1 三种候选
1. **`/技能名` 明文进 prompt**：`promptAsync` 不解析 prompt 文本里的 `/`（[opencode `session/prompt.ts` 无 slash 展开]），斜杠是「假斜杠」纯文本，无机械作用 → 否。
2. **中文指令让模型调 skill 工具**：靠模型自觉，非确定性。
3. **确定性执行**：
   - **3a** `session.command`：与 Design 一致，真执行 skill 命令 + 发 `SkillUsed` 事件。
   - **3b** 自读 SKILL.md 作为 synthetic part 注入 `promptAsync`：技能指令每轮确定进上下文。

### 2.2 为什么选 3b
insight 用户气泡是**上游 `SessionTurn`**，只渲染「**第一个非 synthetic text part**」（`packages/ui/src/components/message-part.tsx` 的 `parts.find(p => p.type==="text" && !p.synthetic)`），**不认 `metadata.displayText`**。

`session.command` 内部把整篇 SKILL.md 模板作为**非 synthetic** part 排在最前（`session/prompt.ts` 的 `[...templateParts, ...input.parts]`）→ **用户气泡会显示整篇 SKILL.md**。Design 靠自己改写的 insight-turn 读 `displayText` 规避，insight 用上游 SessionTurn 没有这个能力 → 3a 需重写用户气泡渲染，成本大。

**3b** 复用 insight 现有的 synthetic 注入机制（`[附件]` 清单、chip 模板都是 synthetic：模型可见、气泡不渲染）：

- ✅ 技能指令每轮确定性进上下文 = 拿到「确定性」
- ✅ 气泡天然干净（干净正文是唯一非 synthetic text part）
- ✅ queue / chip / 附件 / 乐观渲染几乎不用动
- ⚠️ 代价（接受）：不发 `SkillUsed` 事件、不做 `$ARGUMENTS` 占位替换 / 技能级 tool-gating —— interview-analysis 这类「分析指引型」技能用不到这些

---

## 3.1 输入控件：ProseMirror（方案 B，2026-07-25）

为拿到 Design 那种行内灰胶囊,insight 输入框从 `<textarea>` 换成 ProseMirror,移植 Design 的 `prosemirror-editor`(自包含,不 import make):

- **移植文件**：`insight/components/prosemirror-editor/`——`schema.ts`（mention 原子节点）、`plugins/{mention-trigger,sync,atom-keymap,no-empty-paragraph}.ts`、`styles.css`（`.pm-mention` 灰胶囊）、`index.tsx`（本地化）
- **去掉**：slash-trigger 插件与 `/preview`（`/` 不做）
- **接线**：编辑器渲染 insight 的 `MentionPopover`（数据 = `octo_insight` 技能 + insight 会话文件）；`onContentChange → setPrompt`（保持 `prompt()` 同步,发送/禁用判据不变）；`onSubmit → handleSubmit`；`onMentionOpen/onMentionSelect` 回调驱动打点；`ref` 暴露 `clear()/setText()/focus()`（isConnected 守卫,发送后清空、排队回填、回焦用）
- **胶囊去 `overflow-hidden`**（对齐 Design）：否则会裁掉编辑器内 `bottom:100%` 的 @ 弹层
- **selections 单一真相源**：编辑器 syncPlugin 从 doc 里的 mention 节点派生 `mentionSelections`，发送时 `splitMentions` 拆桶注入（3b 不变）
- **换控件带来的写入点改造**：`value={prompt()}` 双向绑失效 → 清空/排队回填改调 `clear()/setText()`；输入法合成、Enter 发送、退格删胶囊、面板开关均由编辑器内部处理，删除 textarea 版的 `handleKeyDown`/composition/自适应高度逻辑

## 3. 组件：`pages/insight/components/mention-popover/`（新增，自包含）

本地化拷贝自 Design，`index.tsx` + `styles.css`（类名前缀 `ins-mention-*`，用 `--octo-*` token）。

- 两 tab：**技能库**（一级：平台技能 / 自定义技能）、**文件管理**（一级：会话文件）
- 二级面板按 `query` 过滤列表
- Props 收敛（比 Design 干净：传算好的列表，不传原始 skillConfig）：
  ```ts
  {
    query: string
    platformSkills: MentionSkill[]   // MentionSkill = { label; description? }
    customSkills: MentionSkill[]
    files: { generated: InsightFileEntry[]; uploaded: InsightFileEntry[] } | null
    selections: MentionSelection[]
    onSelect / onDeselect / onClose
  }
  ```
- `MentionSelection = { type:'skill'; name; label } | { type:'file'; filename; path }`
- 本地最小类型 `MentionSkill`，不 import make 目录（CLAUDE.md 自包含约束）

---

## 4. 数据源

- **技能**：`loadSkillsFromPanel("octo_insight")`（平台，util 自动排除 common）+ `loadSkillsFromPanel("common")`（自定义）。`@` 触发时惰性加载一次并缓存进 `skillConfig` 信号。
- **文件**：`fetchInsightFiles(sdk.url, sdk.directory, sid, "outputs" | "uploads")`，用 `createResource` 挂到已有的 `filesRefreshKey`（发送带附件时自动重拉）。生成 = outputs、上传 = uploads，`isFolder` 过滤掉目录。
- **文件管理上传/删除的实时同步（2026-07-25 修 bug）**：`mentionFiles` 挂 `filesRefreshKey`，靠它 bump 才重拉。但**文件管理面板自己**上传/删除时,`renderResultViewer` 原来**只把 `refreshKey` 往下传给 ResultViewer、没把 `onFilesRefresh` 往上接**——文件管理内部 `props.onFilesRefresh?.()` 成空操作,`filesRefreshKey` 不增 → `@` 面板不刷新,现象是「文件管理上传的文件 @ 时不出来,切一下会话/agent(`sid` 变 → resource 重拉)才出」。**修复**：给 `renderResultViewer` 的 `<ResultViewer>` 补上 `onFilesRefresh={() => setFilesRefreshKey(k => k + 1)}`。现在文件管理上传/删除都 bump `filesRefreshKey`,`@` 面板与文件列表实时同步(顺带修了「删文件后 @ 面板还留旧文件」)。文件管理自身刷新走内部 `refresh()`,新增的 refreshKey 触发是 `defer` 幂等,无死循环。

---

## 5. 交互（移植 Design textarea 逻辑）

- **触发**：`onInput` 正则 `/(?:^|\s)@([^\s@]*)$/` 命中光标前 token → 开面板 + 记 `mentionState={query,cursor}` + 惰性加载技能。
- **插入**：选中 → 把 `@query` 替换成 `@label `，selection 记进 `mentionSelections`，光标移到 chip 后。
- **取消**：面板里再点一次 → 删 chip + 移出 selections。
- **键盘**（`handleKeyDown` 增强）：面板开时 `Esc` 关面板；`Backspace` 删整个 `@chip`；`Enter` 不发送（让位面板）。
- **关闭**：点击面板外 `mousedown` 关闭（`createEffect` + `onCleanup`）。
- **挂载**：welcome 态与对话态两处 `<textarea>` 上方各挂一个，`position:absolute; bottom:100%` 锚定输入胶囊（胶囊已 `position:relative`）。

---

## 6. 提交转换与引用注入

> **实现修正（对齐落地）**：insight 的单条 text part **既是气泡又是模型内容**，若把文件写成可见的 `读取{绝对path}` 会**在气泡里暴露绝对路径**。故最终取:**可见文本保持 `@名` 原样**（气泡显示用户所引用、干净不漏路径），技能与文件**都走 synthetic 注入**（模型可见、气泡不显）。这是对 Design「文件转可见文本」做法在 insight 单-part 模型下的必要偏离。

### 6.1 提交拆桶（`handleSubmit` 发送前）
纯函数 `splitMentions(selections) → { skills: string[]; files: Array<{filename,path}> }`：

- 可见文本（`text = prompt().trim()`）**不改**——`@技能名` / `@文件名` 原样保留，作为气泡与模型可见的引用记号
- selections 拆成 `skills`（技能 label）与 `files`（filename + 绝对 path）两桶，驱动 synthetic 注入
- 发送后清 `mentionSelections`
- 有引用时 `text` 必含 `@名` 故非空，空发送判据无需为引用豁免

### 6.2 引用注入（`doSendPrompt` 内）
- 新增可选参数 `mentions?: { skills: string[]; files: Array<{filename,path}> }`，一路 `handleSubmit → sendMessage → doSendPrompt`（flush 排队路径同样携带，见 §7）。
- **技能**：`window.api.getSkillContent(name)` 拿 SKILL.md，push 一个 **synthetic** text part：
  ```
  <skill_content name="技能名">
  …SKILL.md 正文…
  </skill_content>
  ```
- **文件**：push 一个 **synthetic** `[引用文件]` 清单（不用 `[附件]` 前缀，避免 InsightTurn 误渲染成文件卡片）：
  ```
  [引用文件] 用户本轮引用了以下已存在的会话文件，需要时用 extract_document 按路径读取：
  - {filename}: {绝对path}
  ```
- 上述 synthetic part 同步镜像进 optimistic（与 uploadBlock 同处理，气泡不渲染 synthetic → 无闪烁）。
- **降级**：非桌面 / 取不到技能内容 → 跳过该技能注入 + `console.warn`，不阻断发送。

---

## 7. queue / chip / 附件 兼容

- **queue（改结构）**：`utils/send-queue.ts` 由 `Record<string,string[]>` → `Record<string, QueuedSend[]>`，`QueuedSend = { text: string; skills?: string[] }`，让 busy 时排队的技能引用**不丢**。改动面：类型 + `updateSessionQueue`/`clearSessionQueue` 签名 + index.tsx 3 处调用（enqueue / flushQueueHead / removeQueued）+ 队列条渲染 `{item.text}`。
- **chip（MCP，SPEC-INS-017）**：技能注入是 synthetic 前缀、chip 是 turn 级工具 gate，两者正交、可共存，不做互斥。
- **附件**：`@文件`（文本引用已存在会话文件）与附件上传（新增文件）是两条路，互不影响。

---

## 8. 打点（对齐 CLAUDE.md 打点约束）

新增核心行为打点，并同步 `packages/app/octoapp/pages/insight/docs/tracking.md`：

| name | 触发 | extend |
|---|---|---|
| `mention-open` | `@` 首次唤起面板 | — |
| `mention-select` | 选中一项 | `{ type: "skill" \| "file" }` |

纯 tab 切换 / hover / 取消勾选不打点。

---

## 9. 文件清单

**新增**
- `pages/insight/components/mention-popover/index.tsx`
- `pages/insight/components/mention-popover/styles.css`

**修改**
- `pages/insight/index.tsx`（信号 / trigger / 键盘 / 两处挂载 / 提交转换 / doSendPrompt 注入）
- `pages/insight/utils/send-queue.ts`（队列项带 skills）
- `pages/insight/docs/tracking.md`（打点条目）

---

## 10. 风险 / 边界

- 非桌面无 `window.api` → 技能注入降级跳过（仍可发送）；文件列表拉取失败 → 文件 tab 空态。
- 技能 label 唯一性依赖 `skill_config.json`（平台已 exclude common，不重复）。
- 一轮多技能：v1 支持多选，全部注入（多个 `<skill_content>` 块）。
- SKILL.md 过大 → 上下文膨胀：v1 不截断，后续可加长度保护。

---

## 11. 验收标准

1. `@` 唤起面板，技能库 / 文件管理可切换、可按 query 过滤。
2. 选技能 → 气泡只显示用户原话（不显 SKILL.md）；模型按该技能行为响应。
3. 选文件 → 发送后模型能读到该会话文件（走 `extract_document`）。
4. Esc / 点外部 / 退格删 chip 正常；面板开时 Enter 不误发。
5. busy 时带技能引用发送 → 入队，idle flush 后技能仍生效。
6. 打点两条按预期上报。

---

## 12. 落地记录

- **已实现（外网，UXAI 分支 `feat/insight-at-mention`）**，`packages/app` typecheck 全绿。文件:
  - 新增 `pages/insight/components/mention-popover/{index.tsx,styles.css}`
  - `pages/insight/index.tsx`:mention 信号 / `handleMentionInput` 触发 / `handleKeyDown` 增强(Esc·退格删 chip·Enter 让位) / 选中·取消·点外关闭 / 两处 composer 挂载(relative wrapper 规避胶囊 overflow-hidden 裁剪) / `doSendPrompt` synthetic 注入
  - `pages/insight/utils/send-queue.ts`:`QueuedSend = {text, skills?, files?}`
  - `pages/insight/lib/electron-api.ts`:`DesktopApi` 补 `getSkillContent`
  - `pages/insight/docs/{tracking.md,tracking-plan.md}`:`mention-open` / `mention-select`
- **实现修正**:见 §6 顶注——文件由「可见文本 `读取path`」改为「synthetic `[引用文件]` 清单」,可见文本保持 `@名`,避免气泡暴露绝对路径;技能文件统一走 synthetic。
- **方案 B（2026-07-25,输入控件换 ProseMirror,见 §3.1）**:新增 `insight/components/prosemirror-editor/`(schema + mention-trigger/sync/atom-keymap/no-empty-paragraph 四插件 + styles + 本地化 index),两处 composer `<textarea>` → `<ProseMirrorEditor>`,胶囊去 `overflow-hidden`,删除 textarea 版键盘/合成/自适应高度逻辑,清空/回填改走编辑器 ref。`packages/app` typecheck 全绿。**动因**:textarea 无法渲染行内胶囊,用户要求对齐 Design。
- **文件管理上传实时同步 @ 面板（2026-07-25 修 bug,见 §4）**:`renderResultViewer` 补 `onFilesRefresh={() => setFilesRefreshKey(k+1)}`,修「文件管理上传的文件 @ 时不出、切会话才出」。
- **合入**:实现 UXAI PR #432(`feat/insight-at-mention` → dev,待评审);spec/ROADMAP 已合入 octo-agent dev(PR #15)。
- **待**:内网真机验证(技能确定性激活 / 文件 extract_document 读取 / 排队带引用 / 打点上报 / **中文输入法 + 胶囊交互回归**),补 PR 号。
