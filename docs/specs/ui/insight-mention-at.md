# Spec — Insight 输入框 `@` 引用面板（SPEC-INS-023）

> 状态：已实现（外网），待内网验证 · P1 · 规模 [M] · 领域 ui
>
> 起因：[需求 #88] insight 输入框需要 `@` 唤起引用面板，让用户显式引用**技能（skills）**与**本地会话文件**。站内 Design（make）已在 PR #428 做了同类 `@` 面板（ProseMirror 富文本 + mention 原子节点），insight 参考其实现做本地化适配。
>
> 上游已实现：✓（Design/make 的 `prosemirror-editor` + `mention-popover` + `loadSkillsFromPanel` 共享 util 可移植；opencode 侧 skill 已注册为 slash command，桌面壳 `get-skill-content` IPC 已存在）

---

## 1. 背景与范围

### 1.1 目标
insight 输入框支持 `@` 唤起面板，**只做两类引用**：

- **技能库**：平台技能（`octo_insight` 面板）+ 自定义技能（`common` 面板）
- **文件管理**：当前会话的本地文件（生成 = `outputs`、上传 = `uploads`）

`@提及` 在输入框内呈现为**行内灰胶囊**（对齐 Design），发送时把「技能 / 文件引用」拆出来注入本轮上下文。

### 1.2 明确不做（范围外）
- slash 命令面板、`/preview`、设计系统 / 模板选择器（Design 专有，移植时去掉）
- 把 `@文件` 加进附件条：**走引用注入**（不新增附件上传）
- `@技能` 走 `session.command` 真执行（改走 synthetic 注入，见 §2.2）

### 1.3 与 Design（make PR #428）的对照

| 维度 | Design（make） | Insight 适配 |
|---|---|---|
| 输入控件 | ProseMirror（mention 原子节点） | **同**（移植 `prosemirror-editor`，去 slash/preview） |
| 平台技能面板 key | `octo_make` | **`octo_insight`** |
| 自定义技能 | `common` | `common` |
| 文件数据源 | `fetchArtifactList`（generated/uploaded） | **`fetchInsightFiles`（outputs/uploads）** |
| 文件 tab 一级项文案 | 「设计资产」 | **「用研资产」** |
| 技能落地 | `session.command` 真执行 `/技能名` | **synthetic 注入 SKILL.md 到 `promptAsync`**（§2.2） |
| 文件落地 | `@名` → 文本 `读取{path}这个文件` | **synthetic `[引用文件]` 清单**（不暴露路径，§7） |

---

## 2. 架构决策

### 2.1 输入控件：ProseMirror（行内胶囊）
`@提及` 要呈现为 Design 那种**带背景的行内胶囊**，而原生 `<textarea>` 物理上只能装纯文本、无法在文字流内渲染带样式的节点。故 insight 输入框采用 **ProseMirror**：mention 是一个 `atom` 原子节点，套 `.pm-mention` 样式即成灰胶囊；发送时从 doc 里解析「文本 + 提及」。

移植 Design 的 `prosemirror-editor`（自包含，不 import make 目录），详见 §4。

### 2.2 技能落地：synthetic 注入（3b），不走 `session.command`

**候选**：opencode 里 skill 本身就是注册好的 slash command，但 `promptAsync`（insight 发送走的这条）**不解析 prompt 文本里的 `/`**——只有 `session.command` API 才确定性执行命令。于是「@技能 确定性生效」有两条路：

- **3a** `session.command`：与 Design 一致，真执行 skill 命令 + 发 `SkillUsed` 事件。
- **3b** 自读 `SKILL.md` 作 synthetic part 注入 `promptAsync`：技能指令每轮确定进上下文。

**选 3b。** 因为 insight 用户气泡是**上游 `SessionTurn`**，只渲染「第一个非 synthetic text part」（`packages/ui/src/components/message-part.tsx`），**不认 `metadata.displayText`**。而 `session.command` 内部把整篇 SKILL.md 作为**非 synthetic** part 排在最前（`session/prompt.ts`）→ 用户气泡会显示整篇 SKILL.md。Design 靠自己改写的 insight-turn 读 `displayText` 规避；insight 用上游 SessionTurn 没有这能力 → 3a 需重写用户气泡渲染，成本大。

**3b** 复用 insight 现有的 synthetic 注入机制（`[附件]` 清单、chip 模板都是 synthetic：模型可见、气泡不显）：

- ✅ 技能指令每轮确定性进上下文 = 拿到「确定性」
- ✅ 气泡天然干净（可见文本是唯一非 synthetic text part）
- ✅ queue / chip / 附件 / 乐观渲染几乎不用动
- ⚠️ 代价（接受）：不发 `SkillUsed` 事件、不做 `$ARGUMENTS` 占位 / 技能级 tool-gating —— interview-analysis 这类「分析指引型」技能用不到

---

## 3. 组件：`pages/insight/components/mention-popover/`（新增，自包含）

`@` 面板 UI，`index.tsx` + `styles.css`（类名前缀 `ins-mention-*`，用 `--octo-*` token）。

- 两 tab：**技能库**（一级：平台技能 / 自定义技能）、**文件管理**（一级：用研资产 = 会话文件）；二级面板按 `query` 过滤。
- Props 收敛（传算好的列表，不传原始 skillConfig）：
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
- 由 `prosemirror-editor` 内部渲染（触发时弹出），不由页面直接挂。

---

## 4. 组件：`pages/insight/components/prosemirror-editor/`（新增，移植 Design 本地化）

自包含拷贝自 Design（不 import make）：

- `schema.ts`：mention 原子节点（`atom: true`，`toDOM` 渲染 `.pm-mention` 灰胶囊）+ `getDocTextWithMentions`（doc → 文本，提及输出 `@name`）/ `extractMentionsFromDoc`
- `plugins/`：`mention-trigger`（检测光标前 `@query` → 弹面板）、`sync`（doc 变化 → 派生 `mentionSelections` + 回传文本）、`atom-keymap`（退格/删除整块删原子节点）、`no-empty-paragraph`
- `styles.css`：`.pm-mention` 灰胶囊、占位符
- `index.tsx`：本地化——**去掉 slash-trigger + `/preview`**；渲染 insight 的 `MentionPopover`；`ref` 暴露 `clear() / setText() / focus()`（`isConnected` 守卫）；回调 `onContentChange / onSubmit / onMentionOpen / onMentionSelect / onPaste`

**selections 单一真相源**：syncPlugin 从 doc 里的 mention 节点派生 `mentionSelections`，发送时据此拆桶（§7）。

---

## 5. 数据源

- **技能**：`loadSkillsFromPanel("octo_insight")`（平台，util 自动排除 common）+ `loadSkillsFromPanel("common")`（自定义）。`@` 触发时惰性加载一次并缓存。
- **文件**：`fetchInsightFiles(sdk.url, sdk.directory, sid, "outputs" | "uploads")`，用 `createResource` 挂到 `filesRefreshKey`。生成 = outputs、上传 = uploads，`isFolder` 过滤掉目录。
- **文件管理上传/删除的实时同步**：`mentionFiles` 靠 `filesRefreshKey` bump 才重拉。文件管理面板自己上传/删除时，须由它回调 `onFilesRefresh` 去 bump。**（2026-07-25 修 bug）** `renderResultViewer` 原来只把 `refreshKey` 往下传给 `ResultViewer`、**没把 `onFilesRefresh` 往上接** → 文件管理内部 `props.onFilesRefresh?.()` 成空操作 → `@` 面板不刷新（现象：文件管理上传的文件 `@` 时不出来，切会话/agent 让 `sid` 变、resource 重拉才出）。**修复**：给 `<ResultViewer>` 补 `onFilesRefresh={() => setFilesRefreshKey(k => k + 1)}`；文件管理自身刷新走内部 `refresh()`，新增触发是 `defer` 幂等、无死循环。顺带修「删文件后 `@` 面板还留旧文件」。

---

## 6. 交互

- **触发**：`mention-trigger` 插件检测光标前 `@query` → 弹面板；`@` 首次唤起惰性加载技能。
- **插入**：选中 → 把触发区间的 `@query` 替换成 mention 原子节点（灰胶囊）；`mentionSelections` 由 syncPlugin 从 doc 派生。
- **取消**：面板里再点一次 → 删对应 mention 节点 + 光标前残留 `@query`。
- **键盘 / 输入法**：Enter 发送、Shift-Enter 换行（编辑器 keymap）；退格删整块胶囊（`atom-keymap`）；中文输入法合成由 ProseMirror 原生处理（合成期 Enter 不误发）。
- **关闭**：Esc / 点面板外 `mousedown` 关闭。
- **挂载**：welcome 态与对话态两处 composer 各一个 `<ProseMirrorEditor>`。
- **弹层定位（Portal + fixed，对齐 Design a919045a2）**：`@` 面板用 `<Portal>` 挂到 `document.body`、`position: fixed`，坐标由编辑器容器 `getBoundingClientRect()` 实时算（面板每次 query 变化重算）。这样弹层**脱离胶囊的 `overflow` 与堆叠上下文**，永不被裁切/遮挡 → 胶囊容器**保留 `overflow-hidden`**（圆角完整）。z-index 用 `1000/1001`。（早期方案曾靠「去掉胶囊 overflow-hidden」绕过裁剪，Portal 方案更彻底，已回退。）

---

## 7. 提交转换与引用注入（3b）

### 7.1 拆桶（`handleSubmit` 发送前）
可见文本（`prompt()`，由编辑器 `onContentChange` 同步，含 `@名`）**不改**——`@技能名` / `@文件名` 原样作为气泡与模型可见的引用记号。纯函数 `splitMentions(selections)` 把选择拆成：

- `skills: string[]`（技能 label）
- `files: Array<{ filename, path }>`

发送后清 `mentionSelections`。有引用时 `text` 必含 `@名` 故非空，空发送判据无需豁免。

### 7.2 注入（`doSendPrompt` 内）
`mentions?: { skills, files }` 一路 `handleSubmit → sendMessage → doSendPrompt`（flush 排队路径同样携带，见 §8）。均 push 为 **synthetic** text part（模型可见、气泡不显）：

- **技能**：`window.api.getSkillContent(name)` 拿 SKILL.md →
  ```
  <skill_content name="技能名">
  …SKILL.md 正文…
  </skill_content>
  ```
- **文件**（不用 `[附件]` 前缀，避免 InsightTurn 误渲染成文件卡片）：
  ```
  [引用文件] 用户本轮引用了以下已存在的会话文件，需要时用 extract_document 按路径读取：
  - {filename}: {绝对path}
  ```
- synthetic part 同步镜像进 optimistic（与 uploadBlock 同处理，气泡不渲染 → 无闪烁）。
- **降级**：非桌面 / 取不到技能内容 → 跳过该技能注入 + `console.warn`，不阻断发送。
- 发送后清空输入框走编辑器 `clear()`（`value={prompt()}` 双向绑已随 ProseMirror 失效）。

---

## 8. queue / chip / 附件 兼容

- **queue**：`utils/send-queue.ts` 队列项 `string[]` → `{ text, skills?, files? }[]`，busy 排队时的 `@引用` 不丢，flush 时重新注入。改动面：类型 + `updateSessionQueue`/`clearSessionQueue` 签名 + index.tsx 3 处调用 + 队列条渲染 `{item.text}`。
- **chip（MCP，SPEC-INS-017）**：技能注入是 synthetic 前缀、chip 是 turn 级工具 gate，正交、可共存，不做互斥。
- **附件**：`@文件`（引用已存在会话文件）与附件上传（新增文件）两条路，互不影响。

---

## 9. 打点（对齐 CLAUDE.md 打点约束）

编辑器回调驱动，`index.tsx` 上报，同步 `packages/app/octoapp/pages/insight/docs/tracking.md`：

| name | 触发 | extend | 落点 |
|---|---|---|---|
| `mention-open` | `@` 面板由关到开那一次 | — | 编辑器 `onMentionOpen` → `trackMentionOpen` |
| `mention-select` | 选中一项 | `{ type: "skill" \| "file" }` | 编辑器 `onMentionSelect` → `trackMentionSelect` |

纯 tab 切换 / hover / 取消勾选不打点。**注意**：@技能走 synthetic 注入（不调 skill 工具），§九 `server-skill-used` **不覆盖** @技能 —— `mention-select{type:skill}` 是 @技能 唯一的用户侧口径。

---

## 10. 文件清单

**新增**
- `pages/insight/components/mention-popover/{index.tsx,styles.css}`
- `pages/insight/components/prosemirror-editor/{index.tsx,schema.ts,styles.css,plugins/{mention-trigger,sync,atom-keymap,no-empty-paragraph}.ts}`

**修改**
- `pages/insight/index.tsx`（两处 composer 换编辑器 / mention 接线 / 3b 注入 / queue 带引用 / `renderResultViewer` 补 `onFilesRefresh` / 删 textarea 版键盘·输入法·自适应高度逻辑）
- `pages/insight/utils/send-queue.ts`（队列项带 skills/files）
- `pages/insight/lib/electron-api.ts`（`DesktopApi` 补 `getSkillContent` 类型）
- `pages/insight/docs/{tracking.md,tracking-plan.md}`（打点条目）

---

## 11. 风险 / 边界

- 非桌面无 `window.api` → 技能注入降级跳过（仍可发送）；文件列表拉取失败 → 文件 tab 空态。
- 技能 label 唯一性依赖 `skill_config.json` 的 `panel`（平台已 exclude common，不重复）；本地 `skill_config.json` 无 `panel` 键时技能库为空（内网构建才有）。
- 一轮多技能：v1 支持多选，全部注入（多个 `<skill_content>` 块）。
- SKILL.md 过大 → 上下文膨胀：v1 不截断，后续可加长度保护。
- 换控件回归面：中文输入法、Enter 发送、退格删胶囊、附件粘贴——均收敛在 insight 输入框内，不影响其他 tab。
- 排队项回填时 `@名` 退化为纯文本（不重建胶囊）。

---

## 12. 验收标准

1. `@` 唤起面板，技能库 / 文件管理可切换、可按 query 过滤。
2. 选技能 / 文件 → 输入框呈**行内灰胶囊**；气泡只显 `@名`（不显 SKILL.md、不暴露路径）。
3. 选技能发送 → 模型按该技能行为响应（确定性激活）；选文件发送 → 模型能读到该会话文件（走 `extract_document`）。
4. Esc / 点外部 / 退格删胶囊正常；中文输入法确认候选不误发。
5. busy 时带引用发送 → 入队，idle flush 后引用仍生效。
6. 文件管理上传/删除 → `@` 面板与文件列表实时同步（不用切会话）。
7. 打点 `mention-open` / `mention-select` 按预期上报。

---

## 13. 落地记录

- **已实现（外网，UXAI 分支 `feat/insight-at-mention`）**，`packages/app` typecheck + pre-push turbo typecheck（12/12）全绿。
- 实现 PR：UXAI [#432](https://github.com/MyHeavenDyf/UXAI/pull/432)（`feat/insight-at-mention` → dev，待评审）。
- spec / ROADMAP：octo-agent dev（PR #15 + #16 + #17 重写）。
- **弹层定位改 Portal + fixed（2026-07-25，见 §6）**：对齐 Design a919045a2，恢复胶囊 `overflow-hidden` 圆角、z-index 抬到 1000/1001；文件管理一级项文案「会话文件」→「用研资产」。随 UXAI PR #432 追加提交 `383c6f5`。
- **待**：内网真机验证（技能确定性激活 / 文件 `extract_document` 读取 / 排队带引用 / 中文输入法 + 胶囊交互回归 / 文件管理实时同步 / 打点上报），补内网验证结论。
